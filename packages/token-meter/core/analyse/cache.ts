// (a) cache: what a request wrote because the context grew and what it had to rewrite because the cache lost the prefix (redesign M2a, B3).
import { FOLD_SHRINK, isError, push } from "../arms.ts";
import { byTs, isLine, num } from "./logs.ts";
import { cacheWrite1hOf, isClaude, pIn, WEIGHT, writeWeight } from "./units.ts";

type Flags = Record<string, Record<string, string>>;

export type MissCause = "ttl" | "fold" | "model" | "other";
/** One request of a session branch: `growth` = tokens written because the context grew (new context), `miss` = tokens of the cached prefix it had to process again. */
export type CacheStep = { sessionId: string; i: number; growth: number; miss: number; cause?: MissCause };

/** Tokens in the cache after a request: what it read plus what it wrote (its uncached `input` tail is after the last cache breakpoint). */
const cached = (l: any): number => num(l.cacheRead) + num(l.cacheWrite);
const prompt = (l: any): number => num(l.input) + cached(l);

/** A fold between two consecutive requests as the meter lines show it (arms.ts, ledger.ts): the prompt fell below 80% of the previous one's. */
export const shrinkFold = (a: any, b: any): boolean => prompt(b) < FOLD_SHRINK * prompt(a);

/**
 * The steps of one session branch: its request lines (kind turn or warming, no error lines) in ts order. Only turn lines are outcomes
 * (a warming request refreshes the prefix, it is no step of its own), but every line is the "previous request" of the next one.
 * Request i (position in `branch`): cached_i = cacheRead_i + cacheWrite_i, prompt_i = input_i + cached_i;
 *   growth_i = min(cacheWrite_i, max(0, cached_i − cached_{i−1}))      the context that was added (i = 0: all of cacheWrite_0)
 *   miss_i   = max(0, min(cached_{i−1}, prompt_i) − cacheRead_i)       prefix the previous request left in the cache and this one did not read (i = 0: 0)
 * so cacheWrite_i = growth_i + the rewrite (≈ miss_i). The previous request's uncached input tail is not part of the cache, so it is no miss.
 * A miss has a cause, the first that holds (P8: a gap beyond the TTL loses the prefix whatever else happened): `ttl` when the gap since the
 * previous request outlived the TTL in force there (`ttlMs(previous)`; a warming request is a previous request: it refreshed the prefix),
 * `fold` when `eventBetween(previous, this)` (a fold or compaction), `model` when the model changed, else `other`.
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
    if (miss > 0) step.cause = Date.parse(l.ts) - Date.parse(prev.ts) > ttlMs(prev) ? "ttl" : eventBetween(prev, l) ? "fold" : l.model !== prev.model ? "model" : "other";
    steps.push(step);
  });
  return steps;
}

const TTL_5M = 5 * 60_000;
const TTL_1H = 60 * 60_000;

/** The TTL in force after a request (`ttlMs` of cacheSteps): 1 h when it wrote 1 h (`cacheWrite1h` > 0) or is a main session's in a `mainCacheTtl` 1h arm of `flags` (arm id → factor values), else 5 minutes. */
export const ttlMsOf = (flags: Flags = {}) => (l: any): number =>
  num(l.cacheWrite1h) > 0 || (l.parentSessionId === undefined && flags[l.arm]?.mainCacheTtl === "1h") ? TTL_1H : TTL_5M;

/** The session branches of `lines`: per session the turn and warming requests of Claude models in ts order (error lines carry no usage, nested requests are another prompt). */
export function branchesOf(lines: readonly any[]): Map<string, any[]> {
  const branches = new Map<string, any[]>();
  const usable = lines.filter((l) => isLine(l) && typeof l.sessionId === "string" && (l.kind === "turn" || l.kind === "warming") && !isError(l) && isClaude(l));
  for (const l of usable.sort(byTs)) push(branches, l.sessionId, l);
  return branches;
}

export type CauseRow = { cause: MissCause; n: number; tokens: number; usd: number };
export type CacheSection = {
  /** Claude turn requests in the branches, and the branches. */ requests: number; branches: number;
  /** Their cacheWrite tokens. */ writeTokens: number;
  /** Growth writes: tokens and $ at the write price. */ newContext: { tokens: number; usd: number };
  /** Misses by cause, in the order ttl, fold, model, other: requests, missed tokens, premium API-eq $ = tokens × (write − read price). */ misses: CauseRow[];
  /** Missed tokens ÷ cacheWrite tokens (0 without writes). */ missShare: number;
};
const CAUSES: MissCause[] = ["ttl", "fold", "model", "other"];

