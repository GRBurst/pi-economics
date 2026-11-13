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

test("cost (B13): the token components value a 1h-arm main's cache writes at 2.0 × input, a 5m arm's and a child's at 1.25", () => {
  const P = 1e-6;
  const tokens = { input: 1000, cacheRead: 0, cacheWrite: 1000, output: 0 };
  const line = (sessionId: string, at: number, arm: string, weight: number, extra: Record<string, unknown> = {}) =>
    turn(sessionId, T0 + at * MIN, { arm, ...tokens, costUsd: P * (1000 + weight * 1000), ...extra });
  const meter = [
    line("h", 0, "-+-", 2.0), line("h", 1, "-+-", 2.0), // main in a mainCacheTtl 1h arm: pi priced 2.0
    line("f", 0, "---", 1.25), // main in a 5m arm
    line("k", 0, "-+-", 1.25, { parentSessionId: "h" }), // its child: 5m
  ];
  const assignments = [assignment("h", "-+-", T0 - MIN), assignment("f", "---", T0 - MIN)];
  const c = analyse({ meter, outcomes: [], assignments, guards: [] }).cost;
  close(c.components.cacheWrite1h, 2 * 2.0 * P * 1000, 1e-12);
  close(c.components.cacheWrite5m, 2 * 1.25 * P * 1000, 1e-12);
  close(c.components.input, 4 * P * 1000, 1e-12);
  close(Object.values(c.components).reduce((s, x) => s + x, 0), c.totalUsd, 1e-12);
});

test("cost: splits by model, warming, folds; $ per accepted task", () => {
  const c = analyse(world()).cost;
  const model = Object.fromEntries(c.byModel.map((m) => [m.model, m.usd]));
  close(model["claude-opus"], 20.5); close(model["claude-sonnet"], 27); close(model.qwen, 0.2);
  const split = Object.fromEntries(c.splits.map((s) => [s.name, s]));
  close(split.warming.usd, 0.5);
  close(split.warming.perHour, 0.5 / 3);
  assert.ok(!("cache rewrite" in split), "every non-first write is no rewrite (B3): the Cache section reports growth and misses");
  assert.ok(!("after folds" in split) && !("after cold resumes" in split), "events are in the Cache section, with a premium and a baseline (B4)");
  assert.ok(c.cache.events.fold.events >= 0 && c.cache.events.coldResume.events > 0, "the world's mains resume after gaps of 10 minutes");
  // t1 (0.2) accepted, t2 (1.0) rejected, t3 (2.0) accepted: (0.2 + 1 + 2) / 2
  close(c.perAccepted.perAccepted, 1.6);
  assert.equal(c.perAccepted.accepted, 2);
});

test("cost (B4): a fold (context shrink) is an event; its premium is the extra it paid over reading what it rewrote, net of what an ordinary request misses", () => {
  // five ordinary requests that miss nothing, then a fold that reads 3000 of 5000 (R = 2000 rewritten), 1 $ per request
  const t = (at: number, read: number, write: number) => turn("f", T0 + at * MIN, { arm: "-----", input: 0, cacheRead: read, cacheWrite: write, output: 0, costUsd: 1 });
  const meter = [t(0, 0, 10_000), t(1, 10_000, 200), t(2, 10_200, 200), t(3, 10_400, 200), t(4, 3_000, 2_000), t(5, 5_000, 100), t(6, 5_100, 100)];
  const c = analyse({ meter, outcomes: [], assignments: [], guards: [] }).cost;
  const p = 1 / (0.1 * 3_000 + 1.25 * 2_000); // the fold request's input price: its 1 $ over its weighted tokens
  assert.equal(c.cache.events.fold.events, 1);
  assert.equal(c.cache.events.coldResume.events, 0);
  close(c.cache.events.fold.premiumUsd, 2_000 * (1.25 - 0.1) * p);
  close(c.cache.events.fold.baselineUsd, 0); // the ordinary requests miss nothing
  close(c.cache.events.fold.netUsd, 2_000 * (1.25 - 0.1) * p);
  assert.ok(renderAnalysis(analyse({ meter, outcomes: [], assignments: [], guards: [] })).includes("| after folds | 1 |"));
});

const errLine = (sid: string, at: number, extra: Record<string, unknown> = {}) =>
  turn(sid, T0 + at * MIN, { status: "error", input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0, ...extra });
const none = (meter: any[], extra: Partial<Logs> = {}): Logs => ({ meter, outcomes: [], assignments: [], guards: [], ...extra });

