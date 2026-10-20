/**
 * Fork: pixel mascots for the composer runner. Each provider with a mascot
 * gets its own; any other provider walks one of Monocode's 8x8 mascots
 * (https://github.com/hardbeat920/monocode, src/features/projects/model/projectMascots.ts,
 * MIT License, Copyright (c) 2026 Nick), picked by project.
 *
 * Rows are pixels: "." is empty, any other character a palette color.
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
    name: "rocket",
    rest: [
      "...##...",
      "..####..",
      "..#..#..",
      "..####..",
      ".######.",
      ".######.",
      "##....##",
      "..####..",
    ],
    step: [
      "...##...",
      "..####..",
      "..#..#..",
      "..####..",
      ".######.",
      ".######.",
      "##....##",
      "...##...",
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

/** Claude Code's mascot, Clawd: arms flap and legs trot as it walks. */
const CLAWD_TOP = ["...oooooooooooo...", "...oooooooooooo...", "...ooeooooooeoo..."];
const CLAWD_ARMS_DOWN = [
  "...ooeooooooeoo...",
  ".oooooooooooooooo.",
  ".oooooooooooooooo.",
  "...oooooooooooo...",
];
const CLAWD_ARMS_UP = [
  ".ooooeooooooeoooo.",
  ".oooooooooooooooo.",
  "...oooooooooooo...",
  "...oooooooooooo...",
];
const CLAWD_BELLY = "...dddddddddddd...";
const CLAWD_LEGS = "....d.d....d.d....";

/** A terminal on legs; its prompt's cursor blinks. */
const TERMINAL_HEAD = [
  "..gggggggggg..",
  ".gwwwwwwwwwwg.",
  ".gwkkkkkkkkwg.",
  ".gwkcckkkkkwg.",
  ".gwkkcckkkkwg.",
  ".gwkcckccckwg.",
  ".gwkkkkkkkkwg.",
  ".gwwwwwwwwwwg.",
  "..gggggggggg..",
];

/** A pointer arrow with eyes; its tail sways as it walks. */
const ARROW_BODY = [
  "b.........",
  "bb........",
  "bwb.......",
  "bwwb......",
  "bwwwb.....",
  "bwwwwb....",
  "bwbwbwb...",
  "bwwwwwwb..",
  "bwwwbbbbb.",
  "bwbbwb....",
];

/** Antigravity's arch, hovering over a trail of sparks. */
const ARCH_BODY = [
  ".....rr.....",
  "....rrrr....",
  "....oooo....",
  "...oeooeo...",
  "...yy..yy...",
  "..yyy..yyy..",
  "..gg....gg..",
  ".ggg....ggg.",
  ".bb......bb.",
  "bbb......bbb",
];

interface MascotSpec {
  readonly name: string;
  readonly palette: Readonly<Record<string, string>>;
  /** Four walk frames, played in order. */
  readonly frames: readonly [Rows, Rows, Rows, Rows];
  /** Drawn over every frame now and then: eyes closing, or a cursor going dark. */
  readonly blink?: { readonly kind: "eyes" | "cursor"; readonly rows: Rows };
  readonly motion: "walk" | "float";
}

