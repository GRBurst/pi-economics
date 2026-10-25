// On-demand analysis of pi's own logs: cost, experiment, delegation & routing, guards, data quality.
// Pure; bin/pi-analyse.ts does the I/O. Reads the meter log, the task-router outcome log, experiments/assignments.jsonl
// and guards/events.jsonl as plain JSON (packages do not import each other; <agentDir>/LOGS.md is the contract).
import { armStats, attributeQuota, MIN_HOURS, nextState, quotaAttribution, rootUnits, type ArmStat } from "./arms.ts";
import { check, type Problem } from "./contract.ts";
import { acceptance, killSwitch, signals, type Limits } from "./guards.ts";
import { foldLedger, summarise, type LedgerSection } from "./ledger.ts";
import { taskCosts, taskRecords, type TaskCost } from "./tasks.ts";
import { bootstrapDiffCI, bootstrapRatioCI, mulberry32, normal, olsInteractions, type CI, type Fit } from "./stats.ts";

export type LogName = "meter" | "outcomes" | "assignments" | "guards";
export type FileInfo = { log: LogName; file: string; lines: number; unparsable: number };
export type Logs = { meter: any[]; outcomes: any[]; assignments: any[]; guards: any[];
  /** Per file read (torn or foreign lines are counted, not parsed). */
  files?: FileInfo[];
  /** experiments/settings.json and task-router/settings.json, when present. */
  expSettings?: any; routerSettings?: any };
/** Inclusive UTC days, YYYY-MM-DD. */
export type Period = { since?: string; until?: string };

export const LOGS: LogName[] = ["meter", "outcomes", "assignments", "guards"];
/** Schema version of a line; lines written before `v` existed are version 0. */
export const versionOf = (l: any): number => (Number.isInteger(l?.v) ? l.v : 0);

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isLine = (l: any): boolean => !!l && typeof l.ts === "string" && !Number.isNaN(Date.parse(l.ts));
const byTs = (a: any, b: any): number => Date.parse(a.ts) - Date.parse(b.ts);
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
const countBy = <T>(xs: T[], key: (x: T) => string): Record<string, number> => xs.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {} as Record<string, number>);

/** Meter, outcomes and guards lines whose UTC day is in the period; assignments are kept whole (they are looked up by session). */
export function inPeriod(logs: Logs, p: Period): Logs {
  const keep = (l: any) => isLine(l) && (p.since === undefined || l.ts.slice(0, 10) >= p.since) && (p.until === undefined || l.ts.slice(0, 10) <= p.until);
  return { ...logs, meter: logs.meter.filter(keep), outcomes: logs.outcomes.filter(keep), guards: logs.guards.filter(keep) };
}

// ---- designs -----------------------------------------------------------------------------------

type Factors = Array<[string, [string, string]]>;
const V1: Factors = [["warmPolicy", ["native", "orchestrator-aware"]], ["mainCacheTtl", ["5m", "1h"]], ["foldHint", ["fixed", "cache-aware"]], ["maskOnCold", ["off", "on"]], ["freshOnCold", ["off", "advise"]]];
const V2: Factors = [...V1, ["delegationRule", ["off", "on"]]];
/**
 * The experiments package's designs (own copy): v1 = five factors (rows without `design`), v2 = six (`design: "v2"`), v3 = the same six
 * factors and arms as v2 (`design: "v3"`) but foldHint = cache-aware means something else (a system-prompt paragraph): v2 and v3 sessions
 * are analysed in separate tables, never pooled, although they share arm ids.
 */
export const DESIGNS: Record<string, Factors> = { v1: V1, v2: V2, v3: V2 };

/** A row's `design`, else by arm length (5 → v1, 6 → v2). */
export const designOf = (arm: string, row?: any): string =>
  typeof row?.design === "string" ? row.design : arm.length === 5 ? "v1" : arm.length === 6 ? "v2" : `${arm.length}-factor`;

/** First assignment row per session. */
function rowsBySession(rows: any[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const r of rows) if (typeof r?.sessionId === "string" && typeof r.arm === "string" && !m.has(r.sessionId)) m.set(r.sessionId, r);
  return m;
}

/** arm → { design, flags } from the assignment rows, else decoded from the arm id. */
function armInfo(arms: string[], rows: any[]): Map<string, { design: string; flags: Record<string, string> }> {
  const out = new Map<string, { design: string; flags: Record<string, string> }>();
  for (const r of rows) if (typeof r?.arm === "string" && !out.has(r.arm) && r.flags && typeof r.flags === "object") out.set(r.arm, { design: designOf(r.arm, r), flags: r.flags });
  for (const arm of arms) {
    if (out.has(arm)) continue;
    const design = designOf(arm);
    const fs = DESIGNS[design] ?? [];
    out.set(arm, { design, flags: Object.fromEntries(fs.map(([n, v], i) => [n, arm[i] === "+" ? v[1] : v[0]])) });
  }
  return out;
}

// ---- (a) cost ----------------------------------------------------------------------------------

/** Relative token prices (Anthropic: cache read 0.1, cache write 1.25, output 5 × input), used only to split a line's cost. */
const WEIGHT = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 } as const;
type Component = keyof typeof WEIGHT | "unallocated";
function allocate(l: any): Record<Component, number> {
  const c = num(l.costUsd);
  const w = (Object.keys(WEIGHT) as Array<keyof typeof WEIGHT>).map((k) => [k, WEIGHT[k] * num(l[k])] as const);
  const total = sum(w.map(([, x]) => x));
  const out = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, unallocated: total ? 0 : c };
  if (total) for (const [k, x] of w) out[k] = (c * x) / total;
  return out;
}

export type Split = { name: string; n: number; usd: number; share: number; perHour: number };
export type CostSection = { totalUsd: number; requests: number; warming: number; units: number; activeHours: number;
  usdPerHour: CI; q5hPerHour: number; q7dPerHour: number; perAccepted: TaskCost;
  byModel: Array<{ model: string; requests: number; usd: number; share: number; perHour: number }>;
  splits: Split[]; components: Record<Component, number>; folds: LedgerSection };

