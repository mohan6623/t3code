import { describe, expect, it } from "vite-plus/test";

import type { ResourceTelemetryProcess } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  busiestMetric,
  hottestMetric,
  investigatePrompt,
  machineBreakdown,
  orderOtherMachines,
  sparklineShape,
  type MachineEntry,
} from "./ResourcesPopover.logic";

const machine = (label: string, usage: MachineEntry["usage"], reachable = true): MachineEntry => ({
  environmentId: label,
  label,
  usage,
  reachable,
});

describe("orderOtherMachines", () => {
  it("leaves the thread's machine out, then busiest first, unread and unreachable last", () => {
    const ordered = orderOtherMachines(
      [
        machine("offline", null, false),
        machine("calm", { cpu: 0.1, memory: 0.2, disk: 0.3 }),
        machine("current", { cpu: 0.99, memory: 0.99, disk: 0.99 }),
        machine("reading", null),
        machine("full-disk", { cpu: 0.1, memory: 0.2, disk: 0.86 }),
        machine("hot", { cpu: 0.91, memory: 0.93, disk: 0.6 }),
      ],
      "current",
    );
    expect(ordered.map((entry) => entry.label)).toEqual([
      "hot",
      "full-disk",
      "calm",
      "reading",
      "offline",
    ]);
  });
});

describe("sparklineShape", () => {
  it("breaks the line at unrecorded points and marks the gap and the peak", () => {
    const shape = sparklineShape([0.2, 0.9, null, null, 0.4], 10);
    expect(shape.line.match(/M/g)).toHaveLength(2);
    expect(shape.gaps).toEqual([[25, 100]]);
    expect(shape.peak).toEqual({ index: 1, x: 25, value: 0.9 });
  });

  it("has no peak when nothing was recorded", () => {
    expect(sparklineShape([null, null], 10).peak).toBeNull();
  });
});

describe("investigatePrompt", () => {
  it("asks to free disk when disk is the worst reading, otherwise to investigate", () => {
    const disk = { cpu: 0.2, memory: 0.5, disk: 0.92 };
    expect(hottestMetric(disk)).toBe("disk");
    expect(investigatePrompt({ machine: "cursor-vm", usage: disk, topProcesses: [] })).toContain(
      "filling the disk",
    );
    const memory = { cpu: 0.3, memory: 0.95, disk: 0.4 };
    expect(investigatePrompt({ machine: "ibox-4", usage: memory, topProcesses: [] })).toContain(
      "ask me before stopping any process",
    );
    expect(hottestMetric({ cpu: 0.3, memory: 0.5, disk: 0.6 })).toBeNull();
    expect(busiestMetric({ cpu: 0.3, memory: 0.5, disk: 0.6 })).toBe("disk");
    expect(busiestMetric({ cpu: 0.7, memory: 0.5, disk: null })).toBe("cpu");
    expect(busiestMetric({ cpu: null, memory: null, disk: null })).toBeNull();
  });
});

const GB = 1024 ** 3;
const proc = (
  pid: number,
  ppid: number,
  name: string,
  memoryGb: number,
  extra: Partial<ResourceTelemetryProcess> = {},
): ResourceTelemetryProcess => ({
  identity: { pid, startTimeMs: 0 },
  ppid,
  childPids: [],
  depth: 0,
  name,
  command: name,
  status: "Running",
  category: "server-child",
  cpuPercent: 0,
  cpuTimeMs: 0,
  residentBytes: memoryGb * GB,
  peakResidentBytes: 0,
  virtualBytes: 0,
  ioReadBytes: 0,
  ioWriteBytes: 0,
  ioReadBytesPerSecond: 0,
  ioWriteBytesPerSecond: 0,
  ioSemantics: "storage",
  runTimeMs: 0,
  firstSeenAt: DateTime.makeUnsafe(0),
  lastSeenAt: DateTime.makeUnsafe(0),
  ...extra,
});

describe("machineBreakdown", () => {
  it("splits the server's children into agents, terminals and helpers, and the rest of the host", () => {
    const breakdown = machineBreakdown(
      {
        processes: [
          proc(1, 0, "node", 0.5, { category: "server", childPids: [2, 4, 5, 6] }),
          proc(2, 1, "node", 0.25, {
            command: "node /opt/claude-code/cli.js",
            childPids: [3],
            cpuPercent: 200,
          }),
          proc(3, 2, "rg", 0.25),
          proc(4, 1, "-zsh", 0.1),
          proc(5, 1, "git", 0.1),
          proc(6, 1, "t3-resource-monitor", 0.05, { category: "resource-monitor" }),
        ],
        hostTopProcesses: [
          { name: "chrome", processCount: 9, cpuPercent: 20, residentBytes: 3 * GB },
        ],
      },
      {
        sampledAt: 0,
        cpuUtilization: 0.75,
        cpuCount: 4,
        availableMemoryBytes: 10 * GB,
        totalMemoryBytes: 16 * GB,
      },
    );
    expect(breakdown.agents).toEqual([
      { key: "2", label: "Claude", cpu: 0.5, memoryBytes: 0.5 * GB, processCount: 2 },
    ]);
    expect(breakdown.terminals.map((row) => row.label)).toEqual(["zsh"]);
    expect(breakdown.helpers.processCount).toBe(2);
    expect(breakdown.t3.memoryBytes).toBeCloseTo(1.25 * GB);
    expect(breakdown.other.memoryBytes).toBeCloseTo(4.75 * GB);
    expect(breakdown.other.cpu).toBeCloseTo(0.25);
    expect(breakdown.otherTop.map((group) => group.name)).toEqual(["chrome"]);
  });
});
