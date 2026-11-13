// (a) cache: what a request wrote because the context grew and what it had to rewrite because the cache lost the prefix (redesign M2a, B3).
import { byTs, FOLD_SHRINK, isError, isLine, num, push } from "./logs.ts";
import { cacheWrite1hOf, isClaude, pIn, writeWeight } from "./units.ts";
import { weightsOf } from "./prices.ts";

type Flags = Record<string, Record<string, string>>;

export type MissCause = "ttl" | "fold" | "model" | "prefix" | "other";
/** One request of a session branch: `growth` = tokens written because the context grew (new context), `miss` = tokens of the cached prefix it had to process again. */
export type CacheStep = { sessionId: string; i: number; growth: number; miss: number; cause?: MissCause };

/** Tokens in the cache after a request: what it read plus what it wrote (its uncached `input` tail is after the last cache breakpoint). */
const cached = (l: any): number => num(l.cacheRead) + num(l.cacheWrite);
const prompt = (l: any): number => num(l.input) + cached(l);

/** A fold between two consecutive requests as the meter lines show it (arms.ts, ledger.ts): the prompt fell below 80% of the previous one's. */
export const shrinkFold = (a: any, b: any): boolean => prompt(b) < FOLD_SHRINK * prompt(a);

/** When a request was sent (it reads the cached prefix then): ts − durationMs (meter v2); a line without durationMs at its ts. */
const sentAt = (l: any): number => Date.parse(l.ts) - (typeof l.durationMs === "number" && l.durationMs > 0 ? l.durationMs : 0);

/**
 * Per request of a branch, how long the cache sat idle before it (plan D7): its send time − the latest send before it (a warm sent while
 * a turn streamed touched the cache after that turn's send); NaN for the first. Response time does not age a prefix: a long response
 * is no gap, a long previous one is. For v1 lines (no durationMs) the gap between consecutive ts.
 */
export function idleMs(branch: readonly any[]): number[] {
  let last = -Infinity;
  return branch.map((l, i) => {
    const t = sentAt(l), idle = i === 0 ? NaN : t - last;
    last = Math.max(last, t);
    return idle;
  });
}

/**
 * The steps of one session branch: its request lines (kind turn or warming, no error lines) in ts order. Only turn lines are outcomes
 * (a warming request refreshes the prefix, it is no step of its own), but every line is the "previous request" of the next one.
 * Request i (position in `branch`): cached_i = cacheRead_i + cacheWrite_i, prompt_i = input_i + cached_i;
 *   growth_i = min(cacheWrite_i, max(0, cached_i − cached_{i−1}))      the context that was added (i = 0: all of cacheWrite_0)
 *   miss_i   = max(0, min(cached_{i−1}, prompt_i) − cacheRead_i)       prefix the previous request left in the cache and this one did not read (i = 0: 0)
 * so cacheWrite_i = growth_i + the rewrite (≈ miss_i). The previous request's uncached input tail is not part of the cache, so it is no miss.
 * A miss has a cause, the first that holds (P8: a gap beyond the TTL loses the prefix whatever else happened): `ttl` when the idle time
 * before the request (idleMs: send to send) outlived the TTL in force after the previous request (`ttlMs(previous)`; a warming request is a previous request: it refreshed the prefix),
 * `fold` when `eventBetween(previous, this)` (a fold or compaction), `model` when the model changed, `prefix` when the request's
 * `systemHash` (meter v2, M3b) differs from the last one the branch showed before it (the system prompt, a section or the tool list
 * changed), else `other`: a prefix change inside the TTL that the lines do not show (a small fold or mask, an injected agent message,
 * a system change on lines without a hash).
 */
export function cacheSteps(branch: readonly any[], ttlMs: (l: any) => number, eventBetween: (a: any, b: any) => boolean): CacheStep[] {
  const steps: CacheStep[] = [];
  let known: string | undefined; // the last systemHash before request i
  const idle = idleMs(branch);
  branch.forEach((l, i) => {
    const before = known;
    if (typeof l.systemHash === "string") known = l.systemHash;
    if (l.kind === "warming") return;
    const sessionId = String(l.sessionId);
    if (i === 0) { steps.push({ sessionId, i, growth: num(l.cacheWrite), miss: 0 }); return; }
    const prev = branch[i - 1];
    const growth = Math.min(num(l.cacheWrite), Math.max(0, cached(l) - cached(prev)));
    const miss = Math.max(0, Math.min(cached(prev), prompt(l)) - num(l.cacheRead));
    const step: CacheStep = { sessionId, i, growth, miss };
    if (miss > 0) step.cause = idle[i] > ttlMs(prev) ? "ttl" : eventBetween(prev, l) ? "fold" : l.model !== prev.model ? "model"
      : before !== undefined && typeof l.systemHash === "string" && l.systemHash !== before ? "prefix" : "other";
    steps.push(step);
  });
  return steps;
}

