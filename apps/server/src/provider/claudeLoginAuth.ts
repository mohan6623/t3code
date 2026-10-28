/**
 * Fork: in-app Claude sign-in.
 *
 * Runs `claude auth login` in a terminal on the environment's own machine and
 * shows that terminal in provider settings. A remote environment (such as a
 * cloud VM) can then be signed in again from the app, without SSH.
 */
import {
  ProviderSetupError,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProviderAuth,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/process";

import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as ServerSettings from "../serverSettings.ts";

const METHOD_ID = "claude-subscription";
const TRANSCRIPT_LIMIT = 16_384;
const SETUP_TOKEN_VARIABLE = "CLAUDE_CODE_OAUTH_TOKEN";

/** The web app matches this auth type to offer a subscription sign-in. */
export const CLAUDE_TOKEN_AUTH_TYPE = "oauthToken";

/** How an instance reaches Claude: its own login, a setup token, an API key, or nothing. */
export type ClaudeSignInMethod = "subscription" | "token" | "apiKey" | "signedOut";

const decodeClaudeAuthStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      loggedIn: Schema.optional(Schema.Boolean),
      authMethod: Schema.optional(Schema.String),
    }),
  ),
);

/** Reads `claude auth status --json`; undefined when the output does not say. */
export function parseClaudeAuthStatus(stdout: string): ClaudeSignInMethod | undefined {
  const status = decodeClaudeAuthStatus(stdout.trim());
  if (Option.isNone(status)) return undefined;
  switch (status.value.authMethod) {
    case "claude.ai":
      return "subscription";
    case "oauth_token":
      return "token";
    case "api_key":
      return "apiKey";
    case "none":
      return "signedOut";
    default:
      return status.value.loggedIn === false ? "signedOut" : undefined;
  }
}

/** The credential an environment hands to Claude. An API key wins over a token, as in the CLI. */
export function claudeEnvironmentSignInMethod(
  environment: NodeJS.ProcessEnv,
): "token" | "apiKey" | undefined {
  if (environment.ANTHROPIC_API_KEY?.trim()) return "apiKey";
  if (environment[SETUP_TOKEN_VARIABLE]?.trim()) return "token";
  return undefined;
}

/** Asks the CLI how this instance signs in, with the instance's environment and config dir. */
export const readClaudeSignInMethod = Effect.fn("readClaudeSignInMethod")(function* (options: {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
}) {
  const output = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(
      options.binaryPath,
      ["auth", "status", "--json"],
      { env: options.environment },
    );
    return yield* spawnAndCollect(
      options.binaryPath,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: options.environment,
        shell: spawnCommand.shell,
        cwd: options.cwd,
      }),
    );
  }).pipe(
    Effect.timeoutOption("10 seconds"),
    Effect.orElseSucceed(() => Option.none()),
  );
  const method = Option.isSome(output) ? parseClaudeAuthStatus(output.value.stdout) : undefined;
  return method ?? claudeEnvironmentSignInMethod(options.environment);
});

/**
 * A setup token counts as signed in, but MCP connectors and usage need a real
 * login. Mark it so settings can offer a subscription sign-in.
 */
export function withClaudeSignInMethod<T extends { readonly auth: ServerProviderAuth }>(
  provider: T,
  method: ClaudeSignInMethod | undefined,
): T {
  if (method !== "token" || provider.auth.status !== "authenticated") return provider;
  return {
    ...provider,
    auth: { ...provider.auth, type: CLAUDE_TOKEN_AUTH_TYPE, label: "Claude token" },
  };
}

/** The instance without its saved setup token, or undefined when it has none. */
export function withoutClaudeSetupToken(
  instance: ProviderInstanceConfig,
): ProviderInstanceConfig | undefined {
  const environment = instance.environment ?? [];
  if (!environment.some((variable) => variable.name === SETUP_TOKEN_VARIABLE)) return undefined;
  const kept = environment.filter((variable) => variable.name !== SETUP_TOKEN_VARIABLE);
  const { environment: _omit, ...rest } = instance;
  return kept.length > 0 ? { ...rest, environment: kept } : rest;
}

/**
 * The environment for the login command. A setup token or API key in the
 * environment would stand in for the account, so the login drops them and
 * writes the account's own login file in its config directory.
 */
export function claudeLoginEnvironment(
  environment: NodeJS.ProcessEnv,
  configDir: string,
): NodeJS.ProcessEnv {
  const {
    CLAUDE_CODE_OAUTH_TOKEN: _token,
    ANTHROPIC_API_KEY: _apiKey,
    ANTHROPIC_AUTH_TOKEN: _authToken,
    ...rest
  } = environment;
  return { ...rest, CLAUDE_CONFIG_DIR: configDir };
}

/** Removes the instance's saved setup token from settings; true when there was one. */
export const removeClaudeSetupToken = Effect.fn("removeClaudeSetupToken")(function* (
  instanceId: ProviderInstanceId,
) {
  const settings = yield* ServerSettings.ServerSettingsService;
  return yield* Effect.gen(function* () {
    const current = yield* settings.getSettings;
    const instance = current.providerInstances[instanceId];
    const next = instance === undefined ? undefined : withoutClaudeSetupToken(instance);
    if (next === undefined) return false;
    yield* settings.updateProviderInstance({ operation: "upsert", instanceId, instance: next });
    return true;
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not remove the saved Claude setup token.", {
        operation: error.operation,
      }).pipe(Effect.as(false)),
    ),
  );
});

