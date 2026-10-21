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
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  COMPOSER_RESTING_EXPANSION_MIN_PX,
  getRestingComposerImagePreviewCounts,
  overlayComposerIsResting,
  resolveComposerTimelineInset,
  resolveScrollToEndClearance,
  resolveRestingComposerControlsCollapsedWidth,
  resolveRestingComposerControlsLayout,
  resolveRestingComposerControlsMinimumWidth,
  resolveRestingComposerControlsNaturalWidth,
  shouldAnimateComposerRestingTransition,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
  shouldUseRestingComposerLayout,
} from "./composerFooterLayout";

describe("getRestingComposerImagePreviewCounts", () => {
  it("shows at most three thumbnails and counts the remainder", () => {
    expect(getRestingComposerImagePreviewCounts(0)).toEqual({
      visibleCount: 0,
      overflowCount: 0,
    });
    expect(getRestingComposerImagePreviewCounts(3)).toEqual({
      visibleCount: 3,
      overflowCount: 0,
    });
    expect(getRestingComposerImagePreviewCounts(7)).toEqual({
      visibleCount: 3,
      overflowCount: 4,
    });
  });
});

describe("shouldUseCompactComposerFooter", () => {
  it("stays expanded without a measured width", () => {
    expect(shouldUseCompactComposerFooter(null)).toBe(false);
  });

  it("switches to compact mode below the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("stays expanded at and above the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX)).toBe(false);
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48)).toBe(false);
  });

  it("uses a higher breakpoint for wide action states", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("shouldUseCompactComposerPrimaryActions", () => {
  it("matches the wide footer breakpoint", () => {
    expect(
      shouldUseCompactComposerPrimaryActions(
        COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1,
        { hasWideActions: true },
      ),
    ).toBe(true);
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("overlayComposerIsResting", () => {
  it("drops a resting reservation once a status bar replaces the composer", () => {
    const isResting = overlayComposerIsResting({
      composerMounted: false,
      composerReportedResting: true,
    });
    expect(isResting).toBe(false);
    expect(resolveComposerTimelineInset({ currentInset: 0, overlayHeight: 56, isResting })).toBe(
      56,
    );
    expect(overlayComposerIsResting({ composerMounted: true, composerReportedResting: true })).toBe(
      true,
    );
  });
});

describe("resolveComposerTimelineInset", () => {
  it("follows the expanded overlay height", () => {
    expect(
      resolveComposerTimelineInset({ currentInset: 160, overlayHeight: 140, isResting: false }),
    ).toBe(140);
  });

  it("keeps a larger expanded reservation while resting", () => {
    expect(
      resolveComposerTimelineInset({ currentInset: 200, overlayHeight: 60, isResting: true }),
    ).toBe(200);
  });

  it("uses the measured expanded height while the resting strip host is mounting", () => {
    expect(
      resolveComposerTimelineInset({ currentInset: 172, overlayHeight: 110, isResting: true }),
    ).toBe(172);
  });

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

  it("reserves the empty expansion when no larger height is known", () => {
    expect(
      resolveComposerTimelineInset({ currentInset: 0, overlayHeight: 60, isResting: true }),
    ).toBe(60 + COMPOSER_RESTING_EXPANSION_MIN_PX);
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

describe("shouldUseRestingComposerLayout", () => {
  const resting = {
    isExistingThread: true,
    isMobileViewport: false,
    isScrollCollapsed: true,
    hasExpandedChrome: false,
    hasMultilinePrompt: false,
    timelineOverflows: true,
  };

  it("uses the resting layout after a timeline scroll", () => {
    expect(shouldUseRestingComposerLayout(resting)).toBe(true);
  });

  it("keeps the composer expanded until the timeline is scrolled", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, isScrollCollapsed: false })).toBe(false);
  });

  it("keeps the composer expanded while the timeline fits above it", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, timelineOverflows: false })).toBe(false);
  });

  it("keeps new-thread composers expanded", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, isExistingThread: false })).toBe(false);
  });

  it("leaves responsive mobile on its existing collapse path", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, isMobileViewport: true })).toBe(false);
  });

  it("keeps drawers and composer-owned menus expanded", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, hasExpandedChrome: true })).toBe(false);
  });

  it.each([false, true])(
    "keeps multiline drafts expanded when scroll collapsed is %s",
    (isScrollCollapsed) => {
      expect(
        shouldUseRestingComposerLayout({
          ...resting,
          hasMultilinePrompt: true,
          isScrollCollapsed,
        }),
      ).toBe(false);
    },
  );
});

