// P-design (plan): k factors, 2-level, half fraction with generator
// x_k = (−1)^k ∏_{j<k} x_j (sign chosen so the all-low baseline arm is in the design) → 2^(k-1) arms, every factor balanced, and for k = 5 all
// pairs of distinct effects of order ≤ 2 in orthogonal columns (resolution V).
import { test } from "node:test";
import assert from "node:assert/strict";
import { design, type Arm, type Factor } from "../core/design.ts";

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

// v2 (T8.9): six factors in 16 arms = the 2^(6-2) fraction, generators E = ABC, F = BCD (defining relation
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
