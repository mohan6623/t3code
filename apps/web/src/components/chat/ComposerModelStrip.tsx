import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useLabelsOverflow } from "../BranchToolbar";
import { contextStripFoldAttributes } from "../BranchToolbar.logic";
import { ComposerSurface } from "./ComposerSurface";

/**
 * Fork: the strip below the composer that hosts the model controls when the context strip is off.
 * Its fold level lives here, so a fold re-renders this strip, not the whole chat view.
 */
export function ComposerModelStrip({
  shown,
  attachControlsHost,
  children,
}: {
  readonly shown: boolean;
  readonly attachControlsHost: (element: HTMLDivElement | null) => void;
  readonly children: ReactNode;
}) {
  const [attach, foldLevel] = useLabelsOverflow();
  return (
    <ComposerSurface.ContextStrip
      ref={attach}
      {...contextStripFoldAttributes(foldLevel)}
      data-composer-model-strip="true"
      data-composer-model-strip-static="true"
      aria-hidden={shown ? undefined : true}
      inert={shown ? undefined : true}
      className={cn(
        "group-data-model-strip-transition/composer-surface:before:backdrop-blur-(--glass-blur) group-data-model-strip-transition/composer-surface:before:bg-(--chat-composer-glass-surface)/(--glass-opacity)",
        !shown && "pointer-events-none invisible absolute inset-x-0 top-full",
      )}
    >
      <div
        ref={attachControlsHost}
        data-chat-resting-composer-controls-host="true"
        className="min-w-0 flex-1"
      />
      {children}
    </ComposerSurface.ContextStrip>
  );
}
