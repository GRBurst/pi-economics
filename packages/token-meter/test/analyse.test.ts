import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, applyKill, renderAnalysis, reportName, type Logs } from "../core/analyse.ts";
import { mulberry32 } from "../core/stats.ts";
import { assignment, iso, MIN, T0, turn, turns, world } from "./world.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const contains = (ci: { lo: number; hi: number }, x: number) => assert.ok(ci.lo - 1e-9 <= x && x <= ci.hi + 1e-9, `${x} ∉ [${ci.lo}, ${ci.hi}]`);

// ---- (a) cost ----------------------------------------------------------------------------------

test("cost: total, active hours, $/active hour with a CI containing it, quota per active hour", () => {
  const c = analyse(world()).cost;
  close(c.totalUsd, 47.7);
  close(c.activeHours, 3);
  close(c.usdPerHour.mean, 15.9);
  contains(c.usdPerHour, c.usdPerHour.mean);
  close(c.q5hPerHour, 1); // 10 → 13 inside m3, 3 active hours
  assert.equal(c.units, 6);
});

test("cost: a root shorter than MIN_HOURS (e.g. 3 orphan $0 lines) stays out of the $/h CI (real data 2026-10-03)", () => {
  const w = world();
  const orphan = [0, 1, 2].map((i) => turn("orphan-child", T0 + i * 5_000, { parentSessionId: "gone", costUsd: 0, model: "qwen" }));
  const c = analyse({ ...w, meter: [...w.meter, ...orphan] }).cost;
  const base = analyse(w).cost;
  assert.equal(c.units, base.units + 1); // still counted as a root
  close(c.usdPerHour.lo, base.usdPerHour.lo, 1e-6);
  close(c.usdPerHour.hi, base.usdPerHour.hi, 1e-6);
});

test("cost: per-model costs sum to the total (property, random logs)", () => {
  const rng = mulberry32(7);
  for (let k = 0; k < 20; k++) {
    const meter = Array.from({ length: 50 }, (_, i) => turn(`s${Math.floor(rng() * 5)}`, T0 + i * MIN, {
      model: ["a", "b", "c"][Math.floor(rng() * 3)], costUsd: Math.round(rng() * 1000) / 100, kind: rng() < 0.2 ? "warming" : "turn" }));
    const c = analyse({ meter, outcomes: [], assignments: [], guards: [] }).cost;
    close(c.byModel.reduce((s, m) => s + m.usd, 0), c.totalUsd, 1e-6);
    close(c.byModel.reduce((s, m) => s + m.share, 0), 1, 1e-9);
    close(Object.values(c.components).reduce((s, x) => s + x, 0), c.totalUsd, 1e-6);
    contains(c.usdPerHour, c.usdPerHour.mean);
  }
});

test("cost: splits by model, cache rewrite, warming, folds; $ per accepted task", () => {
  const c = analyse(world()).cost;
  const model = Object.fromEntries(c.byModel.map((m) => [m.model, m.usd]));
  close(model["claude-opus"], 20.5); close(model["claude-sonnet"], 27); close(model.qwen, 0.2);
  const split = Object.fromEntries(c.splits.map((s) => [s.name, s]));
  close(split.warming.usd, 0.5);
  close(split.warming.perHour, 0.5 / 3);
  assert.ok(split["cache rewrite"].usd > 0 && split["cache rewrite"].usd < c.components.cacheWrite + 1e-9);
  assert.ok("after folds" in split && "after cold resumes" in split);
  // t1 (0.2) accepted, t2 (1.0) rejected, t3 (2.0) accepted: (0.2 + 1 + 2) / 2
  close(c.perAccepted.perAccepted, 1.6);
  assert.equal(c.perAccepted.accepted, 2);
});

test("cost: a fold (context shrink) is found and charged with the next 3 requests", () => {
  const meter = [...turns("f", T0, 3, { arm: "-----" }, 1), ...turns("f", T0 + 3 * MIN, 3, { arm: "-----", cacheRead: 100, costUsd: 0.5 }, 1)];
  const c = analyse({ meter, outcomes: [], assignments: [], guards: [] }).cost;
  const fold = c.splits.find((s) => s.name === "after folds")!;
  assert.equal(fold.n, 1);
  close(fold.usd, 1.5);
});

