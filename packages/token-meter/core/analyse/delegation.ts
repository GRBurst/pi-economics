// (c) delegation & routing: tiers, profiles, randomized routing, spot checks, escalations, reroutes, runaways.
// The tier of a task is the model it ran on (B6), not the tier the router planned for it.
import { isError, push } from "../arms.ts";
import { acceptance } from "../guards.ts";
import { levelsOfLine, type LevelsContext } from "../levels.ts";
import { taskCosts, taskRecords } from "../tasks.ts";
import { bootstrapRatioCI, type CI } from "../stats.ts";
import { byTs, countBy, isLine, sum } from "./logs.ts";
import { apiUsd } from "./units.ts";

/** One cell of the profile (card kind) × worker tier table; spawns whose cards did not resolve and spot-check reviews are not in it. */
export type ProfileTier = { kind: string; tier: string; tasks: number; accepted: number; partial: number; rejected: number; unjudged: number; acceptance: number;
  /** Subtree cost of the judged tasks ÷ the accepted ones. */
  usd: number; perAccepted: number; escalations: number; checks: { n: number; passed: number }; passRate: number };
/** A group of tasks: acceptance and $ per accepted task (child subtree), each with a bootstrap CI when there are enough judged tasks. */
export type RandomRow = { assigned: "router" | "random"; tier: string; tasks: number; judged: number; accepted: number; acceptance: CI; perAccepted: CI };
export type Randomized = { kinds: string[]; rows: RandomRow[]; otherBase: number };
export type SpotChecks = { requested: number; reviewed: number; agree: number; rate: number; pending: number };

export type Runaway = { sessionId: string; taskId?: string; requests: number; usd: number; reason: string };
/** How many of the routed tasks, by the tier the router planned and the model they ran on (B6). */
export type MatrixCell = { planned: string; executed: string; n: number };
export type DelegationSection = { spawns: number; unresolved: number; reviewSpawns: number; qwenShare: number; childUsdShare: number; childRequestShare: number;
  profileTiers: ProfileTier[]; matrix: MatrixCell[]; randomized: Randomized; spotChecks: SpotChecks;
  byTier: Array<{ tier: string; spawns: number; share: number; accepted: number; judged: number; acceptance: number; usd: number; perAccepted: number }>;
  byKind: Record<string, number>; childModels: Array<{ model: string; requests: number; usd: number }>;
  escalations: Array<{ from: string; to: string; n: number }>; correctives: number;
  reroutes: Array<{ from: string; to: string; reason: string; n: number }>; checks: { n: number; failed: number };
  runaways: Runaway[]; limits: { requests: number; usd: number } };

export const MIN_CI_N = 5; // judged tasks needed for a bootstrap CI of a group
const TIER_RANK: Record<string, number> = { qwen: 0, haiku: 1, T1: 2, T2: 3 };
/** The tier of an `escalate.from` route label (router 2026-10-17: the Qwen members' routes are `local` and `cloud`; `haiku`,
 *  `T1`, `T2` are their own tiers); anything else, `"?"` included, as written. */
const routeTier = (r: unknown): string => (r === "local" || r === "cloud" ? "qwen" : typeof r === "string" ? r : "?");
const JUDGED = ["accepted", "partial", "rejected"];
const tierOf = (e: any): string => (typeof e.workerTier === "string" ? e.workerTier : "(none)");

/** A spawned task: the tier the router planned, the model it ran on, what it cost (the child's subtree) and the parent's last verdict. */
export type TaskRow = { taskId: string; kind: string; planned: string; executed: string; ranModel?: string; cls: "routed" | "unresolved" | "review";
  verdict?: string; cost?: number; spawn: any };

/** The model name of a request line: `provider/model`, as the router writes it (`workerModel`). */
const modelName = (l: any): string => (typeof l.provider === "string" && l.provider ? `${l.provider}/${l.model}` : String(l.model));

/**
 * The model a task ran on (B6): the router's own account, `ranModel` (its `workerModel`, after the last reroute; `levelsOfLine`), else the
 * model of the child's last request, warming and errors aside; "(unknown)" when neither is known.
 */