export const makeClaudeLoginAuth = Effect.fn("makeClaudeLoginAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly binaryPath: string;
  readonly configDir: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  /** Re-reads the account after a sign-in or sign-out. */
  readonly onChanged: Effect.Effect<void>;
}) {
  const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
  const settings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const failure = (operation: string, detail: string, cause?: unknown) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation, detail, cause });
  const env = claudeLoginEnvironment(options.environment, options.configDir);

  /**
   * A saved setup token outranks the new login, so it goes once the login works.
   * Saving settings deletes its stored secret and rebuilds the instance, which
   * reads the account again. False when there was no token to remove.
   */
  const removeSetupToken = Option.isNone(settings)
    ? Effect.succeed(false)
    : removeClaudeSetupToken(options.instanceId).pipe(
        Effect.provideService(ServerSettings.ServerSettingsService, settings.value),
      );

  /** Runs one `claude auth` command in a terminal; with a context, the user sees and types in it. */
  const runInTerminal = Effect.fnUntraced(function* (
    operation: string,
    args: ReadonlyArray<string>,
    context: ProviderAuthFlow.ProviderAuthFlowContext | null,
  ) {
    if (Option.isNone(pty))
      return yield* failure(
        operation,
        "In-app sign-in needs a terminal, and this environment has none.",
      );
    // A terminal starts a program by its full path; on Windows a bare name or an npm shim fails.
    const resolved = yield* resolveSpawnCommand(options.binaryPath, args, {
      env,
      bypassNpmShim: true,
    });
    const program = resolved.shell
      ? { shell: env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", resolved.command] }
      : { shell: resolved.command, args: [...resolved.args] };
    const exited = yield* Deferred.make<number>();
    const output = yield* Queue.sliding<string>(64);
    const process = yield* pty.value
      .spawn({
        ...program,
        cwd: options.cwd,
        cols: 80,
        rows: 24,
        env,
      })
      .pipe(
        Effect.mapError((cause) =>
          failure(operation, "Could not open the Claude sign-in terminal.", cause),
        ),
      );
    const detachData = process.onData((data) => {
      Queue.offerUnsafe(output, data.slice(-TRANSCRIPT_LIMIT));
    });
    const detachExit = process.onExit(({ exitCode }) => {
      Deferred.doneUnsafe(exited, Effect.succeed(exitCode));
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        detachData();
        detachExit();
        try {
          process.kill();
        } catch {}
      }),
    );
    if (context !== null) {
      let transcript = "";
      let outputOffset = 0;
      const update = () =>
        context.setInteraction(
          { type: "terminal", id: "terminal", output: transcript, outputOffset },
          (response) =>
            response.type === "terminal"
              ? Effect.try({
                  try: () => {
                    if (response.size) process.resize(response.size.cols, response.size.rows);
                    if (response.data) process.write(response.data);
                  },
                  catch: () => failure("respond", "The Claude sign-in terminal has closed."),
                })
              : Effect.void,
        );
      yield* update();
      yield* Queue.take(output).pipe(
        Effect.flatMap((data) => {
          outputOffset += data.length;
          transcript = (transcript + data).slice(-TRANSCRIPT_LIMIT);
          return update();
        }),
        Effect.forever,
        Effect.forkScoped,
      );
    }
    return yield* Deferred.await(exited);
  });

  const authenticate = Effect.fn("ClaudeLoginAuth.authenticate")(function* (
    _methodId: string,
    context: ProviderAuthFlow.ProviderAuthFlowContext,
  ) {
    const exitCode = yield* runInTerminal("start", ["auth", "login", "--claudeai"], context);
    if (exitCode !== 0)
      return yield* failure("start", "Claude sign-in did not finish. Start again.");
    yield* context.verifying;
    if (!(yield* removeSetupToken)) yield* options.onChanged;
  });

  const logout = Effect.scoped(runInTerminal("logout", ["auth", "logout"], null)).pipe(
    Effect.flatMap((exitCode) =>
      exitCode === 0 ? Effect.void : Effect.fail(failure("logout", "Claude could not sign out.")),
    ),
    Effect.timeoutOrElse({
      duration: "60 seconds",
      orElse: () => Effect.fail(failure("logout", "Claude did not finish signing out in time.")),
    }),
    Effect.andThen(options.onChanged),
  );

  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    // One login per config directory; instances that share it share the account.
    credentialBinding: { owner: "provider", key: `claude:${options.configDir}` },
    methods: Effect.succeed([
      {
        id: METHOD_ID,
        name: "Claude subscription",
        description: "Sign in with your Claude account in a terminal on this environment.",
        type: "terminal" as const,
      },
    ]),
    defaultMethodId: METHOD_ID,
    authenticate,
    logout,
    // The browser step and pasting the code back take a while.
    timeoutMs: 600_000,
  });
});
