// T13.9: pi-analyse's delegation section per profile (card kind) × tier, the randomized comparison among spawns the router
// would have sent to Qwen, and spot-check agreement. Synthetic fixtures; every number is computed by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, renderAnalysis, type Logs } from "../core/analyse.ts";
import { iso, MIN, T0, turn } from "./world.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

type Task = { id: string; kind?: string; tier?: string; cost?: number; verdict?: string; spawn?: Record<string, unknown>; verdictExtra?: Record<string, unknown> };
/** Spawn events (+ one child meter line of `cost` $ each, + a verdict when given) of the tasks, one minute apart; extra events appended. */
function logsOf(tasks: Task[], events: Record<string, unknown>[] = [], meter: Record<string, unknown>[] = []): Logs {
  const outcomes: Record<string, unknown>[] = [];
  tasks.forEach((t, i) => {
    const at = T0 + i * MIN;
    meter.push(turn(`c-${t.id}`, at, { parentSessionId: "root", costUsd: t.cost ?? 1 }));
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
  const q = cell(d, "implement", "qwen");
  assert.deepEqual([q.tasks, q.accepted, q.partial, q.rejected, q.unjudged], [4, 1, 1, 1, 1]);
  close(q.usd, 1.5 + 2 + 0.5); // judged tasks only; q1's grandchild included
  close(q.perAccepted, 4);
  close(q.acceptance, 1 / 3);
  assert.equal(q.escalations, 1); // q3b escalated away from qwen; the original's kind is looked up by attemptOf
  assert.deepEqual([q.checks.n, q.checks.passed], [3, 2]);
  close(q.passRate, 2 / 3);
  const t = cell(d, "implement", "T2");
  assert.deepEqual([t.tasks, t.accepted, t.escalations, t.checks.n], [2, 2, 0, 1]);
  close(t.perAccepted, 4);
  assert.deepEqual([cell(d, "scout", "qwen").tasks, cell(d, "scout", "qwen").checks.n], [1, 0]);
  assert.ok(Number.isNaN(cell(d, "scout", "qwen").passRate));
  assert.deepEqual(d.profileTiers.map((c) => `${c.kind}/${c.tier}`), ["implement/qwen", "implement/T2", "scout/qwen"]); // sorted; no review, no unresolved
});

test("unresolved cards are counted and kept out of every routing-quality statistic; spot-check reviews are counted apart", () => {
  const d = analyse(tierLogs()).delegation;
  assert.equal(d.unresolved, 1);
  assert.equal(d.reviewSpawns, 1);
  assert.equal(d.spawns, 9);
  assert.equal(d.byTier.find((t) => t.tier === "qwen")!.spawns, 5); // q1–q4 and s1, not u1
  assert.equal(d.byTier.find((t) => t.tier === "T2")!.spawns, 2); // not the review child
  close(d.qwenShare, 5 / 7);
  close(d.byTier.find((t) => t.tier === "qwen")!.usd, 1.5 + 2 + 0.5 + 0.2);
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
    ...many("old", 2, { id: "", kind: "mechanical", tier: "qwen", cost: 1 }, 2), // an old line: no assigned, no routeBase → router
  ].map((t, i) => ({ ...t, id: `${t.id}${i}` })));
}
const row = (d: ReturnType<typeof analyse>["delegation"], assigned: string, tier: string) => d.randomized.rows.find((r) => r.assigned === assigned && r.tier === tier)!;

test("randomized comparison: acceptance and $/accepted by actual tier for random vs router-assigned qwen of the same profiles", () => {
  const d = analyse(randomLogs()).delegation;
  assert.deepEqual(d.randomized.kinds, ["mechanical"]);
  assert.deepEqual(d.randomized.rows.map((r) => `${r.assigned}/${r.tier}`), ["router/qwen", "random/qwen", "random/T1", "random/T2"]);
  const ctl = row(d, "router", "qwen"); // the 3 router + 2 old lines of kind mechanical; "debug" is another profile
  assert.deepEqual([ctl.tasks, ctl.judged, ctl.accepted], [5, 5, 4]);
  close(ctl.acceptance.mean, 4 / 5);
  close(ctl.perAccepted.mean, 5 / 4);
  const q = row(d, "random", "qwen");
  assert.deepEqual([q.tasks, q.accepted], [6, 3]);
  close(q.acceptance.mean, 0.5);
  close(q.perAccepted.mean, 2);
  const t1 = row(d, "random", "T1");
  close(t1.acceptance.mean, 1);
  close(t1.perAccepted.mean, 3);
  const t2 = row(d, "random", "T2");
  close(t2.perAccepted.mean, 8);
  assert.equal(d.randomized.otherBase, 1); // the randomized spawn whose router base was T1 is counted, not compared
});

test("randomized comparison: bootstrap CI only when n allows (≥ 5 judged), and it contains the point estimate", () => {
  const d = analyse(randomLogs()).delegation;
  for (const r of d.randomized.rows) {
    if (r.judged >= 5) {
      assert.ok(Number.isFinite(r.acceptance.lo) && r.acceptance.lo - 1e-9 <= r.acceptance.mean && r.acceptance.mean <= r.acceptance.hi + 1e-9, `${r.assigned}/${r.tier} acceptance CI`);
      if (r.accepted >= 2) assert.ok(r.perAccepted.lo - 1e-9 <= r.perAccepted.mean && r.perAccepted.mean <= r.perAccepted.hi + 1e-9, `${r.assigned}/${r.tier} $/accepted CI`);
    } else assert.ok(Number.isNaN(r.acceptance.lo) && Number.isNaN(r.perAccepted.lo), `${r.assigned}/${r.tier} has too few tasks for a CI`);
  }
});

