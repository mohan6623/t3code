import { useRef, useState } from "react";

// Fork: upstream deleted this hook in its composer redesign; the fork keeps it for collapse on scroll.
export function useComposerFocusState() {
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerScrollCollapsed, setIsComposerScrollCollapsedState] = useState(false);
  // Timeline scroll handlers ask for the same value on every wheel and scroll
  // event. React still runs the composer for a repeated value, so drop repeats.
  const scrollCollapseRequestedRef = useRef(false);
  const setIsComposerScrollCollapsed = (collapsed: boolean) => {
    if (scrollCollapseRequestedRef.current === collapsed) return;
    scrollCollapseRequestedRef.current = collapsed;
    setIsComposerScrollCollapsedState(collapsed);
  };

  const restoreAfterTimelineReachedEnd = () => {
    setIsComposerScrollCollapsed(false);
  };

  return {
    isComposerFocused,
    setIsComposerFocused,
    isComposerScrollCollapsed,
    setIsComposerScrollCollapsed,
    restoreAfterTimelineReachedEnd,
  };
}
