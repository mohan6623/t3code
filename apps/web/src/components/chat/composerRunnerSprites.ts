/**
 * Fork: pixel mascots for the composer runner. Each provider with a mascot
 * gets its own; any other provider walks one of Monocode's 8x8 mascots
 * (https://github.com/hardbeat920/monocode, src/features/projects/model/projectMascots.ts,
 * MIT License, Copyright (c) 2026 Nick), picked by project. The
 * `composerMascots` setting can give any provider any mascot.
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

/** Codex's blue cloud bot: a visor with happy eyes, `>_` on its chest, arms up. */
const CODEX_BOT_BODY = [
  "...oo.oo.oo...",
  "..ollollollo..",
  ".ollbbbbbbllo.",
  "obbvvvvvvvvbbo",
  "obvvevvvvevvbo",
  "obvevevvevevbo",
  "obbvvvvvvvvbbo",
  ".obbbbbbbbbbo.",
  "..oooooooooo..",
  "..b.ovlllo.b..",
  "...bolvllob...",
  "....ovlvvo....",
  "....oooooo....",
];

/**
 * Cursor's logo, a hexagon with its arrow cut out, on arms and legs. The
 * hexagon is the logo's path sampled on this grid, then made symmetric.
 */
const CURSOR_CUBE_BODY = [
  ".......kk.......",
  ".....kkkkkk.....",
  "...kkkkkkkkkk...",
  "..kkkkkkkkkkkk..",
  "..kffffffffffk..",
  "..kkkkffffffkk..",
  "..kkkkkfffffkk..",
  "..kkkkkkfffkkk..",
  "..kkkwkkfffkwk..",
  "..kkkwkkffkkwk..",
  "..kkkkkkffkkkk..",
  "...kkkkkfkkkk...",
  ".....kkkkkk.....",
  ".....a.kk.a.....",
];

/** Rows with single pixels replaced: `[row, column, pixel]`. */
function paint(rows: Rows, pixels: ReadonlyArray<readonly [number, number, string]>): Rows {
  const next = [...rows];
  for (const [row, column, pixel] of pixels) {
    const line = next[row]!;
    next[row] = line.slice(0, column) + pixel + line.slice(column + 1);
  }
  return next;
}

const CUBE_ARMS_DOWN = [
  [7, 1, "a"],
  [8, 0, "a"],
  [7, 14, "a"],
  [8, 15, "a"],
] as const;
const CUBE_LEFT_ARM_UP = [
  [7, 1, "a"],
  [6, 0, "a"],
  [7, 14, "a"],
  [8, 15, "a"],
] as const;
const CUBE_RIGHT_ARM_UP = [
  [7, 1, "a"],
  [8, 0, "a"],
  [7, 14, "a"],
  [6, 15, "a"],
] as const;

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

/** Monocode's project colors (its PROJECT_COLORS), one per mascot here. */
const MONOCODE_COLORS: Readonly<Record<string, string>> = {
  invader: "hsl(142 55% 50%)",
  ghost: "hsl(330 70% 62%)",
  robot: "hsl(210 8% 58%)",
  cat: "hsl(45 90% 55%)",
  skull: "hsl(280 55% 62%)",
  crab: "hsl(25 85% 58%)",
  mushroom: "hsl(12 80% 58%)",
  rocket: "hsl(211 92% 62%)",
  dino: "hsl(175 55% 48%)",
  frog: "hsl(142 55% 50%)",
};

interface MascotSpec {
  readonly label: string;
  readonly palette: Readonly<Record<string, string>>;
  /** Four walk frames, played in order. */
  readonly frames: readonly [Rows, Rows, Rows, Rows];
  /** Drawn over every frame now and then: eyes closing, or a cursor going dark. */
  readonly blink?: { readonly kind: "eyes" | "cursor"; readonly rows: Rows };
  readonly motion: "walk" | "float";
}

