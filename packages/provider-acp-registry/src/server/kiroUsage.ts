import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as EffectAcpErrors from "effect-acp/errors";

import type { AcpRegistrySettings } from "../settings.ts";

/**
 * Kiro CLI (2.33) answers its `/usage` slash command over this ACP extension
 * method on any open session. The read is free: it spends no credits.
 */
export const KIRO_COMMAND_EXECUTE_METHOD = "_kiro.dev/commands/execute";
/** Kiro sends this per session; turns add `meteringUsage` with the credits spent. */
export const KIRO_METADATA_NOTIFICATION = "_kiro.dev/metadata";
export const KIRO_USAGE_TIMEOUT = "20 seconds";
export const KIRO_CREDITS_WINDOW_ID = "credits";

const PROBE_FAILED_MESSAGE = "Kiro could not read credit usage.";

const KIRO_AGENT_ID = /^kiro(?:-cli)?$/iu;
const KIRO_COMMAND = /^kiro-cli(?:\.exe|\.cmd)?$/iu;

const commandName = (command: string): string => command.split(/[\\/]/u).pop() ?? "";

/** Kiro runs as a local `kiro-cli acp` command or as a registry agent named after it. */
export function isKiroAcpAgent(
  settings: Pick<AcpRegistrySettings, "source" | "agentId" | "commandPath">,
  resolvedCommand?: string,
): boolean {
  if (settings.source !== "local" && KIRO_AGENT_ID.test(settings.agentId)) return true;
  return [settings.commandPath, resolvedCommand ?? ""].some(
    (command) => command.length > 0 && KIRO_COMMAND.test(commandName(command)),
  );
}

export function kiroUsageRequest(sessionId: string) {
  return { sessionId, command: { command: "usage", args: {} } };
}

const FiniteNumber = Schema.Number.check(Schema.isFinite());

const KiroUsageBreakdown = Schema.Struct({
  resourceType: Schema.optional(Schema.String),
  used: FiniteNumber,
  limit: FiniteNumber,
  percentage: Schema.optional(Schema.Number),
  hasLimit: Schema.optional(Schema.Boolean),
});
type KiroUsageBreakdown = typeof KiroUsageBreakdown.Type;

/** Bonus and add-on grants are empty on every plan seen so far; read the likely fields. */
const KiroExtraCredits = Schema.Struct({
  used: Schema.optional(FiniteNumber),
  limit: Schema.optional(FiniteNumber),
  amount: Schema.optional(FiniteNumber),
  credits: Schema.optional(FiniteNumber),
});

const KiroUsageData = Schema.Struct({
  billingCycleReset: Schema.optional(Schema.String),
  usageBreakdowns: Schema.Array(Schema.Unknown),
  bonusCredits: Schema.optional(Schema.Array(Schema.Unknown)),
  addOnCredits: Schema.optional(Schema.Array(Schema.Unknown)),
});

const decodeBreakdown = Schema.decodeUnknownOption(KiroUsageBreakdown);
const decodeExtraCredits = Schema.decodeUnknownOption(KiroExtraCredits);
const decodeUsageData = Schema.decodeUnknownOption(KiroUsageData);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickCreditBreakdown(
  breakdowns: ReadonlyArray<KiroUsageBreakdown>,
): KiroUsageBreakdown | undefined {
  return (
    breakdowns.find(
      (breakdown) => breakdown.resourceType?.toUpperCase() === "CREDIT" && breakdown.limit > 0,
    ) ?? breakdowns.find((breakdown) => breakdown.hasLimit !== false && breakdown.limit > 0)
  );
}

function sumExtraCredits(entries: ReadonlyArray<unknown> | undefined) {
  let used = 0;
  let limit = 0;
  for (const entry of entries ?? []) {
    const credits = decodeExtraCredits(entry);
    if (Option.isNone(credits)) continue;
    used += Math.max(0, credits.value.used ?? 0);
    limit += Math.max(0, credits.value.limit ?? credits.value.amount ?? credits.value.credits ?? 0);
  }
  return { used, limit };
}

