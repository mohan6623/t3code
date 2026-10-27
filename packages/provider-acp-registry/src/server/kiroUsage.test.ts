import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";

import { AcpRegistrySettings } from "../settings.ts";
import {
  isKiroAcpAgent,
  KIRO_COMMAND_EXECUTE_METHOD,
  kiroMetadataReportsMetering,
  kiroUsageResponseToLimits,
  readKiroUsageLimits,
} from "./kiroUsage.ts";

const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const checkedAt = "2026-10-25T00:00:00.000Z";

/** The `/usage` answer kiro-cli 2.33.0 gave for a KIRO PRO+ account. */
const liveResponse = {
  success: true,
  message: "Plan: KIRO PRO+ ...",
  data: {
    planName: "KIRO PRO+",
    billingCycleReset: "2026-11-01",
    overagesEnabled: false,
    isEnterprise: true,
    usageBreakdowns: [
      {
        resourceType: "CREDIT",
        displayName: "Credits",
        used: 222.29,
        limit: 2000,
        percentage: 11.11,
        hasLimit: true,
        currentOverages: 0,
        overageRate: 0.04,
        overageCharges: 0,
        currency: "USD",
      },
    ],
    bonusCredits: [],
    addOnCredits: [],
    overageCapable: true,
  },
};

describe("Kiro credit usage", () => {
  it("maps the credit breakdown onto one monthly window", () => {
    expect(kiroUsageResponseToLimits(liveResponse, checkedAt)).toEqual({
      checkedAt,
      windows: [
        {
          id: "credits",
          kind: "monthly",
          label: "222 / 2,000 credits",
          usedPercent: 11.11,
          resetsAt: "2026-11-01T00:00:00.000Z",
          windowDurationMins: 31 * 24 * 60,
        },
      ],
    });
  });

  it("accepts the bare data object and computes a missing percentage", () => {
    const limits = kiroUsageResponseToLimits(
      {
        usageBreakdowns: [
          { resourceType: "OTHER", used: 1, limit: 0 },
          { resourceType: "CREDIT", used: 1500, limit: 1000, hasLimit: true },
        ],
      },
      checkedAt,
    );
    expect(limits.unavailable).toBeUndefined();
    expect(limits.windows).toEqual([
      { id: "credits", kind: "monthly", label: "1,500 / 1,000 credits", usedPercent: 100 },
    ]);
  });

  it("falls back to the first limited breakdown and adds bonus credits", () => {
    const limits = kiroUsageResponseToLimits(
      {
        data: {
          usageBreakdowns: [
            { resourceType: "AGENT_CREDITS", used: 50, limit: 100, percentage: 50 },
          ],
          bonusCredits: [{ amount: 100, used: 25 }],
          addOnCredits: ["unexpected"],
        },
      },
      checkedAt,
    );
    expect(limits.windows).toEqual([
      { id: "credits", kind: "monthly", label: "75 / 200 credits", usedPercent: 37.5 },
    ]);
  });

  it("reports an unexpected answer as a failed read", () => {
    for (const response of [
      undefined,
      "usage",
      { success: false, data: liveResponse.data },
      { data: { usageBreakdowns: "none" } },
      { data: { usageBreakdowns: [{ resourceType: "CREDIT", used: "1", limit: 10 }] } },
      { data: { usageBreakdowns: [{ resourceType: "CREDIT", used: 1, limit: 0 }] } },
    ]) {
      const limits = kiroUsageResponseToLimits(response, checkedAt);
      expect(limits.windows).toEqual([]);
      expect(limits.unavailable?.reason).toBe("probeFailed");
    }
  });

  it("recognizes Kiro by local command or registry agent id", () => {
    expect(isKiroAcpAgent(decodeSettings({ source: "local", commandPath: "kiro-cli" }))).toBe(true);
    expect(
      isKiroAcpAgent(
        decodeSettings({
          source: "local",
          commandPath: "C:\\Users\\me\\AppData\\Local\\Kiro-Cli\\kiro-cli.exe",
        }),
      ),
    ).toBe(true);
    expect(isKiroAcpAgent(decodeSettings({ agentId: "kiro-cli" }))).toBe(true);
    expect(isKiroAcpAgent(decodeSettings({ agentId: "devin" }), "/usr/bin/kiro-cli")).toBe(true);
    expect(isKiroAcpAgent(decodeSettings({ agentId: "devin" }))).toBe(false);
    expect(isKiroAcpAgent(decodeSettings({ source: "local", commandPath: "kiro" }))).toBe(false);
  });

  it("reads metering notices only when a turn spent credits", () => {
    expect(
      kiroMetadataReportsMetering({
        sessionId: "session-1",
        meteringUsage: [{ value: 0.4, unit: "credit", unitPlural: "credits" }],
      }),
    ).toBe(true);
    expect(kiroMetadataReportsMetering({ sessionId: "session-1", contextUsagePercentage: 4 })).toBe(
      false,
    );
    expect(kiroMetadataReportsMetering({ meteringUsage: [{ value: 1 }] })).toBe(false);
  });

  it.effect("asks the open session and never fails the caller", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: string; payload: unknown }> = [];
      const good = yield* readKiroUsageLimits(
        (method, payload) =>
          Effect.sync(() => {
            calls.push({ method, payload });
            return liveResponse;
          }),
        "session-1",
      );
      expect(calls).toEqual([
        {
          method: KIRO_COMMAND_EXECUTE_METHOD,
          payload: { sessionId: "session-1", command: { command: "usage", args: {} } },
        },
      ]);
      expect(good.windows[0]?.usedPercent).toBe(11.11);

      const failed = yield* readKiroUsageLimits(
        () =>
          Effect.fail(
            new EffectAcpErrors.AcpRequestError({ code: -32601, errorMessage: "Method not found" }),
          ),
        "session-1",
      );
      expect(failed.unavailable?.reason).toBe("probeFailed");
    }),
  );
});