/**
 * Quota points pi used and all points seen, per window (`<key>Reset`): pi = the global rise attributed to roots (arms.ts attributeQuota:
 * rises of the window's running maximum between non-warming requests less than 30 min apart); all = max − min of the window, warming
 * readings included.
 */
function quotaShare(meter: any[], key: "q5h" | "q7d"): { pi: number; total: number; share: number } {
  const windows = new Map<unknown, number[]>();
  for (const l of meter) if (typeof l[key] === "number") windows.set(l[`${key}Reset`], [...(windows.get(l[`${key}Reset`]) ?? []), l[key]]);
  const total = sum([...windows.values()].map((v) => Math.max(...v) - Math.min(...v)));
  const pi = attributeQuota(meter, key).total;
  return { pi, total, share: total ? pi / total : NaN };
}

function cost(meter: any[], outcomes: any[], flags: Record<string, Record<string, string>>, rows: Map<string, any>): CostSection {
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
    m.requests += 1;
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
    totalUsd, requests: lines.length - warm.length, warming: warm.length, units: units.length, activeHours, usdPerHour,
    q5hPerHour: perHour(quotaShare(lines, "q5h").pi), q7dPerHour: perHour(quotaShare(lines, "q7d").pi),
    perAccepted: all ?? { accepted: 0, judged: 0, costUsd: 0, perAccepted: NaN },
    byModel: [...models].map(([model, m]) => ({ model, ...m, share: totalUsd ? m.usd / totalUsd : NaN, perHour: perHour(m.usd) })).sort((a, b) => b.usd - a.usd),
    splits: [split("cache rewrite", rewrites, rewrite), split("warming", warm.length, sum(warm.map((l) => num(l.costUsd)))),
      split("after folds", evs("fold").n, evs("fold").usd), split("after cold resumes", evs("coldResume").n, evs("coldResume").usd)],
    components, folds: foldsOf(lines, flags, rows),
  };
}

/** Fold ledger (ledger.ts), grouped by `design foldHint-level`: v2 and v3 give foldHint different meanings, so they are never pooled. */
function foldsOf(lines: any[], flags: Record<string, Record<string, string>>, rows: Map<string, any>): LedgerSection {
  const entries = foldLedger(lines, { flags });
  const group = (e: { root: string; arm: string }): string => (e.arm ? `${designOf(e.arm, rows.get(e.root))} ${flags[e.arm]?.foldHint ?? "–"}` : "(no arm)");
  return summarise(entries, group);
}

// ---- (b) experiment ----------------------------------------------------------------------------

export type Effect = { factor: string; low: string; high: string; nLow: number; nHigh: number; diff: number; lo: number; hi: number };
export type DesignResult = { design: string; factors: string[]; baseline: string; units: number; arms: ArmStat[];
  effects: Effect[]; ols: Fit | null; posterior: Array<{ arm: string; mean: number; sd: number; pBest: number }> };

const DRAWS = 4000;
/** P(best) per arm: share of draws (normal around each arm's reward) in which the arm has the highest reward. */
function pBest(post: Array<{ arm: string; mean: number; sd: number }>): number[] {
  const rng = mulberry32(1);
  const wins = post.map(() => 0);
  for (let i = 0; i < DRAWS && post.length; i++) {
    const draws = post.map((p) => p.mean + p.sd * normal(rng));
    wins[draws.indexOf(Math.max(...draws))] += 1;
  }
  return wins.map((w) => w / DRAWS);
}

/** The design of a meter line: its root session's assignment row names it, else the arm id's length (v1/v2). v2 and v3 share arm ids, so the session decides. */
const designOfLine = (by: Map<string, any>) => (l: any): string => designOf(String(l.arm ?? ""), by.get(l.parentSessionId ?? l.sessionId) ?? by.get(l.sessionId));

