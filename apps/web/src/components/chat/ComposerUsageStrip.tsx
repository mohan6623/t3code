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
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { providerClients } from "../settings/providerDriverMeta";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { ResetCredits, barColor } from "../usage/UsageLimits";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

const MINUTE = 60_000;
/** Badge layout: one text line beside stacked bars, or one row per window. */
const SPLIT_ROWS_STORAGE_KEY = "t3code:usage-badge-split-rows";
/** Whether the panel shows the account in use opened or folded. */
const CURRENT_OPEN_STORAGE_KEY = "t3code:usage-panel-current-open";

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
 * The windows to show. Cursor reports an overall figure plus one pool per
 * billing tier; the two pools are shown, Cursor's own models above API models,
 * and the overall figure (their sum, not a third quota) is left out.
 */
function relevantWindows(
  provider: ServerProvider,
  limits: ServerProviderUsageLimits,
): readonly ServerProviderUsageWindow[] {
  if (provider.driver !== "cursor") return limits.windows;
  const pools = ["autoPercentUsed", "apiPercentUsed"].flatMap((id) =>
    limits.windows.filter((window) => window.id === id),
  );
  return pools.length > 0 ? pools : limits.windows;
}

/** Cursor's panel order: its own models, then other models, then the overall figure. */
const CURSOR_PANEL_ORDER = ["autoPercentUsed", "apiPercentUsed", "totalPercentUsed"];

/** The windows the panel lists. Cursor's overall figure goes last; it is the pools' sum. */
function panelWindows(
  provider: ServerProvider,
  limits: ServerProviderUsageLimits,
): readonly ServerProviderUsageWindow[] {
  if (provider.driver !== "cursor") return limits.windows;
  const rank = (id: string) => {
    const index = CURSOR_PANEL_ORDER.indexOf(id);
    return index < 0 ? CURSOR_PANEL_ORDER.length : index;
  };
  return limits.windows.toSorted((left, right) => rank(left.id) - rank(right.id));
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
  // Plans without session or weekly windows (Cursor's pools) show their first two.
  return picked.length > 0 ? picked : windows.slice(0, 2);
}

