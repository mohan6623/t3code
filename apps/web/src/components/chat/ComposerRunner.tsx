import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";

import type { RunnerLayer, RunnerSprite } from "./composerRunnerSprites";

/** One walk step: an eighth of the 520ms frame cycle in index.css, about 15 per second. */
const RUNNER_STEP_MS = 65;
/** Sprite pixels moved per walk step. */
const RUNNER_STEP_PIXELS = 2;
/** Mascots are drawn about this many CSS px per sprite pixel. */
const RUNNER_PIXEL = 2;
/** A resize refits the walk once it has been still this long, so a drag does not jolt it. */
const RUNNER_REFIT_DELAY_MS = 150;
/** Gap between the walk and the composer's rounded corners, in CSS px. */
const RUNNER_INSET = 20;

/**
 * Fork: a pixel mascot walks the composer's top edge while a turn runs, then drops into it.
 * Sprite pixels and walk steps land on whole screen pixels, or edges blur at 125% scale. Motion is
 * stepped CSS transforms about 15 times a second, never every frame, and pauses off screen.
 */
export function ComposerRunner(props: {
  readonly running: boolean;
  readonly sprite: RunnerSprite;
}) {
  const [shown, setShown] = useState(props.running);
  // Show at once when a turn starts; hide only after the exit jump ends.
  if (props.running && !shown) setShown(true);
  const leaving = shown && !props.running;
  const trackRef = useRef<HTMLDivElement>(null);
  const { sprite } = props;
  const { width, height } = sprite;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fits the walk's CSS sizes to the track's DOM box, its resizes and the screen scale
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!shown || !track) return;
    let scaleQuery: MediaQueryList | null = null;
    let refitTimer: ReturnType<typeof setTimeout> | null = null;
    const fit = () => {
      const scale = window.devicePixelRatio || 1;
      const cell = Math.max(1, Math.round(RUNNER_PIXEL * scale));
      const size = (width * cell) / scale;
      const box = track.getBoundingClientRect();
      // Snap the walk's start to a screen pixel.
      const nudgeX = (Math.ceil(box.left * scale) - box.left * scale) / scale;
      const nudgeY = (Math.round(box.bottom * scale) - box.bottom * scale) / scale;
      const step = cell * RUNNER_STEP_PIXELS;
      const steps = Math.max(1, Math.floor(((box.width - nudgeX - size) * scale) / step));
      const style = track.style;
      style.setProperty("--runner-size", `${size}px`);
      style.setProperty("--runner-height", `${(height * cell) / scale}px`);
      style.setProperty("--runner-cell", `${cell / scale}px`);
      style.setProperty("--runner-nudge-x", `${nudgeX}px`);
      style.setProperty("--runner-nudge-y", `${nudgeY}px`);
      style.setProperty("--runner-travel", `${(steps * step) / scale}px`);
      style.setProperty("--runner-steps", String(steps));
      style.setProperty("--runner-hop", `${-Math.max(1, Math.round(cell / 2)) / scale}px`);
      // There and back again, one step per RUNNER_STEP_MS, whatever the width.
      style.setProperty("--runner-lap", `${(2 * steps * RUNNER_STEP_MS) / 1000}s`);
      // A new screen scale (another monitor, or zoom) needs a new fit.
      scaleQuery?.removeEventListener("change", fit);
      scaleQuery = window.matchMedia(`(resolution: ${scale}dppx)`);
      scaleQuery.addEventListener("change", fit);
    };
    fit();
    // A new lap length moves the walker, so refit once a resize settles, not on every frame of it.
    const scheduleRefit = () => {
      if (refitTimer !== null) clearTimeout(refitTimer);
      refitTimer = setTimeout(() => {
        refitTimer = null;
        fit();
      }, RUNNER_REFIT_DELAY_MS);
    };
    const stopObserving = observeResize(track, scheduleRefit);
    const stopAnimating = observeVisibleAnimation(track);
    return () => {
      stopObserving();
      stopAnimating?.();
      if (refitTimer !== null) clearTimeout(refitTimer);
      scaleQuery?.removeEventListener("change", fit);
    };
  }, [shown, width, height]);

  if (!shown) return null;
  return (
    <div
      ref={trackRef}
      aria-hidden
      data-composer-runner={leaving ? "leaving" : "walking"}
      className="t3-runner-track pointer-events-none absolute bottom-full z-10 h-px motion-reduce:hidden"
      style={{ left: RUNNER_INSET, right: RUNNER_INSET }}
    >
      <div className="t3-runner-walk">
        <div
          className="t3-runner-body"
          data-runner-motion={sprite.motion}
          onAnimationEnd={(event) => {
            if (event.animationName === "t3-runner-exit") setShown(false);
          }}
        >
          {sprite.frames.map((frame, index) => (
            <RunnerFrame
              // oxlint-disable-next-line react/no-array-index-key -- a fixed cycle; frames never reorder
              key={index}
              layers={frame}
              width={width}
              height={height}
              className="t3-runner-frame"
              // Frame i shows for the i-th quarter of each cycle.
              style={{ animationDelay: `calc(var(--runner-cycle) * ${-((4 - index) % 4) / 4})` }}
            />
          ))}
          {sprite.blink ? (
            <RunnerFrame
              layers={sprite.blink.layers}
              width={width}
              height={height}
              className={`t3-runner-blink-${sprite.blink.kind}`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** A mascot standing still, for pickers. */
export function MascotPreview(props: { readonly sprite: RunnerSprite }) {
  return (
    <RunnerFrame
      layers={props.sprite.frames[0]!}
      width={props.sprite.width}
      height={props.sprite.height}
      className="h-4 w-5 shrink-0"
    />
  );
}

function RunnerFrame(props: {
  readonly layers: readonly RunnerLayer[];
  readonly width: number;
  readonly height: number;
  readonly className: string;
  readonly style?: CSSProperties;
}) {
  return (
    <svg
      viewBox={`0 0 ${props.width} ${props.height}`}
      shapeRendering="crispEdges"
      className={props.className}
      style={props.style}
    >
      {props.layers.map((layer) => (
        <path key={layer.color} d={layer.path} fill={layer.color} />
      ))}
    </svg>
  );
}
