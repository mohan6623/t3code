import type {
  EnvironmentId,
  EnvironmentMachineKind,
  VcsRef,
  ProjectId,
  WorktreeSubmodules,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { sanitizeNewRefName } from "@t3tools/shared/git";
import { toSortableTimestamp } from "../lib/threadSort";
export {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  sanitizeNewRefName,
} from "@t3tools/shared/git";

export interface EnvironmentOption {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  label: string;
  isPrimary: boolean;
  machine: EnvironmentMachineKind;
}

/** "Add to another machine" stays muted until hovered: easy to find, quieter than the machines. */
export const ADD_TO_MACHINE_LABEL_CLASS =
  "flex min-w-0 items-center gap-1.5 opacity-55 in-data-highlighted:opacity-100 in-data-popup-open:opacity-100";

export const EnvMode = Schema.Literals(["local", "worktree"]);
export type EnvMode = typeof EnvMode.Type;

const GENERIC_LOCAL_ENVIRONMENT_LABELS = new Set(["local", "local environment"]);

function normalizeDisplayLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveEnvironmentOptionLabel(input: {
  isPrimary: boolean;
  environmentId: EnvironmentId;
  runtimeLabel?: string | null;
  savedLabel?: string | null;
}): string {
  const runtimeLabel = normalizeDisplayLabel(input.runtimeLabel);
  const savedLabel = normalizeDisplayLabel(input.savedLabel);

  if (input.isPrimary) {
    const preferredLocalLabel = [runtimeLabel, savedLabel].find((label) => {
      if (!label) return false;
      return !GENERIC_LOCAL_ENVIRONMENT_LABELS.has(label.toLowerCase());
    });
    return preferredLocalLabel ?? "This device";
  }

  return runtimeLabel ?? savedLabel ?? input.environmentId;
}

export function shouldShowEnvironmentIndicator(input: {
  activeEnvironment: Pick<EnvironmentOption, "isPrimary"> | null;
  canPickEnvironment: boolean;
}): boolean {
  if (input.canPickEnvironment) return true;
  return input.activeEnvironment !== null && !input.activeEnvironment.isPrimary;
}

export function shouldShowComposerContextStrip(input: {
  isDraftHeroState: boolean;
  persistInActiveThreads: boolean;
  hasActiveProject: boolean;
  isGitRepo: boolean;
  showEnvironmentIndicator: boolean;
  hostsRestingComposerControls: boolean;
}): boolean {
  return (
    input.hasActiveProject &&
    (input.isDraftHeroState || input.persistInActiveThreads) &&
    (input.isGitRepo || input.showEnvironmentIndicator || input.hostsRestingComposerControls)
  );
}

// Hysteresis prevents labels and icons from flapping at the width boundary.
const CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX = 16;

export function resolveContextStripLabelsCompact(input: {
  compact: boolean;
  neededWidth: number;
  availableWidth: number;
}): boolean {
  return input.compact
    ? input.neededWidth > input.availableWidth - CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX
    : input.neededWidth > input.availableWidth;
}

/**
 * Fork: the dock's priority table. As the composer narrows, each step yields in this order,
 * the first step first. These never yield: the model logo and name (they only truncate, as
 * the last resort), the "…" menu, the usage bars, and the account initials.
 */
export const DOCK_FOLD_ORDER = [
  // Branch, PR and environment chips: the text folds, the icon stays.
  "context-labels",
  // Effort, access, mode, Build: label to icon, then into the "…" menu, last control first.
  "composer-controls",
  // The prompt-cache timer hides.
  "cache-timer",
  // The % and reset figures fold; the bars stay. The badge never grows a second line, which
  // would make the dock taller and push its figures out of line with the other controls.
  "usage-figures",
  // Last resort: the model name truncates with an ellipsis. It never hides.
  "model-name",
] as const;

export type DockFoldStep = (typeof DOCK_FOLD_ORDER)[number];

/** The steps the context strip applies itself; the controls host handles the other two. */
export const CONTEXT_STRIP_FOLD_STEPS: readonly DockFoldStep[] = DOCK_FOLD_ORDER.filter(
  (step) => step !== "composer-controls" && step !== "model-name",
);

/** 0 shows everything; level n applies the first n strip steps. */
export type ContextStripFoldLevel = 0 | 1 | 2 | 3;

export function contextStripFoldStepLevel(step: DockFoldStep): ContextStripFoldLevel {
  return (CONTEXT_STRIP_FOLD_STEPS.indexOf(step) + 1) as ContextStripFoldLevel;
}

/**
 * Whether the strip may move past `level` only after the composer controls are all in the
 * "…" menu. Before that, the controls keep their natural width in the strip's sums.
 */
export function contextStripFoldUsesCollapsedControls(level: number): boolean {
  const next = CONTEXT_STRIP_FOLD_STEPS[level];
  return (
    next !== undefined &&
    DOCK_FOLD_ORDER.indexOf("composer-controls") < DOCK_FOLD_ORDER.indexOf(next)
  );
}

/** The strip levels each folding part shows on, first and last, keyed by its fold name. */
export const CONTEXT_STRIP_PART_LEVELS: Record<string, readonly [number, number]> = {
  // A chip label (`data-composer-label` with no fold name).
  label: [0, contextStripFoldStepLevel("context-labels") - 1],
  timer: [0, contextStripFoldStepLevel("cache-timer") - 1],
  figures: [0, contextStripFoldStepLevel("usage-figures") - 1],
};

/** The strip's fold level as the data attributes its children's styles read. */
export function contextStripFoldAttributes(level: ContextStripFoldLevel) {
  const at = (step: DockFoldStep) => (level >= contextStripFoldStepLevel(step) ? "" : undefined);
  return {
    "data-compact": at("context-labels"),
    "data-fold-timer": at("cache-timer"),
    "data-fold-figures": at("usage-figures"),
  };
}

/**
 * `neededWidths[level]` is the width the strip needs at that level, measured from natural
 * widths that do not depend on the current level, so a fold cannot undo itself. Unfolding needs
 * the same slack as the labels above.
 */
export function resolveContextStripFoldLevel(input: {
  level: ContextStripFoldLevel;
  neededWidths: readonly number[];
  availableWidth: number;
}): ContextStripFoldLevel {
  const last = CONTEXT_STRIP_FOLD_STEPS.length as ContextStripFoldLevel;
  for (let level = 0; level < last; level += 1) {
    const slack = level < input.level ? CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX : 0;
    const needed = input.neededWidths[level];
    if (needed !== undefined && needed <= input.availableWidth - slack) {
      return level as ContextStripFoldLevel;
    }
  }
  return last;
}

export function resolveEnvModeLabel(mode: EnvMode): string {
  return mode === "worktree" ? "New worktree" : "Current checkout";
}

export const WORKTREE_SUBMODULES_LABELS: Record<WorktreeSubmodules, string> = {
  recursive: "Recursive",
  "top-level": "Top level only",
  none: "Skip",
};

export function resolveCurrentWorkspaceLabel(activeWorktreePath: string | null): string {
  return activeWorktreePath ? "Current worktree" : resolveEnvModeLabel("local");
}

export function resolveLockedWorkspaceLabel(
  activeWorktreePath: string | null,
  effectiveEnvMode: EnvMode,
): string {
  if (activeWorktreePath) return "Worktree";
  return effectiveEnvMode === "worktree" ? resolveEnvModeLabel("worktree") : "Local checkout";
}

export interface PreviousWorktreeSeed {
  branch: string | null;
  worktreePath: string;
}

export function resolvePreviousWorktreeSeed(input: {
  threads: ReadonlyArray<{
    branch: string | null;
    worktreePath: string | null;
    updatedAt: string;
    archivedAt?: string | null;
  }>;
  currentWorktreePath: string | null;
}): PreviousWorktreeSeed | null {
  let latest: { branch: string | null; worktreePath: string; updatedAt: number } | null = null;
  for (const thread of input.threads) {
    if (
      !thread.worktreePath ||
      thread.worktreePath === input.currentWorktreePath ||
      (thread.archivedAt ?? null) !== null
    ) {
      continue;
    }
    const updatedAt = toSortableTimestamp(thread.updatedAt);
    if (updatedAt === null) {
      continue;
    }
    if (latest === null || updatedAt > latest.updatedAt) {
      latest = {
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        updatedAt,
      };
    }
  }
  return latest === null ? null : { branch: latest.branch, worktreePath: latest.worktreePath };
}

export function resolvePreviousWorktreeLabel(seed: PreviousWorktreeSeed): string {
  return seed.branch ? `Previous worktree (${seed.branch})` : "Previous worktree";
}

export function resolveEffectiveEnvMode(input: {
  activeWorktreePath: string | null;
  hasServerThread: boolean;
  draftThreadEnvMode: EnvMode | undefined;
  preparingWorktree?: boolean;
}): EnvMode {
  const { activeWorktreePath, hasServerThread, draftThreadEnvMode, preparingWorktree } = input;
  if (!hasServerThread) {
    if (activeWorktreePath) {
      return "local";
    }
    return draftThreadEnvMode === "worktree" ? "worktree" : "local";
  }
  return activeWorktreePath || preparingWorktree ? "worktree" : "local";
}

export function resolveDraftEnvModeAfterBranchChange(input: {
  nextWorktreePath: string | null;
  currentWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): EnvMode {
  const { nextWorktreePath, currentWorktreePath, effectiveEnvMode } = input;
  if (nextWorktreePath) {
    return "worktree";
  }
  if (effectiveEnvMode === "worktree" && !currentWorktreePath) {
    return "worktree";
  }
  return "local";
}

export function resolveBranchToolbarValue(input: {
  envMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): string | null {
  const { envMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (envMode === "worktree" && !activeWorktreePath) {
    return activeThreadBranch ?? currentGitBranch;
  }
  return currentGitBranch ?? activeThreadBranch;
}

export function resolveBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  resolvedActiveBranch: string | null;
  resolvedActiveBranchIsRemote: boolean | null;
  startFromOrigin: boolean;
}): string {
  const {
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
    resolvedActiveBranchIsRemote,
    startFromOrigin,
  } = input;
  if (!resolvedActiveBranch) {
    return "Select ref";
  }
  if (effectiveEnvMode === "worktree" && !activeWorktreePath) {
    // Only the server can determine a local branch's configured remote.
    return startFromOrigin && resolvedActiveBranchIsRemote === false
      ? `From ${resolvedActiveBranch} (remote)`
      : `From ${resolvedActiveBranch}`;
  }
  return resolvedActiveBranch;
}

export function resolveBranchToolbarPrBranch(input: {
  activeThreadBranch: string | null;
  resolvedActiveBranch: string | null;
}): string | null {
  return input.activeThreadBranch === input.resolvedActiveBranch ? input.activeThreadBranch : null;
}

export function resolveLocalCheckoutBranchMismatch(input: {
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): { threadBranch: string; currentBranch: string } | null {
  const { effectiveEnvMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (effectiveEnvMode !== "local" || activeWorktreePath !== null) {
    return null;
  }
  if (!activeThreadBranch || !currentGitBranch || activeThreadBranch === currentGitBranch) {
    return null;
  }
  return { threadBranch: activeThreadBranch, currentBranch: currentGitBranch };
}

export function resolveBranchSelectionTarget(input: {
  activeProjectCwd: string;
  activeWorktreePath: string | null;
  refName: Pick<VcsRef, "isDefault" | "worktreePath">;
}): {
  checkoutCwd: string;
  nextWorktreePath: string | null;
  reuseExistingWorktree: boolean;
} {
  const { activeProjectCwd, activeWorktreePath, refName } = input;

  if (refName.worktreePath) {
    return {
      checkoutCwd: refName.worktreePath,
      nextWorktreePath: refName.worktreePath === activeProjectCwd ? null : refName.worktreePath,
      reuseExistingWorktree: true,
    };
  }

  const nextWorktreePath =
    activeWorktreePath !== null && refName.isDefault ? null : activeWorktreePath;

  return {
    checkoutCwd: nextWorktreePath ?? activeProjectCwd,
    nextWorktreePath,
    reuseExistingWorktree: false,
  };
}

export function shouldIncludeBranchPickerItem(input: {
  itemValue: string;
  normalizedQuery: string;
  createBranchItemValue: string | null;
  checkoutPullRequestItemValue: string | null;
}): boolean {
  const { itemValue, normalizedQuery, createBranchItemValue, checkoutPullRequestItemValue } = input;

  if (normalizedQuery.length === 0) {
    return true;
  }

  if (createBranchItemValue && itemValue === createBranchItemValue) {
    return true;
  }

  if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
    return true;
  }

  const lowerItemValue = itemValue.toLowerCase();
  if (lowerItemValue.includes(normalizedQuery)) {
    return true;
  }

  const sanitizedQuery = sanitizeNewRefName(normalizedQuery);
  return (
    sanitizedQuery.length > 0 &&
    sanitizedQuery !== normalizedQuery &&
    lowerItemValue.includes(sanitizedQuery)
  );
}
