// (b) experiment: per design and stratum the factor effects (ratio of sums, bootstrap CI, minimum detectable effect), the balance table,
// per-arm stats and the posterior (redesign M2c, B8).
import { armStats, isError, MIN_HOURS, quotaAttribution, rootUnits, type ArmStat, type RootUnit } from "../arms.ts";
import { bootstrapRatio, mulberry32, normal, ratio } from "../stats.ts";
import { billingOf, type Plans } from "../plans.ts";
import { byTs, isLine } from "./logs.ts";
import { armInfo, DESIGNS, designOf, rowsBySession } from "./designs.ts";

/** What a stratum's effects are measured in, per active hour. The same literal set as experiments' `Objective` (core/settings.ts, M5a): this package imports no other. */
export type Objective = "apiUsd" | "cashUsd" | "localCost" | "wallMs" | "points5h" | "points7d";
const OBJECTIVES: readonly string[] = ["apiUsd", "cashUsd", "localCost", "wallMs", "points5h", "points7d"];

/** A root session as the estimate sees it: its stratum (billing class of its main's provider), arm, factor levels, active hours and objective (undefined = not measurable). */
export type Unit = { sessionId: string; design: string; stratum: string; arm: string; levels: Record<string, string | number | boolean>;
  hours: number; objective?: number };
export type Effect =
  | { design: string; stratum: string; factor: string; a: string; b: string; nA: number; nB: number; ratioA: number; ratioB: number;
      /** ratio(B) / ratio(A) − 1: relative change of the objective per active hour from the low (a) to the high (b) level. */ effect: number;
      /** Bootstrap 95% CI of the effect; NaN with fewer than 2 units at a level. */ ci: [number, number];
      /** Minimum detectable effect, 2.80 · sd of the bootstrap effect (α .05 two-sided, power .8); NaN as the CI. */ mde: number }
  | { design: string; stratum: string; factor: string; notMeasurable: string };
/** Per arm of a stratum: units over MIN_HOURS (`units`, of which `unmeasured` have no objective), their active hours, units under MIN_HOURS (`excluded`). */
export type BalanceRow = { arm: string; units: number; hours: number; excluded: number; unmeasured: number };
export type StratumResult = { stratum: string; objective: Objective; balance: BalanceRow[]; effects: Effect[] };
export type DesignResult = { design: string; factors: string[]; baseline: string; units: number; arms: ArmStat[];
  /** One result per stratum (billing class), never pooled. */ strata: StratumResult[];
  /** True when no `plans` were given: every unit is then in stratum "api". */ plansAbsent: boolean;
  posterior: Array<{ arm: string; mean: number; sd: number; pBest: number }> };

const BOOTSTRAP = 2000;
const STRATA_ORDER = ["subscription", "api", "free", "local"];
const MS_H = 3_600_000;

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

const plainObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The objective of a stratum: experiments' `strata.<class>.objective` when valid, else `localCost` (`wallMs` when no local plan has a rate) for the local stratum, `apiUsd` for the others (design §9.4). */
function objectiveFor(stratum: string, plans: Plans, expSettings: any): Objective {
  const set = plainObject(expSettings?.strata) ? expSettings.strata[stratum]?.objective : undefined;
  if (typeof set === "string" && OBJECTIVES.includes(set)) return set as Objective;
  if (stratum === "local") return Object.values(plans).some((p) => p.billing === "local" && p.rate) ? "localCost" : "wallMs";
  return "apiUsd";
}

/** Why a stratum's objective could not be measured. */
const WHY: Record<Objective, string> = {
  apiUsd: "no cost in the stratum's lines",
  cashUsd: "cashUsd is not computed by this analyser yet",
  localCost: "localCost needs durationMs on the stratum's lines (meter v1 lines carry none) and a rate for the provider in plans",
  wallMs: "wallMs needs durationMs on the stratum's main-session lines (meter v1 lines carry none)",
  points5h: "no q5h quota readings for the stratum's units",
  points7d: "no q7d quota readings for the stratum's units",
};

/** The objective of one root (`ls` its lines in ts order, `u` its totals, `plans` the billing classes), undefined when not measurable. */
function objectiveOf(o: Objective, u: RootUnit, ls: any[], plans: Plans): number | undefined {
  const dur = (l: any): number | undefined => (typeof l.durationMs === "number" && Number.isFinite(l.durationMs) && l.durationMs >= 0 ? l.durationMs : undefined);
  switch (o) {
    case "apiUsd": return u.cost;
    case "points5h": return u.q5h;
    case "points7d": return u.q7d;
    case "cashUsd": return undefined;
    case "wallMs": {
      const ms = ls.filter((l) => l.parentSessionId === undefined && l.kind !== "warming").map(dur).filter((x): x is number => x !== undefined);
      return ms.length ? ms.reduce((s, x) => s + x, 0) : undefined;
    }
    case "localCost": {
      const mine = ls.filter((l) => l.kind !== "warming" && billingOf(plans, String(l.provider)) === "local" && plans[String(l.provider)]?.rate);
      if (!mine.length || mine.some((l) => dur(l) === undefined)) return undefined;
      return mine.reduce((s, l) => s + (dur(l)! / MS_H) * plans[String(l.provider)].rate!.amount, 0);
    }
  }
}

/** The stratum of a root: the billing class (plans) of the provider of its main session's first request; "api" without plans. */
function strataOf(ls: any[], plans: Plans): string {
  const main = ls.find((l) => l.parentSessionId === undefined && l.kind !== "warming" && !isError(l) && typeof l.provider === "string") ?? ls.find((l) => typeof l.provider === "string");
  return billingOf(plans, String(main?.provider ?? ""));
}

