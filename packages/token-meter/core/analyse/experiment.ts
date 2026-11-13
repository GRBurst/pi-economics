// (b) experiment: per design and stratum the factor effects (ratio of sums, bootstrap CI, minimum detectable effect), the balance table,
// per-arm stats and the posterior (redesign M2c, B8).
import { armStats, isError, MIN_HOURS, quotaAttribution, rootUnits, type ArmStat, type RootUnit } from "../arms.ts";
import { bootstrapRatio, mulberry32, normal, ratio } from "../stats.ts";
import { billingOf, plansAbsent, type Billing, type Plans } from "../plans.ts";
import { byTs, isLine } from "./logs.ts";
import { type LeverState } from "../levers.ts";
import { apiUsd } from "./units.ts";
import { armInfo, DESIGNS, designOf, designOfLine, rowsBySession, v2Levels } from "./designs.ts";

/**
 * What a stratum's effects are measured in, per active hour. token-meter keeps its own copy of experiments' `Objective` literal set (core/settings.ts, M5a):
 * a package imports no other, so there is no cross-import. The checks iface-objective-* (checks/default.nix, M5b.1) keep the
 * two sets equal; the analyser reads `strata.<stratum>.objective` (the assignment's recorded stratum, else the billing class).
 */
export type Objective = (typeof OBJECTIVES)[number];
const OBJECTIVES = ["apiUsd", "cashUsd", "localCost", "wallMs", "points5h", "points7d"] as const;

/** A root session as the estimate sees it: its stratum (billing class of its main's provider), arm, factor levels, active hours and objective (undefined = not measurable). */
export type Unit = { sessionId: string; design: string; stratum: string; arm: string; levels: Record<string, string | number | boolean>;
  hours: number; objective?: number;
  /** v2 rows only (M5c): every factor lever of the row read back "confirmed" (per-protocol); the objective over the requests billed as the start class (sensitivity); the root's context overflows; a request of another class than the start's. */
  confirmed?: boolean; sensitivity?: number; switched?: boolean; overflows?: number;
  /** Request timing behind a wallMs / localCost objective: lines that carry `durationMs` and lines that do not (those add no time). */ timing?: { timed: number; untimed: number } };
export type Effect =
  | { design: string; stratum: string; factor: string; a: string; b: string; nA: number; nB: number; ratioA: number; ratioB: number;
      /** ratio(B) / ratio(A) − 1: relative change of the objective per active hour from the low (a) to the high (b) level. */ effect: number;
      /** Bootstrap 95% CI of the effect; NaN with fewer than 2 units at a level. */ ci: [number, number];
      /** Minimum detectable effect, 2.80 · sd of the bootstrap effect (α .05 two-sided, power .8); NaN as the CI; 0 = zero variance. */ mde: number;
      /** Bootstrap draws dropped because their ratio was not finite (a level whose resample had no hours or a zero low ratio). */ dropped: number }
  | { design: string; stratum: string; factor: string; notMeasurable: string };
/**
 * Per arm of a stratum: units over MIN_HOURS (`units`, of which `unmeasured` have no objective), their active hours, units under MIN_HOURS (`excluded`),
 * and for a wallMs / localCost objective the lines of those units with and without `durationMs` (the untimed ones add no time).
 */
export type BalanceRow = { arm: string; units: number; hours: number; excluded: number; unmeasured: number; timedLines: number; untimedLines: number };
/** M5c (§7.5), v2-engine strata only. Per-protocol: units whose every factor lever is "confirmed" (a non-randomized comparison); `excluded` = the other measured units. */
export type PerProtocol = { units: number; excluded: number; effects: Effect[] };
/**
 * Refusal rate of a factor's lever: units whose lever state is "refused" ÷ units whose last levers line holds the lever with an assigned value (`eligible`, as the Levers
 * section); `noLevers` = the stratum's units without any levers line (token-meter off, older sessions), left out of the rate. broken = above REFUSAL_LIMIT.
 */
export type RefusalRow = { factor: string; lever: string; eligible: number; refused: number; noLevers: number; rate: number; broken: boolean };
export type OverflowRow = { arm: string; units: number; hours: number; overflows: number; perHour: number };
/** Effects with each unit's objective over the requests billed as its start class; `switched` = units with a request of another class. */
export type Sensitivity = { switched: number; effects: Effect[] };
export type StratumResult = { stratum: string; objective: Objective; balance: BalanceRow[]; effects: Effect[];
  perProtocol?: PerProtocol; refusal?: RefusalRow[]; overflow?: OverflowRow[]; sensitivity?: Sensitivity;
  /** Per-arm stats of this stratum's units alone (the kill switch and the posterior of `designs.<id>.<stratum>`, T5c.9). */ arms?: ArmStat[] };
