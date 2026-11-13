// The analyser on assignments v2 (redesign M5c, §7.5, §9.4): units keyed (design, stratum), per-protocol over confirmed read-backs,
// refusal rates, overflow per active hour, the model-switch sensitivity row, design ids never pooled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, applyKill, renderAnalysis, renderExperiment, type Logs, type Effect } from "../core/analyse.ts";
import { mulberry32 } from "../core/stats.ts";
import { iso, MIN, T0, turns } from "./world.ts";

const D = "a1b2c3d4e5f6", E = "0f9e8d7c6b5a";
const FACTORS: Array<[string, string, [string, string]]> = [
  ["warmPolicy", "cache-lifecycle.warmPolicy", ["native", "orchestrator-aware"]],
  ["mainCacheTtl", "cache-lifecycle.mainCacheTtl", ["5m", "1h"]],
];
const row = (sessionId: string, arm: string, stratum = "api", design = D, factors = FACTORS) => ({
  v: 2, ts: iso(T0), sessionId, design, mode: "explore", eligible: true, stratum, arm,
  factors: Object.fromEntries(factors.map(([name, lever, levels], i) => [name, { lever, assigned: levels[Number(arm[i])] }])),
});
/** A levers line of a root's main: per factor lever the read-back `rb` (default confirmed), v = a unless refused. */
const levers = (sessionId: string, arm: string, rb: Record<string, "confirmed" | "refused" | "unverified"> = {}, design = D) => ({
  v: 2, ts: iso(T0), sessionId, kind: "levers", eligible: true, design, stratum: "api", arm,
  levers: Object.fromEntries(FACTORS.map(([name, lever, levels], i) => {
    const a = levels[Number(arm[i])], r = rb[name] ?? "confirmed";
    return [lever, r === "refused" ? { v: levels[1 - Number(arm[i])], s: "ext", a, rb: r } : { v: a, s: "pe", a, rb: r }];
  })),
});
/** A cloud root of 1 active hour, `usd` in all. */
const cloud = (id: string, arm: string, usd: number, extra: Record<string, unknown> = {}, design = D) => turns(id, T0 + MIN, 7, { v: 2, arm, design, costUsd: usd / 7, ...extra });
const logs = (meter: Record<string, unknown>[], rows: Record<string, unknown>[], plans?: Logs["plans"]): Logs => ({ meter, outcomes: [], guards: [], assignments: rows, plans });
const stratumOf = (l: Logs, s = "api", d = D) => analyse(l).experiment.designs.find((x) => x.design === d)!.strata.find((x) => x.stratum === s)!;
const eff = (es: Effect[], f: string) => es.find((e) => e.factor === f)!;
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** Eight units of 1 active h in four arms: warmPolicy low 10/12 $, high 20/24 $ (marginal ratios 11 and 22). */
const base = () => {
  const spec: Array<[string, string, number]> = [["a", "00", 10], ["b", "00", 10], ["c", "10", 20], ["d", "10", 20], ["e", "01", 12], ["f", "01", 12], ["g", "11", 24], ["h", "11", 24]];
  return spec.map(([id, arm, usd]) => ({ id, arm, usd }));
};

test("T5c.1: units are keyed (design, stratum) from the v2 rows: a stratum named by the row, the arm's factors from the row", () => {
  const us = base();
  const l = logs(us.flatMap((u) => cloud(u.id, u.arm, u.usd)), us.map((u, i) => row(u.id, u.arm, i < 4 ? "api" : "opus")));
  const d = analyse(l).experiment.designs.find((x) => x.design === D)!;
  assert.deepEqual(d.strata.map((s) => s.stratum).sort(), ["api", "opus"]);
  assert.deepEqual(d.strata.find((s) => s.stratum === "opus")!.balance.map((b) => [b.arm, b.units]), [["01", 2], ["11", 2]]);
});

