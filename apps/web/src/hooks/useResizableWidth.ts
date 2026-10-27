import * as Schema from "effect/Schema";
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import { useResizeDrag } from "./useResizeDrag";

const WidthSchema = Schema.Finite;

/**
 * Custom property the host element must size itself from.
 */
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
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Width is read on mount or storage-key changes and persisted on drag-end (not on every rAF tick
 * — would otherwise be ~60 writes/sec).
 */
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
  const latestOptions = useRef({ clamp, storageKey, width: clampedWidth, minWidth, onCollapse });
  useLayoutEffect(() => {
    latestOptions.current = { clamp, storageKey, width: clampedWidth, minWidth, onCollapse };
  }, [clamp, clampedWidth, minWidth, onCollapse, storageKey]);

  const { refresh, ...handlers } = useResizeDrag<HTMLElement>((event) => {
    const host = event.currentTarget.parentElement;
    // A collapsible host animates width; live drag writes must not. The host
    // renders its own transition-duration, so override a property it leaves alone.
    host?.style.setProperty("transition-property", "none");
    // Fork: the snap shut or open slides; plain drag moves stay instant.
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
    const stopSlide = () => {
      if (slideTimer !== null) window.clearTimeout(slideTimer);
      slideTimer = null;
      host?.style.removeProperty("transition-duration");
      host?.style.removeProperty("transition-timing-function");
    };
    if (host && onCollapse) {
      // The contents keep their width and slide out under the clip, not squeeze.
      host.style.setProperty("overflow", "hidden");
      host.style.setProperty("--resizable-slide-width", `${clampedWidth}px`);
    }
    return {
      width: clampedWidth,
      edge,
      resize(value) {
        const latest = latestOptions.current;
        const nextCollapsed =
          latest.onCollapse !== undefined && value < latest.minWidth * COLLAPSE_AT_MIN_WIDTH_SHARE;
        if (nextCollapsed !== collapsed) {
          collapsed = nextCollapsed;
          host?.toggleAttribute("data-resizable-collapsing", collapsed);
          slide();
        }
        const nextWidth = latest.clamp(value);
        host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${collapsed ? 0 : nextWidth}px`);
        if (!collapsed) host?.style.setProperty("--resizable-slide-width", `${nextWidth}px`);
        return nextWidth;
      },
      finish(finalWidth) {
        if (collapsed) {
          // Closed: the next open uses the width from before this drag.
          latestOptions.current.onCollapse?.();
          return;
        }
        setWidthState({ storageKey, width: finalWidth });
        try {
          setLocalStorageItem(latestOptions.current.storageKey, finalWidth, WidthSchema);
        } catch (error) {
          console.error("Could not persist panel width.", error);
        }
      },
      cleanup(committed) {
        stopSlide();
        host?.style.removeProperty("transition-property");
        host?.style.removeProperty("overflow");
        host?.style.removeProperty("--resizable-slide-width");
        host?.removeAttribute("data-resizable-collapsing");
        // A committed collapse stays shut until `finish` unmounts the host.
        if (collapsed && committed) return;
        // React skips the write when the rendered width did not change.
        if (!committed) {
          host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${latestOptions.current.width}px`);
        }
      },
    };
  }, storageKey);

  // Bounds can change mid-drag (sidebar opens, window narrows) and the render
  // rewrites the committed width, so re-apply the live pointer position.
  useLayoutEffect(refresh, [clamp, clampedWidth, refresh]);

  return { width: clampedWidth, handlers };
}
