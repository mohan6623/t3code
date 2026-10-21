import {
  isRootWorkspaceRepository,
  type EditorId,
  type EnvironmentId,
  type ProjectId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
  type VcsRepository,
} from "@t3tools/contracts";
import { joinWorkspaceRepositoryPath } from "@t3tools/shared/path";
import * as Schema from "effect/Schema";

import type { DraftId } from "../../composerDraftStore";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useT3ProjectFileScripts } from "../../hooks/useT3ProjectFileScripts";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { type EnvMode, type EnvironmentOption } from "../BranchToolbar.logic";
import { BranchToolbar } from "../BranchToolbar";
import BaseGitActionsControl from "../GitActionsControl";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { memo, type ComponentProps } from "react";
import { DiffStatLabel } from "./DiffStatLabel";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { OpenInPicker } from "./OpenInPicker";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadAutomationsPanel } from "./ThreadAutomationsPanel";
import { SideChatsSection } from "./SideChatsSection";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";

const GitActionsControl = memo(BaseGitActionsControl);

// Keyed by environment and repository path, so a repository stays collapsed in every thread.
const COLLAPSED_REPOSITORIES_KEY = "t3code:thread-details:collapsed-repositories";
const CollapsedRepositoriesSchema = Schema.Record(Schema.String, Schema.Boolean);

/** Keeps a collapsed repository's changes visible in its heading. */
function RepositoryChangesStat(props: { environmentId: EnvironmentId; cwd: string }) {
  const { data: status } = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: props.environmentId, input: { cwd: props.cwd } }),
  );
  const totals = status?.branchChanges ?? status?.workingTree;
  if (!totals || (totals.insertions === 0 && totals.deletions === 0)) return null;
  return (
    <DiffStatLabel
      layout="inline"
      className="text-2xs"
      additions={totals.insertions}
      deletions={totals.deletions}
    />
  );
}

export interface ThreadDetailsPanelProps extends Pick<
  ComponentProps<typeof ThreadDetailsCard>,
  "anchor" | "handle" | "onPresentationChange"
