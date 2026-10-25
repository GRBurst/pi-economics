// P-off, P-balance, P-floor (plan) for assign(). Seeded RNG throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { design } from "../core/design.ts";
import { assign, type State } from "../core/assign.ts";

/** Deterministic seeded RNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const factors = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `f${i + 1}`, values: ["off", "on"] as [string, string] }));

test("P-off: mode off returns the baseline arm, whatever the state or rng", () => {
  const arms = design(factors(2), 4);
  for (const seed of [1, 2, 3]) {
    // Even with the baseline arm disabled and other arms heavily counted.
    const st: State = { counts: { [arms[1].id]: 9 }, disabled: [arms[0].id] };
    assert.deepEqual(assign("off", arms, st, mulberry32(seed), 0.1, arms[0].id), arms[0]);
  }
});

test("P-balance: explore keeps enabled-arm counts within 1 and never picks a disabled arm", () => {
  const arms = design(factors(2), 4);
  const st: State = { counts: {}, disabled: [arms[3].id] };
  const rng = mulberry32(1234);
  for (let i = 0; i < 40; i++) {
    const arm = assign("explore", arms, st, rng, 0.1, arms[0].id);
    assert.notEqual(arm.id, arms[3].id, `disabled arm ${arms[3].id} was chosen (draw ${i})`);
    st.counts[arm.id] = (st.counts[arm.id] ?? 0) + 1;
    const counts = arms.slice(0, 3).map((a) => st.counts[a.id] ?? 0);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `after ${i + 1} draws the enabled counts [${counts}] are not balanced`);
  }
});

test("P-floor: exploit gives every enabled arm probability ≥ minExplore/|A|", () => {
  const arms = design(factors(2), 4);
  const st: State = {
    counts: {},
    disabled: [],
    // One clearly superior arm; the rest must still keep their floor.
    posterior: {
      [arms[0].id]: { mean: 5, sd: 0.1 },
      [arms[1].id]: { mean: 0, sd: 1 },
      [arms[2].id]: { mean: 0, sd: 1 },
      [arms[3].id]: { mean: 0, sd: 1 },
    },
  };
  const minExplore = 0.2;
  const floor = minExplore / arms.length; // 0.05
  const tol = 0.008; // ≈ 5σ of a 20k-draw frequency
  const draws = 20000;
  for (const seed of [7, 99]) {
    const rng = mulberry32(seed);
    const picks: Record<string, number> = Object.fromEntries(arms.map((a) => [a.id, 0]));
    for (let i = 0; i < draws; i++) picks[assign("exploit", arms, st, rng, minExplore, arms[0].id).id]++;
    for (const a of arms) {
      const p = picks[a.id] / draws;
      assert.ok(p >= floor - tol, `seed ${seed}: arm ${a.id} chosen ${p.toFixed(4)}, below floor ${floor} − ${tol}`);
    }
    assert.ok(picks[arms[0].id] > 0.5 * draws, `seed ${seed}: the superior arm should still dominate`);
  }
});

test("exploit: disabled arms are never chosen", () => {
  const arms = design(factors(2), 4);
  const st: State = {
    counts: {},
    disabled: [arms[2].id],
    posterior: Object.fromEntries(arms.map((a) => [a.id, { mean: 1, sd: 1 }])),
  };
  const rng = mulberry32(3);
  for (let i = 0; i < 500; i++) {
    assert.notEqual(assign("exploit", arms, st, rng, 0.2, arms[0].id).id, arms[2].id, `disabled arm chosen (draw ${i})`);
  }
});