export const REFUSAL_LIMIT = 0.2;
export type LeverStates = Map<string, Record<string, LeverState>>;
export type DesignResult = { design: string; factors: string[]; baseline: string; units: number; arms: ArmStat[];
  /** One result per stratum (billing class), never pooled. */ strata: StratumResult[];
  /** True when no usable `plans` entry exists: a unit is then in stratum "api" unless its own v2 line says otherwise. */ plansAbsent: boolean;
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

/** The design of a meter line: its own (v2 engine), else its root session's assignment row's, else the arm id's length (v1/v2/v4). v2 and v3 share arm ids, so the session decides. */
const lineDesignOf = (by: Map<string, any>) => (l: any): string => designOfLine(l, by.get(l.parentSessionId ?? l.sessionId) ?? by.get(l.sessionId));

const plainObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The objective of a stratum: experiments' `strata.<class>.objective` when valid, else `localCost` (`wallMs` when no local plan has a rate) for the local stratum, `apiUsd` for the others (design §9.4). */
function objectiveFor(stratum: string, plans: Plans, expSettings: any): Objective {
  const set = plainObject(expSettings?.strata) ? expSettings.strata[stratum]?.objective : undefined;
  if (typeof set === "string" && (OBJECTIVES as readonly string[]).includes(set)) return set as Objective;
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

const BILLINGS: readonly string[] = ["subscription", "api", "free", "local"];
/** A line's billing class: its own `billing` (meter v2) when valid, else its provider's in `plans`. */
const billingOfLine = (l: any, plans: Plans): Billing => (BILLINGS.includes(l.billing) ? l.billing : billingOf(plans, String(l.provider)));
const dur = (l: any): number | undefined => (typeof l.durationMs === "number" && Number.isFinite(l.durationMs) && l.durationMs >= 0 ? l.durationMs : undefined);

/**
 * The objective of one root (`ls` its lines in ts order, `u` its totals, `plans` the billing classes), undefined when not measurable, and for the timed
 * objectives the coverage of `durationMs`: both sum the lines that have it (wallMs the main's non-warming lines, localCost the non-warming lines of local
 * billing with a plan rate); a root without any timed line has no objective (a v1 log), one with some untimed lines keeps its sum and says so.
 */
function objectiveOf(o: Objective, u: RootUnit, ls: any[], plans: Plans): { objective?: number; timing?: Unit["timing"] } {
  const timed = (mine: any[], cost: (l: any) => number) => {
    const have = mine.filter((l) => dur(l) !== undefined);
    return { objective: have.length ? have.reduce((s, l) => s + cost(l), 0) : undefined, timing: { timed: have.length, untimed: mine.length - have.length } };
  };
  switch (o) {
    case "apiUsd": return { objective: u.cost };
    case "points5h": return { objective: u.q5h };
    case "points7d": return { objective: u.q7d };
    case "cashUsd": return {};
    case "wallMs": return timed(ls.filter((l) => l.parentSessionId === undefined && l.kind !== "warming"), (l) => dur(l)!);
    case "localCost": return timed(ls.filter((l) => l.kind !== "warming" && billingOfLine(l, plans) === "local" && plans[String(l.provider)]?.rate), (l) => (dur(l)! / MS_H) * plans[String(l.provider)].rate!.amount);
  }
}

/** The stratum of a root: the billing class (the line's own, else plans) of the provider of its main session's first request; "api" without either. */
function strataOf(ls: any[], plans: Plans): string {
  const main = ls.find((l) => l.parentSessionId === undefined && l.kind !== "warming" && !isError(l) && typeof l.provider === "string") ?? ls.find((l) => typeof l.provider === "string");
  return main ? billingOfLine(main, plans) : "api";
}

/**
 * Every root session of the design's lines as a Unit (all hours; the estimate excludes short ones, the balance table counts them). Its stratum is
 * the one its assignment row records (v2 engine: a named stratum), else the billing class of its main's first request (strataOf).
 */
function unitsOf(dl: any[], design: string, info: Map<string, { flags: Record<string, string> }>, plans: Plans, quota: ReturnType<typeof quotaAttribution>, expSettings: any, rows: Map<string, any>, states: LeverStates): { units: Unit[]; objectives: Map<string, Objective> } {
  const byRoot = new Map<string, any[]>();
  for (const l of [...dl].sort(byTs)) { const r = l.parentSessionId ?? l.sessionId; (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(l); }
  const objectives = new Map<string, Objective>();
  const units = rootUnits(dl, quota).map((r): Unit => {
    const ls = byRoot.get(r.root) ?? [];
    const recorded = rows.get(r.root)?.stratum;
    const stratum = typeof recorded === "string" && recorded ? recorded : strataOf(ls, plans);
    if (!objectives.has(stratum)) objectives.set(stratum, objectiveFor(stratum, plans, expSettings));
    const o = objectives.get(stratum)!;
    const unit: Unit = { sessionId: r.root, design, stratum, arm: r.arm, levels: info.get(r.arm)?.flags ?? {}, hours: r.hours, ...objectiveOf(o, r, ls, plans) };
    const row = rows.get(r.root);
    if (row?.v !== 2) return unit;
    const start = strataOf(ls, plans), same = ls.filter((l) => billingOfLine(l, plans) === start);
    const mine = states.get(r.root);
    const factors: Array<{ lever?: string }> = plainObject(row.factors) ? Object.values(row.factors) : [];
    return { ...unit, confirmed: factors.every((f) => typeof f?.lever === "string" && mine?.[f.lever]?.rb === "confirmed"),
      sensitivity: objectiveOf(o, { ...r, cost: same.reduce((s, l) => s + apiUsd(l), 0) }, same.filter((l) => l.kind !== "warming" || o === "apiUsd"), plans).objective,
      switched: ls.some((l) => l.kind !== "warming" && !isError(l) && billingOfLine(l, plans) !== start),
      overflows: ls.filter((l) => l.errorKind === "context_overflow").length };
  });
  return { units, objectives };
}

/** Effects of each factor over `included` units with the objective `value` (undefined = not measurable). */
function effectsOf(design: string, stratum: string, objective: Objective, included: Unit[], factors: string[], levels: (f: string) => [string, string], value: (u: Unit) => number | undefined = (u) => u.objective): Effect[] {
  const measured = included.filter((u) => value(u) !== undefined).map((u) => ({ ...u, objective: value(u) }));
  return factors.map((factor): Effect => {
    if (!included.length) return { design, stratum, factor, notMeasurable: `not measurable: every unit is under ${MIN_HOURS} active h` };
    if (!measured.length) return { design, stratum, factor, notMeasurable: `not measurable: ${WHY[objective]}` };
    const [a, b] = levels(factor);
    const A = measured.filter((u) => u.levels[factor] === a), B = measured.filter((u) => u.levels[factor] === b);
    if (!A.length || !B.length) return { design, stratum, factor, notMeasurable: `not measurable: no unit at level ${A.length ? b : a}` };
    const ratioA = ratio(A), ratioB = ratio(B);
    if (!(ratioA > 0) || !Number.isFinite(ratioB)) return { design, stratum, factor, notMeasurable: "not measurable: the low level's ratio is not positive" };
    const thin = A.length < 2 || B.length < 2;
    const boot = thin ? { ci: [NaN, NaN] as [number, number], sd: NaN, dropped: 0 } : bootstrapRatio(A, B, BOOTSTRAP, 1);
    return { design, stratum, factor, a, b, nA: A.length, nB: B.length, ratioA, ratioB, effect: ratioB / ratioA - 1, ci: boot.ci, mde: 2.8 * boot.sd, dropped: boot.dropped };
  });
}

function stratumResult(design: string, stratum: string, objective: Objective, units: Unit[], factors: string[], levels: (f: string) => [string, string]): StratumResult {
  const included = units.filter((u) => u.hours >= MIN_HOURS);
  const arms = [...new Set(units.map((u) => u.arm))].sort();
  const balance = arms.map((arm): BalanceRow => {
    const mine = included.filter((u) => u.arm === arm);
    return { arm, units: mine.length, hours: mine.reduce((s, u) => s + u.hours, 0), excluded: units.filter((u) => u.arm === arm && u.hours < MIN_HOURS).length, unmeasured: mine.filter((u) => u.objective === undefined).length,
      timedLines: mine.reduce((s, u) => s + (u.timing?.timed ?? 0), 0), untimedLines: mine.reduce((s, u) => s + (u.timing?.untimed ?? 0), 0) };
  });
  const effects = effectsOf(design, stratum, objective, included, factors, levels);
  if (!included.some((u) => u.confirmed !== undefined)) return { stratum, objective, balance, effects };
  const proto = included.filter((u) => u.confirmed);
  const switched = included.filter((u) => u.switched).length;
  return { stratum, objective, balance, effects,
    perProtocol: { units: proto.length, excluded: included.length - proto.length, effects: effectsOf(design, stratum, objective, proto, factors, levels) },
    sensitivity: { switched, effects: effectsOf(design, stratum, objective, included, factors, levels, (u) => u.sensitivity) },
    overflow: arms.map((arm) => { const mine = included.filter((u) => u.arm === arm), hours = mine.reduce((s, u) => s + u.hours, 0), overflows = mine.reduce((s, u) => s + (u.overflows ?? 0), 0);
      return { arm, units: mine.length, hours, overflows, perHour: hours > 0 ? overflows / hours : NaN }; }) };
}

/** factor name → lever id, from the design's v2 rows. */
function factorLevers(rows: any[], design: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) if (r?.v === 2 && r.design === design && plainObject(r.factors)) for (const [n, f] of Object.entries(r.factors as Record<string, any>)) if (typeof f?.lever === "string" && !out.has(n)) out.set(n, f.lever);
  return out;
}

/** Per factor: the units whose lever state is "refused" ÷ those with an assigned state of the lever (see RefusalRow). */
function refusalOf(units: Unit[], levers: Map<string, string>, states: LeverStates): RefusalRow[] {
  return [...levers].map(([factor, lever]) => {
    const has = units.filter((u) => states.get(u.sessionId)?.[lever]?.a !== undefined);
    const refused = has.filter((u) => states.get(u.sessionId)![lever].rb === "refused").length;
    const rate = has.length ? refused / has.length : NaN;
    return { factor, lever, eligible: has.length, refused, noLevers: units.filter((u) => !states.has(u.sessionId)).length, rate, broken: rate > REFUSAL_LIMIT };
  });
}

export function experiment(meter: any[], rows: any[], expSettings: any, plans?: Plans, states: LeverStates = new Map()): DesignResult[] {
  const armed = meter.filter((l) => isLine(l) && typeof l.sessionId === "string" && typeof l.arm === "string" && l.arm);
  const quota = quotaAttribution(meter.filter((l) => isLine(l) && typeof l.sessionId === "string")); // account-wide: over every root, armed or not
  const by = rowsBySession(rows);
  const lineDesign = lineDesignOf(by);
  const rowArms = (design: string): string[] => rows.filter((r) => typeof r?.arm === "string" && designOf(r.arm, r) === design).map((r) => r.arm as string);
  return [...new Set([...armed.map(lineDesign), ...rows.filter((r) => typeof r?.arm === "string").map((r) => designOf(r.arm, r))])].sort().map((design) => {
    const dl = armed.filter((l) => lineDesign(l) === design);
    const arms = [...new Set([...dl.map((l) => l.arm as string), ...rowArms(design)])];
    // Per design: arm names repeat across designs (v2 and v3; every v2-engine design names its arms by bits).
    const info = armInfo(arms, rows.filter((r) => typeof r?.arm === "string" && designOf(r.arm, r) === design));
    const flags = Object.fromEntries([...info].map(([a, i]) => [a, i.flags]));
    const known = DESIGNS[design];
    const v2 = v2Levels(rows, design); // a v2-engine design: the levels its rows assigned, low first
    const isV2 = v2.size > 0;
    const factors = known ? known.map(([n]) => n) : [...new Set(arms.flatMap((a) => Object.keys(info.get(a)!.flags)))];
    const levels = (f: string): [string, string] => known?.find(([n]) => n === f)?.[1] ?? v2.get(f) ?? ([...new Set(arms.map((a) => info.get(a)!.flags[f]))].sort().concat(["", ""]).slice(0, 2) as [string, string]);
    const { units, objectives } = unitsOf(dl, design, info, plans ?? {}, quota, expSettings, by, states);
    const names = [...objectives.keys()].sort((x, y) => (STRATA_ORDER.indexOf(x) + 1 || 99) - (STRATA_ORDER.indexOf(y) + 1 || 99) || (x < y ? -1 : 1));
    const strata = names.map((s) => {
      const mine = units.filter((u) => u.stratum === s), result = stratumResult(design, s, objectives.get(s)!, mine, factors, levels);
      if (!isV2) return result;
      const roots = new Set(mine.map((u) => u.sessionId));
      return { ...result, refusal: refusalOf(mine, factorLevers(rows, design), states),
        arms: armStats(dl.filter((l) => roots.has(l.parentSessionId ?? l.sessionId)), { flags, quota }) };
    });
    const stats = armStats(dl, { flags, quota });
    const post = stats.filter((s) => s.units >= 2).map((s) => ({ arm: s.arm, mean: -s.costPerHour, sd: s.sd }));
    const pb = pBest(post);
    const wanted = typeof expSettings?.baseline === "string" && expSettings.baseline.length === factors.length ? expSettings.baseline : undefined;
    return { design, factors, baseline: isV2 ? "0".repeat(factors.length) : wanted ?? "-".repeat(factors.length), units: units.filter((u) => u.hours >= MIN_HOURS).length, arms: stats, strata, plansAbsent: plansAbsent(plans), posterior: post.map((p, i) => ({ ...p, pBest: pb[i] })) };
  });
}
