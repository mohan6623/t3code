import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { PendingBackgroundWorkItem } from "@t3tools/client-runtime/state/thread-execution";
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  RadarIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { CommandOutputPanel, useCommandOutputStreaming } from "./CommandOutputPanel";
import { ShellCommandBlock } from "./ShellCommandBlock";

const MONO =
  "font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text";

type WorkKind = PendingBackgroundWorkItem["kind"];

const KIND_ICON: Record<WorkKind, typeof BotIcon> = {
  command: SquareTerminalIcon,
  monitor: RadarIcon,
  subagent: BotIcon,
  background_task: SquareTerminalIcon,
};

/** List order and group names, as in Claude Code's background tasks dialog. */
const GROUPS: ReadonlyArray<{ readonly kind: WorkKind; readonly title: string }> = [
  { kind: "command", title: "Shells" },
  { kind: "monitor", title: "Monitors" },
  { kind: "subagent", title: "Agents" },
  { kind: "background_task", title: "Other" },
];

const KIND_NAME: Record<WorkKind, string> = {
  command: "Shell",
  monitor: "Monitor",
  subagent: "Agent",
  background_task: "Task",
};

function RunningDot() {
  return (
    <span aria-hidden className="relative flex size-1.5 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
      <span className="relative inline-flex size-1.5 rounded-full bg-success" />
    </span>
  );
}

/**
 * Fork: what the "Running ..." strip is running. Like Claude Code's
 * background tasks dialog, it lists the work grouped by kind, one line each;
 * choosing a line shows its command and live output, or opens its subagent.
 */
export function BackgroundWorkDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly items: ReadonlyArray<PendingBackgroundWorkItem>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // A single task needs no list: show it straight away.
  const onlyItem = props.items.length === 1 ? props.items[0] : undefined;
  const selected =
    onlyItem ?? props.items.find((item) => item.taskId === selectedTaskId) ?? undefined;

  return (
    <Popover onOpenChange={(open) => (open ? undefined : setSelectedTaskId(null))}>
      <PopoverTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label="Show what is running" />}
      >
        <EyeIcon />
      </PopoverTrigger>
      <PopoverPopup
        aria-label="Background tasks"
        side="top"
        align="end"
        className="w-[min(36rem,calc(100vw-2rem))]"
      >
        {selected ? (
          <BackgroundWorkItemDetails
            environmentId={props.environmentId}
            item={selected}
            onBack={onlyItem ? undefined : () => setSelectedTaskId(null)}
            onOpenThread={props.onOpenThread}
          />
        ) : (
          <BackgroundWorkList items={props.items} onSelect={setSelectedTaskId} />
        )}
      </PopoverPopup>
    </Popover>
  );
}

function BackgroundWorkList(props: {
  readonly items: ReadonlyArray<PendingBackgroundWorkItem>;
  readonly onSelect: (taskId: string) => void;
}) {
  return (
    <div className="text-xs">
      <div className="mb-2 font-medium">Background tasks · {props.items.length} running</div>
      <div className="max-h-[60vh] space-y-2.5 overflow-y-auto">
        {GROUPS.map((group) => {
          const items = props.items.filter((item) => item.kind === group.kind);
          if (items.length === 0) return null;
          const Icon = KIND_ICON[group.kind];
          return (
            <section key={group.kind}>
              <div className="mb-1 px-2 text-muted-foreground">
                {group.title} ({items.length})
              </div>
              <ul>
                {items.map((item) => (
                  <li key={item.taskId}>
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      onClick={() => props.onSelect(item.taskId)}
                    >
                      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {item.command && item.command !== item.label ? (
                          <span className="block truncate font-mono text-2xs text-muted-foreground">
                            {item.command}
                          </span>
                        ) : null}
                      </span>
                      <RunningDot />
                      <ChevronRightIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BackgroundWorkItemDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly item: PendingBackgroundWorkItem;
  readonly onBack: (() => void) | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { item } = props;
  const streamsOutput = useCommandOutputStreaming(props.environmentId);
  const Icon = KIND_ICON[item.kind];
  const childThreadId = item.childThreadId;
  return (
    <div className="min-w-0 space-y-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-1.5 font-medium">
        {props.onBack ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Back to background tasks"
            className="-ms-1"
            onClick={props.onBack}
          >
            <ChevronLeftIcon />
          </Button>
        ) : (
          <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{item.label}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Type</dt>
        <dd>{KIND_NAME[item.kind]}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="flex items-center gap-1.5">
          <RunningDot />
          Running
        </dd>
      </dl>
      {item.command ? (
        <div className="space-y-1">
          <div className="text-muted-foreground">Command</div>
          <div className={cn(MONO, "rounded-md bg-muted/40 px-2 py-1.5")}>
            <ShellCommandBlock command={item.command} />
          </div>
        </div>
      ) : null}
      {item.output && streamsOutput ? (
        <div className="space-y-1">
          <div className="text-muted-foreground">Output</div>
          <div className={cn(MONO, "rounded-md bg-muted/20 px-2 py-1.5")}>
            <CommandOutputPanel
              environmentId={props.environmentId}
              threadId={item.output.threadId}
              itemId={item.output.itemId}
            />
          </div>
        </div>
      ) : null}
      {childThreadId !== undefined ? (
        <Button size="xs" variant="outline" onClick={() => props.onOpenThread(childThreadId)}>
          Open subagent
        </Button>
      ) : null}
      {childThreadId === undefined && !item.command && !item.output ? (
        <div className="text-muted-foreground">No details for this one.</div>
      ) : null}
    </div>
  );
}