// ---- period ------------------------------------------------------------------------------------

test("period: --since/--until are inclusive UTC days and filter every log but assignments", () => {
  const w = world();
  w.meter.push(turn("old", Date.parse("2026-10-01T10:00:00Z"), { costUsd: 100 }));
  const a = analyse(w, { since: "2026-10-05", until: "2026-10-05" });
  close(a.cost.totalUsd, 47.7);
  assert.equal(a.quality.period.first, iso(T0));
  assert.equal(analyse(w, { until: "2026-10-04" }).cost.totalUsd, 100);
});

// ---- (b) experiment ----------------------------------------------------------------------------

test("experiment: design v1 (5 factors, legacy rows) and v2 (6 factors, design:\"v2\") parsed, never pooled", () => {
  const e = analyse(world()).experiment;
  assert.deepEqual(e.designs.map((d) => d.design), ["v1", "v2"]);
  const [v1, v2] = e.designs;
  assert.equal(v1.factors.length, 5); assert.equal(v2.factors.length, 6);
  assert.ok(v2.factors.includes("delegationRule") && !v1.factors.includes("delegationRule"));
  assert.equal(v1.baseline, "-----"); assert.equal(v2.baseline, "------");
  assert.equal(v1.units, 2); assert.equal(v2.units, 4);
});

test("experiment: per-factor effect = mean(high) − mean(low) of unit $/h, with a bootstrap CI containing it", () => {
  const [v1, v2] = analyse(world()).experiment.designs;
  for (const f of v1.effects) { close(f.diff, 8); contains(f, f.diff); assert.equal(f.nLow + f.nHigh, 2); }
  // v2: high (m4 30, m6 24) − low (m3 9.4, m5 8)
  for (const f of v2.effects) { close(f.diff, 27 - 8.7); contains(f, f.diff); }
  const w = v2.effects.find((f) => f.factor === "warmPolicy")!;
  assert.equal(w.low, "native"); assert.equal(w.high, "orchestrator-aware");
});

test("experiment: arm ids without an assignment row are decoded by length", () => {
  const meter = [...turns("x", T0, 4, { arm: "------" }), ...turns("y", T0, 4, { arm: "+++++-", costUsd: 2 })];
  const [d] = analyse({ meter, outcomes: [], assignments: [], guards: [] }).experiment.designs;
  assert.equal(d.design, "v2");
  assert.equal(d.effects.find((f) => f.factor === "delegationRule")!.nHigh, 0);
  close(d.effects.find((f) => f.factor === "warmPolicy")!.diff, 8);
});

test("experiment: quota per active hour is the root's share of the account's rise — parallel roots (even unarmed ones) do not each count all of it (T13.8)", () => {
  const root = (sid: string, extra: Record<string, unknown>) => turns(sid, T0, 4, { ...extra, costUsd: 1 }).map((l, i) => ({ ...l, q5h: 10 + i, q5hReset: 1 }));
  const meter = [...root("a", { arm: "------" }), ...root("b", { arm: "++++++" }), ...root("u", {})];
  const d = analyse({ meter, outcomes: [], assignments: [], guards: [] }).experiment.designs[0];
  const lo = d.arms.find((a) => a.arm === "------")!;
  close(lo.q5hPerHour, 1 / 0.5); // 3 points over 3 roots = 1 point each, in 30 min; per-root summing gave 3 / 0.5
  close(analyse({ meter, outcomes: [], assignments: [], guards: [] }).cost.q5hPerHour, 3 / 1.5);
});