test("T5c.2: a v2 stratum named by its row takes the objective from settings: wallMs = Σ durationMs of the main's requests per active hour", () => {
  const us = base();
  const meter = us.flatMap((u) => cloud(u.id, u.arm, u.usd, { durationMs: u.usd * 1000 }));
  const l = { ...logs(meter, us.map((u) => row(u.id, u.arm, "opus"))), expSettings: { strata: { opus: { objective: "wallMs" } } } };
  const s = stratumOf(l, "opus");
  assert.equal(s.objective, "wallMs");
  const e = eff(s.effects, "warmPolicy");
  assert.ok(!("notMeasurable" in e));
  if ("notMeasurable" in e) return;
  close(e.ratioA, 7 * 11 * 1000); close(e.ratioB, 7 * 22 * 1000);
});

test("T5c.3: per-protocol keeps the units whose every factor lever is read back 'confirmed'; unverified and refused units leave it", () => {
  const us = base();
  // c ("10") is unverified on warmPolicy, e ("01") refused on mainCacheTtl.
  const lv = us.map((u) => levers(u.id, u.arm, u.id === "c" ? { warmPolicy: "unverified" } : u.id === "e" ? { mainCacheTtl: "refused" } : {}));
  const s = stratumOf(logs([...us.flatMap((u) => cloud(u.id, u.arm, u.usd)), ...lv], us.map((u) => row(u.id, u.arm))));
  assert.ok(s.perProtocol, "a v2 stratum has a per-protocol block");
  assert.equal(s.perProtocol!.units, 6);
  assert.equal(s.perProtocol!.excluded, 2);
  const e = eff(s.perProtocol!.effects, "warmPolicy");
  assert.ok(!("notMeasurable" in e));
  if ("notMeasurable" in e) return;
  assert.deepEqual([e.nA, e.nB], [3, 3]); // low: a b f; high: d g h
  close(e.ratioA, 32 / 3); close(e.ratioB, 68 / 3);
  // The intention-to-treat estimate keeps every unit.
  const itt = eff(s.effects, "warmPolicy");
  if (!("notMeasurable" in itt)) assert.deepEqual([itt.nA, itt.nB], [4, 4]);
});

test("T5c.3: a unit without a levers line is not confirmed; the rendering labels per-protocol a non-randomized comparison", () => {
  const us = base();
  const l = logs(us.flatMap((u) => cloud(u.id, u.arm, u.usd)), us.map((u) => row(u.id, u.arm)));
  assert.equal(stratumOf(l).perProtocol!.units, 0);
  const text = renderExperiment(analyse(l).experiment.designs);
  assert.ok(text.includes("non-randomized comparison"), text);
  assert.ok(text.includes("Per-protocol"), text);
});

test("T5c.4: refusal rate per factor = refused ÷ eligible; above 0.20 the add-on is flagged broken (0.20 itself is not)", () => {
  const us = base().concat([{ id: "i", arm: "00", usd: 10 }, { id: "j", arm: "00", usd: 10 }]);
  const lv = (refused: string[]) => us.map((u) => levers(u.id, u.arm, refused.includes(u.id) ? { warmPolicy: "refused" } : {}));
  const world = (refused: string[]) => logs([...us.flatMap((u) => cloud(u.id, u.arm, u.usd)), ...lv(refused)], us.map((u) => row(u.id, u.arm)));
  const two = stratumOf(world(["a", "c"])).refusal!; // 2 / 10 = 0.20
  const w2 = two.find((r) => r.factor === "warmPolicy")!;
  assert.deepEqual([w2.eligible, w2.refused, w2.broken, w2.lever], [10, 2, false, "cache-lifecycle.warmPolicy"]);
  close(w2.rate, 0.2);
  const three = stratumOf(world(["a", "c", "e"])).refusal!;
  const w3 = three.find((r) => r.factor === "warmPolicy")!;
  assert.deepEqual([w3.refused, w3.broken], [3, true]);
  assert.equal(three.find((r) => r.factor === "mainCacheTtl")!.refused, 0);
  assert.ok(renderExperiment(analyse(world(["a", "c", "e"])).experiment.designs).includes("broken add-on"));
  assert.ok(!renderExperiment(analyse(world(["a"])).experiment.designs).includes("broken add-on"));
});

