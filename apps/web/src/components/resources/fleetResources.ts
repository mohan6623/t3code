// Fork: one reading per connected machine, for the Resources button and popover.
import type { EnvironmentId, HostResourcesSnapshot } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentPresentation } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { hostUsage, type HostUsage, type MachineEntry } from "./ResourcesPopover.logic";

export interface FleetReading {
  readonly environmentId: EnvironmentId;
  /** Only the live source carries a snapshot; the popover's tiles need its capacities. */
  readonly snapshot: HostResourcesSnapshot | null;
  readonly usage: HostUsage | null;
}

// One 200 ms CPU sample at a busy moment would keep the button red for a minute; the
// recorder's minute means only flag sustained load.
const RECENT_HISTORY = { windowMs: 2 * 60_000, points: 1 } as const;

const readingsFamily = (source: "live" | "recent") =>
  // Keyed by content: callers derive the id list every render.
  Atom.family((environmentIdsKey: string) =>
    Atom.make((get): ReadonlyArray<FleetReading> =>
      (environmentIdsKey === "" ? [] : (environmentIdsKey.split("\n") as EnvironmentId[])).map(
        (environmentId) => {
          if (source === "live") {
            const result = get(serverEnvironment.hostResourcesLive({ environmentId, input: {} }));
            const snapshot = result._tag === "Success" ? result.value : null;
            return { environmentId, snapshot, usage: snapshot ? hostUsage(snapshot) : null };
          }
          const result = get(
            serverEnvironment.hostResourceHistory({ environmentId, input: RECENT_HISTORY }),
          );
          const point = result._tag === "Success" ? result.value.points.at(-1) : undefined;
          const usage =
            point && (point.cpu !== null || point.memory !== null || point.disk !== null)
              ? { cpu: point.cpu, memory: point.memory, disk: point.disk }
              : null;
          return { environmentId, snapshot: null, usage };
        },
      ),
    ),
  );

/** Polls every 5 s; mount only while the popover is open. */
export const liveFleetReadingsAtom = readingsFamily("live");
/** The busier of the last two minutes, refreshed once a minute, for the header button. */
export const recentFleetReadingsAtom = readingsFamily("recent");

const SHOWN_PHASES = new Set(["connected", "connecting", "reconnecting", "offline", "error"]);

export interface FleetMachine extends MachineEntry {
  readonly environmentId: EnvironmentId;
  readonly snapshot: HostResourcesSnapshot | null;
  readonly connecting: boolean;
}

export function fleetEnvironmentIdsKey(environments: ReadonlyArray<EnvironmentPresentation>) {
  return environments
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => environment.environmentId)
    .toSorted()
    .join("\n");
}

export function fleetMachines(
  environments: ReadonlyArray<EnvironmentPresentation>,
  readings: ReadonlyArray<FleetReading>,
): FleetMachine[] {
  const byId = new Map(readings.map((reading) => [reading.environmentId, reading]));
  return environments
    .filter((environment) => SHOWN_PHASES.has(environment.connection.phase))
    .map((environment) => {
      const phase = environment.connection.phase;
      const reading = phase === "connected" ? byId.get(environment.environmentId) : undefined;
      return {
        environmentId: environment.environmentId,
        label: environment.label,
        snapshot: reading?.snapshot ?? null,
        usage: reading?.usage ?? null,
        reachable: phase === "connected" || phase === "connecting" || phase === "reconnecting",
        connecting: phase === "connecting" || phase === "reconnecting",
      };
    });
}
