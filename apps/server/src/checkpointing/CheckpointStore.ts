import { isRootWorkspaceRepository, type CheckpointRef } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type { CheckpointStoreError } from "./Errors.ts";
import type { VcsCheckpointOps, VcsCheckpointRange } from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";
import { parseTurnDiffFilesFromNumstat, prefixNumstatPaths, prefixPatchPaths } from "./Diffs.ts";

export interface CaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  /** Capture only in repositories without the ref, keeping checkpoints already taken. */
  readonly missingOnly?: boolean;
  /** The checkpoint this one follows, so a turn that switched branches starts where it landed. */
  readonly previousCheckpointRef?: CheckpointRef;
  /** Folders below `cwd` (relative, `/`-separated) that have their own checkpoints. */
  readonly excludePaths?: ReadonlyArray<string>;
}

export type CheckpointRange = VcsCheckpointRange;

export interface CaptureHeadCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  /** A commit `resolveCleanHead` returned for this folder. */
  readonly head: string;
  /**
   * When the folder was seen clean, in epoch seconds, if that was earlier than now. Commits made
   * after a checkpoint count as the turn's own work, so a late snapshot must not postdate them.
   */
  readonly seenAt?: number;
}

export interface RestoreCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly fallbackToHead?: boolean;
  /** Folders below `cwd` the restore leaves as they are, as in a capture. */
  readonly excludePaths?: ReadonlyArray<string>;
}

export interface DiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly fallbackFromToHead?: boolean;
  readonly ignoreWhitespace: boolean;
  readonly format?: "patch" | "numstat";
  /** Maximum bytes collected from the diff command. */
  readonly maxOutputBytes?: number;
  /** Limits the diff to these exact paths. An empty list yields an empty diff. */
  readonly filePaths?: ReadonlyArray<string>;
  /** Folders below `cwd` left out of the diff, as in a capture. */
  readonly excludePaths?: ReadonlyArray<string>;
  /** The refs' range as their capture returned it; the refs are then not read. */
  readonly range?: VcsCheckpointRange;
}

export interface ListAuthoredPathsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  /** The refs' range as their capture returned it; the refs are then not read. */
  readonly range?: VcsCheckpointRange;
}

export interface DeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
}

/**
 * A multi-repo workspace folder (see `WorkspaceRepositories`) is checkpointed as
 * one unit: every operation fans out to each repository under the same ref, and
 * diffs report paths relative to the workspace folder. Restores check every
 * repository has the ref first, but are not atomic across repositories.
 */
export class CheckpointStore extends Context.Service<
  CheckpointStore,
  {
    /** Check whether cwd is inside a Git worktree or is a multi-repo workspace folder. */
    readonly isCheckpointable: (cwd: string) => Effect.Effect<boolean, CheckpointStoreError>;

    /** The range from `previousCheckpointRef`, or null when there is none to compare with. */
    readonly captureCheckpoint: (
      input: CaptureCheckpointInput,
    ) => Effect.Effect<VcsCheckpointRange | null, CheckpointStoreError>;

    /**
     * HEAD's commit when the folder matches it exactly: nothing staged, modified or untracked.
     * Null otherwise. One status, where a capture stages the whole worktree.
     */
    readonly resolveCleanHead: (cwd: string) => Effect.Effect<string | null, CheckpointStoreError>;

    /** Snapshots a folder that was clean at `head` from that commit, without reading its files. */
    readonly captureHeadCheckpoint: (
      input: CaptureHeadCheckpointInput,
    ) => Effect.Effect<void, CheckpointStoreError>;

    readonly hasCheckpointRef: (
      input: Omit<RestoreCheckpointInput, "fallbackToHead">,
    ) => Effect.Effect<boolean, CheckpointStoreError>;

    readonly restoreCheckpoint: (
      input: RestoreCheckpointInput,
    ) => Effect.Effect<boolean, CheckpointStoreError>;

    readonly diffCheckpoints: (
      input: DiffCheckpointsInput,
    ) => Effect.Effect<string, CheckpointStoreError>;

    /** Null means HEAD is unchanged or unrecorded; all changed paths then belong to the turn. */
    readonly listAuthoredPaths: (
      input: ListAuthoredPathsInput,
    ) => Effect.Effect<ReadonlySet<string> | null, CheckpointStoreError>;

    readonly deleteCheckpointRefs: (
      input: DeleteCheckpointRefsInput,
    ) => Effect.Effect<void, CheckpointStoreError>;
  }
