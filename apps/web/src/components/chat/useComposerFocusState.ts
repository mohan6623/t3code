import { useState } from "react";

// Fork: upstream deleted this hook in its composer redesign; the fork keeps it for collapse on scroll.
export function useComposerFocusState() {
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerScrollCollapsed, setIsComposerScrollCollapsed] = useState(false);

  // Reaching the end of the timeline lifts a scroll collapse without moving
  // DOM focus to the editor.
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
