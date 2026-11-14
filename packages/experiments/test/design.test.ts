// P-design: k factors, 2-level, half fraction with generator
// x_k = (−1)^k ∏_{j<k} x_j (sign chosen so the all-low baseline arm is in the design) → 2^(k-1) arms, every factor balanced, and for k = 5 all
// pairs of distinct effects of order ≤ 2 in orthogonal columns (resolution V).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GENERATORS, canonical, design, designFor, designId, type Arm, type Design, type DesignArm, type Factor, type FactorSpec, type Level } from "../core/design.ts";

const factors = (n: number): Factor[] =>
  Array.from({ length: n }, (_, i) => ({ name: `f${i + 1}`, values: ["off", "on"] as [string, string] }));

/** ±1 of factor `f` in `arm` (+1 = the factor's high value, values[1]). */
function sign(arm: Arm, f: Factor): number {
  return arm.flags[f.name] === f.values[1] ? 1 : -1;
}

test("k=5, maxArms 16 → 16 arms: half fraction with generator x5 = −x1·x2·x3·x4", () => {
  const fs = factors(5);
  const arms = design(fs, 16);
  assert.equal(arms.length, 16, "half fraction of 5 factors has 16 arms");
  assert.equal(new Set(arms.map((a) => a.id)).size, 16, "arm ids must be distinct");
  // Every factor is + in exactly 8 of the 16 arms.
  for (const f of fs) {
    const plus = arms.filter((a) => a.flags[f.name] === f.values[1]).length;
    assert.equal(plus, 8, `${f.name} is + in ${plus} of 16 arms, expected 8`);
  }
  // The last factor is generated, not free: x5 = −x1·x2·x3·x4 on every arm.
  for (const a of arms) {
    const gen = -[0, 1, 2, 3].reduce((p, i) => p * sign(a, fs[i]), 1);
    assert.equal(sign(a, fs[4]), gen, `generator x5 = −x1·x2·x3·x4 violated on arm ${a.id}`);
  }
  assert.deepEqual(design(fs, 16), design(fs, 16), "design must be deterministic");
});

test("k=5: every pair of distinct effects of order ≤ 2 is orthogonal", () => {
  const fs = factors(5);
  const arms = design(fs, 16);
  const effects: string[][] = [];
  for (const f of fs) effects.push([f.name]); // main effects
  for (let i = 0; i < fs.length; i++)
    for (let j = i + 1; j < fs.length; j++) effects.push([fs[i].name, fs[j].name]); // two-factor interactions
  const col = (a: Arm, eff: string[]) => eff.reduce((p, n) => p * sign(a, fs.find((f) => f.name === n)!), 1);
  for (let a = 0; a < effects.length; a++) {
    for (let b = a + 1; b < effects.length; b++) {
      const dot = arms.reduce((s, arm) => s + col(arm, effects[a]) * col(arm, effects[b]), 0);
      assert.equal(dot, 0, `effects ${effects[a].join("*")} and ${effects[b].join("*")} are not orthogonal (dot ${dot})`);
    }
  }
});

test("k=3, maxArms 8 → full 2^3: every combination exactly once", () => {
  const fs = factors(3);
  const arms = design(fs, 8);
  assert.equal(arms.length, 8, "3 factors fit under maxArms 8: full factorial");
  const seen = new Set(arms.map((a) => fs.map((f) => sign(a, f)).join("")));
  assert.equal(seen.size, 8, "the 8 arms must be 8 distinct sign patterns");
});

test("2^k ≤ maxArms → full factorial (k=4 cap 16; k=5 cap 32)", () => {
  assert.equal(design(factors(4), 16).length, 16);
  assert.equal(design(factors(5), 32).length, 32);
});

test("half fraction contains the all-low arm (today's setup = the baseline)", () => {
  for (const k of [2, 3, 4, 5, 6]) {
    const fs = factors(k);
    const arms = design(fs, 2 ** (k - 1));
    assert.ok(arms.some((a) => fs.every((f) => sign(a, f) === -1)), `k=${k}: no all-low arm in ${arms.map((a) => a.id).join(",")}`);
  }
});