function providerName(provider: ServerProvider): string {
  return (
    provider.displayName?.trim() || providerClients.get(provider.driver)?.label || provider.driver
  );
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

/** One limit inside an account card: name, bar, what is left, and when it resets. */
function WindowRow({
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
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium text-foreground">{window.label}</span>
        <span className="shrink-0 font-medium text-foreground tabular-nums">
          {clampPercent(window.usedPercent)}% used
        </span>
      </div>
      <Bar percent={window.usedPercent} color={color} className="h-1.5" />
      <div className="flex items-baseline justify-between gap-2 text-2xs text-muted-foreground tabular-nums">
        <span>{remainingPercent(window)}% left</span>
        {reset ? <span>Resets in {reset}</span> : null}
      </div>
    </div>
  );
}

/** Banked reset credits, folded away inside the account card until asked for. */
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
    <div className="border-t pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-start text-xs"
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
        <div className="pt-2">
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

/**
 * One account in one card. The header names the account; folded, it also
 * shows the badge's bars and figures. Opened, it lists every limit.
 */
function AccountCard({
  provider,
  limits,
  environmentId,
  now,
  inUse,
  open,
  onOpenChange,
}: {
  provider: ServerProvider;
  limits: ServerProviderUsageLimits;
  environmentId: EnvironmentId;
  now: number;
  inUse: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const color = barColor(provider.driver);
  const windows = panelWindows(provider, limits);
  const summaryWindows = badgeWindows(relevantWindows(provider, limits));
  return (
    <div className={cn("rounded-lg border bg-muted/30", inUse && "border-foreground/15")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full min-w-0 items-center gap-2 p-2.5 text-start text-xs"
      >
        <ProviderIcon provider={provider} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{providerName(provider)}</span>
            {inUse ? (
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-2xs text-muted-foreground">
                In use
              </span>
            ) : null}
          </span>
          {/* Folded other subscriptions show just their name; the plan line joins once opened. */}
          {(inUse || open) && provider.auth.label ? (
            <span className="truncate text-2xs text-muted-foreground">{provider.auth.label}</span>
          ) : null}
        </span>
        {/* Folded: the badge's bars and figures; reset times wait until the card opens. */}
        {open ? null : (
          <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground tabular-nums">
            <span className="flex w-10 shrink-0 flex-col gap-0.75">
              {summaryWindows.map((window) => (
                <Bar
                  key={window.id}
                  percent={window.usedPercent}
                  color={color}
                  {...(inUse ? {} : { className: "bg-foreground/15" })}
                />
              ))}
            </span>
            {/* Fixed width, so every card's bars start in one column whatever the figures. */}
            <span className="w-18 text-end">
              {summaryWindows.map((window) => `${clampPercent(window.usedPercent)}%`).join(" · ")}
            </span>
          </span>
        )}
        <ChevronDownIcon
          className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t px-2.5 pt-2.5 pb-3">
          {windows.map((window) => (
            <WindowRow key={window.id} window={window} color={color} now={now} />
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

/** Another subscription: folded until opened. */
function OtherAccount(props: {
  provider: ServerProvider;
  limits: ServerProviderUsageLimits;
  environmentId: EnvironmentId;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  return <AccountCard {...props} inUse={false} open={open} onOpenChange={setOpen} />;
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
  const [splitRows, setSplitRows] = useLocalStorage(SPLIT_ROWS_STORAGE_KEY, false, Schema.Boolean);
  const [currentOpen, setCurrentOpen] = useLocalStorage(
    CURRENT_OPEN_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
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
  const windows = relevantWindows(provider, limits);
  if (windows.length === 0) return null;

  const color = barColor(provider.driver);
  const cacheMinutes = cacheMinutesLeft(provider, modelSlug, lastRun, now);
  // One bar per window the plan has: the 5-hour session above the weekly
  // limit, or a single bar for plans with only one of them.
  const rows = badgeWindows(windows);
  const summary = rows
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
            className={cn(
              "flex min-w-0 shrink items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-xs text-muted-foreground/80 tabular-nums hover:bg-muted/50 hover:text-foreground",
              splitRows ? "min-h-6" : "py-0.5",
            )}
          />
        }
      >
        <ProviderIcon provider={provider} />
        {/* Beside two rows, lowercase letters make the name look low; lift it to the rows' middle. */}
        <span
          className={cn(
            "max-w-24 truncate @max-[26rem]/composer-surface:hidden",
            splitRows && "-translate-y-px",
          )}
        >
          {providerName(provider)}
        </span>
        {splitRows ? (
          <span className="flex min-w-0 flex-col text-2xs leading-3">
            {rows.map((window, index) => {
              const reset = resetsIn(window, now);
              return (
                <span key={window.id} className="flex items-center gap-1.5">
                  {/* With two rows, each bar leans toward the other so the pair reads as one. */}
                  <Bar
                    percent={window.usedPercent}
                    color={color}
                    className={cn(
                      "w-10 shrink-0",
                      rows.length > 1 && (index === 0 ? "translate-y-px" : "-translate-y-px"),
                    )}
                  />
                  {/* Fixed width so both rows' reset times start in one column. */}
                  <span className="w-6 shrink-0 text-end @max-[34rem]/composer-surface:hidden">
                    {clampPercent(window.usedPercent)}%
                  </span>
                  {reset ? (
                    <span className="truncate @max-[34rem]/composer-surface:hidden">{reset}</span>
                  ) : null}
                </span>
              );
            })}
          </span>
        ) : (
          <>
            {/* Thin stacked bars fit inside the text line, so the badge keeps its height.
                Nudged down to sit on the digits, which ride low in the line box. */}
            <span className="flex w-10 shrink-0 translate-y-px flex-col gap-0.5">
              {rows.map((window) => (
                <Bar key={window.id} percent={window.usedPercent} color={color} />
              ))}
            </span>
            <span className="truncate @max-[34rem]/composer-surface:hidden">{summary}</span>
          </>
        )}
        {cacheMinutes !== null ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-0.5 @max-[15rem]/composer-surface:hidden",
              cacheMinutes === 0 && "opacity-50",
            )}
          >
            <TimerIcon className="size-3" aria-hidden />
            {cacheMinutes}m
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" width="md" padding="compact">
        <div className="flex max-h-[min(70vh,36rem)] flex-col gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-2 px-0.5 pb-1">
            <span className="flex-1 text-sm font-semibold text-foreground">Usage limits</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {checkedAgo} ago
            </span>
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
          <AccountCard
            provider={provider}
            limits={limits}
            environmentId={environmentId}
            now={now}
            inUse
            open={currentOpen}
            onOpenChange={setCurrentOpen}
          />
          {others.length > 0 ? (
            <>
              <span className="px-0.5 pt-1 text-xs font-medium text-muted-foreground">
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
          <label className="flex cursor-pointer items-center justify-between gap-2 px-0.5 pt-1 text-xs text-muted-foreground">
            Show each limit on its own row
            <Switch size="sm" checked={splitRows} onCheckedChange={setSplitRows} />
          </label>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
