import { describe, expect, it } from "vite-plus/test";

import {
  formatLimitShare,
  totalTurnTokens,
  turnCostScore,
  windowCountsModel,
} from "./usageCost.ts";

describe("turnCostScore", () => {
  it("weighs output, cache reads and cache writes by the model's prices", () => {
    // Sonnet 4.6: $3 input, $15 output, $0.30 cache read, $3.75 cache write.
    const cost = turnCostScore("claudeAgent", "claude-sonnet-4-6", {
      inputTokens: 1_300_000,
      cachedInputTokens: 1_000_000,
      cacheCreationTokens: 100_000,
      outputTokens: 100_000,
    });
    expect(cost).toBeCloseTo(0.2 * 3 + 1 * 0.3 + 0.1 * 3.75 + 0.1 * 15);
  });

  it("prices Fable above Opus for the same tokens", () => {
    const usage = { inputTokens: 10_000, outputTokens: 2_000 };
    expect(turnCostScore("claudeAgent", "claude-fable-5-1", usage)).toBeGreaterThan(
      turnCostScore("claudeAgent", "claude-opus-5-5", usage),
    );
  });

  it("falls back to the driver's prices for an unknown model", () => {
    const usage = { inputTokens: 1_000_000 };
    expect(turnCostScore("codex", undefined, usage)).toBeCloseTo(1.25);
    expect(turnCostScore("codex", "gpt-5.5", usage)).toBeCloseTo(1.25);
  });

  it("ignores counts that are missing or not finite", () => {
    expect(turnCostScore("codex", "gpt-5", { outputTokens: Number.NaN })).toBe(0);
    expect(totalTurnTokens({ inputTokens: 40, outputTokens: 2 })).toBe(42);
  });
});

describe("windowCountsModel", () => {
  it("counts every model toward shared limits and one model toward its own", () => {
    expect(windowCountsModel("five_hour", undefined)).toBe(true);
    expect(windowCountsModel("seven_day", "claude-sonnet-5-5")).toBe(true);
    expect(windowCountsModel("seven_day_fable", "claude-fable-5-1")).toBe(true);
    expect(windowCountsModel("seven_day_fable", "claude-opus-5-5")).toBe(false);
    expect(windowCountsModel("seven_day_fable", undefined)).toBe(false);
  });
});

describe("formatLimitShare", () => {
  it("always reads as an estimate", () => {
    expect(formatLimitShare(0.04)).toBe("<0.1%");
    expect(formatLimitShare(0.44)).toBe("~0.4%");
    expect(formatLimitShare(12.6)).toBe("~13%");
  });
});