/** A line's prices in input prices: its input price p, and the weight w of a token it wrote (1.25, 2.0 for 1 h writes: cacheWrite1hOf). */
function pricing(l: any, flags: Flags): { p: number; w: number } {
  const long = cacheWrite1hOf(l, l.parentSessionId === undefined, flags[l.arm]);
  return { p: pIn(l, long), w: writeWeight(l, long) };
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

/** A premium as the two prices it is the difference of: the $ the missed tokens cost to write (tokens × w × p) and the $ they would have cost to read (tokens × r × p); premium = write − read. M4: a calibrated β prices each in quota points. */
export type Parts = { write: number; read: number };
export type CauseRow = { cause: MissCause; n: number; tokens: number; usd: number; parts: Parts };
export type CacheSection = {
  /** Claude turn requests in the branches, and the branches. */ requests: number; branches: number;
  /** Their cacheWrite tokens. */ writeTokens: number;
  /** Growth writes: tokens and $ at the write price. */ newContext: { tokens: number; usd: number };
  /** Misses by cause, in the order ttl, fold, model, prefix, other: requests, missed tokens, premium API-eq $ = tokens × (write − read price). */ misses: CauseRow[];
  /** Missed tokens ÷ cacheWrite tokens (0 without writes). */ missShare: number;
  /** Folds and cold resumes: premium over the baseline (foldPremiums). */ events: Record<EventKind, FoldPremium>;
};
const CAUSES: MissCause[] = ["ttl", "fold", "model", "prefix", "other"];

/**
 * The Cache section: cacheSteps (fold = shrinkFold) over every branch of `lines`, summed. $ is at each line's input price p (pIn): a write
 * costs 1.25 p (2.0 p for 1 h writes, cacheWrite1hOf), a read the model's read ratio × p (0.1 by default, 0.05 for Opus 5.5 and Sonnet 5.5: prices.ts); a miss costs the premium of writing over reading.
 */
export function cacheSection(lines: readonly any[], flags: Flags = {}): CacheSection {
  const ttl = ttlMsOf(flags);
  const misses = CAUSES.map((cause): CauseRow => ({ cause, n: 0, tokens: 0, usd: 0, parts: { write: 0, read: 0 } }));
  const branches = branchesOf(lines);
  const out: CacheSection = { requests: 0, branches: 0, writeTokens: 0, newContext: { tokens: 0, usd: 0 }, misses, missShare: 0, events: foldPremiums(branches.values(), ttl, shrinkFold, flags) };
  for (const branch of branches.values()) {
    out.branches += 1;
    for (const step of cacheSteps(branch, ttl, shrinkFold)) {
      const l = branch[step.i];
      const { p, w } = pricing(l, flags);
      out.requests += 1;
      out.writeTokens += num(l.cacheWrite);
      out.newContext.tokens += step.growth;
      out.newContext.usd += step.growth * w * p;
      if (step.cause) {
        const row = misses[CAUSES.indexOf(step.cause)];
        row.n += 1;
        row.tokens += step.miss;
        const r = weightsOf(l.model, l.provider).cacheRead;
        row.usd += step.miss * (w - r) * p;
        row.parts.write += step.miss * w * p;
        row.parts.read += step.miss * r * p;
      }
    }
  }
  out.missShare = out.writeTokens > 0 ? misses.reduce((s, m) => s + m.tokens, 0) / out.writeTokens : 0;
  return out;
}

// ---- B4: what a fold or a cold resume costs over reading the same tokens ----

/** `events` of one kind and their premium API-eq $ (misses in the event's window × (write − read price)); `baselineUsd` and `netUsd` = premium − baseline. */
export type FoldPremium = { events: number; premiumUsd: number; baselineUsd: number; netUsd: number; premiumParts: Parts; baselineParts: Parts };
const noParts = (): Parts => ({ write: 0, read: 0 });
export const newPremium = (): FoldPremium => ({ events: 0, premiumUsd: 0, baselineUsd: 0, netUsd: 0, premiumParts: noParts(), baselineParts: noParts() });
export type EventKind = "fold" | "coldResume";
const N_AFTER = 3; // requests an event is charged with: its own and the next two

/**
 * Per event kind over the session branches: a **cold resume** is a turn request after an idle time (idleMs) beyond the TTL in force (`ttlMs` of the
 * previous request, warming included); a **fold** is a turn request after which `eventBetween(previous, this)` holds (not itself cold: P8,
 * the gap wins). An event's window is its request and the next two turn requests of the branch, cut short by the next event: every request
 * is in at most one window. premium_e = Σ over the window of miss_j × (w_j − r) × p_j (the line's write weight w, read weight r, input
 * price p): the extra cost over reading the tokens the cache lost. The baseline is what an ordinary request costs the same way: the mean
 * premium of the turn requests outside every window (not the first) of the sessions that have an event of that kind; each event is
 * charged one request's worth of it (net = Σ premium_e − events × baseline, the design's B4).
 */
export function foldPremiums(branches: Iterable<readonly any[]>, ttlMs: (l: any) => number, eventBetween: (a: any, b: any) => boolean, flags: Flags = {}): Record<EventKind, FoldPremium> {
  const out: Record<EventKind, FoldPremium> = { fold: newPremium(), coldResume: newPremium() };
  const pool: Record<EventKind, { parts: Parts; n: number }> = { fold: { parts: noParts(), n: 0 }, coldResume: { parts: noParts(), n: 0 } };
  for (const branch of branches) {
    const steps = cacheSteps(branch, ttlMs, eventBetween);
    const premium = steps.map((s): Parts => {
      const { p, w } = pricing(branch[s.i], flags);
      return { write: s.miss * w * p, read: s.miss * weightsOf(branch[s.i].model, branch[s.i].provider).cacheRead * p };
    });
    const events: Array<{ at: number; kind: EventKind }> = [];
    const idle = idleMs(branch);
    steps.forEach((s, k) => {
      if (s.i === 0) return;
      const prev = branch[s.i - 1], l = branch[s.i];
      if (idle[s.i] > ttlMs(prev)) events.push({ at: k, kind: "coldResume" });
      else if (eventBetween(prev, l)) events.push({ at: k, kind: "fold" });
    });
    const inWindow = new Array<boolean>(steps.length).fill(false);
    events.forEach((e, n) => {
      const end = Math.min(e.at + N_AFTER, events[n + 1]?.at ?? Infinity, steps.length);
      out[e.kind].events += 1;
      for (let k = e.at; k < end; k++) { out[e.kind].premiumParts.write += premium[k].write; out[e.kind].premiumParts.read += premium[k].read; inWindow[k] = true; }
    });
    const rest = noParts();
    let n = 0;
    steps.forEach((s, k) => { if (s.i > 0 && !inWindow[k]) { rest.write += premium[k].write; rest.read += premium[k].read; n += 1; } });
    for (const kind of new Set(events.map((e) => e.kind))) { pool[kind].parts.write += rest.write; pool[kind].parts.read += rest.read; pool[kind].n += n; }
  }
  for (const kind of ["fold", "coldResume"] as const) {
    const e = out[kind], each = pool[kind].n ? e.events / pool[kind].n : 0;
    e.premiumUsd = e.premiumParts.write - e.premiumParts.read;
    e.baselineParts = { write: each * pool[kind].parts.write, read: each * pool[kind].parts.read };
    e.baselineUsd = e.baselineParts.write - e.baselineParts.read;
    e.netUsd = e.premiumUsd - e.baselineUsd;
  }
  return out;
}

/**
 * The events of every arm (arm = the first line's of a session branch): foldPremiums over the arm's branches. The per-arm fold and cold-resume
 * columns of arms.ts (B4: the premium of the cache a fold or a cold resume lost, not the cost of the requests after it).
 */
export function armEvents(lines: readonly any[], flags: Flags = {}): Map<string, Record<EventKind, FoldPremium>> {
  const byArm = new Map<string, any[][]>();
  for (const branch of branchesOf(lines).values()) push(byArm, String(branch[0].arm ?? ""), branch);
  const ttl = ttlMsOf(flags);
  return new Map([...byArm].map(([arm, branches]) => [arm, foldPremiums(branches, ttl, shrinkFold, flags)]));
}
