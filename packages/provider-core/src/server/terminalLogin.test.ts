import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderAuthState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";

import { makeTerminalLoginAuth } from "./terminalLogin.ts";

const instanceId = ProviderInstanceId.make("terminal-login-test");

/** A terminal whose program exits at once with `exitCode`; records what it ran. */
const fakeTerminal = (exitCode: number) => {
  const spawned: Array<ReadonlyArray<string>> = [];
  const layer = Layer.succeed(PtyAdapter.PtyAdapter, {
    spawn: (input) =>
      Effect.sync(() => {
        spawned.push(input.args ?? []);
        return {
          pid: 1,
          write: () => {},
          resize: () => {},
          kill: () => {},
          onData: () => () => {},
          onExit: (callback) => {
            callback({ exitCode, signal: null });
            return () => {};
          },
        };
      }),
  });
  return { spawned, layer };
};

const settled = (state: ProviderAuthState) =>
  state.phase === "succeeded" || state.phase === "failed";

it.effect.each([
  { exitCode: 0, anyExitCode: false, phase: "succeeded" },
  { exitCode: 1, anyExitCode: false, phase: "failed" },
  { exitCode: 130, anyExitCode: true, phase: "succeeded" },
] as const)(
  "runs the chosen method in the account's folder; exit $exitCode ends $phase",
  ({ exitCode, anyExitCode, phase }) => {
    const terminal = fakeTerminal(exitCode);
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const accountDirectory = path.join(yield* fileSystem.makeTempDirectoryScoped(), "account");
      let changed = 0;
      const controller = yield* makeTerminalLoginAuth({
        instanceId,
        providerName: "Test",
        binaryPath: "/bin/test-cli",
        cwd: "/",
        environment: {},
        bindingKey: "test:account",
        accountDirectory,
        methods: [
          { id: "code", name: "Code", description: "", args: ["login", "--code"] },
          { id: "browser", name: "Browser", description: "", args: ["login"], anyExitCode },
        ],
        onChanged: Effect.sync(() => void changed++),
      });
      yield* controller.start("owner", undefined, "browser");
      const state = yield* controller
        .subscribe("owner")
        .pipe(Stream.filter(settled), Stream.runHead, Effect.map(Option.getOrThrow));

      assert.strictEqual(state.phase, phase);
      assert.deepEqual(terminal.spawned, [["login"]]);
      assert.strictEqual(changed, phase === "succeeded" ? 1 : 0);
      assert.isTrue(yield* fileSystem.exists(accountDirectory));
    }).pipe(
      Effect.scoped,
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, terminal.layer)),
    );
  },
);

it.effect("signs out only with a logout command", () => {
  const terminal = fakeTerminal(0);
  const make = (logoutArgs?: ReadonlyArray<string>) =>
    makeTerminalLoginAuth({
      instanceId,
      providerName: "Test",
      binaryPath: "/bin/test-cli",
      cwd: "/",
      environment: {},
      bindingKey: "test:account",
      methods: [{ id: "login", name: "Login", description: "", args: ["login"] }],
      ...(logoutArgs ? { logoutArgs } : {}),
      onChanged: Effect.void,
    });
  return Effect.gen(function* () {
    const withoutLogout = yield* make();
    assert.strictEqual(
      (yield* withoutLogout.logout(Effect.void).pipe(Effect.result))._tag,
      "Failure",
    );
    assert.deepEqual(terminal.spawned, []);

    const withLogout = yield* make(["logout"]);
    yield* withLogout.logout(Effect.void);
    assert.deepEqual(terminal.spawned, [["logout"]]);
  }).pipe(
    Effect.scoped,
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, terminal.layer)),
  );
});
