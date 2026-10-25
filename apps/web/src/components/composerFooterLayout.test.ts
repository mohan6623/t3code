import { describe, expect, it } from "vite-plus/test";

import {
  CONTEXT_STRIP_FOLD_STEPS,
  CONTEXT_STRIP_PART_LEVELS,
  DOCK_FOLD_ORDER,
  contextStripFoldAttributes,
  contextStripFoldStepLevel,
  contextStripFoldUsesCollapsedControls,
  resolveContextStripFoldLevel,
  resolveContextStripLabelsCompact,
} from "./BranchToolbar.logic";
import {
  resolveComposerTimelineInset,
  resolveRestingComposerControlsCollapsedWidth,
  resolveRestingComposerControlsLayout,
  resolveRestingComposerControlsMinimumWidth,
  resolveRestingComposerControlsNaturalWidth,
} from "./composerFooterLayout";

describe("resolveComposerTimelineInset", () => {
  it("keeps timeline padding stable when the model-only strip appears on collapse", () => {
    const expanded = resolveComposerTimelineInset({
      currentInset: 0,
      overlayHeight: 172,
      isResting: false,
    });
    const collapsed = resolveComposerTimelineInset({
      currentInset: expanded,
      overlayHeight: 110,
      isResting: true,
      restingOnlyHeight: 32,
    });
    expect(collapsed).toBe(expanded);
    expect(
      resolveComposerTimelineInset({
        currentInset: collapsed,
        overlayHeight: 172,
        isResting: false,
      }),
    ).toBe(expanded);
  });

  it("keeps the timeline reservation stable through notice expansion and collapse", () => {
    const collapsed = resolveComposerTimelineInset({
      currentInset: 0,
      overlayHeight: 172,
      isResting: false,
    });
    const expanded = resolveComposerTimelineInset({
      currentInset: collapsed,
      overlayHeight: 532,
      isResting: false,
      expandedNoticesHeight: 360,
    });
    expect(expanded).toBe(collapsed);
    const resting = resolveComposerTimelineInset({
      currentInset: expanded,
      overlayHeight: 470,
      isResting: true,
      expandedNoticesHeight: 360,
    });
    expect(resting).toBe(collapsed);
    expect(
      resolveComposerTimelineInset({
        currentInset: resting,
        overlayHeight: 110,
        isResting: true,
      }),
    ).toBe(collapsed);
  });
});

describe("resolveRestingComposerControlsLayout", () => {
  const base = {
    gap: 4,
    naturalFixedWidth: 149,
    minimumFixedWidth: 105,
    blockWidths: [60, 140],
    overflowWidth: 24,
  };

  it("never hides the cluster below the picker's minimum readable width", () => {
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 132 })).toEqual({
      hiddenCount: 2,
    });
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 0 })).toEqual({
      hiddenCount: 2,
    });
  });

  it("reserves the truncated model name and the overflow menu as the minimum width", () => {
    expect(resolveRestingComposerControlsMinimumWidth(base)).toBe(133);
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 0 })).toEqual({
      hiddenCount: 2,
    });
  });

  it("measures the collapsed controls with the whole model name", () => {
    expect(resolveRestingComposerControlsCollapsedWidth(base)).toBe(177);
  });
});
describe("context strip labels and resting composer controls", () => {
  const stripWidth = 724;
  const labelWidth = 327;
  const chromeWidth = 125;
  const measurement = {
    gap: 4,
    naturalFixedWidth: 96.3828125 + 5 + 4,
    minimumFixedWidth: 52 + 5 + 4,
    blockWidths: [130.6953125, 119.671875],
    overflowWidth: 28,
  };
  const naturalWidth = resolveRestingComposerControlsNaturalWidth(measurement);

  function hostWidth(compact: boolean): number {
    return stripWidth - chromeWidth - (compact ? 0 : labelWidth);
  }

  it("keeps the labels compact when the full controls only fit beside compact labels", () => {
    const layout = resolveRestingComposerControlsLayout({
      ...measurement,
      hostWidth: hostWidth(true),
    });
    expect(layout).toEqual({ hiddenCount: 0 });

    const compact = resolveContextStripLabelsCompact({
      compact: true,
      neededWidth: chromeWidth + labelWidth + naturalWidth,
      availableWidth: stripWidth,
    });
    expect(compact).toBe(true);

    expect(
      resolveRestingComposerControlsLayout({ ...measurement, hostWidth: hostWidth(compact) }),
    ).toEqual(layout);
  });
});

