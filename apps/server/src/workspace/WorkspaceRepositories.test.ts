import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as WorkspaceRepositories from "./WorkspaceRepositories.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(WorkspaceRepositories.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeWorkspace = Effect.fn("makeWorkspace")(function* (
  entries: Record<string, string | "repo" | "worktree" | "dir">,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-workspace-repos-" });
  for (const [relativePath, kind] of Object.entries(entries)) {
    const target = path.join(root, relativePath);
    if (kind === "repo") {
      yield* fileSystem.makeDirectory(path.join(target, ".git"), { recursive: true });
    } else if (kind === "worktree") {
      yield* fileSystem.makeDirectory(target, { recursive: true });
      yield* fileSystem.writeFileString(path.join(target, ".git"), "gitdir: /elsewhere\n");
    } else if (kind === "dir") {
      yield* fileSystem.makeDirectory(target, { recursive: true });
    } else {
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
      yield* fileSystem.writeFileString(target, kind);
    }
  }
  return root;
});

const list = (cwd: string) =>
  Effect.flatMap(WorkspaceRepositories.WorkspaceRepositories, (service) => service.list(cwd));

it.layer(layerTest)("WorkspaceRepositories", (it) => {
  describe("list", () => {
    it.effect("finds child clones and worktrees in name order", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace({
          web: "repo",
          api: "worktree",
          shared: "dir",
          ".cache": "repo",
          "notes.md": "notes",
        });

        expect(yield* list(root)).toEqual([
          { relativePath: "api", name: "api" },
          { relativePath: "web", name: "web" },
        ]);
      }),
    );

    it.effect("is empty for a folder inside a repository", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeWorkspace({ ".git/HEAD": "ref", "packages/app": "repo" });

        expect(yield* list(root)).toEqual([]);
        expect(yield* list(path.join(root, "packages"))).toEqual([]);
      }),
    );

    it.effect("lists a repository root first when it holds child clones", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeWorkspace({
          ".git/HEAD": "ref",
          ".gitignore": "frontend/\nbackend/\n",
          frontend: "repo",
          backend: "repo",
          docs: "dir",
        });

        expect(yield* list(root)).toEqual([
          { relativePath: ".", name: path.basename(root) },
          { relativePath: "backend", name: "backend" },
          { relativePath: "frontend", name: "frontend" },
        ]);
        // Inside a child clone, only that clone's own layout counts.
        expect(yield* list(path.join(root, "frontend"))).toEqual([]);
      }),
    );

    it.effect("keeps a repository root's submodules part of the root", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace({
          ".git/HEAD": "ref",
          ".gitmodules": '[submodule "vendor"]\n\tpath = vendor\n\turl = ../vendor.git\n',
          vendor: "worktree",
        });

        expect(yield* list(root)).toEqual([]);
      }),
    );

    it.effect("lets a repository root's workspace file choose its child repositories", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeWorkspace({
          ".git/HEAD": "ref",
          web: "repo",
          scratch: "repo",
          "app.code-workspace": JSON.stringify({
            folders: [{ path: "." }, { path: "web", name: "Web" }],
          }),
        });

        expect(yield* list(root)).toEqual([
          { relativePath: ".", name: path.basename(root) },
          { relativePath: "web", name: "Web" },
        ]);
      }),
    );

    it.effect("lets a workspace file choose the repositories and their names", () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace({
          app: "repo",
          server: "repo",
          tools: "repo",
          "..api": "repo",
          shared: "dir",
          "services/billing": "repo",
          "team.code-workspace": `{
            // JSONC, like VS Code writes it
            "folders": [
              { "path": "app", "name": "App" },
              { "path": "./server" },
              { "path": "shared" },
              { "path": "services/billing" },
              { "path": "../outside" },
              { "path": "..api" },
              { "path": "missing" },
              { "path": "app" },
            ],
          }`,
        });

        expect(yield* list(root)).toEqual([
          { relativePath: "app", name: "App" },
          { relativePath: "server", name: "server" },
          { relativePath: "services/billing", name: "billing" },
          { relativePath: "..api", name: "..api" },
        ]);
        const service = yield* WorkspaceRepositories.WorkspaceRepositories;
        expect((yield* service.describe(root)).listedFolders).toEqual([
          "app",
          "server",
          "shared",
          "services/billing",
          "..api",
          "missing",
        ]);
      }),
    );

    it.effect(
      "falls back to child repositories when the workspace file is ambiguous or broken",
      () =>
        Effect.gen(function* () {
          const ambiguous = yield* makeWorkspace({
            web: "repo",
            "a.code-workspace": `{ "folders": [] }`,
            "b.code-workspace": `{ "folders": [] }`,
          });
          const broken = yield* makeWorkspace({ web: "repo", "a.code-workspace": "{ not json" });

          expect(yield* list(ambiguous)).toEqual([{ relativePath: "web", name: "web" }]);
          expect(yield* list(broken)).toEqual([{ relativePath: "web", name: "web" }]);
        }),
    );

    it.effect("skips repositories that symlink out of the folder", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const outside = yield* makeWorkspace({ api: "repo" });
        const root = yield* makeWorkspace({ web: "repo" });
        yield* fileSystem.symlink(path.join(outside, "api"), path.join(root, "api"));

        expect(yield* list(root)).toEqual([{ relativePath: "web", name: "web" }]);
      }),
    );

    it.effect("is empty for a missing folder", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeWorkspace({});

        expect(yield* list(path.join(root, "gone"))).toEqual([]);
      }),
    );
  });
});
