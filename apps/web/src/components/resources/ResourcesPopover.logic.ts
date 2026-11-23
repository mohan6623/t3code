// Fork: pure helpers for the Resources popover (fleet CPU / memory / disk).
import type {
  HostResourcesSnapshot,
  ResourceMonitorHostProcessGroup,
  ResourceTelemetryProcess,
  ResourceTelemetrySnapshot,
} from "@t3tools/contracts";

export type ResourceLevel = "normal" | "warn" | "critical";
export type ResourceMetric = "cpu" | "memory" | "disk";

export const WARN_AT = 0.8;
const CRITICAL_AT = 0.9;

export function levelOf(fraction: number | null | undefined): ResourceLevel {
  if (fraction == null) return "normal";
  return fraction >= CRITICAL_AT ? "critical" : fraction >= WARN_AT ? "warn" : "normal";
}

export interface HostUsage {
  readonly cpu: number | null;
  readonly memory: number | null;
  readonly disk: number | null;
}

export function hostUsage(snapshot: HostResourcesSnapshot): HostUsage {
  const { diskTotalBytes, diskAvailableBytes } = snapshot;
  return {
    cpu: snapshot.cpuUtilization,
    memory:
      snapshot.totalMemoryBytes > 0
        ? 1 - snapshot.availableMemoryBytes / snapshot.totalMemoryBytes
        : null,
    disk:
      diskTotalBytes !== undefined && diskAvailableBytes !== undefined && diskTotalBytes > 0
        ? 1 - diskAvailableBytes / diskTotalBytes
        : null,
  };
}

