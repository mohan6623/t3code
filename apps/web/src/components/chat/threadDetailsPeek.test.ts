import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  THREAD_DETAILS_PEEK_CLOSE_DELAY_MS,
  THREAD_DETAILS_PEEK_OPEN_DELAY_MS,
  endThreadDetailsPeek,
  holdThreadDetailsPeek,
  scheduleThreadDetailsPeek,
  useThreadDetailsPeekStore,
} from "./threadDetailsPeek";

const peekKey = () => useThreadDetailsPeekStore.getState().threadKey;

describe("thread details peek", () => {
  let held = false;
  beforeEach(() => {
    vi.useFakeTimers();
    held = false;
    vi.stubGlobal("document", { querySelector: () => (held ? {} : null) });
  });
  afterEach(() => {
    endThreadDetailsPeek();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens after the open delay and closes after the close delay unless the pointer returns", () => {
    scheduleThreadDetailsPeek("thread-a");
    vi.advanceTimersByTime(THREAD_DETAILS_PEEK_OPEN_DELAY_MS - 1);
    expect(peekKey()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(peekKey()).toBe("thread-a");

    scheduleThreadDetailsPeek(null);
    vi.advanceTimersByTime(THREAD_DETAILS_PEEK_CLOSE_DELAY_MS - 1);
    holdThreadDetailsPeek();
    vi.advanceTimersByTime(THREAD_DETAILS_PEEK_CLOSE_DELAY_MS);
    expect(peekKey()).toBe("thread-a");

    scheduleThreadDetailsPeek(null);
    vi.advanceTimersByTime(THREAD_DETAILS_PEEK_CLOSE_DELAY_MS);
    expect(peekKey()).toBeNull();
  });

  it("stays open while a popup opened from the peek is up", () => {
    scheduleThreadDetailsPeek("thread-a");
    vi.advanceTimersByTime(THREAD_DETAILS_PEEK_OPEN_DELAY_MS);
    held = true;
    scheduleThreadDetailsPeek(null);
    vi.advanceTimersByTime(THREAD_DETAILS_PEEK_CLOSE_DELAY_MS * 3);
    expect(peekKey()).toBe("thread-a");

    held = false;
    vi.advanceTimersByTime(THREAD_DETAILS_PEEK_CLOSE_DELAY_MS);
    expect(peekKey()).toBeNull();
  });

  it("a real toggle cancels a pending peek", () => {
    scheduleThreadDetailsPeek("thread-a");
    endThreadDetailsPeek();
    vi.advanceTimersByTime(THREAD_DETAILS_PEEK_OPEN_DELAY_MS);
    expect(peekKey()).toBeNull();
  });
});
