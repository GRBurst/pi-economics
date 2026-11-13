// Experiment estimation per stratum (redesign M2c, B8): ratio of sums per factor level inside each stratum, never pooled; balance; power.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, renderExperiment, type Logs } from "../core/analyse.ts";
import { bootstrapRatio, mulberry32 } from "../core/stats.ts";
import { MIN_HOURS } from "../core/arms.ts";
import { assignment, MIN, T0, turn, turns } from "./world.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const RATE = { amount: 2, currency: "EUR", per: "hour" } as const;
const PLANS = { llama: { billing: "local", windows: [] as ("5h" | "7d")[], rate: RATE } } as const;

/** A cloud root of `usd` dollars over 1 active hour (7 turns 10 minutes apart). */
const cloud = (id: string, arm: string, usd: number, start = T0) => turns(id, start, 7, { arm, costUsd: usd / 7 });
/** A local-main root of 0.1 active hours (3 turns 3 minutes apart); v1 line: no durationMs. */
const local = (id: string, arm: string, start = T0, extra: Record<string, unknown> = {}) =>
  turns(id, start, 3, { arm, provider: "llama", model: "qwen", costUsd: 0, ...extra }, 3);
/** A local-main root of 0.5 active hours (4 turns 10 minutes apart), `ms` of request time per turn. */
const localV2 = (id: string, arm: string, ms: number, start = T0) => turns(id, start, 4, { v: 2, arm, provider: "llama", model: "qwen", costUsd: 0, durationMs: ms });

const logs = (units: Record<string, unknown>[][], plans?: Logs["plans"]): Logs => ({
  meter: units.flat(), outcomes: [], guards: [], plans,
  assignments: units.map((u) => assignment(String(u[0].sessionId), String(u[0].arm), T0)),
});
const design = (l: Logs, d = "v4") => analyse(l).experiment.designs.find((x) => x.design === d)!;
const stratum = (l: Logs, s: string, d = "v4") => design(l, d).strata.find((x) => x.stratum === s)!;
const effect = (l: Logs, s: string, factor = "warmPolicy") => {
  const e = stratum(l, s).effects.find((x) => x.factor === factor)!;
  return e;
};

test("T2c.1: a cloud unit of 1 h $10 and a local-main unit of 0.1 h are two strata; the cloud ratio is the hand value", () => {
  const l = logs([cloud("a", "---", 10), cloud("b", "+--", 20), local("l1", "---"), local("l2", "+--")], PLANS);
  assert.deepEqual(design(l).strata.map((s) => s.stratum), ["api", "local"]);
  const e = effect(l, "api");
  assert.ok(!("notMeasurable" in e));
  if ("notMeasurable" in e) return;
  assert.deepEqual([e.a, e.b], ["native", "orchestrator-aware"]);
  close(e.ratioA, 10); close(e.ratioB, 20); close(e.effect, 1);
  assert.equal(stratum(l, "api").objective, "apiUsd");
});

test("T2c.2: the local stratum on v1 lines (no durationMs) reads 'not measurable'", () => {
  const l = logs([cloud("a", "---", 10), cloud("b", "+--", 20), local("l1", "---"), local("l2", "+--")], PLANS);
  const s = stratum(l, "local");
  assert.equal(s.objective, "localCost");
  for (const e of s.effects) {
    assert.ok("notMeasurable" in e, `${e.factor} must be not measurable`);
    if ("notMeasurable" in e) assert.ok(e.notMeasurable.startsWith("not measurable") && e.notMeasurable.includes("durationMs"), e.notMeasurable);
  }
});

