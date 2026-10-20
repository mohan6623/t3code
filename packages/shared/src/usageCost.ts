/**
 * Fork: turns a turn's token counts into one "cost score", so a share of a
 * subscription limit can be estimated per subagent. Providers report limits
 * only for the whole account, so the score is weighed by public API prices
 * (US dollars per million tokens): output costs more than input, a cache read
 * far less, a cache write a little more. Only the ratios matter; each account
 * learns how much score fills 1% of each limit.
 */

interface TokenPrices {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

const prices = (input: number, output: number, cacheRead = input / 10): TokenPrices => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

/** First match wins, so put the narrower names first. */
const MODEL_PRICES: ReadonlyArray<readonly [RegExp, TokenPrices]> = [
  [/fable|mythos/, prices(10, 50, 0.25)],
  [/opus-?5[-.]5/, prices(4, 20, 0.2)],
  [/opus/, prices(5, 25)],
  [/sonnet-?5/, prices(2, 10, 0.2)],
  [/sonnet/, prices(3, 15)],
  [/haiku-?5/, prices(0.1, 0.5, 0.01)],
  [/haiku/, prices(1, 5)],
  [/mini|nano/, prices(0.25, 2, 0.025)],
  [/gpt|codex|o\d/, prices(1.25, 10, 0.125)],
];

const DRIVER_PRICES: Readonly<Record<string, TokenPrices>> = {
  claudeAgent: prices(3, 15),
  codex: prices(1.25, 10, 0.125),
};
const FALLBACK_PRICES = prices(3, 15);

function pricesFor(driver: string, model: string | undefined): TokenPrices {
  const name = model?.toLowerCase();
  if (name) {
    for (const [pattern, modelPrices] of MODEL_PRICES) {
      if (pattern.test(name)) return modelPrices;
    }
  }
  return DRIVER_PRICES[driver] ?? FALLBACK_PRICES;
}

export interface TurnTokenCounts {
  /** All input, cache reads and writes included. */
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly cacheCreationTokens?: number | undefined;
  /** Reasoning included. */
  readonly outputTokens?: number | undefined;
}

const count = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

/** Every token the turn processed, the raw figure the hover card shows. */
export function totalTurnTokens(usage: TurnTokenCounts): number {
  return count(usage.inputTokens) + count(usage.outputTokens);
}

/** The turn's cost score: estimated API price in US dollars. */
export function turnCostScore(
  driver: string,
  model: string | undefined,
  usage: TurnTokenCounts,
): number {
  const rates = pricesFor(driver, model);
  const cacheRead = count(usage.cachedInputTokens);
  const cacheWrite = count(usage.cacheCreationTokens);
  const uncached = Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite);
  return (
    (uncached * rates.input +
      cacheRead * rates.cacheRead +
      cacheWrite * rates.cacheWrite +
      count(usage.outputTokens) * rates.output) /
    1_000_000
  );
}

/**
 * Claude names a model's own weekly allowance `seven_day_<model>` (Weekly ·
 * Fable). Only that model's turns fill it, so other models' cost stays out.
 */
export function windowCountsModel(windowId: string, model: string | undefined): boolean {
  if (!windowId.startsWith("seven_day_")) return true;
  const scope = windowId.slice("seven_day_".length);
  if (scope === "" || scope === "overage_included") return true;
  return (
    model !== undefined &&
    model
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .includes(scope)
  );
}

/** "~0.4%", "<0.1%", "~12%": the estimate always reads as one. */
export function formatLimitShare(percent: number): string {
  if (percent < 0.1) return "<0.1%";
  if (percent < 10) return `~${percent.toFixed(1)}%`;
  return `~${Math.round(percent)}%`;
}
