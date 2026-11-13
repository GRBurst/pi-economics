// The Budget section's data (design §6.1, §9.2, redesign M4): quota windows of a subscription provider from the meter lines — peak, lockout, time
// to cap, the window's API-eq $ by token component, 429 requests and retry wait. The calibration (calibration.ts) fits them. Pure.
import { billingOf, plansAbsent, type Billing, type Plans, type Rate } from "../plans.ts";
import { calibrate, type Fit } from "./calibration.ts";
import { isError, isLine } from "./logs.ts";
import { allocate, apiUsd, cacheWrite1hOf } from "./units.ts";

/** The calibration's token components: a 1 h and a 5-minute cache write are one component, as the quota does not tell them apart. */
export type Component = "input" | "cacheRead" | "cacheWrite" | "output";
export type Window = {
  provider: string; kind: "5h" | "7d"; /** ISO reset of the window; its start is the reset less 5 h or 7 d. */ reset: string; start: string;
  /** The window is over (a later line exists) and the log reaches back to its start: its peak and $ cover all of it. */ complete: boolean;
  /** Highest quota reading (whole percent) of the window. */ peak: number;
  /** Time until the reset once the cap was hit (0 when it never was). */ lockoutMs: number;
  /** From the window's start to the cap; absent when it was not hit. */ timeToCapMs?: number;
  /** API-eq $ of every line of the provider (all sessions, children and warming included) in [start, reset). */ usd: Record<Component, number>;
  /** Successful non-warming requests in the window. */ requests: number;
  /** Error lines that are rate limits: v1 `errorClass` "429", v2 `errorKind` "rate_limit". */ r429: number;
  /** Σ `retries` and Σ `retryWaitMs` of the window's lines (v1: pi-retry's, v2: pi's native ones); absent when no line carries the field: not observable, never 0. */
  retries?: number; retryWaitMs?: number;
};

const HOUR = 3_600_000;
const LENGTH = { "5h": 5 * HOUR, "7d": 7 * 24 * HOUR } as const;
/** A reading at or above this, followed by a rate limit, is a window that hit its cap: the quota is whole percent and 99 is the last step below 100 the headers show. */
const NEAR_CAP = 99;

const isRateLimit = (l: any): boolean => isError(l) && (l.errorKind === "rate_limit" || String(l.errorClass) === "429");
const reading = (l: any, key: "q5h" | "q7d"): { q: number; reset: string } | undefined => {
  const q = l[key], reset = l[`${key}Reset`];
  return typeof q === "number" && Number.isFinite(q) && typeof reset === "string" && !Number.isNaN(Date.parse(reset)) ? { q, reset } : undefined;
};
/** Index of the first line of the sorted `ms` at or after `t`. */
const lowerBound = (ms: readonly number[], t: number): number => {
  let lo = 0, hi = ms.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ms[mid] < t) lo = mid + 1; else hi = mid; }
  return lo;
};

/**
 * One window per (provider, kind, reset) that some line has a reading for (`q5h`/`q5hReset`, `q7d`/`q7dReset`), ordered by reset. `plans` decide
 * which: a provider with a plan has windows only when it is a subscription, of the kinds its plan lists; a provider without one has whatever its
 * lines carry. The cap was hit at the first reading of 100, else at the first rate-limit error after a reading of 99.
 *
 * A rate limit and a retry belong to the limit that was capped: the one whose highest reading of the current window (not yet reset) is at 99 or more at that
 * line (both when both are; the 5-hour one when neither is, a short limit that is no cap). So a 7-day lockout is not counted in 5-hour windows.
 * Linear in the lines: each line is visited once per pass and by at most the windows that contain it.
 */
