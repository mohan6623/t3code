import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * Fork: the ways a folded account card can draw its two limits. The user picks
 * one in the usage panel's style settings; every card uses the same style.
 */
export const UsageSummaryStyle = Schema.Literals([
  "bars",
  "blocks",
  "table",
  "dots",
  "wave",
  "tug",
  "subdial",
  "horizon",
  "fader",
  "chevrons",
  "pie",
  "signal",
  "hexagons",
  "sparks",
  "pennants",
]);
export type UsageSummaryStyle = typeof UsageSummaryStyle.Type;

export const USAGE_SUMMARY_STYLES: ReadonlyArray<{
  readonly id: UsageSummaryStyle;
  readonly label: string;
}> = [
  { id: "bars", label: "Bars" },
  { id: "blocks", label: "Blocks" },
  { id: "table", label: "Table" },
  { id: "dots", label: "Dots" },
  { id: "wave", label: "Wave" },
  { id: "tug", label: "Tug" },
  { id: "subdial", label: "Dial" },
  { id: "horizon", label: "Horizon" },
  { id: "fader", label: "Fader" },
  { id: "chevrons", label: "Chevrons" },
  { id: "pie", label: "Pie" },
  { id: "signal", label: "Signal" },
  { id: "hexagons", label: "Hexagons" },
  { id: "sparks", label: "Sparks" },
  { id: "pennants", label: "Pennants" },
];

export function clampPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function resetsIn(window: ServerProviderUsageWindow, now: number): string | null {
  if (window.resetsAt === undefined) return null;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) && at > now ? formatDuration(at - now) : null;
}

