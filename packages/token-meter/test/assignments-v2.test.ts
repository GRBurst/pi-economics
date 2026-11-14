// The analyser on assignments v2 (redesign M5b.1 T5b1.9, §5.4): the experiments engine's v2 rows (a design id, the
// stratum, eligible, the arm's factors) next to the v1 engine's rows; the analysis proper is M5c, this is tolerance:
// no crash, the contract holds for what the writers write, v2 units are read from their rows (never decoded as v4),
// and the v1 engine's designs come out exactly as without v2 data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, type Logs } from "../core/analyse.ts";
import { check } from "../core/contract.ts";
import { mulberry32 } from "../core/stats.ts";
import { assignment, iso, MIN, T0, turns } from "./world.ts";

const D = "a1b2c3d4e5f6"; // a design id: 12 hex of the experiments package's designId
const FACTORS: Array<[string, string, [string, string]]> = [
  ["warmPolicy", "cache-lifecycle.warmPolicy", ["native", "orchestrator-aware"]],
  ["mainCacheTtl", "cache-lifecycle.mainCacheTtl", ["5m", "1h"]],
  ["maskOnCold", "cache-lifecycle.maskOnCold", ["off", "on"]],
];
/** An eligible main's v2 row: `arm` = one bit per factor ("1" = the high level). */
const eligible = (sessionId: string, arm: string, at = T0, stratum = "api", design = D) => ({
  v: 2, ts: iso(at), sessionId, design, mode: "explore", eligible: true, stratum, arm,
  factors: Object.fromEntries(FACTORS.map(([name, lever, levels], i) => [name, { lever, assigned: levels[Number(arm[i])] }])),
});
const ineligible = (sessionId: string, at = T0, extra: Record<string, unknown> = {}) => ({ v: 2, ts: iso(at), sessionId, mode: "explore", eligible: false, ...extra });
/** A cloud root of 1 active hour (7 turns, 10 minutes apart), `usd` in all; v2-engine lines carry their design. */
const cloud = (sessionId: string, extra: Record<string, unknown>, usd = 7, start = T0 + MIN) => turns(sessionId, start, 7, { ...extra, costUsd: usd / 7 });
const logs = (meter: Record<string, unknown>[], assignments: Record<string, unknown>[], guards: Record<string, unknown>[] = []): Logs => ({ meter, outcomes: [], guards, assignments });
const fields = (ps: ReturnType<typeof check>) => ps.map((p) => `${p.log}.${p.field}`).sort();

test("T5b1.9 contract: v2 rows, eligible (design, stratum, arm, factors) and ineligible (neither arm nor factors)", () => {
  const rows = [eligible("m", "010"), ineligible("n", T0, { mode: "off", stratum: "api", design: D }), ineligible("o"),
    { ...eligible("l", ""), factors: {} }]; // a stratum without factors: its one arm is ""
  const meter = [...cloud("m", { arm: "010", design: D }), ...cloud("n", {}), ...cloud("o", {}), ...cloud("l", { arm: "", design: D })];
  assert.deepEqual(fields(check(logs(meter, rows))), []);
  // An ineligible row may say why (P12: no feasible level of a gating lever).
  const why = ineligible("p", T0, { stratum: "local", design: D, reason: "infinite-context.nudgeAtTokens: the matched rule has no range" });
  assert.deepEqual(fields(check(logs(cloud("p", {}), [why]))), []);
  // An eligible session's lines carry its arm; an ineligible one's need none.
  assert.deepEqual(fields(check(logs(cloud("m", {}), [rows[0]]))), ["meter.arm"]);
  const bad: Array<[Record<string, unknown>, string]> = [
    [(({ arm, ...r }) => r)(eligible("m", "010")), "assignments.arm"],
    [(({ design, ...r }) => r)(eligible("m", "010")), "assignments.design"],
    [(({ stratum, ...r }) => r)(eligible("m", "010")), "assignments.stratum"],
    [(({ factors, ...r }) => r)(eligible("m", "010")), "assignments.factors"],
    [{ ...eligible("m", "010"), eligible: "yes" }, "assignments.eligible"],
    [{ ...eligible("m", "010"), mode: "random" }, "assignments.mode"],
    [{ ...ineligible("n"), arm: "010" }, "assignments.arm"],
    [{ ...ineligible("n"), factors: {} }, "assignments.factors"],
    [{ ...ineligible("n"), stratum: 3 }, "assignments.stratum"],
    [{ ...ineligible("n"), parentSessionId: "" }, "assignments.parentSessionId"],
    [{ ...ineligible("n"), reason: 3 }, "assignments.reason"],
    [{ ...ineligible("n"), reason: "" }, "assignments.reason"],
  ];
  for (const [row, want] of bad) assert.deepEqual(fields(check(logs([], [row]))), [want], JSON.stringify(row));
});

