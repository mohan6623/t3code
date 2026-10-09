import { useCallback, useRef, useState } from "react";

export function useComposerFocusState() {
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerScrollCollapsed, setIsComposerScrollCollapsedState] = useState(false);
  // Timeline scroll handlers ask for the same value on every wheel and scroll
  // event. React still runs the composer for a repeated value, so drop repeats.
  const scrollCollapseRequestedRef = useRef(false);
  const setIsComposerScrollCollapsed = useCallback((collapsed: boolean) => {
    if (scrollCollapseRequestedRef.current === collapsed) return;
    scrollCollapseRequestedRef.current = collapsed;
    setIsComposerScrollCollapsedState(collapsed);
  }, []);

  // Reaching the end of the timeline lifts a scroll collapse without moving
  // DOM focus to the editor.
  const restoreAfterTimelineReachedEnd = useCallback(() => {
    setIsComposerScrollCollapsed(false);
  }, [setIsComposerScrollCollapsed]);

  return {
    isComposerFocused,
    setIsComposerFocused,
    isComposerScrollCollapsed,
    setIsComposerScrollCollapsed,
    restoreAfterTimelineReachedEnd,
  };
}
