/**
 * Fork: learns, per account and per limit, how much cost score fills 1%.
 *
 * Providers report limits only for the whole account, as whole percents. The
 * app already sees each turn's tokens and each limits update (the badge, the
 * panel, Claude's rate-limit events), so it adds up the cost of the turns run
 * between two updates and how far the limit rose. Summed over many updates the
 * rounding evens out. Nothing here asks a provider for anything.
 *
 * Work done outside the app (the website, a phone, a terminal) rises the limit
 * with no cost seen, so estimates lean high on busy shared accounts.
 */
import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { windowCountsModel } from "@t3tools/shared/usageCost";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";

/** The learned figure needs this many percent seen before it is trusted. */
const MIN_PERCENT_SEEN = 2;
/** Above this, both sums halve, so recent use outweighs old use. */
const DECAY_PERCENT = 40;
/** A reset time this far from the last one means a new window started. */
const NEW_WINDOW_SHIFT_MS = 60 * 60_000;
const SAVE_EVERY = "60 seconds";
const FILE_NAME = "usage-calibration.json";

interface WindowCalibration {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  /** Cost of turns since the last update, not yet matched to a rise. */
  pendingCost: number;
  sumCost: number;
  sumPercent: number;
}

interface AccountCalibration {
  windows: Record<string, WindowCalibration>;
  /** Cost and tokens of every turn seen, for subagents that report only a total. */
  costSum: number;
  tokenSum: number;
}

export type CalibrationState = Record<string, AccountCalibration>;

export interface LimitWindowShare {
  readonly id: string;
  readonly label: string;
  readonly percent: number;
}

const account = (state: CalibrationState, instanceId: string): AccountCalibration =>
  (state[instanceId] ??= { windows: {}, costSum: 0, tokenSum: 0 });

/** Adds a turn's cost to every limit it fills. */
export function recordCost(
  state: CalibrationState,
  instanceId: string,
  model: string | undefined,
  cost: number,
  tokens: number,
): void {
  if (!(cost > 0)) return;
  const entry = account(state, instanceId);
  entry.costSum += cost;
  entry.tokenSum += Math.max(0, tokens);
  for (const [id, window] of Object.entries(entry.windows)) {
    if (windowCountsModel(id, model)) window.pendingCost += cost;
  }
}

function sameWindow(window: WindowCalibration, resetsAt: string | undefined, now: number) {
  if (window.resetsAt === null || resetsAt === undefined) return true;
  const previous = Date.parse(window.resetsAt);
  const next = Date.parse(resetsAt);
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return true;
  return previous > now && Math.abs(next - previous) < NEW_WINDOW_SHIFT_MS;
}

/** Matches the cost seen since the last update to how far each limit rose. */
export function observeLimits(
  state: CalibrationState,
  instanceId: string,
  limits: ServerProviderUsageLimits,
  now: number,
): boolean {
  if (limits.unavailable !== undefined) return false;
  const entry = account(state, instanceId);
  let changed = false;
  for (const next of limits.windows) {
    const window = entry.windows[next.id];
    if (window === undefined) {
      entry.windows[next.id] = {
        label: next.label,
        usedPercent: next.usedPercent,
        resetsAt: next.resetsAt ?? null,
        pendingCost: 0,
        sumCost: 0,
        sumPercent: 0,
      };
      changed = true;
      continue;
    }
    window.label = next.label;
    const rise = next.usedPercent - window.usedPercent;
    if (rise < 0 || !sameWindow(window, next.resetsAt, now)) {
      // A reset: the cost since the last update can't be matched to a rise.
      window.pendingCost = 0;
    } else if (rise > 0 || window.pendingCost > 0) {
      window.sumCost += window.pendingCost;
      window.sumPercent += rise;
      window.pendingCost = 0;
      if (window.sumPercent > DECAY_PERCENT) {
        window.sumCost /= 2;
        window.sumPercent /= 2;
      }
    } else {
      continue;
    }
    window.usedPercent = next.usedPercent;
    window.resetsAt = next.resetsAt ?? null;
    changed = true;
  }
  return changed;
}

