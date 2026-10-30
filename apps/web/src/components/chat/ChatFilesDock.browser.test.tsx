// Fork: the files dock left of the chat ("File explorer side: Left").
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { filesDockRef, selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { ChatFilesDock, FilesDockToggle } from "./ChatFilesDock";
import "~/index.css";

const threadRef = scopeThreadRef(EnvironmentId.make("environment-dock"), ThreadId.make("thread-1"));
const dockRef = filesDockRef(threadRef);

function dock(renderContent = vi.fn((surface: { id: string } | null) => surface?.id ?? "none")) {
  return (
    <div style={{ display: "flex", width: "1200px", height: "600px", position: "relative" }}>
      <FilesDockToggle threadRef={threadRef} filesAvailable />
      <ChatFilesDock
        threadRef={threadRef}
        threadKey={scopedThreadKey(threadRef)}
        sheet={false}
        workspaceLayoutElement={null}
        keybindings={[]}
        getShortcutContext={() => ({}) as never}
        pendingSurfaceIds={new Set()}
        filesAvailable
        onCopyFilePath={() => undefined}
        renderContent={(surface) => <div data-testid="dock-content">{renderContent(surface)}</div>}
      />
      <main data-testid="chat" style={{ flex: 1 }} />
    </div>
  );
}

const dockState = () =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, dockRef);

/** Puts the explorer on the left for one test and resets the store after it. */
function explorerOnLeft(): Disposable {
  useRightPanelStore.getState().setFileSurfaceSide("left");
  return {
    [Symbol.dispose]: () =>
      useRightPanelStore.setState({ byThreadKey: {}, fileSurfaceSide: "right" }),
  };
}

describe("ChatFilesDock", () => {
  it("shows files opened on the left in a panel before the chat, resizable on its right edge", async () => {
    using _left = explorerOnLeft();
    await using screen = await render(dock());
    expect(screen.container.querySelector('[data-workspace-area="files-dock"]')).toBeNull();

    await act(() => useRightPanelStore.getState().openFile(threadRef, "src/app.ts", 3));

    const panel = screen.container.querySelector<HTMLElement>('[data-workspace-area="files-dock"]');
    expect(panel).not.toBeNull();
    // The dock sits left of the chat column.
    const chat = screen.container.querySelector<HTMLElement>('[data-testid="chat"]')!;
    expect(panel!.getBoundingClientRect().right).toBeLessThanOrEqual(
      chat.getBoundingClientRect().left + 1,
    );
    expect(panel!.querySelector('[data-testid="dock-content"]')?.textContent).toBe(
      "file:src/app.ts",
    );
    // Its resize handle is on the chat side, and it has no new-tab menu.
    const handle = panel!.querySelector<HTMLElement>('[role="separator"]')!;
    expect(handle.getBoundingClientRect().left).toBeGreaterThan(
      panel!.getBoundingClientRect().left + panel!.getBoundingClientRect().width / 2,
    );
    expect(panel!.querySelector('[aria-label="Add panel surface"]')).toBeNull();
    expect(panel!.querySelector('[aria-label="Open file explorer"]')).not.toBeNull();
  });

  it("collapses and reopens from the header toggle, keeping its tabs", async () => {
    using _left = explorerOnLeft();
    useRightPanelStore.getState().openFile(threadRef, "README.md");
    await using screen = await render(dock());
    const toggle = screen.container.querySelector<HTMLButtonElement>("[data-files-dock-toggle]")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    await act(() => toggle.click());
    expect(dockState().isOpen).toBe(false);
    expect(dockState().surfaces.map((surface) => surface.id)).toEqual(["file:README.md"]);

    await act(() => toggle.click());
    expect(dockState().isOpen).toBe(true);
    expect(dockState().activeSurfaceId).toBe("file:README.md");
  });

  it("opens the explorer when toggled with no tabs", async () => {
    using _left = explorerOnLeft();
    await using screen = await render(dock());
    await act(() =>
      screen.container.querySelector<HTMLButtonElement>("[data-files-dock-toggle]")!.click(),
    );
    expect(dockState()).toMatchObject({ isOpen: true, activeSurfaceId: "files" });
    await vi.waitFor(() =>
      expect(
        screen.container.querySelector('[data-workspace-area="files-dock"]')?.textContent,
      ).toContain("files"),
    );
  });
});