test("experiment: OLS with two-way interactions recovers additive main effects in a full 2^2 design", () => {
  const meter: Record<string, unknown>[] = [];
  const assignments: Record<string, unknown>[] = [];
  let k = 0;
  for (const arm of ["-----", "+----", "-+---", "++---"]) for (let r = 0; r < 3; r++) {
    const id = `u${k++}`;
    const cost = (1 + (arm[0] === "+" ? 1 : 0) + (arm[1] === "+" ? 0.5 : 0)) / 8; // 4 turns in 0.5 h → $/h = 8 · cost
    meter.push(...turns(id, T0 + k * 100 * MIN, 4, { arm, costUsd: cost * (1 + 0.01 * r) }));
    assignments.push(assignment(id, arm, T0));
  }
  const [d] = analyse({ meter, outcomes: [], assignments, guards: [] }).experiment.designs;
  const term = (n: string) => d.ols!.terms.find((t) => t.name === n)!;
  assert.ok(d.ols && d.ols.n === 12);
  assert.ok(term("warmPolicy=orchestrator-aware").coef > 0);
  assert.ok(term("mainCacheTtl=1h").coef > 0);
  assert.ok(term("warmPolicy=orchestrator-aware").coef > term("mainCacheTtl=1h").coef);
  assert.ok(d.ols!.terms.some((t) => t.name === "warmPolicy=orchestrator-aware:mainCacheTtl=1h"));
});

test("experiment: posterior per arm (reward −$/h) with P(best) summing to 1, cheaper arm best", () => {
  const v2 = analyse(world()).experiment.designs[1];
  const p = Object.fromEntries(v2.posterior.map((x) => [x.arm, x]));
  close(v2.posterior.reduce((s, x) => s + x.pBest, 0), 1, 1e-9);
  assert.ok(p["------"].mean > p["++++++"].mean);
  assert.ok(p["------"].pBest > 0.9);
});

// ---- (c) delegation & routing ------------------------------------------------------------------

test("delegation: task share, tier mix, Qwen share, acceptance per tier, escalations", () => {
  const d = analyse(world()).delegation;
  assert.equal(d.spawns, 3);
  close(d.qwenShare, 1 / 3);
  close(d.childUsdShare, 3.2 / 47.7);
  const tier = Object.fromEntries(d.byTier.map((t) => [t.tier, t]));
  assert.deepEqual([tier.qwen.accepted, tier.qwen.judged, tier.T1.accepted, tier.T1.judged, tier.T2.accepted], [1, 1, 0, 1, 1]);
  close(tier.T2.perAccepted, 2);
  assert.deepEqual(d.escalations, [{ from: "qwen", to: "T2", n: 1 }]);
  assert.equal(d.checks.n, 1); assert.equal(d.checks.failed, 0);
  assert.deepEqual(d.runaways, []);
});

test("delegation: runaway alerts use the router's runaway limits", () => {
  const w = { ...world(), routerSettings: { runaway: { requests: 4, usd: 100 } } };
  const d = analyse(w).delegation;
  assert.deepEqual(d.runaways.map((r) => [r.sessionId, r.taskId, r.requests]), [["c3", "t3", 5]]);
});

// ---- (d) guards --------------------------------------------------------------------------------

const limits = { guards: { minSessions: 2, threshold: 0.2, peekThreshold: 5, correctionThreshold: 5, ratingThreshold: 5 } };

test("guards: per arm corrections, peeks, ratings, acceptance", () => {
  const g = analyse(world()).guards;
  const arm = Object.fromEntries(g.perArm.map((a) => [a.arm, a]));
  assert.deepEqual([arm["++++++"].peeks, arm["++++++"].corrections, arm["++++++"].ratings], [1, 2, [3]]);
  assert.deepEqual(arm["------"].ratings, [5]);
  assert.equal(arm["++++++"].units, 2);
});

test("guards: kill switch compares each arm with its own design's baseline", () => {
  const g = analyse({ ...world(), expSettings: limits }).guards;
  assert.deepEqual(Object.keys(g.kill), ["++++++"]);
  assert.match(g.kill["++++++"], /acceptance 50% \(1\/2\) vs baseline 100% \(1\/1\)/);
  assert.deepEqual(g.baselines, { v1: "-----", v2: "------" });
});

test("guards: the settings baseline is used only for the design it belongs to", () => {
  const g = analyse({ ...world(), expSettings: { ...limits, baseline: "++++++" } }).guards;
  assert.deepEqual(g.baselines, { v1: "-----", v2: "++++++" });
  assert.deepEqual(Object.keys(g.kill), []);
});

