import { describe, expect, it } from "@effect/vitest";
import type { ServerProviderUsageLimits } from "@t3tools/contracts";

import {
  type CalibrationState,
  costPerToken,
  limitShares,
  observeLimits,
  recordCost,
} from "./UsageCalibration.ts";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const SESSION_RESET = "2026-10-20T13:00:00Z";
const WEEK_RESET = "2026-10-25T00:00:00Z";

const limits = (session: number, weekly: number, fable = 0): ServerProviderUsageLimits => ({
  checkedAt: "2026-10-20T10:00:00Z",
  windows: [
    {
      id: "five_hour",
      kind: "session",
      label: "Session",
      usedPercent: session,
      resetsAt: SESSION_RESET,
    },
    { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: weekly, resetsAt: WEEK_RESET },
    {
      id: "seven_day_fable",
      kind: "weekly",
      label: "Weekly · Fable",
      usedPercent: fable,
      resetsAt: WEEK_RESET,
    },
  ],
});

describe("UsageCalibration", () => {
  it("learns what 1% costs from the rise between updates", () => {
    const state: CalibrationState = {};
    observeLimits(state, "maxx", limits(10, 2), NOW);
    recordCost(state, "maxx", "claude-sonnet-5-5", 3, 1_000_000);
    observeLimits(state, "maxx", limits(13, 3), NOW);

    // 3 cost filled 3% of the session and 1% of the week.
    expect(limitShares(state, "maxx", "claude-sonnet-5-5", 0.5)).toEqual([
      { id: "five_hour", label: "Session", percent: 0.5 },
    ]);
    recordCost(state, "maxx", "claude-sonnet-5-5", 3, 1_000_000);
    observeLimits(state, "maxx", limits(16, 4), NOW);
    const shares = limitShares(state, "maxx", "claude-sonnet-5-5", 0.6);
    expect(shares.find((share) => share.id === "seven_day")?.percent).toBeCloseTo(0.2);
    expect(costPerToken(state, "maxx")).toBeCloseTo(3 / 1_000_000);
  });

  it("evens out whole-percent rounding over several updates", () => {
    const state: CalibrationState = {};
    observeLimits(state, "maxx", limits(0, 0), NOW);
    // Each turn costs 0.4%: the reported figure moves only every few turns.
    const reported = [0, 1, 1, 2, 2];
    for (const percent of reported) {
      recordCost(state, "maxx", "claude-sonnet-5-5", 0.4, 1);
      observeLimits(state, "maxx", limits(percent, 0), NOW);
    }
    expect(limitShares(state, "maxx", undefined, 1)[0]?.percent).toBeCloseTo(1);
  });

  it("drops the cost of an interval that ended in a reset", () => {
    const state: CalibrationState = {};
    observeLimits(state, "maxx", limits(80, 10), NOW);
    recordCost(state, "maxx", "claude-sonnet-5-5", 50, 1);
    observeLimits(state, "maxx", limits(2, 12), NOW);
    recordCost(state, "maxx", "claude-sonnet-5-5", 2, 1);
    observeLimits(state, "maxx", limits(4, 12), NOW);
    // Only the 2 cost after the reset is matched to the session's 2% rise.
    const session = limitShares(state, "maxx", undefined, 1).find(
      (share) => share.id === "five_hour",
    );
    expect(session?.percent).toBeCloseTo(1);
  });

  it("keeps other models' cost out of a model's own limit", () => {
    const state: CalibrationState = {};
    observeLimits(state, "maxx", limits(0, 0, 0), NOW);
    recordCost(state, "maxx", "claude-opus-5-5", 10, 1);
    recordCost(state, "maxx", "claude-fable-5-1", 2, 1);
    observeLimits(state, "maxx", limits(12, 6, 4), NOW);
    const fable = limitShares(state, "maxx", "claude-fable-5-1", 1).find(
      (share) => share.id === "seven_day_fable",
    );
    expect(fable?.percent).toBeCloseTo(2);
    expect(
      limitShares(state, "maxx", "claude-opus-5-5", 1).some(
        (share) => share.id === "seven_day_fable",
      ),
    ).toBe(false);
  });

  it("shows nothing for an account it has not learned yet", () => {
    const state: CalibrationState = {};
    observeLimits(state, "codex", limits(1, 0), NOW);
    recordCost(state, "codex", "gpt-5", 1, 1);
    observeLimits(state, "codex", limits(2, 0), NOW);
    expect(limitShares(state, "codex", "gpt-5", 1)).toEqual([]);
    expect(limitShares(state, "unknown", "gpt-5", 1)).toEqual([]);
  });
});
