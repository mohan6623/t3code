import { assert, describe, it } from "@effect/vitest";

import {
  RETENTION_MS,
  downsample,
  foldMinute,
  retain,
  usedFractions,
  type RecordedPoint,
} from "./HostResourceHistory.ts";

const MINUTE = 60_000;
const point = (at: number, cpu: number | null, memory = 0.5, disk = 0.7): RecordedPoint => ({
  at,
  cpu,
  memory,
  disk,
});

describe("HostResourceHistory", () => {
  it("folds a minute into mean CPU, peak memory and the last disk reading", () => {
    const folded = foldMinute(MINUTE, [
      { cpu: 0.2, memory: 0.4, disk: 0.6 },
      { cpu: null, memory: 0.9, disk: null },
      { cpu: 0.4, memory: 0.5, disk: 0.61 },
    ]);
    assert.deepStrictEqual(folded, { at: MINUTE, cpu: 0.3, memory: 0.9, disk: 0.61 });
    assert.strictEqual(foldMinute(MINUTE, []), null);
  });

  it("reads disk as unknown when an older snapshot has no disk fields", () => {
    const fractions = usedFractions({
      sampledAt: 0,
      cpuUtilization: 0.5,
      cpuCount: 4,
      availableMemoryBytes: 25,
      totalMemoryBytes: 100,
    });
    assert.deepStrictEqual(fractions, { cpu: 0.5, memory: 0.75, disk: null });
  });

  it("keeps a short spike when downsampling and leaves unrecorded slices empty", () => {
    const now = 60 * MINUTE;
    const points = [
      point(now - 55 * MINUTE, 0.1),
      point(now - 54 * MINUTE, 0.95),
      point(now - 53 * MINUTE, 0.1),
      // nothing recorded for the next 45 minutes: the host was asleep
      point(now - 5 * MINUTE, 0.2),
    ];
    const { points: slices } = downsample(points, { windowMs: 60 * MINUTE, points: 6 }, now);
    assert.deepStrictEqual(
      slices.map((slice) => slice.cpu),
      [0.95, null, null, null, null, 0.2],
    );
    assert.strictEqual(slices.at(-1)?.endsAt, now);
  });

  it("drops points older than a day and points from a clock far ahead", () => {
    const now = 2 * RETENTION_MS;
    const kept = retain(
      [point(now - RETENTION_MS - 1, 0.1), point(now - MINUTE, 0.2), point(now + 10 * MINUTE, 0.3)],
      now,
    );
    assert.deepStrictEqual(
      kept.map((entry) => entry.cpu),
      [0.2],
    );
  });
});
