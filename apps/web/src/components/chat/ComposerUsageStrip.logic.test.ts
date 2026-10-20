import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { cacheMinutesLeft, cacheTtlMinutes } from "./ComposerUsageStrip.logic";

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
