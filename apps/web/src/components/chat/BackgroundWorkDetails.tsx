import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  ThreadId,
} from "@t3tools/contracts";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { PendingBackgroundWorkItem } from "@t3tools/client-runtime/state/thread-execution";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  RadarIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { useState } from "react";

import { useNowSecond } from "~/hooks/useNowSecond";
import { usePrimarySettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { formatDayAwareTimestamp } from "~/timestampFormat";
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
  { kind: "command", title: msg("Shells", { $context: "background shell commands" }) },
  { kind: "monitor", title: msg("Monitors", { $context: "background watcher tasks" }) },
  { kind: "subagent", title: msg("Agents", { $context: "background subagents" }) },
  { kind: "background_task", title: msg("Other", { $context: "other background tasks" }) },
];

const KIND_NAME: Record<WorkKind, string> = {
  command: msg("Shell", { $context: "kind of background work" }),
  monitor: msg("Monitor", { $context: "kind of background work" }),
  subagent: msg("Agent", { $context: "kind of background work" }),
  background_task: msg("Task", { $context: "kind of background work" }),
};

/** Fills a task's command and live output from its turn item when the task itself lacks them. */
function withTurnItemDetails(
  item: PendingBackgroundWorkItem,
  task: OrchestrationV2PendingBackgroundTask | undefined,
  turnItems: ThreadStructure["turnItems"],
  threadId: ThreadId,
): PendingBackgroundWorkItem {
  if (item.kind === "subagent" || (item.command && item.output)) return item;
  const turnItem = turnItems.findLast((candidate) =>
    task?.itemId === undefined
      ? (candidate.nativeItemRef?.nativeId || candidate.id) === item.taskId
      : candidate.id === task.itemId,
  );
  const commandItem = turnItem?.type === "command_execution" ? turnItem : undefined;
  const outputItemId = task?.itemId ?? commandItem?.id;
  return {
    ...item,
    command: item.command ?? task?.command ?? commandItem?.input,
    output:
      item.output ??
      (outputItemId !== undefined && turnItem?.status === "running"
        ? { threadId: task?.sourceThreadId ?? turnItem.threadId ?? threadId, itemId: outputItemId }
        : undefined),
  };
}

/** Whole seconds, ticking; mounted only inside the open popover. */
function RunningFor(props: { readonly startedAt: number }) {
  const elapsed = Math.floor((useNowSecond() - props.startedAt) / 1_000) * 1_000;
  return <>{formatDuration(Math.max(1_000, elapsed))}</>;
}

function RunningDot() {
  return (
    <span aria-hidden className="relative flex size-1.5 shrink-0">
      <span className="absolute inline-flex size-full motion-safe:animate-status-ping rounded-full bg-success/60" />
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
  readonly threadId: ThreadId;
  readonly items: ReadonlyArray<PendingBackgroundWorkItem>;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  readonly turnItems: ThreadStructure["turnItems"];
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // A single task needs no list: show it straight away.
  const onlyItem = props.items.length === 1 ? props.items[0] : undefined;
  const picked = onlyItem ?? props.items.find((item) => item.taskId === selectedTaskId);
  const selected =
    picked === undefined
      ? undefined
      : withTurnItemDetails(
          picked,
          props.tasks.find((task) => task.taskId === picked.taskId),
          props.turnItems,
          props.threadId,
        );

  return (
    <Popover onOpenChange={(open) => (open ? undefined : setSelectedTaskId(null))}>
      <PopoverTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label={gt("Show what is running")} />}
      >
        <EyeIcon />
      </PopoverTrigger>
      <PopoverPopup
        aria-label={gt("Background tasks")}
        side="top"
        align="end"
        className="w-[min(36rem,calc(100vw-2rem))]"
      >
        {selected ? (
          <BackgroundWorkItemDetails
            environmentId={props.environmentId}
            item={selected}
            items={props.items}
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
  const gt = useGT();
  const m = useMessages();
  return (
    <div className="text-xs">
      <div className="mb-2 font-medium">
        {gt("Background tasks · {count} running", { count: props.items.length })}
      </div>
      <div className="max-h-[60vh] space-y-2.5 overflow-y-auto">
        {GROUPS.map((group) => {
          const items = props.items.filter((item) => item.kind === group.kind);
          if (items.length === 0) return null;
          const Icon = KIND_ICON[group.kind];
          return (
            <section key={group.kind}>
              <div className="mb-1 px-2 text-muted-foreground">
                {gt("{group} ({count})", { group: m(group.title), count: items.length })}
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
                      {item.startedAt === undefined ? null : (
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          <RunningFor startedAt={item.startedAt} />
                        </span>
                      )}
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
  readonly items: ReadonlyArray<PendingBackgroundWorkItem>;
  readonly onBack: (() => void) | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { item } = props;
  const gt = useGT();
  const m = useMessages();
  const streamsOutput = useCommandOutputStreaming(props.environmentId);
  const Icon = KIND_ICON[item.kind];
  const childThreadId = item.childThreadId;
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const parent =
    item.parentTaskId === undefined
      ? undefined
      : (props.items.find((other) => other.taskId === item.parentTaskId)?.label ??
        gt("A subagent"));
  return (
    <div className="min-w-0 space-y-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-1.5 font-medium">
        {props.onBack ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Back to background tasks")}
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
        <dt className="text-muted-foreground">
          <T context="kind of background work">Type</T>
        </dt>
        <dd>{m(KIND_NAME[item.kind])}</dd>
        <dt className="text-muted-foreground">
          <T>Status</T>
        </dt>
        <dd className="flex items-center gap-1.5">
          <RunningDot />
          <T context="status of background work">Running</T>
          {item.startedAt === undefined ? null : (
            <span className="text-muted-foreground tabular-nums">
              <T>
                for{" "}
                <Var>
                  <RunningFor startedAt={item.startedAt} />
                </Var>{" "}
                · since{" "}
                <Var>
                  {formatDayAwareTimestamp(new Date(item.startedAt).toISOString(), timestampFormat)}
                </Var>
              </T>
            </span>
          )}
        </dd>
        {item.kind === "subagent" ? null : (
          <>
            <dt className="text-muted-foreground">
              <T context="the agent that started background work">Agent</T>
            </dt>
            <dd>{item.awaited ? gt("Waits for it to finish") : gt("Carries on without it")}</dd>
          </>
        )}
        {parent === undefined ? null : (
          <>
            <dt className="text-muted-foreground">
              <T>Started by</T>
            </dt>
            <dd className="min-w-0 truncate">{parent}</dd>
          </>
        )}
      </dl>
      {item.command ? (
        <div className="space-y-1">
          <div className="text-muted-foreground">
            <T context="a background shell command">Command</T>
          </div>
          <div className={cn(MONO, "rounded-md bg-muted/40 px-2 py-1.5")}>
            <ShellCommandBlock command={item.command} />
          </div>
        </div>
      ) : null}
      {item.output && streamsOutput ? (
        <div className="space-y-1">
          <div className="text-muted-foreground">
            <T context="a command's output">Output</T>
          </div>
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
          <T>Open subagent</T>
        </Button>
      ) : null}
      {childThreadId === undefined && !item.command && !item.output ? (
        <div className="text-muted-foreground">
          <T>No details for this one.</T>
        </div>
      ) : null}
    </div>
  );
}