/** `2026-11-01` names the day the cycle restarts; Kiro bills in UTC. */
function billingCycleReset(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) return undefined;
  const reset = DateTime.make(value.trim());
  return Option.isSome(reset) ? reset.value : undefined;
}

function billingCycleMinutes(reset: DateTime.Utc): number | undefined {
  const start = DateTime.subtract(reset, { months: 1 });
  const minutes = Math.round(
    (DateTime.toEpochMillis(reset) - DateTime.toEpochMillis(start)) / 60_000,
  );
  return minutes > 0 ? minutes : undefined;
}

const creditFormat = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: value < 10 ? 1 : 0 });

/**
 * Maps the `/usage` command result (`{ success, message, data }`, or `data`
 * itself) onto one monthly credits window. Any other shape reports the read as
 * failed, so clients keep the last good bar instead of clearing it.
 */
export function kiroUsageResponseToLimits(
  response: unknown,
  checkedAt: string,
): ServerProviderUsageLimits {
  const failed = makeUnavailableUsageLimits({
    checkedAt,
    reason: "probeFailed",
    message: PROBE_FAILED_MESSAGE,
  });
  if (!isRecord(response) || response.success === false) return failed;
  const decoded = decodeUsageData(isRecord(response.data) ? response.data : response);
  if (Option.isNone(decoded)) return failed;
  const data = decoded.value;
  const breakdown = pickCreditBreakdown(
    data.usageBreakdowns.flatMap((entry) => Option.toArray(decodeBreakdown(entry))),
  );
  if (breakdown === undefined) return failed;
  const bonus = sumExtraCredits(data.bonusCredits);
  const addOn = sumExtraCredits(data.addOnCredits);
  const used = Math.max(0, breakdown.used) + bonus.used + addOn.used;
  const limit = breakdown.limit + bonus.limit + addOn.limit;
  const hasExtraCredits = bonus.limit + addOn.limit > 0;
  const usedPercent = clampPercent(
    !hasExtraCredits && breakdown.percentage !== undefined && Number.isFinite(breakdown.percentage)
      ? breakdown.percentage
      : (used / limit) * 100,
  );
  const reset = billingCycleReset(data.billingCycleReset);
  const windowDurationMins = reset === undefined ? undefined : billingCycleMinutes(reset);
  const window: ServerProviderUsageWindow = {
    id: KIRO_CREDITS_WINDOW_ID,
    kind: "monthly",
    label: `${creditFormat(used)} / ${creditFormat(limit)} credits`,
    usedPercent,
    ...(reset === undefined ? {} : { resetsAt: DateTime.formatIso(reset) }),
    ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
  };
  return makeUsageLimits({ checkedAt, windows: [window] });
}

/** True when a `_kiro.dev/metadata` notification reports credits spent by a turn. */
export function kiroMetadataReportsMetering(params: unknown): params is {
  readonly sessionId: string;
} {
  return (
    isRecord(params) &&
    typeof params.sessionId === "string" &&
    params.sessionId.length > 0 &&
    Array.isArray(params.meteringUsage) &&
    params.meteringUsage.length > 0
  );
}

/**
 * Asks an open Kiro session for its credit usage. Never fails: a timeout, an
 * RPC error, or an unexpected answer becomes `probeFailed` limits.
 */
export const readKiroUsageLimits = Effect.fn("readKiroUsageLimits")(function* (
  request: (method: string, payload: unknown) => Effect.Effect<unknown, EffectAcpErrors.AcpError>,
  sessionId: string,
) {
  const response = yield* request(KIRO_COMMAND_EXECUTE_METHOD, kiroUsageRequest(sessionId)).pipe(
    Effect.timeoutOption(KIRO_USAGE_TIMEOUT),
    Effect.map(Option.getOrUndefined),
    Effect.orElseSucceed(() => undefined),
  );
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return kiroUsageResponseToLimits(response, checkedAt);
});
