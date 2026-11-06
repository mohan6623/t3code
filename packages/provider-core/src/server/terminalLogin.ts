/**
 * Fork: in-app sign-in for CLI providers.
 *
 * Runs the provider's own login command in a terminal on the environment's
 * machine and streams that terminal to provider settings, so any client
 * (web, desktop, mobile, remote) can sign an account in again without SSH.
 */
import {
  ProviderSetupError,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderAuth,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";

import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as ProviderAuthFlow from "./providerAuthFlow.ts";

const TRANSCRIPT_LIMIT = 16_384;

interface TerminalLoginMethod {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly args: ReadonlyArray<string>;
  /** An interactive program the user quits by hand; its exit code says nothing. */
  readonly anyExitCode?: boolean;
}

/**
 * Runs one CLI command in a terminal. With a context, the user sees the
 * terminal and types in it; resolves with the exit code.
 */
export const runTerminalCommand = Effect.fnUntraced(function* (options: {
  /** Read when the provider is built; the sign-in later runs outside that context. */
  readonly pty: Option.Option<PtyAdapter.PtyAdapter["Service"]>;
  readonly providerName: string;
  readonly instanceId: ProviderInstanceId;
  readonly operation: string;
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly context: ProviderAuthFlow.ProviderAuthFlowContext | null;
}): Effect.fn.Return<number, ProviderSetupError, Scope.Scope> {
  const failure = (detail: string, cause?: unknown) =>
    new ProviderSetupError({
      instanceId: options.instanceId,
      operation: options.operation,
      detail,
      cause,
    });
  const pty = options.pty;
  if (Option.isNone(pty))
    return yield* failure("In-app sign-in needs a terminal, and this environment has none.");
  const env = options.environment;
  // A terminal starts a program by its full path; on Windows a bare name or an npm shim fails.
  const resolved = yield* resolveSpawnCommand(options.binaryPath, options.args, {
    env,
    bypassNpmShim: true,
  });
  const program = resolved.shell
    ? { shell: env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", resolved.command] }
    : { shell: resolved.command, args: [...resolved.args] };
  const exited = yield* Deferred.make<number>();
  const output = yield* Queue.sliding<string>(64);
  const process = yield* pty.value
    .spawn({ ...program, cwd: options.cwd, cols: 80, rows: 24, env })
    .pipe(
      Effect.mapError((cause) =>
        failure(`Could not open the ${options.providerName} sign-in terminal.`, cause),
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
  const context = options.context;
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
                catch: () => failure(`The ${options.providerName} sign-in terminal has closed.`),
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

/** Marks a provider snapshot as able to sign in from settings. */
export function withTerminalSignIn<
  T extends { readonly auth: ServerProviderAuth; readonly setup?: ServerProvider["setup"] },
>(draft: T, options: { readonly canLogout: boolean }): T {
  return {
    ...draft,
    setup: { canInstall: false, ...draft.setup, canAuthenticate: true },
    auth: { ...draft.auth, canLogout: options.canLogout },
  };
}

export const makeTerminalLoginAuth = Effect.fn("makeTerminalLoginAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly providerName: string;
  readonly binaryPath: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  /** Instances with the same key share one login and refresh together. */
  readonly bindingKey: string;
  readonly methods: readonly [TerminalLoginMethod, ...ReadonlyArray<TerminalLoginMethod>];
  /** Without it, sign-out stays in the CLI. */
  readonly logoutArgs?: ReadonlyArray<string>;
  /** The account's own folder; created before the first sign-in. */
  readonly accountDirectory?: string;
  /** Re-reads the account after a sign-in or sign-out. */
  readonly onChanged: Effect.Effect<void>;
}) {
  const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
  const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
  const failure = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation, detail });
  const run = (
    operation: string,
    args: ReadonlyArray<string>,
    context: ProviderAuthFlow.ProviderAuthFlowContext | null,
  ) =>
    runTerminalCommand({
      pty,
      providerName: options.providerName,
      instanceId: options.instanceId,
      operation,
      binaryPath: options.binaryPath,
      args,
      cwd: options.cwd,
      environment: options.environment,
      context,
    });

  const authenticate = Effect.fn("TerminalLoginAuth.authenticate")(function* (
    methodId: string,
    context: ProviderAuthFlow.ProviderAuthFlowContext,
  ) {
    const method = options.methods.find((entry) => entry.id === methodId) ?? options.methods[0];
    const directory = options.accountDirectory;
    if (directory !== undefined && Option.isSome(fileSystem)) {
      yield* fileSystem.value.makeDirectory(directory, { recursive: true }).pipe(Effect.ignore);
    }
    const exitCode = yield* run("start", method.args, context);
    if (exitCode !== 0 && method.anyExitCode !== true)
      return yield* failure(
        "start",
        `${options.providerName} sign-in did not finish. Start again.`,
      );
    yield* context.verifying;
    yield* options.onChanged;
  });

  const logoutArgs = options.logoutArgs;
  const logout =
    logoutArgs === undefined
      ? Effect.fail(
          failure("logout", `Sign out with the ${options.providerName} CLI on this environment.`),
        )
      : Effect.scoped(run("logout", logoutArgs, null)).pipe(
          Effect.flatMap((exitCode) =>
            exitCode === 0
              ? Effect.void
              : Effect.fail(failure("logout", `${options.providerName} could not sign out.`)),
          ),
          Effect.timeoutOrElse({
            duration: "60 seconds",
            orElse: () =>
              Effect.fail(
                failure("logout", `${options.providerName} did not finish signing out in time.`),
              ),
          }),
          Effect.andThen(options.onChanged),
        );

  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: options.bindingKey },
    methods: Effect.succeed(
      options.methods.map(({ id, name, description }) => ({
        id,
        name,
        description,
        type: "terminal" as const,
      })),
    ),
    defaultMethodId: options.methods[0].id,
    authenticate,
    logout,
    // The browser step and pasting a code back take a while.
    timeoutMs: 600_000,
  });
});