export function Bar({
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

/** "5h", "7d": the window's length, or the start of its name when the plan reports none. */
function shortLabel(window: ServerProviderUsageWindow): string {
  const minutes = window.windowDurationMins;
  if (minutes && (window.kind === "session" || window.kind === "weekly")) {
    return minutes < 24 * 60 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  }
  if (window.kind === "session") return "5h";
  if (window.kind === "weekly") return "7d";
  return (window.label.split(/\W/)[0] ?? window.label).slice(0, 3);
}

interface SummaryProps {
  readonly windows: readonly ServerProviderUsageWindow[];
  readonly color: string;
  /** The account in use keeps the darker track; other cards get a lighter one. */
  readonly inUse: boolean;
  readonly now: number;
  /**
   * Badge size: shapes shrink so the badge is no taller than the dock's 24px
   * buttons, and the figures hide when the composer is narrow.
   */
  readonly compact?: boolean | undefined;
}

const TEXT = "text-2xs leading-none text-muted-foreground tabular-nums";

/** Percent and reset time in fixed columns, so every card's figures line up. */
function Figures({ windows, now, compact }: Pick<SummaryProps, "windows" | "now" | "compact">) {
  const figures = (
    <span className="flex shrink-0 flex-col gap-0.5">
      {windows.map((window) => (
        <span key={window.id} className="flex items-center gap-1.5">
          <span className="w-7 shrink-0 text-end text-foreground/80">
            {clampPercent(window.usedPercent)}%
          </span>
          <span className="w-12 shrink-0 truncate">{resetsIn(window, now)}</span>
        </span>
      ))}
    </span>
  );
  return compact ? <FoldingLabel>{figures}</FoldingLabel> : figures;
}

/**
 * Badge figures fold away when the composer strip runs short of room, before the
 * model controls have to give way. The strip reads this label's natural width
 * (`data-composer-label-fixed`) to decide, the same way it folds its Git labels.
 */
export function FoldingLabel({ children }: { children: ReactNode }) {
  return (
    <span
      data-composer-label
      data-composer-label-fixed
      className="flex max-w-60 min-w-0 shrink-0 overflow-hidden transition-opacity duration-180 ease-drawer group-data-[compact]/composer-context:max-w-0 group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-none"
    >
      {children}
    </span>
  );
}

/** One line per limit; each bar leans toward the other so the pair reads as one gauge. */
function BarsSummary({ windows, color, inUse, now }: SummaryProps) {
  return (
    <span className={cn("flex shrink-0 flex-col", TEXT)}>
      {windows.map((window, index) => (
        <span key={window.id} className="flex items-center gap-1.5">
          <Bar
            percent={window.usedPercent}
            color={color}
            className={cn(
              "w-10 shrink-0",
              windows.length > 1 && (index === 0 ? "translate-y-0.5" : "-translate-y-0.5"),
              !inUse && "bg-foreground/15",
            )}
          />
          <span className="w-7 shrink-0 text-end text-foreground/80">
            {clampPercent(window.usedPercent)}%
          </span>
          <span className="w-12 shrink-0 truncate">{resetsIn(window, now)}</span>
        </span>
      ))}
    </span>
  );
}

/** Each limit is its own small box that fills behind its figures. */
function BlocksSummary({ windows, color, inUse, now }: SummaryProps) {
  return (
    <span className={cn("flex w-24 shrink-0 flex-col gap-0.5", TEXT)}>
      {windows.map((window) => (
        <span
          key={window.id}
          className={cn(
            "relative flex items-center justify-between overflow-hidden rounded-sm px-1 py-0.5",
            inUse ? "bg-muted" : "bg-foreground/10",
          )}
        >
          <span
            className="absolute inset-y-0 start-0"
            style={{
              width: `${clampPercent(window.usedPercent)}%`,
              backgroundColor: `color-mix(in oklab, ${color} 35%, transparent)`,
            }}
          />
          <span className="relative text-foreground/90">{clampPercent(window.usedPercent)}%</span>
          <span className="relative text-foreground/70">{resetsIn(window, now)}</span>
        </span>
      ))}
    </span>
  );
}

/** A small named table: 5h and 7d, each with a short bar. */
function TableSummary({ windows, color, inUse, now }: SummaryProps) {
  return (
    <span
      className={cn("flex shrink-0 flex-col gap-0.5 rounded-md bg-foreground/5 px-1 py-1", TEXT)}
    >
      {windows.map((window) => (
        <span key={window.id} className="flex items-center gap-1">
          <span className="w-4 shrink-0 text-muted-foreground/70">{shortLabel(window)}</span>
          <Bar
            percent={window.usedPercent}
            color={color}
            className={cn("w-5 shrink-0", !inUse && "bg-foreground/15")}
          />
          <span className="w-7 shrink-0 text-end text-foreground/80">
            {clampPercent(window.usedPercent)}%
          </span>
          <span className="w-11 shrink-0 truncate">{resetsIn(window, now)}</span>
        </span>
      ))}
    </span>
  );
}

/** Ten tall dots per limit, each one 10%. */
function DotsSummary({ windows, color, inUse, now, compact }: SummaryProps) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TEXT)}>
      <span className="flex shrink-0 flex-col gap-0.5">
        {windows.map((window) => {
          const lit = Math.round(clampPercent(window.usedPercent) / 10);
          return (
            <span key={window.id} className="flex gap-px">
              {Array.from({ length: 10 }, (_, dot) => (
                <span
                  key={dot}
                  className={cn("h-1.5 w-1 rounded-full", inUse ? "bg-muted" : "bg-foreground/15")}
                  style={dot < lit ? { backgroundColor: color } : undefined}
                />
              ))}
            </span>
          );
        })}
      </span>
      <Figures windows={windows} now={now} compact={compact} />
    </span>
  );
}

