// Fork: CPU / memory / disk for every connected machine, the thread's own on top.
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  HostResourcesSnapshot,
  ResourceMonitorHostProcessGroup,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  ActivityIcon,
  AppWindowIcon,
  BotIcon,
  BoxIcon,
  ChevronDownIcon,
  GaugeIcon,
  MonitorIcon,
  SearchIcon,
  ServerIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { memo, useState, type ReactNode } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useResourceTelemetry } from "~/lib/resourceTelemetryState";
import { cn } from "~/lib/utils";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  recentFleetReadingsAtom,
  fleetEnvironmentIdsKey,
  fleetMachines,
  liveFleetReadingsAtom,
  type FleetMachine,
} from "./fleetResources";
import {
  RESOURCE_RANGES,
  WARN_AT,
  busiestMetric,
  formatBytes,
  hottestMetric,
  investigatePrompt,
  levelOf,
  machineBreakdown,
  needsAttention,
  orderOtherMachines,
  percent,
  sparklineShape,
  worstOf,
  type HostUsage,
  type MachineBreakdown,
  type ProcessUsage,
  type ResourceLevel,
  type ResourceMetric,
  type ResourceRange,
} from "./ResourcesPopover.logic";

const CURRENT_OPEN_STORAGE_KEY = "t3code:resources-current-open";
const ROW_STYLE_STORAGE_KEY = "t3code:resources-row-style";
const RowStyle = Schema.Literals(["graphs", "bars"]);
type RowStyle = typeof RowStyle.Type;

const LEVEL_TEXT: Record<ResourceLevel, string> = {
  normal: "text-foreground",
  warn: "text-warning",
  critical: "text-destructive",
};
const LEVEL_STROKE: Record<ResourceLevel, string> = {
  normal: "text-muted-foreground",
  warn: "text-warning",
  critical: "text-destructive",
};
const LEVEL_FILL: Record<ResourceLevel, string> = {
  normal: "bg-foreground/60",
  warn: "bg-warning",
  critical: "bg-destructive",
};

function useMetricLabels() {
  const gt = useGT();
  return {
    cpu: gt("CPU"),
    memory: gt("RAM"),
    disk: gt("Disk"),
  } satisfies Record<ResourceMetric, string>;
}

const METRICS: ReadonlyArray<ResourceMetric> = ["cpu", "memory", "disk"];

/** An SVG line of recorded values with gaps, the 80% guide and the peak dot. */
function Sparkline({
  values,
  level,
  height,
  showPeak,
}: {
  values: ReadonlyArray<number | null>;
  level: ResourceLevel;
  height: number;
  showPeak: boolean;
}) {
  const shape = sparklineShape(values, height);
  const guideY = height - WARN_AT * (height - 1);
  return (
    <span className={cn("relative block w-full", LEVEL_STROKE[level])} style={{ height }}>
      <svg
        aria-hidden
        className="block size-full overflow-visible"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
      >
        {shape.gaps.map(([start, end]) => (
          <rect
            key={start}
            x={start}
            y={0}
            width={end - start}
            height={height}
            className="fill-muted"
          />
        ))}
        <line
          x1={0}
          x2={100}
          y1={guideY}
          y2={guideY}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="3 3"
          className="stroke-muted-foreground/40"
        />
        <path d={shape.area} className="fill-current opacity-15" />
        <path
          d={shape.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {showPeak && shape.peak ? (
        <span
          aria-hidden
          className="absolute size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${shape.peak.x}%`, bottom: `${shape.peak.value * 100}%` }}
        />
      ) : null}
    </span>
  );
}

function useHistory(environmentId: EnvironmentId, range: ResourceRange) {
  const result = useAtomValue(
    serverEnvironment.hostResourceHistory({ environmentId, input: RESOURCE_RANGES[range] }),
  );
  return result._tag === "Success" ? result.value.points : [];
}

function RangeSwitch({
  range,
  onChange,
}: {
  range: ResourceRange;
  onChange: (range: ResourceRange) => void;
}) {
  const gt = useGT();
  const labels: Record<ResourceRange, string> = {
    "30m": gt("Last 30 min"),
    "6h": gt("Last 6 hours"),
    "24h": gt("Last 24 hours"),
  };
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 pb-1.5">
      <span className="text-2xs text-muted-foreground">{labels[range]}</span>
      <ToggleGroup
        aria-label={gt("History range")}
        value={[range]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "30m" || value === "6h" || value === "24h") onChange(value);
        }}
      >
        <Toggle value="30m">{gt("30m")}</Toggle>
        <Toggle value="6h">{gt("6h")}</Toggle>
        <Toggle value="24h">{gt("24h")}</Toggle>
      </ToggleGroup>
    </div>
  );
}