test("T2c.2: on v2 lines the local stratum's objective is localCost (request hours × the plan's rate), wallMs without a rate", () => {
  const units = [localV2("l1", "---", 900_000), localV2("l2", "+--", 1_800_000)]; // 1 h and 2 h of requests in 0.5 active h
  const e = effect(logs(units, PLANS), "local");
  assert.ok(!("notMeasurable" in e));
  if ("notMeasurable" in e) return;
  close(e.ratioA, (1 * 2) / 0.5); close(e.ratioB, (2 * 2) / 0.5); close(e.effect, 1);
  const noRate = logs(units, { llama: { billing: "local", windows: [] } });
  assert.equal(stratum(noRate, "local").objective, "wallMs");
  const w = effect(noRate, "local");
  assert.ok(!("notMeasurable" in w));
  if (!("notMeasurable" in w)) { close(w.ratioA, 3_600_000 / 0.5); close(w.effect, 1); }
});

test("T2c.3: MIN_HOURS only excludes a unit from the estimate; the balance table counts it", () => {
  const short = turns("s", T0, 2, { arm: "---", costUsd: 100 }, 0.6); // 0.01 h
  const l = logs([cloud("a", "---", 10), cloud("b", "+--", 20), short]);
  assert.ok(0.01 < MIN_HOURS);
  const e = effect(l, "api");
  assert.ok(!("notMeasurable" in e));
  if (!("notMeasurable" in e)) { close(e.ratioA, 10); close(e.effect, 1); }
  const row = stratum(l, "api").balance.find((b) => b.arm === "---")!;
  assert.deepEqual([row.units, row.excluded], [1, 1]);
  close(row.hours, 1);
  assert.equal(design(l).units, 2);
});

test("T2c.4: the bootstrap is deterministic, its CI contains the estimate, mde = 2.80 · sd", () => {
  const a = [1, 2, 3, 4, 5, 6].map((i) => ({ objective: 10 + 3 * (i % 3), hours: 1 + (i % 2) }));
  const b = [1, 2, 3, 4, 5, 6].map((i) => ({ objective: 14 + 2 * (i % 4), hours: 1 + (i % 3) * 0.5 }));
  const r1 = bootstrapRatio(a, b, 2000, 1), r2 = bootstrapRatio(a, b, 2000, 1);
  assert.deepEqual(r1, r2);
  const ratio = (us: typeof a) => us.reduce((s, u) => s + u.objective, 0) / us.reduce((s, u) => s + u.hours, 0);
  const point = ratio(b) / ratio(a) - 1;
  assert.ok(r1.ci[0] <= point && point <= r1.ci[1], `${point} ∉ ${r1.ci}`);
  assert.ok(r1.sd > 0);
  assert.notDeepEqual(bootstrapRatio(a, b, 2000, 2), r1);
  assert.equal(typeof mulberry32(1)(), "number");
  const units = [cloud("a1", "---", 8), cloud("a2", "---", 12), cloud("a3", "---", 10), cloud("b1", "+--", 18), cloud("b2", "+--", 25), cloud("b3", "+--", 20)];
  const e = effect(logs(units), "api");
  assert.ok(!("notMeasurable" in e));
  if ("notMeasurable" in e) return;
  assert.ok(e.ci[0] <= e.effect && e.effect <= e.ci[1], `${e.effect} ∉ ${e.ci}`);
  close(e.mde, 2.8 * bootstrapRatio(
    [8, 12, 10].map((x) => ({ objective: x, hours: 1 })), [18, 25, 20].map((x) => ({ objective: x, hours: 1 })), 2000, 1).sd, 1e-9);
});

test("T2c.6: strata are never pooled — units of another stratum leave a stratum's effects unchanged", () => {
  const base = [cloud("a", "---", 10), cloud("b", "+--", 20), cloud("c", "---", 14), cloud("d", "+--", 16)];
  const without = logs(base, PLANS);
  const withLocal = logs([...base, localV2("l1", "---", 900_000), localV2("l2", "+--", 1_800_000, T0 + 5 * 60 * MIN), local("l3", "+--", T0 + 7 * 60 * MIN)], PLANS);
  assert.deepEqual(stratum(withLocal, "api").effects, stratum(without, "api").effects);
  assert.deepEqual(stratum(withLocal, "api").balance, stratum(without, "api").balance);
  assert.ok(stratum(withLocal, "local").effects.length > 0);
});

