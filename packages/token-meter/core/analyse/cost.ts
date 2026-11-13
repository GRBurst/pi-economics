// (a) cost: $, requests, active hours, splits by model, the cache (cache.ts), warming, folds and cold resumes.
import { isError, MIN_HOURS, rootUnits } from "../arms.ts";
import { type LedgerSection } from "../ledger.ts";
import { bootstrapRatioCI, type CI } from "../stats.ts";
import { byTs, isLine, num, sum } from "./logs.ts";
import { allocate, apiUsd, cacheWrite1hOf, type Component } from "./units.ts";
import { foldsOf } from "./folds.ts";
import { cacheSection, type CacheSection } from "./cache.ts";
import { costPerAccepted, taskRows, type CostPerAccepted } from "./delegation.ts";
import { type Plans } from "../plans.ts";
import { billingOfLine, billingTold } from "./budget.ts";

export type Split = { name: string; n: number; usd: number; share: number; perHour: number };
export type CostSection = { totalUsd: number; /** What is actually charged: the API-eq $ of the lines of billing class api (their own billing, else their provider's plan, else api). */ cashUsd: number; /** Some of those lines had their class guessed (no own billing, no plan): cashUsd is an upper bound. */ cashGuessed: boolean; requests: number; errors: number; warming: number; units: number; activeHours: number;
  usdPerHour: CI; perAccepted: CostPerAccepted;
  byModel: Array<{ model: string; requests: number; usd: number; share: number; perHour: number }>;
  splits: Split[]; components: Record<Component, number>; cache: CacheSection; folds: LedgerSection };

export function cost(meter: any[], outcomes: any[], flags: Record<string, Record<string, string>>, rows: Map<string, any>, plans: Plans = {}): CostSection {
  const lines = meter.filter((l) => isLine(l) && typeof l.sessionId === "string").sort(byTs);
  const units = rootUnits(lines);
  const activeHours = sum(units.map((u) => u.hours));
  const totalUsd = sum(lines.map((l) => apiUsd(l)));
  const perHour = (usd: number) => (activeHours ? usd / activeHours : NaN);
  // The CI resamples units of ≥ MIN_HOURS only: a few-second root ($0 orphan child lines) would otherwise draw $/h ≈ 0.
  const timed = units.filter((u) => u.hours >= MIN_HOURS);
  const usdPerHour = activeHours && timed.length ? bootstrapRatioCI(timed.map((u) => ({ num: u.cost, den: u.hours }))) : { mean: NaN, lo: NaN, hi: NaN, n: timed.length };

  const models = new Map<string, { requests: number; usd: number }>();
  for (const l of lines) {
    const m = models.get(String(l.model)) ?? models.set(String(l.model), { requests: 0, usd: 0 }).get(String(l.model))!;
    if (l.kind !== "warming" && !isError(l)) m.requests += 1;
    m.usd += apiUsd(l);
  }
  const components: Record<Component, number> = { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, unallocated: 0 };
  for (const l of lines) {
    const a = allocate(l, cacheWrite1hOf(l, l.parentSessionId === undefined, flags[l.arm])); // 1 h writes weigh 2.0, 5-minute writes 1.25 (B13)
    for (const k of Object.keys(components) as Component[]) components[k] += a[k];
  }
  const warm = lines.filter((l) => l.kind === "warming");
  const split = (name: string, n: number, usd: number): Split => ({ name, n, usd, share: totalUsd ? usd / totalUsd : NaN, perHour: perHour(usd) });
  return {
    totalUsd, cashUsd: sum(lines.filter((l) => billingOfLine(l, plans) === "api").map((l) => apiUsd(l))), cashGuessed: lines.some((l) => billingOfLine(l, plans) === "api" && !billingTold(l, plans)), requests: lines.filter((l) => l.kind !== "warming" && !isError(l)).length, errors: lines.filter((l) => l.kind !== "warming" && isError(l)).length, warming: warm.length, units: units.length, activeHours, usdPerHour,
    perAccepted: costPerAccepted(taskRows(lines, outcomes), "all"), // the tier table's "all" row (B5)
    byModel: [...models].map(([model, m]) => ({ model, ...m, share: totalUsd ? m.usd / totalUsd : NaN, perHour: perHour(m.usd) })).sort((a, b) => b.usd - a.usd),
    splits: [split("warming", warm.length, sum(warm.map((l) => apiUsd(l))))],
    components, cache: cacheSection(lines, flags), folds: foldsOf(lines, flags, rows),
  };
}