test("cost: error lines are not requests (counted apart), nor active hours", () => {
  const meter = [...turns("e", T0, 2, { arm: "-----" }, 10), errLine("e", 20, { arm: "-----" }), errLine("e", 25, { arm: "-----" })];
  const a = analyse(none(meter));
  assert.equal(a.cost.requests, 2);
  assert.equal(a.cost.errors, 2);
  close(a.cost.activeHours, 10 / 60);
  assert.equal(a.cost.byModel[0].requests, 2);
  assert.ok(renderAnalysis(a).includes("| errors | 2 |"));
});

test("cost: an error line makes no fold", () => {
  const meter = [...turns("f", T0, 3, { arm: "-----" }, 1), errLine("f", 3, { arm: "-----" }), ...turns("f", T0 + 4 * MIN, 3, { arm: "-----" }, 1)];
  assert.equal(analyse(none(meter)).cost.cache.events.fold.events, 0);
});

test("cost (B3): the Cache section: growth is new context, only the prefix a request had to process again is a miss, with its cause", () => {
  const g = (at: number, read: number, write: number) => turn("g", T0 + at * MIN, { arm: "-----", input: 0, cacheRead: read, cacheWrite: write, costUsd: 1 });
  // three requests growing without a gap, then one after 6 minutes at the 5 minute TTL that read nothing
  const a = analyse(none([g(0, 0, 1000), g(1, 1000, 200), g(2, 1200, 300), g(8, 0, 1500)]));
  const c = a.cost.cache;
  assert.deepEqual([c.requests, c.branches, c.writeTokens, c.newContext.tokens], [4, 1, 3000, 1500]);
  assert.deepEqual(c.misses.map((m) => [m.cause, m.n, m.tokens]), [["ttl", 1, 1500], ["fold", 0, 0], ["model", 0, 0], ["other", 0, 0]]);
  close(c.missShare, 0.5);
  const md = renderAnalysis(a);
  assert.ok(md.includes("### Cache"), "the report has a Cache section");
  assert.ok(md.includes("| ttl | 1 | 1500 |"), "misses by cause");
  assert.ok(!md.includes("cache rewrite"), "the rewrite split of every non-first write is gone");
  // without a gap nothing is missed
  const warm = analyse(none([g(0, 0, 1000), g(1, 1000, 200), g(2, 1200, 300), g(3, 1500, 100)])).cost.cache;
  assert.deepEqual([warm.missShare, warm.misses.reduce((s, m) => s + m.tokens, 0)], [0, 0]);
});

