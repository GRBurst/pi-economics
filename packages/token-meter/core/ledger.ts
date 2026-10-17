// Fold ledger of pi-analyse (plan T13.11): what each detected fold earned or cost in cache dollars. Pure.
//
// A fold shrinks the prompt by R tokens. Every later request that reads the cache then reads R tokens less (saves R·r each);
// the first request after the fold writes ≈ K more tokens than a typical turn (the cache is rebuilt from the fold point on),
// and those K tokens cost the write price w instead of the read price r they would have cost without the fold.
//   net = n·R·r − K·(w − r)        (savings − rewrite, exactly)
// Pure bookkeeping on the meter lines: nothing here asserts that the fold was the cause of anything else.

const MIN = 60_000;
const FOLD_SHRINK = 0.8; // same rule as arms.ts: a turn whose prompt fell below this share of the previous turn's is a fold
/** Relative prices (Anthropic): read 0.1, 5-minute write 1.25, output 5 × input (the weights analyse.ts splits costs with). */
const WEIGHT = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 } as const;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const prompt = (l: any): number => num(l.input) + num(l.cacheRead) + num(l.cacheWrite);
const t = (l: any): number => Date.parse(l.ts);
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const isClaude = (l: any): boolean => /claude/i.test(String(l.model)) || l.provider === "anthropic";

/** Per-token prices of a model: `w` (cache write) and `r` (cache read), $. */
export type Price = { r: number; w: number };

/**
 * Per model: input price p = Σ costUsd ÷ Σ (input + 0.1·cacheRead + 1.25·cacheWrite + 5·output) over its lines with a cost and tokens
 * (the line's own cost and token fields; no price table), then r = 0.1·p and w = 1.25·p. A model without such a line has no price.
 * 1 h writes cost 2·p on Anthropic's list but pi's cost field uses the 1.25 table, which this follows.
 */
export function prices(lines: any[]): Map<string, Price> {
  const acc = new Map<string, { usd: number; weighted: number }>();
  for (const l of lines) {
    const usd = num(l.costUsd);
    const weighted = (Object.keys(WEIGHT) as Array<keyof typeof WEIGHT>).reduce((s, k) => s + WEIGHT[k] * num(l[k]), 0);
    if (usd <= 0 || weighted <= 0) continue;
    const a = acc.get(String(l.model)) ?? acc.set(String(l.model), { usd: 0, weighted: 0 }).get(String(l.model))!;
    a.usd += usd;
    a.weighted += weighted;
  }
  return new Map([...acc].map(([m, a]) => [m, { r: (WEIGHT.cacheRead * a.usd) / a.weighted, w: (WEIGHT.cacheWrite * a.usd) / a.weighted }]));
}

export type FoldEntry = {
  sessionId: string; /** The session's root: its parentSessionId, else itself. */ root: string; arm: string; model: string; ts: string;
  /** Prompt tokens removed. */ R: number;
  /** Extra tokens written by the first request after the fold (0 for a fold that follows a cold gap: the rewrite was due anyway). */ K: number;
  /** Warm requests that read the shrunken prompt: until the session ends or the next cold gap. */ n: number;
  /** The fold request came after a cold gap (cache already expired). */ cold: boolean;
  /** n·R·r, $. */ savings: number;
  /** K·(w − r), $. */ rewrite: number;
  /** savings − rewrite, $. */ net: number;
};

export type LedgerOpts = {
  /** arm id → factor values; `mainCacheTtl: "1h"` gives a main session the 60 min TTL, else 5 min. */
  flags?: Record<string, Record<string, string>>;
};

/** The entry of a fold with these numbers (the one formula; savings − rewrite is the net by construction). */
export function value(R: number, K: number, n: number, p: Price): Pick<FoldEntry, "savings" | "rewrite" | "net"> {
  const savings = n * R * p.r;
  const rewrite = K * (p.w - p.r);
  return { savings, rewrite, net: savings - rewrite };
}

/**
 * Every fold of the Claude sessions in `lines`. Detection as in arms.ts: a non-warming request whose prompt (input + cacheRead +
 * cacheWrite) is below 80 % of the previous non-warming request's. K = its cacheWrite minus the session's typical write (median of
 * the cacheWrite of its non-first, non-fold, non-cold turns; 0 if it has none), floored at 0. A fold after a cold gap (≥ TTL since
 * the previous request, warming included) has K = 0. n = requests (warming included: they read the prompt too) after the fold
 * until the first gap ≥ TTL or the end of the session. Folds of models without a price are left out.
 */