>()("t3/checkpointing/CheckpointStore") {}

/** One repository a checkpoint operation runs in, and where its paths sit under the cwd. */
interface CheckpointTarget {
  readonly cwd: string;
  /** Null for the cwd's own repository, whose paths need no prefix. */
  readonly pathPrefix: string | null;
  /** Folders of the other repositories nested in this one, left out of its capture. */
  readonly excludePaths: ReadonlyArray<string>;
}

const isUnderAny = (filePath: string, folders: ReadonlyArray<string>) =>
  folders.some((folder) => filePath.startsWith(`${folder}/`));

const MULTI_REPO_CONCURRENCY = 4;

/** @public */
export const make = Effect.gen(function* () {
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const workspaceRepositories = yield* WorkspaceRepositories.WorkspaceRepositories;
  const path = yield* Path.Path;

  const resolveCheckpoints = Effect.fn("CheckpointStore.resolveCheckpoints")(function* (
    cwd: string,
  ) {
    const handle = yield* vcsRegistry.resolve({ cwd });
    return handle.driver.checkpoints satisfies VcsCheckpointOps;
  });

  // The registry reads an unreadable repository as none; ask Git again so that fails here.
  const isGitRepository = Effect.fn("CheckpointStore.isGitRepository")(function* (cwd: string) {
    if ((yield* vcsRegistry.detect({ cwd, requestedKind: "git" })) !== null) return true;
    const git = yield* vcsRegistry.get("git");
    return (yield* git.detectRepository(cwd)) !== null;
  });

  // A plain repository, or a cwd that is no repository and holds none, stays a single target,
  // so its operations behave the way they always have.
  // Fork: `excluded` folders have checkpoints of their own, so repositories inside them are skipped.
  const resolveTargets = Effect.fn("CheckpointStore.resolveTargets")(function* (
    cwd: string,
    excluded: ReadonlyArray<string> = [],
  ) {
    const repositories = (yield* workspaceRepositories.list(cwd)).filter(
      (repository) =>
        isRootWorkspaceRepository(repository) ||
        !excluded.some(
          (folder) =>
            repository.relativePath === folder || repository.relativePath.startsWith(`${folder}/`),
        ),
    );
    if (repositories.length === 0) {
      return [{ cwd, pathPrefix: null, excludePaths: excluded }] satisfies Array<CheckpointTarget>;
    }
    const nested = repositories
      .filter((repository) => !isRootWorkspaceRepository(repository))
      .map((repository) => repository.relativePath);
    return repositories.map((repository): CheckpointTarget =>
      isRootWorkspaceRepository(repository)
        ? { cwd, pathPrefix: null, excludePaths: [...nested, ...excluded] }
        : {
            cwd: path.join(cwd, ...repository.relativePath.split("/")),
            pathPrefix: repository.relativePath,
            excludePaths: excluded.flatMap((folder) =>
              folder.startsWith(`${repository.relativePath}/`)
                ? [folder.slice(repository.relativePath.length + 1)]
                : [],
            ),
          },
    );
  });

  const forEachTarget = <A, E, R>(
    targets: ReadonlyArray<CheckpointTarget>,
    run: (target: CheckpointTarget) => Effect.Effect<A, E, R>,
  ) => Effect.forEach(targets, run, { concurrency: MULTI_REPO_CONCURRENCY });

  const isCheckpointable: CheckpointStore["Service"]["isCheckpointable"] = Effect.fn(
    "isCheckpointable",
  )(function* (cwd) {
    if (yield* isGitRepository(cwd)) return true;
    return (yield* workspaceRepositories.list(cwd)).length > 0;
  });

  const hasRefIn = (target: CheckpointTarget, checkpointRef: CheckpointRef) =>
    resolveCheckpoints(target.cwd).pipe(
      Effect.flatMap((checkpoints) =>
        checkpoints.hasCheckpointRef({ cwd: target.cwd, checkpointRef }),
      ),
    );

  const captureCheckpoint: CheckpointStore["Service"]["captureCheckpoint"] = Effect.fn(
    "captureCheckpoint",
  )(function* (input) {
    const targets = yield* resolveTargets(input.cwd, input.excludePaths);
    const ranges = yield* forEachTarget(targets, (target) =>
      Effect.gen(function* () {
        if (input.missingOnly && (yield* hasRefIn(target, input.checkpointRef))) return null;
        const checkpoints = yield* resolveCheckpoints(target.cwd);
        return yield* checkpoints.captureCheckpoint({
          cwd: target.cwd,
          checkpointRef: input.checkpointRef,
          ...(target.excludePaths.length > 0 ? { excludePaths: target.excludePaths } : {}),
          ...(input.previousCheckpointRef === undefined
            ? {}
            : { previousCheckpointRef: input.previousCheckpointRef }),
        });
      }),
    );
    // One range describes one repository, so a multi-repo capture reports none.
    return targets.length === 1 && targets[0]!.pathPrefix === null ? (ranges[0] ?? null) : null;
  });

  const resolveCleanHead: CheckpointStore["Service"]["resolveCleanHead"] = Effect.fn(
    "CheckpointStore.resolveCleanHead",
  )(function* (cwd) {
    const checkpoints = yield* resolveCheckpoints(cwd);
    return yield* checkpoints.resolveCleanHead(cwd);
  });

  const captureHeadCheckpoint: CheckpointStore["Service"]["captureHeadCheckpoint"] = Effect.fn(
    "CheckpointStore.captureHeadCheckpoint",
  )(function* (input) {
    const checkpoints = yield* resolveCheckpoints(input.cwd);
    return yield* checkpoints.captureHeadCheckpoint(input);
  });

  const hasCheckpointRef: CheckpointStore["Service"]["hasCheckpointRef"] = Effect.fn(
    "hasCheckpointRef",
  )(function* (input) {
    const found = yield* forEachTarget(
      yield* resolveTargets(input.cwd, input.excludePaths),
      (target) => hasRefIn(target, input.checkpointRef),
    );
    return found.every(Boolean);
  });

  const restoreCheckpoint: CheckpointStore["Service"]["restoreCheckpoint"] = Effect.fn(
    "restoreCheckpoint",
  )(function* (input) {
    let targets = yield* resolveTargets(input.cwd, input.excludePaths);
    // Refuse up front rather than restore some repositories and then find one without the ref.
    if (targets.length > 1 && input.fallbackToHead !== true) {
      const found = yield* forEachTarget(targets, (target) =>
        hasRefIn(target, input.checkpointRef),
      );
      if (!found.every(Boolean)) {
        // A root repository's checkpoint from before its nested repositories were captured
        // restores the root alone, as it did then.
        const rootIndex = targets.findIndex((target) => target.pathPrefix === null);
        const onlyRootHasRef =
          rootIndex !== -1 && found.every((hasRef, index) => hasRef === (index === rootIndex));
        if (!onlyRootHasRef) return false;
        targets = [targets[rootIndex]!];
      }
    }
    // One at a time, so a failure can name the repositories that were already restored.
    const restored = yield* Effect.forEach(targets, (target, index) =>
      resolveCheckpoints(target.cwd).pipe(
        Effect.flatMap((checkpoints) =>
          checkpoints.restoreCheckpoint({
            ...input,
            cwd: target.cwd,
            excludePaths: target.excludePaths,
          }),
        ),
        Effect.tapError(() =>
          index === 0
            ? Effect.void
            : Effect.logWarning("Checkpoint restore failed after restoring other repositories", {
                failed: target.cwd,
                restored: targets.slice(0, index).map((done) => done.cwd),
              }),
        ),
      ),
    );
    return restored.every(Boolean);
  });

  const diffCheckpoints: CheckpointStore["Service"]["diffCheckpoints"] = Effect.fn(
    "diffCheckpoints",
  )(function* (input) {
    const targets = yield* resolveTargets(input.cwd, input.excludePaths);
    const { range: _range, ...perRepositoryInput } = input;
    const diffs = yield* forEachTarget(targets, (target) =>
      Effect.gen(function* () {
        const checkpoints = yield* resolveCheckpoints(target.cwd);
        if (target.pathPrefix === null) {
          return yield* checkpoints.diffCheckpoints({
            ...(targets.length === 1 ? input : perRepositoryInput),
            cwd: target.cwd,
            ...(input.filePaths && target.excludePaths.length > 0
              ? {
                  filePaths: input.filePaths.filter(
                    (filePath) => !isUnderAny(filePath, target.excludePaths),
                  ),
                }
              : {}),
          });
        }
        // A repository added to the workspace after either checkpoint has nothing to compare.
        const comparable =
          (yield* checkpoints.hasCheckpointRef({
            cwd: target.cwd,
            checkpointRef: input.toCheckpointRef,
          })) &&
          (input.fallbackFromToHead === true ||
            (yield* checkpoints.hasCheckpointRef({
              cwd: target.cwd,
              checkpointRef: input.fromCheckpointRef,
            })));
        if (!comparable) return "";
        // Requested paths are relative to the workspace folder.
        const repositoryPrefix = `${target.pathPrefix}/`;
        const diff = yield* checkpoints.diffCheckpoints({
          ...perRepositoryInput,
          cwd: target.cwd,
          excludePaths: target.excludePaths,
          ...(input.filePaths
            ? {
                filePaths: input.filePaths.flatMap((filePath) =>
                  filePath.startsWith(repositoryPrefix)
                    ? [filePath.slice(repositoryPrefix.length)]
                    : [],
                ),
              }
            : {}),
        });
        return input.format === "numstat"
          ? prefixNumstatPaths(diff, target.pathPrefix)
          : prefixPatchPaths(diff, target.pathPrefix);
      }),
    );
    return diffs.join("");
  });

  const listAuthoredPaths: CheckpointStore["Service"]["listAuthoredPaths"] = Effect.fn(
    "listAuthoredPaths",
  )(function* (input) {
    const targets = yield* resolveTargets(input.cwd);
    if (targets.length === 1 && targets[0]!.pathPrefix === null) {
      const checkpoints = yield* resolveCheckpoints(input.cwd);
      return yield* checkpoints.listAuthoredPaths(input);
    }
    const { range: _range, ...perRepositoryInput } = input;
    const perRepository = yield* forEachTarget(targets, (target) =>
      Effect.gen(function* () {
        const checkpoints = yield* resolveCheckpoints(target.cwd);
        // A repository without both checkpoints has no diff, so nothing of it is listed.
        const comparable =
          (yield* checkpoints.hasCheckpointRef({
            cwd: target.cwd,
            checkpointRef: input.fromCheckpointRef,
          })) &&
          (yield* checkpoints.hasCheckpointRef({
            cwd: target.cwd,
            checkpointRef: input.toCheckpointRef,
          }));
        if (!comparable) return { target, paths: new Set<string>() };
        return {
          target,
          paths: yield* checkpoints.listAuthoredPaths({ ...perRepositoryInput, cwd: target.cwd }),
        };
      }),
    );
    if (perRepository.every(({ paths }) => paths === null)) return null;
    // The result is one set for the workspace, so a repository whose HEAD did not move lists
    // every path it changed.
    const authored = new Set<string>();
    for (const { target, paths } of perRepository) {
      let repositoryPaths: Iterable<string> | null = paths;
      if (repositoryPaths === null) {
        const numstat = yield* resolveCheckpoints(target.cwd).pipe(
          Effect.flatMap((checkpoints) =>
            checkpoints.diffCheckpoints({
              ...perRepositoryInput,
              cwd: target.cwd,
              ignoreWhitespace: false,
              format: "numstat",
            }),
          ),
        );
        repositoryPaths = parseTurnDiffFilesFromNumstat(numstat).flatMap((file) =>
          file.previousPath === undefined ? [file.path] : [file.path, file.previousPath],
        );
      }
      for (const repositoryPath of repositoryPaths) {
        authored.add(
          target.pathPrefix === null ? repositoryPath : `${target.pathPrefix}/${repositoryPath}`,
        );
      }
    }
    return authored;
  });

  const deleteCheckpointRefs: CheckpointStore["Service"]["deleteCheckpointRefs"] = Effect.fn(
    "deleteCheckpointRefs",
  )(function* (input) {
    yield* forEachTarget(yield* resolveTargets(input.cwd), (target) =>
      resolveCheckpoints(target.cwd).pipe(
        Effect.flatMap((checkpoints) =>
          checkpoints.deleteCheckpointRefs({ ...input, cwd: target.cwd }),
        ),
      ),
    );
  });

  return CheckpointStore.of({
    isCheckpointable,
    captureCheckpoint,
    resolveCleanHead,
    captureHeadCheckpoint,
    hasCheckpointRef,
    restoreCheckpoint,
    diffCheckpoints,
    listAuthoredPaths,
    deleteCheckpointRefs,
  });
});

export const layer = Layer.effect(CheckpointStore, make).pipe(
  Layer.provide(WorkspaceRepositories.layer),
);