test("T5c.5: context overflows per active hour per arm (errorKind), error lines add no hours", () => {
  const us = base();
  const errLine = (id: string, at: number, errorKind: string) => ({ v: 2, ts: iso(T0 + at * MIN), sessionId: id, provider: "anthropic", model: "claude-opus", kind: "turn", status: "error", errorKind, arm: "00", design: D });
  const l = logs([...us.flatMap((u) => cloud(u.id, u.arm, u.usd)), errLine("a", 5, "context_overflow"), errLine("a", 6, "context_overflow"), errLine("b", 5, "context_overflow"), errLine("a", 3, "rate_limit")], us.map((u) => row(u.id, u.arm)));
  const o = stratumOf(l).overflow!;
  const r = o.find((x) => x.arm === "00")!;
  assert.deepEqual([r.overflows, r.units], [3, 2]);
  close(r.hours, 2); close(r.perHour, 1.5);
  assert.equal(o.find((x) => x.arm === "11")!.overflows, 0);
  assert.ok(renderExperiment(analyse(l).experiment.designs).includes("Context overflows"));
});

test("T5c.6: the sensitivity row restricts a unit's objective to requests billed as its start class; a model switch is counted", () => {
  const us = base();
  const plans = { llama: { billing: "local" as const, windows: [] as ("5h" | "7d")[] } };
  // c switches its main to the local provider after 3 requests.
  const meter = us.flatMap((u) => cloud(u.id, u.arm, u.usd).map((x, i) => (u.id === "c" && i >= 3 ? { ...x, provider: "llama", model: "qwen" } : x)));
  const l = logs(meter, us.map((u) => row(u.id, u.arm)), plans);
  const s = stratumOf(l);
  assert.ok(s.sensitivity);
  assert.equal(s.sensitivity!.switched, 1);
  const e = eff(s.sensitivity!.effects, "warmPolicy");
  assert.ok(!("notMeasurable" in e));
  if ("notMeasurable" in e) return;
  close(e.ratioA, 11); close(e.ratioB, (60 / 7 + 20 + 24 + 24) / 4);
  const itt = eff(s.effects, "warmPolicy");
  if (!("notMeasurable" in itt)) close(itt.ratioB, 22); // the primary estimate counts every request
  assert.ok(renderExperiment(analyse(l).experiment.designs).includes("Sensitivity"));
});

test("T5c.7 property: two designs with equal factor names (distinct ids) are never pooled", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rand = mulberry32(seed);
    const meter: Record<string, unknown>[] = [], rows: Record<string, unknown>[] = [], onlyD: Record<string, unknown>[] = [], rowsD: Record<string, unknown>[] = [];
    const n = 6 + Math.floor(rand() * 10);
    for (let i = 0; i < n; i++) {
      const design = rand() < 0.5 ? D : E, id = `s${seed}-${i}`, arm = `${Math.floor(rand() * 2)}${Math.floor(rand() * 2)}`, usd = 1 + Math.floor(rand() * 30);
      const ls = cloud(id, arm, usd, {}, design), r = row(id, arm, rand() < 0.3 ? "opus" : "api", design);
      meter.push(...ls); rows.push(r);
      if (design === D) { onlyD.push(...ls); rowsD.push(r); }
    }
    const all = analyse(logs(meter, rows)).experiment.designs, d = analyse(logs(onlyD, rowsD)).experiment.designs;
    assert.deepEqual(all.map((x) => x.design).sort(), [...new Set(rows.map((r) => r.design as string))].sort(), `seed ${seed}`);
    assert.deepEqual(all.find((x) => x.design === D)?.strata, d.find((x) => x.design === D)?.strata, `seed ${seed}: design D's strata do not depend on E`);
  }
});