test("T2c.6: a stratum is the billing class of the provider of the root's first main turn; plans absent ⇒ every unit is api, and the report says so", () => {
  const meter = [cloud("a", "---", 10), cloud("b", "+--", 20), local("l1", "---"), local("l2", "+--")];
  const l = logs(meter);
  assert.deepEqual(design(l).strata.map((s) => s.stratum), ["api"]);
  assert.equal(design(l).plansAbsent, true);
  assert.ok(renderExperiment([design(l)]).includes("plans absent"));
  assert.equal(design(logs(meter, PLANS)).plansAbsent, false);
  assert.ok(!renderExperiment([design(logs(meter, PLANS))]).includes("plans absent"));
  // a child's provider does not decide: the main's does
  const mixed = [...cloud("m", "---", 10), ...turns("k", T0, 3, { arm: "---", parentSessionId: "m", provider: "llama", model: "qwen" }, 3)];
  assert.deepEqual(design(logs([mixed, cloud("n", "+--", 20)], PLANS)).strata.map((s) => s.stratum), ["api"]);
});

test("T2c.7: design v4 units are recognised from the legacy table (arm ids of 3 characters, no assignment row)", () => {
  const meter = [...cloud("x", "---", 10), ...cloud("y", "-+-", 30)];
  const d = analyse({ meter, outcomes: [], assignments: [], guards: [] }).experiment.designs[0];
  assert.equal(d.design, "v4");
  const e = d.strata[0].effects.find((f) => f.factor === "mainCacheTtl")!;
  assert.ok(!("notMeasurable" in e));
  if (!("notMeasurable" in e)) { assert.deepEqual([e.a, e.b], ["5m", "1h"]); close(e.effect, 2); }
});

test("T2c.5: the balance table and the power line are rendered per design and stratum; one unit per level gives no CI and no power", () => {
  const l = logs([cloud("a", "---", 10), cloud("a2", "---", 12), cloud("a3", "---", 9), cloud("b", "+--", 20), cloud("b2", "+--", 24), cloud("b3", "+--", 17)]);
  const text = renderExperiment([design(l)]);
  assert.ok(text.includes("Balance"));
  assert.ok(text.includes("Power"));
  assert.ok(text.includes("stratum api"));
  const thin = logs([cloud("a", "---", 10), cloud("b", "+--", 20)]);
  const e = effect(thin, "api");
  assert.ok(!("notMeasurable" in e));
  if (!("notMeasurable" in e)) assert.ok(Number.isNaN(e.mde) && Number.isNaN(e.ci[0]));
  assert.ok(renderExperiment([design(thin)]).includes("Power: not estimable"));
});

test("T2c: the five factors of design v1 are estimated per stratum as well", () => {
  const meter = [turn("a", T0, { arm: "-----", costUsd: 4 }), turn("a", T0 + 40 * MIN, { arm: "-----", costUsd: 4 }), turn("b", T0, { arm: "+++++", costUsd: 8 }), turn("b", T0 + 40 * MIN, { arm: "+++++", costUsd: 8 })];
  const d = analyse({ meter, outcomes: [], assignments: [], guards: [] }).experiment.designs[0];
  assert.equal(d.design, "v1");
  assert.equal(d.strata[0].effects.length, 5);
});

// ---- review fixes (m2, m3, m5, N2, N3) ----

test("m2: when every unit of a stratum is under MIN_HOURS the reason says so, not 'no cost'", () => {
  const l = logs([turns("a", T0, 2, { arm: "---", costUsd: 3 }, 0.6), turns("b", T0, 2, { arm: "+--", costUsd: 3 }, 0.6)]);
  const e = effect(l, "api");
  assert.ok("notMeasurable" in e);
  if ("notMeasurable" in e) assert.ok(e.notMeasurable.includes("under 0.05 active h"), e.notMeasurable);
});

