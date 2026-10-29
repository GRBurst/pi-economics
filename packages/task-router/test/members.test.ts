import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFORTS, bottom, byModel, effortAt, effortRank, enabled, levels, lvl, meeting, named, next, providerOf, sameLadder, stepOf, top } from "../core/members.ts";
import type { Member } from "../core/types.ts";

const M = (o: Partial<Member> = {}): Member => ({
  model: "p/m", tier: "t", route: "r", abilities: { write: 0 }, efforts: ["high"], contextWindow: 1000, cost: 0, ...o,
});

test("enabled drops empty members and orders by (cost, order, name)", () => {
  const ms = {
    sonnet: M({ model: "a/sonnet", cost: 3 }),
    blank: M({ model: "", cost: 0 }),
    "qwen-local": M({ model: "l/q", cost: 0, order: 0 }),
    "qwen-cloud": M({ model: "o/q:free", cost: 0, order: -1 }),
    haiku: M({ model: "a/haiku", cost: 1 }),
    abe: M({ model: "a/abe", cost: 3 }),
  };
  assert.deepEqual(enabled(ms).map((m) => m.name), ["qwen-cloud", "qwen-local", "haiku", "abe", "sonnet"]);
});

test("enabled breaks a full tie by name", () => {
  assert.deepEqual(enabled({ b: M({ model: "x" }), a: M({ model: "y" }) }).map((m) => m.name), ["a", "b"]);
});

test("levels, bottom, top and next over a set with a gap", () => {
  const ms = { x: M({ abilities: { write: 0 } }), y: M({ abilities: { write: 2 } }), z: M({ abilities: { write: 3 } }), r: M({ abilities: { read: 1 } }) };
  assert.deepEqual(levels(ms, "write"), [0, 2, 3]);
  assert.equal(bottom(ms, "write"), 0);
  assert.equal(top(ms, "write"), 3);
  assert.equal(next(ms, "write", 0), 2);
  assert.equal(next(ms, "write", 3), 3);
  assert.deepEqual(levels(ms, "read"), [1]);
});

test("meeting lists the enabled members at or above a level, in order; lvl is −1 without the ability", () => {
  const ms = { a: M({ abilities: { write: 0 }, cost: 0 }), b: M({ abilities: { write: 2 }, cost: 3 }), c: M({ abilities: { write: 1 }, cost: 1 }) };
  assert.deepEqual(meeting(ms, "write", 1).map((m) => m.name), ["c", "b"]);
  assert.equal(lvl(ms.a, "read"), -1);
  assert.equal(lvl(undefined, "write"), -1);
});

test("effortAt clamps to the ladder's last step", () => {
  const m = M({ efforts: ["medium", "high"] });
  assert.equal(effortAt(m, 0), "medium");
  assert.equal(effortAt(m, 1), "high");
  assert.equal(effortAt(m, 5), "high");
});

test("stepOf: the highest ladder index whose effort is at most e", () => {
  const m = M({ efforts: ["medium", "high"] });
  assert.equal(stepOf(m, "low"), -1);
  assert.equal(stepOf(m, "medium"), 0);
  assert.equal(stepOf(m, "high"), 1);
  assert.equal(stepOf(m, "xhigh"), 1);
  assert.deepEqual(EFFORTS.map(effortRank), [0, 1, 2, 3, 4, 5, 6]);
});

test("providerOf: the model's prefix, or the override", () => {
  assert.equal(providerOf(M({ model: "openrouter/qwen/qwen3.8-27b:free" })), "openrouter");
  assert.equal(providerOf(M({ model: "llama/qwen3.8", provider: "lan" })), "lan");
});

test("sameLadder compares the efforts", () => {
  assert.ok(sameLadder(M({ efforts: ["high", "xhigh"] }), M({ efforts: ["high", "xhigh"] })));
  assert.ok(!sameLadder(M({ efforts: ["high"] }), M({ efforts: ["high", "xhigh"] })));
});

test("named finds a member by key", () => {
  const ms = { a: M({ route: "local" }), b: M({ route: "T1" }) };
  assert.equal(named(ms, "b")?.name, "b");
  assert.equal(named(ms, "zz"), undefined);
});

test("P-empty (static): an empty member is in no enabled, meeting or byModel result", () => {
  for (const blank of [{ model: "" }, { model: "", abilities: { write: 9 } }, { model: "", cost: -1, order: -9 }]) {
    const ms = { ghost: M({ ...blank }), real: M({ model: "a/real", abilities: { write: 1 } }) };
    assert.deepEqual(enabled(ms).map((m) => m.name), ["real"]);
    assert.deepEqual(meeting(ms, "write", 0).map((m) => m.name), ["real"]);
    assert.equal(byModel(ms, ""), undefined);
    assert.deepEqual(levels(ms, "write"), [1]);
    assert.equal(top(ms, "write"), 1);
  }
});
