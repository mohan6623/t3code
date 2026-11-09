// Fork: per-theme opt-in for the Nightly/Dev sidebar and send-button artwork on non-built-in themes.
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "t3code:theme-artwork-opt-in";
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> | null = null;

function readStored(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function getThemeArtworkOptIns(): ReadonlySet<string> {
  snapshot ??= readStored();
  return snapshot;
}

function subscribeToThemeArtworkOptIns(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThemeArtworkOptIn(themeId: string, enabled: boolean): void {
  const next = new Set(getThemeArtworkOptIns());
  if (enabled) next.add(themeId);
  else next.delete(themeId);
  snapshot = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
  for (const listener of listeners) listener();
}

export function useThemeArtworkOptIns(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeToThemeArtworkOptIns,
    getThemeArtworkOptIns,
    getThemeArtworkOptIns,
  );
}