test("applyKill: state.json keeps old disabled arms, adds the kill-switch arms and the posterior", () => {
  const a = analyse({ ...world(), expSettings: limits });
  const s = applyKill({ disabled: ["+-+-+-"], reasons: { "+-+-+-": "old" } }, a);
  assert.deepEqual(s.disabled, ["+-+-+-", "++++++"]);
  assert.ok(s.posterior["------"] && s.posterior["++++++"]);
});

// ---- (e) data quality --------------------------------------------------------------------------

test("quality: schema versions per log (absent v = 0), period covered", () => {
  const q = analyse(world()).quality;
  const v = Object.fromEntries(q.logs.map((l) => [l.log, l.versions]));
  assert.deepEqual(v.meter, { 0: 8, 1: 26 });
  assert.deepEqual(v.outcomes, { 1: 8 });
  assert.deepEqual(v.assignments, { 0: 2, 1: 4 });
  assert.deepEqual(v.guards, { 1: 5 });
  assert.equal(q.period.first, iso(T0));
  assert.equal(q.period.last, iso(T0 + 150 * MIN));
});

test("quality: sessions without arm and unjoinable lines are counted", () => {
  const w = world();
  w.meter.push(...turns("bare", T0, 2, { costUsd: 2 }));
  w.meter.push(turn("orphan", T0, { parentSessionId: "nobody", arm: "------" }));
  w.outcomes.push({ v: 1, ts: iso(T0), event: "spawn", taskId: "t8", kind: "implement", workerTier: "T1", workerEffort: "low", base: "T1", importance: "normal", sessionId: "ghost", parentSessionId: "m3", arm: "------" });
  w.outcomes.push({ v: 1, ts: iso(T0), event: "verdict", taskId: "t9", verdict: "accepted" });
  w.guards.push({ v: 1, ts: iso(T0), sessionId: "nowhere", event: "correction" });
  const q = analyse(w).quality;
  assert.equal(q.withoutArm.roots, 1);
  close(q.withoutArm.usd, 4);
  const u = Object.fromEntries(q.unjoinable.map((x) => [x.what, x.n]));
  assert.equal(u["meter child lines whose parent session is unknown"], 1);
  assert.equal(u["spawns whose child session has no meter line"], 1);
  assert.equal(u["task events without a spawn"], 1);
  assert.equal(u["guard events of sessions without meter lines"], 1);
  assert.equal(u["child sessions without a spawn event (their $ is in no tier)"], 1); // orphan (real data: children before the outcome log)
});

test("quality: pi share of account quota = rises between pi requests ÷ all rises of the window", () => {
  const meter = [
    turn("a", T0, { q5h: 10, q5hReset: 1 }), turn("a", T0 + 10 * MIN, { q5h: 12, q5hReset: 1 }),
    turn("a", T0 + 120 * MIN, { q5h: 20, q5hReset: 1 }), // +8 while pi was idle: someone else
    turn("a", T0 + 130 * MIN, { q5h: 22, q5hReset: 1 }),
    turn("a", T0 + 140 * MIN, { q5h: 1, q5hReset: 2 }), turn("a", T0 + 150 * MIN, { q5h: 3, q5hReset: 2 }),
  ];
  const q = analyse({ meter, outcomes: [], assignments: [], guards: [] }).quality;
  assert.equal(q.piQuota.q5h.pi, 6);
  assert.equal(q.piQuota.q5h.total, 14);
  close(q.piQuota.q5h.share, 6 / 14);
});

test("quality: interleaved readings of parallel sessions (4, 5, 4, 5, 6) count each point once", () => {
  const meter = [4, 5, 4, 5, 6].map((q, i) => turn(`s${i % 2}`, T0 + i * MIN, { q5h: q, q5hReset: 1 }));
  const q = analyse({ meter, outcomes: [], assignments: [], guards: [] }).quality;
  assert.deepEqual([q.piQuota.q5h.pi, q.piQuota.q5h.total], [2, 2]);
});