export function windowsOf(lines: readonly any[], plans: Plans): Window[] {
  const stamped = lines.filter((l) => isLine(l) && typeof l.provider === "string").map((l) => ({ l, t: Date.parse(l.ts) })).sort((a, b) => a.t - b.t); // Date.parse once per line: a sort over a long log parses n log n times otherwise
  if (!stamped.length) return [];
  const first = stamped[0].t, last = stamped.at(-1)!.t;
  const byProvider = new Map<string, Array<{ l: any; t: number }>>();
  for (const x of stamped) { const xs = byProvider.get(x.l.provider); if (xs) xs.push(x); else byProvider.set(x.l.provider, [x]); }
  const out: Window[] = [];
  for (const [provider, xs] of byProvider) {
    const plan = Object.hasOwn(plans, provider) ? plans[provider] : undefined;
    const kinds = (["5h", "7d"] as const).filter((k) => (plan ? plan.billing === "subscription" && plan.windows.includes(k) : true));
    const ts = xs.map((x) => x.t), ls = xs.map((x) => x.l);
    // one pass: each line's readings and the limits that are capped when it is written (bit 1: 5h, bit 2: 7d)
    const r5 = ls.map((l) => reading(l, "q5h")), r7 = ls.map((l) => reading(l, "q7d")), capped = new Array<number>(ls.length).fill(1);
    let s5: { q: number; end: number } | undefined, s7: { q: number; end: number } | undefined;
    ls.forEach((_, i) => {
      // a window's quota only rises: a stale lower reading of a parallel session (same reset) does not undo the maximum seen
      if (r5[i]) { const end = Date.parse(r5[i]!.reset); s5 = { q: s5 && s5.end === end ? Math.max(s5.q, r5[i]!.q) : r5[i]!.q, end }; }
      if (r7[i]) { const end = Date.parse(r7[i]!.reset); s7 = { q: s7 && s7.end === end ? Math.max(s7.q, r7[i]!.q) : r7[i]!.q, end }; }
      const m = (s5 && s5.q >= NEAR_CAP && s5.end > ts[i] ? 1 : 0) | (s7 && s7.q >= NEAR_CAP && s7.end > ts[i] ? 2 : 0);
      capped[i] = m || 1;
    });
    for (const kind of kinds) {
      const rs = kind === "5h" ? r5 : r7, bit = kind === "5h" ? 1 : 2;
      const resets = new Map<string, number[]>();
      rs.forEach((r, i) => { if (r) { const v = resets.get(r.reset); if (v) v.push(i); else resets.set(r.reset, [i]); } });
      for (const [reset, readings] of resets) {
        const end = Date.parse(reset), start = end - LENGTH[kind];
        const lo = lowerBound(ts, start), hi = lowerBound(ts, end);
        const usd: Record<Component, number> = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
        let requests = 0, r429 = 0, retries: number | undefined, wait: number | undefined;
        for (let i = lo; i < hi; i++) {
          const l = ls[i];
          const a = allocate(l, cacheWrite1hOf(l, l.parentSessionId === undefined));
          usd.input += a.input; usd.cacheRead += a.cacheRead; usd.cacheWrite += a.cacheWrite5m + a.cacheWrite1h; usd.output += a.output;
          if (l.kind !== "warming" && !isError(l)) requests += 1;
          if (isRateLimit(l) && capped[i] & bit) r429 += 1;
          // observable when any line of the window carries the field; summed over the lines of the capped limit
          const own = capped[i] & bit;
          if (typeof l.retries === "number" && Number.isFinite(l.retries)) retries = (retries ?? 0) + (own ? l.retries : 0);
          if (typeof l.retryWaitMs === "number" && Number.isFinite(l.retryWaitMs)) wait = (wait ?? 0) + (own ? l.retryWaitMs : 0);
        }
        let peak = -Infinity, near = -1, cap = -1; // not Math.max(...): a window of 100k readings overflows the stack
        for (const i of readings) {
          const q = rs[i]!.q;
          if (q > peak) peak = q;
          if (near < 0 && q >= NEAR_CAP) near = i;
          if (cap < 0 && q >= 100) cap = i;
        }
        if (cap < 0 && near >= 0) for (let i = Math.max(lo, near + 1); i < hi; i++) if (isRateLimit(ls[i]) && capped[i] & bit && ts[i] > ts[near]) { cap = i; break; }
        const w: Window = { provider, kind, reset, start: new Date(start).toISOString(), complete: end <= last && first <= start, peak,
          lockoutMs: cap >= 0 ? Math.max(0, end - ts[cap]) : 0, usd, requests, r429 };
        if (cap >= 0) w.timeToCapMs = Math.max(0, ts[cap] - start);
        if (retries !== undefined) w.retries = retries;
        if (wait !== undefined) w.retryWaitMs = wait;
        out.push(w);
      }
    }
  }
  return out.sort((a, b) => Date.parse(a.reset) - Date.parse(b.reset) || (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0) || (a.kind < b.kind ? -1 : 1));
}

// ---- the Budget section ----

