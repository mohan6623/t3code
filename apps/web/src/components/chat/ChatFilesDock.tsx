// Fork: the file explorer and opened files, docked left of the chat when the
// "File explorer side" setting is Left. It is the right panel's tab strip and
// shell, bound to the thread's files dock key in the right panel store.
import type { ResolvedKeybindingsConfig, ScopedThreadRef } from "@t3tools/contracts";
import { PanelLeftIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { ShortcutMatchContext } from "../../keybindings";
import { usePanelAnimationSettings, usePanelPresence } from "../../panelAnimations";
import {
  filesDockRef,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  type RightPanelSurface,
  useRightPanelStore,
} from "../../rightPanelStore";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ChatRightPanel } from "./ChatRightPanel";

const FILES_DOCK_WIDTH_STORAGE_KEY = "t3code:files-dock-width";
const FILES_DOCK_DEFAULT_WIDTH = 360;
const NO_PREVIEW_SESSIONS = {};
const NO_TERMINAL_LABELS: ReadonlyMap<string, string> = new Map();
const unavailable = () => undefined;

export interface ChatFilesDockProps {
  /** The thread the dock belongs to; the dock's own key is derived from it. */
  readonly threadRef: ScopedThreadRef;
  readonly threadKey: string;
  readonly sheet: boolean;
  readonly workspaceLayoutElement: HTMLElement | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly getShortcutContext: () => ShortcutMatchContext;
  readonly pendingSurfaceIds: ReadonlySet<string>;
  readonly filesAvailable: boolean;
  readonly onCopyFilePath: (relativePath: string) => void;
  readonly renderContent: (surface: RightPanelSurface | null, visible: boolean) => ReactNode;
}

export function ChatFilesDock(props: ChatFilesDockProps) {
  const dockRef = filesDockRef(props.threadRef);
  const dockState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, dockRef),
  );
  const activeSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, dockRef),
  );
  const { active: animationsActive, durationMs } = usePanelAnimationSettings();
  const presenceValue = { activeSurface, surfaces: dockState.surfaces };
  const presence = usePanelPresence(
    dockState.isOpen,
    presenceValue,
    animationsActive,
    props.threadKey,
    durationMs,
  );
  if (!presence.present) return null;

  const store = () => useRightPanelStore.getState();
  const renderedSurface = presence.value?.activeSurface ?? null;
  return (
    <ChatRightPanel
      side="left"
      sheet={props.sheet}
      workspaceLayoutElement={props.workspaceLayoutElement}
      widthStorageKey={FILES_DOCK_WIDTH_STORAGE_KEY}
      defaultWidth={FILES_DOCK_DEFAULT_WIDTH}
      sheetAnimationDurationMs={animationsActive ? durationMs : 0}
      onCloseSheet={() => store().close(dockRef)}
      open={dockState.isOpen}
      maximized={false}
      keybindings={props.keybindings}
      getShortcutContext={props.getShortcutContext}
      surfaces={presence.value?.surfaces ?? []}
      environmentId={props.threadRef.environmentId}
      activeSurfaceId={renderedSurface?.id ?? null}
      pendingSurfaceIds={props.pendingSurfaceIds}
      previewSessions={NO_PREVIEW_SESSIONS}
      desktopByTabId={NO_PREVIEW_SESSIONS}
      terminalLabelsById={NO_TERMINAL_LABELS}
      onActivate={(surface) => store().activateSurface(dockRef, surface.id)}
      onCloseSurface={(surface) => store().closeSurface(dockRef, surface.id)}
      onCloseOtherSurfaces={(surface) => store().closeOtherSurfaces(dockRef, surface.id)}
      onCloseSurfacesToRight={(surface) => store().closeSurfacesToRight(dockRef, surface.id)}
      onCloseAllSurfaces={() => store().closeAllSurfaces(dockRef)}
      onMoveSurface={(surfaceId, toIndex) => store().moveSurface(dockRef, surfaceId, toIndex)}
      onCopyFilePath={props.onCopyFilePath}
      onAddFiles={() => store().open(props.threadRef, "files")}
      onAddBrowser={unavailable}
      onAddBrowserInProfile={unavailable}
      onAddTerminal={unavailable}
      onAddDiff={unavailable}
      onAddPullRequest={unavailable}
      onAddPullRequests={unavailable}
      onAddDevice={unavailable}
      filesAvailable={props.filesAvailable}
      browserAvailable={false}
      terminalAvailable={false}
      diffAvailable={false}
      pullRequestAvailable={false}
      pullRequestsAvailable={false}
      deviceAvailable={false}
    >
      {props.renderContent(renderedSurface, dockState.isOpen)}
    </ChatRightPanel>
  );
}

/** Opens the dock (with the explorer when it has no tabs) or closes it. */
function toggleFilesDock(threadRef: ScopedThreadRef, filesAvailable: boolean): void {
  const store = useRightPanelStore.getState();
  const dockRef = filesDockRef(threadRef);
  const dock = selectThreadRightPanelState(store.byThreadKey, dockRef);
  if (dock.isOpen) {
    store.close(dockRef);
    return;
  }
  if (dock.surfaces.length > 0) {
    store.show(dockRef);
    return;
  }
  if (filesAvailable) store.open(dockRef, "files");
}

/** The chat header's button for the files dock; shown only while the explorer is on the left. */
export function FilesDockToggle(props: {
  readonly threadRef: ScopedThreadRef;
  readonly filesAvailable: boolean;
}) {
  const open = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, filesDockRef(props.threadRef)).isOpen,
  );
  const label = props.filesAvailable ? "Toggle file explorer" : "File explorer is unavailable";
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="mr-1 flex shrink-0 sm:mr-2" />}>
        <Toggle
          className="shrink-0 [-webkit-app-region:no-drag]"
          pressed={open}
          onPressedChange={() => toggleFilesDock(props.threadRef, props.filesAvailable)}
          aria-label="Toggle file explorer"
          data-files-dock-toggle
          variant="ghost"
          size="sm"
          disabled={!props.filesAvailable && !open}
        >
          <PanelLeftIcon className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
