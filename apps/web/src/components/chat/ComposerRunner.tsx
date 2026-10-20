import { useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";

import { runnerSprite } from "./composerRunnerSprites";

/** Walking speed in px per second, as in Monocode. */
const RUNNER_SPEED = 120;
/** The sprite size in px; one sprite pixel is 2px. */
const RUNNER_SIZE = 16;

/**
 * Fork: a pixel mascot that walks the composer's top edge while a turn runs,
 * after Monocode's composer runner. When the turn ends it hops and drops into
 * the composer, then unmounts.
 *
 * Cost: Monocode moves its runner from JavaScript on every frame. Here every
 * motion is a CSS transform or opacity animation on its own layer, so the
 * compositor runs it with no JavaScript, layout or paint per frame. JavaScript
 * runs only when the composer changes width, to set the walk length and time.
 * Nothing renders while no turn runs, a hidden window pauses CSS animations,
 * and reduced motion hides the runner.
 */
export function ComposerRunner(props: { readonly running: boolean; readonly seed: string }) {
  const [shown, setShown] = useState(props.running);
  // Show at once when a turn starts; hide only after the drop animation ends.
  if (props.running && !shown) setShown(true);
  const leaving = shown && !props.running;
  const trackRef = useRef<HTMLDivElement>(null);
  const sprite = runnerSprite(props.seed);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!shown || !track) return;
    const update = (width: number) => {
      const travel = Math.max(0, Math.round(width - RUNNER_SIZE));
      track.style.setProperty("--runner-travel", `${travel}px`);
      // There and back again at a steady speed, whatever the width.
      track.style.setProperty(
        "--runner-lap",
        `${Math.max(2, (travel * 2) / RUNNER_SPEED).toFixed(2)}s`,
      );
    };
    update(track.clientWidth);
    return observeResize(track, (entries) => {
      const width = entries.at(-1)?.contentRect.width;
      if (width !== undefined) update(width);
    });
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      ref={trackRef}
      aria-hidden
      data-composer-runner={leaving ? "leaving" : "walking"}
      className="pointer-events-none absolute inset-x-6 bottom-full z-10 h-6 overflow-hidden motion-reduce:hidden"
    >
      <div className="t3-runner-walk absolute bottom-0 left-0 size-4">
        <div
          className="t3-runner-body relative size-4 text-runner drop-shadow-xs"
          onAnimationEnd={(event) => {
            if (event.animationName === "t3-runner-drop") setShown(false);
          }}
        >
          <svg
            viewBox="0 0 8 8"
            shapeRendering="crispEdges"
            fill="currentColor"
            className="t3-runner-frame-a absolute inset-0 size-4"
          >
            <path d={sprite.restPath} />
          </svg>
          <svg
            viewBox="0 0 8 8"
            shapeRendering="crispEdges"
            fill="currentColor"
            className="t3-runner-frame-b absolute inset-0 size-4"
          >
            <path d={sprite.stepPath} />
          </svg>
        </div>
      </div>
    </div>
  );
}
