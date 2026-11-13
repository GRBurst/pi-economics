// pi-analyse's delegation section per profile (card kind) × tier, the randomized comparison among spawns the router
// would have sent to Qwen, and spot-check agreement. Synthetic fixtures; every number is computed by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, renderAnalysis, type Logs } from "../core/analyse.ts";
import { costPerAccepted, executedTier, taskRows } from "../core/analyse/delegation.ts";
import { check } from "../core/contract.ts";
import { iso, MIN, T0, turn } from "./world.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** The model a child of each planned tier runs on in these fixtures (B6: the tier of a task is the model it ran on). The old lines' route labels map to the same names. */
const RAN: Record<string, [provider: string, model: string]> = { qwen: ["llama", "qwen3.8"], haiku: ["p-api", "haiku"], T1: ["anthropic", "claude-sonnet-5-5"], T2: ["anthropic", "claude-opus-5-5"] };
const EXEC = Object.fromEntries(Object.entries(RAN).map(([tier, [p, m]]) => [tier, `${p}/${m}`])) as Record<"qwen" | "haiku" | "T1" | "T2", string>;

type Task = { id: string; kind?: string; tier?: string; /** The provider and model of the child's meter lines, if not the planned tier's. */ ran?: [string, string]; cost?: number; verdict?: string; spawn?: Record<string, unknown>; verdictExtra?: Record<string, unknown> };
/** Spawn events (+ one child meter line of `cost` $ each, + a verdict when given) of the tasks, one minute apart; extra events appended. */
function logsOf(tasks: Task[], events: Record<string, unknown>[] = [], meter: Record<string, unknown>[] = []): Logs {
  const outcomes: Record<string, unknown>[] = [];
  tasks.forEach((t, i) => {
    const at = T0 + i * MIN;
    const [provider, model] = t.ran ?? RAN[t.tier ?? "qwen"];
    meter.push(turn(`c-${t.id}`, at, { parentSessionId: "root", costUsd: t.cost ?? 1, provider, model }));
    outcomes.push({ v: 1, ts: iso(at), event: "spawn", taskId: t.id, kind: t.kind ?? "implement", workerTier: t.tier ?? "qwen", workerEffort: "high", sessionId: `c-${t.id}`, parentSessionId: "root", ...t.spawn });
    if (t.verdict) outcomes.push({ v: 1, ts: iso(at + 10_000), event: "verdict", taskId: t.id, verdict: t.verdict, ...t.verdictExtra });
  });
  return { meter, outcomes: [...outcomes, ...events], assignments: [], guards: [] };
}
const ev = (event: string, taskId: string, at: number, rest: Record<string, unknown> = {}) => ({ v: 1, ts: iso(T0 + at * MIN), event, taskId, ...rest });

// ---- profile × tier ------------------------------------------------------------------------------

function tierLogs(): Logs {
  const w = logsOf(
    [
      { id: "q1", verdict: "accepted", cost: 1 }, { id: "q2", verdict: "rejected", cost: 2 }, { id: "q3", verdict: "partial", cost: 0.5 }, { id: "q4", cost: 0.3 },
      { id: "t1", tier: "T2", verdict: "accepted", cost: 3 }, { id: "t2", tier: "T2", verdict: "accepted", cost: 5 },
      { id: "s1", kind: "scout", verdict: "accepted", cost: 0.2 },
      { id: "u1", verdict: "accepted", cost: 9, spawn: { unresolved: true } }, // card files did not resolve: not routing quality
      { id: "r1", kind: "review", tier: "T2", verdict: "accepted", cost: 4, spawn: { reviewOf: "q1" } }, // a spot-check child, not a routed task
    ],
    [ev("escalate", "q3b", 20, { from: "qwen", to: "T2", attemptOf: "q3" }), ev("check", "q1", 20, { exit: 0 }), ev("check", "q2", 21, { exit: 1 }), ev("check", "q2", 22, { exit: 0 }), ev("check", "t1", 22, { exit: 0 })],
    [turn("g1", T0, { parentSessionId: "c-q1", costUsd: 0.5 })], // a grandchild: in q1's subtree
  );
  return w;
}
const cell = (d: ReturnType<typeof analyse>["delegation"], kind: string, tier: string) => d.profileTiers.find((c) => c.kind === kind && c.tier === tier)!;

test("profile × tier: tasks, accepted/partial/rejected/unjudged, $ per accepted task over the subtree, escalations, check pass rate", () => {
  const d = analyse(tierLogs()).delegation;
  const q = cell(d, "implement", EXEC.qwen);
  assert.deepEqual([q.tasks, q.accepted, q.partial, q.rejected, q.unjudged], [4, 1, 1, 1, 1]);
  close(q.usd, 1.5 + 2 + 0.5); // judged tasks only; q1's grandchild included
  close(q.perAccepted, 4);
  close(q.acceptance, 1 / 3);
  assert.equal(q.escalations, 1); // q3b escalated away from qwen; the original's kind is looked up by attemptOf
  assert.deepEqual([q.checks.n, q.checks.passed], [3, 2]);
  close(q.passRate, 2 / 3);
  const t = cell(d, "implement", EXEC.T2);
  assert.deepEqual([t.tasks, t.accepted, t.escalations, t.checks.n], [2, 2, 0, 1]);
  close(t.perAccepted, 4);
  assert.deepEqual([cell(d, "scout", EXEC.qwen).tasks, cell(d, "scout", EXEC.qwen).checks.n], [1, 0]);
  assert.ok(Number.isNaN(cell(d, "scout", EXEC.qwen).passRate));
  assert.deepEqual(d.profileTiers.map((c) => `${c.kind}/${c.tier}`), [`implement/${EXEC.qwen}`, `implement/${EXEC.T2}`, `scout/${EXEC.qwen}`]); // sorted; no review, no unresolved
});

// ---- B6: the tier of a task is the model it ran on ---------------------------------------------------

const AFTER_ROUTER_MODELS = "2026-10-20T10:00:00.000Z"; // a line written after the router began to write its models (D9: a line has them or not, whatever its date says)

