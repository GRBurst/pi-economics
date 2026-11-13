// Dollars of a line and their split by token component.
import { num, sum } from "./logs.ts";

/**
 * API-equivalent dollars of one meter line: the one place the core/analyse/* modules turn a line into $ (M2a prices 1 h cache
 * writes here; arms.ts, tasks.ts and ledger.ts read costUsd themselves until M2a routes them through here).
 * Until then it is the line's costUsd (0 when absent or not finite).
 */
export const apiUsd = (l: any): number => num(l.costUsd);

/**
 * Does the `costUsd` pi logs already charge 1 h cache writes at 2 × input (Anthropic's list)? Yes (redesign M2a, T2a.0).
 * pi 1.4's provider layer (pi-ai `calculateCost`, since pi-ai 0.79.4) prices `usage.cacheWrite1h`, which the Anthropic stream fills from
 * `cache_creation.ephemeral_1h_input_tokens`, at 2 × the input rate and the rest of `cacheWrite` at the 5-minute rate. A fit of
 * `costUsd` on the tokens of the author's main-session claude-opus-5-5 lines agrees: cache-write ÷ input price = 2.000 in arms with
 * `mainCacheTtl` 1h (2750 lines), 1.250 in 5m arms (4314). So a total is not repriced; only the split of a cost by token component
 * and the ledger's prices (the analyser's own 1.25 for every write) were wrong. Set this to false for a pi that charges 1 h writes
 * as 5-minute ones: `apiUsd` then adds the missing 0.75 × input price per 1 h-written token.
 */
export const PI_PRICES_1H = true;

/** Relative token prices (Anthropic: cache read 0.1, cache write 1.25, output 5 × input), used only to split a line's cost. */
export const WEIGHT = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 } as const;
export type Component = keyof typeof WEIGHT | "unallocated";
export function allocate(l: any): Record<Component, number> {
  const c = apiUsd(l);
  const w = (Object.keys(WEIGHT) as Array<keyof typeof WEIGHT>).map((k) => [k, WEIGHT[k] * num(l[k])] as const);
  const total = sum(w.map(([, x]) => x));
  const out = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, unallocated: total ? 0 : c };
  if (total) for (const [k, x] of w) out[k] = (c * x) / total;
  return out;
}
