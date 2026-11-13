// Dollars of a line, the price rules behind them (1 h cache writes, redesign M2a B13) and their split by token component.
import { num, sum } from "./logs.ts";
import { WEIGHT, weightsOf } from "./prices.ts";

export { WEIGHT };

/**
 * Does the `costUsd` pi logs already charge 1 h cache writes at 2 × input (Anthropic's list)? Yes (redesign M2a, T2a.0).
 * pi 1.4's provider layer (pi-ai `calculateCost`, since pi-ai 0.79.4) prices `usage.cacheWrite1h`, which the Anthropic stream fills from
 * `cache_creation.ephemeral_1h_input_tokens`, at 2 × the input rate and the rest of `cacheWrite` at the 5-minute rate. A fit of
 * `costUsd` on the tokens of the author's main-session claude-opus-5-5 lines agrees: cache-write ÷ input price = 2.000 in arms with
 * `mainCacheTtl` 1h (2750 lines), 1.250 in 5m arms (4314). So a total is not repriced; only the split of a cost by token component
 * and the ledger's prices (the analyser's own 1.25 for every write) were wrong. Set this to false for a pi that charges 1 h writes
 * as 5-minute ones: `apiUsd` then adds the missing 0.75 × input price per 1 h-written token of a line that carries `cacheWrite1h`
 * (a v1 line's arm-flag approximation reaches the split and the ledger, not the totals: a switch no current pi needs).
 */
export const PI_PRICES_1H = true;

/** WEIGHT (prices.ts) is the ratio set of a model without a table entry; a line's own ratios are `weightsOf(l.model, l.provider)` (M4). */
export type Component = keyof typeof WEIGHT | "unallocated";

/** The cache rules (misses, the ledger) hold for Anthropic's explicit prompt caching: a Claude model or the anthropic provider. */
export const isClaude = (l: any): boolean => /claude/i.test(String(l.model)) || l.provider === "anthropic";

/**
 * Tokens of the line's `cacheWrite` written with the 1 h TTL: its own `cacheWrite1h` when it has one (meter v2); else, for a v1 line, all
 * of `cacheWrite` when the line is a Claude main session's (`main`, isClaude: only Anthropic's explicit caching has a TTL) and its arm's `mainCacheTtl` is "1h" (a documented approximation: children
 * and 5m arms write with the 5-minute TTL); else 0. Never more than `cacheWrite`.
 */
export function cacheWrite1hOf(l: any, main: boolean, armFlags?: Record<string, unknown>): number {
  const written = num(l.cacheWrite);
  const long = typeof l.cacheWrite1h === "number" && Number.isFinite(l.cacheWrite1h) ? l.cacheWrite1h : main && isClaude(l) && armFlags?.mainCacheTtl === "1h" ? written : 0;
  return Math.min(Math.max(long, 0), written);
}

/** The line's tokens weighted by its model's weights (cost = p × this, p the input price), `long` of its writes being 1 h writes of weight `longWeight`. */
export const weightedTokens = (l: any, long: number, longWeight: number): number => {
  const w = weightsOf(l.model, l.provider);
  return w.input * num(l.input) + w.cacheRead * num(l.cacheRead) + w.cacheWrite5m * (num(l.cacheWrite) - long) + longWeight * long + w.output * num(l.output);
};

/**
 * The input price p ($ per input token) of a line: its cost ÷ its tokens weighted by its model's weights, `long` of the writes being 1 h writes
 * (weight 2.0 when pi priced them: `priced1h`, else 1.25). 0 for a line without a cost or tokens.
 */
export function pIn(l: any, long: number = num(l.cacheWrite1h), priced1h: boolean = PI_PRICES_1H): number {
  const m = weightsOf(l.model, l.provider), w = weightedTokens(l, long, priced1h ? m.cacheWrite1h : m.cacheWrite5m);
  return w > 0 ? num(l.costUsd) / w : 0;
}

/** What a token the line wrote to the cache costs, in input prices: 1.25 for a 5-minute write, 2.0 for a 1 h one (`long` of the line's cacheWrite), the mix of the two otherwise. */
export function writeWeight(l: any, long: number): number {
  const written = num(l.cacheWrite), w = weightsOf(l.model, l.provider);
  return written > 0 ? (w.cacheWrite5m * (written - long) + w.cacheWrite1h * long) / written : w.cacheWrite5m;
}

export type PriceOpt = {
  /** 1 h-written tokens of the line (cacheWrite1hOf); default its own `cacheWrite1h`, else 0. */
  cacheWrite1h?: number;
  /** Whether the line's costUsd already charges 1 h writes at 2.0 (default PI_PRICES_1H). */
  pricesLongWrite?: boolean;
};

/**
 * API-equivalent dollars of one meter line: the one place the analyser (core/analyse/*, and arms.ts, tasks.ts and ledger.ts, which it
 * calls) turns a line into $. The line's costUsd (0 when absent or not finite), plus, for a pi that did not charge 1 h writes at 2.0
 * (`pricesLongWrite` false), 0.75 × its input price per 1 h-written token. With the default (PI_PRICES_1H) it is the costUsd.
 */
export function apiUsd(l: any, opt: PriceOpt = {}): number {
  const base = num(l.costUsd);
  if (opt.pricesLongWrite ?? PI_PRICES_1H) return base;
  const long = opt.cacheWrite1h ?? num(l.cacheWrite1h);
  const w = weightsOf(l.model, l.provider);
  return base + (w.cacheWrite1h - w.cacheWrite5m) * pIn(l, long, false) * long;
}

/**
 * A line's apiUsd split by token component with its model's weight ratios (prices.ts) (`long` = its 1 h-written tokens, cacheWrite1hOf; the rest of
 * cacheWrite is 5-minute); a line without tokens keeps its $ unallocated. The parts add up to apiUsd(l, { cacheWrite1h: long }).
 */
export function allocate(l: any, long: number = num(l.cacheWrite1h)): Record<Component, number> {
  const c = apiUsd(l, { cacheWrite1h: long });
  const h = Math.min(Math.max(long, 0), num(l.cacheWrite));
  const tokens = { input: num(l.input), cacheRead: num(l.cacheRead), cacheWrite5m: num(l.cacheWrite) - h, cacheWrite1h: h, output: num(l.output) };
  const ratio = weightsOf(l.model, l.provider);
  const w = (Object.keys(WEIGHT) as Array<keyof typeof WEIGHT>).map((k) => [k, ratio[k] * tokens[k]] as const);
  const total = sum(w.map(([, x]) => x));
  const out: Record<Component, number> = { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, unallocated: total ? 0 : c };
  if (total) for (const [k, x] of w) out[k] = (c * x) / total;
  return out;
}