export function executedTier(t: { ranModel?: string }, childLines: readonly any[]): string {
  if (t.ranModel !== undefined) return t.ranModel;
  const last = childLines.filter((l) => l.kind !== "warming" && !isError(l)).sort(byTs).at(-1);
  return last === undefined ? "(unknown)" : modelName(last);
}

/** The spawns by taskId and each task's last reroute, as `levelsOfLine` reads them. */
export function levelsContext(outcomes: any[]): LevelsContext {
  const spawns = new Map<string, any>();
  const lastReroute = new Map<string, any>();
  for (const e of outcomes) {
    if (e?.event === "spawn" && typeof e.taskId === "string") spawns.set(e.taskId, e);
  }
  for (const e of outcomes.filter((x) => x?.event === "reroute" && typeof x.taskId === "string" && isLine(x)).sort(byTs)) lastReroute.set(e.taskId, e);
  return { spawns, lastReroute };
}

/**
 * One row per spawned task (the last spawn of a taskId): spot-check reviews (`reviewOf` on the spawn or on a verdict) verify another
 * task and spawns whose card files did not resolve say nothing about routing; neither is a routed task. `cost` is the child subtree's `apiUsd`
 * (undefined without a child session id).
 */
export function taskRows(lines: any[], outcomes: any[]): TaskRow[] {
  const spawns = outcomes.filter((e) => e?.event === "spawn" && typeof e.taskId === "string");
  const verdicts = outcomes.filter((e) => e?.event === "verdict" && typeof e.taskId === "string");
  const reviewIds = new Set<string>([...spawns.filter((e) => typeof e.reviewOf === "string"), ...verdicts.filter((e) => typeof e.reviewOf === "string")].map((e) => e.taskId));
  const lastVerdict = new Map<string, string>(verdicts.map((e) => [e.taskId, e.verdict]));
  const records = taskRecords(lines, [...spawns.map((e) => ({ ...e, arm: "" })), ...verdicts]); // taskRecords wants an arm; the tier comes from the row
  const bySession = new Map<string, any[]>();
  for (const l of lines) if (typeof l?.sessionId === "string") push(bySession, l.sessionId, l);
  const ctx = levelsContext(outcomes);
  const rows = new Map<string, TaskRow>();
  for (const e of spawns) {
    const row: TaskRow = { taskId: e.taskId, kind: String(e.kind), planned: tierOf(e), executed: "", ranModel: levelsOfLine(e, ctx).ranModel,
      cls: reviewIds.has(e.taskId) ? "review" : e.unresolved === true ? "unresolved" : "routed", verdict: lastVerdict.get(e.taskId), cost: records.get(e.taskId)?.cost, spawn: e };
    row.executed = executedTier(row, typeof e.sessionId === "string" ? bySession.get(e.sessionId) ?? [] : []);
    rows.set(e.taskId, row);
  }
  return [...rows.values()];
}

/**
 * The models of the rows in report order: by the planned tier most of their tasks were planned on (qwen, haiku, T1, T2; a tie goes to the
 * lower), then by name; a model no row ran on (an escalation's) comes last.
 */
function tierOrder(rows: readonly TaskRow[]): (a: string, b: string) => number {
  const planned = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = planned.get(r.executed) ?? planned.set(r.executed, new Map()).get(r.executed)!;
    m.set(r.planned, (m.get(r.planned) ?? 0) + 1);
  }
  const rank = new Map<string, number>();
  for (const [model, m] of planned) {
    const [top] = [...m].sort((x, y) => y[1] - x[1] || (TIER_RANK[x[0]] ?? 9) - (TIER_RANK[y[0]] ?? 9));
    rank.set(model, TIER_RANK[top[0]] ?? 9);
  }
  return (a, b) => (rank.get(a) ?? 9) - (rank.get(b) ?? 9) || (a < b ? -1 : a > b ? 1 : 0);
}

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