/** A random corpus of the v1 engine's rows (v1, v2, v4 arms) and the v2 engine's (eligible, ineligible), with their lines. */
function corpus(seed: number) {
  const rand = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const bits = (n: number, a: string) => Array.from({ length: n }, () => pick([...a])).join("");
  const legacy = { meter: [] as Record<string, unknown>[], assignments: [] as Record<string, unknown>[] };
  const v2 = { meter: [] as Record<string, unknown>[], assignments: [] as Record<string, unknown>[] };
  const n = 4 + Math.floor(rand() * 12);
  for (let i = 0; i < n; i++) {
    const sid = `r${seed}-${i}`, at = T0 + i * 3 * MIN, usd = 1 + Math.floor(rand() * 20);
    const kind = pick(["v1", "v2", "v4", "eligible", "eligible", "ineligible"] as const);
    if (kind === "eligible") {
      const arm = bits(3, "01");
      v2.assignments.push(eligible(sid, arm, at));
      v2.meter.push(...cloud(sid, { arm, ...(rand() < 0.7 ? { design: D } : {}) }, usd, at + MIN));
    } else if (kind === "ineligible") {
      v2.assignments.push(ineligible(sid, at, rand() < 0.5 ? { stratum: "api", design: D } : {}));
      v2.meter.push(...cloud(sid, {}, usd, at + MIN));
    } else {
      const arm = bits(kind === "v1" ? 5 : kind === "v2" ? 6 : 3, "-+");
      legacy.assignments.push(assignment(sid, arm, at));
      legacy.meter.push(...cloud(sid, { arm }, usd, at + MIN));
    }
  }
  return { legacy, v2 };
}

test("T5b1.9 property: over v1 + v2 corpora the analyser does not crash, the contract holds, v2 units come from their rows, the v1 engine's designs are unchanged", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { legacy, v2 } = corpus(seed);
    const both = logs([...legacy.meter, ...v2.meter], [...legacy.assignments, ...v2.assignments]);
    assert.deepEqual(fields(check(both)), [], `seed ${seed}: the writers' lines meet the contract`);
    const all = analyse(both).experiment.designs;
    const old = analyse(logs(legacy.meter, legacy.assignments)).experiment.designs;
    assert.deepEqual(all.filter((d) => d.design !== D), old, `seed ${seed}: v1-engine designs are never pooled with v2 data`);
    const units = v2.assignments.filter((r) => r.eligible === true) as ReturnType<typeof eligible>[];
    const mine = all.find((d) => d.design === D);
    if (units.length === 0) continue;
    assert.ok(mine, `seed ${seed}: the v2 design ${D} is reported`);
    assert.deepEqual(mine.factors, FACTORS.map(([n]) => n), `seed ${seed}: the factors of the rows, in their order`);
    assert.equal(mine.baseline, "000", `seed ${seed}: the all-low arm`);
    assert.deepEqual(mine.strata.map((s) => s.stratum), ["api"]);
    for (const [name, , [lo, hi]] of FACTORS) {
      const e = mine.strata[0].effects.find((x) => x.factor === name) as Record<string, unknown>;
      const nLo = units.filter((r) => r.factors[name].assigned === lo).length;
      const nHi = units.length - nLo;
      if (nLo === 0 || nHi === 0) continue;
      assert.deepEqual([e.a, e.b, e.nA, e.nB], [lo, hi, nLo, nHi], `seed ${seed}, ${name}: levels and counts from the rows' factors, low first`);
    }
  }
});

test("T5b1.9 a v2 line names its design: a grandchild's line (its parent has no row) is not taken for v4 by its arm's length", () => {
  const meter = [...cloud("m", { arm: "010", design: D }), ...cloud("g", { arm: "010", design: D, parentSessionId: "c" })];
  const designs = analyse(logs(meter, [eligible("m", "010")])).experiment.designs;
  assert.deepEqual(designs.map((d) => d.design), [D]);
});

test("T5b1.9 guards: an event that names its design is counted in it", () => {
  const ev = { v: 1, ts: iso(T0 + 5 * MIN), sessionId: "c", arm: "010", design: D, event: "correction" }; // a child: no row of its own
  const g = analyse(logs(cloud("m", { arm: "010", design: D }), [eligible("m", "010")], [ev])).guards;
  assert.deepEqual(g.perArm.filter((x) => x.corrections > 0).map((x) => [x.design, x.arm, x.corrections]), [[D, "010", 1]]);
});

test("T5b1.11 strata: a v2 unit is in the stratum its row records (a named stratum); a v1-engine unit in its billing class", () => {
  const meter = [...cloud("m", { arm: "010", design: D }), ...cloud("n", { arm: "110", design: D }), ...cloud("o", { arm: "---" })];
  const rows = [eligible("m", "010", T0, "opus"), eligible("n", "110", T0, "subscription"), assignment("o", "---", T0)];
  const designs = analyse({ ...logs(meter, rows), plans: { anthropic: { billing: "subscription", windows: ["5h"] } } }).experiment.designs;
  assert.deepEqual(designs.map((d) => [d.design, d.strata.map((s) => s.stratum)]), [[D, ["subscription", "opus"]], ["v4", ["subscription"]]]);
});