function experiment(meter: any[], rows: any[], expSettings: any): DesignResult[] {
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

// ---- (c) delegation & routing ------------------------------------------------------------------

/** One cell of the profile (card kind) × worker tier table; spawns whose cards did not resolve and spot-check reviews are not in it. */
export type ProfileTier = { kind: string; tier: string; tasks: number; accepted: number; partial: number; rejected: number; unjudged: number; acceptance: number;
  /** Subtree cost of the judged tasks ÷ the accepted ones. */
  usd: number; perAccepted: number; escalations: number; checks: { n: number; passed: number }; passRate: number };
/** A group of tasks: acceptance and $ per accepted task (child subtree), each with a bootstrap CI when there are enough judged tasks. */
export type RandomRow = { assigned: "router" | "random"; tier: string; tasks: number; judged: number; accepted: number; acceptance: CI; perAccepted: CI };
export type Randomized = { kinds: string[]; rows: RandomRow[]; otherBase: number };
export type SpotChecks = { requested: number; reviewed: number; agree: number; rate: number; pending: number };

export type Runaway = { sessionId: string; taskId?: string; requests: number; usd: number; reason: string };
export type DelegationSection = { spawns: number; unresolved: number; reviewSpawns: number; qwenShare: number; childUsdShare: number; childRequestShare: number;
  profileTiers: ProfileTier[]; randomized: Randomized; spotChecks: SpotChecks;
  byTier: Array<{ tier: string; spawns: number; share: number; accepted: number; judged: number; acceptance: number; usd: number; perAccepted: number }>;
  byKind: Record<string, number>; childModels: Array<{ model: string; requests: number; usd: number }>;
  escalations: Array<{ from: string; to: string; n: number }>; correctives: number;
  reroutes: Array<{ from: string; to: string; reason: string; n: number }>; checks: { n: number; failed: number };
  runaways: Runaway[]; limits: { requests: number; usd: number } };

const MIN_CI_N = 5; // judged tasks needed for a bootstrap CI of a group
const TIER_RANK: Record<string, number> = { qwen: 0, T1: 1, T2: 2 };
const byTier = (a: string, b: string): number => (TIER_RANK[a] ?? 9) - (TIER_RANK[b] ?? 9) || (a < b ? -1 : a > b ? 1 : 0);
const JUDGED = ["accepted", "partial", "rejected"];

/** acceptance and $ per accepted task of a group of tasks (`cost` = child subtree; undefined without a session), CIs from MIN_CI_N judged tasks on. */
function groupRow(assigned: "router" | "random", tier: string, tasks: Array<{ verdict?: string; cost?: number }>): RandomRow {
  const judged = tasks.filter((t) => t.verdict !== undefined && JUDGED.includes(t.verdict));
  const accepted = judged.filter((t) => t.verdict === "accepted");
  const costed = judged.filter((t) => t.cost !== undefined);
  const acc = (t: { verdict?: string }) => (t.verdict === "accepted" ? 1 : 0);
  const point = (n: number, d: number) => (d ? n / d : NaN);
  const enough = judged.length >= MIN_CI_N;
  const acceptance = enough ? bootstrapRatioCI(judged.map((t) => ({ num: acc(t), den: 1 }))) : { mean: point(accepted.length, judged.length), lo: NaN, hi: NaN, n: judged.length };
  const costedAccepted = costed.filter((t) => t.verdict === "accepted").length;
  const perAccepted = enough && costedAccepted >= 2 ? bootstrapRatioCI(costed.map((t) => ({ num: t.cost!, den: acc(t) }))) : { mean: point(sum(costed.map((t) => t.cost!)), costedAccepted), lo: NaN, hi: NaN, n: costed.length };
  return { assigned, tier, tasks: tasks.length, judged: judged.length, accepted: accepted.length, acceptance, perAccepted };
}

/**
 * Spot checks (an accepted task re-judged by a review child): `requested` = tasks with a `spotcheck` event; a review is `reviewed` when its
 * verdict (`reviewOf` = the original task) and the original's verdict AT THE DRAW (the last one at or before the spotcheck event, else the
 * review spawn; the parent may change its mind afterwards) are both judged; they `agree` when both accept or both do not. `pending` =
 * requested tasks without a judged review.
 */
function spotCheckAgreement(outcomes: any[], spawns: any[]): SpotChecks {
  const at = (e: any) => Date.parse(e.ts);
  const requested = new Map<string, number>();
  for (const e of outcomes) if (e?.event === "spotcheck" && typeof e.taskId === "string" && !requested.has(e.taskId)) requested.set(e.taskId, at(e));
  const verdicts = outcomes.filter((e) => e?.event === "verdict" && typeof e.taskId === "string");
  const reviewSpawnTs = new Map<string, number>(spawns.filter((e) => typeof e.reviewOf === "string").map((e) => [e.reviewOf as string, at(e)]));
  const verdictAt = (taskId: string, when: number | undefined): string | undefined => {
    const own = verdicts.filter((v) => v.taskId === taskId && !(typeof v.reviewOf === "string"));
    const before = when === undefined || Number.isNaN(when) ? own : own.filter((v) => at(v) <= when);
    return (before.at(-1) ?? own[0])?.verdict;
  };
  const lastReview = new Map<string, any>(); // review task → its last verdict event
  for (const v of verdicts) if (typeof v.reviewOf === "string") lastReview.set(v.taskId, v);
  const covered = new Set<string>();
  let agree = 0;
  let reviewed = 0;
  for (const v of lastReview.values()) {
    const orig = verdictAt(v.reviewOf, requested.get(v.reviewOf) ?? reviewSpawnTs.get(v.reviewOf));
    if (!JUDGED.includes(v.verdict) || orig === undefined || !JUDGED.includes(orig)) continue;
    reviewed += 1;
    covered.add(v.reviewOf);
    if ((orig === "accepted") === (v.verdict === "accepted")) agree += 1;
  }
  return { requested: requested.size, reviewed, agree, rate: reviewed ? agree / reviewed : NaN, pending: [...requested.keys()].filter((id) => !covered.has(id)).length };
}

function delegation(meter: any[], outcomes: any[], routerSettings: any): DelegationSection {
  const lines = meter.filter((l) => isLine(l) && typeof l.sessionId === "string");
  const allSpawns = outcomes.filter((e) => e?.event === "spawn" && typeof e.taskId === "string");
  // Spot-check reviews (reviewOf on the spawn or on a verdict) verify another task; spawns whose card files did not resolve say nothing
  // about routing: neither is a routed task. Both stay in the cost shares (the meter does not know them).
  const reviewIds = new Set<string>([...allSpawns.filter((e) => typeof e.reviewOf === "string"), ...outcomes.filter((e) => e?.event === "verdict" && typeof e.reviewOf === "string")].map((e) => e.taskId));
  const unresolved = allSpawns.filter((e) => e.unresolved === true && !reviewIds.has(e.taskId));
  const spawns = allSpawns.filter((e) => e.unresolved !== true && !reviewIds.has(e.taskId));
  const kept = new Set<unknown>(spawns);
  const tierOf = (e: any) => (typeof e.workerTier === "string" ? e.workerTier : "(none)");
  const asTier = outcomes.filter((e) => e?.event !== "spawn" || kept.has(e)).map((e) => (e?.event === "spawn" ? { ...e, arm: tierOf(e) } : e));
  const records = taskRecords(lines, asTier); // task → child subtree cost and last verdict, for the tasks that name a child session
  const spawnOf = new Map<string, any>(spawns.map((e) => [e.taskId as string, e]));
  const lastVerdict = new Map<string, string>();
  for (const e of outcomes) if (e?.event === "verdict" && typeof e.taskId === "string") lastVerdict.set(e.taskId, e.verdict);
  const task = (e: any) => ({ verdict: lastVerdict.get(e.taskId), cost: records.get(e.taskId)?.cost });
  const cells = new Map<string, { kind: string; tier: string; es: any[]; escalations: number; checks: number; passed: number }>();
  const cellOf = (kind: string, tier: string) => cells.get(`${kind}\u0000${tier}`) ?? cells.set(`${kind}\u0000${tier}`, { kind, tier, es: [], escalations: 0, checks: 0, passed: 0 }).get(`${kind}\u0000${tier}`)!;
  for (const e of spawnOf.values()) cellOf(String(e.kind), tierOf(e)).es.push(e);
  for (const e of outcomes) {
    if (e?.event === "escalate") {
      const named = typeof e.attemptOf === "string" ? e.attemptOf : e.taskId; // attemptOf names the task that failed
      const orig = spawnOf.get(named) ?? spawnOf.get(e.taskId);
      const left = !orig && allSpawns.some((x) => x.taskId === named || x.taskId === e.taskId); // an unresolved or review spawn: not routing quality
      if (!left) cellOf(orig ? String(orig.kind) : "(unknown)", typeof e.from === "string" ? e.from : "?").escalations += 1;
    } else if (e?.event === "check" && spawnOf.has(e.taskId)) {
      const c = cellOf(String(spawnOf.get(e.taskId).kind), tierOf(spawnOf.get(e.taskId)));
      c.checks += 1;
      if (e.exit === 0) c.passed += 1;
    }
  }
  const profileTiers: ProfileTier[] = [...cells.values()].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : byTier(a.tier, b.tier))).map((c) => {
    const g = groupRow("router", c.tier, c.es.map(task));
    const count = (v: string) => c.es.filter((e) => lastVerdict.get(e.taskId) === v).length;
    const costed = c.es.map(task).filter((t) => t.verdict !== undefined && JUDGED.includes(t.verdict) && t.cost !== undefined);
    const acceptedCosted = costed.filter((t) => t.verdict === "accepted").length;
    return { kind: c.kind, tier: c.tier, tasks: c.es.length, accepted: g.accepted, partial: count("partial"), rejected: count("rejected"), unjudged: c.es.length - g.judged, acceptance: g.acceptance.mean,
      usd: sum(costed.map((t) => t.cost!)), perAccepted: acceptedCosted ? sum(costed.map((t) => t.cost!)) / acceptedCosted : NaN,
      escalations: c.escalations, checks: { n: c.checks, passed: c.passed }, passRate: c.checks ? c.passed / c.checks : NaN };
  });
  // Randomized comparison: spawns whose router base was qwen, by the tier they actually ran on; the reference is the router's own qwen tasks of the same profiles.
  const randomSpawns = spawns.filter((e) => e.assigned === "random" && e.routeBase === "qwen");
  const kinds = [...new Set(randomSpawns.map((e) => String(e.kind)))].sort();
  const control = spawns.filter((e) => e.assigned !== "random" && tierOf(e) === "qwen" && (e.routeBase === undefined || e.routeBase === "qwen") && kinds.includes(String(e.kind)));
  const randomized: Randomized = {
    kinds, otherBase: spawns.filter((e) => e.assigned === "random" && e.routeBase !== "qwen").length,
    rows: !randomSpawns.length ? [] : [groupRow("router", "qwen", control.map(task)),
      ...[...new Set(randomSpawns.map(tierOf))].sort(byTier).map((tier) => groupRow("random", tier, randomSpawns.filter((e) => tierOf(e) === tier).map(task)))],
  };
  const spotChecks = spotCheckAgreement(outcomes, allSpawns);
  const acc = acceptance(asTier);
  const costs = taskCosts(lines, asTier);
  const tiers = countBy(spawns, tierOf);
  const children = lines.filter((l) => typeof l.parentSessionId === "string");
  const total = sum(lines.map((l) => num(l.costUsd)));
  const requests = (ls: any[]) => ls.filter((l) => l.kind !== "warming").length;
  const group = <K extends string>(es: any[], keys: K[]) => Object.values(es.reduce((m, e) => {
    const k = keys.map((x) => String(e[x])).join("\u0000");
    m[k] ??= { ...Object.fromEntries(keys.map((x) => [x, String(e[x])])), n: 0 };
    m[k].n += 1;
    return m;
  }, {} as Record<string, any>)) as any[];
  const models = new Map<string, { requests: number; usd: number }>();
  for (const l of children) {
    const m = models.get(String(l.model)) ?? models.set(String(l.model), { requests: 0, usd: 0 }).get(String(l.model))!;
    if (l.kind !== "warming") m.requests += 1;
    m.usd += num(l.costUsd);
  }
  const limits = { requests: routerSettings?.runaway?.requests ?? 150, usd: routerSettings?.runaway?.usd ?? 10 };
  const taskOf = new Map(allSpawns.filter((e) => typeof e.sessionId === "string").map((e) => [e.sessionId as string, e.taskId as string]));
  const perChild = new Map<string, any[]>();
  for (const l of children) perChild.set(l.sessionId, [...(perChild.get(l.sessionId) ?? []), l]);
  const runaways: Runaway[] = [];
  for (const [sid, ls] of perChild) {
    const r = requests(ls);
    const usd = sum(ls.map((l) => num(l.costUsd)));
    const why = [r > limits.requests ? `${r} requests > ${limits.requests}` : "", usd > limits.usd ? `$${usd.toFixed(2)} > $${limits.usd}` : ""].filter(Boolean);
    if (why.length) runaways.push({ sessionId: sid, taskId: taskOf.get(sid), requests: r, usd, reason: why.join("; ") });
  }
  const checks = outcomes.filter((e) => e?.event === "check");
  return {
    spawns: allSpawns.length, unresolved: unresolved.length, reviewSpawns: allSpawns.filter((e) => reviewIds.has(e.taskId)).length,
    profileTiers, randomized, spotChecks, qwenShare: spawns.length ? (tiers.qwen ?? 0) / spawns.length : NaN,
    childUsdShare: total ? sum(children.map((l) => num(l.costUsd))) / total : NaN,
    childRequestShare: requests(lines) ? requests(children) / requests(lines) : NaN,
    byTier: Object.entries(tiers).sort((a, b) => b[1] - a[1]).map(([tier, n]) => {
      const a = acc[tier] ?? { accepted: 0, judged: 0 };
      const c = costs[tier];
      return { tier, spawns: n, share: n / spawns.length, accepted: a.accepted, judged: a.judged, acceptance: a.judged ? a.accepted / a.judged : NaN, usd: c?.costUsd ?? 0, perAccepted: c?.perAccepted ?? NaN };
    }),
    byKind: countBy(spawns, (e) => String(e.kind)),
    childModels: [...models].map(([model, m]) => ({ model, ...m })).sort((a, b) => b.usd - a.usd),
    escalations: group(outcomes.filter((e) => e?.event === "escalate"), ["from", "to"]),
    correctives: outcomes.filter((e) => e?.event === "corrective").length,
    reroutes: group(outcomes.filter((e) => e?.event === "reroute"), ["from", "to", "reason"]),
    checks: { n: checks.length, failed: checks.filter((e) => e.exit !== 0).length },
    runaways, limits,
  };
}