test("executedTier: the model the router says the child ran on; else the model of the child's last request (provider/model); else unknown", () => {
  const l = (at: number, extra: Record<string, unknown>) => turn("k", T0 + at * MIN, { provider: "p-a", model: "m1", ...extra });
  const lines = [l(2, { provider: "p-b", model: "m2" }), l(1, {}), l(3, { kind: "warming", model: "m3" }), l(4, { status: "error", model: "m4" })];
  assert.equal(executedTier({ ranModel: "x/y" }, lines), "x/y");
  assert.equal(executedTier({}, lines), "p-b/m2");
  assert.equal(executedTier({}, []), "(unknown)");
});

test("B6: a task planned on qwen that ran on another model counts under the model it ran on; the matrix has the cell (qwen → that model) = 1", () => {
  const d = analyse(logsOf(
    [
      { id: "a", verdict: "accepted", cost: 2, spawn: { ts: AFTER_ROUTER_MODELS, workerModel: "p-api/large" } }, // the router wrote the model it started on
      { id: "b", verdict: "accepted", cost: 1 }, // an old line, rerouted to T1 (Sonnet) below
      { id: "c", verdict: "rejected", cost: 1, ran: ["p-api", "other"], spawn: { ts: AFTER_ROUTER_MODELS } }, // no model on the line: the meter lines' model
      { id: "d", verdict: "accepted", cost: 1 }, // ran as planned
    ],
    [ev("reroute", "b", 5, { from: "local", to: "T1", reason: "offline" })],
  )).delegation;
  assert.deepEqual(d.byTier.map((t) => t.tier).sort(), [EXEC.T1, EXEC.qwen, "p-api/large", "p-api/other"]);
  assert.deepEqual(d.matrix, [
    { planned: "qwen", executed: EXEC.T1, n: 1 }, { planned: "qwen", executed: EXEC.qwen, n: 1 }, { planned: "qwen", executed: "p-api/large", n: 1 }, { planned: "qwen", executed: "p-api/other", n: 1 },
  ]);
  assert.deepEqual(d.profileTiers.map((c) => `${c.tier}:${c.tasks}:${c.accepted}`).sort(), [`${EXEC.T1}:1:1`, `${EXEC.qwen}:1:1`, "p-api/large:1:1", "p-api/other:1:0"]);
  close(d.byTier.find((t) => t.tier === "p-api/large")!.cost.usd, 2);
  assert.equal(d.qwenShare, 1); // the share of PLANNED qwen is still 4/4: it names what the router planned
});

test("B6 property: every routed task is in exactly one matrix cell and one tier row; spot-check reviews and unresolved cards are in neither", () => {
  const d = analyse(tierLogs()).delegation;
  assert.equal(d.matrix.reduce((n, c) => n + c.n, 0), 7);
  assert.equal(d.byTier.reduce((n, t) => n + t.spawns, 0), 7);
  assert.deepEqual(d.matrix.filter((c) => c.planned === "T2").map((c) => [c.executed, c.n]), [[EXEC.T2, 2]]);
});

// ---- B5: one $/accepted function for the headline and the tier table ---------------------------------

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** Seeded fixture: routed tasks on every tier with every verdict (or none), a few spot-check reviews, unresolved cards, tasks without a child session, reroutes. */
function generated(seed: number): Logs {
  const rand = rng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const tasks: Task[] = Array.from({ length: 12 + Math.floor(rand() * 20) }, (_, i) => {
    const kind = rand();
    const t: Task = { id: `g${i}`, tier: pick(["qwen", "haiku", "T1", "T2"]), cost: Math.round(rand() * 400) / 100, verdict: pick(["accepted", "accepted", "partial", "rejected", undefined as unknown as string]) };
    if (kind < 0.12) return { ...t, kind: "review", spawn: { reviewOf: "g0" }, verdictExtra: { reviewOf: "g0" } };
    if (kind < 0.24) return { ...t, spawn: { unresolved: true } };
    if (kind < 0.3) return { ...t, spawn: { sessionId: undefined } };
    return t;
  });
  const reroutes = tasks.filter(() => rand() < 0.2).map((t, i) => ev("reroute", t.id, 50 + i, { from: "local", to: pick(["cloud", "T1", "T2"]), reason: "x" }));
  return logsOf(tasks, reroutes);
}
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

test("B5: costPerAccepted: the numerator is every cost of the population's tasks, judged or not, the denominator its accepted tasks; reviews are another population", () => {
  const w = logsOf([
    { id: "a", verdict: "accepted", cost: 1 }, { id: "b", verdict: "rejected", cost: 2 }, { id: "c", cost: 4 }, { id: "d", verdict: "accepted", cost: 1 }, // c: killed without a verdict
    { id: "e", verdict: "accepted", cost: 9, spawn: { sessionId: undefined } }, // no child session: no cost, so in neither numerator nor denominator
    { id: "r", kind: "review", tier: "T2", verdict: "accepted", cost: 3, spawn: { reviewOf: "a" }, verdictExtra: { reviewOf: "a" } },
  ]);
  const rows = taskRows(w.meter, w.outcomes);
  const all = costPerAccepted(rows, "all");
  assert.deepEqual([all.usd, all.accepted, all.lower, all.upper], [8, 2, 4, 4]); // (1 + 2 + 4 + 1) / 2, not the judged (1 + 2 + 1) / 2
  const judged = costPerAccepted(rows, "judged");
  assert.deepEqual([judged.usd, judged.accepted, judged.upper], [4, 2, 2]);
  const reviews = costPerAccepted(rows, "spotCheckReviews");
  assert.deepEqual([reviews.usd, reviews.accepted, reviews.upper], [3, 1, 3]);
  const none = costPerAccepted(taskRows(w.meter, w.outcomes.filter((e) => e.verdict !== "accepted")), "all");
  assert.ok(Number.isNaN(none.upper) && Number.isNaN(none.lower), "no accepted task: no ratio");
});

test("B5 property: the headline $/accepted is the tier table's 'all' row, and the tier rows' $ add up to it", () => {
  for (const seed of SEEDS) {
    const a = analyse(generated(seed));
    assert.deepEqual(a.cost.perAccepted, a.delegation.all.cost, `seed ${seed}`);
    close(a.delegation.byTier.reduce((n, t) => n + t.cost.usd, 0), a.delegation.all.cost.usd);
    assert.equal(a.delegation.byTier.reduce((n, t) => n + t.cost.accepted, 0), a.delegation.all.cost.accepted, `seed ${seed}`);
  }
});

