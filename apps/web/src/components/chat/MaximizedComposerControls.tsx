// Fork: the floating composer of a maximized right panel minimizes to a bubble and back.
import { MessageSquareTextIcon, MinusIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function withShortcut(label: string, shortcutLabel: string | null) {
  return shortcutLabel ? `${label} (${shortcutLabel})` : label;
}

export function MaximizedComposerMinimizeButton(props: {
  readonly shortcutLabel: string | null;
  readonly onMinimize: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-xs"
            className="shrink-0"
            aria-label="Minimize composer"
            onClick={props.onMinimize}
          />
        }
      >
        <MinusIcon />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {withShortcut("Minimize composer", props.shortcutLabel)}
      </TooltipPopup>
    </Tooltip>
  );
}

export function MaximizedComposerBubble(props: {
  readonly shortcutLabel: string | null;
  readonly onRestore: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="glass"
            size="icon-xl"
            className="absolute right-4 bottom-4 z-30"
            aria-label="Show composer"
            onClick={props.onRestore}
          />
        }
      >
        <MessageSquareTextIcon />
      </TooltipTrigger>
      <TooltipPopup side="left">{withShortcut("Show composer", props.shortcutLabel)}</TooltipPopup>
    </Tooltip>
  );
}