export function delegation(meter: any[], outcomes: any[], routerSettings: any): DelegationSection {
  const lines = meter.filter((l) => isLine(l) && typeof l.sessionId === "string");
  const allSpawns = outcomes.filter((e) => e?.event === "spawn" && typeof e.taskId === "string");
  // Spot-check reviews and unresolved cards are no routed tasks (taskRows); both stay in the cost shares (the meter does not know them).
  const rows = taskRows(lines, outcomes);
  const routed = rows.filter((r) => r.cls === "routed");
  const reviewIds = new Set(rows.filter((r) => r.cls === "review").map((r) => r.taskId));
  const unresolved = allSpawns.filter((e) => e.unresolved === true && !reviewIds.has(e.taskId));
  const spawns = routed.map((r) => r.spawn);
  const kept = new Set<unknown>(spawns);
  const rowOf = new Map<string, TaskRow>(rows.map((r) => [r.taskId, r]));
  const ranOn = (e: any): string => rowOf.get(e.taskId)!.executed;
  const asTier = outcomes.filter((e) => e?.event !== "spawn" || kept.has(e)).map((e) => (e?.event === "spawn" ? { ...e, arm: ranOn(e) } : e));
  const order = tierOrder(routed);
  const spawnOf = new Map<string, any>(spawns.map((e) => [e.taskId as string, e]));
  const task = (e: any) => ({ verdict: rowOf.get(e.taskId)!.verdict, cost: rowOf.get(e.taskId)!.cost });
  const cells = new Map<string, { kind: string; tier: string; es: any[]; escalations: number; checks: number; passed: number }>();
  const cellOf = (kind: string, tier: string) => cells.get(`${kind}\u0000${tier}`) ?? cells.set(`${kind}\u0000${tier}`, { kind, tier, es: [], escalations: 0, checks: 0, passed: 0 }).get(`${kind}\u0000${tier}`)!;
  for (const e of spawnOf.values()) cellOf(String(e.kind), ranOn(e)).es.push(e);
  const ctx = levelsContext(outcomes);
  for (const e of outcomes) {
    if (e?.event === "escalate") {
      const named = typeof e.attemptOf === "string" ? e.attemptOf : e.taskId; // attemptOf names the task that failed
      const orig = spawnOf.get(named) ?? spawnOf.get(e.taskId);
      const left = !orig && allSpawns.some((x) => x.taskId === named || x.taskId === e.taskId); // an unresolved or review spawn: not routing quality
      // Keyed like the cells (RG9): the failed task's (kind, model it ran on); without its spawn, the model the escalation left (fromModel), else `from`'s route mapped to a tier.
      if (!left) (orig ? cellOf(String(orig.kind), ranOn(orig)) : cellOf("(unknown)", levelsOfLine(e, ctx).fromModel ?? routeTier(e.from))).escalations += 1;
    } else if (e?.event === "check" && spawnOf.has(e.taskId)) {
      const c = cellOf(String(spawnOf.get(e.taskId).kind), ranOn(spawnOf.get(e.taskId)));
      c.checks += 1;
      if (e.exit === 0) c.passed += 1;
    }
  }
  const profileTiers: ProfileTier[] = [...cells.values()].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : order(a.tier, b.tier))).map((c) => {
    const g = groupRow("router", c.tier, c.es.map(task));
    const count = (v: string) => c.es.filter((e) => task(e).verdict === v).length;
    const costed = c.es.map(task).filter((t) => t.verdict !== undefined && JUDGED.includes(t.verdict) && t.cost !== undefined);
    const acceptedCosted = costed.filter((t) => t.verdict === "accepted").length;
    return { kind: c.kind, tier: c.tier, tasks: c.es.length, accepted: g.accepted, partial: count("partial"), rejected: count("rejected"), unjudged: c.es.length - g.judged, acceptance: g.acceptance.mean,
      usd: sum(costed.map((t) => t.cost!)), perAccepted: acceptedCosted ? sum(costed.map((t) => t.cost!)) / acceptedCosted : NaN,
      escalations: c.escalations, checks: { n: c.checks, passed: c.passed }, passRate: c.checks ? c.passed / c.checks : NaN };
  });
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  const matrix: MatrixCell[] = Object.entries(countBy(routed, (r) => `${r.planned}\u0000${r.executed}`))
    .map(([k, n]) => ({ planned: k.split("\u0000")[0], executed: k.split("\u0000")[1], n }))
    .sort((x, y) => (TIER_RANK[x.planned] ?? 9) - (TIER_RANK[y.planned] ?? 9) || cmp(x.planned, y.planned) || cmp(x.executed, y.executed));
  // Randomized comparison: spawns whose router base was qwen, by the tier they actually ran on; the reference is the router's own qwen tasks of the same profiles.
  const randomSpawns = spawns.filter((e) => e.assigned === "random" && e.routeBase === "qwen");
  const kinds = [...new Set(randomSpawns.map((e) => String(e.kind)))].sort();
  const control = spawns.filter((e) => e.assigned !== "random" && tierOf(e) === "qwen" && (e.routeBase === undefined || e.routeBase === "qwen") && kinds.includes(String(e.kind)));
  const randomized: Randomized = {
    kinds, otherBase: spawns.filter((e) => e.assigned === "random" && e.routeBase !== "qwen").length,
    rows: !randomSpawns.length ? [] : [groupRow("router", "qwen", control.map(task)),
      ...[...new Set(randomSpawns.map(ranOn))].sort(order).map((tier) => groupRow("random", tier, randomSpawns.filter((e) => ranOn(e) === tier).map(task)))],
  };
  const spotChecks = spotCheckAgreement(outcomes, allSpawns);
  const acc = acceptance(asTier);
  const costs = taskCosts(lines, asTier);
  const tiers = countBy(spawns, ranOn);
  const children = lines.filter((l) => typeof l.parentSessionId === "string");
  const total = sum(lines.map((l) => apiUsd(l)));
  const requests = (ls: any[]) => ls.filter((l) => l.kind !== "warming" && !isError(l)).length;
  const group = <K extends string>(es: any[], keys: K[]) => Object.values(es.reduce((m, e) => {
    const k = keys.map((x) => String(e[x])).join("\u0000");
    m[k] ??= { ...Object.fromEntries(keys.map((x) => [x, String(e[x])])), n: 0 };
    m[k].n += 1;
    return m;
  }, {} as Record<string, any>)) as any[];
  const models = new Map<string, { requests: number; usd: number }>();
  for (const l of children) {
    const m = models.get(String(l.model)) ?? models.set(String(l.model), { requests: 0, usd: 0 }).get(String(l.model))!;
    if (l.kind !== "warming" && !isError(l)) m.requests += 1;
    m.usd += apiUsd(l);
  }
  const limits = { requests: routerSettings?.runaway?.requests ?? 150, usd: routerSettings?.runaway?.usd ?? 10 };
  const taskOf = new Map(allSpawns.filter((e) => typeof e.sessionId === "string").map((e) => [e.sessionId as string, e.taskId as string]));
  const perChild = new Map<string, any[]>();
  for (const l of children) push(perChild, l.sessionId, l);
  const runaways: Runaway[] = [];
  for (const [sid, ls] of perChild) {
    const r = requests(ls);
    const usd = sum(ls.map((l) => apiUsd(l)));
    const why = [r > limits.requests ? `${r} requests > ${limits.requests}` : "", usd > limits.usd ? `$${usd.toFixed(2)} > $${limits.usd}` : ""].filter(Boolean);
    if (why.length) runaways.push({ sessionId: sid, taskId: taskOf.get(sid), requests: r, usd, reason: why.join("; ") });
  }
  const checks = outcomes.filter((e) => e?.event === "check");
  return {
    spawns: allSpawns.length, unresolved: unresolved.length, reviewSpawns: allSpawns.filter((e) => reviewIds.has(e.taskId)).length,
    profileTiers, matrix, randomized, spotChecks, qwenShare: routed.length ? routed.filter((r) => r.planned === "qwen").length / routed.length : NaN,
    childUsdShare: total ? sum(children.map((l) => apiUsd(l))) / total : NaN,
    childRequestShare: requests(lines) ? requests(children) / requests(lines) : NaN,
    byTier: Object.entries(tiers).sort((a, b) => b[1] - a[1] || order(a[0], b[0])).map(([tier, n]) => {
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
