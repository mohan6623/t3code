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
import { BranchToolbarBranchSelector } from "../BranchToolbarBranchSelector";
import BaseGitActionsControl from "../GitActionsControl";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { memo, useState, type ComponentProps } from "react";
import { DiffStatLabel } from "./DiffStatLabel";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { OpenInPicker } from "./OpenInPicker";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadAutomationsPanel } from "./ThreadAutomationsPanel";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";
import { ThreadServersPanel } from "./ThreadServersPanel";
import { ThreadDetailsUsage, type ThreadDetailsUsageInput } from "./ThreadDetailsUsage";
import { ThreadDetailsItemsMenuItems } from "./ThreadDetailsItemsMenu";
import { resolveThreadDetailsVisibility, THREAD_DETAILS_ITEMS } from "./threadDetailsItems";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { SlidersHorizontalIcon } from "lucide-react";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";
import { Menu, MenuPopup } from "../ui/menu";

const GitActionsControl = memo(BaseGitActionsControl);

// Fork: repository sections start closed. Each thread keeps the ones you
// opened, keyed by environment, thread and repository path.
const EXPANDED_REPOSITORIES_KEY = "t3code:thread-details:expanded-repositories";
const ExpandedRepositoriesSchema = Schema.Record(Schema.String, Schema.Boolean);
/** Oldest entries go first once the record grows past this. */
const EXPANDED_REPOSITORIES_LIMIT = 300;

/** A child repository's branch row checks out in place, so it never starts from origin. */
const ignoreStartFromOrigin = () => {};

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

interface ThreadDetailsPanelProps extends Pick<
  ComponentProps<typeof ThreadDetailsCard>,
  "anchor" | "handle"
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
  usage: ThreadDetailsUsageInput;
}