// ---- T5c.9: kill switch and posterior per (design, stratum), written where the v2 engine reads them ---------------------

/** Units a1..a3 (arm "00") and b1..b3 (arm "10") in each stratum; in "api" every task of an "10" unit is rejected, in "opus" all are accepted. */
function killWorld(): Logs {
  const meter: Record<string, unknown>[] = [], rows: Record<string, unknown>[] = [], outcomes: Record<string, unknown>[] = [];
  for (const stratum of ["api", "opus"]) for (const [prefix, arm] of [["a", "00"], ["b", "10"]]) for (let i = 1; i <= 3; i++) {
    const id = `${stratum}-${prefix}${i}`;
    meter.push(...cloud(id, arm, 10 + i));
    rows.push(row(id, arm, stratum));
    outcomes.push({ v: 1, ts: iso(T0 + 30 * MIN), event: "spawn", taskId: `t-${id}`, sessionId: `c-${id}`, parentSessionId: id },
      { v: 1, ts: iso(T0 + 40 * MIN), event: "verdict", taskId: `t-${id}`, verdict: stratum === "api" && arm === "10" ? "rejected" : "accepted" });
  }
  return { meter, outcomes, guards: [], assignments: rows, expSettings: { guards: { minSessions: 3, threshold: 0.2 } } };
}

test("T5c.9: the kill switch runs per (design, stratum): an arm bad in one stratum is disabled there only; the flat kill list holds no v2 arm", () => {
  const g = analyse(killWorld()).guards;
  assert.deepEqual(g.perStratum.map((s) => [s.design, s.stratum, Object.keys(s.kill)]), [[D, "api", ["10"]], [D, "opus", []]]);
  assert.match(g.perStratum[0].kill["10"], /acceptance 0% \(0\/3\) vs baseline 100% \(3\/3\)/);
  assert.deepEqual(g.kill, {});
});

test("T5c.9: applyKill writes designs.<id>.<stratum> = { disabled, posterior (reward by arm), reasons }, keeps the flat keys and other designs, and writes no v2 arm flat", () => {
  const a = analyse(killWorld());
  const old = { disabled: ["-+-"], posterior: { "-+-": { mean: -1, sd: 1 } }, reasons: { "-+-": "old" },
    designs: { [D]: { api: { disabled: ["11"], reasons: { "11": "earlier" }, extra: true } }, "ffffffffffff": { api: { disabled: ["1"] } } } };
  const s = applyKill(old, a) as any;
  assert.deepEqual(s.disabled, ["-+-"]);
  assert.deepEqual(Object.keys(s.posterior), []);
  assert.deepEqual(s.designs[D].api.disabled, ["11", "10"]);
  assert.deepEqual(s.designs[D].api.reasons["11"], "earlier");
  assert.ok(String(s.designs[D].api.reasons["10"]).startsWith("acceptance"));
  assert.equal(s.designs[D].api.extra, true);
  assert.deepEqual(s.designs[D].opus.disabled, []);
  assert.deepEqual(Object.keys(s.designs[D].opus.posterior).sort(), ["00", "10"]);
  const p = s.designs[D].api.posterior["00"];
  assert.ok(p.mean < 0 && p.sd >= 0, "a reward: minus dollars per active hour");
  assert.deepEqual(s.designs.ffffffffffff, { api: { disabled: ["1"] } });
});

test("T5c.9: the guards section lists the v2 engine's kill switch per design and stratum", () => {
  const text = renderAnalysis(analyse(killWorld()), new Date(T0));
  assert.ok(text.includes(`- design ${D} stratum api: disable \`10\`: acceptance`), text);
  assert.ok(text.includes(`- design ${D} stratum opus: no arm would be disabled`), text);
});

