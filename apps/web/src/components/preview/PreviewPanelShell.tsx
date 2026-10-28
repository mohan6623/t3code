import { type CSSProperties, type ReactNode, useLayoutEffect, useRef } from "react";
import {
  type PreviewPanelInlineSize,
  usePreviewPanelInlineSize,
} from "~/hooks/usePreviewPanelInlineSize";
import { RESIZABLE_WIDTH_PROPERTY } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

interface PreviewPanelShellProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  inlineSize?: PreviewPanelInlineSize;
  open?: boolean;
  /** Use a distinct key per surface to keep remembered widths independent. */
  widthStorageKey?: string;
  defaultWidth?: number;
  children: ReactNode;
}

export function PreviewPanelShell(props: PreviewPanelShellProps) {
  if (props.inlineSize) {
    return <PreviewPanelShellFrame {...props} inlineSize={props.inlineSize} />;
  }

  return <ResizablePreviewPanelShell {...props} />;
}

function ResizablePreviewPanelShell(props: PreviewPanelShellProps) {
  const inlineSize = usePreviewPanelInlineSize({
    enabled: props.mode === "inline" && !props.maximized,
    widthStorageKey: props.widthStorageKey,
    defaultWidth: props.defaultWidth,
  });
  return <PreviewPanelShellFrame {...props} inlineSize={inlineSize} />;
}

function PreviewPanelShellFrame(
  props: PreviewPanelShellProps & { inlineSize: PreviewPanelInlineSize },
) {
  const isInline = props.mode === "inline";
  const collapsible = isInline && props.open !== undefined;
  const open = props.open ?? true;
  const maximized = props.maximized ?? false;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const returnedFocus = useRef(false);
  const { width, handlers, observeRow } = props.inlineSize;
  // Fork: an open or close changes the chat's width once, at the start, and
  // only the panel slides (a transform, no layout per frame). Animating the
  // width made the chat text wrap again on every frame, and the list measured
  // each new wrap one frame late, so the messages jumped.
  const slides = collapsible && !maximized;
  const closed = collapsible && !open;
  const attachHost = (host: HTMLDivElement) => {
    hostRef.current = host;
    const stopObservingRow = observeRow(host);
    return () => {
      hostRef.current = null;
      stopObservingRow();
    };
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- on unmount, returns DOM focus to the panel toggle if removal dropped it on the body
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !collapsible) return;
    return () => {
      if (!host.contains(host.ownerDocument.activeElement) && !returnedFocus.current) return;
      // Unmount moves the toggle; restore focus at its committed location if removal sent focus to body.
      queueMicrotask(() => {
        if (host.ownerDocument.activeElement === host.ownerDocument.body) {
          host.ownerDocument.querySelector<HTMLButtonElement>("[data-right-panel-toggle]")?.focus();
        }
      });
    };
  }, [collapsible, hostRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves focus to the toggle and sets inert on the host DOM node before a collapse paints
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const collapsed = collapsible && !open;
    if (!collapsed) returnedFocus.current = false;
    // Move focus before making its current owner inert, while the toggle is reachable.
    if (collapsed && host.contains(host.ownerDocument.activeElement)) {
      const toggle = host.ownerDocument.querySelector<HTMLButtonElement>(
        "[data-right-panel-toggle]",
      );
      toggle?.focus();
      returnedFocus.current = toggle !== null && host.ownerDocument.activeElement === toggle;
    }
    host.toggleAttribute("inert", collapsed);
  }, [collapsible, open, hostRef]);
  return (
    <div
      ref={attachHost}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 max-w-full flex-col self-stretch bg-background",
        isInline
          ? maximized
            ? // Maximizing meets the sidebar border or window edge; omit the duplicate border.
              "flex-1"
            : slides
              ? // Fork: the edge line slides with the panel.
                "shrink-0"
              : "shrink-0 border-l border-border"
          : "w-full",
        // Closed, the panel takes no room: it sits over the chat's right edge,
        // slid out, and hides once the slide ends.
        closed &&
          (slides
            ? "pointer-events-none invisible absolute inset-y-0 right-0 z-50 bg-transparent [[data-panel-animations=true]_&]:transition-[visibility] [[data-panel-animations=true]_&]:duration-(--panel-animation-duration)"
            : "pointer-events-none"),
      )}
      style={
        isInline
          ? ({
              [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
              width: maximized
                ? "100%"
                : collapsible && !open && !slides
                  ? "0px"
                  : `var(${RESIZABLE_WIDTH_PROPERTY})`,
            } as CSSProperties)
          : undefined
      }
      data-preview-panel-mode={props.mode}
      data-preview-panel-maximized={maximized ? "true" : "false"}
    >
      {isInline && !maximized ? <RightPanelResizeHandle handlers={handlers} /> : null}
      <div className={cn("h-full min-h-0 w-full", collapsible && "overflow-clip")}>
        <div
          className={cn(
            "flex h-full min-h-0 min-w-0 flex-col",
            slides &&
              "border-l border-border bg-background [[data-panel-animations=true]_&]:transition-transform [[data-panel-animations=true]_&]:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:ease-out",
            slides && (closed ? "translate-x-full" : "starting:translate-x-full"),
          )}
          style={slides ? { width: `var(${RESIZABLE_WIDTH_PROPERTY})` } : undefined}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
