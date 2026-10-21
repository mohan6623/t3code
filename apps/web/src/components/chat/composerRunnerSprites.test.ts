import { describe, expect, it } from "vite-plus/test";

import { MASCOTS, RUNNER_SPRITES, runnerSprite, spritePath } from "./composerRunnerSprites";

describe("composer runner sprites", () => {
  it("draws each row's run of one color as one rect", () => {
    expect(spritePath(["##.#", "...."])).toBe("M0 0h2v1h-2zM3 0h1v1h-1z");
    expect(spritePath(["oeo"], "e")).toBe("M1 0h1v1h-1z");
  });

  it("gives a project the same fallback mascot every time, with frames that differ", () => {
    const sprite = runnerSprite("opencode", "project-a", undefined)!;
    expect(runnerSprite("opencode", "project-a", undefined)).toBe(sprite);
    expect(sprite.frames[0]).not.toEqual(sprite.frames[1]);
    expect(runnerSprite("opencode", "", undefined)?.id).toBeTruthy();
  });

  it("gives Claude, Codex, Cursor and Antigravity their own mascots", () => {
    expect(runnerSprite("claudeAgent", "project-a", undefined)?.id).toBe("clawd");
    expect(runnerSprite("codex", "project-a", undefined)?.id).toBe("codex-bot");
    expect(runnerSprite("cursor", "project-a", undefined)?.id).toBe("cursor-cube");
    expect(runnerSprite("antigravity", "project-a", undefined)?.motion).toBe("float");
  });

  it("follows the user's choice, and falls back to the default for a mascot that is gone", () => {
    expect(runnerSprite("codex", "project-a", "frog")?.id).toBe("frog");
    expect(runnerSprite("codex", "project-a", "off")).toBeNull();
    expect(runnerSprite("codex", "project-a", "project")).toBe(
      runnerSprite("opencode", "project-a", undefined),
    );
    expect(runnerSprite("codex", "project-a", "retired-mascot")?.id).toBe("codex-bot");
    expect(RUNNER_SPRITES.has("project")).toBe(false);
    expect(RUNNER_SPRITES.has("off")).toBe(false);
  });

  it.each(Object.entries(MASCOTS))("draws %s on one grid, in its own colors", (_id, mascot) => {
    const width = mascot.frames[0][0]!.length;
    const height = mascot.frames[0].length;
    for (const rows of [...mascot.frames, mascot.blink?.rows ?? []]) {
      expect(rows.length).toBeLessThanOrEqual(height);
      for (const row of rows) {
        expect(row).toHaveLength(width);
        for (const pixel of row.replaceAll(".", "")) expect(mascot.palette).toHaveProperty(pixel);
      }
    }
    for (const rows of mascot.frames) expect(rows).toHaveLength(height);
  });
});