export function worstOf(usage: HostUsage): number | null {
  const values = [usage.cpu, usage.memory, usage.disk].filter((value) => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

/** The metric with the highest reading; disk wins a tie, since a full disk hangs a machine. */
export function busiestMetric(usage: HostUsage): ResourceMetric | null {
  const worst = worstOf(usage);
  if (worst === null) return null;
  if (usage.disk === worst) return "disk";
  return usage.memory === worst ? "memory" : "cpu";
}

/** The metric to name in the "Ask agent" action, once a reading reaches the warning line. */
export function hottestMetric(usage: HostUsage): ResourceMetric | null {
  const worst = worstOf(usage);
  return worst === null || worst < WARN_AT ? null : busiestMetric(usage);
}

export function percent(fraction: number | null | undefined): number | null {
  return fraction == null ? null : Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}

export interface MachineEntry {
  readonly environmentId: string;
  readonly label: string;
  /** Null while unreachable or before the first reading arrives. */
  readonly usage: HostUsage | null;
  readonly reachable: boolean;
}

/**
 * The thread's machine stays out of the list (it is shown on top). The rest go busiest
 * first; machines without a reading follow, unreachable ones last, each group by name.
 */
export function orderOtherMachines<T extends MachineEntry>(
  machines: ReadonlyArray<T>,
  currentEnvironmentId: string | null,
): T[] {
  const rank = (machine: T) => (!machine.reachable ? 2 : machine.usage === null ? 1 : 0);
  return machines
    .filter((machine) => machine.environmentId !== currentEnvironmentId)
    .toSorted((left, right) => {
      const byGroup = rank(left) - rank(right);
      if (byGroup !== 0) return byGroup;
      const byLoad =
        (right.usage ? (worstOf(right.usage) ?? 0) : 0) -
        (left.usage ? (worstOf(left.usage) ?? 0) : 0);
      return byLoad !== 0 ? byLoad : left.label.localeCompare(right.label);
    });
}

export function needsAttention(machine: MachineEntry): boolean {
  if (!machine.reachable) return true;
  return machine.usage !== null && levelOf(worstOf(machine.usage)) !== "normal";
}

export interface SparklineShape {
  /** SVG path for the line, broken where nothing was recorded. */
  readonly line: string;
  /** SVG path for the area under each unbroken run. */
  readonly area: string;
  /** Unrecorded stretches as [startX, endX] in the 0..100 viewBox. */
  readonly gaps: ReadonlyArray<readonly [number, number]>;
  /** The busiest point, or null when nothing was recorded. */
  readonly peak: { readonly index: number; readonly x: number; readonly value: number } | null;
}

/** Lays values (0..1, null = gap) out in a 100 x `height` viewBox, 0 at the bottom. */
export function sparklineShape(
  values: ReadonlyArray<number | null>,
  height: number,
): SparklineShape {
  const count = values.length;
  const xOf = (index: number) => (count <= 1 ? 100 : (index / (count - 1)) * 100);
  const yOf = (value: number) => height - Math.max(0, Math.min(1, value)) * (height - 1);
  const runs: Array<Array<readonly [number, number]>> = [];
  const gaps: Array<readonly [number, number]> = [];
  let run: Array<readonly [number, number]> = [];
  let gapStart: number | null = null;
  let peak: SparklineShape["peak"] = null;
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      gapStart ??= index;
      return;
    }
    if (gapStart !== null) {
      gaps.push([xOf(Math.max(0, gapStart - 1)), xOf(index)]);
      gapStart = null;
    }
    run.push([xOf(index), yOf(value)]);
    if (peak === null || value > peak.value) peak = { index, x: xOf(index), value };
  });
  if (run.length > 0) runs.push(run);
  if (gapStart !== null && gapStart > 0) gaps.push([xOf(gapStart - 1), 100]);
  const fmt = (n: number) => Number(n.toFixed(2));
  const line = runs
    .map((points) =>
      points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${fmt(x)} ${fmt(y)}`).join(" "),
    )
    .join(" ");
  const area = runs
    .map((points) => {
      const first = points[0]!;
      const last = points.at(-1)!;
      const top = points.map(([x, y]) => `L${fmt(x)} ${fmt(y)}`).join(" ");
      return `M${fmt(first[0])} ${height} ${top} L${fmt(last[0])} ${height}Z`;
    })
    .join(" ");
  return { line, area, gaps, peak };
}

export const RESOURCE_RANGES = {
  "30m": { windowMs: 30 * 60_000, points: 30 },
  "6h": { windowMs: 6 * 60 * 60_000, points: 72 },
  "24h": { windowMs: 24 * 60 * 60_000, points: 96 },
} as const;
export type ResourceRange = keyof typeof RESOURCE_RANGES;

export function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 100) return `${Math.round(gib)} GB`;
  if (gib >= 1) return `${gib.toFixed(1).replace(/\.0$/, "")} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** The prompt an "Ask agent" button pre-fills; the user still reviews and sends it. */
export function investigatePrompt(input: {
  readonly machine: string;
  readonly usage: HostUsage | null;
  readonly topProcesses: ReadonlyArray<ResourceMonitorHostProcessGroup>;
}): string {
  const focus = input.usage ? hottestMetric(input.usage) : null;
  const reading = input.usage
    ? `CPU ${percent(input.usage.cpu) ?? "?"}%, memory ${percent(input.usage.memory) ?? "?"}%, disk ${percent(input.usage.disk) ?? "?"}%`
    : "no reading (the machine is not responding)";
  const processes =
    input.topProcesses.length > 0
      ? `\nHeaviest processes not started by T3: ${input.topProcesses
          .map(
            (process) =>
              `${process.name} (${formatBytes(process.residentBytes)}, ${Math.round(process.cpuPercent)}% of one core)`,
          )
          .join(", ")}.`
      : "";
  const ask =
    focus === "disk"
      ? "Find what is filling the disk and free space. List what you plan to delete and ask me before deleting anything that is not a cache or build output."
      : "Find what is using the most CPU and memory and why. Suggest fixes, and ask me before stopping any process.";
  return `${input.machine} is under load: ${reading}.${processes}\n${ask}`;
}

const SHELLS = new Set(["bash", "zsh", "sh", "dash", "fish", "nu", "pwsh", "powershell", "cmd"]);
// Process names of the provider CLIs T3 starts; node and bun hosts match on their command.
const AGENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcodex\b/, "Codex"],
  [/\bclaude\b/, "Claude"],
  [/\bcursor-agent\b/, "Cursor"],
  [/\bopencode\b/, "OpenCode"],
  [/\bkiro(-cli)?\b/, "Kiro"],
  [/\bgrok\b/, "Grok"],
  [/\bgemini\b/, "Gemini"],
  [/\bantigravity\b/, "Antigravity"],
  [/\bpi\b/, "Pi"],
];