/** Each learned limit's share of `cost`; limits still learning are left out. */
export function limitShares(
  state: CalibrationState,
  instanceId: string,
  model: string | undefined,
  cost: number,
): ReadonlyArray<LimitWindowShare> {
  const entry = state[instanceId];
  if (entry === undefined) return [];
  return Object.entries(entry.windows).flatMap(([id, window]) =>
    window.sumPercent >= MIN_PERCENT_SEEN && window.sumCost > 0 && windowCountsModel(id, model)
      ? [{ id, label: window.label, percent: (cost * window.sumPercent) / window.sumCost }]
      : [],
  );
}

/** Cost per token on this account so far, for subagents that report only a total. */
export function costPerToken(state: CalibrationState, instanceId: string): number | undefined {
  const entry = state[instanceId];
  return entry && entry.tokenSum > 0 ? entry.costSum / entry.tokenSum : undefined;
}

export interface UsageCalibrationShape {
  readonly recordCost: (input: {
    readonly instanceId: ProviderInstanceId;
    readonly model: string | undefined;
    readonly cost: number;
    readonly tokens: number;
  }) => void;
  readonly limitShares: (input: {
    readonly instanceId: ProviderInstanceId;
    readonly model: string | undefined;
    readonly cost: number;
  }) => ReadonlyArray<LimitWindowShare>;
  readonly costPerToken: (instanceId: ProviderInstanceId) => number | undefined;
}

/** Defaults to off, so tests and tools that build the ingestor alone need nothing. */
export class UsageCalibration extends Context.Reference<UsageCalibrationShape>(
  "t3/usage/UsageCalibration",
  {
    defaultValue: () => ({
      recordCost: () => undefined,
      limitShares: () => [],
      costPerToken: () => undefined,
    }),
  },
) {}

const StateJson = Schema.fromJsonString(Schema.Unknown);
const decodeStateJson = Schema.decodeUnknownOption(StateJson);
const encodeStateJson = Schema.encodeSync(StateJson);

function parseState(text: string): CalibrationState {
  const parsed = Option.getOrUndefined(decodeStateJson(text));
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as CalibrationState)
    : {};
}

export const layer = Layer.effect(
  UsageCalibration,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const registry = yield* ProviderRegistry;
    const filePath = path.join(config.stateDir, FILE_NAME);

    const state = parseState(
      yield* fileSystem.readFileString(filePath).pipe(Effect.orElseSucceed(() => "{}")),
    );
    let dirty = false;

    const observe = (providers: ReadonlyArray<ServerProvider>) =>
      Clock.currentTimeMillis.pipe(
        Effect.map((now) => {
          for (const provider of providers) {
            if (provider.usageLimits === undefined) continue;
            if (observeLimits(state, provider.instanceId, provider.usageLimits, now)) dirty = true;
          }
        }),
      );

    yield* registry.getProviders.pipe(Effect.flatMap(observe));
    yield* Stream.runForEach(registry.streamChanges, observe).pipe(Effect.forkScoped);

    // At most one small write a minute, and none while nothing changed.
    yield* Effect.sleep(SAVE_EVERY).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (!dirty) return Effect.void;
          dirty = false;
          return writeFileStringAtomically({ filePath, contents: encodeStateJson(state) }).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
            Effect.catchCause((cause) =>
              Effect.logDebug("Usage calibration save skipped", { cause }),
            ),
          );
        }),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    return {
      recordCost: ({ instanceId, model, cost, tokens }) => {
        recordCost(state, instanceId, model, cost, tokens);
        dirty = true;
      },
      limitShares: ({ instanceId, model, cost }) => limitShares(state, instanceId, model, cost),
      costPerToken: (instanceId) => costPerToken(state, instanceId),
    } satisfies UsageCalibrationShape;
  }),
);
