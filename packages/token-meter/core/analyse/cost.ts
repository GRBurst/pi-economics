// (a) cost: $, requests, active hours, quota per active hour, splits by model, cache rewrite, warming, folds and cold resumes.
import { armStats, attributeQuota, isError, MIN_HOURS, push, rootUnits } from "../arms.ts";
import { type LedgerSection } from "../ledger.ts";
import { taskCosts, type TaskCost } from "../tasks.ts";
import { bootstrapRatioCI, type CI } from "../stats.ts";
import { byTs, isLine, num, sum } from "./logs.ts";
import { allocate, type Component } from "./units.ts";
import { foldsOf } from "./folds.ts";

export type Split = { name: string; n: number; usd: number; share: number; perHour: number };
export type CostSection = { totalUsd: number; requests: number; errors: number; warming: number; units: number; activeHours: number;
  usdPerHour: CI; q5hPerHour: number; q7dPerHour: number; perAccepted: TaskCost;
  byModel: Array<{ model: string; requests: number; usd: number; share: number; perHour: number }>;
  splits: Split[]; components: Record<Component, number>; folds: LedgerSection };

/**
 * Quota points pi used and all points seen, per window (`<key>Reset`): pi = the global rise attributed to roots (arms.ts attributeQuota:
 * rises of the window's running maximum between non-warming requests less than 30 min apart); all = max − min of the window, warming
 * readings included.
 */
export function quotaShare(meter: any[], key: "q5h" | "q7d"): { pi: number; total: number; share: number } {
  const windows = new Map<unknown, number[]>();
  for (const l of meter) if (typeof l[key] === "number") push(windows, l[`${key}Reset`], l[key]);
  const spread = (v: number[]): number => { let lo = Infinity, hi = -Infinity; for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; } return hi - lo; }; // not Math.max(...v): a spread overflows the stack on a long window
  const total = sum([...windows.values()].map(spread));
  const pi = attributeQuota(meter, key).total;
  return { pi, total, share: total ? pi / total : NaN };
}

export function cost(meter: any[], outcomes: any[], flags: Record<string, Record<string, string>>, rows: Map<string, any>): CostSection {
  const lines = meter.filter((l) => isLine(l) && typeof l.sessionId === "string").sort(byTs);
  const units = rootUnits(lines);
  const activeHours = sum(units.map((u) => u.hours));
  const totalUsd = sum(lines.map((l) => num(l.costUsd)));
  const perHour = (usd: number) => (activeHours ? usd / activeHours : NaN);
  // The CI resamples units of ≥ MIN_HOURS only: a few-second root ($0 orphan child lines) would otherwise draw $/h ≈ 0.
  const timed = units.filter((u) => u.hours >= MIN_HOURS);
  const usdPerHour = activeHours && timed.length ? bootstrapRatioCI(timed.map((u) => ({ num: u.cost, den: u.hours }))) : { mean: NaN, lo: NaN, hi: NaN, n: timed.length };

  const models = new Map<string, { requests: number; usd: number }>();
  for (const l of lines) {
    const m = models.get(String(l.model)) ?? models.set(String(l.model), { requests: 0, usd: 0 }).get(String(l.model))!;
    if (l.kind !== "warming" && !isError(l)) m.requests += 1;
    m.usd += num(l.costUsd);
  }
  const components = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, unallocated: 0 };
  let rewrite = 0;
  let rewrites = 0;
  const seen = new Set<string>();
  for (const l of lines) {
    const a = allocate(l);
    for (const k of Object.keys(components) as Component[]) components[k] += a[k];
    if (l.kind === "warming") continue;
    if (seen.has(l.sessionId) && num(l.cacheWrite) > 0) { rewrite += a.cacheWrite; rewrites += 1; } else seen.add(l.sessionId);
  }
  const warm = lines.filter((l) => l.kind === "warming");
  // Fold and cold-resume events are found per arm (the cold-resume TTL depends on the arm's mainCacheTtl).
  const stats = armStats(lines.map((l) => ({ ...l, arm: typeof l.arm === "string" && l.arm ? l.arm : "(none)" })), { flags });
  const evs = (k: "fold" | "coldResume") => ({ n: sum(stats.map((s) => s[k].n)), usd: sum(stats.map((s) => s[k].n * s[k].meanCost)) });
  const split = (name: string, n: number, usd: number): Split => ({ name, n, usd, share: totalUsd ? usd / totalUsd : NaN, perHour: perHour(usd) });
  const all = taskCosts(lines, outcomes.map((e) => (e?.event === "spawn" ? { ...e, arm: "all" } : e))).all;
  return {
    totalUsd, requests: lines.filter((l) => l.kind !== "warming" && !isError(l)).length, errors: lines.filter((l) => l.kind !== "warming" && isError(l)).length, warming: warm.length, units: units.length, activeHours, usdPerHour,
    q5hPerHour: perHour(quotaShare(lines, "q5h").pi), q7dPerHour: perHour(quotaShare(lines, "q7d").pi),
    perAccepted: all ?? { accepted: 0, judged: 0, costUsd: 0, perAccepted: NaN },
    byModel: [...models].map(([model, m]) => ({ model, ...m, share: totalUsd ? m.usd / totalUsd : NaN, perHour: perHour(m.usd) })).sort((a, b) => b.usd - a.usd),
    splits: [split("cache rewrite", rewrites, rewrite), split("warming", warm.length, sum(warm.map((l) => num(l.costUsd)))),
      split("after folds", evs("fold").n, evs("fold").usd), split("after cold resumes", evs("coldResume").n, evs("coldResume").usd)],
    components, folds: foldsOf(lines, flags, rows),
  };
}