/** One hill per limit on a shared baseline; the taller hill is the fuller limit. */
function WaveSummary({ windows, color, inUse, now }: SummaryProps) {
  const base = 14;
  const width = 144;
  const span = width / Math.max(1, windows.length);
  let path = `M 0 ${base}`;
  for (const [index, window] of windows.entries()) {
    const top = base - (clampPercent(window.usedPercent) / 100) * 12;
    const start = index * span;
    const peak = start + span / 2;
    const end = start + span;
    path += ` C ${start + span * 0.22} ${base} ${peak - span * 0.22} ${top} ${peak} ${top}`;
    path += ` C ${peak + span * 0.22} ${top} ${end - span * 0.22} ${base} ${end} ${base}`;
  }
  return (
    <span className={cn("flex w-36 shrink-0 flex-col gap-0.5", TEXT)}>
      <svg
        viewBox={`0 0 ${width} 14`}
        className={cn("h-3.5 w-36 shrink-0", !inUse && "opacity-70")}
        aria-hidden
      >
        <path d={`${path} L ${width} ${base} L 0 ${base} Z`} fill={color} opacity={0.16} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
        <line
          x1={0}
          y1={base}
          x2={width}
          y2={base}
          strokeWidth={1}
          className="stroke-foreground/15"
        />
      </svg>
      <span className="flex items-baseline">
        {windows.map((window) => (
          <span key={window.id} className="flex flex-1 items-baseline justify-center gap-1">
            <span className="w-7 shrink-0 text-end text-foreground/80">
              {clampPercent(window.usedPercent)}%
            </span>
            <span className="w-9 shrink-0 truncate">{resetsIn(window, now)}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** One bar: the first limit fills from the left, the second from the right. */
function TugSummary({ windows, color, inUse, now }: SummaryProps) {
  const share = windows.length > 1 ? 2 : 1;
  return (
    <span className={cn("flex w-32 shrink-0 flex-col gap-1", TEXT)}>
      <span
        className={cn(
          "relative block h-1.5 w-full overflow-hidden rounded-full",
          inUse ? "bg-muted" : "bg-foreground/15",
        )}
      >
        {windows.map((window, index) => (
          <span
            key={window.id}
            className={cn(
              "absolute inset-y-0",
              index === 0 ? "start-0 rounded-s-full" : "end-0 rounded-e-full",
            )}
            style={{
              width: `${clampPercent(window.usedPercent) / share}%`,
              backgroundColor: color,
            }}
          />
        ))}
      </span>
      <span className="flex items-baseline justify-between gap-1">
        {windows.map((window, index) => (
          <span
            key={window.id}
            className={cn("flex items-baseline gap-1", index > 0 && "flex-row-reverse")}
          >
            <span className="text-foreground/80">{clampPercent(window.usedPercent)}%</span>
            <span className="truncate">{resetsIn(window, now)}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** A car-style gauge: one 270° arc per limit, open at the bottom. */
function SubdialSummary({ windows, color, inUse, now, compact }: SummaryProps) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TEXT)}>
      <svg viewBox="0 0 24 24" className="size-7 shrink-0" aria-hidden>
        <g transform="rotate(135 12 12)" fill="none" strokeWidth="2.5">
          {windows.map((window, index) => {
            const radius = index === 0 ? 10 : 6;
            const used = clampPercent(window.usedPercent);
            return (
              <g key={window.id}>
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  stroke="currentColor"
                  pathLength={100}
                  strokeDasharray="75 100"
                  className={inUse ? "text-muted" : "text-foreground/15"}
                />
                {/* A zero-length round cap would still draw a dot. */}
                {used > 0 ? (
                  <circle
                    cx="12"
                    cy="12"
                    r={radius}
                    stroke={color}
                    strokeLinecap="round"
                    pathLength={100}
                    opacity={index === 0 ? 1 : 0.55}
                    strokeDasharray={`${used * 0.75} 100`}
                  />
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      <Figures windows={windows} now={now} compact={compact} />
    </span>
  );
}

/** One thin two-layer bar in the middle; the first limit's figures above, the second's below. */
function HorizonSummary({ windows, color, inUse, now }: SummaryProps) {
  const line = (window: ServerProviderUsageWindow) => (
    <span key={window.id} className="flex items-baseline justify-between gap-1">
      <span className="text-foreground/80">{clampPercent(window.usedPercent)}%</span>
      <span className="truncate text-end">{resetsIn(window, now)}</span>
    </span>
  );
  return (
    <span className={cn("flex w-28 shrink-0 flex-col justify-center gap-0.5", TEXT)}>
      {windows.slice(0, 1).map(line)}
      <span
        className={cn(
          "flex flex-col gap-px overflow-hidden rounded-full",
          inUse ? "bg-muted" : "bg-foreground/15",
        )}
      >
        {windows.map((window) => (
          <Bar
            key={window.id}
            percent={window.usedPercent}
            color={color}
            className={cn(
              windows.length > 1 ? "h-0.5 rounded-none" : "h-1",
              !inUse && "bg-foreground/15",
            )}
          />
        ))}
      </span>
      {windows.slice(1, 2).map(line)}
    </span>
  );
}

/** A mixing-desk fader per limit: the knob sits at the used amount. */
function FaderSummary({ windows, color, inUse, now, compact }: SummaryProps) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TEXT)}>
      <span className="flex shrink-0 flex-col gap-0.5">
        {windows.map((window) => {
          const used = clampPercent(window.usedPercent);
          return (
            <span
              key={window.id}
              className={cn("relative flex w-12 items-center", compact ? "h-2.5" : "h-3")}
            >
              <span
                className={cn(
                  "absolute inset-x-0 h-1 rounded-full",
                  inUse ? "bg-muted" : "bg-foreground/15",
                )}
              />
              <span
                className="absolute start-0 h-1 rounded-full"
                style={{ width: `${used}%`, backgroundColor: color }}
              />
              <span
                className={cn(
                  "absolute top-1/2 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  compact ? "h-2.5" : "h-3",
                )}
                style={{ insetInlineStart: `${used}%`, backgroundColor: color }}
              />
            </span>
          );
        })}
      </span>
      <Figures windows={windows} now={now} compact={compact} />
    </span>
  );
}

const CHEVRON = "polygon(0 0, 62% 0, 100% 50%, 62% 100%, 0 100%, 26% 50%)";

/** Five arrows per limit, each one 20%, lit as the limit is used. */
function ChevronsSummary({ windows, color, inUse, now, compact }: SummaryProps) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TEXT)}>
      <span className="flex shrink-0 flex-col gap-0.5">
        {windows.map((window) => {
          const lit = Math.round(clampPercent(window.usedPercent) / 20);
          return (
            <span key={window.id} className="flex gap-0.5">
              {Array.from({ length: 5 }, (_, arrow) => (
                <span
                  key={arrow}
                  className={cn(
                    compact ? "h-2.5" : "h-3",
                    "w-2",
                    inUse ? "bg-muted" : "bg-foreground/15",
                  )}
                  style={{
                    clipPath: CHEVRON,
                    ...(arrow < lit ? { backgroundColor: color } : null),
                  }}
                />
              ))}
            </span>
          );
        })}
      </span>
      <Figures windows={windows} now={now} compact={compact} />
    </span>
  );
}

/** A small pie per limit, filled clockwise as the limit is used. */
function PieSummary({ windows, color, inUse, now, compact }: SummaryProps) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TEXT)}>
      <span className="flex shrink-0 flex-col gap-0.5">
        {windows.map((window) => {
          const used = clampPercent(window.usedPercent);
          return (
            <span
              key={window.id}
              className={cn(
                compact ? "size-2.5" : "size-3",
                "rounded-full",
                inUse ? "bg-muted" : "bg-foreground/15",
              )}
              style={{
                backgroundImage: `conic-gradient(${color} 0 ${used}%, transparent ${used}% 100%)`,
              }}
            />
          );
        })}
      </span>
      <Figures windows={windows} now={now} compact={compact} />
    </span>
  );
}