/**
 * The Cache section: cacheSteps (fold = shrinkFold) over every branch of `lines`, summed. $ is at each line's input price p (pIn): a write
 * costs 1.25 p (2.0 p for 1 h writes, cacheWrite1hOf), a read 0.1 p; a miss costs the premium of writing over reading.
 */
export function cacheSection(lines: readonly any[], flags: Flags = {}): CacheSection {
  const ttl = ttlMsOf(flags);
  const misses = CAUSES.map((cause): CauseRow => ({ cause, n: 0, tokens: 0, usd: 0 }));
  const out: CacheSection = { requests: 0, branches: 0, writeTokens: 0, newContext: { tokens: 0, usd: 0 }, misses, missShare: 0 };
  for (const branch of branchesOf(lines).values()) {
    out.branches += 1;
    for (const step of cacheSteps(branch, ttl, shrinkFold)) {
      const l = branch[step.i];
      const long = cacheWrite1hOf(l, l.parentSessionId === undefined, flags[l.arm]);
      const p = pIn(l, long), w = writeWeight(l, long);
      out.requests += 1;
      out.writeTokens += num(l.cacheWrite);
      out.newContext.tokens += step.growth;
      out.newContext.usd += step.growth * w * p;
      if (step.cause) {
        const row = misses[CAUSES.indexOf(step.cause)];
        row.n += 1;
        row.tokens += step.miss;
        row.usd += step.miss * (w - WEIGHT.cacheRead) * p;
      }
    }
  }
  out.missShare = out.writeTokens > 0 ? misses.reduce((s, m) => s + m.tokens, 0) / out.writeTokens : 0;
  return out;
}

// ---- B4: what a fold or a cold resume costs over reading the same tokens ----

/** `events` of one kind and their premium API-eq $ (misses in the event's window × (write − read price)); `baselineUsd` and `netUsd` = premium − baseline. */
export type FoldPremium = { events: number; premiumUsd: number; baselineUsd: number; netUsd: number };
export type EventKind = "fold" | "coldResume";
const N_AFTER = 3; // requests an event is charged with: its own and the next two

/**
 * Per event kind over the session branches: a **cold resume** is a turn request after a gap beyond the TTL in force (\`ttlMs\` of the
 * previous request, warming included); a **fold** is a turn request after which \`eventBetween(previous, this)\` holds (not itself cold: P8,
 * the gap wins). An event's window is its request and the next two turn requests of the branch, cut short by the next event: every request
 * is in at most one window. premium_e = Σ over the window of miss_j × (w_j − r) × p_j (the line's write weight w, read weight r, input
 * price p): the extra cost over reading the tokens the cache lost.
 */
export function foldPremiums(branches: Iterable<readonly any[]>, ttlMs: (l: any) => number, eventBetween: (a: any, b: any) => boolean, flags: Flags = {}): Record<EventKind, FoldPremium> {
  const out: Record<EventKind, FoldPremium> = { fold: { events: 0, premiumUsd: 0, baselineUsd: 0, netUsd: 0 }, coldResume: { events: 0, premiumUsd: 0, baselineUsd: 0, netUsd: 0 } };
  for (const branch of branches) {
    const steps = cacheSteps(branch, ttlMs, eventBetween);
    const premium = steps.map((s) => {
      const l = branch[s.i];
      const long = cacheWrite1hOf(l, l.parentSessionId === undefined, flags[l.arm]);
      return s.miss * (writeWeight(l, long) - WEIGHT.cacheRead) * pIn(l, long);
    });
    const events: Array<{ at: number; kind: EventKind }> = [];
    steps.forEach((s, k) => {
      if (s.i === 0) return;
      const prev = branch[s.i - 1], l = branch[s.i];
      if (Date.parse(l.ts) - Date.parse(prev.ts) > ttlMs(prev)) events.push({ at: k, kind: "coldResume" });
      else if (eventBetween(prev, l)) events.push({ at: k, kind: "fold" });
    });
    events.forEach((e, n) => {
      const end = Math.min(e.at + N_AFTER, events[n + 1]?.at ?? Infinity, steps.length);
      out[e.kind].events += 1;
      for (let k = e.at; k < end; k++) out[e.kind].premiumUsd += premium[k];
    });
  }
  for (const e of Object.values(out)) e.netUsd = e.premiumUsd - e.baselineUsd;
  return out;
}
