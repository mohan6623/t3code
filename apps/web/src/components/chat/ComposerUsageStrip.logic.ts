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

/**
 * Fork: why an account shows no usage. Null when the account is fine, or
 * simply has no subscription limits (an API key), which is no problem.
 */
export function accountProblem(
  provider: Pick<ServerProvider, "auth" | "status" | "usageLimits">,
): "Signed out" | "Not working" | "Usage unreadable" | null {
  if (provider.auth.status === "unauthenticated") return "Signed out";
  if (provider.status === "error") return "Not working";
  if (provider.usageLimits?.unavailable?.reason === "probeFailed") return "Usage unreadable";
  return null;
}

/**
 * Fork: the other accounts the usage panel lists. One account going down
 * must not hide the rest; it shows marked instead.
 */
export function otherUsageAccounts<
  Provider extends Pick<
    ServerProvider,
    "instanceId" | "enabled" | "installed" | "auth" | "status" | "usageLimits"
  >,
>(
  providers: readonly Provider[],
  current: Pick<ServerProvider, "instanceId">,
  hasUsableLimits: (provider: Provider) => boolean,
): readonly Provider[] {
  return providers.filter(
    (other) =>
      other.instanceId !== current.instanceId &&
      other.enabled &&
      other.installed &&
      (hasUsableLimits(other) || accountProblem(other) !== null),
  );
}
