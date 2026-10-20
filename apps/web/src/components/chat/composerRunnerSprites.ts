/**
 * Fork: 8x8 pixel mascots for the composer runner, from Monocode
 * (https://github.com/hardbeat920/monocode, src/features/projects/model/projectMascots.ts).
 * MIT License, Copyright (c) 2026 Nick.
 *
 * "#" is a filled pixel, "." is empty. Each mascot has two frames that swap
 * while it walks: legs shuffle, mouths chew.
 */

type Rows = readonly string[];

const SPRITES: ReadonlyArray<{ name: string; rest: Rows; step: Rows }> = [
  {
    name: "invader",
    rest: [
      "..#..#..",
      ".######.",
      "##.##.##",
      "########",
      ".######.",
      ".#.##.#.",
      "#.#..#.#",
      "........",
    ],
    step: [
      "..#..#..",
      ".######.",
      "##.##.##",
      "########",
      ".######.",
      "#.####.#",
      ".#....#.",
      "#......#",
    ],
  },
  {
    name: "ghost",
    rest: [
      "..####..",
      ".######.",
      "##.##.##",
      "########",
      "########",
      "########",
      "########",
      "#.##.##.",
    ],
    step: [
      "..####..",
      ".######.",
      "#.##.###",
      "########",
      "########",
      "########",
      "########",
      ".##.##.#",
    ],
  },
  {
    name: "robot",
    rest: [
      "...#....",
      ".######.",
      ".#.##.#.",
      ".######.",
      ".#....#.",
      ".######.",
      "..#..#..",
      "........",
    ],
    step: [
      "....#...",
      ".######.",
      ".#.##.#.",
      ".######.",
      ".##..##.",
      ".######.",
      ".#....#.",
      "........",
    ],
  },
  {
    name: "cat",
    rest: [
      ".#....#.",
      ".##..##.",
      "########",
      "#.####.#",
      "########",
      "###..###",
      ".######.",
      "..#..#..",
    ],
    step: [
      ".#....#.",
      ".##..##.",
      "########",
      "#.####.#",
      "########",
      "########",
      ".######.",
      ".#....#.",
    ],
  },
  {
    name: "skull",
    rest: [
      ".######.",
      "########",
      "##.##.##",
      "########",
      ".##..##.",
      ".######.",
      ".#.##.#.",
      "........",
    ],
    step: [
      ".######.",
      "########",
      "##.##.##",
      "########",
      ".##..##.",
      ".######.",
      ".#....#.",
      "..####..",
    ],
  },
  {
    name: "crab",
    rest: [
      "#......#",
      ".#....#.",
      ".######.",
      "##.##.##",
      "########",
      "#.####.#",
      "#......#",
      "........",
    ],
    step: [
      "#......#",
      "##....##",
      ".######.",
      "##.##.##",
      "########",
      ".######.",
      "#.#..#.#",
      "........",
    ],
  },
  {
    name: "mushroom",
    rest: [
      "..####..",
      ".######.",
      "########",
      "##.##.##",
      "########",
      "...##...",
      "...##...",
      "..####..",
    ],
    step: [
      "........",
      "..####..",
      ".######.",
      "########",
      "##.##.##",
      "...##...",
      "...##...",
      "..####..",
    ],
  },
  {
    name: "dino",
    rest: [
      "...#####",
      "...##.##",
      "...#####",
      ".#######",
      "########",
      "#####...",
      ".##.##..",
      "..#..#..",
    ],
    step: [
      "...#####",
      "...##.##",
      "...#####",
      ".#######",
      "########",
      "#####...",
      "..##.##.",
      "..#...#.",
    ],
  },
  {
    name: "frog",
    rest: [
      "........",
      "##....##",
      "#.####.#",
      "########",
      "########",
      ".######.",
      "##....##",
      "........",
    ],
    step: [
      "##....##",
      "#.####.#",
      "########",
      "########",
      ".######.",
      "##....##",
      "#......#",
      "........",
    ],
  },
];

/** SVG path over an 8x8 viewBox; each row's filled runs become one rect. */
export function spritePath(rows: Rows): string {
  let path = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === "#") run += 1;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return path;
}

export interface RunnerSprite {
  readonly name: string;
  readonly restPath: string;
  readonly stepPath: string;
}

const RUNNER_SPRITES: readonly RunnerSprite[] = SPRITES.map((sprite) => ({
  name: sprite.name,
  restPath: spritePath(sprite.rest),
  stepPath: spritePath(sprite.step),
}));

/** The same project always gets the same mascot. */
export function runnerSprite(seed: string): RunnerSprite {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 131 + seed.charCodeAt(index)) >>> 0;
  }
  return RUNNER_SPRITES[hash % RUNNER_SPRITES.length]!;
}