// v2: six factors in 16 arms = the 2^(6-2) fraction, generators E = ABC, F = BCD (defining relation
// I = ABCE = BCDF = ADEF: resolution IV). Signs as in the half fraction, so the all-low arm is a run.
test("k=6, maxArms 16 → 2^(6-2): 16 distinct balanced arms, generators x5 = x1·x2·x3 and x6 = x2·x3·x4, all-low arm included", () => {
  const fs = factors(6);
  const arms = design(fs, 16);
  assert.equal(arms.length, 16);
  assert.equal(new Set(arms.map((a) => a.id)).size, 16, "arm ids must be distinct");
  assert.ok(arms.every((a) => a.id.length === 6), "one sign per factor");
  for (const f of fs) assert.equal(arms.filter((a) => sign(a, f) === 1).length, 8, `${f.name} is not balanced`);
  for (const a of arms) {
    assert.equal(sign(a, fs[4]), sign(a, fs[0]) * sign(a, fs[1]) * sign(a, fs[2]), `E = ABC violated on ${a.id}`);
    assert.equal(sign(a, fs[5]), sign(a, fs[1]) * sign(a, fs[2]) * sign(a, fs[3]), `F = BCD violated on ${a.id}`);
  }
  assert.ok(arms.some((a) => a.id === "------"), "the all-low arm (today's setup) must be in the design");
  assert.deepEqual(design(fs, 16), design(fs, 16), "design must be deterministic");
});

test("k=6, maxArms 16: resolution IV — no main effect is aliased with another main effect or any 2-factor interaction", () => {
  const fs = factors(6);
  const arms = design(fs, 16);
  const col = (a: Arm, eff: string[]) => eff.reduce((p, n) => p * sign(a, fs.find((f) => f.name === n)!), 1);
  const dot = (x: string[], y: string[]) => arms.reduce((s, a) => s + col(a, x) * col(a, y), 0);
  const mains = fs.map((f) => [f.name]);
  const pairs = fs.flatMap((f, i) => fs.slice(i + 1).map((g) => [f.name, g.name]));
  for (let i = 0; i < mains.length; i++) {
    for (let j = i + 1; j < mains.length; j++) assert.equal(dot(mains[i], mains[j]), 0, `${mains[i]} aliased with ${mains[j]}`);
    for (const p of pairs) assert.equal(dot(mains[i], p), 0, `main ${mains[i]} aliased with ${p.join("*")}`);
  }
  // Not resolution V: with 16 runs some two-factor interactions are aliased with each other (ABCE = I → AB = CE).
  assert.equal(Math.abs(dot(["f1", "f2"], ["f3", "f5"])), 16, "f1*f2 and f3*f5 share a column");
});

test("k=6 with room for a half fraction (maxArms 32) keeps the single generator; k=6 with maxArms 64 is full", () => {
  assert.equal(design(factors(6), 32).length, 32);
  assert.equal(design(factors(6), 64).length, 64);
});

// Design ids (redesign §7.2): the first 12 hex of sha256 over the canonical JSON {factors: [{lever, levels}], generators}.
// A changed lever, level or generator is a new design (never pooled with the old one); factor names and key order are
// labels, not the design.
const SPECS: FactorSpec[] = [
  { name: "ttl", lever: "cache-lifecycle.mainCacheTtl", levels: ["5m", "1h"] },
  { name: "nudge", lever: "infinite-context.nudgeAtTokens", levels: [0.25, 0.75] },
  { name: "mask", lever: "cache-lifecycle.maskOnCold", levels: [false, true] },
];

test("canonical: JSON with keys sorted at every depth, no whitespace, array order kept", () => {
  assert.equal(canonical({ b: 1, a: [{ d: true, c: "x y" }, 2.5, null] }), '{"a":[{"c":"x y","d":true},2.5,null],"b":1}');
  const samples: unknown[] = [{ z: { y: [3, { b: "1", a: 1 }], x: false } }, [{ q: 0 }, "s"], "plain", 7, true, null, { factors: SPECS, generators: ["D=ABC"] }];
  for (const x of samples) {
    assert.deepEqual(JSON.parse(canonical(x)), x, `canonical loses data of ${JSON.stringify(x)}`);
    assert.equal(canonical(x), JSON.stringify(JSON.parse(canonical(x))), "canonical text has whitespace");
  }
  const reversed = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(reversed) : x !== null && typeof x === "object" ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reversed(v)])) : x;
  for (const x of samples) assert.equal(canonical(reversed(x)), canonical(x), `key order changes canonical(${JSON.stringify(x)})`);
});

test("designId: 12 hex of sha256(canonical({factors: [{lever, levels}], generators}))", () => {
  const want = createHash("sha256").update(canonical({ factors: SPECS.map(({ lever, levels }) => ({ lever, levels })), generators: ["D=ABC"] })).digest("hex").slice(0, 12);
  assert.equal(designId(SPECS, ["D=ABC"]), want);
  assert.match(designId(SPECS, []), /^[0-9a-f]{12}$/);
});