/** How much of segment `index` (of `count`) a limit fills, 0 to 100. */
function segmentFill(window: ServerProviderUsageWindow, index: number, count: number): number {
  const step = 100 / count;
  return Math.min(
    100,
    Math.max(0, ((clampPercent(window.usedPercent) - index * step) / step) * 100),
  );
}

/**
 * A row of small shapes per limit that light up as it is used; the last lit
 * shape fills part-way, so the row shows the exact amount.
 */
function ShapesSummary({
  windows,
  color,
  inUse,
  now,
  compact,
  count = 5,
  shape,
  direction = "right",
  segmentClassName,
  rowClassName = "gap-0.5",
}: SummaryProps & {
  count?: number;
  /** A CSS clip-path; leave out for plain blocks. */
  shape?: string;
  direction?: "right" | "top";
  segmentClassName: string | ((index: number) => string);
  rowClassName?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TEXT)}>
      <span className="flex shrink-0 flex-col gap-0.5">
        {windows.map((window) => (
          <span key={window.id} className={cn("flex items-end", rowClassName)}>
            {Array.from({ length: count }, (_, index) => {
              const fill = segmentFill(window, index, count);
              return (
                <span
                  key={index}
                  className={cn(
                    "shrink-0",
                    typeof segmentClassName === "function"
                      ? segmentClassName(index)
                      : segmentClassName,
                    inUse ? "bg-muted" : "bg-foreground/15",
                  )}
                  style={{
                    ...(shape ? { clipPath: shape } : null),
                    ...(fill > 0
                      ? {
                          backgroundImage: `linear-gradient(to ${direction}, ${color} ${fill}%, transparent ${fill}%)`,
                        }
                      : null),
                  }}
                />
              );
            })}
          </span>
        ))}
      </span>
      <Figures windows={windows} now={now} compact={compact} />
    </span>
  );
}