export function foldLedger(all: any[], opt: LedgerOpts = {}): FoldEntry[] {
  const lines = all.filter((l) => l && typeof l.ts === "string" && !Number.isNaN(t(l)) && typeof l.sessionId === "string" && isClaude(l)).sort((a, b) => t(a) - t(b));
  const price = prices(lines);
  const sessions = new Map<string, any[]>();
  for (const l of lines) if (prompt(l) > 0) sessions.set(l.sessionId, [...(sessions.get(l.sessionId) ?? []), l]);
  const out: FoldEntry[] = [];
  for (const [sessionId, reqs] of sessions) {
    const arm = typeof reqs[0].arm === "string" ? reqs[0].arm : "";
    const ttl = (reqs[0].parentSessionId === undefined && opt.flags?.[arm]?.mainCacheTtl === "1h" ? 60 : 5) * MIN;
    const cold = (i: number): boolean => i > 0 && t(reqs[i]) - t(reqs[i - 1]) >= ttl;
    const turns = reqs.map((l, i) => i).filter((i) => reqs[i].kind !== "warming");
    const folds = turns.filter((i, j) => j > 0 && prompt(reqs[i]) < FOLD_SHRINK * prompt(reqs[turns[j - 1]]));
    const isFold = new Set(folds);
    const typical = median(turns.slice(1).filter((i) => !isFold.has(i) && !cold(i)).map((i) => num(reqs[i].cacheWrite)));
    for (const i of folds) {
      const l = reqs[i];
      const p = price.get(String(l.model));
      if (!p) continue;
      const prev = reqs[turns[turns.indexOf(i) - 1]];
      const R = prompt(prev) - prompt(l);
      const wasCold = cold(i);
      const K = wasCold ? 0 : Math.max(0, num(l.cacheWrite) - typical);
      let n = 0;
      for (let j = i + 1; j < reqs.length && !cold(j); j++) n += 1;
      out.push({ sessionId, root: reqs[0].parentSessionId ?? sessionId, arm, model: String(l.model), ts: l.ts, R, K, n, cold: wasCold, ...value(R, K, n, p) });
    }
  }
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

// ---- summary -----------------------------------------------------------------------------------

/** K/R bucket upper bounds (exclusive); the last bucket is open. Break-even is K/R = n·r/(w − r) ≈ n/11.5. */
export const DEPTH_BUCKETS = [0.25, 0.5, 1, 2] as const;
export const bucketOf = (depth: number): string => {
  const hi = DEPTH_BUCKETS.find((b) => depth < b);
  if (hi === undefined) return `≥ ${DEPTH_BUCKETS.at(-1)}`;
  const lo = DEPTH_BUCKETS[DEPTH_BUCKETS.indexOf(hi) - 1];
  return lo === undefined ? `< ${hi}` : `${lo} – ${hi}`;
};
export const BUCKET_NAMES: string[] = [...DEPTH_BUCKETS.map((hi) => bucketOf(hi - 1e-9)), bucketOf(Infinity)];

export type LedgerRow = { name: string; n: number; netUsd: number; savingsUsd: number; rewriteUsd: number; negative: number; negativeShare: number };
export type LedgerSection = { n: number; cold: number } & Omit<LedgerRow, "name" | "n"> & {
  byDepth: LedgerRow[]; byGroup: LedgerRow[]; byModel: LedgerRow[] };

const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
function row(name: string, es: FoldEntry[]): LedgerRow {
  const negative = es.filter((e) => e.net < 0).length;
  return { name, n: es.length, netUsd: sum(es.map((e) => e.net)), savingsUsd: sum(es.map((e) => e.savings)), rewriteUsd: sum(es.map((e) => e.rewrite)), negative, negativeShare: es.length ? negative / es.length : NaN };
}
const groups = (es: FoldEntry[], key: (e: FoldEntry) => string): LedgerRow[] => {
  const m = new Map<string, FoldEntry[]>();
  for (const e of es) m.set(key(e), [...(m.get(key(e)) ?? []), e]);
  return [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => row(k, v));
};

/** `group` names an entry's arm group (design + foldHint level); K/R of a fold with R = 0 cannot occur (a fold removes tokens). */
export function summarise(entries: FoldEntry[], group: (e: FoldEntry) => string): LedgerSection {
  const { name: _n, n: _c, ...total } = row("", entries);
  const depth = groups(entries, (e) => bucketOf(e.K / e.R));
  return {
    n: entries.length, cold: entries.filter((e) => e.cold).length, ...total,
    byDepth: BUCKET_NAMES.map((name) => depth.find((d) => d.name === name) ?? row(name, [])),
    byGroup: groups(entries, group), byModel: groups(entries, (e) => e.model),
  };
}