test("review M1: the posterior follows the stratum's objective: only apiUsd has an estimator (API-eq $/h); any other writes an empty posterior, so the engine falls back to the blocks", () => {
  const w = killWorld();
  const l = { ...w, meter: w.meter.map((x) => ({ ...x, durationMs: 1000 })), expSettings: { ...w.expSettings, strata: { opus: { objective: "wallMs" } } } };
  const s = applyKill({}, analyse(l)) as any;
  assert.deepEqual(s.designs[D].opus.posterior, {}, "wallMs: no posterior, never { mean 0, sd 0 } arms");
  assert.deepEqual(Object.keys(s.designs[D].api.posterior).sort(), ["00", "10"], "apiUsd unchanged");
  assert.equal(analyse(l).guards.perStratum.find((x) => x.stratum === "opus")!.objective, "wallMs");
  assert.deepEqual(s.designs[D].opus.disabled, [], "the kill switch (acceptance, signals) does not depend on the objective");
});

test("review m1: the refusal denominator is the units with a levers line (as in the Levers section); units without one are counted apart and in Data quality", () => {
  const us = base().concat([{ id: "i", arm: "00", usd: 10 }, { id: "j", arm: "00", usd: 10 }]);
  const noLine = ["g", "h", "j"]; // 3 of 10 units have no levers line
  const lv = us.filter((u) => !noLine.includes(u.id)).map((u) => levers(u.id, u.arm, u.id === "a" || u.id === "c" ? { warmPolicy: "refused" } : {}));
  const l = logs([...us.flatMap((u) => cloud(u.id, u.arm, u.usd)), ...lv], us.map((u) => row(u.id, u.arm)));
  const w = stratumOf(l).refusal!.find((r) => r.factor === "warmPolicy")!;
  assert.deepEqual([w.eligible, w.refused, w.noLevers, w.broken], [7, 2, 3, true]); // 2/7 = 29 % (2/10 would be 20 %: not flagged)
  close(w.rate, 2 / 7);
  const text = renderAnalysis(analyse(l), new Date(T0));
  assert.ok(text.includes("3 without a levers line"), text);
  const q = analyse(l).quality.unjoinable.find((x) => x.what.startsWith("eligible units"));
  assert.equal(q?.n, 3);
});

test("review m2/m3: v2 designs' texts say what is per stratum and what is pooled; the primary table is titled intention-to-treat", () => {
  const us = base();
  const text = renderExperiment(analyse(logs(us.flatMap((u) => cloud(u.id, u.arm, u.usd)), us.map((u) => row(u.id, u.arm, "opus")))).experiment.designs);
  assert.ok(text.includes("named by each root's assignment row"), text);
  assert.ok(!text.includes("the billing class of the provider of a root session's main"), "a v2 stratum is no billing class");
  assert.ok(text.includes("Per arm (pooled over the design's strata, descriptive only: the kill switch and the posterior are per stratum"), text);
  assert.ok(!text.includes("feed the kill switch and the arm posterior"), text);
  assert.ok(text.includes("Intention-to-treat (primary)"), text);
  assert.ok(text.includes("as the intention-to-treat table"), text);
  assert.ok(!text.includes("as the table above"), text);
  const g = renderAnalysis(analyse(killWorld()), new Date(T0));
  assert.ok(g.includes("rows of a v2 design are pooled across its strata"), g);
});

test("review m4: for a points objective the sensitivity row is not measurable (the quota is the account's, not split by billing class), never a copy of the ITT row", () => {
  const us = base();
  const l = { ...logs(us.flatMap((u) => cloud(u.id, u.arm, u.usd)), us.map((u) => row(u.id, u.arm))), expSettings: { strata: { api: { objective: "points5h" } } } };
  const s = stratumOf(l);
  assert.equal(s.objective, "points5h");
  const e = eff(s.sensitivity!.effects, "warmPolicy");
  assert.ok("notMeasurable" in e);
  if ("notMeasurable" in e) assert.ok(e.notMeasurable.includes("billing class"), e.notMeasurable);
});
