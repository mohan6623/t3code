import { describe, expect, it } from "vite-plus/test";

import { PROVIDER_MASCOTS, runnerSprite, spritePath } from "./composerRunnerSprites";

describe("composer runner sprites", () => {
  it("draws each row's run of one color as one rect", () => {
    expect(spritePath(["##.#", "...."])).toBe("M0 0h2v1h-2zM3 0h1v1h-1z");
    expect(spritePath(["oeo"], "e")).toBe("M1 0h1v1h-1z");
  });

  it("gives a project the same fallback mascot every time, with frames that differ", () => {
    const sprite = runnerSprite("opencode", "project-a");
    expect(runnerSprite("opencode", "project-a")).toBe(sprite);
    expect(sprite.frames[0]).not.toEqual(sprite.frames[1]);
    expect(runnerSprite("opencode", "").name).toBeTruthy();
  });

  it("gives Claude, Codex, Cursor and Antigravity their own mascots", () => {
    expect(runnerSprite("claudeAgent", "project-a").name).toBe("clawd");
    expect(runnerSprite("codex", "project-a").name).toBe("terminal");
    expect(runnerSprite("cursor", "project-a").name).toBe("arrow");
    expect(runnerSprite("antigravity", "project-a").motion).toBe("float");
  });

  it.each(Object.entries(PROVIDER_MASCOTS))(
    "draws %s on one grid, in its own colors",
    (_driver, mascot) => {
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
    },
  );
});
