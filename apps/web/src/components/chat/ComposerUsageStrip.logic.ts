import type { ServerProvider } from "@t3tools/contracts";

const MINUTE = 60_000;

/** Cursor bills its own models (Composer, Grok, Auto) from a separate pool. */
function isCursorOwnModel(slug: string | undefined): boolean {
  if (!slug) return false;
  const model = slug.toLowerCase();
  return model === "default" || model.startsWith("composer") || model.startsWith("grok");
}

/**
 * Prompt-cache lifetime in minutes by model family, for harnesses that route
 * to other vendors' APIs: Anthropic's default cache lasts 5 minutes, OpenAI
 * keeps prompts cached for at least 30. Unknown families have no estimate.
 */
function modelFamilyCacheTtlMinutes(modelSlug: string | undefined): number | null {
  const model = modelSlug?.toLowerCase() ?? "";
  if (/claude|anthropic|opus|sonnet|haiku|fable/.test(model)) return 5;
  if (/gpt|openai|codex|(^|\/)o\d/.test(model)) return 30;
  return null;
}

/**
 * Prompt-cache lifetime in minutes. Claude reports the tier its last turn
 * wrote (1 hour on subscriptions, 5 minutes for API keys and subagents);
 * before that report a subscription's hour is assumed. Codex caches for at
 * least 30 minutes. Cursor's own models do not document a cache lifetime.
 */
export function cacheTtlMinutes(
  provider: Pick<ServerProvider, "driver">,
  modelSlug: string | undefined,
  reportedTtlMs: number | undefined,
): number | null {
  switch (provider.driver) {
    case "claudeAgent":
      return reportedTtlMs === undefined ? 60 : Math.round(reportedTtlMs / MINUTE);
    case "codex":
      return 30;
    case "cursor":
      return isCursorOwnModel(modelSlug) ? null : modelFamilyCacheTtlMinutes(modelSlug);
    case "opencode":
      return modelFamilyCacheTtlMinutes(modelSlug);
    default:
      return null;
  }
}

/** Whole minutes until the cache from the last turn goes cold; full while a turn runs. */
export function cacheMinutesLeft(
  provider: Pick<ServerProvider, "driver">,
  modelSlug: string | undefined,
  reportedTtlMs: number | undefined,
  lastRun: { readonly completedAt: string | null } | null | undefined,
  now: number,
): number | null {
  const ttl = cacheTtlMinutes(provider, modelSlug, reportedTtlMs);
  if (ttl === null || !lastRun) return null;
  if (lastRun.completedAt === null) return ttl;
  const elapsed = (now - Date.parse(lastRun.completedAt)) / MINUTE;
  return Number.isFinite(elapsed) ? Math.max(0, Math.ceil(ttl - elapsed)) : null;
}
