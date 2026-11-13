// Dollars of a line and their split by token component.
import { num, sum } from "./logs.ts";

/** Relative token prices (Anthropic: cache read 0.1, cache write 1.25, output 5 × input), used only to split a line's cost. */
export const WEIGHT = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 } as const;
export type Component = keyof typeof WEIGHT | "unallocated";
export function allocate(l: any): Record<Component, number> {
  const c = num(l.costUsd);
  const w = (Object.keys(WEIGHT) as Array<keyof typeof WEIGHT>).map((k) => [k, WEIGHT[k] * num(l[k])] as const);
  const total = sum(w.map(([, x]) => x));
  const out = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, unallocated: total ? 0 : c };
  if (total) for (const [k, x] of w) out[k] = (c * x) / total;
  return out;
}
