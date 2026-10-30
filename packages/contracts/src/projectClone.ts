import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  SourceControlCloneProtocol,
  SourceControlProviderKind,
  SourceControlRepositoryInfo,
} from "./sourceControl.ts";

export const PROJECT_CLONE_DETAIL_MAX_LENGTH = 200;
export const PROJECT_CLONE_ERROR_MAX_LENGTH = 1000;

export const ProjectCloneStage = Schema.Literals([
  "connecting",
  "counting",
  "receiving",
  "resolving",
  "checkout",
]);
export type ProjectCloneStage = typeof ProjectCloneStage.Type;

export const ProjectClonePhase = Schema.Literals(["running", "done", "failed", "cancelled"]);
export type ProjectClonePhase = typeof ProjectClonePhase.Type;

// Fork: a clone also recreates the git repositories nested inside the source
// project (for example a root repo that ignores its frontend/ and backend/ clones).
export const ProjectCloneNestedRepositoryInput = Schema.Struct({
  /** Path below the cloned repository's root, using `/` separators. */
  relativePath: TrimmedNonEmptyString,
  remoteUrl: Schema.NullOr(TrimmedNonEmptyString),
  /** The branch checked out on the source; null when it is detached. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
  /** False when the source branch has no copy on the remote yet. */
  branchPushed: Schema.optionalKey(Schema.Boolean),
  /** Source commits the remote branch does not have; they cannot come along. */
  unpushedCommits: Schema.optionalKey(NonNegativeInt),
});
export type ProjectCloneNestedRepositoryInput = typeof ProjectCloneNestedRepositoryInput.Type;

export const ProjectCloneNestedRepositoryStatus = Schema.Literals([
  "pending",
  "cloning",
  "cloned",
  "skipped",
  "failed",
]);
export type ProjectCloneNestedRepositoryStatus = typeof ProjectCloneNestedRepositoryStatus.Type;

export const ProjectCloneNestedRepository = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  /** The branch checked out on the target; null means the remote's default branch. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
  status: ProjectCloneNestedRepositoryStatus,
  /** Why it was skipped or failed, or a warning about a clone that did land. */
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(PROJECT_CLONE_ERROR_MAX_LENGTH))),
});
export type ProjectCloneNestedRepository = typeof ProjectCloneNestedRepository.Type;

export const ProjectCloneSnapshot = Schema.Struct({
  projectId: ProjectId,
  remoteUrl: TrimmedNonEmptyString,
  destinationPath: TrimmedNonEmptyString,
  repository: Schema.NullOr(SourceControlRepositoryInfo),
  phase: ProjectClonePhase,
  stage: ProjectCloneStage,
  percent: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(PROJECT_CLONE_DETAIL_MAX_LENGTH))),
  /** Git has printed nothing for a while; `detail` is no longer current. Older servers omit it. */
  stalled: Schema.optionalKey(Schema.Boolean),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(PROJECT_CLONE_ERROR_MAX_LENGTH))),
  /** Fork: nested repositories cloned after the root; omitted when there are none. */
  nestedRepositories: Schema.optionalKey(Schema.Array(ProjectCloneNestedRepository)),
  startedAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime),
  sequence: NonNegativeInt,
});
export type ProjectCloneSnapshot = typeof ProjectCloneSnapshot.Type;

export const ProjectCloneSubscribeInput = Schema.Struct({});
export type ProjectCloneSubscribeInput = typeof ProjectCloneSubscribeInput.Type;

export const ProjectCloneListEvent = Schema.Array(ProjectCloneSnapshot);
export type ProjectCloneListEvent = typeof ProjectCloneListEvent.Type;

export const ProjectCloneStartInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  provider: Schema.optional(SourceControlProviderKind),
  repository: Schema.optional(TrimmedNonEmptyString),
  remoteUrl: Schema.optional(TrimmedNonEmptyString),
  destinationPath: TrimmedNonEmptyString,
  protocol: Schema.optional(SourceControlCloneProtocol),
  /** Fork: older servers ignore this and clone only the root repository. */
  nestedRepositories: Schema.optional(Schema.Array(ProjectCloneNestedRepositoryInput)),
});
export type ProjectCloneStartInput = typeof ProjectCloneStartInput.Type;

export const ProjectCloneStartResult = Schema.Struct({
  projectId: ProjectId,
  cwd: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
  repository: Schema.NullOr(SourceControlRepositoryInfo),
});
export type ProjectCloneStartResult = typeof ProjectCloneStartResult.Type;

export const ProjectCloneActionInput = Schema.Struct({
  projectId: ProjectId,
});
export type ProjectCloneActionInput = typeof ProjectCloneActionInput.Type;

export const ProjectCloneActionResult = Schema.Struct({
  applied: Schema.Boolean,
});
export type ProjectCloneActionResult = typeof ProjectCloneActionResult.Type;

function projectCloneStageLabel(stage: ProjectCloneStage): string {
  switch (stage) {
    case "connecting":
      return "Connecting";
    case "counting":
      return "Counting objects";
    case "receiving":
      return "Receiving objects";
    case "resolving":
      return "Resolving deltas";
    case "checkout":
      return "Checking out files";
  }
}

export function projectCloneDisplayName(
  snapshot: Pick<ProjectCloneSnapshot, "repository" | "destinationPath">,
): string {
  if (snapshot.repository) return snapshot.repository.nameWithOwner;
  const segments = snapshot.destinationPath.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? snapshot.destinationPath;
}

export function projectCloneProgressSummary(
  snapshot: Pick<ProjectCloneSnapshot, "stage" | "percent" | "detail" | "stalled">,
): string {
  const parts = [projectCloneStageLabel(snapshot.stage)];
  if (snapshot.percent !== null) parts.push(`${snapshot.percent}%`);
  // The detail carries git's last transfer speed, which a stall makes a lie.
  if (snapshot.stalled) parts.push("Stalled");
  else if (snapshot.detail) parts.push(snapshot.detail);
  return parts.join(" · ");
}

/** Fork: one line naming each nested repository's state, or null without any. */
export function projectCloneNestedSummary(
  snapshot: Pick<ProjectCloneSnapshot, "nestedRepositories">,
): string | null {
  const nested = snapshot.nestedRepositories ?? [];
  if (nested.length === 0) return null;
  return `Nested repos: ${nested
    .map((repository) => `${repository.relativePath} ${projectCloneNestedStatusLabel(repository)}`)
    .join(", ")}`;
}

/** Fork: nested repositories that did not land cleanly, as "path: reason" lines. */
export function projectCloneNestedProblems(
  snapshot: Pick<ProjectCloneSnapshot, "nestedRepositories">,
): ReadonlyArray<string> {
  return (snapshot.nestedRepositories ?? [])
    .filter((repository) => repository.status !== "cloned" || repository.detail !== null)
    .map(
      (repository) =>
        `${repository.relativePath}: ${repository.detail ?? projectCloneNestedStatusLabel(repository)}`,
    );
}

function projectCloneNestedStatusLabel(repository: ProjectCloneNestedRepository): string {
  switch (repository.status) {
    case "pending":
      return "waiting";
    case "cloning":
      return "cloning";
    case "cloned":
      return repository.detail === null ? "cloned" : "cloned with a warning";
    case "skipped":
      return "skipped";
    case "failed":
      return "failed";
  }
}
