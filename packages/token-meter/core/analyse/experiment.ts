// (b) experiment: per design the factor effects, an OLS with two-way interactions, per-arm stats and the posterior.
import { armStats, MIN_HOURS, quotaAttribution, rootUnits, type ArmStat } from "../arms.ts";
import { bootstrapDiffCI, mulberry32, normal, olsInteractions, type Fit } from "../stats.ts";
import { isLine } from "./logs.ts";
import { armInfo, DESIGNS, designOf, rowsBySession } from "./designs.ts";

export type Effect = { factor: string; low: string; high: string; nLow: number; nHigh: number; diff: number; lo: number; hi: number };
export type DesignResult = { design: string; factors: string[]; baseline: string; units: number; arms: ArmStat[];
  effects: Effect[]; ols: Fit | null; posterior: Array<{ arm: string; mean: number; sd: number; pBest: number }> };

const DRAWS = 4000;
/** P(best) per arm: share of draws (normal around each arm's reward) in which the arm has the highest reward. */
export function pBest(post: Array<{ arm: string; mean: number; sd: number }>): number[] {
  const rng = mulberry32(1);
  const wins = post.map(() => 0);
  for (let i = 0; i < DRAWS && post.length; i++) {
    const draws = post.map((p) => p.mean + p.sd * normal(rng));
    wins[draws.indexOf(Math.max(...draws))] += 1;
  }
  return wins.map((w) => w / DRAWS);
}

/** The design of a meter line: its root session's assignment row names it, else the arm id's length (v1/v2/v4). v2 and v3 share arm ids, so the session decides. */
const designOfLine = (by: Map<string, any>) => (l: any): string => designOf(String(l.arm ?? ""), by.get(l.parentSessionId ?? l.sessionId) ?? by.get(l.sessionId));

export function experiment(meter: any[], rows: any[], expSettings: any): DesignResult[] {
  const armed = meter.filter((l) => isLine(l) && typeof l.sessionId === "string" && typeof l.arm === "string" && l.arm);
  const info = armInfo([...new Set(armed.map((l) => l.arm as string))], rows);
  const flags = Object.fromEntries([...info].map(([a, i]) => [a, i.flags]));
  const quota = quotaAttribution(meter.filter((l) => isLine(l) && typeof l.sessionId === "string")); // account-wide: over every root, armed or not
  const lineDesign = designOfLine(rowsBySession(rows));
  const rowArms = (design: string): string[] => rows.filter((r) => typeof r?.arm === "string" && designOf(r.arm, r) === design).map((r) => r.arm as string);
  return [...new Set([...armed.map(lineDesign), ...rows.filter((r) => typeof r?.arm === "string").map((r) => designOf(r.arm, r))])].sort().map((design) => {
    const dl = armed.filter((l) => lineDesign(l) === design);
    const units = rootUnits(dl, quota).filter((u) => u.hours >= MIN_HOURS);
    const arms = [...new Set([...dl.map((l) => l.arm as string), ...rowArms(design)])];
    const known = DESIGNS[design];
    const factors = known ? known.map(([n]) => n) : [...new Set(arms.flatMap((a) => Object.keys(info.get(a)!.flags)))];
    const levels = (f: string): [string, string] => known?.find(([n]) => n === f)?.[1] ?? ([...new Set(arms.map((a) => info.get(a)!.flags[f]))].sort().concat(["", ""]).slice(0, 2) as [string, string]);
    const data: (Record<string, string | number> & { y: number })[] = units.filter((u) => arms.includes(u.arm)).map((u) => ({ ...info.get(u.arm)!.flags, y: u.cost / u.hours }));
    const effects = factors.map((f) => {
      const [low, high] = levels(f);
      const hi = data.filter((d) => d[f] === high).map((d) => d.y);
      const lo = data.filter((d) => d[f] === low).map((d) => d.y);
      const ci = bootstrapDiffCI(hi, lo);
      return { factor: f, low, high, nLow: lo.length, nHigh: hi.length, diff: ci.mean, lo: ci.lo, hi: ci.hi };
    });
    const varying = factors.filter((f) => new Set(data.map((d) => d[f])).size > 1);
    const ols = data.length >= 2 && varying.length ? olsInteractions(data, "y", varying, Object.fromEntries(varying.map((f) => [f, levels(f)]))) : null;
    const stats = armStats(dl, { flags, quota });
    const post = stats.filter((s) => s.units >= 2).map((s) => ({ arm: s.arm, mean: -s.costPerHour, sd: s.sd }));
    const pb = pBest(post);
    const wanted = typeof expSettings?.baseline === "string" && expSettings.baseline.length === factors.length ? expSettings.baseline : undefined;
    return { design, factors, baseline: wanted ?? "-".repeat(factors.length), units: data.length, arms: stats, effects, ols, posterior: post.map((p, i) => ({ ...p, pBest: pb[i] })) };
  });
}
