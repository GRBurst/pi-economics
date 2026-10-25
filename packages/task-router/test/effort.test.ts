import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";

function rig(settings = {}) {
  const h = harness({ settings });
  const notes: string[] = [];
  const ctx = { ui: { notify: (m: string) => notes.push(m) } };
  const turn = (level: string) => {
    h.f.thinking.level = level; // what the user (or a keybinding) selected for this turn
    h.f.fire("turn_start", {}, ctx);
    h.f.fire("turn_end", {}, ctx);
  };
  return { h, notes, turn, sets: h.f.thinking.sets };
}

test("max for maxBurstTurns (1) turn → restored to the previous level, user is told", () => {
  const { h, notes, turn, sets } = rig();
  turn("xhigh");
  turn("max");
  assert.deepEqual(sets, ["xhigh"]);
  assert.equal(h.f.thinking.level, "xhigh");
  assert.match(notes[0], /max.*xhigh/);
});

test("maxBurstTurns=2 allows two max turns", () => {
  const { h, turn, sets } = rig({ maxBurstTurns: 2 });
  turn("high");
  turn("max");
  assert.deepEqual(sets, []);
  turn("max");
  assert.deepEqual(sets, ["high"]);
  assert.equal(h.f.thinking.level, "high");
});

test("other levels are never touched; a new burst after leaving max starts counting again", () => {
  const { turn, sets } = rig();
  turn("low"); turn("medium"); turn("xhigh");
  assert.deepEqual(sets, []);
  turn("max"); turn("max");
  assert.deepEqual(sets, ["xhigh", "xhigh"]);
});

test("no previous level seen (session starts at max) → xhigh", () => {
  const { turn, sets } = rig();
  turn("max");
  assert.deepEqual(sets, ["xhigh"]);
});
