import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";

import type { RunnerLayer, RunnerSprite } from "./composerRunnerSprites";

/** Walking speed in CSS px per second, as in Monocode. */
const RUNNER_SPEED = 160;
/** Mascots are drawn about this many CSS px per sprite pixel. */
const RUNNER_PIXEL = 2;
/** Gap between the walk and the composer's rounded corners, in CSS px. */
const RUNNER_INSET = 20;

/**
 * Fork: a pixel mascot that walks the composer's top edge while a turn runs,
 * after Monocode's composer runner. When the turn ends it jumps and drops into
 * the composer, then unmounts.
 *
 * Sharp pixels: one sprite pixel covers a whole number of screen pixels (2 at
 * 100% scale, 3 at 125% and 150%), the walk moves one screen pixel per step,
 * and the walk starts on a screen pixel. Otherwise, at 125% scale a sprite
 * pixel is 2.5 screen pixels and every edge blurs.
 *
 * Cost: Monocode moves its runner from JavaScript on every frame. Here every
 * motion is a CSS transform or opacity animation on its own layer, so the
 * compositor runs it with no JavaScript, layout or paint per frame. JavaScript
 * runs only when the composer changes size or the screen scale changes.
 * Nothing renders while no turn runs, a hidden window pauses CSS animations,
 * and reduced motion hides the runner.
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

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!shown || !track) return;
    let scaleQuery: MediaQueryList | null = null;
    const fit = () => {
      const scale = window.devicePixelRatio || 1;
      const cell = Math.max(1, Math.round(RUNNER_PIXEL * scale));
      const size = (width * cell) / scale;
      const box = track.getBoundingClientRect();
      // Snap the walk's start to a screen pixel.
      const nudgeX = (Math.ceil(box.left * scale) - box.left * scale) / scale;
      const nudgeY = (Math.round(box.bottom * scale) - box.bottom * scale) / scale;
      const travel = Math.max(0, Math.floor((box.width - nudgeX - size) * scale));
      const style = track.style;
      style.setProperty("--runner-size", `${size}px`);
      style.setProperty("--runner-height", `${(height * cell) / scale}px`);
      style.setProperty("--runner-cell", `${cell / scale}px`);
      style.setProperty("--runner-nudge-x", `${nudgeX}px`);
      style.setProperty("--runner-nudge-y", `${nudgeY}px`);
      style.setProperty("--runner-travel", `${travel / scale}px`);
      style.setProperty("--runner-steps", String(Math.max(1, travel)));
      style.setProperty("--runner-hop", `${-Math.max(1, Math.round(cell / 2)) / scale}px`);
      // There and back again at a steady speed, whatever the width.
      style.setProperty("--runner-lap", `${Math.max(1, (2 * travel) / scale / RUNNER_SPEED)}s`);
      // A new screen scale (another monitor, or zoom) needs a new fit.
      scaleQuery?.removeEventListener("change", fit);
      scaleQuery = window.matchMedia(`(resolution: ${scale}dppx)`);
      scaleQuery.addEventListener("change", fit);
    };
    fit();
    const stopObserving = observeResize(track, fit);
    return () => {
      stopObserving();
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
