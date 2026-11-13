// (a) cache: what a request wrote because the context grew and what it had to rewrite because the cache lost the prefix (redesign M2a, B3).
import { num } from "./logs.ts";

export type MissCause = "ttl" | "fold" | "model" | "other";
/** One request of a session branch: `growth` = tokens written because the context grew (new context), `miss` = tokens of the cached prefix it had to process again. */
export type CacheStep = { sessionId: string; i: number; growth: number; miss: number; cause?: MissCause };

/** Tokens in the cache after a request: what it read plus what it wrote (its uncached `input` tail is after the last cache breakpoint). */
const cached = (l: any): number => num(l.cacheRead) + num(l.cacheWrite);
const prompt = (l: any): number => num(l.input) + cached(l);

/**
 * The steps of one session branch: its request lines (kind turn or warming, no error lines) in ts order. Only turn lines are outcomes
 * (a warming request refreshes the prefix, it is no step of its own), but every line is the "previous request" of the next one.
 * Request i (position in `branch`): cached_i = cacheRead_i + cacheWrite_i, prompt_i = input_i + cached_i;
 *   growth_i = min(cacheWrite_i, max(0, cached_i − cached_{i−1}))      the context that was added (i = 0: all of cacheWrite_0)
 *   miss_i   = max(0, min(cached_{i−1}, prompt_i) − cacheRead_i)       prefix the previous request left in the cache and this one did not read (i = 0: 0)
 * so cacheWrite_i = growth_i + the rewrite (≈ miss_i). The previous request's uncached input tail is not part of the cache, so it is no miss.
 * A miss has a cause: `ttl` when the gap since the previous request outlived the TTL in force there (`ttlMs(previous)`; a warming request is
 * a previous request: it refreshed the prefix), else `other`.
 */
export function cacheSteps(branch: readonly any[], ttlMs: (l: any) => number, eventBetween: (a: any, b: any) => boolean): CacheStep[] {
  const steps: CacheStep[] = [];
  branch.forEach((l, i) => {
    if (l.kind === "warming") return;
    const sessionId = String(l.sessionId);
    if (i === 0) { steps.push({ sessionId, i, growth: num(l.cacheWrite), miss: 0 }); return; }
    const prev = branch[i - 1];
    const growth = Math.min(num(l.cacheWrite), Math.max(0, cached(l) - cached(prev)));
    const miss = Math.max(0, Math.min(cached(prev), prompt(l)) - num(l.cacheRead));
    const step: CacheStep = { sessionId, i, growth, miss };
    if (miss > 0) step.cause = Date.parse(l.ts) - Date.parse(prev.ts) > ttlMs(prev) ? "ttl" : "other";
    steps.push(step);
  });
  return steps;
}