// ---- (d) guards --------------------------------------------------------------------------------

export type GuardsSection = { limits: Limits; baselines: Record<string, string>; kill: Record<string, string>;
  perArm: Array<{ design: string; arm: string; units: number; peeks: number; corrections: number; ratings: number[]; accepted: number; judged: number }> };

function guards(designs: DesignResult[], outcomes: any[], events: any[], expSettings: any, rows: Map<string, any>): GuardsSection {
  const g = expSettings?.guards ?? {};
  // Own defaults for experiments' `guards` (a package cannot import another's settings).
  const limits: Limits = { minSessions: g.minSessions ?? 10, threshold: g.threshold ?? 0.2, peekThreshold: g.peekThreshold ?? 1, correctionThreshold: g.correctionThreshold ?? 1, ratingThreshold: g.ratingThreshold ?? 0.5 };
  // v2 and v3 share arm ids: every event and verdict goes to the design of its session (spawn events: the parent's) before it is keyed by arm.
  const designOfEvent = (e: any): string => designOf(String(e?.arm ?? ""), rows.get(e?.sessionId) ?? rows.get(e?.parentSessionId));
  const spawnDesign = new Map(outcomes.filter((e) => e?.event === "spawn" && typeof e.taskId === "string").map((e) => [e.taskId as string, designOfEvent({ ...e, sessionId: undefined })]));
  const per = designs.map((d) => {
    const sig = signals(events.filter((e) => designOfEvent(e) === d.design));
    const acc = acceptance(outcomes.filter((e) => (e?.event === "spawn" ? spawnDesign.get(e.taskId) : spawnDesign.get(e?.taskId)) === d.design));
    return { d, sig, acc };
  });
  return {
    limits,
    baselines: Object.fromEntries(designs.map((d) => [d.design, d.baseline])),
    kill: Object.assign({}, ...per.map(({ d, sig, acc }) => killSwitch(d.arms, acc, limits, d.baseline, sig))),
    perArm: per.flatMap(({ d, sig, acc }) => d.arms.map((s) => ({ design: d.design, arm: s.arm, units: s.units, peeks: sig[s.arm]?.peeks ?? 0, corrections: sig[s.arm]?.corrections ?? 0, ratings: sig[s.arm]?.ratings ?? [], accepted: acc[s.arm]?.accepted ?? 0, judged: acc[s.arm]?.judged ?? 0 }))),
  };
}