/** Every root session of the design's lines as a Unit (all hours; the estimate excludes short ones, the balance table counts them). */
function unitsOf(dl: any[], design: string, info: Map<string, { flags: Record<string, string> }>, plans: Plans, quota: ReturnType<typeof quotaAttribution>, expSettings: any): { units: Unit[]; objectives: Map<string, Objective> } {
  const byRoot = new Map<string, any[]>();
  for (const l of [...dl].sort(byTs)) { const r = l.parentSessionId ?? l.sessionId; (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(l); }
  const objectives = new Map<string, Objective>();
  const units = rootUnits(dl, quota).map((r): Unit => {
    const ls = byRoot.get(r.root) ?? [];
    const stratum = strataOf(ls, plans);
    if (!objectives.has(stratum)) objectives.set(stratum, objectiveFor(stratum, plans, expSettings));
    return { sessionId: r.root, design, stratum, arm: r.arm, levels: info.get(r.arm)?.flags ?? {}, hours: r.hours, objective: objectiveOf(objectives.get(stratum)!, r, ls, plans) };
  });
  return { units, objectives };
}

function stratumResult(design: string, stratum: string, objective: Objective, units: Unit[], factors: string[], levels: (f: string) => [string, string]): StratumResult {
  const included = units.filter((u) => u.hours >= MIN_HOURS);
  const measured = included.filter((u) => u.objective !== undefined);
  const arms = [...new Set(units.map((u) => u.arm))].sort();
  const balance = arms.map((arm): BalanceRow => {
    const mine = included.filter((u) => u.arm === arm);
    return { arm, units: mine.length, hours: mine.reduce((s, u) => s + u.hours, 0), excluded: units.filter((u) => u.arm === arm && u.hours < MIN_HOURS).length, unmeasured: mine.filter((u) => u.objective === undefined).length };
  });
  const effects = factors.map((factor): Effect => {
    if (!measured.length) return { design, stratum, factor, notMeasurable: `not measurable: ${WHY[objective]}` };
    const [a, b] = levels(factor);
    const A = measured.filter((u) => u.levels[factor] === a), B = measured.filter((u) => u.levels[factor] === b);
    if (!A.length || !B.length) return { design, stratum, factor, notMeasurable: `not measurable: no unit at level ${A.length ? b : a}` };
    const ratioA = ratio(A), ratioB = ratio(B);
    if (!(ratioA > 0) || !Number.isFinite(ratioB)) return { design, stratum, factor, notMeasurable: "not measurable: the low level's ratio is not positive" };
    const thin = A.length < 2 || B.length < 2;
    const boot = thin ? { ci: [NaN, NaN] as [number, number], sd: NaN } : bootstrapRatio(A, B, BOOTSTRAP, 1);
    return { design, stratum, factor, a, b, nA: A.length, nB: B.length, ratioA, ratioB, effect: ratioB / ratioA - 1, ci: boot.ci, mde: 2.8 * boot.sd };
  });
  return { stratum, objective, balance, effects };
}

export function experiment(meter: any[], rows: any[], expSettings: any, plans?: Plans): DesignResult[] {
  const armed = meter.filter((l) => isLine(l) && typeof l.sessionId === "string" && typeof l.arm === "string" && l.arm);
  const info = armInfo([...new Set(armed.map((l) => l.arm as string))], rows);
  const flags = Object.fromEntries([...info].map(([a, i]) => [a, i.flags]));
  const quota = quotaAttribution(meter.filter((l) => isLine(l) && typeof l.sessionId === "string")); // account-wide: over every root, armed or not
  const lineDesign = designOfLine(rowsBySession(rows));
  const rowArms = (design: string): string[] => rows.filter((r) => typeof r?.arm === "string" && designOf(r.arm, r) === design).map((r) => r.arm as string);
  return [...new Set([...armed.map(lineDesign), ...rows.filter((r) => typeof r?.arm === "string").map((r) => designOf(r.arm, r))])].sort().map((design) => {
    const dl = armed.filter((l) => lineDesign(l) === design);
    const arms = [...new Set([...dl.map((l) => l.arm as string), ...rowArms(design)])];
    const known = DESIGNS[design];
    const factors = known ? known.map(([n]) => n) : [...new Set(arms.flatMap((a) => Object.keys(info.get(a)!.flags)))];
    const levels = (f: string): [string, string] => known?.find(([n]) => n === f)?.[1] ?? ([...new Set(arms.map((a) => info.get(a)!.flags[f]))].sort().concat(["", ""]).slice(0, 2) as [string, string]);
    const { units, objectives } = unitsOf(dl, design, info, plans ?? {}, quota, expSettings);
    const names = [...objectives.keys()].sort((x, y) => (STRATA_ORDER.indexOf(x) + 1 || 99) - (STRATA_ORDER.indexOf(y) + 1 || 99) || (x < y ? -1 : 1));
    const strata = names.map((s) => stratumResult(design, s, objectives.get(s)!, units.filter((u) => u.stratum === s), factors, levels));
    const stats = armStats(dl, { flags, quota });
    const post = stats.filter((s) => s.units >= 2).map((s) => ({ arm: s.arm, mean: -s.costPerHour, sd: s.sd }));
    const pb = pBest(post);
    const wanted = typeof expSettings?.baseline === "string" && expSettings.baseline.length === factors.length ? expSettings.baseline : undefined;
    return { design, factors, baseline: wanted ?? "-".repeat(factors.length), units: units.filter((u) => u.hours >= MIN_HOURS).length, arms: stats, strata, plansAbsent: plans === undefined, posterior: post.map((p, i) => ({ ...p, pBest: pb[i] })) };
  });
}