test("m3: localCost and wallMs both sum the lines that have durationMs; a unit with some untimed lines stays, the balance table shows the timing coverage", () => {
  const unit = (id: string, arm: string, ms: number) => { const ls = localV2(id, arm, ms); delete (ls[3] as any).durationMs; return ls; }; // 3 timed + 1 untimed line
  const l = logs([unit("l1", "---", 1_200_000), unit("l2", "+--", 2_400_000)], PLANS);
  const s = stratum(l, "local");
  const e = s.effects[0];
  assert.ok(!("notMeasurable" in e));
  if ("notMeasurable" in e) return;
  assert.equal(e.nA, 1);
  close(e.ratioA, ((3 * 1_200_000) / 3_600_000 * 2) / 0.5); // 3 timed lines of 20 min at 2 EUR/h over 0.5 active h
  assert.deepEqual(s.balance.map((b) => [b.arm, b.timedLines, b.untimedLines]), [["+--", 3, 1], ["---", 3, 1]]);
  assert.equal(s.balance[0].unmeasured, 0);
  const wall = stratum(logs([unit("l1", "---", 1_200_000), unit("l2", "+--", 2_400_000)], { llama: { billing: "local", windows: [] } }), "local");
  assert.equal(wall.objective, "wallMs");
  assert.deepEqual(wall.balance.map((b) => [b.timedLines, b.untimedLines]), [[3, 1], [3, 1]]);
  assert.ok(renderExperiment([design(l)]).includes("untimed"));
});

test("m5a: a v2 line's own billing decides its stratum over plans; legacy lines use plans", () => {
  const v2 = (id: string, arm: string) => turns(id, T0, 4, { v: 2, arm, provider: "llama", model: "qwen", costUsd: 0, durationMs: 900_000, billing: "local" });
  const l = logs([v2("l1", "---"), v2("l2", "+--"), cloud("a", "---", 10), cloud("b", "+--", 20)], PLANS_UNRELATED);
  assert.deepEqual(design(l).strata.map((s) => s.stratum), ["api", "local"]);
});
const PLANS_UNRELATED = { other: { billing: "free", windows: [] as ("5h" | "7d")[] } } as const;

test("m5b: the plans-absent note shows whenever no usable plan entry remains (plans {} too)", () => {
  const meter = [cloud("a", "---", 10), cloud("b", "+--", 20)];
  assert.equal(design(logs(meter, {})).plansAbsent, true);
  assert.equal(design(logs(meter, PLANS)).plansAbsent, false);
});

test("N2: dropped (non-finite) bootstrap draws are counted and shown", () => {
  const zero = { ...cloud("z", "---", 0)[0] }; void zero;
  const l = logs([cloud("a1", "---", 0), cloud("a2", "---", 8), cloud("b1", "+--", 20), cloud("b2", "+--", 24)]);
  const e = effect(l, "api");
  assert.ok(!("notMeasurable" in e));
  if ("notMeasurable" in e) return;
  assert.ok(e.dropped > 0, `dropped ${e.dropped}`);
  assert.ok(renderExperiment([design(l)]).includes("non-finite bootstrap draws dropped"));
});

test("N3: zero variance gives an MDE of 'n/a (zero variance)', no perfect power", () => {
  const l = logs([cloud("a1", "---", 10), cloud("a2", "---", 10), cloud("b1", "+--", 20), cloud("b2", "+--", 20)]);
  const text = renderExperiment([design(l)]);
  assert.ok(text.includes("n/a (zero variance)"));
  assert.ok(!text.includes("±0%"));
});

test("m4: a local stratum's report says its objective leaves out the unit's requests to other providers", () => {
  const l = logs([localV2("l1", "---", 900_000), localV2("l2", "+--", 1_800_000)], PLANS);
  assert.ok(renderExperiment([design(l)]).includes("requests to other providers"));
});

test("m1: the report says the effects are marginal per factor (no interaction model)", () => {
  assert.ok(renderExperiment([design(logs([cloud("a", "---", 10), cloud("b", "+--", 20)]))]).includes("marginal per factor"));
});
