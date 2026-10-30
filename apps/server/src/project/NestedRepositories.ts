/**
 * Fork: git repositories nested in a project (child checkouts its root does not track) and how
 * a clone recreates them. Discovery reuses WorkspaceRepositories, minus dot, build and
 * dependency folders and linked worktrees.
 */
import {
  type ProjectCloneNestedRepository,
  type ProjectCloneNestedRepositoryInput,
  type ProjectListIgnoredFilesResult,
  ROOT_WORKSPACE_REPOSITORY_PATH,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { GitCloneProgressLine } from "./gitCloneProgress.ts";
import type * as SourceControlRepositoryService from "../sourceControl/SourceControlRepositoryService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";

export interface NestedRepositoryDescription {
  readonly relativePath: string;
  readonly name: string;
  readonly remoteUrl: string | null;
  readonly branch: string | null;
  readonly branchPushed: boolean;
  readonly unpushedCommits: number;
}

// Dependency and build output folders can carry a stray `.git`; they are never project repos.
const SKIPPED_FOLDER_NAMES = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
]);

// A linked worktree's `.git` file points into another repository's `.git/worktrees/`.
const LINKED_WORKTREE_GITDIR = /^gitdir:.*[\\/]worktrees[\\/]/m;

/**
 * Repositories nested in `cwd` when `cwd` is itself a repository root; empty otherwise.
 * Never fails: an unreadable repository is described with what could be read.
 */
export const describeNestedRepositories = Effect.fn("NestedRepositories.describe")(function* (
  cwd: string,
) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspaceRepositories = yield* WorkspaceRepositories.WorkspaceRepositories;
  const repositories = yield* workspaceRepositories.list(cwd);
  // Only a repository root clones its nested repositories along with itself.
  if (
    !repositories.some((repository) => repository.relativePath === ROOT_WORKSPACE_REPOSITORY_PATH)
  )
    return [];

  const run = (repositoryPath: string, args: ReadonlyArray<string>) =>
    git
      .execute({
        operation: "NestedRepositories.describe",
        cwd: repositoryPath,
        args,
        allowNonZeroExit: true,
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : null)),
        Effect.orElseSucceed(() => null),
      );

  const describeOne = Effect.fn("NestedRepositories.describeOne")(function* (
    relativePath: string,
    name: string,
  ) {
    const repositoryPath = path.join(cwd, ...relativePath.split("/"));
    const branch =
      (yield* run(repositoryPath, ["symbolic-ref", "--quiet", "--short", "HEAD"])) || null;
    const remotes = ((yield* run(repositoryPath, ["remote"])) ?? "")
      .split("\n")
      .map((remote) => remote.trim())
      .filter((remote) => remote.length > 0);
    const upstreamRemote = branch
      ? yield* run(repositoryPath, ["config", "--get", `branch.${branch}.remote`])
      : null;
    const remoteName =
      (upstreamRemote && remotes.includes(upstreamRemote) ? upstreamRemote : null) ??
      (remotes.includes("origin") ? "origin" : (remotes[0] ?? null));
    const remoteUrl = remoteName
      ? (yield* run(repositoryPath, ["remote", "get-url", remoteName])) || null
      : null;
    const remoteRef = remoteName && branch ? `refs/remotes/${remoteName}/${branch}` : null;
    const branchPushed =
      remoteRef !== null &&
      (yield* run(repositoryPath, ["rev-parse", "--verify", "--quiet", remoteRef])) !== null;
    const unpushed =
      branchPushed && remoteRef
        ? yield* run(repositoryPath, ["rev-list", "--count", `${remoteRef}..HEAD`])
        : null;
    const unpushedCommits = Number.parseInt(unpushed ?? "0", 10);
    return {
      relativePath,
      name,
      remoteUrl,
      branch,
      branchPushed,
      unpushedCommits: Number.isFinite(unpushedCommits) ? unpushedCommits : 0,
    } satisfies NestedRepositoryDescription;
  });

  const isLinkedWorktree = (relativePath: string) =>
    fileSystem.readFileString(path.join(cwd, ...relativePath.split("/"), ".git")).pipe(
      Effect.map((text) => LINKED_WORKTREE_GITDIR.test(text)),
      // A `.git` directory (a real clone) cannot be read as a file.
      Effect.orElseSucceed(() => false),
    );

  const nested: Array<NestedRepositoryDescription> = [];
  for (const repository of repositories) {
    if (repository.relativePath === ROOT_WORKSPACE_REPOSITORY_PATH) continue;
    const segments = repository.relativePath.split("/");
    if (segments.some((segment) => segment.startsWith(".") || SKIPPED_FOLDER_NAMES.has(segment)))
      continue;
    if (yield* isLinkedWorktree(repository.relativePath)) continue;
    nested.push(yield* describeOne(repository.relativePath, repository.name));
  }
  return nested;
});

/** The request a source description becomes, so the target can clone it. */
export function nestedCloneRequest(
  description: NestedRepositoryDescription,
): ProjectCloneNestedRepositoryInput {
  return {
    relativePath: description.relativePath,
    remoteUrl: description.remoteUrl,
    branch: description.branch,
    branchPushed: description.branchPushed,
    unpushedCommits: description.unpushedCommits,
  };
}

