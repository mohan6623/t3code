import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlRepositoryService from "../sourceControl/SourceControlRepositoryService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";
import * as NestedRepositories from "./NestedRepositories.ts";
import * as ProjectCloneTracker from "./ProjectCloneTracker.ts";

const configLayer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-nested-repos-config-" });

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(ProjectCloneTracker.layer),
  Layer.provideMerge(
    SourceControlRepositoryService.layer.pipe(
      Layer.provide(
        Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
          resolveLink: () => undefined,
        }),
      ),
    ),
  ),
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(WorkspaceRepositories.layer),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provide(configLayer),
  Layer.provideMerge(NodeServices.layer),
);

const git = Effect.fn("test.git")(function* (cwd: string, args: ReadonlyArray<string>) {
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* driver.execute({ operation: "test.git", cwd, args });
  return result.stdout.trim();
});

const commitAll = Effect.fn("test.commitAll")(function* (cwd: string, message: string) {
  yield* git(cwd, ["add", "-A"]);
  yield* git(cwd, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--no-gpg-sign",
    "-m",
    message,
  ]);
});

/**
 * A root repository that ignores three folders: `frontend` (its own repo on branch `feature`,
 * pushed to a bare remote, with an ignored `.env`), `backend` (a repo with no remote) and
 * `node_modules/pkg`-style noise (`node_modules` holding a `.git`).
 */
const makeSource = Effect.fn("test.makeSource")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-nested-repos-" });
  const remotes = path.join(base, "remotes");
  const rootRemote = path.join(remotes, "root.git");
  const frontendRemote = path.join(remotes, "frontend.git");
  yield* fileSystem.makeDirectory(remotes, { recursive: true });
  yield* git(remotes, ["init", "--bare", "-b", "main", rootRemote]);
  yield* git(remotes, ["init", "--bare", "-b", "main", frontendRemote]);

  const source = path.join(base, "source");
  yield* fileSystem.makeDirectory(source, { recursive: true });
  yield* git(source, ["init", "-b", "main"]);
  yield* fileSystem.writeFileString(
    path.join(source, ".gitignore"),
    "frontend/\nbackend/\nnode_modules/\n.env\n",
  );
  yield* fileSystem.writeFileString(path.join(source, "README.md"), "workspace\n");
  yield* fileSystem.writeFileString(path.join(source, ".env"), "ROOT=1\n");
  yield* commitAll(source, "root");
  yield* git(source, ["remote", "add", "origin", rootRemote]);
  yield* git(source, ["push", "-u", "origin", "main"]);

  const frontend = path.join(source, "frontend");
  yield* fileSystem.makeDirectory(frontend);
  yield* git(frontend, ["init", "-b", "main"]);
  yield* fileSystem.writeFileString(path.join(frontend, ".gitignore"), ".env\n");
  yield* fileSystem.writeFileString(path.join(frontend, "app.ts"), "export {};\n");
  yield* commitAll(frontend, "frontend main");
  yield* git(frontend, ["remote", "add", "origin", frontendRemote]);
  yield* git(frontend, ["push", "-u", "origin", "main"]);
  yield* git(frontend, ["checkout", "-b", "feature"]);
  yield* fileSystem.writeFileString(path.join(frontend, "feature.ts"), "export {};\n");
  yield* commitAll(frontend, "frontend feature");
  yield* git(frontend, ["push", "-u", "origin", "feature"]);
  yield* fileSystem.writeFileString(path.join(frontend, ".env"), "API_KEY=frontend\n");

  const backend = path.join(source, "backend");
  yield* fileSystem.makeDirectory(backend);
  yield* git(backend, ["init", "-b", "main"]);
  yield* fileSystem.writeFileString(path.join(backend, "server.ts"), "export {};\n");
  yield* commitAll(backend, "backend");

  yield* fileSystem.makeDirectory(path.join(source, "node_modules"));
  yield* git(path.join(source, "node_modules"), ["init"]);

  return { base, source, rootRemote, frontendRemote };
});

