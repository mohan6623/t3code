import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/utils";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

export function ThreadDetailsSection({
  headingId,
  title,
  actions,
  separated = true,
  showHeading = true,
  collapsed = false,
  onCollapsedChange,
  children,
  ...props
}: Omit<ComponentProps<"section">, "className" | "style" | "title" | "aria-labelledby"> & {
  headingId: string;
  title: string;
  actions?: ReactNode;
  separated?: boolean;
  showHeading?: boolean;
  collapsed?: boolean;
  /** Makes the heading a toggle; `actions` then show beside it. */
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  return (
    <section
      {...props}
      aria-labelledby={showHeading ? headingId : undefined}
      aria-label={showHeading ? undefined : title}
      className={cn("px-2 pt-2 pb-2.5", separated && "border-t border-border/65")}
    >
      {showHeading && onCollapsedChange ? (
        <h3 id={headingId} className={cn(!collapsed && "mb-1")}>
          <CollapsibleSectionHeader
            variant="panel"
            expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
            accessory={actions}
          >
            {title}
          </CollapsibleSectionHeader>
        </h3>
      ) : (
        <div
          className={cn(
            "mb-1 flex min-h-8 min-w-0 items-center justify-between gap-2 px-1.5",
            !showHeading && "hidden",
          )}
        >
          <h3
            id={headingId}
            className="min-w-0 truncate text-2xs font-medium text-muted-foreground select-none"
          >
            {title}
          </h3>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      )}
      {collapsed ? null : children}
    </section>
  );
}
