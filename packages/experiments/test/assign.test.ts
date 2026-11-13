// P-off, P-balance, P-floor for assign(). Seeded RNG throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { design } from "../core/design.ts";
import { assign, type Mode, type State } from "../core/assign.ts";

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

// --- Engine v2 (redesign M5b.1, §7.3): strata, eligibility, permuted blocks, Thompson per design and stratum.
import { eligibleFor, stratumOf } from "../core/assign.ts";
import type { StratumSpec } from "../core/settings.ts";
import type { Plans } from "../../token-meter/core/plans.ts";

const spec = (match: StratumSpec["match"]): StratumSpec => ({ match, objective: "apiUsd", factors: [] });
const plans: Plans = { anthropic: { billing: "subscription", windows: ["5h"] }, ollama: { billing: "local", windows: [] } };

test("T5b1.1 stratumOf: the first stratum in key order whose every given condition matches", () => {
  const byClass = { subscription: spec({ billing: ["subscription"] }), api: spec({ billing: ["api"] }), local: spec({ billing: ["local"] }) };
  const byModel = { opus: spec({ models: ["anthropic/claude-opus-*"] }), both: spec({ billing: ["subscription"], models: ["*/claude-?"] }), rest: spec({}) };
  const table: Array<[Record<string, StratumSpec>, string, string, string | undefined]> = [
    [byClass, "anthropic", "claude-opus-4", "subscription"],
    [byClass, "openai", "gpt-5", "api"], // no plan: billed as api
    [byClass, "ollama", "qwen3", "local"],
    [byClass, "constructor", "x", "api"], // a provider named like an Object.prototype member has no plan
    [{ local: spec({ billing: ["local"] }) }, "openai", "gpt-5", undefined],
    [byModel, "anthropic", "claude-opus-4", "opus"],
    [byModel, "anthropic", "claude-x", "both"],
    [byModel, "openai", "claude-x", "rest"], // models match, billing (api) does not
    [byModel, "anthropic", "claude-xy", "rest"], // `?` is one character
    [{ dot: spec({ models: ["openrouter/a.b"] }) }, "openrouter", "aXb", undefined], // glob metacharacters only * and ?
    [{ dot: spec({ models: ["openrouter/a.b"] }) }, "openrouter", "a.b", "dot"],
    [{ slash: spec({ models: ["openrouter/*"] }) }, "openrouter", "vendor/model", "slash"], // * spans a model id's own slash
    [{}, "anthropic", "claude-opus-4", undefined],
  ];
  for (const [strata, provider, model, want] of table) {
    assert.equal(stratumOf(strata, plans, provider, model), want, `${provider}/${model} in ${Object.keys(strata).join(",") || "no strata"}`);
  }
});

test("T5b1.1 eligibleFor: a main (not a child) with a stratum, mode not off", () => {
  const table: Array<[boolean, string | undefined, Mode, boolean]> = [
    [false, "api", "explore", true],
    [false, "api", "exploit", true],
    [true, "api", "explore", false],
    [false, undefined, "explore", false],
    [false, "api", "off", false],
  ];
  for (const [isChild, stratum, mode, want] of table) assert.equal(eligibleFor(isChild, stratum, mode), want, `child=${isChild} stratum=${stratum} mode=${mode}`);
});

import { blockKey, nextArm, type BlockState } from "../core/assign.ts";
import { designFor } from "../core/design.ts";
import { V4_FACTORS } from "../core/settings.ts";

test("T5b1.2 nextArm: permuted blocks, so after m·|arms| draws of one design every arm is drawn exactly m times", () => {
  for (const factors of [V4_FACTORS, V4_FACTORS.slice(0, 1), []]) {
    const d = designFor("api", { factors });
    for (const seed of [1, 42, 977]) {
      const rand = mulberry32(seed);
      let state: BlockState = {};
      const counts: Record<string, number> = {};
      for (let m = 1; m <= 5; m++) {
        for (let i = 0; i < d.arms.length; i++) {
          const before = structuredClone(state);
          const r = nextArm(state, d, rand);
          assert.deepEqual(state, before, "nextArm is pure: the old state is not changed");
          assert.ok(r.arm !== undefined, "an enabled arm exists");
          counts[r.arm] = (counts[r.arm] ?? 0) + 1;
          state = r.state;
        }
        for (const a of d.arms) assert.equal(counts[a.name], m, `seed ${seed}, ${factors.length} factors: arm "${a.name}" after ${m}·${d.arms.length} draws`);
      }
    }
  }
});

test("T5b1.2 nextArm: one queue per design and stratum (strata never pooled, Q1); disabled arms are skipped", () => {
  const a = designFor("api", { factors: V4_FACTORS });
  const s = designFor("subscription", { factors: V4_FACTORS });
  assert.equal(a.id, s.id, "two default cloud strata share the design id");
  assert.notEqual(blockKey(a), blockKey(s));
  const rand = mulberry32(5);
  let state: BlockState = {};
  const counts: Record<string, Record<string, number>> = { api: {}, subscription: {} };
  for (let i = 0; i < 3 * a.arms.length; i++) {
    for (const d of i % 3 === 0 ? [a, s, s] : [a]) { // unequal traffic: each stratum must still be balanced on its own
      const r = nextArm(state, d, rand);
      counts[d.stratum][r.arm!] = (counts[d.stratum][r.arm!] ?? 0) + 1;
      state = r.state;
    }
  }
  for (const arm of a.arms) assert.equal(counts.api[arm.name], 3, `api arm ${arm.name}`);
  for (const arm of s.arms) assert.equal(counts.subscription[arm.name], 2, `subscription arm ${arm.name}`);

  // A disabled arm is never drawn, also when it was queued before it was disabled; the others stay balanced.
  const disabled = [a.arms[2].name, a.arms[5].name];
  const seen: Record<string, number> = {};
  state = { [blockKey(a)]: { queue: a.arms.map((x) => x.name) } };
  for (let i = 0; i < 4 * 6; i++) {
    const r = nextArm(state, a, rand, disabled);
    assert.ok(r.arm !== undefined && !disabled.includes(r.arm), `draw ${i}: ${r.arm}`);
    seen[r.arm] = (seen[r.arm] ?? 0) + 1;
    state = r.state;
  }
  for (const arm of a.arms) assert.equal(seen[arm.name] ?? 0, disabled.includes(arm.name) ? 0 : 4, `arm ${arm.name}`);
  assert.equal(nextArm({}, a, rand, a.arms.map((x) => x.name)).arm, undefined, "every arm disabled: no arm");
});