test("randomized comparison: unresolved and review spawns are left out; no randomized spawn → no rows", () => {
  const w = randomLogs();
  const extra = logsOf([{ id: "xu", kind: "mechanical", tier: "T1", verdict: "rejected", spawn: { assigned: "random", routeBase: "qwen", unresolved: true } }, { id: "xr", kind: "mechanical", tier: "T1", verdict: "rejected", spawn: { assigned: "random", routeBase: "qwen", reviewOf: "rq0" } }]);
  const d = analyse({ ...w, meter: [...w.meter, ...extra.meter], outcomes: [...w.outcomes, ...extra.outcomes] }).delegation;
  assert.deepEqual([row(d, "random", "T1").tasks, row(d, "random", "T1").accepted], [5, 5]);
  assert.deepEqual(analyse(logsOf([{ id: "a", verdict: "accepted" }])).delegation.randomized.rows, []);
});

// ---- spot-check agreement ------------------------------------------------------------------------

function spotLogs(): Logs {
  const orig = ["o1", "o2", "o3", "o4", "o5"].map((id) => ({ id, verdict: "accepted", tier: "qwen" }));
  const review = (id: string, of: string, verdict?: string): Task => ({ id, kind: "review", tier: "T2", verdict, spawn: { reviewOf: of }, verdictExtra: { reviewOf: of } });
  const w = logsOf([...orig, review("v1", "o1", "accepted"), review("v2", "o2", "accepted"), review("v3", "o3", "rejected"), review("v4", "o4", "partial"), review("v5", "o5", "unjudged")],
    [...["o1", "o2", "o3", "o4", "o5", "o6"].map((id, i) => ev("spotcheck", id, 30 + i, { requested: true })),
      ev("verdict", "o3", 60, { verdict: "rejected" })]); // the parent later changed its mind after the review: the verdict at the draw counts
  return w;
}

test("spot-check agreement: original (accepted at the draw) vs review verdict; unjudged reviews and requests without a review are pending", () => {
  const s = analyse(spotLogs()).delegation.spotChecks;
  assert.equal(s.requested, 6);
  assert.equal(s.reviewed, 4); // v1–v4 are judged; v5 unjudged; o6 has no review
  assert.equal(s.agree, 2);
  close(s.rate, 0.5);
  assert.equal(s.pending, 2);
});

test("spot-check agreement: no spot checks → n 0 and a NaN rate; the review children's verdicts do not enter the tier acceptance", () => {
  const s = analyse(logsOf([{ id: "a", verdict: "accepted" }])).delegation.spotChecks;
  assert.deepEqual([s.requested, s.reviewed, s.agree, s.pending], [0, 0, 0, 0]);
  assert.ok(Number.isNaN(s.rate));
  const d = analyse(spotLogs()).delegation;
  assert.equal(d.byTier.find((t) => t.tier === "T2"), undefined); // only review children ran on T2
});

// ---- old data and rendering ----------------------------------------------------------------------

test("old outcome lines (no assigned/routeBase/unresolved/reviewOf/spotcheck/cwd) analyse as before: no randomized rows, no spot checks", () => {
  const d = analyse(logsOf([{ id: "a", verdict: "accepted" }, { id: "b", tier: "T1", verdict: "rejected" }])).delegation;
  assert.deepEqual([d.unresolved, d.reviewSpawns, d.randomized.rows.length, d.spotChecks.requested], [0, 0, 0, 0]);
  assert.equal(d.profileTiers.length, 2);
});

test("render: the delegation section shows the profile × tier table, the randomized comparison (labelled) and the spot-check agreement", () => {
  const md = renderAnalysis(analyse({ ...randomLogs(), outcomes: [...randomLogs().outcomes, ...spotLogs().outcomes], meter: [...randomLogs().meter, ...spotLogs().meter] }), new Date("2026-10-06T00:00:00Z"));
  const sec = md.split("\n## Delegation & routing\n")[1].split(/\n## /)[0];
  assert.match(sec, /### By profile and tier/);
  assert.match(sec, /\| profile \| tier \| tasks \| accepted \| partial \| rejected \| unjudged \| acceptance \| \$\/accepted \| escalations \| checks passed \|/);
  assert.match(sec, /### Randomized routing \(spawns the router sent to qwen\)/);
  assert.match(sec, /Causal only for the random subset/);
  assert.match(sec, /\| random \| T1 \| 5 \| 5\/5 \| 100%/);
  assert.match(sec, /### Spot checks/);
  assert.match(sec, /agreement/);
  const empty = renderAnalysis(analyse(logsOf([{ id: "a", verdict: "accepted" }])), new Date("2026-10-06T00:00:00Z")).split("\n## Delegation & routing\n")[1];
  assert.match(empty, /no randomized spawns/);
  assert.match(empty, /no spot checks/);
});
