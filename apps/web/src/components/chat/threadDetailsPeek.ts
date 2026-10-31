// Fork: hovering the closed thread details toggle peeks the card as a popover,
// timed like the sidebar peek in components/ui/sidebar.tsx.
import { create } from "zustand";

export const THREAD_DETAILS_PEEK_OPEN_DELAY_MS = 150;
export const THREAD_DETAILS_PEEK_CLOSE_DELAY_MS = 300;
// Popups opened from the peek render in portals outside it, so the pointer
// leaving the peek for one of them must not close it.
const THREAD_DETAILS_PEEK_HOLD_SELECTOR = [
  '[role="menu"]',
  '[data-slot="select-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="dialog-popup"]',
  '[data-slot="alert-dialog-popup"]',
  '[data-slot="popover-popup"]:not(:has([data-thread-details-panel]))',
  '[data-thread-details-panel="popover"]:hover',
].join(", ");

/** The scoped thread key whose details card is peeking, if any. */
export const useThreadDetailsPeekStore = create<{ threadKey: string | null }>(() => ({
  threadKey: null,
}));

let peekTimer: ReturnType<typeof setTimeout> | null = null;

export function holdThreadDetailsPeek() {
  if (peekTimer === null) return;
  clearTimeout(peekTimer);
  peekTimer = null;
}

/** Peeks the card of `threadKey` after a short delay, or ends the peek when it is null. */
export function scheduleThreadDetailsPeek(threadKey: string | null) {
  holdThreadDetailsPeek();
  const settle = () => {
    if (threadKey === null && document.querySelector(THREAD_DETAILS_PEEK_HOLD_SELECTOR)) {
      peekTimer = setTimeout(settle, THREAD_DETAILS_PEEK_CLOSE_DELAY_MS);
      return;
    }
    peekTimer = null;
    useThreadDetailsPeekStore.setState({ threadKey });
  };
  peekTimer = setTimeout(
    settle,
    threadKey === null ? THREAD_DETAILS_PEEK_CLOSE_DELAY_MS : THREAD_DETAILS_PEEK_OPEN_DELAY_MS,
  );
}

/** Opening or closing the panel for real ends any peek, including a pending one. */
export function endThreadDetailsPeek() {
  holdThreadDetailsPeek();
  useThreadDetailsPeekStore.setState({ threadKey: null });
}