describe("shouldAnimateComposerRestingTransition", () => {
  it("does not animate layout measurements that settle during initial mount", () => {
    expect(
      shouldAnimateComposerRestingTransition({
        hasCompletedInitialLayout: false,
        stateChanged: true,
        hasInterruptedAnimation: false,
      }),
    ).toBe(false);
  });

  it("animates later resting-state changes and interrupted transitions", () => {
    expect(
      shouldAnimateComposerRestingTransition({
        hasCompletedInitialLayout: true,
        stateChanged: true,
        hasInterruptedAnimation: false,
      }),
    ).toBe(true);
    expect(
      shouldAnimateComposerRestingTransition({
        hasCompletedInitialLayout: true,
        stateChanged: false,
        hasInterruptedAnimation: true,
      }),
    ).toBe(true);
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

  it("shows everything when the host has room", () => {
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 357 })).toEqual({
      hiddenCount: 0,
    });
  });

  it("moves trailing blocks into the overflow menu until the rest fits", () => {
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 356 })).toEqual({
      hiddenCount: 1,
    });
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 241 })).toEqual({
      hiddenCount: 1,
    });
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 240 })).toEqual({
      hiddenCount: 2,
    });
  });

  it("shrinks the picker after moving every trailing block into overflow", () => {
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 176 })).toEqual({
      hiddenCount: 2,
    });
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 133 })).toEqual({
      hiddenCount: 2,
    });
  });

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

  it("uses the same thresholds while shrinking and growing", () => {
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 240 })).toEqual({
      hiddenCount: 2,
    });
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 241 })).toEqual({
      hiddenCount: 1,
    });
  });

  it("supports a single leading control without overflow blocks", () => {
    const single = {
      ...base,
      naturalFixedWidth: 140,
      minimumFixedWidth: 140,
      blockWidths: [],
      overflowWidth: 0,
    };
    expect(resolveRestingComposerControlsLayout({ ...single, hostWidth: 139 })).toEqual({
      hiddenCount: 0,
    });
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

  it("does not settle when the strip only reserves the visible controls", () => {
    const hiddenControlsWidth = 137;
    const expands = !resolveContextStripLabelsCompact({
      compact: true,
      neededWidth: chromeWidth + labelWidth + hiddenControlsWidth,
      availableWidth: stripWidth,
    });
    expect(expands).toBe(true);
    expect(
      resolveRestingComposerControlsLayout({ ...measurement, hostWidth: hostWidth(false) }),
    ).toEqual({ hiddenCount: 2 });
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

  it("keeps a block in overflow when re-showing it would leave no slack", () => {
    expect(
      resolveRestingComposerControlsLayout({
        ...base,
        hostWidth: 357,
        previous: { hiddenCount: 1 },
      }),
    ).toEqual({ hiddenCount: 1 });
  });

  it("re-shows a block once the host clears the slack margin", () => {
    expect(
      resolveRestingComposerControlsLayout({
        ...base,
        hostWidth: 358,
        previous: { hiddenCount: 1 },
      }),
    ).toEqual({ hiddenCount: 0 });
  });

  it("restores the blocks that fit when the full cluster has no slack", () => {
    const partlyRestored = resolveRestingComposerControlsLayout({
      ...base,
      hostWidth: 357,
      previous: { hiddenCount: 2 },
    });
    expect(partlyRestored).toEqual({ hiddenCount: 1 });
    expect(
      resolveRestingComposerControlsLayout({ ...base, hostWidth: 357, previous: partlyRestored }),
    ).toEqual(partlyRestored);
    expect(
      resolveRestingComposerControlsLayout({ ...base, hostWidth: 358, previous: partlyRestored }),
    ).toEqual({ hiddenCount: 0 });
  });

  it("requires slack before partially restoring a cluster", () => {
    const previous = { hiddenCount: 2 };
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 241, previous })).toEqual(
      previous,
    );
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 242, previous })).toEqual({
      hiddenCount: 1,
    });
  });

  it("still resolves from scratch when there is no previous layout", () => {
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 357 })).toEqual({
      hiddenCount: 0,
    });
  });

  it("settles when the measured picker width jitters below a pixel", () => {
    // The composer re-measures on every render, so the picker's recovered
    // natural width can land a fraction of a pixel apart between renders.
    // Without hysteresis that flips hiddenCount forever.
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

describe("resolveScrollToEndClearance", () => {
  it("removes the side tab gap in both composer states while clearing overlapping attachments", () => {
    for (const overlayHeight of [120, 214]) {
      const layout = {
        overlayHeight,
        mainSurfaceTop: 534,
        button: { left: 340, right: 460 },
        attachments: [{ top: 500, left: 600, right: 700 }],
      };
      expect(resolveScrollToEndClearance(layout)).toBe(overlayHeight - 34);
      expect(resolveScrollToEndClearance({ ...layout, attachments: [] })).toBe(overlayHeight);
      expect(
        resolveScrollToEndClearance({
          ...layout,
          attachments: [...layout.attachments, { top: 500, left: 100, right: 700 }],
        }),
      ).toBe(overlayHeight);
      expect(resolveScrollToEndClearance({ ...layout, button: { left: 590, right: 710 } })).toBe(
        overlayHeight,
      );
    }
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

  it("keeps labels while they fit and removes trailing labels before controls", () => {
    for (const [hostWidth, iconOnlyCount, hiddenCount] of [
      [368, 0, 0],
      [367, 1, 0],
      [288, 1, 0],
      [287, 2, 0],
      [248, 2, 0],
      [247, 2, 1],
      [211, 2, 2],
    ] as const) {
      expect(resolveRestingComposerControlsLayout({ ...measurement, hostWidth })).toEqual({
        hiddenCount,
        iconOnlyCount,
      });
    }
  });

  it("requires slack to restore labels and controls", () => {
    for (const [hostWidth, previous, promoted] of [
      [368, { hiddenCount: 0, iconOnlyCount: 1 }, { hiddenCount: 0, iconOnlyCount: 0 }],
      [288, { hiddenCount: 0, iconOnlyCount: 2 }, { hiddenCount: 0, iconOnlyCount: 1 }],
      [248, { hiddenCount: 1, iconOnlyCount: 2 }, { hiddenCount: 0, iconOnlyCount: 2 }],
    ] as const) {
      expect(resolveRestingComposerControlsLayout({ ...measurement, hostWidth, previous })).toEqual(
        previous,
      );
      expect(
        resolveRestingComposerControlsLayout({
          ...measurement,
          hostWidth: hostWidth + 1,
          previous,
        }),
      ).toEqual(promoted);
    }
  });

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
  it("folds the context labels, then the controls, the timer, the rows, the figures, the name", () => {
    expect(DOCK_FOLD_ORDER).toEqual([
      "context-labels",
      "composer-controls",
      "cache-timer",
      "usage-rows",
      "usage-figures",
      "model-name",
    ]);
    expect(CONTEXT_STRIP_FOLD_STEPS).toEqual([
      "context-labels",
      "cache-timer",
      "usage-rows",
      "usage-figures",
    ]);
  });

  it("sets each fold attribute from its step's level on", () => {
    const attributes = [0, 1, 2, 3, 4].map((level) =>
      Object.entries(contextStripFoldAttributes(level as 0 | 1 | 2 | 3 | 4))
        .filter(([, value]) => value !== undefined)
        .map(([name]) => name),
    );
    expect(attributes).toEqual([
      [],
      ["data-compact"],
      ["data-compact", "data-fold-timer"],
      ["data-compact", "data-fold-timer", "data-usage-rows", "data-usage-row-figures"],
      ["data-compact", "data-fold-timer", "data-usage-rows", "data-fold-figures"],
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
      line: [0, 2],
      rows: [3, 3],
      figures: [0, 3],
    });
  });
});

describe("resolveContextStripFoldLevel", () => {
  const neededWidths = [600, 500, 420, 300] as const;

  it("folds in order as the strip narrows", () => {
    for (const [availableWidth, level] of [
      [600, 0],
      [599, 1],
      [500, 1],
      [499, 2],
      [420, 2],
      [419, 3],
      [300, 3],
      [299, 4],
      [0, 4],
    ] as const) {
      expect(resolveContextStripFoldLevel({ level: 0, neededWidths, availableWidth })).toBe(level);
    }
  });

  it("needs slack before it unfolds a level", () => {
    expect(resolveContextStripFoldLevel({ level: 4, neededWidths, availableWidth: 315 })).toBe(4);
    expect(resolveContextStripFoldLevel({ level: 4, neededWidths, availableWidth: 316 })).toBe(3);
    expect(resolveContextStripFoldLevel({ level: 3, neededWidths, availableWidth: 435 })).toBe(3);
    expect(resolveContextStripFoldLevel({ level: 3, neededWidths, availableWidth: 436 })).toBe(2);
  });

  it("does not flip between levels within a few pixels of a threshold", () => {
    let level = resolveContextStripFoldLevel({ level: 0, neededWidths, availableWidth: 296 });
    for (const availableWidth of [296, 300, 304, 300, 296, 304]) {
      level = resolveContextStripFoldLevel({ level, neededWidths, availableWidth });
      expect(level).toBe(4);
    }
  });
});