export function ThreadDetailsPanel(props: ThreadDetailsPanelProps) {
  const visible = useClientSettings(resolveThreadDetailsVisibility);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const fileScripts = useT3ProjectFileScripts(
    props.environmentId,
    props.activeProjectScripts && visible.scripts ? props.gitCwd : null,
  );
  const activeThreadRef = { environmentId: props.environmentId, threadId: props.threadId };
  // A root repository is the thread's own checkout, so it keeps the single-repository section.
  const rootRepository = props.workspaceRepositories.find(isRootWorkspaceRepository);
  const nestedRepositories = props.workspaceRepositories.filter(
    (repository) => !isRootWorkspaceRepository(repository),
  );
  const [expandedRepositories, setExpandedRepositories] = useLocalStorage(
    EXPANDED_REPOSITORIES_KEY,
    {},
    ExpandedRepositoriesSchema,
  );
  const repositorySectionProps = (gitCwd: string, repository: VcsRepository) => {
    const cwd = joinWorkspaceRepositoryPath(gitCwd, repository.relativePath);
    const key = `${props.environmentId}:${props.threadId}:${repository.relativePath}`;
    const collapsed = expandedRepositories[key] !== true;
    return {
      collapsed,
      onCollapsedChange: (nextCollapsed: boolean) =>
        setExpandedRepositories((current) => {
          const next = { ...current };
          delete next[key];
          if (!nextCollapsed) next[key] = true;
          const keys = Object.keys(next);
          for (const old of keys.slice(0, Math.max(0, keys.length - EXPANDED_REPOSITORIES_LIMIT))) {
            delete next[old];
          }
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
      contentKey={THREAD_DETAILS_ITEMS.filter((item) => visible[item.id])
        .map((item) => item.id)
        .join(",")}
      onContextMenu={(event) => {
        // Popups the card opens bubble here through React; they, fields, links, and selected text
        // keep their own menus.
        const target = event.target;
        const selection = window.getSelection();
        if (
          !(target instanceof Element) ||
          !event.currentTarget.contains(target) ||
          target.closest("input, textarea, [contenteditable], a[href]") ||
          (selection &&
            !selection.isCollapsed &&
            (event.currentTarget.contains(selection.anchorNode) ||
              event.currentTarget.contains(selection.focusNode)))
        )
          return;
        event.preventDefault();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {(density) => {
        // Section flags follow the rows that will render, so no empty section steals the divider rule.
        const show = {
          environment: density === "full" && visible.environment,
          openIn: density !== "essential" && visible.openIn && props.showOpenInPicker,
          scripts: visible.scripts && props.activeProjectScripts !== undefined,
          branch: props.gitCwd !== null && props.isGitRepo && visible.branch,
          git:
            props.gitCwd !== null &&
            props.activeProjectName !== undefined &&
            (visible.gitActions || (visible.changes && props.isGitRepo)),
          // Fork: each nested repository of a multi-repo workspace gets its own section.
          nestedRepositories:
            props.gitCwd !== null &&
            props.activeProjectName !== undefined &&
            nestedRepositories.length > 0 &&
            (visible.gitActions || visible.changes),
        };
        return (
          <>
            <div className="group/details-items">
              {show.environment || show.openIn || show.scripts ? (
                <ThreadDetailsSection
                  headingId="thread-details-workspace-heading"
                  title="Workspace"
                  separated={false}
                  showHeading={false}
                >
                  <div className="flex flex-col">
                    {show.environment ? (
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

                    {show.openIn ? (
                      <OpenInPicker
                        keybindings={props.keybindings}
                        environmentId={props.environmentId}
                        availableEditors={props.availableEditors}
                        openInCwd={props.gitCwd}
                        enableShortcut={props.openInShortcutEnabled}
                        displayMode="panel"
                      />
                    ) : null}

                    {show.scripts && props.activeProjectScripts ? (
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
              ) : null}

              {props.gitCwd &&
              (show.branch || show.git) &&
              (props.workspaceRepositories.length === 0 || rootRepository) ? (
                <ThreadDetailsSection
                  headingId="thread-details-version-control-heading"
                  title={rootRepository?.name ?? "Version Control"}
                  showHeading={rootRepository !== undefined}
                  separated={density === "full"}
                  {...(rootRepository ? repositorySectionProps(props.gitCwd, rootRepository) : {})}
                >
                  <div className="flex flex-col">
                    {show.branch ? (
                      <BranchToolbar layout="panel" panelSection="branch" {...branchToolbarProps} />
                    ) : null}
                    {show.git ? (
                      <GitActionsControl
                        compact={density !== "full"}
                        showActions={visible.gitActions}
                        showChanges={visible.changes}
                        gitCwd={props.gitCwd}
                        activeThreadRef={activeThreadRef}
                        {...(props.draftId ? { draftId: props.draftId } : {})}
                        {...(props.onOpenChanges
                          ? {
                              onOpenChanges: () =>
                                props.onOpenChanges!(rootRepository?.relativePath),
                            }
                          : {})}
                      />
                    ) : null}
                  </div>
                </ThreadDetailsSection>
              ) : null}

              {show.nestedRepositories && props.gitCwd
                ? nestedRepositories.map((repository) => {
                    const repositoryCwd = joinWorkspaceRepositoryPath(
                      props.gitCwd!,
                      repository.relativePath,
                    );
                    return (
                      <ThreadDetailsSection
                        key={repository.relativePath}
                        headingId={`thread-details-repository-${repository.relativePath.replaceAll("/", "-")}`}
                        title={repository.name}
                        separated={density === "full"}
                        {...repositorySectionProps(props.gitCwd!, repository)}
                      >
                        <div className="flex flex-col">
                          {/* Fork: a child repository gets the root's branch row, run in its own working tree. */}
                          {visible.branch ? (
                            <BranchToolbarBranchSelector
                              displayMode="panel"
                              className="w-full"
                              environmentId={props.environmentId}
                              threadId={props.threadId}
                              {...(props.draftId ? { draftId: props.draftId } : {})}
                              envLocked={props.envLocked}
                              startFromOrigin={false}
                              onStartFromOriginChange={ignoreStartFromOrigin}
                              onComposerFocusRequest={props.onComposerFocusRequest}
                              repositoryCwd={repositoryCwd}
                            />
                          ) : null}
                          <GitActionsControl
                            compact={density !== "full"}
                            showActions={visible.gitActions}
                            showChanges={visible.changes}
                            gitCwd={repositoryCwd}
                            activeThreadRef={activeThreadRef}
                            syncThreadBranch={false}
                            {...(props.draftId ? { draftId: props.draftId } : {})}
                            {...(props.onOpenChanges
                              ? {
                                  onOpenChanges: () =>
                                    props.onOpenChanges!(repository.relativePath),
                                }
                              : {})}
                          />
                        </div>
                      </ThreadDetailsSection>
                    );
                  })
                : null}

              {density === "full" && !props.draftId && visible.servers ? (
                <ThreadServersPanel environmentId={props.environmentId} threadId={props.threadId} />
              ) : null}

              {density === "full" && !props.draftId && visible.automations ? (
                <ThreadAutomationsPanel
                  environmentId={props.environmentId}
                  threadId={props.threadId}
                />
              ) : null}

              {density === "full" && !props.draftId && visible.lineage ? (
                <ThreadRelationshipsPanel
                  environmentId={props.environmentId}
                  threadId={props.threadId}
                />
              ) : null}

              {visible.usage ? <ThreadDetailsUsage {...props.usage} /> : null}

              {/* Shown only when no section above has content, so an emptied card can be refilled. */}
              <div className="p-2 group-has-[>section>:last-child:not(:empty)]/details-items:hidden">
                <ThreadDetailsControl
                  size="xs"
                  variant="ghost"
                  part="row"
                  panel
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenuPosition({ x: rect.left, y: rect.bottom });
                  }}
                >
                  <SlidersHorizontalIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                  <span className={cn("ml-0.5", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
                    Choose what to show
                  </span>
                </ThreadDetailsControl>
              </div>
            </div>

            <Menu
              open={menuPosition !== null}
              onOpenChange={(open) => !open && setMenuPosition(null)}
            >
              <MenuPopup
                anchor={
                  menuPosition
                    ? {
                        getBoundingClientRect: () =>
                          new DOMRect(menuPosition.x, menuPosition.y, 0, 0),
                      }
                    : undefined
                }
                align="start"
                side="bottom"
              >
                <ThreadDetailsItemsMenuItems />
              </MenuPopup>
            </Menu>
          </>
        );
      }}
    </ThreadDetailsCard>
  );
}
