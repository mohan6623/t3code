import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accountProblem,
  cacheMinutesLeft,
  cacheTtlMinutes,
  otherUsageAccounts,
} from "./ComposerUsageStrip.logic";

const provider = (driver: string) => ({ driver: ProviderDriverKind.make(driver) });

describe("cacheTtlMinutes", () => {
  it("uses the cache tier Claude reported, assuming a subscription's hour before one", () => {
    expect(cacheTtlMinutes(provider("claudeAgent"), "claude-opus-5-5", undefined)).toBe(60);
    expect(cacheTtlMinutes(provider("claudeAgent"), "claude-opus-5-5", 5 * 60_000)).toBe(5);
  });

  it("follows the model's vendor through Cursor and OpenCode", () => {
    expect(cacheTtlMinutes(provider("codex"), "gpt-6.1", undefined)).toBe(30);
    expect(cacheTtlMinutes(provider("cursor"), "claude-sonnet-5-5", undefined)).toBe(5);
    expect(cacheTtlMinutes(provider("cursor"), "gpt-6.1", undefined)).toBe(30);
    expect(cacheTtlMinutes(provider("opencode"), "anthropic/claude-haiku-5-5", undefined)).toBe(5);
  });

  it("has no estimate where the lifetime is undocumented", () => {
    expect(cacheTtlMinutes(provider("cursor"), "composer-2", undefined)).toBeNull();
    expect(cacheTtlMinutes(provider("cursor"), "gemini-3.8-flash", undefined)).toBeNull();
    expect(cacheTtlMinutes(provider("antigravity"), "gemini-3.8-flash", undefined)).toBeNull();
  });
});

describe("cacheMinutesLeft", () => {
  const completedAt = "2026-10-20T12:00:00.000Z";
  const at = (minutes: number) => Date.parse(completedAt) + minutes * 60_000;

  it("counts down from the last finished turn and holds full while one runs", () => {
    const codex = provider("codex");
    expect(cacheMinutesLeft(codex, "gpt-6.1", undefined, { completedAt: null }, at(50))).toBe(30);
    expect(cacheMinutesLeft(codex, "gpt-6.1", undefined, { completedAt }, at(10.5))).toBe(20);
    expect(cacheMinutesLeft(codex, "gpt-6.1", undefined, { completedAt }, at(45))).toBe(0);
    expect(cacheMinutesLeft(codex, "gpt-6.1", undefined, null, at(1))).toBeNull();
  });
});

describe("accountProblem", () => {
  const base = {
    auth: { status: "authenticated" as const },
    status: "ready" as const,
    usageLimits: undefined,
  };

  it("names a signed-out, broken, or unreadable account", () => {
    expect(accountProblem({ ...base, auth: { status: "unauthenticated" } })).toBe("Signed out");
    expect(accountProblem({ ...base, status: "error" })).toBe("Not working");
    expect(
      accountProblem({
        ...base,
        usageLimits: {
          checkedAt: "2026-10-27T00:00:00.000Z",
          windows: [],
          unavailable: { reason: "probeFailed" },
        },
      }),
    ).toBe("Usage unreadable");
  });

  it("sees no problem in a working account, or one without subscription limits", () => {
    expect(accountProblem(base)).toBeNull();
    expect(
      accountProblem({
        ...base,
        usageLimits: {
          checkedAt: "2026-10-27T00:00:00.000Z",
          windows: [],
          unavailable: { reason: "unsupported" },
        },
      }),
    ).toBeNull();
  });
});

describe("otherUsageAccounts", () => {
  const account = (instanceId: string, overrides: Record<string, unknown> = {}) => ({
    instanceId: ProviderInstanceId.make(instanceId),
    enabled: true,
    installed: true,
    auth: { status: "authenticated" as const },
    status: "ready" as const,
    usageLimits: undefined,
    ...overrides,
  });

  it("keeps working accounts and marks broken ones, leaving out the one in use", () => {
    const current = account("claude");
    const working = account("codex");
    const signedOut = account("claudeMaxx", { auth: { status: "unauthenticated" } });
    const plain = account("opencode");
    const disabled = account("cursor", { enabled: false, auth: { status: "unauthenticated" } });
    const result = otherUsageAccounts(
      [current, working, signedOut, plain, disabled],
      current,
      (provider) => provider === working,
    );
    expect(result.map((provider) => provider.instanceId)).toEqual(["codex", "claudeMaxx"]);
  });
});