test("B5: the headline is not the judged-only ratio: a task killed without a verdict is paid for by the accepted ones", () => {
  const a = analyse(logsOf([{ id: "a", verdict: "accepted", cost: 1 }, { id: "c", cost: 5 }]));
  close(a.cost.perAccepted.upper, 6);
  close(a.delegation.byTier[0].cost.upper, 6);
  const md = renderAnalysis(a, new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /\| API-eq \$\/accepted task, all routed tasks, excl\. – incl\. unresolved cards' \$ \(accepted\/tasks\) \| 6\.00 \(1\/2\) \|/);
  assert.match(md, /\| all \| 2 \| 100% \| 1\/1 \| 100% \| 6\.00 \| 0\.00 \| 6\.00 \|/);
});

// ---- B15: unresolved cards are an outcome class with $, and bound the $/accepted ---------------------

test("B15: an unresolved card's $ is in the population's $; lower leaves it out, upper has it; they differ by its $ per accepted task", () => {
  const w = logsOf([{ id: "a", verdict: "accepted", cost: 1 }, { id: "b", verdict: "accepted", cost: 1 }, { id: "u", verdict: "accepted", cost: 5, spawn: { unresolved: true } }]);
  const all = costPerAccepted(taskRows(w.meter, w.outcomes), "all");
  assert.deepEqual([all.usd, all.unresolvedUsd, all.accepted], [7, 5, 2]); // the unresolved card's own verdict is no routing evidence: not accepted
  assert.deepEqual([all.lower, all.upper], [1, 3.5]);
  close(all.upper - all.lower, 5 / 2);
  const judged = costPerAccepted(taskRows(w.meter, w.outcomes), "judged");
  assert.deepEqual([judged.usd, judged.unresolvedUsd], [2, 0]); // the judged population has no unresolved card
});

test("B15: the unresolved $ shows in the tier table's $ column, in its own column and in the bounds; the tier's task count is without it", () => {
  const a = analyse(logsOf([{ id: "a", verdict: "accepted", cost: 1 }, { id: "u", cost: 5, tier: "T1", spawn: { unresolved: true } }]));
  const [qwen, t1] = [a.delegation.byTier.find((t) => t.tier === EXEC.qwen)!, a.delegation.byTier.find((t) => t.tier === EXEC.T1)!];
  assert.deepEqual([t1.spawns, t1.cost.usd, t1.cost.unresolvedUsd, t1.cost.tasks], [0, 5, 5, 0]); // a tier only an unresolved card ran on is a row, with no routed task
  assert.deepEqual([qwen.spawns, qwen.cost.usd, qwen.cost.lower, qwen.cost.upper], [1, 1, 1, 1]);
  assert.deepEqual([a.delegation.all.cost.usd, a.delegation.all.cost.unresolvedUsd, a.delegation.all.cost.lower, a.delegation.all.cost.upper], [6, 5, 1, 6]);
  assert.deepEqual(a.cost.perAccepted, a.delegation.all.cost);
  const md = renderAnalysis(a, new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /\| tier \| tasks \| share \| accepted\/judged \| acceptance \| \$ \| of which unresolved \$ \| \$\/accepted \(excl\. – incl\. unresolved \$\) \|/);
  assert.match(md, /\| all \| 1 \| 100% \| 1\/1 \| 100% \| 6\.00 \| 5\.00 \| 1\.00 – 6\.00 \|/);
  assert.match(md, /\| API-eq \$\/accepted task, all routed tasks, excl\. – incl\. unresolved cards' \$ \(accepted\/tasks\) \| 1\.00 – 6\.00 \(1\/1\) \|/);
  // m1: what the range is, and that a task nobody judged is cost with no yield in both ends
  assert.match(md, /the first number leaves it out \(excl\.\), the second counts it \(incl\.\), over the same accepted tasks/);
  assert.match(md, /a task nobody judged is cost with no yield \(zero yield\): in the \$, never accepted, in both numbers/);
  assert.ok(!md.includes("lower – upper"));
  assert.match(md, /\| \$ of spot-check reviews; of unresolved cards \| 0\.00; 5\.00 \|/);
});

test("B15: an unresolved card whose child has no lines (no $) makes no tier row", () => {
  const w = logsOf([{ id: "a", verdict: "accepted", cost: 1 }, { id: "u", tier: "T1", spawn: { unresolved: true } }]);
  w.meter = w.meter.filter((l) => l.sessionId !== "c-u");
  assert.deepEqual(analyse(w).delegation.byTier.map((t) => t.tier), [EXEC.qwen]);
});

test("B15 property: lower ≤ upper, equal exactly when no unresolved $ is in the population, and they differ by the unresolved $ per accepted task", () => {
  for (const seed of SEEDS) {
    const a = analyse(generated(seed));
    for (const c of [a.delegation.all.cost, ...a.delegation.byTier.map((t) => t.cost)]) {
      if (!c.accepted) { assert.ok(Number.isNaN(c.lower) && Number.isNaN(c.upper)); continue; }
      assert.ok(c.lower <= c.upper + 1e-12, `seed ${seed}`);
      assert.equal(c.lower === c.upper || Math.abs(c.lower - c.upper) < 1e-12, c.unresolvedUsd === 0, `seed ${seed}`);
      close(c.upper - c.lower, c.unresolvedUsd / c.accepted);
    }
  }
  assert.ok(SEEDS.some((seed) => analyse(generated(seed)).delegation.all.cost.unresolvedUsd > 0), "the generator makes unresolved cards that cost");
});

// RG9 (review-g4 Low 4): since 2026-10-17 `escalate.from` is a route label (`local`, `cloud`, `haiku`, `T1`, `T2`; `"?"` when
// unknown), while the cells are keyed by the spawn's `workerTier`. An escalation counts in its failed task's cell (kind ×
// workerTier), whatever route it ran on; without the failed spawn, `from` is mapped to its tier (local, cloud → qwen).
test("RG9: escalations count in the failed task's cell (kind × workerTier), not in a row named after the route", () => {
  const d = analyse(logsOf(
    [{ id: "q1", verdict: "rejected" }, { id: "q2", verdict: "rejected" }, { id: "t1", tier: "T1", verdict: "rejected" }],
    [
      ev("escalate", "q1b", 20, { from: "cloud", to: "T1", attemptOf: "q1", fromModel: "free", toModel: "sonnet" }),
      ev("escalate", "q2b", 21, { from: "T1", to: "T2", attemptOf: "q2" }), // planned qwen, ran on a Sonnet fallback
      ev("escalate", "t1b", 22, { from: "T1", to: "T2", attemptOf: "t1" }),
      ev("escalate", "x1b", 23, { from: "local", to: "T1", attemptOf: "gone" }), // its spawn is not in the log
      ev("escalate", "x2b", 24, { from: "?", to: "T1", attemptOf: "typo" }),
    ],
  )).delegation;
  assert.deepEqual(d.profileTiers.map((c) => `${c.kind}/${c.tier}:${c.escalations}`), [`(unknown)/${EXEC.qwen}:1`, "(unknown)/?:1", `implement/${EXEC.qwen}:2`, `implement/${EXEC.T1}:1`]);
});

// RF3 (review-g5 plant MP4) counted both Qwen routes in the tier `qwen`; since B6 the tier is the model, and the old route labels map to a model
// each (legacy-routes.json): local and cloud are two models, so two rows.
test("RF3: without its spawn, an escalation counts under the model it left: an old `local` and `cloud` route are two rows", () => {
  const d = analyse(logsOf(
    [{ id: "q1", verdict: "rejected" }],
    [
      ev("escalate", "x1b", 20, { from: "local", to: "T1", attemptOf: "gone" }),
      ev("escalate", "x2b", 21, { from: "cloud", to: "T1", attemptOf: "gone2" }),
    ],
  )).delegation;
  assert.deepEqual(d.profileTiers.map((c) => `${c.kind}/${c.tier}:${c.escalations}`), [`(unknown)/${EXEC.qwen}:1`, "(unknown)/openrouter/qwen/qwen3.8-27b:free:1", `implement/${EXEC.qwen}:0`]);
});

test("unresolved cards are counted and kept out of every routing-quality statistic; spot-check reviews are counted apart", () => {
  const d = analyse(tierLogs()).delegation;
  assert.equal(d.unresolved, 1);
  assert.equal(d.reviewSpawns, 1);
  assert.equal(d.spawns, 9);
  assert.equal(d.byTier.find((t) => t.tier === EXEC.qwen)!.spawns, 5); // q1–q4 and s1, not u1
  assert.equal(d.byTier.find((t) => t.tier === EXEC.T2)!.spawns, 2); // not the review child
  close(d.qwenShare, 5 / 7);
  const qwenCost = d.byTier.find((t) => t.tier === EXEC.qwen)!.cost;
  close(qwenCost.usd, 1.5 + 2 + 0.5 + 0.3 + 0.2 + 9); // B5: q4, unjudged, is paid for too; B15: so is u1, an unresolved card ($9)
  close(qwenCost.unresolvedUsd, 9);
  assert.equal(qwenCost.accepted, 2); // q1 and s1; u1's accepted verdict is no routing evidence
});

test("profile × tier: property — the cells' tasks sum to the routed spawns, outcomes sum to tasks", () => {
  const d = analyse(tierLogs()).delegation;
  assert.equal(d.profileTiers.reduce((s, c) => s + c.tasks, 0), 7);
  for (const c of d.profileTiers) assert.equal(c.accepted + c.partial + c.rejected + c.unjudged, c.tasks);
});

// ---- randomized comparison -----------------------------------------------------------------------

const many = (prefix: string, n: number, base: Task, accepted: number): Task[] =>
  Array.from({ length: n }, (_, i) => ({ ...base, id: `${prefix}${i}`, verdict: i < accepted ? "accepted" : "rejected" }));
function randomLogs(): Logs {
  const random = (tier: string, extra: Record<string, unknown> = {}) => ({ kind: "mechanical", tier, spawn: { assigned: "random", routeBase: "qwen", ...extra } });
  return logsOf([
    ...many("rt", 3, { id: "", kind: "mechanical", tier: "qwen", cost: 1, spawn: { assigned: "router", routeBase: "qwen" } }, 2), // control: 2/3 accepted, $1 each
    ...many("rd", 4, { id: "", kind: "debug", tier: "qwen", cost: 1, spawn: { assigned: "router", routeBase: "qwen" } }, 4), // another profile: not in the control
    ...many("rq", 6, { id: "", cost: 1, ...random("qwen") }, 3), // random → qwen: 3/6, $6 → $2 per accepted
    ...many("r1", 5, { id: "", cost: 3, ...random("T1") }, 5), // random → T1: 5/5, $15 → $3 per accepted
    ...many("r2", 2, { id: "", cost: 4, ...random("T2") }, 1), // random → T2: 1/2 (n < 5: no CI), $8 per accepted
    ...many("ro", 1, { id: "", cost: 1, kind: "mechanical", tier: "T2", spawn: { assigned: "random", routeBase: "T1" } }, 1), // randomized from another base
    ...many("old", 2, { id: "", kind: "mechanical", tier: "qwen", cost: 1 }, 2), // an old line: no assigned, no routeBase: from before the randomization
    ...many("rf", 2, { id: "", kind: "mechanical", tier: "qwen", cost: 2, ran: ["p-api", "haiku"], spawn: { assigned: "router", routeBase: "qwen" } }, 1), // router-assigned, ran on a fallback member: 1/2, $4 per accepted
  ].map((t, i) => ({ ...t, id: `${t.id}${i}` })));
}
const rnd = (d: ReturnType<typeof analyse>["delegation"], tier: string) => d.randomized.rows.find((r) => r.tier === tier)!;

// B14: the router randomizes a share of the spawns it would send to qwen (`assigned: "random"`, `routeBase` the tier it computed). Its remainder, every
// router-assigned base-qwen task of those profiles, is the randomization's control, whatever model it ran on: which member a task ran on is not
// random (a busy pool, an outage), so the ITT comparator is the pooled row, and the split by the model that ran is descriptive. Lines from
// before the randomization (no `assigned`) are another row. The ITT row is every task it randomized.
test("B14: the ITT comparator pools every router-assigned task, whatever ran; the split by model and the pre-randomization runs are other rows", () => {
  const d = analyse(randomLogs()).delegation;
  const c = d.randomized.control;
  assert.deepEqual(d.randomized.kinds, ["mechanical"]);
  assert.deepEqual([c.routerAssigned.tasks, c.routerAssigned.judged, c.routerAssigned.accepted], [5, 5, 3]); // rt 3 (2 accepted) + rf 2 (1 accepted); "debug" is another profile
  close(c.routerAssigned.perAccepted.mean, (3 + 4) / 3);
  assert.deepEqual(c.routerAssignedBy.map((r) => [r.tier, r.tasks, r.accepted]), [[EXEC.qwen, 3, 2], [EXEC.haiku, 2, 1]]); // descriptive: by the model each ran on
  close(c.routerAssignedBy[1].perAccepted.mean, 4);
  assert.deepEqual([c.preRandomization.tasks, c.preRandomization.accepted], [2, 2]); // old lines: no assigned
  const itt = c.itt!;
  assert.deepEqual([itt.tasks, itt.judged, itt.accepted], [13, 13, 9]); // rq 6 + r1 5 + r2 2; the other-base spawn, the router-assigned and the old lines are not in it
  close(itt.acceptance.mean, 9 / 13);
  close(itt.perAccepted.mean, (6 + 15 + 8) / 9);
  assert.equal(d.randomized.ittNote, undefined);
  assert.ok(!("reference" in d.randomized), "no model is the reference: nothing in the log says which one is the planned member");
});

// Live shape: the router's fallback member (waitMs ≈ 5 s on a busy Qwen) ran most of its assigned tasks, the local Qwen the rest. A modal "reference
// model" would make the fallback the control and the planned member the exception; the pooled row is the same whichever model ran the majority.
function liveShaped(majority: "haiku" | "qwen"): Logs {
  const assigned = (id: string, ran: "haiku" | "qwen", verdict: string, cost: number) => ({ id, kind: "mechanical", tier: "qwen", cost, verdict, ran: RAN[ran], spawn: { assigned: "router", routeBase: "qwen", workerMember: ran, waitMs: ran === "haiku" ? 5003 : 9 } });
  const minority = majority === "haiku" ? "qwen" : "haiku";
  const random = (id: string, verdict: string, cost: number) => ({ id, kind: "mechanical", tier: "T1", cost, verdict, spawn: { assigned: "random", routeBase: "qwen" } });
  return logsOf([
    ...[0, 1, 2, 3, 4, 5].map((i) => assigned(`m${i}`, majority, i < 5 ? "accepted" : "rejected", 1)), // 5/6 accepted, $6
    ...[0, 1].map((i) => assigned(`n${i}`, minority, i < 1 ? "accepted" : "rejected", 3)), // 1/2 accepted, $6
    ...[0, 1, 2, 3].map((i) => random(`r${i}`, i < 3 ? "accepted" : "rejected", 2)), // 3/4 accepted, $8
  ]);
}

test("B14: the pooled router-assigned row is the ITT comparator: with the fallback member running the majority it is the same as with the planned member running it", () => {
  for (const majority of ["haiku", "qwen"] as const) {
    const c = analyse(liveShaped(majority)).delegation.randomized.control;
    assert.deepEqual([c.routerAssigned.tasks, c.routerAssigned.judged, c.routerAssigned.accepted], [8, 8, 6], majority);
    close(c.routerAssigned.perAccepted.mean, 12 / 6);
    assert.deepEqual(c.routerAssignedBy.map((r) => r.tasks).sort(), [2, 6], majority);
    assert.deepEqual([c.itt!.tasks, c.itt!.accepted], [4, 3]);
  }
  const sec = renderAnalysis(analyse(liveShaped("haiku")), new Date("2026-10-06T00:00:00Z")).split("\n### Randomized routing")[1].split("\n### ")[0];
  assert.match(sec, /\| router-assigned, ITT comparator \(every task the router did not randomize\) \| 8 \| 6\/8 \|/);
  assert.ok(!sec.includes("ran as planned"), "the report does not say which model was planned");
  assert.ok(!sec.includes("fallback"), "nor which one was a fallback: the log does not say");
});

test("B14 property: the pooled row does not depend on which models ran the router-assigned tasks; the by-model rows partition it", () => {
  const rand = rng(14);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  for (let i = 0; i < 40; i++) {
    const n = 4 + Math.floor(rand() * 12);
    const specs = Array.from({ length: n }, (_, j) => ({ id: `a${j}`, verdict: pick(["accepted", "accepted", "rejected", "partial", undefined as unknown as string]), cost: 1 + Math.floor(rand() * 4) }));
    const logs = (ran: () => "qwen" | "haiku" | "T1") => logsOf([
      ...specs.map((t) => ({ ...t, kind: "mechanical", tier: "qwen", ran: RAN[ran()], spawn: { assigned: "router", routeBase: "qwen" } })),
      { id: "z", kind: "mechanical", tier: "T1", verdict: "accepted", spawn: { assigned: "random", routeBase: "qwen" } },
    ]);
    const a = analyse(logs(() => "qwen")).delegation.randomized.control;
    const b = analyse(logs(() => pick(["qwen", "haiku", "T1"]))).delegation.randomized.control;
    assert.deepEqual(a.routerAssigned, b.routerAssigned, `seed ${i}`);
    assert.equal(b.routerAssignedBy.reduce((s, r) => s + r.tasks, 0), b.routerAssigned.tasks);
    assert.equal(b.routerAssignedBy.reduce((s, r) => s + r.accepted, 0), b.routerAssigned.accepted);
  }
});

test("B14: acceptance and $/accepted by the model the randomized tasks ran on (per protocol, not causal)", () => {
  const d = analyse(randomLogs()).delegation;
  assert.deepEqual(d.randomized.rows.map((r) => r.tier), [EXEC.qwen, EXEC.T1, EXEC.T2]);
  const q = rnd(d, EXEC.qwen);
  assert.deepEqual([q.tasks, q.accepted], [6, 3]);
  close(q.acceptance.mean, 0.5);
  close(q.perAccepted.mean, 2);
  const t1 = rnd(d, EXEC.T1);
  close(t1.acceptance.mean, 1);
  close(t1.perAccepted.mean, 3);
  close(rnd(d, EXEC.T2).perAccepted.mean, 8);
  assert.equal(d.randomized.otherBase, 1); // the randomized spawn whose router base was T1 is counted, not compared
});

test("B14: bootstrap CI only when n allows (≥ 5 judged), and it contains the point estimate", () => {
  const d = analyse(randomLogs()).delegation;
  const c = d.randomized.control;
  for (const [name, r] of [...d.randomized.rows.map((x) => [x.tier, x] as const), ...c.routerAssignedBy.map((x) => [`assigned ${x.tier}`, x] as const), ["pooled", c.routerAssigned], ["pre", c.preRandomization], ["itt", c.itt!]] as const) {
    if (r.judged >= 5) {
      assert.ok(Number.isFinite(r.acceptance.lo) && r.acceptance.lo - 1e-9 <= r.acceptance.mean && r.acceptance.mean <= r.acceptance.hi + 1e-9, `${name} acceptance CI`);
      if (r.accepted >= 2) assert.ok(r.perAccepted.lo - 1e-9 <= r.perAccepted.mean && r.perAccepted.mean <= r.perAccepted.hi + 1e-9, `${name} $/accepted CI`);
    } else assert.ok(Number.isNaN(r.acceptance.lo) && Number.isNaN(r.perAccepted.lo), `${name} has too few tasks for a CI`);
  }
});

test("B14: unresolved and review spawns are left out of every row; no randomized spawn → no rows", () => {
  const w = randomLogs();
  const extra = logsOf([{ id: "xu", kind: "mechanical", tier: "T1", verdict: "rejected", spawn: { assigned: "random", routeBase: "qwen", unresolved: true } }, { id: "xr", kind: "mechanical", tier: "T1", verdict: "rejected", spawn: { assigned: "random", routeBase: "qwen", reviewOf: "rq0" } }]);
  const d = analyse({ ...w, meter: [...w.meter, ...extra.meter], outcomes: [...w.outcomes, ...extra.outcomes] }).delegation;
  assert.deepEqual([rnd(d, EXEC.T1).tasks, rnd(d, EXEC.T1).accepted], [5, 5]);
  assert.equal(d.randomized.control.itt!.tasks, 13);
  assert.deepEqual(analyse(logsOf([{ id: "a", verdict: "accepted" }])).delegation.randomized.rows, []);
});

test("B14: the classes are disjoint: every routed task of the pool is in one row, and the ITT row has exactly the randomized ones", () => {
  const d = analyse(randomLogs()).delegation;
  const c = d.randomized.control;
  assert.equal(c.routerAssigned.tasks + c.preRandomization.tasks, 3 + 2 + 2); // rt, rf, old — not rd (another profile), not any randomized one
  assert.equal(c.routerAssignedBy.reduce((n, r) => n + r.tasks, 0), c.routerAssigned.tasks);
  assert.equal(d.randomized.rows.reduce((n, r) => n + r.tasks, 0), c.itt!.tasks); // per protocol, the randomized tasks split by the model they ran on
});

test("B14: no spawn carries assigned → the ITT row is not measurable, said so; the label of a randomized row is 'randomized by the router (ext)'", () => {
  const d = analyse(logsOf([{ id: "a", verdict: "accepted" }, { id: "b", verdict: "rejected" }])).delegation;
  assert.equal(d.randomized.control.itt, undefined);
  assert.match(d.randomized.ittNote!, /assigned/);
  const md = renderAnalysis(analyse(logsOf([{ id: "a", verdict: "accepted" }])), new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /ITT: not measurable/);
  const sec = renderAnalysis(analyse(randomLogs()), new Date("2026-10-06T00:00:00Z")).split("\n### Randomized routing")[1].split("\n### ")[0];
  assert.match(sec, /randomized by the router \(ext\)/);
  assert.match(sec, /router-assigned, ITT comparator/);
  assert.match(sec, /pre-randomization/);
  assert.match(sec, /ITT/);
});

// ---- router-owned factors (Q4): the router randomizes them itself; its outcome log records each task's levels (a router backlog item) ----

test("T2b.7: when spawn lines carry per-task factor levels, one ITT row per factor and level, labelled 'randomized by the router (ext)'", () => {
  const f = (factors: unknown) => ({ spawn: { factors } });
  const d = analyse(logsOf([
    { id: "a1", verdict: "accepted", cost: 1, ...f({ rule: "on", cap: 2 }) },
    { id: "a2", verdict: "rejected", cost: 3, ...f({ rule: "on", cap: 4 }) },
    { id: "a3", verdict: "accepted", cost: 2, ...f({ rule: "off", cap: 2 }) },
    { id: "a4", verdict: "accepted", cost: 2, ...f({ rule: "off", cap: 4, fast: true }) },
    { id: "a5", verdict: "accepted", cost: 9 }, // no factors: in no row
    { id: "a6", verdict: "accepted", cost: 9, ...f(["rule"]) }, { id: "a7", verdict: "accepted", cost: 9, ...f("rule") }, { id: "a8", verdict: "accepted", cost: 9, ...f(null) },
    { id: "a9", verdict: "accepted", cost: 9, ...f({ rule: { nested: 1 }, "": "x", bad: NaN }) }, // not a factor level: ignored
  ])).delegation;
  assert.deepEqual(d.routerFactors.map((r) => `${r.factor}=${r.level}:${r.row.tasks}:${r.row.accepted}`), ["cap=2:2:2", "cap=4:2:1", "fast=true:1:1", "rule=off:2:2", "rule=on:2:1"]);
  close(d.routerFactors[0].row.perAccepted.mean, 3 / 2);
  close(d.routerFactors[1].row.perAccepted.mean, 5);
  close(d.routerFactors[4].row.perAccepted.mean, 4);
  const md = renderAnalysis(analyse(logsOf([{ id: "a1", verdict: "accepted", cost: 1, ...f({ cap: 2 }) }])), new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /### Router factors \(randomized by the router \(ext\)\)/);
  assert.match(md, /\| factor \| level \| tasks \| accepted\/judged \| acceptance \(95% CI\) \| \$\/accepted \(95% CI\) \|/);
  assert.match(md, /\| cap \| 2 \| 1 \| 1\/1 \| 100% \| 1\.00 \|/);
  assert.ok(!md.includes("router factors: not recorded"));
  assert.deepEqual(check(logsOf([{ id: "a1", verdict: "accepted", cost: 1, ...f({ cap: 2 }) }])).filter((p) => p.field === "factors"), []); // the contract copy neither requires nor types the field
});

test("T2b.7: without per-task factor levels the report says so in one line; the contract copy is untouched by the field", () => {
  const d = analyse(logsOf([{ id: "a", verdict: "accepted" }])).delegation;
  assert.deepEqual(d.routerFactors, []);
  const md = renderAnalysis(analyse(logsOf([{ id: "a", verdict: "accepted" }])), new Date("2026-10-06T00:00:00Z"));
  assert.equal(md.split("router factors: not recorded").length - 1, 1);
  assert.ok(!md.includes("### Router factors"));
});

// ---- spot-check agreement ------------------------------------------------------------------------

/** `reviewer`: the reviewer's own verdict on each original (v1–v4), written on the review's verdict event as `reviewerVerdict` (B7: a field the router does not write yet). */
function spotLogs(reviewer: string[] = []): Logs {
  const orig = ["o1", "o2", "o3", "o4", "o5"].map((id) => ({ id, verdict: "accepted", tier: "qwen" }));
  const review = (id: string, of: string, verdict?: string): Task => ({ id, kind: "review", tier: "T2", verdict, spawn: { reviewOf: of },
    verdictExtra: { reviewOf: of, ...(reviewer[Number(id.slice(1)) - 1] === undefined ? {} : { reviewerVerdict: reviewer[Number(id.slice(1)) - 1] }) } });
  const w = logsOf([...orig, review("v1", "o1", "accepted"), review("v2", "o2", "accepted"), review("v3", "o3", "rejected"), review("v4", "o4", "partial"), review("v5", "o5", "unjudged")],
    [...["o1", "o2", "o3", "o4", "o5", "o6"].map((id, i) => ev("spotcheck", id, 30 + i, { requested: true })),
      ev("verdict", "o3", 60, { verdict: "rejected" })]); // the parent later changed its mind after the review: the verdict at the draw counts
  return w;
}

test("spot checks: requested, reviewed (the review child's verdict judged) and pending, whatever the log says of the reviewer", () => {
  const s = analyse(spotLogs()).delegation.spotChecks;
  assert.equal(s.requested, 6);
  assert.equal(s.reviewed, 4); // v1–v4 are judged; v5 unjudged; o6 has no review
  assert.equal(s.pending, 2);
  assert.equal(s.drawn, 4); // every one of them reviews a task with a spotcheck event
});

// m4 (audit B7, "35 vs 52"): `reviewed` counted every judged review child, drawn or not; the drawn ones are the sample, the others the parent's own requests.
test("m4: a review of a task nobody drew (no spotcheck event) is reviewed but not drawn; pending counts requested tasks only", () => {
  const w = spotLogs();
  const extra = logsOf([{ id: "o7", verdict: "accepted", tier: "qwen" }, { id: "v6", kind: "review", tier: "T2", verdict: "accepted", spawn: { reviewOf: "o7" }, verdictExtra: { reviewOf: "o7" } }]);
  const s = analyse({ ...w, meter: [...w.meter, ...extra.meter], outcomes: [...w.outcomes, ...extra.outcomes] }).delegation.spotChecks;
  assert.deepEqual([s.requested, s.reviewed, s.drawn, s.pending], [6, 5, 4, 2]);
  const md = renderAnalysis(analyse({ ...w, meter: [...w.meter, ...extra.meter], outcomes: [...w.outcomes, ...extra.outcomes] }), new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /\| requested \| reviewed \(judged\) \| of which drawn \| pending \|/);
  assert.match(md, /\| 6 \| 5 \| 4 \| 2 \|/);
});

// B7: the parent's verdict on a review child (accepted 55 of 55 on the author's log) is no reviewer's opinion of the original task. Agreement needs
// the reviewer's own verdict, a field the router does not write yet; read untyped as `reviewerVerdict` on the review's verdict event.
test("B7: without a reviewer verdict in the log the agreement is not measurable, never 100%", () => {
  const s = analyse(spotLogs()).delegation.spotChecks;
  assert.equal(s.agreement.measurable, false);
  assert.match((s.agreement as { reason: string }).reason, /reviewerVerdict/);
  const allAccepted = spotLogs(); // the parent accepts every review child, as it does in the real log
  for (const e of allAccepted.outcomes) if (e.event === "verdict" && typeof e.reviewOf === "string") e.verdict = "accepted";
  assert.equal(analyse(allAccepted).delegation.spotChecks.agreement.measurable, false);
  const md = renderAnalysis(analyse(spotLogs()), new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /agreement: not measurable/);
  assert.ok(!md.includes("agreement | 100%"));
});

test("B7: with the reviewer's verdicts the agreement is computed: n, agreements, κ; a review without one, or an unjudged one, is left out", () => {
  const s = analyse(spotLogs(["accepted", "accepted", "rejected", "partial", undefined as unknown as string])).delegation.spotChecks;
  assert.deepEqual(s.agreement, { measurable: true, n: 4, agree: 2, kappa: NaN, accepted: { n: 4, notAccepted: 2 } }); // every original was accepted at the draw: one rater never varies, κ is undefined
  const md = renderAnalysis(analyse(spotLogs(["accepted", "accepted", "rejected", "partial", undefined as unknown as string])), new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /\| compared \(with reviewer verdict\) \| agreement \| reviewer does not accept an accepted original \| κ \|/);
  assert.match(md, /\| 4 \| 50% \(2\/4\) \| 2\/4 \| not estimable: spot checks are drawn from accepted tasks only \|/); // m4: not a bare "–"
  const x = spotLogs(["accepted", "accepted", "rejected", "partial", "unjudged"]);
  assert.equal((analyse(x).delegation.spotChecks.agreement as { n: number }).n, 4);
});

test("B7: κ over a mixed sample: 10 pairs, 7 agree, orig accepted 6, reviewer accepted 5 → po 0.7, pe 0.5, κ 0.4", () => {
  const origs: Task[] = [..."123456"].map((i) => ({ id: `o${i}`, verdict: "accepted" })).concat([..."789"].map((i) => ({ id: `o${i}`, verdict: "partial" })), [{ id: "o10", verdict: "partial" }]);
  const reviewer = ["accepted", "accepted", "accepted", "accepted", "rejected", "rejected", "accepted", "rejected", "partial", "rejected"]; // (acc,acc) ×4, (acc,not) ×2, (not,acc) ×1, (not,not) ×3
  const reviews: Task[] = origs.map((o, i) => ({ id: `v${i}`, kind: "review", tier: "T2", verdict: "accepted", spawn: { reviewOf: o.id }, verdictExtra: { reviewOf: o.id, reviewerVerdict: reviewer[i] } }));
  const w = logsOf([...origs, ...reviews], origs.map((o, i) => ev("spotcheck", o.id, 30 + i, { requested: true })));
  const a = analyse(w).delegation.spotChecks.agreement;
  assert.ok(a.measurable);
  if (a.measurable) { assert.deepEqual([a.n, a.agree], [10, 7]); close(a.kappa, 0.4); }
  const md = renderAnalysis(analyse(w), new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /\| 10 \| 70% \(7\/10\) \| 2\/6 \| 0\.40 \|/); // 6 originals accepted at the draw, the reviewer did not accept 2 of them
});

test("m4: the reviewer who never varies on a mixed sample is 'not estimable' for that reason, not the drawn-from-accepted one", () => {
  const origs: Task[] = [{ id: "o1", verdict: "accepted" }, { id: "o2", verdict: "partial" }, { id: "o3", verdict: "accepted" }];
  const reviews: Task[] = origs.map((o, i) => ({ id: `v${i}`, kind: "review", tier: "T2", verdict: "accepted", spawn: { reviewOf: o.id }, verdictExtra: { reviewOf: o.id, reviewerVerdict: "accepted" } }));
  const w = logsOf([...origs, ...reviews], origs.map((o, i) => ev("spotcheck", o.id, 30 + i, { requested: true })));
  const md = renderAnalysis(analyse(w), new Date("2026-10-06T00:00:00Z"));
  assert.match(md, /\| 3 \| 67% \(2\/3\) \| 0\/2 \| not estimable: the reviewer's verdict never varies \|/);
});

test("spot checks: none requested → nothing reviewed, agreement not measurable; the review children's verdicts do not enter the tier acceptance", () => {
  const s = analyse(logsOf([{ id: "a", verdict: "accepted" }])).delegation.spotChecks;
  assert.deepEqual([s.requested, s.reviewed, s.pending, s.agreement.measurable], [0, 0, 0, false]);
  const d = analyse(spotLogs()).delegation;
  assert.equal(d.byTier.find((t) => t.tier === EXEC.T2), undefined); // only review children ran on T2
});

// ---- old data and rendering ----------------------------------------------------------------------

test("old outcome lines (no assigned/routeBase/unresolved/reviewOf/spotcheck/cwd) analyse as before: no randomized rows, no spot checks", () => {
  const d = analyse(logsOf([{ id: "a", verdict: "accepted" }, { id: "b", tier: "T1", verdict: "rejected" }])).delegation;
  assert.deepEqual([d.unresolved, d.reviewSpawns, d.randomized.rows.length, d.spotChecks.requested], [0, 0, 0, 0]);
  assert.equal(d.profileTiers.length, 2);
});

test("render: the delegation section shows the profile × tier table, the randomized comparison (labelled) and the spot-check agreement", () => {
  const md = renderAnalysis(analyse({ ...randomLogs(), outcomes: [...randomLogs().outcomes, ...spotLogs().outcomes], meter: [...randomLogs().meter, ...spotLogs().meter] }), new Date("2026-10-06T00:00:00Z"));
  const sec = md.split("\n## Router\n")[1].split(/\n## /)[0];
  assert.match(sec, /### By profile and tier/);
  assert.match(sec, /escalations = re-spawns one level up \(D7\)/);
  assert.match(sec, /\| profile \| tier \| tasks \| accepted \| partial \| rejected \| unjudged \| acceptance \| \$\/accepted \| escalations \| checks passed \|/);
  assert.match(sec, /### Randomized routing \(randomized by the router \(ext\); spawns it sent to qwen\)/);
  assert.match(sec, /Causal only for the intention-to-treat comparison/);
  assert.match(sec, new RegExp(`\\| randomized by the router \\(ext\\), ran on ${EXEC.T1} \\| 5 \\| 5/5 \\| 100%`));
  assert.match(sec, /### Planned → executed tier/);
  assert.match(sec, new RegExp(`\\| T1 \\| ${EXEC.T1} \\| 5 \\|`));
  assert.match(sec, /### Spot checks/);
  assert.match(sec, /agreement/);
  assert.ok(!sec.includes("SC3"), "D9: the report names no target of the router's (SC3)");
  assert.match(sec, /\| Qwen share of tasks \(planned\) \|/);
  const empty = renderAnalysis(analyse(logsOf([{ id: "a", verdict: "accepted" }])), new Date("2026-10-06T00:00:00Z")).split("\n## Router\n")[1];
  assert.match(empty, /no randomized spawns/);
  assert.match(empty, /no spot checks/);
});

test("T4.5: models sort by the planned tier most of their tasks had: haiku between qwen and T1 (qwen, haiku, T1, T2)", () => {
  const d = analyse(logsOf([{ id: "a", tier: "T2" }, { id: "b", tier: "T1" }, { id: "c", tier: "haiku" }, { id: "d", tier: "qwen" }])).delegation;
  assert.deepEqual(d.profileTiers.map((c) => c.tier), [EXEC.qwen, EXEC.haiku, EXEC.T1, EXEC.T2]);
});
