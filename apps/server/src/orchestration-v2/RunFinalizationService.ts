import {
  CheckpointScopeId,
  isRootWorkspaceRepository,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { joinWorkspaceRepositoryPath } from "@t3tools/shared/path";

import * as ProjectEnrichment from "../project/ProjectEnrichmentService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";
import * as CheckpointCapture from "./CheckpointCaptureService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export class RunFinalizationError extends Schema.TaggedError<RunFinalizationError>()(
  "RunFinalizationError",
  {
    threadId: ThreadId,
    runId: RunId,
    scopeId: CheckpointScopeId,
    operation: Schema.Literals(["capture-checkpoint", "refresh-workspace"]),
    cause: Schema.Defect(),
  },
) {}

export class RunFinalizationRefreshError extends Schema.TaggedError<RunFinalizationRefreshError>()(
  "RunFinalizationRefreshError",
  { cwd: Schema.String, cause: Schema.Defect() },
) {}

export class RunFinalizationObserver extends Context.Reference<{
  readonly refreshAfterTurn: (projectId: ProjectId) => Effect.Effect<void>;
  readonly refresh: (input: {
    readonly cwd: string;
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) => Effect.Effect<void, RunFinalizationRefreshError>;
}>("t3/orchestration-v2/RunFinalizationObserver", {
  defaultValue: () => ({ refresh: () => Effect.void, refreshAfterTurn: () => Effect.void }),
}) {}

export class RunFinalizationService extends Context.Service<
  RunFinalizationService,
  {
    readonly finalize: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly scopeId: CheckpointScopeId;
    }) => Effect.Effect<void, RunFinalizationError>;
  }
>()("t3/orchestration-v2/RunFinalizationService") {}

const make = Effect.gen(function* () {
  const checkpointCapture = yield* CheckpointCapture.CheckpointCaptureServiceV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const observer = yield* RunFinalizationObserver;

  const finalize: RunFinalizationService["Service"]["finalize"] = Effect.fn(
    "RunFinalizationService.finalize",
  )(function* (input) {
    yield* checkpointCapture
      .execute(input)
      .pipe(
        Effect.mapError(
          (cause) => new RunFinalizationError({ ...input, operation: "capture-checkpoint", cause }),
        ),
      );
    const projection = yield* projections
      .getCheckpointContext(input.threadId)
      .pipe(
        Effect.mapError(
          (cause) => new RunFinalizationError({ ...input, operation: "refresh-workspace", cause }),
        ),
      );
    const cwd = projection.checkpointScopes.find((scope) => scope.id === input.scopeId)?.cwd;
    if (cwd !== undefined) {
      // Retrying a display refresh after the checkpoint is durable blocks the next turn.
      yield* observer.refresh({ cwd, threadId: input.threadId, runId: input.runId }).pipe(
        Effect.catchTags({
          RunFinalizationRefreshError: (cause) =>
            Effect.logWarning("Failed to refresh workspace after checkpoint capture", {
              ...input,
              cause,
            }),
        }),
      );
    }
  });
  return RunFinalizationService.of({ finalize });
});

export const layer = Layer.effect(RunFinalizationService, make);

export const layerObserver = Layer.effect(
  RunFinalizationObserver,
  Effect.gen(function* () {
    const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
    const vcsStatus = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const pullRequests = yield* PullRequestService.PullRequestService;
    const workspaceRepositories = yield* WorkspaceRepositories.WorkspaceRepositories;
    const projects = yield* ProjectService.ProjectService;
    const enrichment = yield* ProjectEnrichment.ProjectEnrichmentService;
    const pullRequestLookups = yield* FiberMap.make<string>();
    const refreshStatus = Effect.fn("RunFinalizationService.refreshStatus")(function* (input: {
      readonly cwd: string;
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly isWorkspaceRepository: boolean;
    }) {
      const local = yield* vcsStatus.refreshLocalStatus(input.cwd);
      if (local.refName === null || local.isDefaultRef) return;
      const thread = yield* projections.getThreadShell(input.threadId);
      if (!thread) return;
      // Repositories in a multi-repo project folder keep their own branches, so only a
      // single repository or an isolated run has a thread branch to match.
      const inProjectFolder = input.isWorkspaceRepository && thread.worktreePath === null;
      if (!inProjectFolder && thread.branch !== local.refName) return;
      if (thread.activeRunId !== null && thread.activeRunId !== input.runId) return;
      // The forge CLI can take minutes, so the next turn must not wait for it. A newer
      // turn's lookup replaces a running one instead of queueing behind the cwd's lock.
      yield* vcsStatus.refreshPullRequestStatus(input.cwd).pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to refresh pull request status after run completion", {
            threadId: input.threadId,
            cwd: input.cwd,
            detail: error.message,
          }),
        ),
        FiberMap.run(pullRequestLookups, input.cwd),
      );
    });
    const identityRefreshes = yield* FiberMap.make<ProjectId>();
    // A turn can add the first remote (`git remote add`, `gh repo create --push`), which the
    // enrichment and resolver caches would otherwise keep reporting as missing for a minute.
    const refreshMissingRepositoryIdentity = Effect.fn(
      "RunFinalizationService.refreshMissingRepositoryIdentity",
    )(
      function* (projectId: ProjectId) {
        const project = yield* projects.getById(projectId);
        if (Option.isNone(project)) return;
        const { workspaceRoot } = project.value;
        if ((yield* enrichment.readRepositoryIdentity(workspaceRoot)) !== null) return;
        yield* enrichment.refreshRepositoryIdentity(workspaceRoot);
      },
      (effect, projectId) =>
        effect.pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to refresh repository identity after run completion", {
              projectId,
              detail: error.message,
            }),
          ),
        ),
    );
    return {
      refreshAfterTurn: pullRequests.refreshAfterTurn,
      refresh: Effect.fn("RunFinalizationService.refresh")(
        function* ({ cwd, threadId, runId }) {
          const thread = yield* projections.getThreadShell(threadId);
          if (thread) {
            // Forge discovery probes can take seconds; like the PR lookup, the next turn must not wait.
            yield* refreshMissingRepositoryIdentity(thread.projectId).pipe(
              FiberMap.run(identityRefreshes, thread.projectId),
            );
          }
          // A multi-repo workspace folder is not a repository; its repositories hold the status.
          // A root repository among them is the thread's own checkout, so it keeps the branch match.
          const repositories = yield* workspaceRepositories.list(cwd);
          const statusTargets =
            repositories.length === 0
              ? [{ cwd, isWorkspaceRepository: false }]
              : repositories.map((repository) => ({
                  cwd: joinWorkspaceRepositoryPath(cwd, repository.relativePath),
                  isWorkspaceRepository: !isRootWorkspaceRepository(repository),
                }));
          yield* Effect.all(
            [
              workspaceEntries.refresh(cwd),
              Effect.forEach(
                statusTargets,
                (target) => refreshStatus({ ...target, threadId, runId }),
                { concurrency: "unbounded", discard: true },
              ),
            ],
            { concurrency: "unbounded", discard: true },
          );
        },
        (effect, { cwd }) =>
          effect.pipe(Effect.mapError((cause) => new RunFinalizationRefreshError({ cwd, cause }))),
      ),
    };
  }),
);