// ---- (e) data quality --------------------------------------------------------------------------

export type QualitySection = { period: Period & { first?: string; last?: string };
  logs: Array<{ log: LogName; lines: number; first?: string; last?: string; versions: Record<string, number> }>;
  files: FileInfo[]; withoutArm: { roots: number; usd: number; share: number; assigned: number; examples: string[] };
  unjoinable: Array<{ what: string; n: number; examples: string[] }>;
  piQuota: { q5h: { pi: number; total: number; share: number }; q7d: { pi: number; total: number; share: number } };
  problems: Problem[] };

function quality(all: Logs, logs: Logs, period: Period): QualitySection {
  const meter = logs.meter.filter((l) => isLine(l) && typeof l.sessionId === "string");
  const ts = (ls: any[]) => ls.filter(isLine).map((l) => l.ts as string).sort();
  const span = [...ts(logs.meter), ...ts(logs.outcomes), ...ts(logs.guards)].sort();
  const rows = rowsBySession(all.assignments);
  const armedRoots = new Set(meter.filter((l) => typeof l.arm === "string" && l.arm).map((l) => l.parentSessionId ?? l.sessionId));
  const bare = rootUnits(meter).filter((u) => !armedRoots.has(u.root));
  const total = sum(meter.map((l) => num(l.costUsd)));
  const meterSessions = new Set(all.meter.map((l) => l?.sessionId));
  const spawnAll = all.outcomes.filter((e) => e?.event === "spawn");
  const spawnTasks = new Set(spawnAll.map((e) => e.taskId));
  const spawnParents = new Set(spawnAll.map((e) => e.parentSessionId));
  const spawnChildren = new Set(spawnAll.map((e) => e.sessionId));
  const unspawned = [...new Set(meter.filter((l) => typeof l.parentSessionId === "string" && !spawnChildren.has(l.sessionId)).map((l) => l.sessionId))];
  const spawns = logs.outcomes.filter((e) => e?.event === "spawn");
  const inPer = inPeriod({ meter: [], outcomes: [], guards: all.assignments, assignments: [] }, period).guards;
  const item = (what: string, xs: any[], ex: (x: any) => string) => ({ what, n: xs.length, examples: [...new Set(xs.map(ex))].slice(0, 3) });
  const sets: Record<LogName, any[]> = { meter: logs.meter, outcomes: logs.outcomes, assignments: inPer, guards: logs.guards };
  return {
    period: { ...period, first: span[0], last: span.at(-1) },
    logs: LOGS.map((log) => ({ log, lines: sets[log].length, first: ts(sets[log])[0], last: ts(sets[log]).at(-1), versions: countBy(sets[log], (l) => String(versionOf(l))) })),
    files: all.files ?? [],
    withoutArm: { roots: bare.length, usd: sum(bare.map((u) => u.cost)), share: total ? sum(bare.map((u) => u.cost)) / total : NaN, assigned: bare.filter((u) => rows.has(u.root)).length, examples: bare.slice(0, 3).map((u) => u.root) },
    unjoinable: [
      item("meter child lines whose parent session is unknown", meter.filter((l) => typeof l.parentSessionId === "string" && !meterSessions.has(l.parentSessionId) && !spawnParents.has(l.parentSessionId)), (l) => l.parentSessionId),
      item("child sessions without a spawn event (their $ is in no tier)", unspawned, (s) => String(s)),
      item("spawns without a child session id", spawns.filter((e) => typeof e.sessionId !== "string"), (e) => e.taskId),
      item("spawns whose child session has no meter line", spawns.filter((e) => typeof e.sessionId === "string" && !meterSessions.has(e.sessionId)), (e) => e.sessionId),
      item("task events without a spawn", logs.outcomes.filter((e) => e?.event !== "spawn" && !spawnTasks.has(e?.taskId)), (e) => String(e?.taskId)),
      item("guard events of sessions without meter lines", logs.guards.filter((e) => !meterSessions.has(e?.sessionId)), (e) => String(e?.sessionId)),
      item("assignments of sessions without meter lines", inPer.filter((r) => !meterSessions.has(r?.sessionId)), (r) => String(r?.sessionId)),
    ],
    piQuota: { q5h: quotaShare(meter, "q5h"), q7d: quotaShare(meter, "q7d") },
    problems: check({ ...logs, assignments: inPer }, all),
  };
}

