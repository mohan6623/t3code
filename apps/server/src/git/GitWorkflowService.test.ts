import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as WorkspaceWorktrees from "./WorkspaceWorktrees.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

const notAContainer = Layer.mock(WorkspaceWorktrees.WorkspaceWorktrees)({
  isContainer: () => Effect.succeed(false),
});

it.layer(NodeServices.layer)("GitWorkflowService", (it) => {
  it.effect("finds a name among the refs of every namespace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ref-named-" });
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      for (const args of [
        ["init", "-b", "main"],
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
        ["update-ref", "refs/remotes/upstream/feature/topic", "HEAD"],
        ["symbolic-ref", "refs/remotes/origin/alias", "refs/heads/main"],
        ["update-ref", "refs/mirror/origin/mirrored", "HEAD"],
      ]) {
        yield* driver.execute({ operation: "test.setupRepo", cwd, args });
      }
      const found = yield* Effect.forEach(
        ["main", "feature/topic", "alias", "mirrored", "t3/renamed", "feature/*"],
        (refName) => workflow.hasRefNamed({ cwd, refName }),
      );
      assert.deepEqual(found, [true, true, true, true, false, false]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        GitWorkflowService.layer.pipe(
          Layer.provide(
            Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
              resolve: () => Effect.succeed({ kind: "git" } as VcsDriverRegistry.VcsDriverHandle),
            }),
          ),
          Layer.provide(Layer.mock(GitManager.GitManager)({})),
          Layer.provide(notAContainer),
          Layer.provideMerge(GitVcsDriver.layer),
          Layer.provideMerge(VcsProcess.layer),
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-ref-named-" }).pipe(
              Layer.provide(NodeServices.layer),
            ),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );

  // Fork: each child repository section in the thread details panel has its own branch row.
  it.effect(
    "switches and creates refs in a nested child repository without touching the root",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-nested-branch-" });
        const child = path.join(root, "frontend");
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const git = (cwd: string, args: ReadonlyArray<string>) =>
          driver
            .execute({
              operation: "test.nestedBranch",
              cwd,
              args: ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
            })
            .pipe(Effect.map((result) => result.stdout.trim()));
        const currentBranch = (cwd: string) => git(cwd, ["branch", "--show-current"]);

        yield* git(root, ["init", "-b", "main"]);
        yield* git(root, ["commit", "--allow-empty", "-m", "root"]);
        yield* fileSystem.makeDirectory(child);
        yield* git(child, ["init", "-b", "develop"]);
        yield* fileSystem.writeFileString(path.join(child, "app.txt"), "develop\n");
        yield* git(child, ["add", "app.txt"]);
        yield* git(child, ["commit", "-m", "develop"]);
        yield* git(child, ["checkout", "-b", "feature/login"]);
        yield* fileSystem.writeFileString(path.join(child, "app.txt"), "login\n");
        yield* git(child, ["commit", "-am", "login"]);
        yield* git(child, ["checkout", "develop"]);

        const listed = yield* workflow.listRefs({ cwd: child });
        assert.deepEqual(listed.refs.map((ref) => ref.name).toSorted(), [
          "develop",
          "feature/login",
        ]);

        yield* workflow.switchRef({ cwd: child, refName: "feature/login" });
        assert.equal(yield* currentBranch(child), "feature/login");
        assert.equal(yield* currentBranch(root), "main");

        yield* workflow.createRef({ cwd: child, refName: "child-work", switchRef: true });
        assert.equal(yield* currentBranch(child), "child-work");
        assert.equal(yield* currentBranch(root), "main");
        assert.equal(yield* git(root, ["branch", "--list", "child-work"]), "");

        // A dirty child working tree blocks the checkout and keeps the edit, as at the root.
        yield* fileSystem.writeFileString(path.join(child, "app.txt"), "unsaved\n");
        const error = yield* workflow
          .switchRef({ cwd: child, refName: "develop" })
          .pipe(Effect.flip);
        assert.equal(error._tag, "GitCommandError");
        assert.equal(yield* currentBranch(child), "child-work");
        assert.equal(yield* fileSystem.readFileString(path.join(child, "app.txt")), "unsaved\n");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          GitWorkflowService.layer.pipe(
            Layer.provide(VcsDriverRegistry.layer),
            Layer.provide(Layer.mock(GitManager.GitManager)({})),
            Layer.provide(notAContainer),
            Layer.provideMerge(GitVcsDriver.layer),
            Layer.provideMerge(VcsProcess.layer),
            Layer.provideMerge(
              ServerConfig.layerTest(process.cwd(), { prefix: "t3-nested-branch-" }).pipe(
                Layer.provide(NodeServices.layer),
              ),
            ),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
  );
});
