import type { ComponentProps } from "react";
import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface Props extends Pick<
  ComponentProps<"div">,
  "tabIndex" | "onKeyDown" | "aria-valuenow" | "aria-valuemin" | "aria-valuemax"
> {
  handlers: ResizableWidthHandlers;
  className?: string;
  label?: string;
  /** Fork: "grip" shows a short pill on hover instead of a full-height line. */
  variant?: "line" | "grip";
}

export function RightPanelResizeHandle({
  handlers,
  className,
  label,
  variant = "line",
  ...separatorProps
}: Props) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      {...separatorProps}
      className={cn(
        "group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none select-none any-pointer-coarse:-left-2 any-pointer-coarse:w-4",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1/2 -translate-x-1/2 bg-transparent transition-colors duration-150 group-focus-visible:bg-primary/60 group-active:bg-primary/60",
          variant === "grip"
            ? "top-1/2 h-10 w-1 -translate-y-1/2 rounded-full group-hover:bg-muted-foreground/40"
            : "inset-y-0 w-px group-hover:bg-border",
        )}
      />
    </div>
  );
}
