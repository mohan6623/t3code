import * as Schema from "effect/Schema";
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import { useResizeDrag } from "./useResizeDrag";

const WidthSchema = Schema.Finite;

/** The host must size itself from this custom property. */
export const RESIZABLE_WIDTH_PROPERTY = "--resizable-width";

export interface UseResizableWidthOptions {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly edge: "left" | "right";
  /**
   * Fork: drag well past the minimum width and the host slides shut, as a
   * VS Code sidebar does. Releasing there calls this; dragging back first
   * reopens it. The stored width stays the one from before the drag.
   */
  readonly onCollapse?: () => void;
}

/** Fork: past this share of the minimum width, a collapsible host snaps shut. */
const COLLAPSE_AT_MIN_WIDTH_SHARE = 0.5;
/** Fork: how long the snap shut or open slides, in ms. */
const COLLAPSE_SLIDE_MS = 180;

export interface ResizableWidthHandlers {
  readonly ref: (node: HTMLElement | null) => (() => void) | undefined;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
}

/** Persist on drag end to avoid a storage write on every animation frame. */
export function useResizableWidth(options: UseResizableWidthOptions): {
  readonly width: number;
  readonly handlers: ResizableWidthHandlers;
} {
  const { storageKey, defaultWidth, minWidth, maxWidth, edge, onCollapse } = options;

  const clamp = (value: number): number => {
    if (!Number.isFinite(value)) return defaultWidth;
    return Math.max(minWidth, Math.min(maxWidth, value));
  };

  const readWidth = () => {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const stored = getLocalStorageItem(storageKey, WidthSchema);
      return clamp(stored ?? defaultWidth);
    } catch (error) {
      console.error("Could not read persisted panel width.", error);
      return defaultWidth;
    }
  };
  const [widthState, setWidthState] = useState(() => ({ storageKey, width: readWidth() }));
  if (widthState.storageKey !== storageKey) {
    setWidthState({ storageKey, width: readWidth() });
  }

  const clampedWidth = clamp(widthState.width);

  const drag = useResizeDrag<HTMLElement>((event) => {
    const host = event.currentTarget.parentElement;
    // Disable drag transitions through transition-property; the host renders transition-duration.
    host?.style.setProperty("transition-property", "none");
    // The drag commits to the key and width it started from, even if the panel
    // switches keys before the pointer is released.
    const startStorageKey = storageKey;
    const startWidth = clampedWidth;
    // Fork: a collapsible host lets the pointer go below the minimum, so
    // `resize` can tell a drag past it; the width it draws still stops there.
    let collapsed = false;
    let slideTimer: number | null = null;
    const slide = () => {
      if (!host) return;
      host.style.setProperty("transition-property", "width");
      host.style.setProperty("transition-duration", `${COLLAPSE_SLIDE_MS}ms`);
      host.style.setProperty("transition-timing-function", "cubic-bezier(0.2, 0, 0, 1)");
      if (slideTimer !== null) window.clearTimeout(slideTimer);
      slideTimer = window.setTimeout(() => {
        slideTimer = null;
        host.style.setProperty("transition-property", "none");
      }, COLLAPSE_SLIDE_MS);
    };
    if (host && onCollapse) {
      // The contents keep their width and slide out under the clip, not squeeze.
      host.style.setProperty("overflow", "hidden");
      host.style.setProperty("--resizable-slide-width", `${startWidth}px`);
    }
    return {
      width: startWidth,
      edge,
      bounds: { min: onCollapse ? 0 : minWidth, max: maxWidth },
      resize(pointerWidth) {
        const nextCollapsed =
          onCollapse !== undefined && pointerWidth < minWidth * COLLAPSE_AT_MIN_WIDTH_SHARE;
        if (nextCollapsed !== collapsed) {
          collapsed = nextCollapsed;
          host?.toggleAttribute("data-resizable-collapsing", collapsed);
          slide();
        }
        const nextWidth = Math.max(minWidth, pointerWidth);
        host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${collapsed ? 0 : nextWidth}px`);
        if (!collapsed) host?.style.setProperty("--resizable-slide-width", `${nextWidth}px`);
        return nextWidth;
      },
      finish(finalWidth) {
        if (collapsed) {
          // Closed: the next open uses the width from before this drag.
          onCollapse?.();
          return;
        }
        setWidthState({ storageKey: startStorageKey, width: finalWidth });
        try {
          setLocalStorageItem(startStorageKey, finalWidth, WidthSchema);
        } catch (error) {
          console.error("Could not persist panel width.", error);
        }
      },
      cleanup(committed) {
        if (slideTimer !== null) window.clearTimeout(slideTimer);
        host?.style.removeProperty("transition-duration");
        host?.style.removeProperty("transition-timing-function");
        host?.style.removeProperty("overflow");
        host?.style.removeProperty("--resizable-slide-width");
        host?.removeAttribute("data-resizable-collapsing");
        host?.style.removeProperty("transition-property");
        // A committed collapse stays shut until `finish` unmounts the host.
        if (collapsed && committed) return;
        if (!committed) host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${startWidth}px`);
      },
    };
  });

  // Bounds can change mid-drag (sidebar opens, window narrows), and the render
  // that carries them rewrites the committed width, so re-apply the live pointer position.
  const { refresh } = drag;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reapplies the live drag pointer position to the DOM before paint when the bounds change
  useLayoutEffect(
    () => refresh({ min: onCollapse ? 0 : minWidth, max: maxWidth }),
    [refresh, minWidth, maxWidth, onCollapse],
  );

  return {
    width: clampedWidth,
    handlers: {
      ref: drag.ref,
      onPointerDown: drag.onPointerDown,
      onPointerMove: drag.onPointerMove,
      onPointerUp: drag.onPointerUp,
      onPointerCancel: drag.onPointerCancel,
      onLostPointerCapture: drag.onLostPointerCapture,
    },
  };
}