test("designId is stable: factor names and key order do not change it", () => {
  const id = designId(SPECS, ["E=ABC", "F=BCD"]);
  assert.equal(designId(SPECS.map((f, i) => ({ ...f, name: `renamed${i}` })), ["E=ABC", "F=BCD"]), id, "a factor name changed the id");
  assert.equal(designId(SPECS.map(({ name, lever, levels }) => ({ levels, lever, name })), ["E=ABC", "F=BCD"]), id, "key order changed the id");
});

test("designId is sensitive: every lever, every level and every generator is part of the design", () => {
  const gens = ["E=ABC", "F=BCD"];
  const id = designId(SPECS, gens);
  const seen = new Set([id]);
  let changes = 0;
  const differs = (what: string, other: string) => {
    assert.notEqual(other, id, `${what} did not change the id`);
    seen.add(other);
    changes++;
  };
  SPECS.forEach((f, i) => {
    const with_ = (g: FactorSpec) => SPECS.map((h, j) => (j === i ? g : h));
    differs(`lever of ${f.name}`, designId(with_({ ...f, lever: `${f.lever}X` }), gens));
    for (const j of [0, 1] as const) {
      const levels = [...f.levels] as [Level, Level];
      levels[j] = typeof levels[j] === "string" ? `${levels[j]}X` : typeof levels[j] === "number" ? (levels[j] as number) + 1 : !levels[j];
      differs(`level ${j} of ${f.name}`, designId(with_({ ...f, levels }), gens));
    }
    if (typeof f.levels[0] !== "string") differs(`level type of ${f.name}`, designId(with_({ ...f, levels: [String(f.levels[0]), f.levels[1]] }), gens));
  });
  differs("a generator", designId(SPECS, ["E=ABC", "F=ABD"]));
  differs("no generators", designId(SPECS, []));
  differs("factor order", designId([...SPECS].reverse(), gens));
  assert.equal(seen.size, 1 + changes, "two changes gave the same id");
});

// designFor (redesign §7.2): one design per stratum; arms coded ±1 per factor (+1 = levels[1]); an arm's name is one
// bit per factor in factor order ("1" = levels[1]).
const specs = (k: number): FactorSpec[] =>
  Array.from({ length: k }, (_, i) => ({ name: `f${i + 1}`, lever: `t.lever${i + 1}`, levels: [`lo${i + 1}`, i % 2 ? i : true] }));
const coded = (a: DesignArm, f: FactorSpec): number => {
  assert.ok(f.levels.includes(a.levels[f.name]), `arm ${a.name}: ${f.name} = ${String(a.levels[f.name])} is not one of its levels`);
  return a.levels[f.name] === f.levels[1] ? 1 : -1;
};
/** Σ over the arms of the product of the named factors' coded levels. */
const dot = (d: Design, idx: number[]): number => d.arms.reduce((s, a) => s + idx.reduce((p, i) => p * coded(a, d.factors[i]), 1), 0);
/** The arms are well formed: levels for exactly the factors, names = bits, distinct. */
function wellFormed(d: Design): void {
  for (const a of d.arms) {
    assert.deepEqual(Object.keys(a.levels).sort(), d.factors.map((f) => f.name).sort(), `arm ${a.name}: levels for other factors`);
    assert.equal(a.name, d.factors.map((f) => (coded(a, f) > 0 ? "1" : "0")).join(""), `arm ${a.name}: the name is not its bits`);
  }
  assert.equal(new Set(d.arms.map((a) => a.name)).size, d.arms.length, "arm names are not distinct");
}
const pairs = (k: number): number[][] => Array.from({ length: k }, (_, i) => Array.from({ length: k - i - 1 }, (_, j) => [i, i + j + 1])).flat();

test("designFor k ≤ 3: the full 2^k factorial, no generators, every factor balanced, main effects orthogonal", () => {
  for (const k of [0, 1, 2, 3]) {
    const fs = specs(k);
    const d = designFor("cloud", { factors: fs });
    assert.equal(d.stratum, "cloud");
    assert.deepEqual(d.factors, fs);
    assert.deepEqual(d.generators, [], `k=${k}: a full factorial has no generators`);
    assert.equal(d.id, designId(fs, []), `k=${k}: the id is designId(factors, generators)`);
    assert.equal(d.arms.length, 2 ** k, `k=${k}: arms`);
    wellFormed(d);
    for (let i = 0; i < k; i++) assert.equal(dot(d, [i]), 0, `k=${k}: ${fs[i].name} is not balanced`);
    for (const p of pairs(k)) assert.equal(dot(d, p), 0, `k=${k}: ${p.map((i) => fs[i].name).join(", ")} are not orthogonal`);
  }
});

