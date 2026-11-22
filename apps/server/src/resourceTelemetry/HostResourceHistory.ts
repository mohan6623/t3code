// Fork: a cheap, always-on record of this host's CPU / memory / disk use, so the
// Resources popover has a past to draw even when nobody had it open.
import type {
  HostResourceHistory as HostResourceHistoryResult,
  HostResourceHistoryInput,
  HostResourcesSnapshot,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";
import { HostResources } from "./HostResources.ts";

const SAMPLE_INTERVAL_MS = 15_000;
const POINT_INTERVAL_MS = 60_000;
export const RETENTION_MS = 24 * 60 * 60_000;
const PERSIST_INTERVAL = "10 minutes";
const FILE_NAME = "host-resource-history.json";

const Fraction = Schema.NullOr(Schema.Number);
/** One minute of history: mean CPU, peak memory, last disk reading. */
export const RecordedPoint = Schema.Struct({
  at: Schema.Number,
  cpu: Fraction,
  memory: Fraction,
  disk: Fraction,
});
export type RecordedPoint = typeof RecordedPoint.Type;
const PersistedHistory = Schema.Struct({
  version: Schema.Literal(1),
  points: Schema.Array(RecordedPoint),
});
const PersistedHistoryJson = Schema.fromJsonString(PersistedHistory);
const decodePersisted = Schema.decodeUnknownOption(PersistedHistoryJson);
const encodePersisted = Schema.encodeEffect(PersistedHistoryJson);

export function usedFractions(snapshot: HostResourcesSnapshot) {
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

// Three decimals keeps the saved file small; the popover shows whole percents.
const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
const maxOf = (values: ReadonlyArray<number | null>) => {
  const present = values.filter((value) => value !== null);
  return present.length > 0 ? clamp(Math.max(...present)) : null;
};

/** Folds one minute of samples into a point; null when the minute has none. */
export function foldMinute(
  at: number,
  samples: ReadonlyArray<ReturnType<typeof usedFractions>>,
): RecordedPoint | null {
  if (samples.length === 0) return null;
  const cpus = samples.flatMap(({ cpu }) => (cpu === null ? [] : [cpu]));
  const lastDisk = samples.findLast(({ disk }) => disk !== null)?.disk ?? null;
  return {
    at,
    cpu: cpus.length > 0 ? clamp(cpus.reduce((sum, cpu) => sum + cpu, 0) / cpus.length) : null,
    memory: maxOf(samples.map(({ memory }) => memory)),
    disk: lastDisk === null ? null : clamp(lastDisk),
  };
}

export function retain(points: ReadonlyArray<RecordedPoint>, now: number): RecordedPoint[] {
  return points.filter((point) => point.at > now - RETENTION_MS && point.at <= now + 60_000);
}

/**
 * Splits the window into equal slices and keeps each slice's busiest reading, so a short
 * spike survives downsampling. A slice with no recording stays null: the host was down.
 */
export function downsample(
  points: ReadonlyArray<RecordedPoint>,
  input: HostResourceHistoryInput,
  now: number,
): HostResourceHistoryResult {
  const sliceMs = input.windowMs / input.points;
  const start = now - input.windowMs;
  const slices = Array.from({ length: input.points }, () => [] as RecordedPoint[]);
  for (const point of points) {
    if (point.at <= start || point.at > now) continue;
    const index = Math.min(input.points - 1, Math.floor((point.at - start - 1) / sliceMs));
    slices[index]!.push(point);
  }
  return {
    windowMs: input.windowMs,
    points: slices.map((slice, index) => ({
      endsAt: Math.round(start + (index + 1) * sliceMs),
      cpu: maxOf(slice.map(({ cpu }) => cpu)),
      memory: maxOf(slice.map(({ memory }) => memory)),
      disk: maxOf(slice.map(({ disk }) => disk)),
    })),
  };
}

export class HostResourceHistory extends Context.Service<
  HostResourceHistory,
  { readonly read: (input: HostResourceHistoryInput) => Effect.Effect<HostResourceHistoryResult> }
>()("t3/resourceTelemetry/HostResourceHistory") {}

const make = Effect.fn("makeHostResourceHistory")(function* () {
  const host = yield* HostResources;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig;
  const filePath = path.join(stateDir, FILE_NAME);

  const loaded = yield* fs.readFileString(filePath).pipe(
    Effect.map((text) => decodePersisted(text)),
    Effect.orElseSucceed(() => undefined),
  );
  const startedAt = yield* Clock.currentTimeMillis;
  const points = yield* Ref.make(
    loaded?._tag === "Some" ? retain(loaded.value.points, startedAt) : [],
  );
  const pending = yield* Ref.make<{
    minute: number;
    samples: Array<ReturnType<typeof usedFractions>>;
  }>({ minute: Math.floor(startedAt / POINT_INTERVAL_MS), samples: [] });

  const flush = Effect.gen(function* () {
    const { minute, samples } = yield* Ref.getAndSet(pending, {
      minute: Math.floor((yield* Clock.currentTimeMillis) / POINT_INTERVAL_MS),
      samples: [],
    });
    const point = foldMinute((minute + 1) * POINT_INTERVAL_MS, samples);
    if (point === null) return;
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(points, (current) => retain([...current, point], now));
  });

  const sample = Effect.gen(function* () {
    const fractions = usedFractions(yield* host.read);
    const minute = Math.floor((yield* Clock.currentTimeMillis) / POINT_INTERVAL_MS);
    if (minute !== (yield* Ref.get(pending)).minute) yield* flush;
    yield* Ref.update(pending, (current) => ({
      ...current,
      samples: [...current.samples, fractions],
    }));
  });

  const persist = Effect.gen(function* () {
    const contents = yield* encodePersisted({ version: 1, points: yield* Ref.get(points) });
    yield* writeFileStringAtomically({ filePath, contents });
  }).pipe(Effect.ignore);

  // ~1 ms of work every 15 s; the file stays under 100 KB and is written every 10 minutes.
  yield* Effect.forkScoped(
    sample.pipe(Effect.repeat(Schedule.spaced(`${SAMPLE_INTERVAL_MS} millis`))),
  );
  yield* Effect.forkScoped(
    persist.pipe(Effect.repeat(Schedule.spaced(PERSIST_INTERVAL)), Effect.delay(PERSIST_INTERVAL)),
  );
  yield* Effect.addFinalizer(() => Effect.andThen(flush, persist));

  return HostResourceHistory.of({
    read: Effect.fn("HostResourceHistory.read")(function* (input) {
      const now = yield* Clock.currentTimeMillis;
      const { samples } = yield* Ref.get(pending);
      // The minute in progress counts too, so a just-opened popover is never empty.
      const live = foldMinute(now, samples);
      const current = yield* Ref.get(points);
      return downsample(live ? [...current, live] : current, input, now);
    }),
  });
});

export const layer = Layer.effect(HostResourceHistory, make());
