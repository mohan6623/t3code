import { OrchestratorMcpFailure, type ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as HostResourceHistory from "../../../resourceTelemetry/HostResourceHistory.ts";
import * as HostResources from "../../../resourceTelemetry/HostResources.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, unavailable } from "../../threadAccess.ts";
import { EnvironmentToolkit } from "./tools.ts";

export function preferences(settings: ServerSettings) {
  const {
    defaultThreadEnvMode,
    newWorktreesStartFromOrigin,
    enableProviderUpdateChecks,
    backgroundActivity,
    sourceControlWritingStyle,
  } = settings;
  const characters = Array.from(sourceControlWritingStyle.customInstructions);
  return {
    defaultThreadEnvMode,
    newWorktreesStartFromOrigin,
    enableProviderUpdateChecks,
    backgroundActivity: { profile: backgroundActivity.profile },
    sourceControlWritingStyle: {
      ...sourceControlWritingStyle,
      customInstructions: characters.slice(0, 4000).join(""),
      truncated: characters.length > 4000,
    },
  };
}
const access = Effect.gen(function* () {
  const context = yield* readCaller();
  const environment = yield* Environment.ServerEnvironment;
  const descriptor = yield* environment.getDescriptor;
  if (descriptor.environmentId !== context.scope.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential belongs to another environment.",
    });
  return { ...context, descriptor, settings: yield* Settings.ServerSettingsService };
});
const percentOf = (fraction: number | null) =>
  fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;

const busiest = Effect.fn("EnvironmentResources.busiest")(function* (windowMs: number) {
  const history = yield* HostResourceHistory.HostResourceHistory;
  const point = (yield* history.read({ windowMs, points: 1 })).points[0];
  return {
    cpuPercent: percentOf(point?.cpu ?? null),
    memoryPercent: percentOf(point?.memory ?? null),
    diskPercent: percentOf(point?.disk ?? null),
  };
});

export const layer = McpToolAccess.toLayer(EnvironmentToolkit, {
  t3_environment_resources: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const { descriptor } = yield* access;
      const host = yield* (yield* HostResources.HostResources).read;
      const { diskTotalBytes, diskAvailableBytes } = host;
      const hasDisk = diskTotalBytes !== undefined && diskAvailableBytes !== undefined;
      return {
        label: descriptor.label,
        cpuCount: host.cpuCount,
        memoryTotalGb: gb(host.totalMemoryBytes),
        memoryFreeGb: gb(host.availableMemoryBytes),
        diskTotalGb: hasDisk ? gb(diskTotalBytes) : null,
        diskFreeGb: hasDisk ? gb(diskAvailableBytes) : null,
        now: {
          cpuPercent: percentOf(host.cpuUtilization),
          memoryPercent:
            host.totalMemoryBytes > 0
              ? percentOf(1 - host.availableMemoryBytes / host.totalMemoryBytes)
              : null,
          diskPercent:
            hasDisk && diskTotalBytes > 0
              ? percentOf(1 - diskAvailableBytes / diskTotalBytes)
              : null,
        },
        busiestLast30Minutes: yield* busiest(30 * 60_000),
        busiestLast24Hours: yield* busiest(24 * 60 * 60_000),
      };
    }),
  ),
  t3_environment_read: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const { descriptor, settings } = yield* access;
      const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      return {
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        serverVersion: descriptor.serverVersion,
        platform: descriptor.platform,
        preferences: preferences(current),
      };
    }),
  ),
  t3_environment_preferences_update: McpToolAccess.writesEnvironment((patch, check) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const update = Effect.gen(function* () {
        // The turn may have ended, or the thread's modes changed, while this waited for the lock.
        yield* check;
        const { settings } = yield* access;
        return preferences(
          yield* settings.updateSettings(patch).pipe(Effect.mapError(unavailable)),
        );
      });
      return yield* scope.thread === undefined
        ? update
        : executor.withLock(scope.thread.threadId, update);
    }),
  ),
});