const SIGNAL_HEIGHTS = ["h-1", "h-1.5", "h-2", "h-2.5", "h-3"];
const COMPACT_SIGNAL_HEIGHTS = ["h-0.5", "h-1", "h-1.5", "h-2", "h-2.5"];

/** Phone-signal bars that grow taller left to right. */
function SignalSummary(props: SummaryProps) {
  return (
    <ShapesSummary
      {...props}
      direction="top"
      segmentClassName={(index) =>
        cn("w-1.5 rounded-xs", (props.compact ? COMPACT_SIGNAL_HEIGHTS : SIGNAL_HEIGHTS)[index])
      }
    />
  );
}

/** Honeycomb cells that fill from the bottom like liquid. */
function HexagonsSummary(props: SummaryProps) {
  return (
    <ShapesSummary
      {...props}
      shape="polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)"
      direction="top"
      segmentClassName="h-2.5 w-2"
    />
  );
}

/** Four-point sparkles. */
function SparksSummary(props: SummaryProps) {
  return (
    <ShapesSummary
      {...props}
      shape="polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%)"
      segmentClassName="size-2.5"
      rowClassName="gap-px"
    />
  );
}

/** Slanted flags that lean forward. */
function PennantsSummary(props: SummaryProps) {
  return (
    <ShapesSummary
      {...props}
      shape="polygon(30% 0, 100% 0, 70% 100%, 0 100%)"
      segmentClassName={cn(props.compact ? "h-2.5" : "h-3", "w-2.5")}
      rowClassName="-space-x-0.5"
    />
  );
}

const SUMMARIES: Record<UsageSummaryStyle, (props: SummaryProps) => React.ReactElement> = {
  bars: BarsSummary,
  blocks: BlocksSummary,
  table: TableSummary,
  dots: DotsSummary,
  wave: WaveSummary,
  tug: TugSummary,
  subdial: SubdialSummary,
  horizon: HorizonSummary,
  fader: FaderSummary,
  chevrons: ChevronsSummary,
  pie: PieSummary,
  signal: SignalSummary,
  hexagons: HexagonsSummary,
  sparks: SparksSummary,
  pennants: PennantsSummary,
};

/** Styles small enough for the composer badge; the rest leave the badge as bars. */
export const BADGE_STYLES: ReadonlySet<UsageSummaryStyle> = new Set([
  "dots",
  "fader",
  "chevrons",
  "pie",
  "signal",
  "hexagons",
  "sparks",
  "pennants",
]);

/** A folded card's limits, drawn in the chosen style. */
export function UsageSummary({ style, ...props }: SummaryProps & { style: UsageSummaryStyle }) {
  const Summary = SUMMARIES[style];
  return <Summary {...props} />;
}