// ---- entry points ------------------------------------------------------------------------------

export type Analysis = { period: Period; cost: CostSection; experiment: { designs: DesignResult[] }; delegation: DelegationSection; guards: GuardsSection; quality: QualitySection };

export function analyse(all: Logs, period: Period = {}): Analysis {
  const logs = inPeriod(all, period);
  const designs = experiment(logs.meter, all.assignments, all.expSettings);
  const flags = Object.fromEntries([...armInfo([...new Set(logs.meter.filter((l) => typeof l?.arm === "string").map((l) => l.arm))], all.assignments)].map(([a, i]) => [a, i.flags]));
  return {
    period,
    cost: cost(logs.meter, logs.outcomes, flags, rowsBySession(all.assignments)),
    experiment: { designs },
    delegation: delegation(logs.meter, logs.outcomes, all.routerSettings),
    guards: guards(designs, logs.outcomes, logs.guards, all.expSettings, rowsBySession(all.assignments)),
    quality: quality(all, logs, period),
  };
}

/** experiments/state.json after `--apply`: the kill-switch arms added to the disabled ones, a fresh posterior over every design's arms. */
// Arm ids repeat across designs (v2, v3): the newest design's stats shadow an older one's, so the posterior is the current experiment's.
export const applyKill = (old: any, a: Analysis) => nextState(old, [...new Map(a.experiment.designs.flatMap((d) => d.arms).map((s) => [s.arm, s])).values()], a.guards.kill);

// ---- markdown ----------------------------------------------------------------------------------