> {
  forceNewWorktree?: boolean;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  worktreePath: string | null;
  isServerThread: boolean;
  draftId?: DraftId;
  activeProjectName: string | undefined;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  showOpenInPicker: boolean;
  openInShortcutEnabled: boolean;
  gitCwd: string | null;
  isGitRepo: boolean;
  /** Repositories of a multi-repo workspace; each gets its own source control. */
  workspaceRepositories: ReadonlyArray<VcsRepository>;
  envLocked: boolean;
  availableEnvironments: readonly EnvironmentOption[];
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  onEnvModeChange: (mode: EnvMode) => void;
  envMode: EnvMode;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest: () => void;
  /** Opens the diff panel, on the given repository in a multi-repo workspace. */
  onOpenChanges?: (repositoryPath?: string) => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export function ThreadDetailsPanel(props: ThreadDetailsPanelProps) {
  const fileScripts = useT3ProjectFileScripts(
    props.environmentId,
    props.activeProjectScripts ? props.gitCwd : null,
  );
  const activeThreadRef = { environmentId: props.environmentId, threadId: props.threadId };
  // A root repository is the thread's own checkout, so it keeps the single-repository section.
  const rootRepository = props.workspaceRepositories.find(isRootWorkspaceRepository);
  const nestedRepositories = props.workspaceRepositories.filter(
    (repository) => !isRootWorkspaceRepository(repository),
  );
  const [collapsedRepositories, setCollapsedRepositories] = useLocalStorage(
    COLLAPSED_REPOSITORIES_KEY,
    {},
    CollapsedRepositoriesSchema,
  );
  const repositorySectionProps = (gitCwd: string, repository: VcsRepository) => {
    const cwd = joinWorkspaceRepositoryPath(gitCwd, repository.relativePath);
    const key = `${props.environmentId}:${cwd}`;
    const collapsed = collapsedRepositories[key] === true;
    return {
      collapsed,
      onCollapsedChange: (nextCollapsed: boolean) =>
        setCollapsedRepositories((current) => {
          const next = { ...current };
          if (nextCollapsed) next[key] = true;
          else delete next[key];
          return next;
        }),
      ...(collapsed
        ? { actions: <RepositoryChangesStat environmentId={props.environmentId} cwd={cwd} /> }
        : {}),
    };
  };
  const branchToolbarProps = {
    showGitControls: props.isGitRepo,
    environmentId: props.environmentId,
    threadId: props.threadId,
    projectId: props.projectId,
    worktreePath: props.worktreePath,
    isServerThread: props.isServerThread,
    ...(props.draftId ? { draftId: props.draftId } : {}),
    onEnvModeChange: props.onEnvModeChange,
    startFromOrigin: props.startFromOrigin,
    onStartFromOriginChange: props.onStartFromOriginChange,
    envMode: props.envMode,
    ...(props.activeThreadBranchOverride !== undefined
      ? { activeThreadBranchOverride: props.activeThreadBranchOverride }
      : {}),
    ...(props.onActiveThreadBranchOverrideChange
      ? { onActiveThreadBranchOverrideChange: props.onActiveThreadBranchOverrideChange }
      : {}),
    envLocked: props.envLocked,
    forceNewWorktree: props.forceNewWorktree ?? false,
    onComposerFocusRequest: props.onComposerFocusRequest,
    ...(props.onCheckoutPullRequestRequest
      ? { onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest }
      : {}),
  };

  return (
    <ThreadDetailsCard
      threadRef={{ environmentId: props.environmentId, threadId: props.threadId }}
      anchor={props.anchor}
      handle={props.handle}
      onPresentationChange={props.onPresentationChange}
    >
      {(density) => (
        <>
          <ThreadDetailsSection
            headingId="thread-details-workspace-heading"
            title="Workspace"
            separated={false}
            showHeading={false}
          >
            <div className="flex flex-col">
              {density === "full" ? (
                <BranchToolbar
                  layout="panel"
                  panelSection="workspace"
                  availableEnvironments={props.availableEnvironments}
                  {...(props.onEnvironmentChange
                    ? { onEnvironmentChange: props.onEnvironmentChange }
                    : {})}
                  autoEnvironmentLabel={props.autoEnvironmentLabel}
                  onAutoEnvironment={props.onAutoEnvironment}
                  {...branchToolbarProps}
                />
              ) : null}

              {density !== "essential" && props.showOpenInPicker ? (
                <OpenInPicker
                  keybindings={props.keybindings}
                  environmentId={props.environmentId}
                  availableEditors={props.availableEditors}
                  openInCwd={props.gitCwd}
                  enableShortcut={props.openInShortcutEnabled}
                  displayMode="panel"
                />
              ) : null}

              {props.activeProjectScripts ? (
                <ProjectScriptsControl
                  environmentId={props.environmentId}
                  displayMode="panel"
                  scripts={props.activeProjectScripts}
                  fileScripts={fileScripts}
                  preferredScriptId={props.preferredScriptId}
                  onRunScript={props.onRunProjectScript}
                  onAddScript={props.onAddProjectScript}
                  onUpdateScript={props.onUpdateProjectScript}
                  onDeleteScript={props.onDeleteProjectScript}
                />
              ) : null}
            </div>
          </ThreadDetailsSection>

          {props.gitCwd && (props.workspaceRepositories.length === 0 || rootRepository) ? (
            <ThreadDetailsSection
              headingId="thread-details-version-control-heading"
              title={rootRepository?.name ?? "Version Control"}
              showHeading={rootRepository !== undefined}
              separated={density === "full"}
              {...(rootRepository ? repositorySectionProps(props.gitCwd, rootRepository) : {})}
            >
              <div className="flex flex-col">
                {props.isGitRepo ? (
                  <BranchToolbar layout="panel" panelSection="branch" {...branchToolbarProps} />
                ) : null}
                {props.activeProjectName ? (
                  <GitActionsControl
                    displayMode="panel"
                    compact={density !== "full"}
                    gitCwd={props.gitCwd}
                    activeThreadRef={activeThreadRef}
                    {...(props.draftId ? { draftId: props.draftId } : {})}
                    {...(props.onOpenChanges
                      ? {
                          onOpenChanges: () => props.onOpenChanges!(rootRepository?.relativePath),
                        }
                      : {})}
                  />
                ) : null}
              </div>
            </ThreadDetailsSection>
          ) : null}

          {props.gitCwd && props.activeProjectName && nestedRepositories.length > 0
            ? nestedRepositories.map((repository) => (
                <ThreadDetailsSection
                  key={repository.relativePath}
                  headingId={`thread-details-repository-${repository.relativePath.replaceAll("/", "-")}`}
                  title={repository.name}
                  separated={density === "full"}
                  {...repositorySectionProps(props.gitCwd!, repository)}
                >
                  <GitActionsControl
                    displayMode="panel"
                    compact={density !== "full"}
                    gitCwd={joinWorkspaceRepositoryPath(props.gitCwd!, repository.relativePath)}
                    activeThreadRef={{
                      environmentId: props.environmentId,
                      threadId: props.threadId,
                    }}
                    syncThreadBranch={false}
                    {...(props.draftId ? { draftId: props.draftId } : {})}
                    {...(props.onOpenChanges
                      ? { onOpenChanges: () => props.onOpenChanges!(repository.relativePath) }
                      : {})}
                  />
                </ThreadDetailsSection>
              ))
            : null}

          {density === "full" && !props.draftId ? (
            <ThreadAutomationsPanel environmentId={props.environmentId} threadId={props.threadId} />
          ) : null}

          {density === "full" && !props.draftId ? (
            <SideChatsSection environmentId={props.environmentId} threadId={props.threadId} />
          ) : null}

          {density === "full" && !props.draftId ? (
            <ThreadRelationshipsPanel
              environmentId={props.environmentId}
              threadId={props.threadId}
            />
          ) : null}
        </>
      )}
    </ThreadDetailsCard>
  );
}