function baseName(process: Pick<ResourceTelemetryProcess, "name" | "command">): string {
  const first = process.command.trim().split(/\s+/)[0] ?? "";
  const fromCommand =
    first
      .replace(/^['"]|['"]$/g, "")
      .split(/[\\/]/)
      .at(-1) ?? "";
  return (process.name.trim() || fromCommand).replace(/^-/, "").replace(/\.exe$/i, "");
}

function agentLabel(process: Pick<ResourceTelemetryProcess, "name" | "command">): string | null {
  const name = baseName(process).toLowerCase();
  const haystack = name === "node" || name === "bun" ? process.command.toLowerCase() : name;
  return AGENTS.find(([pattern]) => pattern.test(haystack))?.[1] ?? null;
}

export interface ProcessUsage {
  /** Share of the whole machine's CPU, 0..1. */
  readonly cpu: number;
  readonly memoryBytes: number;
  readonly processCount: number;
}

export interface BreakdownRow extends ProcessUsage {
  readonly key: string;
  readonly label: string;
}

export interface MachineBreakdown {
  readonly agents: ReadonlyArray<BreakdownRow>;
  readonly terminals: ReadonlyArray<BreakdownRow>;
  /** The server process alone. */
  readonly server: ProcessUsage;
  /** Short-lived tools (git, search) and the resource monitor. */
  readonly helpers: ProcessUsage;
  /** Electron processes; null outside the desktop app. */
  readonly desktop: ProcessUsage | null;
  readonly t3: ProcessUsage;
  /** Everything else on the machine, from the host totals. */
  readonly other: { readonly cpu: number | null; readonly memoryBytes: number };
  readonly otherTop: ReadonlyArray<ResourceMonitorHostProcessGroup>;
}

const EMPTY: ProcessUsage = { cpu: 0, memoryBytes: 0, processCount: 0 };
const add = (left: ProcessUsage, right: ProcessUsage): ProcessUsage => ({
  cpu: left.cpu + right.cpu,
  memoryBytes: left.memoryBytes + right.memoryBytes,
  processCount: left.processCount + right.processCount,
});

/**
 * Splits T3's process tree by what started each direct child of the server. Processes
 * are not linked to threads, so agents are listed per process, named by provider.
 */
export function machineBreakdown(
  telemetry: Pick<ResourceTelemetrySnapshot, "processes" | "hostTopProcesses">,
  host: HostResourcesSnapshot,
): MachineBreakdown {
  const cores = Math.max(1, host.cpuCount);
  const byPid = new Map(telemetry.processes.map((process) => [process.identity.pid, process]));
  const own = (process: ResourceTelemetryProcess): ProcessUsage => ({
    cpu: process.cpuPercent / 100 / cores,
    memoryBytes: process.residentBytes,
    processCount: 1,
  });
  const subtree = (root: ResourceTelemetryProcess): ProcessUsage => {
    let total = EMPTY;
    const seen = new Set<number>();
    const stack = [root];
    for (let process = stack.pop(); process; process = stack.pop()) {
      if (seen.has(process.identity.pid)) continue;
      seen.add(process.identity.pid);
      total = add(total, own(process));
      for (const pid of process.childPids) {
        const child = byPid.get(pid);
        if (child) stack.push(child);
      }
    }
    return total;
  };
  const server = telemetry.processes.find((process) => process.category === "server");
  const agents: BreakdownRow[] = [];
  const terminals: BreakdownRow[] = [];
  let helpers = EMPTY;
  for (const pid of server?.childPids ?? []) {
    const child = byPid.get(pid);
    if (!child) continue;
    const usage = subtree(child);
    const label = child.category === "resource-monitor" ? null : agentLabel(child);
    const name = baseName(child);
    if (label) agents.push({ key: String(pid), label, ...usage });
    else if (child.category !== "resource-monitor" && SHELLS.has(name.toLowerCase()))
      terminals.push({ key: String(pid), label: name, ...usage });
    else helpers = add(helpers, usage);
  }
  const electron = telemetry.processes.filter((process) =>
    process.category.startsWith("electron-"),
  );
  const desktop = electron.length > 0 ? electron.map(own).reduce(add, EMPTY) : null;
  const serverOnly = server ? own(server) : EMPTY;
  const t3 = [serverOnly, helpers, desktop ?? EMPTY, ...agents, ...terminals].reduce(add, EMPTY);
  const busiest = (rows: BreakdownRow[]) =>
    rows.toSorted((left, right) => right.memoryBytes - left.memoryBytes);
  const used = host.totalMemoryBytes - host.availableMemoryBytes;
  const otherTop = (telemetry.hostTopProcesses ?? []).slice(0, 3);
  // Host totals and process samples are taken at different moments; never show less than the rows.
  const otherTopCpu = otherTop.reduce((total, group) => total + group.cpuPercent / 100 / cores, 0);
  return {
    agents: busiest(agents),
    terminals: busiest(terminals),
    server: serverOnly,
    helpers,
    desktop,
    t3,
    other: {
      cpu:
        host.cpuUtilization === null
          ? null
          : Math.min(1, Math.max(otherTopCpu, host.cpuUtilization - t3.cpu)),
      memoryBytes: Math.max(
        otherTop.reduce((total, group) => total + group.residentBytes, 0),
        used - t3.memoryBytes,
      ),
    },
    otherTop,
  };
}