const f2 = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : "–");
const pc = (n: number): string => (Number.isFinite(n) ? `${Math.round(100 * n)}%` : "–");
const ci = (c: { lo: number; hi: number }) => (Number.isFinite(c.lo) ? `${f2(c.lo)} – ${f2(c.hi)}` : "–");
const table = (head: string[], rows: string[][]): string =>
  [`| ${head.join(" | ")} |`, "|" + " --- |".repeat(head.length), ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const NO_DATA = "_no data in the period_";

function renderCost(c: CostSection): string {
  if (!c.requests && !c.warming) return NO_DATA;
  return [
    table(["metric", "value"], [
      ["total $", f2(c.totalUsd)], ["requests (warming)", `${c.requests} (${c.warming})`], ["root sessions", String(c.units)], ["active hours", f2(c.activeHours)],
      ["$/active hour (95% CI)", `${f2(c.usdPerHour.mean)} (${ci(c.usdPerHour)})`], ["q5h %/active hour", f2(c.q5hPerHour)], ["q7d %/active hour", f2(c.q7dPerHour)],
      ["$/accepted task (accepted/judged)", `${f2(c.perAccepted.perAccepted)} (${c.perAccepted.accepted}/${c.perAccepted.judged})`],
    ]),
    "\n### By model\n", table(["model", "requests", "$", "share", "$/active h"], c.byModel.map((m) => [m.model, String(m.requests), f2(m.usd), pc(m.share), f2(m.perHour)])),
    "\n### Splits\n\nSplits overlap (a rewrite can follow a fold); fold and cold-resume rows charge the 3 requests from the event on; cache rewrite = cache-write $ of every request but a session's first, split from the line's cost by Anthropic price ratios.\n",
    table(["split", "n", "$", "share", "$/active h"], c.splits.map((s) => [s.name, String(s.n), f2(s.usd), pc(s.share), f2(s.perHour)])),
    "\n### Token components (≈, by Anthropic price ratios)\n", table(["component", "$"], Object.entries(c.components).map(([k, v]) => [k, f2(v)])),
    renderFolds(c.folds),
  ].join("\n");
}

const f4 = (n: number): string => (Number.isFinite(n) ? n.toFixed(4) : "–");

function renderFolds(f: LedgerSection): string {
  if (!f.n) return "\n### Fold ledger\n\n_no folds in Claude sessions in the period_";
  const rows = (rs: LedgerSection["byDepth"]) => rs.map((r) => [r.name, String(r.n), f4(r.savingsUsd), f4(r.rewriteUsd), f4(r.netUsd), pc(r.negativeShare)]);
  const head = (first: string) => [first, "folds", "cache-read $ saved", "rewrite $ paid", "net $", "share net < 0"];
  return [
    "\n### Fold ledger (Claude models)\n",
    "Per detected fold (a non-warming request whose prompt, input + cacheRead + cacheWrite, fell below 80% of the previous one's): R = tokens removed; K ≈ the first request's cacheWrite minus the session's typical write (median of its non-first, non-fold, non-cold turns), 0 for a fold after a cold gap; n = requests after the fold until the session ends or the next cold gap (≥ 5 min, ≥ 60 min in a mainCacheTtl 1h arm; warming counts); r and w = the model's cache read and write price per token (0.1 and 1.25 × the input price recovered from the lines' costUsd). **Net = n·R·r − K·(w − r)** = cache-read $ saved − rewrite $ paid. Counterfactual only: it assumes the fold changed nothing else (output, later tool use, task path) and that an unfolded prompt would have kept being read at r; folds overlap in time but each is valued alone.\n",
    table(["metric", "value"], [["folds (after a cold gap)", `${f.n} (${f.cold})`], ["cache-read $ saved", f4(f.savingsUsd)], ["rewrite $ paid", f4(f.rewriteUsd)], ["net $", f4(f.netUsd)], ["share with net < 0", `${pc(f.negativeShare)} (${f.negative}/${f.n})`]]),
    "\nBy fold depth K/R (rewritten tokens per token removed; break-even ≈ n/11.5):\n", table(head("K/R"), rows(f.byDepth)),
    "\nBy design and foldHint level (v2 and v3 differ in what cache-aware means: never pooled):\n", table(head("group"), rows(f.byGroup)),
    "\nBy model:\n", table(head("model"), rows(f.byModel)),
  ].join("\n");
}

function renderExperiment(ds: DesignResult[]): string {
  if (!ds.length) return `${NO_DATA}: no meter line carries an arm`;
  const pooled = ds.some((d) => d.design === "v2") && ds.some((d) => d.design === "v3");
  return (pooled ? "Designs v2 and v3 have the same factors and arm ids, but foldHint = cache-aware means something else in v3 (a system-prompt paragraph): they are analysed in separate tables and never pooled; guard signals and the kill switch are per design too.\n\n" : "") + ds.map((d) => [
    `### Design ${d.design} (${d.factors.length} factors, baseline \`${d.baseline}\`, ${d.units} units with ≥ ${MIN_HOURS} active h)\n`,
    "Effect = mean $/active hour of the units at the high level − at the low level (bootstrap 95% CI); negative is cheaper.\n",
    table(["factor", "low → high", "n low", "n high", "Δ $/h", "95% CI"], d.effects.map((e) => [e.factor, `${e.low} → ${e.high}`, String(e.nLow), String(e.nHigh), f2(e.diff), ci(e)])),
    d.ols ? `\nOLS with two-way interactions (n ${d.ols.n}, df ${d.ols.df}, R² ${f2(d.ols.r2)}${d.ols.aliased.length ? `; aliased or not estimable: ${d.ols.aliased.join(", ")}` : ""}):\n\n` +
      table(["term", "coef", "se"], d.ols.terms.map((t) => [t.name, f2(t.coef), t.se === null ? "–" : f2(t.se)])) : "\nOLS: too few units.",
    "\n",
    table(["arm", "units", "active h", "$/h", "95% CI", "posterior reward", "sd", "P(best)"], d.arms.map((s) => {
      const p = d.posterior.find((x) => x.arm === s.arm);
      return [`\`${s.arm}\``, String(s.units), f2(s.activeHours), f2(s.costPerHour), ci({ lo: s.ci[0], hi: s.ci[1] }), p ? f2(p.mean) : "–", p ? f2(p.sd) : "–", p ? pc(p.pBest) : "–"];
    })),
  ].join("\n")).join("\n\n");
}

const withCI = (c: CI, fmt: (n: number) => string): string => (Number.isFinite(c.mean) ? `${fmt(c.mean)}${Number.isFinite(c.lo) ? ` (${fmt(c.lo)} – ${fmt(c.hi)})` : ""}` : "–");

function renderRandomized(r: Randomized): string {
  if (!r.rows.length) return "\n### Randomized routing\n\n_no randomized spawns in the period_ (`assigned: \"random\"` on the spawn events)";
  return [
    `\n### Randomized routing (spawns the router sent to qwen)\n`,
    `Spawns whose router base was qwen, by the tier they actually ran on (${r.kinds.join(", ")}); 95% bootstrap CIs from ${MIN_CI_N} judged tasks on. **Causal only for the random subset**: comparing random tiers with one another is a randomized comparison; the router row (the router's own qwen tasks of the same profiles: assigned = router, or absent in old lines) was chosen, not randomized, so it can differ in task difficulty.\n`,
    table(["assigned", "actual tier", "tasks", "accepted/judged", "acceptance (95% CI)", "$/accepted (95% CI)"],
      r.rows.map((x) => [x.assigned, x.tier, String(x.tasks), `${x.accepted}/${x.judged}`, withCI(x.acceptance, pc), withCI(x.perAccepted, f2)])),
    r.otherBase ? `\n${r.otherBase} randomized spawn(s) with another router base are not compared.` : "",
  ].join("\n");
}

function renderSpotChecks(s: SpotChecks): string {
  if (!s.requested && !s.reviewed) return "\n### Spot checks\n\n_no spot checks in the period_ (`spotcheck` events, `reviewOf` on spawn and verdict lines)";
  return [
    "\n### Spot checks\n\nAn accepted task re-judged by a review child: agreement = the original verdict (at the draw) and the review verdict both accept or both do not.\n",
    table(["requested", "reviewed (judged)", "agree", "agreement", "pending"], [[String(s.requested), String(s.reviewed), String(s.agree), pc(s.rate), String(s.pending)]]),
  ].join("\n");
}

function renderDelegation(d: DelegationSection): string {
  if (!d.spawns && Number.isNaN(d.childUsdShare)) return NO_DATA;
  return [
    table(["metric", "value"], [
      ["spawned tasks (spot-check reviews; unresolved cards)", `${d.spawns} (${d.reviewSpawns}; ${d.unresolved})`], ["child sessions' share of $", pc(d.childUsdShare)], ["child sessions' share of requests", pc(d.childRequestShare)],
      ["Qwen share of tasks (SC3: ≥ 30%)", pc(d.qwenShare)], ["escalations", String(sum(d.escalations.map((e) => e.n)))], ["correctives", String(d.correctives)],
      ["checks (failed)", `${d.checks.n} (${d.checks.failed})`], ["reroutes", String(sum(d.reroutes.map((r) => r.n)))],
      ["kinds", Object.entries(d.byKind).map(([k, n]) => `${k} ${n}`).join(", ") || "–"],
    ]),
    "\n### By tier\n\nSpot-check reviews and spawns whose card files did not resolve (`unresolved`) are left out of every table below: they say nothing about routing quality.\n",
    table(["tier", "tasks", "share", "accepted/judged", "acceptance", "$", "$/accepted"], d.byTier.map((t) => [t.tier, String(t.spawns), pc(t.share), `${t.accepted}/${t.judged}`, pc(t.acceptance), f2(t.usd), f2(t.perAccepted)])),
    "\n### By profile and tier\n\nProfile = the card kind; acceptance = accepted ÷ judged; $/accepted = subtree cost of the judged tasks ÷ accepted ones; escalations = re-spawns one tier up from this tier; checks = the card's check ran after the child reported.\n",
    table(["profile", "tier", "tasks", "accepted", "partial", "rejected", "unjudged", "acceptance", "$/accepted", "escalations", "checks passed"],
      d.profileTiers.map((c) => [c.kind, c.tier, String(c.tasks), String(c.accepted), String(c.partial), String(c.rejected), String(c.unjudged), pc(c.acceptance), f2(c.perAccepted), String(c.escalations), c.checks.n ? `${c.checks.passed}/${c.checks.n} (${pc(c.passRate)})` : "–"])),
    renderRandomized(d.randomized), renderSpotChecks(d.spotChecks),
    "\n### Child models\n", table(["model", "requests", "$"], d.childModels.map((m) => [m.model, String(m.requests), f2(m.usd)])),
    d.escalations.length ? "\n### Escalations\n\n" + table(["from", "to", "n"], d.escalations.map((e) => [e.from, e.to, String(e.n)])) : "",
    d.reroutes.length ? "\n### Reroutes\n\n" + table(["from", "to", "reason", "n"], d.reroutes.map((r) => [r.from, r.to, r.reason, String(r.n)])) : "",
    `\n### Runaway alerts (limits: ${d.limits.requests} requests, $${d.limits.usd} per child session)\n`,
    d.runaways.length ? table(["session", "task", "requests", "$", "why"], d.runaways.map((r) => [r.sessionId, r.taskId ?? "–", String(r.requests), f2(r.usd), r.reason])) : "none",
  ].join("\n");
}

function renderGuards(g: GuardsSection): string {
  if (!g.perArm.length) return NO_DATA;
  const per = (n: number, u: number) => (u ? f2(n / u) : "–");
  const rating = (r: number[]) => (r.length ? `${(sum(r) / r.length).toFixed(1)} (${r.length})` : "–");
  const l = g.limits;
  return [
    table(["design", "arm", "units", "peeks after mask /unit", "corrections /unit", "rating (n)", "accepted/judged"], g.perArm.map((a) => [a.design, `\`${a.arm}\``, String(a.units), per(a.peeks, a.units), per(a.corrections, a.units), rating(a.ratings), `${a.accepted}/${a.judged}`])),
    `\nKill switch (baseline per design: ${Object.entries(g.baselines).map(([d, b]) => `${d} \`${b}\``).join(", ")}; ≥ ${l.minSessions} units; acceptance worse by > ${pc(l.threshold)}, peeks/corrections more by > ${l.peekThreshold}/${l.correctionThreshold} per unit, rating lower by > ${l.ratingThreshold}). Written to experiments/state.json only with \`pi-analyse --apply\`.\n`,
    Object.keys(g.kill).length ? Object.entries(g.kill).map(([a, r]) => `- disable \`${a}\`: ${r}`).join("\n") : "- no arm would be disabled",
  ].join("\n");
}