test("cost: a root session without active time does not break the $/active hour CI", () => {
  const meter = [turn("once", T0, { costUsd: 0 }), ...turns("busy", T0, 4, { costUsd: 1 })];
  const c = analyse({ meter, outcomes: [], assignments: [], guards: [] }).cost;
  close(c.usdPerHour.mean, 8);
  assert.ok(Number.isFinite(c.usdPerHour.lo) && Number.isFinite(c.usdPerHour.hi));
  contains(c.usdPerHour, 8);
});

// ---- rendering ---------------------------------------------------------------------------------

test("render: every section is present and non-empty; tables are JSON-safe", () => {
  const a = analyse({ ...world(), expSettings: limits });
  const md = renderAnalysis(a);
  const sections = md.split(/^## /m).slice(1);
  assert.deepEqual(sections.map((s) => s.split("\n")[0]), ["Cost", "Experiment", "Delegation & routing", "Guards", "Data quality"]);
  for (const s of sections) assert.ok(s.split("\n").filter((l) => l.startsWith("| ")).length >= 3, s);
  assert.match(md, /disable `\+\+\+\+\+\+`/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(a)));
});

test("render: empty logs still render every section with a 'no data' note", () => {
  const md = renderAnalysis(analyse({ meter: [], outcomes: [], assignments: [], guards: [] } as Logs));
  assert.equal(md.split(/^## /m).length - 1, 5);
  assert.match(md, /no data/);
});

test("reportName: UTC date and HHMM of the run, so two runs of one day keep both reports", () => {
  assert.equal(reportName(new Date("2026-10-05T09:07:59Z")), "2026-10-05-0907-analysis");
  assert.equal(reportName(new Date("2026-10-05T23:59:00Z")), "2026-10-05-2359-analysis");
  assert.notEqual(reportName(new Date("2026-10-05T09:07:00Z")), reportName(new Date("2026-10-05T09:08:00Z")));
  assert.equal(reportName(new Date("2026-10-05T23:30:00-05:00")), "2026-10-06-0430-analysis"); // not the local time
});

// ---- design v3 (T8.10) and the fold ledger (T13.11) ----------------------------------------------

const v3 = (sessionId: string, arm: string, at: number) => ({ ...assignment(sessionId, arm, at), design: "v3" });
/** v2 and v3 sessions on the SAME arm ids: only the session's assignment row tells them apart. */
function twoDesigns(): Logs {
  const meter = [
    ...turns("a2", T0, 4, { arm: "------", costUsd: 1 }), ...turns("b2", T0, 4, { arm: "++++++", costUsd: 3 }),
    ...turns("a3", T0, 4, { arm: "------", costUsd: 5 }), ...turns("b3", T0, 4, { arm: "++++++", costUsd: 9 }),
  ];
  return { meter, outcomes: [], guards: [
    { v: 1, ts: iso(T0), sessionId: "b2", arm: "++++++", event: "correction" },
    { v: 1, ts: iso(T0), sessionId: "b3", arm: "++++++", event: "correction" }, { v: 1, ts: iso(T0 + 1), sessionId: "b3", arm: "++++++", event: "correction" },
  ], assignments: [assignment("a2", "------", T0), assignment("b2", "++++++", T0), v3("a3", "------", T0), v3("b3", "++++++", T0)] };
}

test("experiment: v3 has the six factors of v2 but is a separate table; v2 and v3 sessions on the same arm ids are never pooled", () => {
  const e = analyse(twoDesigns()).experiment;
  assert.deepEqual(e.designs.map((d) => d.design), ["v2", "v3"]);
  const [d2, d3] = e.designs;
  assert.deepEqual(d3.factors, d2.factors);
  assert.equal(d3.baseline, "------");
  assert.deepEqual([d2.units, d3.units], [2, 2]);
  close(d2.arms.find((a) => a.arm === "------")!.costPerHour, 8); // 4 turns × $1 over 0.5 active h
  close(d3.arms.find((a) => a.arm === "------")!.costPerHour, 40); // 4 turns × $5
});

test("guards: events of a v2 and a v3 session on the same arm id are counted in their own design", () => {
  const g = analyse(twoDesigns()).guards;
  const corr = (design: string) => g.perArm.find((a) => a.design === design && a.arm === "++++++")!.corrections;
  assert.deepEqual([corr("v2"), corr("v3")], [1, 2]);
  assert.deepEqual(g.baselines, { v2: "------", v3: "------" });
});

test("experiment: a resumed v2 session keeps design v2 next to new v3 rows (rows are looked up by session)", () => {
  const w = twoDesigns();
  const e = analyse({ ...w, assignments: [...w.assignments, v3("a2", "------", T0 + 1)] }).experiment; // a later v3 row for a2 does not re-label it
  assert.equal(e.designs.find((d) => d.design === "v2")!.units, 2);
  assert.equal(e.designs.find((d) => d.design === "v3")!.units, 2);
});

test("applyKill: the posterior of an arm id shared by v2 and v3 is the newest design's", () => {
  const w = twoDesigns();
  const more = [...turns("a2b", T0, 4, { arm: "------", costUsd: 1 }), ...turns("a3b", T0, 4, { arm: "------", costUsd: 5 })];
  const s = applyKill({}, analyse({ ...w, meter: [...w.meter, ...more], assignments: [...w.assignments, assignment("a2b", "------", T0), v3("a3b", "------", T0)] }));
  close(s.posterior["------"].mean, -40);
});

test("render: v2 and v3 are announced as separate, never pooled", () => {
  assert.match(renderAnalysis(analyse(twoDesigns())), /v2 and v3 have the same factors[^\n]*never pooled/);
  assert.doesNotMatch(renderAnalysis(analyse(world())), /v2 and v3 have the same factors/);
});

/** One session: 5 warm turns (ctx 100k, writes 1k), a fold to 50k writing 3k, then 4 warm turns. */
const foldy = (sid: string, arm: string): Record<string, unknown>[] => [
  ...Array.from({ length: 5 }, (_, i) => turn(sid, T0 + i * MIN, { arm, input: 2, cacheRead: 98_998, cacheWrite: 1_000, output: 10 })),
  turn(sid, T0 + 5 * MIN, { arm, input: 2, cacheRead: 46_998, cacheWrite: 3_000, output: 10 }),
  ...Array.from({ length: 4 }, (_, i) => turn(sid, T0 + (6 + i) * MIN, { arm, input: 2, cacheRead: 48_998, cacheWrite: 1_000, output: 10 })),
];

test("cost: fold ledger = savings − rewrite per fold, grouped by design and foldHint, never pooling v2 with v3", () => {
  const logs: Logs = { meter: [...foldy("f2", "--+---"), ...foldy("f3", "--+---"), ...foldy("g3", "------")], outcomes: [], guards: [],
    assignments: [assignment("f2", "--+---", T0), v3("f3", "--+---", T0), v3("g3", "------", T0)] };
  const f = analyse(logs).cost.folds;
  assert.equal(f.n, 3);
  close(f.netUsd, f.savingsUsd - f.rewriteUsd, 1e-12);
  assert.deepEqual(f.byGroup.map((g) => [g.name, g.n]), [["v2 cache-aware", 1], ["v3 cache-aware", 1], ["v3 fixed", 1]]);
  assert.ok(f.savingsUsd > 0 && f.rewriteUsd > 0);
  assert.equal(f.byDepth.reduce((s, d) => s + d.n, 0), 3);
  assert.deepEqual(f.byModel.map((m) => [m.name, m.n]), [["claude-opus", 3]]);
});

test("render: the fold ledger section names the net formula and the counterfactual", () => {
  const logs: Logs = { meter: foldy("f", "------"), outcomes: [], guards: [], assignments: [v3("f", "------", T0)] };
  const md = renderAnalysis(analyse(logs));
  assert.match(md, /### Fold ledger/);
  assert.match(md, /Net = n·R·r − K·\(w − r\)/);
  assert.match(md, /v3 fixed/);
  assert.match(renderAnalysis(analyse({ meter: [turn("x", T0, { arm: "------" })], outcomes: [], guards: [], assignments: [] })), /no folds in Claude sessions/);
});