it.layer(layerTest, { excludeTestServices: true })("NestedRepositories", (it) => {
  describe("describeNestedRepositories", () => {
    it.effect("lists real nested repositories with their remote and branch", () =>
      Effect.gen(function* () {
        const { source, frontendRemote } = yield* makeSource();
        const nested = yield* NestedRepositories.describeNestedRepositories(source);
        assert.deepStrictEqual(nested, [
          {
            relativePath: "backend",
            name: "backend",
            remoteUrl: null,
            branch: "main",
            branchPushed: false,
            unpushedCommits: 0,
          },
          {
            relativePath: "frontend",
            name: "frontend",
            remoteUrl: frontendRemote,
            branch: "feature",
            branchPushed: true,
            unpushedCommits: 0,
          },
        ]);
      }),
    );

    it.effect("adds each nested repository's ignored files to the root listing", () =>
      Effect.gen(function* () {
        const { source } = yield* makeSource();
        const entries = yield* WorkspaceEntries.WorkspaceEntries;
        const root = yield* entries.listIgnoredFiles({ cwd: source });
        const listed = yield* NestedRepositories.withNestedRepositoryFiles(source, root, (cwd) =>
          entries.listIgnoredFiles({ cwd }),
        );
        assert.deepStrictEqual(
          listed.files.map((file) => file.path),
          [".env"],
        );
        const frontend = listed.nestedRepositories?.find(
          (repository) => repository.relativePath === "frontend",
        );
        assert.deepStrictEqual(
          frontend?.files.map((file) => file.path),
          [".env"],
        );
      }),
    );
  });

  describe("project clone", () => {
    it.effect("recreates nested repositories at their branch and copies their .env", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { base, source, rootRemote } = yield* makeSource();
        const entries = yield* WorkspaceEntries.WorkspaceEntries;
        const listed = yield* NestedRepositories.withNestedRepositoryFiles(
          source,
          yield* entries.listIgnoredFiles({ cwd: source }),
          (cwd) => entries.listIgnoredFiles({ cwd }),
        );
        const nested = listed.nestedRepositories ?? [];

        const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
        const projectId = ProjectId.make("project-nested");
        const destinationPath = path.join(base, "target", "IndiaShipments");
        const finished = yield* tracker.stream.pipe(
          Stream.map((clones) => clones.find((clone) => clone.projectId === projectId)),
          Stream.filter((clone) => clone !== undefined && clone.phase !== "running"),
          Stream.take(1),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* tracker.start(
          {
            projectId,
            title: "IndiaShipments",
            createdAt: "2026-10-30T00:00:00.000Z",
            remoteUrl: rootRemote,
            destinationPath,
            nestedRepositories: nested.map(NestedRepositories.nestedCloneRequest),
          },
          { createProject: () => Effect.void, onCloned: () => Effect.void },
        );
        const clone = yield* Fiber.join(finished);
        const snapshot = yield* tracker.get(projectId);
        assert.isTrue(clone._tag === "Some");
        assert.strictEqual(snapshot?.error ?? null, null);
        assert.strictEqual(snapshot?.phase, "done");
        assert.deepStrictEqual(snapshot?.nestedRepositories, [
          {
            relativePath: "backend",
            branch: null,
            status: "skipped",
            detail: "It has no remote to clone from; copy it by hand.",
          },
          { relativePath: "frontend", branch: "feature", status: "cloned", detail: null },
        ]);

        const frontend = path.join(destinationPath, "frontend");
        assert.isTrue(yield* fileSystem.exists(path.join(destinationPath, "README.md")));
        assert.isTrue(yield* fileSystem.exists(path.join(frontend, "feature.ts")));
        assert.strictEqual(yield* git(frontend, ["symbolic-ref", "--short", "HEAD"]), "feature");
        assert.isFalse(yield* fileSystem.exists(path.join(destinationPath, "backend")));

        // The client relays ignored files the same way for the root and nested repositories.
        for (const repository of nested) {
          const landed = snapshot?.nestedRepositories?.find(
            (candidate) => candidate.relativePath === repository.relativePath,
          );
          if (landed?.status !== "cloned") continue;
          for (const file of repository.files) {
            const relativePath = `${repository.relativePath}/${file.path}`;
            yield* fileSystem.writeFileString(
              path.join(destinationPath, relativePath),
              yield* fileSystem.readFileString(path.join(source, relativePath)),
            );
          }
        }
        assert.strictEqual(
          yield* fileSystem.readFileString(path.join(frontend, ".env")),
          "API_KEY=frontend\n",
        );
        // The nested .env stays ignored on the target too.
        assert.strictEqual(yield* git(frontend, ["status", "--porcelain"]), "");
      }),
    );
  });

  describe("cloneNestedRepository", () => {
    it.effect("checks out the default branch with a warning when the branch is not pushed", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const { base, frontendRemote } = yield* makeSource();
        const repositories = yield* SourceControlRepositoryService.SourceControlRepositoryService;
        const root = path.join(base, "unpushed");
        yield* FileSystem.FileSystem.pipe(
          Effect.flatMap((fileSystem) => fileSystem.makeDirectory(root)),
        );
        const outcome = yield* NestedRepositories.cloneNestedRepository(repositories, root, {
          relativePath: "frontend",
          remoteUrl: frontendRemote,
          branch: "local-only",
          branchPushed: false,
        });
        assert.deepStrictEqual(outcome, {
          relativePath: "frontend",
          branch: null,
          status: "cloned",
          detail: "Branch local-only is not pushed, so the default branch was checked out.",
        });
        assert.strictEqual(
          yield* git(path.join(root, "frontend"), ["symbolic-ref", "--short", "HEAD"]),
          "main",
        );
      }),
    );

    it.effect("falls back to the default branch when the remote lacks the branch", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const { base, frontendRemote } = yield* makeSource();
        const repositories = yield* SourceControlRepositoryService.SourceControlRepositoryService;
        const root = path.join(base, "missing-branch");
        const outcome = yield* NestedRepositories.cloneNestedRepository(repositories, root, {
          relativePath: "web/frontend",
          remoteUrl: frontendRemote,
          branch: "gone",
        });
        assert.strictEqual(outcome.status, "cloned");
        assert.strictEqual(outcome.branch, null);
        assert.include(outcome.detail ?? "", "Branch gone is not on the remote");
      }),
    );

    it.effect("refuses a path that leaves the project", () =>
      Effect.gen(function* () {
        const repositories = yield* SourceControlRepositoryService.SourceControlRepositoryService;
        const outcome = yield* NestedRepositories.cloneNestedRepository(repositories, "/tmp/x", {
          relativePath: "../escape",
          remoteUrl: "https://example.com/repo.git",
          branch: "main",
        });
        assert.strictEqual(outcome.status, "failed");
      }),
    );
  });
});