// Fractions for 4 ≤ k ≤ 6 from the fixed generator table (redesign §7.2): resolution IV at least (main effects
// orthogonal to each other and to every two-factor interaction), k = 5 resolution V.
const triples = (k: number): number[][] =>
  Array.from({ length: k }, (_, i) => pairs(k).filter((p) => !p.includes(i)).map((p) => [i, ...p])).flat();

test("designFor k = 4..6: 2^(k−g) arms from GENERATORS[k], balanced, main effects orthogonal, resolution ≥ IV", () => {
  for (const k of [4, 5, 6] as const) {
    const fs = specs(k);
    const d = designFor("cloud", { factors: fs });
    assert.deepEqual(d.generators, GENERATORS[k], `k=${k}: generators`);
    assert.equal(d.id, designId(fs, GENERATORS[k]), `k=${k}: the id covers the generators`);
    assert.equal(d.arms.length, 2 ** (k - GENERATORS[k].length), `k=${k}: arms`);
    wellFormed(d);
    for (let i = 0; i < k; i++) assert.equal(dot(d, [i]), 0, `k=${k}: ${fs[i].name} is not balanced`);
    for (const p of pairs(k)) assert.equal(dot(d, p), 0, `k=${k}: main effects ${p.map((i) => fs[i].name).join(", ")} are aliased`);
    for (const t of triples(k)) assert.equal(dot(d, t), 0, `k=${k}: main effect ${fs[t[0]].name} is aliased with ${fs[t[1]].name}×${fs[t[2]].name}`);
  }
});

test("designFor k = 5 is resolution V: two-factor interactions are orthogonal to each other too", () => {
  const d = designFor("cloud", { factors: specs(5) });
  const ps = pairs(5);
  for (let a = 0; a < ps.length; a++)
    for (let b = a + 1; b < ps.length; b++) {
      const sum = d.arms.reduce((s, arm) => s + [...ps[a], ...ps[b]].reduce((p, i) => p * coded(arm, d.factors[i]), 1), 0);
      assert.equal(sum, 0, `interactions ${ps[a].join("×")} and ${ps[b].join("×")} are aliased`);
    }
});

test("designFor: a generated factor is ± the product its generator names; the all-low arm (levels[0] everywhere) is an arm for every k ≤ 6", () => {
  for (const k of [0, 1, 2, 3, 4, 5, 6]) {
    const d = designFor("cloud", { factors: specs(k) });
    for (const g of d.generators) {
      const [target, word] = g.split("=");
      const idx = [target, ...word].map((c) => "ABCDEF".indexOf(c));
      const signs = new Set(d.arms.map((a) => idx.reduce((p, i) => p * coded(a, d.factors[i]), 1)));
      assert.equal(signs.size, 1, `k=${k}: ${g} does not hold on every arm`);
    }
    assert.ok(d.arms.some((a) => d.factors.every((f) => a.levels[f.name] === f.levels[0])), `k=${k}: no all-low arm`);
  }
});

test("designFor refuses more than 6 factors", () => {
  assert.throws(() => designFor("cloud", { factors: specs(7) }), /cloud: 7 factors, at most 6/);
});

test("pinned: the generator table and the arm names of k = 4, 5, 6 (stored with every unit)", () => {
  assert.deepEqual(GENERATORS, { 4: ["D=ABC"], 5: ["E=ABCD"], 6: ["E=ABC", "F=BCD"] });
  const names = (k: number) => designFor("s", { factors: specs(k) }).arms.map((a) => a.name);
  assert.deepEqual(names(4), ["0000", "1001", "0101", "1100", "0011", "1010", "0110", "1111"]);
  assert.deepEqual(names(5), ["00000", "10001", "01001", "11000", "00101", "10100", "01100", "11101",
                              "00011", "10010", "01010", "11011", "00110", "10111", "01111", "11110"]);
  assert.deepEqual(names(6), ["000000", "100010", "010011", "110001", "001011", "101001", "011000", "111010",
                              "000101", "100111", "010110", "110100", "001110", "101100", "011101", "111111"]);
});

// Review F1b: the target of a factor is a read-back detail, not part of the design: the id (stored with every unit) ignores it.
test("F1b a factor's target rides along on the design's factors and changes no design id", () => {
  const f = { name: "a", lever: "session-entry(t,f)", levels: ["a", "b"] as [string, string] };
  const plain = designFor("s", { factors: [f] });
  const targeted = designFor("s", { factors: [{ ...f, target: "entry-ext" }] });
  assert.equal(targeted.id, plain.id);
  assert.equal(targeted.factors[0].target, "entry-ext");
  assert.deepEqual(targeted.arms, plain.arms);
});