export const MASCOTS: Readonly<Record<string, MascotSpec>> = {
  clawd: {
    label: "Clawd",
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
  "codex-bot": {
    label: "Codex bot",
    palette: {
      o: "#1f3fae",
      b: "#4a73f5",
      l: "#8eaeff",
      v: "#0b1433",
      e: "#7ee8ff",
    },
    frames: [
      [...CODEX_BOT_BODY, "....o....o....", "...oo....oo..."],
      [...CODEX_BOT_BODY, ".....o..o.....", "........oo...."],
      [...CODEX_BOT_BODY, "....o....o....", "...oo....oo..."],
      [...CODEX_BOT_BODY, ".....o..o.....", ".....oo......."],
    ],
    blink: {
      kind: "eyes",
      rows: [
        "..............",
        "..............",
        "..............",
        "..............",
        "....v....v....",
        "...eee..eee...",
      ],
    },
    motion: "walk",
  },
  "cursor-cube": {
    label: "Cursor cube",
    palette: { k: "#3f3e38", f: "#e9e8e3", w: "#ffffff", a: "#8f8d85" },
    frames: [
      [...paint(CURSOR_CUBE_BODY, CUBE_ARMS_DOWN), "....aa....aa...."],
      [...paint(CURSOR_CUBE_BODY, CUBE_LEFT_ARM_UP), "..........aa...."],
      [...paint(CURSOR_CUBE_BODY, CUBE_ARMS_DOWN), "....aa....aa...."],
      [...paint(CURSOR_CUBE_BODY, CUBE_RIGHT_ARM_UP), "....aa.........."],
    ],
    blink: {
      kind: "eyes",
      rows: [
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        ".....k......k...",
      ],
    },
    motion: "walk",
  },
  arch: {
    label: "Antigravity arch",
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
  terminal: {
    label: "Terminal",
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
  ...Object.fromEntries(
    SPRITES.map((sprite) => [
      sprite.name,
      {
        label: sprite.name[0]!.toUpperCase() + sprite.name.slice(1),
        palette: { "#": MONOCODE_COLORS[sprite.name]! },
        frames: [sprite.rest, sprite.step, sprite.rest, sprite.step],
        motion: "walk",
      } satisfies MascotSpec,
    ]),
  ),
};

/** Each provider's own mascot; other providers get the project's pick. */
const PROVIDER_MASCOTS: Readonly<Record<string, string>> = {
  claudeAgent: "clawd",
  codex: "codex-bot",
  cursor: "cursor-cube",
  antigravity: "arch",
};

/**
 * A provider's mascot setting: a mascot id, `"project"` for Monocode's pick
 * by project, or `"off"`. Unset, or a mascot that no longer exists, means the
 * provider's own mascot.
 */
export const PROJECT_MASCOT_CHOICE = "project";
export const NO_MASCOT_CHOICE = "off";

export function defaultMascotId(driver: string): string | null {
  return PROVIDER_MASCOTS[driver] ?? null;
}

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
  readonly id: string;
  readonly label: string;
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

/** Every mascot, built once, in the order the settings list them. */
export const RUNNER_SPRITES: ReadonlyMap<string, RunnerSprite> = new Map(
  Object.entries(MASCOTS).map(([id, spec]) => [
    id,
    {
      id,
      label: spec.label,
      width: spec.frames[0][0]!.length,
      height: spec.frames[0].length,
      frames: spec.frames.map((rows) => layers(rows, spec.palette)),
      blink: spec.blink
        ? { kind: spec.blink.kind, layers: layers(spec.blink.rows, spec.palette) }
        : null,
      motion: spec.motion,
    },
  ]),
);

/** Monocode's pick: the same project always gets the same mascot, by its list order and hash. */
export function projectMascotId(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 131 + seed.charCodeAt(index)) >>> 0;
  }
  return SPRITES[hash % SPRITES.length]!.name;
}

/** The mascot for this provider and project under the user's choice, or null for none. */
export function runnerSprite(
  driver: string,
  seed: string,
  choice: string | undefined,
): RunnerSprite | null {
  if (choice === NO_MASCOT_CHOICE) return null;
  const chosen = choice === undefined ? undefined : RUNNER_SPRITES.get(choice);
  if (chosen) return chosen;
  const id =
    choice === PROJECT_MASCOT_CHOICE
      ? projectMascotId(seed)
      : (defaultMascotId(driver) ?? projectMascotId(seed));
  return RUNNER_SPRITES.get(id)!;
}