test("cost: a long log is analysed in linear time; a huge quota window does not overflow Math.max", () => {
  const n = 200_000;
  const meter = Array.from({ length: n }, (_, i) => turn("big", T0 + i * 1000, { arm: "-----", q5h: 10 + (i % 7), q5hReset: 1, costUsd: 0.001 }));
  const t = Date.now();
  assert.equal(analyse(none(meter)).cost.requests, n);
  assert.ok(Date.now() - t < 10_000, `${Date.now() - t} ms`);
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

test("experiment: per-factor effect = ratio(high) ÷ ratio(low) − 1 (ratio of sums over the units, B8)", () => {
  const [v1, v2] = analyse(world()).experiment.designs;
  const eff = (d: typeof v1) => d.strata[0].effects.flatMap((e) => ("notMeasurable" in e ? [] : [e]));
  assert.equal(v1.strata.length, 1);
  assert.equal(eff(v1).length, 5);
  for (const f of eff(v1)) { close(f.ratioA, 8); close(f.ratioB, 16); close(f.effect, 1); assert.equal(f.nA + f.nB, 2); }
  // v2: high (m4 $15 + m6 $12 over 1 h) ÷ low (m3 $4.7 + m5 $4 over 1 h): the ratio of sums, not the mean of 30 and 24
  for (const f of eff(v2)) { close(f.ratioA, 8.7); close(f.ratioB, 27); close(f.effect, 27 / 8.7 - 1); contains({ lo: f.ci[0], hi: f.ci[1] }, f.effect); }
  const w = eff(v2).find((f) => f.factor === "warmPolicy")!;
  assert.equal(w.a, "native"); assert.equal(w.b, "orchestrator-aware");
});

test("experiment: arm ids without an assignment row are decoded by length", () => {
  const meter = [...turns("x", T0, 4, { arm: "------" }), ...turns("y", T0, 4, { arm: "+++++-", costUsd: 2 })];
  const [d] = analyse({ meter, outcomes: [], assignments: [], guards: [] }).experiment.designs;
  assert.equal(d.design, "v2");
  assert.ok("notMeasurable" in d.strata[0].effects.find((f) => f.factor === "delegationRule")!, "no unit at the high level");
  const w = d.strata[0].effects.find((f) => f.factor === "warmPolicy")!;
  assert.ok(!("notMeasurable" in w));
  if (!("notMeasurable" in w)) close(w.effect, 1); // $2 vs $1 a turn
});

test("experiment: quota per active hour is the root's share of the account's rise — parallel roots (even unarmed ones) do not each count all of it (T13.8)", () => {
  const root = (sid: string, extra: Record<string, unknown>) => turns(sid, T0, 4, { ...extra, costUsd: 1 }).map((l, i) => ({ ...l, q5h: 10 + i, q5hReset: 1 }));
  const meter = [...root("a", { arm: "------" }), ...root("b", { arm: "++++++" }), ...root("u", {})];
  const d = analyse({ meter, outcomes: [], assignments: [], guards: [] }).experiment.designs[0];
  const lo = d.arms.find((a) => a.arm === "------")!;
  close(lo.q5hPerHour, 1 / 0.5); // 3 points over 3 roots = 1 point each, in 30 min; per-root summing gave 3 / 0.5
  close(analyse({ meter, outcomes: [], assignments: [], guards: [] }).cost.q5hPerHour, 3 / 1.5);
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
  // B6: the tier is the model the child ran on (the world's old spawns: provider/model of the child's lines, T1 and T2 by the old route labels)
  const tier = Object.fromEntries(d.byTier.map((t) => [t.tier, t]));
  const [qwen, sonnet, opus] = ["openrouter/qwen", "anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5"];
  assert.deepEqual([tier[qwen].accepted, tier[qwen].judged, tier[sonnet].accepted, tier[sonnet].judged, tier[opus].accepted], [1, 1, 0, 1, 1]);
  close(tier[opus].perAccepted, 2);
  assert.deepEqual(d.escalations, [{ from: "qwen", to: "T2", n: 1 }]);
  assert.equal(d.checks.n, 1); assert.equal(d.checks.failed, 0);
  assert.deepEqual(d.runaways, []);
});

test("delegation: runaway alerts use the router's runaway limits", () => {
  const w = { ...world(), routerSettings: { runaway: { requests: 4, usd: 100 } } };
  const d = analyse(w).delegation;
  assert.deepEqual(d.runaways.map((r) => [r.sessionId, r.taskId, r.requests]), [["c3", "t3", 5]]);
});

test("delegation: error lines do not count towards the runaway request limit or the child request share", () => {
  const kid = { parentSessionId: "m" };
  const meter = [...turns("m", T0, 2), ...turns("k", T0, 3, { ...kid, costUsd: 0.01 }, 1), errLine("k", 4, kid), errLine("k", 5, kid), errLine("k", 6, kid)];
  const d = analyse(none(meter, { routerSettings: { runaway: { requests: 3, usd: 100 } } })).delegation;
  assert.deepEqual(d.runaways, []);
  close(d.childRequestShare, 3 / 5);
  assert.equal(d.childModels[0].requests, 3);
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

// ---- design v3 and the fold ledger ----------------------------------------------------------------

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

// Local mode L2.T3 (plan D20): session-level lines (force, taskId "") are no task events; they never count as unjoinable.
test("quality: session-level lines are no data-quality defect", () => {
  const item = (w: Logs) => analyse(w).quality.unjoinable.find((x) => x.what === "task events without a spawn")!;
  const base = world();
  base.outcomes.push({ v: 1, ts: iso(T0), event: "verdict", taskId: "t9", verdict: "accepted" }); // one real defect
  const w: Logs = JSON.parse(JSON.stringify(base));
  for (const action of ["set", "used", "expired", "rejected", "clear"])
    w.outcomes.push({ v: 1, ts: iso(T0 + 61 * MIN), event: "force", taskId: "", action, source: "command", model: "anthropic/claude-sonnet-5-5" });
  assert.deepEqual(item(w), item(base));
  assert.equal(item(base).n, 1);
});

// Local mode L3.T5 (plan D20): hint lines (taskId "main" or a child's name) are no task events either.
test("quality: hint lines are no data-quality defect", () => {
  const item = (w: Logs) => analyse(w).quality.unjoinable.find((x) => x.what === "task events without a spawn")!;
  const base = world();
  base.outcomes.push({ v: 1, ts: iso(T0), event: "verdict", taskId: "t9", verdict: "accepted" }); // one real defect
  const w: Logs = JSON.parse(JSON.stringify(base));
  for (const taskId of ["main", "c9"]) for (const stage of ["hint", "steer", "parent"])
    w.outcomes.push({ v: 1, ts: iso(T0 + 61 * MIN), event: "hint", taskId, trip: "identical-call", stage, count: 1 });
  assert.deepEqual(item(w), item(base));
  assert.equal(item(base).n, 1);
});

// Local mode L4.T11 (design §3.0.3): review lines (taskId = the review id) are no task events, and an overseer's session is
// named by its ticket spawn line.
test("quality: review lines and overseer sessions are no data-quality defect", () => {
  const item = (w: Logs, what: string) => analyse(w).quality.unjoinable.find((x) => x.what === what)!;
  const TASKS = "task events without a spawn", KIDS = "child sessions without a spawn event (their $ is in no tier)";
  const base = world();
  base.outcomes.push({ v: 1, ts: iso(T0), event: "verdict", taskId: "t9", verdict: "accepted" }); // one real defect
  const w: Logs = JSON.parse(JSON.stringify(base));
  w.outcomes.push({ v: 1, ts: iso(T0 + 63 * MIN), event: "spawn", taskId: "ovs-merge-1", kind: "overseer", ticket: "merge", workerTier: "T2",
    workerEffort: "high", arm: "++++++", sessionId: "o1", parentSessionId: "m4" });
  w.meter.push(...turns("o1", T0 + 63 * MIN, 2, { arm: "++++++", parentSessionId: "m4", model: "claude-opus" }));
  for (const outcome of ["approve", "revise", "invalid", "timeout", "error"])
    w.outcomes.push({ v: 1, ts: iso(T0 + 64 * MIN), event: "review", taskId: "rv-0000abcd", role: "merge", member: "opus", model: "anthropic/claude-opus-5-5", outcome });
  assert.deepEqual(item(w, TASKS), item(base, TASKS));
  assert.deepEqual(item(w, KIDS), item(base, KIDS));
  assert.equal(item(base, TASKS).n, 1);
});

// ---- design v4 ---------------------------------------------------------------------------------

/** v4 = three factors (warmPolicy, mainCacheTtl, maskOnCold), the full 2^3: 3-char arm ids, rows with design "v4". */
test("experiment: design v4 has the experiments package's three factors in their order, with their levels", () => {
  const meter = [...turns("a4", T0, 4, { arm: "---", costUsd: 1 }), ...turns("b4", T0, 4, { arm: "+++", costUsd: 3 })];
  const [d] = analyse({ meter, outcomes: [], guards: [], assignments: [assignment("a4", "---", T0), assignment("b4", "+++", T0)] }).experiment.designs;
  assert.equal(d.design, "v4");
  assert.deepEqual(d.factors, ["warmPolicy", "mainCacheTtl", "maskOnCold"]);
  assert.equal(d.baseline, "---");
  const es = d.strata[0].effects.flatMap((e) => ("notMeasurable" in e ? [] : [e]));
  assert.deepEqual(es.map((e) => [e.factor, e.a, e.b]), [["warmPolicy", "native", "orchestrator-aware"], ["mainCacheTtl", "5m", "1h"], ["maskOnCold", "off", "on"]]);
  for (const e of es) close(e.effect, 24 / 8 - 1); // 4 turns × $3 vs × $1 over 0.5 active h
});

test("experiment: 3-char arm ids without an assignment row are decoded as v4", () => {
  const meter = [...turns("x", T0, 4, { arm: "---" }), ...turns("y", T0, 4, { arm: "-+-", costUsd: 2 })];
  const [d] = analyse({ meter, outcomes: [], assignments: [], guards: [] }).experiment.designs;
  assert.equal(d.design, "v4");
  const ttl = d.strata[0].effects.find((f) => f.factor === "mainCacheTtl")!;
  assert.ok(!("notMeasurable" in ttl));
  if (!("notMeasurable" in ttl)) { assert.deepEqual([ttl.a, ttl.b, ttl.nB], ["5m", "1h", 1]); close(ttl.effect, 1); }
});

test("cost: v4 folds form their own ledger group; v4 has no foldHint level", () => {
  const logs: Logs = { meter: [...foldy("f3", "--+---"), ...foldy("f4", "---")], outcomes: [], guards: [],
    assignments: [v3("f3", "--+---", T0), assignment("f4", "---", T0)] };
  assert.deepEqual(analyse(logs).cost.folds.byGroup.map((g) => [g.name, g.n]), [["v3 cache-aware", 1], ["v4 –", 1]]);
});
