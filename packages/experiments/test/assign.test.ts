// The v2 engine's pure parts (redesign M5b.1, §7.3): strata, eligibility, permuted blocks, Thompson per design and stratum. Seeded RNG throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Mode } from "../core/assign.ts";

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

import { designState, draw, type DesignState } from "../core/assign.ts";

test("T5b1.4 designState: state.json's posterior and disabled arms of one design in one stratum; others never leak in", () => {
  const a = designFor("api", { factors: V4_FACTORS });
  const raw = {
    posterior: { "---": { mean: 9, sd: 0 } }, disabled: ["---"], // designs v1–v4 (flat, by v4 arm id): not this design's
    designs: {
      [a.id]: { api: { posterior: { "000": { mean: 1, sd: 0.1 } }, disabled: ["111"] }, subscription: { posterior: { "111": { mean: 5, sd: 0.1 } } } },
      ffffffffffff: { api: { disabled: ["000"] } },
    },
  };
  assert.deepEqual(designState(raw, a), { posterior: { "000": { mean: 1, sd: 0.1 } }, disabled: ["111"] });
  assert.deepEqual(designState(raw, designFor("subscription", { factors: V4_FACTORS })), { posterior: { "111": { mean: 5, sd: 0.1 } }, disabled: [] });
  for (const bad of [undefined, null, 3, [], { designs: 1 }, { designs: { [a.id]: { api: { posterior: 1, disabled: "x" } } } }]) {
    assert.deepEqual(designState(bad, a), { disabled: [] }, JSON.stringify(bad));
  }
});

// Adapted from the v1 engine's P-floor and disabled-arm tests: the posterior is now one design's in one stratum (Q1).
test("T5b1.4 P-floor: exploit gives every enabled arm probability ≥ minExplore/|A|; Thompson favours the best posterior", () => {
  const d = designFor("api", { factors: V4_FACTORS.slice(0, 2) }); // 4 arms
  const ds: DesignState = { disabled: [], posterior: Object.fromEntries(d.arms.map((a, i) => [a.name, i === 0 ? { mean: 5, sd: 0.1 } : { mean: 0, sd: 1 }])) };
  const minExplore = 0.2;
  const floor = minExplore / d.arms.length; // 0.05
  const tol = 0.008; // ≈ 5σ of a 20k-draw frequency
  const draws = 20000;
  for (const seed of [7, 99]) {
    const rand = mulberry32(seed);
    const picks: Record<string, number> = Object.fromEntries(d.arms.map((a) => [a.name, 0]));
    for (let i = 0; i < draws; i++) picks[draw("exploit", d, {}, ds, rand, minExplore).arm!]++;
    for (const a of d.arms) {
      const p = picks[a.name] / draws;
      assert.ok(p >= floor - tol, `seed ${seed}: arm ${a.name} chosen ${p.toFixed(4)}, below floor ${floor} − ${tol}`);
    }
    assert.ok(picks[d.arms[0].name] > 0.5 * draws, `seed ${seed}: the superior arm should still dominate`);
  }
});

test("T5b1.4 exploit: disabled arms are never chosen; without any posterior it explores in blocks", () => {
  const d = designFor("api", { factors: V4_FACTORS.slice(0, 2) });
  const ds: DesignState = { disabled: [d.arms[2].name], posterior: Object.fromEntries(d.arms.map((a) => [a.name, { mean: 1, sd: 1 }])) };
  const rand = mulberry32(3);
  for (let i = 0; i < 500; i++) assert.notEqual(draw("exploit", d, {}, ds, rand, 0.2).arm, d.arms[2].name, `disabled arm chosen (draw ${i})`);
  let blocks: BlockState = {};
  const counts: Record<string, number> = {};
  for (let i = 0; i < 2 * d.arms.length; i++) {
    const r = draw("exploit", d, blocks, { disabled: [] }, rand, 0);
    counts[r.arm!] = (counts[r.arm!] ?? 0) + 1;
    blocks = r.blocks;
  }
  for (const a of d.arms) assert.equal(counts[a.name], 2, `no posterior yet: arm ${a.name} balanced`);
  const r = draw("explore", d, {}, { disabled: d.arms.map((a) => a.name) }, rand, 0.1);
  assert.equal(r.arm, undefined, "every arm disabled: no arm");
});