describe("resolveRestingComposerControlsLayout hysteresis", () => {
  const base = {
    gap: 4,
    naturalFixedWidth: 149,
    minimumFixedWidth: 105,
    blockWidths: [60, 140],
    overflowWidth: 24,
  };

  it("settles when the measured picker width jitters below a pixel", () => {
    let layout: { hiddenCount: number } = { hiddenCount: 0 };
    const settled: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      layout = resolveRestingComposerControlsLayout({
        ...base,
        naturalFixedWidth: index % 2 === 0 ? 149 : 149.5,
        hostWidth: 357,
        previous: layout,
      });
      if (index >= 2) settled.push(`${layout.hiddenCount}`);
    }
    expect(new Set(settled).size).toBe(1);
  });
});

describe("progressive composer controls", () => {
  const measurement = {
    gap: 4,
    naturalFixedWidth: 140,
    minimumFixedWidth: 80,
    blockWidths: [80, 140],
    iconOnlyBlockWidths: [40, 60],
    overflowWidth: 24,
  };

  it("settles through fractional label-width changes at each threshold", () => {
    for (const hostWidth of [368, 288, 248]) {
      let previous = resolveRestingComposerControlsLayout({ ...measurement, hostWidth });
      for (let index = 0; index < 10; index += 1) {
        const next = resolveRestingComposerControlsLayout({
          ...measurement,
          hostWidth,
          previous,
          naturalFixedWidth: 140 + (index % 2) * 0.5,
        });
        if (index > 1) expect(next).toEqual(previous);
        previous = next;
      }
    }
  });
});

describe("dock priority order", () => {
  it("folds the context labels, then the controls, the timer, the figures, the name", () => {
    expect(DOCK_FOLD_ORDER).toEqual([
      "context-labels",
      "composer-controls",
      "cache-timer",
      "usage-figures",
      "model-name",
    ]);
    expect(CONTEXT_STRIP_FOLD_STEPS).toEqual(["context-labels", "cache-timer", "usage-figures"]);
  });

  it("sets each fold attribute from its step's level on", () => {
    const attributes = [0, 1, 2, 3].map((level) =>
      Object.entries(contextStripFoldAttributes(level as 0 | 1 | 2 | 3))
        .filter(([, value]) => value !== undefined)
        .map(([name]) => name),
    );
    expect(attributes).toEqual([
      [],
      ["data-compact"],
      ["data-compact", "data-fold-timer"],
      ["data-compact", "data-fold-timer", "data-fold-figures"],
    ]);
  });

  it("lets the composer controls fold before the timer and after the context labels", () => {
    expect(contextStripFoldUsesCollapsedControls(0)).toBe(false);
    expect(contextStripFoldUsesCollapsedControls(contextStripFoldStepLevel("context-labels"))).toBe(
      true,
    );
    expect(contextStripFoldUsesCollapsedControls(contextStripFoldStepLevel("usage-figures"))).toBe(
      false,
    );
  });

  it("shows every badge part on the levels between its steps", () => {
    expect(CONTEXT_STRIP_PART_LEVELS).toEqual({
      label: [0, 0],
      timer: [0, 1],
      figures: [0, 2],
    });
  });
});

describe("resolveContextStripFoldLevel", () => {
  const neededWidths = [600, 500, 420] as const;

  it("folds in order as the strip narrows", () => {
    for (const [availableWidth, level] of [
      [600, 0],
      [599, 1],
      [500, 1],
      [499, 2],
      [420, 2],
      [419, 3],
      [0, 3],
    ] as const) {
      expect(resolveContextStripFoldLevel({ level: 0, neededWidths, availableWidth })).toBe(level);
    }
  });

  it("needs slack before it unfolds a level", () => {
    expect(resolveContextStripFoldLevel({ level: 3, neededWidths, availableWidth: 435 })).toBe(3);
    expect(resolveContextStripFoldLevel({ level: 3, neededWidths, availableWidth: 436 })).toBe(2);
    expect(resolveContextStripFoldLevel({ level: 2, neededWidths, availableWidth: 515 })).toBe(2);
    expect(resolveContextStripFoldLevel({ level: 2, neededWidths, availableWidth: 516 })).toBe(1);
  });

  it("does not flip between levels within a few pixels of a threshold", () => {
    let level = resolveContextStripFoldLevel({ level: 0, neededWidths, availableWidth: 416 });
    for (const availableWidth of [416, 420, 424, 420, 416, 424]) {
      level = resolveContextStripFoldLevel({ level, neededWidths, availableWidth });
      expect(level).toBe(3);
    }
  });
});
