import type {
  EnvironmentId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  formatDuration,
  limitsNotice,
  providersWithLimits,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { ChevronDownIcon, TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { getDriverOption } from "../settings/providerDriverMeta";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ResetCredits, barColor } from "../usage/UsageLimits";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

const MINUTE = 60_000;

/** Re-renders once a minute so reset countdowns stay current without animating. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function clampPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function resetsIn(window: ServerProviderUsageWindow, now: number): string | null {
  if (window.resetsAt === undefined) return null;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) && at > now ? formatDuration(at - now) : null;
}

function usableLimits(provider: ServerProvider): ServerProviderUsageLimits | null {
  const limits = provider.usageLimits;
  return limits && limitsNotice(limits) === null ? limits : null;
}

/** Cursor bills its own models (Composer, Grok, Auto) from a separate pool. */
function isCursorOwnModel(slug: string | undefined): boolean {
  if (!slug) return false;
  const model = slug.toLowerCase();
  return model === "default" || model.startsWith("composer") || model.startsWith("grok");
}

/**
 * The windows that apply to the selected model. Cursor reports an overall
 * figure plus one pool per billing tier; only the active tier is shown.
 */
function relevantWindows(
  provider: ServerProvider,
  limits: ServerProviderUsageLimits,
  modelSlug: string | undefined,
): readonly ServerProviderUsageWindow[] {
  if (provider.driver !== "cursor") return limits.windows;
  const poolId = isCursorOwnModel(modelSlug) ? "autoPercentUsed" : "apiPercentUsed";
  const pool = limits.windows.filter((window) => window.id === poolId);
  return pool.length > 0 ? pool : limits.windows;
}

/**
 * Prompt-cache lifetime in minutes, by provider. Claude subscriptions get a
 * 1-hour cache; Codex keeps roughly 10 idle minutes; Cursor uses the
 * upstream default of 5 minutes for most models. Estimates, not reported.
 */
function cacheTtlMinutes(provider: ServerProvider, modelSlug: string | undefined): number | null {
  switch (provider.driver) {
    case "claudeAgent":
      return 60;
    case "codex":
      return 10;
    case "cursor":
      return isCursorOwnModel(modelSlug) ? null : 5;
    default:
      return null;
  }
}

/** Whole minutes until the cache from the last turn goes cold; full while a turn runs. */
function cacheMinutesLeft(
  provider: ServerProvider,
  modelSlug: string | undefined,
  lastRun: { readonly completedAt: string | null } | null | undefined,
  now: number,
): number | null {
  const ttl = cacheTtlMinutes(provider, modelSlug);
  if (ttl === null || !lastRun) return null;
  if (lastRun.completedAt === null) return ttl;
  const elapsed = (now - Date.parse(lastRun.completedAt)) / MINUTE;
  return Number.isFinite(elapsed) ? Math.max(0, Math.ceil(ttl - elapsed)) : null;
}

/**
 * The badge names the session and the main weekly window only; per-model
 * weekly windows (e.g. "Weekly · Fable") stay in the panel.
 */
function badgeWindows(
  windows: readonly ServerProviderUsageWindow[],
): readonly ServerProviderUsageWindow[] {
  const session = windows.find((window) => window.kind === "session");
  const weekly = windows.find((window) => window.kind === "weekly");
  const picked = [session, weekly].filter((window) => window !== undefined);
  return picked.length > 0 ? picked : windows.slice(0, 1);
}

function providerName(provider: ServerProvider): string {
  return provider.displayName?.trim() || getDriverOption(provider.driver)?.label || provider.driver;
}

function driverLabel(provider: ServerProvider): string {
  return getDriverOption(provider.driver)?.label ?? String(provider.driver);
}

function ProviderIcon({ provider, className }: { provider: ServerProvider; className?: string }) {
  return (
    <ProviderInstanceIcon
      driverKind={provider.driver}
      displayName={providerName(provider)}
      accentColor={provider.accentColor}
      className={cn("size-3.5", className)}
      iconClassName={cn("size-3.5", className)}
    />
  );
}

function Bar({
  percent,
  color,
  className,
}: {
  percent: number;
  color: string;
  className?: string;
}) {
  return (
    <span className={cn("block h-1 overflow-hidden rounded-full bg-muted", className)}>
      <span
        className="block h-full rounded-full"
        style={{ width: `${clampPercent(percent)}%`, backgroundColor: color }}
      />
    </span>
  );
}

function WindowCard({
  window,
  color,
  now,
}: {
  window: ServerProviderUsageWindow;
  color: string;
  now: number;
}) {
  const reset = resetsIn(window, now);
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">{window.label}</span>
        <span className="font-medium text-foreground tabular-nums">
          {clampPercent(window.usedPercent)}% used
        </span>
      </div>
      <Bar percent={window.usedPercent} color={color} className="h-1.5" />
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span>{remainingPercent(window)}% remaining</span>
        {reset ? <span>Resets in {reset}</span> : null}
      </div>
    </div>
  );
}