export function pendingNestedRepositories(
  requests: ReadonlyArray<ProjectCloneNestedRepositoryInput>,
): ReadonlyArray<ProjectCloneNestedRepository> {
  return requests.map((request) => ({
    relativePath: request.relativePath,
    branch: request.branch,
    status: "pending",
    detail: null,
  }));
}

/** Null when the path stays strictly inside the root; otherwise why it is refused. */
function unsafeRelativePath(relativePath: string): string | null {
  const segments = relativePath.split(/[\\/]/);
  if (
    relativePath.startsWith("/") ||
    /^[a-z]:/i.test(relativePath) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return "Its path is not a folder inside the project.";
  }
  return null;
}

function joinUnder(root: string, relativePath: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relativePath.split(/[\\/]/).join(separator)}`;
}

const MISSING_REMOTE_BRANCH = /remote branch .* not found/i;

/**
 * Clones one nested repository below `root` at the source's branch. Never fails: a repository
 * that cannot be cloned is reported as skipped or failed so the rest of the clone carries on.
 */
export const cloneNestedRepository = Effect.fn("NestedRepositories.clone")(function* (
  repositories: SourceControlRepositoryService.SourceControlRepositoryService["Service"],
  root: string,
  request: ProjectCloneNestedRepositoryInput,
  options?: {
    readonly onProgress?: (line: GitCloneProgressLine) => Effect.Effect<void>;
    readonly timeoutMs?: number | null;
  },
) {
  const outcome = (
    status: ProjectCloneNestedRepository["status"],
    branch: string | null,
    detail: string | null,
  ): ProjectCloneNestedRepository => ({
    relativePath: request.relativePath,
    branch,
    status,
    detail,
  });
  const unsafe = unsafeRelativePath(request.relativePath);
  if (unsafe !== null) return outcome("failed", null, unsafe);
  if (request.remoteUrl === null) {
    return outcome("skipped", null, "It has no remote to clone from; copy it by hand.");
  }

  const destinationPath = joinUnder(root, request.relativePath);
  const warnings: Array<string> = [];
  let branch = request.branch;
  if (branch === null) {
    warnings.push("The source is not on a branch, so the default branch was checked out.");
  } else if (request.branchPushed === false) {
    warnings.push(`Branch ${branch} is not pushed, so the default branch was checked out.`);
    branch = null;
  }
  const clone = (cloneBranch: string | null) =>
    repositories.cloneRepository(
      { remoteUrl: request.remoteUrl!, destinationPath },
      {
        branch: cloneBranch,
        ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      },
    );

  const attempt = yield* clone(branch).pipe(Effect.result);
  let cloned = attempt._tag === "Success";
  let failure = attempt._tag === "Failure" ? attempt.failure.detail : null;
  if (!cloned && branch !== null && failure !== null && MISSING_REMOTE_BRANCH.test(failure)) {
    // The remote lacks the branch even though the source has a copy of it; fall back.
    yield* repositories.discardClone(destinationPath).pipe(Effect.ignore);
    const retried = yield* clone(null).pipe(Effect.result);
    cloned = retried._tag === "Success";
    failure = retried._tag === "Failure" ? retried.failure.detail : null;
    if (cloned) {
      warnings.push(
        `Branch ${branch} is not on the remote, so the default branch was checked out.`,
      );
      branch = null;
    }
  }
  if (!cloned) {
    // Leave nothing half-written; a later retry clones into an empty folder again.
    yield* repositories.discardClone(destinationPath).pipe(Effect.ignore);
    return outcome("failed", null, failure ?? "The repository could not be cloned.");
  }
  if (branch !== null && (request.unpushedCommits ?? 0) > 0) {
    const count = request.unpushedCommits!;
    warnings.push(
      `${count} local ${count === 1 ? "commit is" : "commits are"} not pushed, so ${count === 1 ? "it was" : "they were"} not copied.`,
    );
  }
  return outcome("cloned", branch, warnings.length > 0 ? warnings.join(" ") : null);
});

/**
 * Adds the nested repositories of `cwd`, each with its own ignored files, to the root's
 * ignored-file listing. Discovery failures leave the root listing as it was.
 */
export const withNestedRepositoryFiles = Effect.fn("NestedRepositories.withFiles")(function* <E>(
  cwd: string,
  root: ProjectListIgnoredFilesResult,
  listIgnoredFiles: (cwd: string) => Effect.Effect<ProjectListIgnoredFilesResult, E>,
) {
  const path = yield* Path.Path;
  const nested = yield* describeNestedRepositories(cwd).pipe(
    Effect.provide(WorkspaceRepositories.layer),
    Effect.orElseSucceed((): ReadonlyArray<NestedRepositoryDescription> => []),
  );
  if (nested.length === 0) return root;
  const nestedRepositories = yield* Effect.forEach(nested, (repository) =>
    listIgnoredFiles(path.join(cwd, ...repository.relativePath.split("/"))).pipe(
      Effect.orElseSucceed(() => ({ files: [], truncated: false })),
      Effect.map((listed) => ({ ...repository, files: listed.files, truncated: listed.truncated })),
    ),
  );
  return { ...root, nestedRepositories } satisfies ProjectListIgnoredFilesResult;
});
