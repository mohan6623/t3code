import { describe, expect, it } from "vite-plus/test";

import { findSelectionSourceLines } from "./fileCommentAnnotations";

const TOUR = [
  "# Tour",
  "",
  "Start with **the server** and read",
  "the [orchestrator](./Orchestrator.ts) next.",
  "",
  "- Projections feed the UI",
  "- Effects run after commit",
].join("\n");

describe("findSelectionSourceLines", () => {
  it.each([
    ["a heading", "Tour", { startLine: 1, endLine: 1 }],
    ["text that hides markdown syntax", "the server and read", { startLine: 3, endLine: 3 }],
    [
      "a paragraph the renderer rewrapped",
      "Start with the server and read the orchestrator next.",
      { startLine: 3, endLine: 4 },
    ],
    [
      "list items across lines",
      "Projections feed the UI\nEffects run after commit",
      { startLine: 6, endLine: 7 },
    ],
    ["words not in the file", "nothing like this", null],
  ])("matches %s", (_name, selected, expected) => {
    expect(findSelectionSourceLines(TOUR, selected)).toEqual(expected);
  });
});