/** Banked reset credits, folded away until asked for. */
function BankedResets({
  provider,
  limits,
  environmentId,
  now,
}: {
  provider: ServerProvider;
  limits: ServerProviderUsageLimits;
  environmentId: EnvironmentId;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const credits = limits.resetCredits;
  if (!credits || credits.availableCount === 0) return null;
  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 p-3 text-start text-xs"
      >
        <span className="font-medium text-foreground">Banked resets</span>
        <span className="rounded-full bg-muted px-1.5 text-muted-foreground tabular-nums">
          {credits.availableCount}
        </span>
        <ChevronDownIcon
          className={cn("ms-auto size-3.5 text-muted-foreground", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="px-3 pb-3">
          <ResetCredits
            environmentId={environmentId}
            input={{ instanceId: provider.instanceId }}
            credits={credits}
            now={now}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Another subscription: one line, expandable to its windows. */
function OtherAccount({
  provider,
  limits,
  environmentId,
  now,
}: {
  provider: ServerProvider;
  limits: ServerProviderUsageLimits;
  environmentId: EnvironmentId;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const color = barColor(provider.driver);
  const tightestWindow = limits.windows.reduce<ServerProviderUsageWindow | null>(
    (a, b) => (a === null || b.usedPercent > a.usedPercent ? b : a),
    null,
  );
  const tightest = tightestWindow?.usedPercent ?? 0;
  const reset = tightestWindow ? resetsIn(tightestWindow, now) : null;
  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 p-2.5 text-start text-xs"
      >
        <ProviderIcon provider={provider} />
        <span className="min-w-0 truncate font-medium text-foreground">
          {providerName(provider)}
        </span>
        <Bar percent={tightest} color={color} className="ms-auto w-12 shrink-0" />
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {clampPercent(tightest)}%{reset ? ` · ${reset}` : ""}
        </span>
        <ChevronDownIcon
          className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-2.5 pb-2.5">
          {limits.windows.map((window) => (
            <WindowCard key={window.id} window={window} color={color} now={now} />
          ))}
          <BankedResets
            provider={provider}
            limits={limits}
            environmentId={environmentId}
            now={now}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Usage badge for the composer's context strip: the selected account's limits
 * at a glance. Clicking opens a panel with that account in full and every
 * other subscription folded underneath.
 */
export function ComposerUsageStrip({
  provider,
  providers,
  environmentId,
  modelSlug,
  lastRun,
}: {
  readonly provider: ServerProvider | null;
  readonly providers: readonly ServerProvider[];
  readonly environmentId: EnvironmentId;
  readonly modelSlug?: string | undefined;
  /** The thread's latest run; null before the first turn. */
  readonly lastRun?: { readonly completedAt: string | null } | null | undefined;
}) {
  const now = useMinuteClock();
  const [refreshing, setRefreshing] = useState(false);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  // Instances report limits only once probed; check them all up front so the
  // panel lists every subscription, not just the ones selected this session.
  useEffect(() => {
    void refreshUsageLimits(
      environmentId,
      () => refreshProviders({ environmentId, input: {} }),
      true,
    ).catch(() => undefined);
  }, [environmentId, refreshProviders]);

  const limits = provider ? usableLimits(provider) : null;
  if (!provider || !limits) return null;
  const windows = relevantWindows(provider, limits, modelSlug);
  if (windows.length === 0) return null;

  const color = barColor(provider.driver);
  const tightest = windows.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
  const cacheMinutes = cacheMinutesLeft(provider, modelSlug, lastRun, now);
  const summary = badgeWindows(windows)
    .map((window) => {
      const reset = resetsIn(window, now);
      return `${clampPercent(window.usedPercent)}%${reset ? ` ${reset}` : ""}`;
    })
    .join(" · ");
  const others = providersWithLimits(providers).filter(
    (other) => other.instanceId !== provider.instanceId && usableLimits(other) !== null,
  );
  const checkedAgo = formatDuration(now - Date.parse(limits.checkedAt));

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void refreshUsageLimits(environmentId, () => refreshProviders({ environmentId, input: {} }))
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          void refreshUsageLimits(
            environmentId,
            () => refreshProviders({ environmentId, input: {} }),
            true,
          ).catch(() => undefined);
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`${providerName(provider)} usage limits`}
            className="flex min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/80 tabular-nums hover:bg-muted/50 hover:text-foreground"
          />
        }
      >
        <ProviderIcon provider={provider} />
        <span className="max-w-24 truncate">{providerName(provider)}</span>
        <Bar percent={tightest.usedPercent} color={color} className="w-10 shrink-0" />
        <span className="truncate">{summary}</span>
        {cacheMinutes !== null ? (
          <span
            className={cn("flex shrink-0 items-center gap-0.5", cacheMinutes === 0 && "opacity-50")}
          >
            <TimerIcon className="size-3" aria-hidden />
            {cacheMinutes}m
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" width="md" padding="compact">
        <div className="flex max-h-[min(70vh,36rem)] flex-col gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-start gap-2.5 px-0.5 pb-1">
            <ProviderIcon provider={provider} className="mt-0.5 size-5" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">
                {driverLabel(provider)} usage
              </span>
              <span className="text-xs text-muted-foreground">
                Updated {checkedAgo} ago
                {cacheMinutes !== null
                  ? cacheMinutes > 0
                    ? ` · Cache ~${cacheMinutes}m left`
                    : " · Cache expired"
                  : ""}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {providerName(provider)}
                {provider.auth.label ? ` · ${provider.auth.label}` : ""}
              </span>
            </div>
            <button
              type="button"
              aria-label="Refresh usage limits"
              disabled={refreshing}
              onClick={refresh}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshIcon size="sm" refreshing={refreshing} />
            </button>
          </div>
          {windows.map((window) => (
            <WindowCard key={window.id} window={window} color={color} now={now} />
          ))}
          <BankedResets
            provider={provider}
            limits={limits}
            environmentId={environmentId}
            now={now}
          />
          {others.length > 0 ? (
            <>
              <span className="px-0.5 pt-2 text-xs font-medium text-muted-foreground">
                Other subscriptions
              </span>
              {others.map((other) => {
                const otherLimits = usableLimits(other);
                return otherLimits ? (
                  <OtherAccount
                    key={other.instanceId}
                    provider={other}
                    limits={otherLimits}
                    environmentId={environmentId}
                    now={now}
                  />
                ) : null;
              })}
            </>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