function renderQuality(q: QualitySection): string {
  const share = (x: { pi: number; total: number; share: number }) => [String(x.pi), String(x.total), pc(x.share)];
  return [
    `Period: ${q.period.since ?? "start"} – ${q.period.until ?? "now"}; lines from ${q.period.first ?? "–"} to ${q.period.last ?? "–"}.\n`,
    table(["log", "lines", "first", "last", "schema versions (v: lines)"], q.logs.map((l) => [l.log, String(l.lines), l.first ?? "–", l.last ?? "–", Object.entries(l.versions).map(([v, n]) => `v${v}: ${n}`).join(", ") || "–"])),
    q.files.some((f) => f.unparsable) ? "\nUnparsable lines: " + q.files.filter((f) => f.unparsable).map((f) => `${f.file} ${f.unparsable}`).join(", ") : "",
    `\nRoot sessions without an arm: ${q.withoutArm.roots} (${f2(q.withoutArm.usd)} $, ${pc(q.withoutArm.share)} of cost; ${q.withoutArm.assigned} of them have an assignment row)${q.withoutArm.examples.length ? `, e.g. ${q.withoutArm.examples.join(", ")}` : ""}.\n`,
    table(["unjoinable", "n", "examples"], q.unjoinable.map((u) => [u.what, String(u.n), u.examples.join(", ") || "–"])),
    "\nPi share of the account quota (rises between pi requests < 30 min apart ÷ all rises seen per window; other use during pi activity counts as pi):\n",
    table(["window", "pi points", "account points", "pi share"], [["5 h", ...share(q.piQuota.q5h)], ["7 d", ...share(q.piQuota.q7d)]]),
    `\nContract (\`pi-analyse --check\`): ${q.problems.length ? "\n\n" + q.problems.map((p) => `- ${p.log}: ${p.count} line(s) miss \`${p.field}\` (${p.why}; e.g. ${p.example})`).join("\n") : "every required field present"}`,
  ].join("\n");
}

/** Report file stem: `<YYYY-MM-DD>-<HHMM>-analysis` in UTC, so runs of one day (even of the same hour) keep their reports; a rerun within the same minute replaces it. */
export const reportName = (now: Date): string => `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 16).replace(":", "")}-analysis`;

export function renderAnalysis(a: Analysis, generated = new Date()): string {
  return [
    `# pi analysis — ${a.period.since ?? "start"} to ${a.period.until ?? "now"}`,
    `\nGenerated ${generated.toISOString()} by pi-analyse; field meanings in <agentDir>/LOGS.md. Caveats: quota is the whole account's, in 1% steps; units are root sessions (small samples, task mix varies between them); $ per active hour counts gaps < 30 min as active.`,
    "\n## Cost\n", renderCost(a.cost),
    "\n## Experiment\n", renderExperiment(a.experiment.designs),
    "\n## Delegation & routing\n", renderDelegation(a.delegation),
    "\n## Guards\n", renderGuards(a.guards),
    "\n## Data quality\n", renderQuality(a.quality),
  ].join("\n") + "\n";
}