export const PROVIDER_MASCOTS: Readonly<Record<string, MascotSpec>> = {
  claudeAgent: {
    name: "clawd",
    palette: { o: "#d97757", d: "#b85c3e", e: "#1a1210" },
    frames: [
      [...CLAWD_TOP, ...CLAWD_ARMS_DOWN, CLAWD_BELLY, CLAWD_LEGS, "....d......d......"],
      [...CLAWD_TOP, ...CLAWD_ARMS_UP, CLAWD_BELLY, CLAWD_LEGS, CLAWD_LEGS],
      [...CLAWD_TOP, ...CLAWD_ARMS_DOWN, CLAWD_BELLY, CLAWD_LEGS, "......d......d...."],
      [...CLAWD_TOP, ...CLAWD_ARMS_UP, CLAWD_BELLY, CLAWD_LEGS, CLAWD_LEGS],
    ],
    blink: {
      kind: "eyes",
      rows: ["..................", "..................", ".....o......o....."],
    },
    motion: "walk",
  },
  codex: {
    name: "terminal",
    palette: { g: "#8e8e93", w: "#ececf1", k: "#111111", c: "#ffffff", f: "#8e8e93" },
    frames: [
      [...TERMINAL_HEAD, "....f....f....", "....f....f....", "....ff...ff..."],
      [...TERMINAL_HEAD, "....f....f....", "....ff...f....", ".........ff..."],
      [...TERMINAL_HEAD, "....f....f....", "....f....f....", "....ff...ff..."],
      [...TERMINAL_HEAD, "....f....f....", "....f....ff...", "....ff........"],
    ],
    blink: {
      kind: "cursor",
      rows: [
        "..............",
        "..............",
        "..............",
        "..............",
        "..............",
        ".......kkk....",
      ],
    },
    motion: "walk",
  },
  cursor: {
    name: "arrow",
    palette: { b: "#0b0b0b", w: "#ffffff" },
    frames: [
      [...ARROW_BODY, "bb..bwb...", "b....bb..."],
      [...ARROW_BODY, "bb...bwb..", "b.....bb.."],
      [...ARROW_BODY, "bb..bwb...", "b....bb..."],
      [...ARROW_BODY, "bb.bwb....", "b...bb...."],
    ],
    blink: {
      kind: "eyes",
      rows: [
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..w.w.....",
      ],
    },
    motion: "walk",
  },
  antigravity: {
    name: "arch",
    palette: {
      r: "#ea4335",
      o: "#f6a03a",
      y: "#fbbc04",
      g: "#34a853",
      b: "#4285f4",
      e: "#1a1a1a",
      s: "#8ab4f8",
    },
    frames: [
      [...ARCH_BODY, "..s......s..", "............"],
      [...ARCH_BODY, "............", ".s........s."],
      [...ARCH_BODY, "...s....s...", "............"],
      [...ARCH_BODY, "............", "..s......s.."],
    ],
    blink: {
      kind: "eyes",
      rows: ["............", "............", "............", "....o..o...."],
    },
    motion: "float",
  },
};

/** SVG path over the sprite's viewBox; each row's run of `pixel` becomes one rect. */
export function spritePath(rows: Rows, pixel = "#"): string {
  let path = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== pixel) {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === pixel) run += 1;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return path;
}

export interface RunnerLayer {
  readonly color: string;
  readonly path: string;
}

export interface RunnerSprite {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Four walk frames, each one path per color. */
  readonly frames: readonly (readonly RunnerLayer[])[];
  readonly blink: {
    readonly kind: "eyes" | "cursor";
    readonly layers: readonly RunnerLayer[];
  } | null;
  readonly motion: "walk" | "float";
}

function layers(rows: Rows, palette: Readonly<Record<string, string>>): RunnerLayer[] {
  return Object.entries(palette)
    .map(([pixel, color]) => ({ color, path: spritePath(rows, pixel) }))
    .filter((layer) => layer.path.length > 0);
}

function buildRunnerSprite(spec: MascotSpec): RunnerSprite {
  return {
    name: spec.name,
    width: spec.frames[0][0]!.length,
    height: spec.frames[0].length,
    frames: spec.frames.map((rows) => layers(rows, spec.palette)),
    blink: spec.blink
      ? { kind: spec.blink.kind, layers: layers(spec.blink.rows, spec.palette) }
      : null,
    motion: spec.motion,
  };
}

const PROVIDER_SPRITES = new Map(
  Object.entries(PROVIDER_MASCOTS).map(([driver, spec]) => [driver, buildRunnerSprite(spec)]),
);

const PROJECT_SPRITES: readonly RunnerSprite[] = SPRITES.map((sprite) =>
  buildRunnerSprite({
    name: sprite.name,
    palette: { "#": "currentColor" },
    frames: [sprite.rest, sprite.step, sprite.rest, sprite.step],
    motion: "walk",
  }),
);

/**
 * The provider's own mascot, or else one of Monocode's: the same project
 * always gets the same one, by Monocode's list order and hash.
 */
export function runnerSprite(driver: string, seed: string): RunnerSprite {
  const own = PROVIDER_SPRITES.get(driver);
  if (own) return own;
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 131 + seed.charCodeAt(index)) >>> 0;
  }
  return PROJECT_SPRITES[hash % PROJECT_SPRITES.length]!;
}