/** The three boxes: big %, capacity, history graph and peak. */
function UsageTiles({
  environmentId,
  snapshot,
  usage,
}: {
  environmentId: EnvironmentId;
  snapshot: HostResourcesSnapshot;
  usage: HostUsage;
}) {
  const gt = useGT();
  const labels = useMetricLabels();
  const [range, setRange] = useState<ResourceRange>("30m");
  const history = useHistory(environmentId, range);
  const memoryUsed = snapshot.totalMemoryBytes - snapshot.availableMemoryBytes;
  const capacity: Record<ResourceMetric, string> = {
    cpu: gt("{count, plural, one {{count} core} other {{count} cores}}", {
      count: snapshot.cpuCount,
    }),
    memory: formatBytes(snapshot.totalMemoryBytes),
    disk: snapshot.diskTotalBytes === undefined ? "" : formatBytes(snapshot.diskTotalBytes),
  };
  const detail: Record<ResourceMetric, string> = {
    cpu: "",
    memory: gt("{amount} used", { amount: formatBytes(memoryUsed) }),
    disk:
      snapshot.diskAvailableBytes === undefined
        ? gt("Unknown on this server version")
        : gt("{amount} free", { amount: formatBytes(snapshot.diskAvailableBytes) }),
  };
  return (
    <>
      <RangeSwitch range={range} onChange={setRange} />
      <div className="grid grid-cols-3 gap-1.5 px-2.5 pb-2.5">
        {METRICS.map((metric) => {
          const values = history.map((point) => point[metric]);
          const peak = sparklineShape(values, 26).peak;
          const level = levelOf(usage[metric]);
          const shown = percent(usage[metric]);
          return (
            <div key={metric} className="flex min-w-0 flex-col rounded-md border bg-background p-2">
              <div className="flex items-baseline justify-between gap-1 text-2xs text-muted-foreground">
                <span>{labels[metric]}</span>
                <span className="truncate tabular-nums">{capacity[metric]}</span>
              </div>
              <div
                className={cn(
                  "text-xl font-semibold tabular-nums tracking-tight",
                  LEVEL_TEXT[level],
                )}
              >
                {shown === null ? "-" : shown}
                <span className="ms-px text-xs font-medium text-muted-foreground">%</span>
              </div>
              <span className="mt-1">
                <Sparkline values={values} level={level} height={26} showPeak />
              </span>
              <div className="mt-1 truncate text-2xs text-muted-foreground tabular-nums">
                {[
                  detail[metric],
                  peak ? gt("peak {percent}%", { percent: percent(peak.value) ?? 0 }) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** CPU / RAM / Disk with their own labels, as bars or 30-minute graphs. */
function UsageSummary({
  environmentId,
  usage,
  style,
}: {
  environmentId: EnvironmentId;
  usage: HostUsage;
  style: RowStyle;
}) {
  const labels = useMetricLabels();
  return (
    <span className="grid min-w-0 flex-1 grid-cols-3 gap-2">
      {METRICS.map((metric) => {
        const level = levelOf(usage[metric]);
        const shown = percent(usage[metric]);
        return (
          <span key={metric} className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-baseline justify-between text-2xs text-muted-foreground">
              <span>{labels[metric]}</span>
              <span className={cn("tabular-nums", LEVEL_TEXT[level])}>
                {shown === null ? "-" : `${shown}%`}
              </span>
            </span>
            {style === "graphs" ? (
              <RowGraph environmentId={environmentId} metric={metric} level={level} />
            ) : (
              <span className="block h-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn("block h-full rounded-full", LEVEL_FILL[level])}
                  style={{ width: `${shown ?? 0}%` }}
                />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function RowGraph({
  environmentId,
  metric,
  level,
}: {
  environmentId: EnvironmentId;
  metric: ResourceMetric;
  level: ResourceLevel;
}) {
  const history = useHistory(environmentId, "30m");
  return (
    <Sparkline
      values={history.map((point) => point[metric])}
      level={level}
      height={14}
      showPeak={false}
    />
  );
}

function MachineActions({
  machine,
  topProcesses,
  onDone,
}: {
  machine: FleetMachine;
  topProcesses: ReadonlyArray<ResourceMonitorHostProcessGroup>;
  onDone: () => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const { openScratchProject } = useScratchProject();
  const startThread = async (prompt?: string) => {
    onDone();
    const project = await openScratchProject(machine.environmentId);
    if (!project) return;
    await handleNewThread(
      scopeProjectRef(project.environmentId, project.id),
      prompt === undefined ? undefined : { prompt },
    );
  };
  if (!machine.reachable) {
    return (
      <div className="flex flex-wrap gap-1.5 px-2.5 pb-2.5">
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            onDone();
            void navigate({ to: "/settings/connections" });
          }}
        >
          {gt("Open connections")}
        </Button>
      </div>
    );
  }
  const hot = machine.usage ? hottestMetric(machine.usage) : null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2.5">
      {hot ? (
        <Button
          size="xs"
          variant="soft"
          onClick={() =>
            void startThread(
              investigatePrompt({ machine: machine.label, usage: machine.usage, topProcesses }),
            )
          }
        >
          <BotIcon aria-hidden />
          {hot === "disk" ? gt("Ask agent to free disk") : gt("Ask agent to investigate")}
        </Button>
      ) : null}
      <Button size="xs" variant="outline" onClick={() => void startThread()}>
        {gt("New thread here")}
      </Button>
    </div>
  );
}

function MachineStatus({ machine }: { machine: FleetMachine }) {
  const gt = useGT();
  if (!machine.reachable) {
    return <span className="flex-1 truncate text-xs text-destructive">{gt("Not responding")}</span>;
  }
  return (
    <span className="flex-1 truncate text-xs text-muted-foreground">
      {machine.connecting ? gt("Connecting…") : gt("Reading…")}
    </span>
  );
}

function attentionBorder(machine: FleetMachine) {
  if (!machine.reachable) return "border-destructive/50";
  const level = machine.usage ? levelOf(worstOf(machine.usage)) : "normal";
  return level === "critical"
    ? "border-destructive/50"
    : level === "warn"
      ? "border-warning/50"
      : "";
}

function MachineDot({ machine }: { machine: FleetMachine }) {
  if (!machine.reachable) {
    return <TriangleAlertIcon aria-hidden className="size-3 shrink-0 text-destructive" />;
  }
  const level = machine.usage ? levelOf(worstOf(machine.usage)) : "normal";
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        machine.usage === null
          ? "bg-muted-foreground/40"
          : level === "critical"
            ? "bg-destructive"
            : level === "warn"
              ? "bg-warning"
              : "bg-success",
      )}
    />
  );
}

/** One machine: a folded summary row that opens into the same boxes as the top card. */
function MachineCard({
  machine,
  current,
  open,
  onOpenChange,
  rowStyle,
  onDone,
  topProcesses = [],
  children,
}: {
  machine: FleetMachine;
  current: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowStyle: RowStyle;
  onDone: () => void;
  topProcesses?: ReadonlyArray<ResourceMonitorHostProcessGroup>;
  children?: ReactNode;
}) {
  const gt = useGT();
  const { snapshot, usage } = machine;
  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/30",
        current && "border-foreground/15",
        attentionBorder(machine),
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-start"
      >
        {current ? (
          <MonitorIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <MachineDot machine={machine} />
        )}
        <span className="flex w-24 min-w-0 shrink-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{machine.label}</span>
          {current ? (
            <span className="truncate text-2xs text-muted-foreground">{gt("This thread")}</span>
          ) : null}
        </span>
        {open && current ? (
          <span className="flex-1" />
        ) : usage ? (
          <UsageSummary environmentId={machine.environmentId} usage={usage} style={rowStyle} />
        ) : (
          <MachineStatus machine={machine} />
        )}
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div>
          {snapshot && usage ? (
            <UsageTiles environmentId={machine.environmentId} snapshot={snapshot} usage={usage} />
          ) : !machine.reachable ? (
            <p className="px-2.5 pb-2 text-xs text-muted-foreground">
              {gt("T3 cannot reach this machine. It may be asleep, stuck or offline.")}
            </p>
          ) : null}
          {children}
          {current && !needsAttention(machine) ? null : (
            <MachineActions machine={machine} topProcesses={topProcesses} onDone={onDone} />
          )}
        </div>
      ) : null}
    </div>
  );
}

type BreakdownTab = "all" | "agents" | "terminals" | "app";

function BreakdownLine({
  icon,
  label,
  detail,
  usage,
}: {
  icon: ReactNode;
  label: string;
  detail?: string | undefined;
  usage: { readonly cpu: number | null; readonly memoryBytes: number };
}) {
  const gt = useGT();
  return (
    <>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {label}
        {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
      </span>
      <span className="w-14 shrink-0 text-end text-muted-foreground tabular-nums">
        {usage.cpu === null ? "" : gt("{value}% CPU", { value: percent(usage.cpu) ?? 0 })}
      </span>
      <span className="w-16 shrink-0 text-end text-foreground tabular-nums">
        {formatBytes(usage.memoryBytes)}
      </span>
    </>
  );
}

const LINE = "flex w-full min-w-0 items-center gap-2 px-2.5 py-1 text-start text-xs";

/** What runs on the thread's machine: T3's agents, terminals and server, and the rest. */
function MachineBreakdownView({
  breakdown,
  host,
}: {
  breakdown: MachineBreakdown;
  host: HostResourcesSnapshot;
}) {
  const gt = useGT();
  const [tab, setTab] = useState<BreakdownTab>("all");
  const [otherOpen, setOtherOpen] = useState(false);
  const app = [breakdown.server, breakdown.helpers, breakdown.desktop]
    .filter((usage) => usage !== null)
    .reduce((sum, usage) => ({
      cpu: sum.cpu + usage.cpu,
      memoryBytes: sum.memoryBytes + usage.memoryBytes,
      processCount: sum.processCount + usage.processCount,
    }));
  const sum = (rows: ReadonlyArray<ProcessUsage>) =>
    rows.reduce((total, row) => total + row.memoryBytes, 0);
  const share = (bytes: number) =>
    `${host.totalMemoryBytes > 0 ? Math.min(100, (bytes / host.totalMemoryBytes) * 100) : 0}%`;
  const segments = [
    { key: "app", label: gt("T3 server"), bytes: app.memoryBytes, fill: "bg-foreground/60" },
    { key: "agents", label: gt("Agents"), bytes: sum(breakdown.agents), fill: "bg-foreground/40" },
    {
      key: "terminals",
      label: gt("Terminals"),
      bytes: sum(breakdown.terminals),
      fill: "bg-foreground/25",
    },
    {
      key: "other",
      label: gt("Not T3"),
      bytes: breakdown.other.memoryBytes,
      fill: "bg-foreground/10",
    },
  ];
  const agentLines = breakdown.agents.map((row) => (
    <div key={`agent-${row.key}`} className={LINE}>
      <BreakdownLine
        icon={<BotIcon aria-hidden className="size-3.5" />}
        label={gt("{provider} agent", { provider: row.label })}
        detail={
          row.processCount > 1
            ? gt("{count, plural, one {{count} process} other {{count} processes}}", {
                count: row.processCount,
              })
            : undefined
        }
        usage={row}
      />
    </div>
  ));
  const terminalLines = breakdown.terminals.map((row) => (
    <div key={`terminal-${row.key}`} className={LINE}>
      <BreakdownLine
        icon={<TerminalIcon aria-hidden className="size-3.5" />}
        label={row.label}
        detail={
          row.processCount > 1
            ? gt("{count, plural, one {{count} process} other {{count} processes}}", {
                count: row.processCount,
              })
            : undefined
        }
        usage={row}
      />
    </div>
  ));
  const empty = (text: string) => (
    <p className="px-2.5 py-2 text-center text-xs text-muted-foreground">{text}</p>
  );
  const cores = Math.max(1, host.cpuCount);
  return (
    <div className="flex flex-col gap-2 px-2.5 pb-2.5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <BotIcon aria-hidden className="size-3.5" />
            {gt("{count, plural, one {{count} agent} other {{count} agents}}", {
              count: breakdown.agents.length,
            })}
          </span>
          <span className="inline-flex items-center gap-1">
            <TerminalIcon aria-hidden className="size-3.5" />
            {gt("{count, plural, one {{count} terminal} other {{count} terminals}}", {
              count: breakdown.terminals.length,
            })}
          </span>
          <span className="ms-auto tabular-nums">
            {gt("T3 uses {amount}", { amount: formatBytes(breakdown.t3.memoryBytes) })}
          </span>
        </div>
        <div
          role="img"
          aria-label={segments
            .map((segment) => `${segment.label} ${formatBytes(segment.bytes)}`)
            .join(", ")}
          className="flex h-1.5 overflow-hidden rounded-full bg-muted"
        >
          {segments.map((segment) => (
            <span
              key={segment.key}
              className={cn("block h-full", segment.fill)}
              style={{ width: share(segment.bytes) }}
            />
          ))}
        </div>
        <div
          aria-hidden
          className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground"
        >
          {segments.map((segment) => (
            <span key={segment.key} className="inline-flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", segment.fill)} />
              {segment.label}
            </span>
          ))}
        </div>
      </div>
      <ToggleGroup
        aria-label={gt("Show")}
        value={[tab]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "all" || value === "agents" || value === "terminals" || value === "app")
            setTab(value);
        }}
      >
        <Toggle value="all">{gt("All")}</Toggle>
        <Toggle value="agents">{gt("Agents")}</Toggle>
        <Toggle value="terminals">{gt("Terminals")}</Toggle>
        <Toggle value="app">{gt("App")}</Toggle>
      </ToggleGroup>
      <div className="-mx-2.5 flex flex-col">
        {tab === "agents"
          ? agentLines.length > 0
            ? agentLines
            : empty(gt("No agents running."))
          : null}
        {tab === "terminals"
          ? terminalLines.length > 0
            ? terminalLines
            : empty(gt("No terminals open."))
          : null}
        {tab === "app" ? (
          <>
            <div className={LINE}>
              <BreakdownLine
                icon={<ServerIcon aria-hidden className="size-3.5" />}
                label={gt("Server")}
                usage={breakdown.server}
              />
            </div>
            <div className={LINE}>
              <BreakdownLine
                icon={<ActivityIcon aria-hidden className="size-3.5" />}
                label={gt("Background processes")}
                detail={String(breakdown.helpers.processCount)}
                usage={breakdown.helpers}
              />
            </div>
            {breakdown.desktop ? (
              <div className={LINE}>
                <BreakdownLine
                  icon={<AppWindowIcon aria-hidden className="size-3.5" />}
                  label={gt("Desktop window")}
                  usage={breakdown.desktop}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {tab === "all" ? (
          <>
            {agentLines}
            {terminalLines}
            <div className={LINE}>
              <BreakdownLine
                icon={<ServerIcon aria-hidden className="size-3.5" />}
                label={gt("T3 server")}
                usage={app}
              />
            </div>
            {breakdown.otherTop.length > 0 ? (
              <button
                type="button"
                aria-expanded={otherOpen}
                onClick={() => setOtherOpen(!otherOpen)}
                className={cn(LINE, "rounded-md hover:bg-accent")}
              >
                <BreakdownLine
                  icon={<BoxIcon aria-hidden className="size-3.5" />}
                  label={gt("Not T3")}
                  detail={gt("top 3")}
                  usage={breakdown.other}
                />
              </button>
            ) : (
              <div className={LINE}>
                <BreakdownLine
                  icon={<BoxIcon aria-hidden className="size-3.5" />}
                  label={gt("Not T3")}
                  usage={breakdown.other}
                />
              </div>
            )}
            {otherOpen
              ? breakdown.otherTop.map((group) => (
                  <div key={group.name} className={cn(LINE, "ps-8")}>
                    <BreakdownLine
                      icon={<ActivityIcon aria-hidden className="size-3" />}
                      label={group.name}
                      detail={group.processCount > 1 ? String(group.processCount) : undefined}
                      usage={{
                        cpu: group.cpuPercent / 100 / cores,
                        memoryBytes: group.residentBytes,
                      }}
                    />
                  </div>
                ))
              : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The thread's machine; while open it streams T3's process tree for the breakdown. */
function CurrentMachineCard(props: {
  machine: FleetMachine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowStyle: RowStyle;
  onDone: () => void;
}) {
  return props.open ? <OpenCurrentMachineCard {...props} /> : <MachineCard {...props} current />;
}

function OpenCurrentMachineCard(props: {
  machine: FleetMachine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowStyle: RowStyle;
  onDone: () => void;
}) {
  const telemetry = useResourceTelemetry(props.machine.environmentId);
  const host = props.machine.snapshot;
  const breakdown = telemetry.data && host ? machineBreakdown(telemetry.data, host) : null;
  return (
    <MachineCard {...props} current topProcesses={breakdown?.otherTop ?? []}>
      {breakdown && host ? <MachineBreakdownView breakdown={breakdown} host={host} /> : null}
    </MachineCard>
  );
}

function ResourcesPanel({
  environmentId,
  onDone,
}: {
  environmentId: EnvironmentId;
  onDone: () => void;
}) {
  const gt = useGT();
  const { environments } = useEnvironments();
  const readings = useAtomValue(liveFleetReadingsAtom(fleetEnvironmentIdsKey(environments)));
  const machines = fleetMachines(environments, readings);
  const [currentOpen, setCurrentOpen] = useLocalStorage(
    CURRENT_OPEN_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  const [rowStyle, setRowStyle] = useLocalStorage(ROW_STYLE_STORAGE_KEY, "graphs", RowStyle);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // One other machine open at a time keeps the list short enough to fit.
  const [openOther, setOpenOther] = useState<EnvironmentId | null>(null);
  const current = machines.find((machine) => machine.environmentId === environmentId) ?? null;
  const filter = query.trim().toLowerCase();
  const others = orderOtherMachines(machines, environmentId).filter(
    (machine) => filter === "" || machine.label.toLowerCase().includes(filter),
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <span className="flex-1 text-sm font-semibold text-foreground">{gt("Resources")}</span>
        <span className="text-2xs text-muted-foreground">{gt("Live · every 5 s")}</span>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={gt("Search machines")}
          aria-pressed={searching}
          onClick={() => {
            setSearching(!searching);
            setQuery("");
          }}
        >
          <SearchIcon />
        </Button>
      </div>
      {searching ? (
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={gt("Filter machines")}
          aria-label={gt("Filter machines")}
          className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
      ) : null}
      {current ? (
        <CurrentMachineCard
          machine={current}
          open={currentOpen}
          onOpenChange={setCurrentOpen}
          rowStyle={rowStyle}
          onDone={onDone}
        />
      ) : null}
      {others.length > 0 || filter !== "" ? (
        <>
          <div className="flex items-center justify-between gap-2 px-0.5 pt-1">
            <span className="text-2xs text-muted-foreground">
              {gt(
                "{count, plural, one {Other machines · {count} · busiest first} other {Other machines · {count} · busiest first}}",
                { count: others.length },
              )}
            </span>
            <ToggleGroup
              aria-label={gt("Row style")}
              value={[rowStyle]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "graphs" || value === "bars") setRowStyle(value);
              }}
            >
              <Toggle value="bars">{gt("Bars")}</Toggle>
              <Toggle value="graphs">{gt("Graphs")}</Toggle>
            </ToggleGroup>
          </div>
          {others.map((machine) => (
            <MachineCard
              key={machine.environmentId}
              machine={machine}
              current={false}
              open={openOther === machine.environmentId}
              onOpenChange={(open) => setOpenOther(open ? machine.environmentId : null)}
              rowStyle={rowStyle}
              onDone={onDone}
            />
          ))}
          {others.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              {gt("No machine matches.")}
            </p>
          ) : null}
        </>
      ) : null}
      <p className="px-0.5 text-center text-2xs text-muted-foreground">
        {gt("Each machine records its own last 24 hours. Only machines running T3 are listed.")}
      </p>
    </div>
  );
}

/** The header button: this machine's busiest reading in words, plus how many other machines need a look. */
export const ResourcesButton = memo(function ResourcesButton({
  environmentId,
}: {
  environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const labels = useMetricLabels();
  const [open, setOpen] = useState(false);
  const { environments } = useEnvironments();
  // While open, the button reads the popover's live numbers so the two never disagree.
  const readings = useAtomValue(
    (open ? liveFleetReadingsAtom : recentFleetReadingsAtom)(fleetEnvironmentIdsKey(environments)),
  );
  const machines = fleetMachines(environments, readings);
  const usage = machines.find((machine) => machine.environmentId === environmentId)?.usage ?? null;
  const busiest = usage ? busiestMetric(usage) : null;
  const others = machines.filter(
    (machine) => machine.environmentId !== environmentId && needsAttention(machine),
  ).length;
  const label =
    others > 0
      ? gt(
          "{count, plural, one {Resources: {count} other machine needs attention} other {Resources: {count} other machines need attention}}",
          { count: others },
        )
      : gt("Resources");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" aria-label={label} className="shrink-0" />}
      >
        <GaugeIcon aria-hidden className="size-4 text-muted-foreground" />
        {usage && busiest ? (
          <span className="tabular-nums">
            <span className="text-muted-foreground">{labels[busiest]}</span>{" "}
            <span className={LEVEL_TEXT[levelOf(usage[busiest])]}>{percent(usage[busiest])}%</span>
          </span>
        ) : null}
        {others > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 text-2xs font-semibold text-destructive">
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            {gt("{count} busy", { count: others })}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" width="lg" padding="compact" scrollbar="hidden">
        {open ? (
          <ResourcesPanel environmentId={environmentId} onDone={() => setOpen(false)} />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
});