export type SpendRow = { billing: Billing; /** Some line of the class had none of its own and no plan for its provider: its class was guessed (api), so cash $ is an upper bound. */ guessed: boolean; requests: number; /** API-eq $: the list price of the tokens, whoever pays. */ apiUsd: number; /** What is actually charged: the API-eq $ for `api`, 0 for the other classes. */ cashUsd: number };
export type LocalRow = { provider: string; requests: number; /** Requests with / without `durationMs` (the untimed ones add no time). */ timed: number; untimed: number; hours: number;
  rate?: Rate; /** hours × rate.amount in rate.currency; absent without a rate: never 0. */ cost?: number };
export type BudgetSection = { /** The last line's ts: the calibration's "now" (reproducible: the clock is not read). */ now?: string; plansAbsent: boolean;
  groups: Array<{ provider: string; kind: "5h" | "7d"; windows: Window[]; fit: Fit }>; spend: SpendRow[]; local: LocalRow[] };

const BILLINGS: readonly Billing[] = ["subscription", "api", "free", "local"];
const isBilling = (b: unknown): b is Billing => BILLINGS.includes(b as Billing);
/** A line's billing class: its own `billing` (meter v2) when valid, else its provider's in `plans` (api without a plan). */
export const billingOfLine = (l: any, plans: Plans): Billing => (isBilling(l.billing) ? l.billing : billingOf(plans, String(l.provider)));
/** The class of a line was told (its own `billing`, or its provider's plan) rather than guessed. */
export const billingTold = (l: any, plans: Plans): boolean => isBilling(l.billing) || Object.hasOwn(plans, String(l.provider));
const MS_H = 3_600_000;

/**
 * Quota windows with their calibration per provider and kind, spend by billing class and local cost. A line's class is its own `billing` (meter
 * v2), else its provider's in `plans`, else `api`. No usable plan entry (plansAbsent: undefined, {} …) is said, and the classes of v1 lines are guesses.
 */
export function budget(meter: readonly any[], plans: Plans | undefined): BudgetSection {
  const known = plans ?? {};
  const lines = meter.filter((l) => isLine(l) && typeof l.provider === "string");
  const now = lines.reduce<string | undefined>((m, l) => (m === undefined || Date.parse(l.ts) > Date.parse(m) ? l.ts : m), undefined);
  const windows = windowsOf(lines, known);
  const groups = new Map<string, Window[]>();
  for (const w of windows) { const k = `${w.provider}\u0000${w.kind}`; const xs = groups.get(k); if (xs) xs.push(w); else groups.set(k, [w]); }
  const spend = new Map<Billing, SpendRow>(), local = new Map<string, LocalRow>();
  for (const l of meter.filter(isLine)) { // every line, as Fleet counts them (a line without provider is billed as api)
    const billing = billingOfLine(l, known);
    const usd = apiUsd(l);
    const row = spend.get(billing) ?? spend.set(billing, { billing, guessed: false, requests: 0, apiUsd: 0, cashUsd: 0 }).get(billing)!;
    if (!billingTold(l, known)) row.guessed = true;
    row.apiUsd += usd;
    if (billing === "api") row.cashUsd += usd;
    if (l.kind === "warming" || isError(l)) continue;
    row.requests += 1;
    if (billing !== "local") continue;
    const plan = Object.hasOwn(known, l.provider) ? known[l.provider] : undefined;
    const lr = local.get(l.provider) ?? local.set(l.provider, { provider: l.provider, requests: 0, timed: 0, untimed: 0, hours: 0, ...(plan?.rate ? { rate: plan.rate } : {}) }).get(l.provider)!;
    lr.requests += 1;
    if (typeof l.durationMs === "number" && Number.isFinite(l.durationMs) && l.durationMs >= 0) { lr.timed += 1; lr.hours += l.durationMs / MS_H; } else lr.untimed += 1;
  }
  for (const lr of local.values()) if (lr.rate) lr.cost = lr.hours * lr.rate.amount;
  return { ...(now ? { now } : {}), plansAbsent: plansAbsent(plans),
    groups: [...groups.values()].map((ws) => ({ provider: ws[0].provider, kind: ws[0].kind, windows: ws, fit: calibrate(ws, now ?? ws[0].reset) })),
    spend: BILLINGS.flatMap((b) => spend.get(b) ?? []), local: [...local.values()] };
}
