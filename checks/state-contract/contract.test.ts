// The writer (token-meter) and the reader (experiments) of state.json's per-design, per-stratum entries agree on where they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextState, type ArmStat } from "./token-meter/core/arms.ts";
import { designState } from "./experiments/core/assign.ts";

const stat = (arm: string, costPerHour: number): ArmStat => ({ arm, units: 3, costPerHour, sd: 0.5 }) as ArmStat;
const design = (id: string, stratum: string) => ({ id, stratum }) as Parameters<typeof designState>[1];

test("what nextState writes for a (design, stratum) designState reads back: disabled arms and the posterior reward", () => {
  const state = nextState({}, [], {}, [{ design: "a1b2c3d4e5f6", stratum: "api", arms: [stat("0", 2), stat("1", 5)], kill: { "1": "worse" } }]);
  const read = designState(JSON.parse(JSON.stringify(state)), design("a1b2c3d4e5f6", "api"));
  assert.deepEqual(read.disabled, ["1"]);
  assert.deepEqual(read.posterior, { "0": { mean: -2, sd: 0.5 }, "1": { mean: -5, sd: 0.5 } });
});

test("another stratum or design reads nothing, and the flat keys are never read for a v2 design", () => {
  const state = JSON.parse(JSON.stringify(nextState({}, [stat("1", 5)], { "1": "flat" }, [{ design: "a1b2c3d4e5f6", stratum: "api", arms: [stat("0", 2)], kill: { "0": "x" } }])));
  assert.deepEqual(designState(state, design("a1b2c3d4e5f6", "opus")), { disabled: [] });
  assert.deepEqual(designState(state, design("ffffffffffff", "api")), { disabled: [] });
  assert.deepEqual(state.disabled, ["1"]);
});
