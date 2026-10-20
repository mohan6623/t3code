import { describe, expect, it } from "vite-plus/test";

import { runnerSprite, spritePath } from "./composerRunnerSprites";

describe("composer runner sprites", () => {
  it("draws each row's filled run as one rect", () => {
    expect(spritePath(["##.#", "...."])).toBe("M0 0h2v1h-2zM3 0h1v1h-1z");
  });

  it("gives a project the same mascot every time, with two different frames", () => {
    const sprite = runnerSprite("project-a");
    expect(runnerSprite("project-a")).toBe(sprite);
    expect(sprite.restPath).not.toBe(sprite.stepPath);
    expect(runnerSprite("").name).toBeTruthy();
  });
});
