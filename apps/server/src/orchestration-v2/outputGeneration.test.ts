import { describe, expect, it } from "@effect/vitest";

import {
  estimateOutputGenerationMs,
  estimateOutputTokens,
  type TurnItemTimes,
  writtenChars,
} from "./outputGeneration.ts";

const item = (
  type: TurnItemTimes["type"],
  startedAtMs: number | null,
  completedAtMs: number | null,
): TurnItemTimes => ({ type, startedAtMs, completedAtMs, writtenChars: 0 });

describe("estimateOutputGenerationMs", () => {
  it.each([
    {
      name: "no tools: the whole turn",
      items: [item("assistant_message", 1_000, 9_000)],
      ms: 10_000,
    },
    {
      name: "overlapping tools count once",
      items: [item("command_execution", 2_000, 5_000), item("file_change", 4_000, 6_000)],
      ms: 6_000,
    },
    {
      name: "text written while a tool runs stays model time",
      items: [item("subagent", 2_000, 8_000), item("assistant_message", 3_000, 4_000)],
      ms: 5_000,
    },
    {
      name: "a tool still running is clipped to the turn",
      items: [item("command_execution", 8_000, null), item("approval_request", -5_000, 1_000)],
      ms: 7_000,
    },
    {
      name: "plans, notices and unstarted items are ignored",
      items: [item("todo_list", 0, 10_000), item("command_execution", null, 5_000)],
      ms: 10_000,
    },
  ])("$name", ({ items, ms }) => {
    expect(estimateOutputGenerationMs({ startedAtMs: 0, completedAtMs: 10_000, items })).toBe(ms);
  });
});

describe("estimateOutputTokens", () => {
  it("counts what the model wrote, with only the added lines of a diff", () => {
    const diff = ["--- a/x.ts", "+++ b/x.ts", "@@ -1 +1 @@", "-old line", "+new line", " context"];
    const items = [
      { ...item("file_change", 0, 1), writtenChars: writtenChars("file_change", diff.join("\n")) },
      { ...item("assistant_message", 1, 2), writtenChars: writtenChars("assistant_message", "hi") },
      { ...item("command_execution", 2, 3), writtenChars: writtenChars("command_execution", null) },
    ];
    expect(estimateOutputTokens(items)).toBe(6);
  });
});
