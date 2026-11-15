/**
 * Fork: output speed for providers that do not time their own responses (only Claude does).
 * A turn's model time is its wall time minus the time tools and waits ran, except where the
 * model was writing text or reasoning at the same moment.
 */
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

export interface TurnItemTimes {
  readonly type: OrchestrationV2TurnItem["type"];
  readonly startedAtMs: number | null;
  readonly completedAtMs: number | null;
}

const WRITING: ReadonlySet<OrchestrationV2TurnItem["type"]> = new Set([
  "assistant_message",
  "reasoning",
]);

const NOT_THE_MODEL: ReadonlySet<OrchestrationV2TurnItem["type"]> = new Set([
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
  "approval_request",
  "user_input_request",
]);

export function estimateOutputGenerationMs(input: {
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly items: ReadonlyArray<TurnItemTimes>;
}): number {
  const { startedAtMs: start, completedAtMs: end } = input;
  if (end <= start) return 0;
  const edges: Array<{ readonly at: number; readonly writing: boolean; readonly delta: 1 | -1 }> =
    [];
  for (const item of input.items) {
    const writing = WRITING.has(item.type);
    if ((!writing && !NOT_THE_MODEL.has(item.type)) || item.startedAtMs === null) continue;
    const from = Math.max(start, item.startedAtMs);
    const to = Math.min(end, item.completedAtMs ?? end);
    if (to <= from) continue;
    edges.push({ at: from, writing, delta: 1 }, { at: to, writing, delta: -1 });
  }
  edges.sort((a, b) => a.at - b.at);
  let waiting = 0;
  let writing = 0;
  let waitedMs = 0;
  let previous = start;
  for (const edge of edges) {
    if (waiting > 0 && writing === 0) waitedMs += edge.at - previous;
    previous = edge.at;
    if (edge.writing) writing += edge.delta;
    else waiting += edge.delta;
  }
  return end - start - waitedMs;
}
