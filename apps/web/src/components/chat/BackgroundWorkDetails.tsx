import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { PendingBackgroundWorkItem } from "@t3tools/client-runtime/state/thread-execution";
import { BotIcon, EyeIcon, RadarIcon, SquareTerminalIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button, InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { CommandOutputPanel, useCommandOutputStreaming } from "./CommandOutputPanel";
import { ShellCommandBlock } from "./ShellCommandBlock";

const MONO =
  "font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text";

const KIND_ICON = {
  subagent: BotIcon,
  command: SquareTerminalIcon,
  monitor: RadarIcon,
  background_task: SquareTerminalIcon,
} as const;

/**
 * Fork: what the "Running ..." strip is running. Each command shows its shell
 * line and its live output; each subagent links to its thread.
 */
export function BackgroundWorkDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly items: ReadonlyArray<PendingBackgroundWorkItem>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const streamsOutput = useCommandOutputStreaming(props.environmentId);
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label="Show what is running" />}
      >
        <EyeIcon />
      </PopoverTrigger>
      <PopoverPopup
        aria-label="What is running"
        side="top"
        align="end"
        className="w-[min(36rem,calc(100vw-2rem))]"
      >
        <div className="max-h-[60vh] space-y-3 overflow-y-auto text-xs">
          {props.items.map((item) => {
            const Icon = KIND_ICON[item.kind];
            const childThreadId = item.childThreadId;
            return (
              <section key={item.taskId} className="min-w-0 space-y-1.5">
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.command ? (
                  <div className={cn(MONO, "rounded-md bg-muted/40 px-2 py-1.5")}>
                    <ShellCommandBlock command={item.command} />
                  </div>
                ) : null}
                {item.output && streamsOutput ? (
                  <div className={cn(MONO, "text-muted-foreground")}>
                    <CommandOutputPanel
                      environmentId={props.environmentId}
                      threadId={item.output.threadId}
                      itemId={item.output.itemId}
                    />
                  </div>
                ) : null}
                {childThreadId !== undefined ? (
                  <InlineButton tone="muted" onClick={() => props.onOpenThread(childThreadId)}>
                    Open subagent
                  </InlineButton>
                ) : null}
                {childThreadId === undefined && !item.command && !item.output ? (
                  <div className="text-muted-foreground">No details for this one.</div>
                ) : null}
              </section>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
