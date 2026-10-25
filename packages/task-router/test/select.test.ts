import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, labelLeg } from "../core/select.ts";
import { defaults, parseSettings } from "../core/settings.ts";

const S = defaults();
const names = (s: typeof S, a: string, l: number) => candidates(s, a, l, 0).cands.map((m) => m.name);

test("candidates: the enabled members meeting the level, in (cost, order, name) order (cloud before local today)", () => {
  assert.deepEqual(names(S, "write", 0), ["qwen-cloud", "qwen-local", "sonnet", "opus"]);
  assert.deepEqual(names(S, "write", 1), ["sonnet", "opus"]);
  assert.deepEqual(names(S, "read", 1), ["sonnet", "opus"]);
  assert.deepEqual(names(S, "read", 3), ["opus"]);
  const h = parseSettings({ models: { haiku: { model: "anthropic/claude-haiku-5-5" } } }).settings;
  assert.deepEqual(names(h, "read", 1), ["haiku", "sonnet", "opus"]);
  assert.equal(candidates(S, "write", 0, 50_000).reason, undefined);
});

test("candidates: a blank member is no candidate", () => {
  const s = parseSettings({ models: { "qwen-cloud": { model: "" } } }).settings;
  assert.deepEqual(names(s, "write", 0), ["qwen-local", "sonnet", "opus"]);
});

test("labelLeg: the first candidate, its effort at the step clamped to its ladder", () => {
  assert.deepEqual(labelLeg(S, "write", { level: 0, step: 3 }, 0), {
    leg: { level: 0, step: 3, member: "qwen-cloud", model: "openrouter/qwen/qwen3.8-27b:free", tier: "qwen", effort: "xhigh" },
  });
  assert.deepEqual(labelLeg(S, "read", { level: 2, step: 1 }, 0).leg, { level: 2, step: 1, member: "sonnet", model: "anthropic/claude-sonnet-5-5", tier: "T1", effort: "xhigh" });
  assert.deepEqual(labelLeg(S, "write", { level: 2, step: 0 }, 0).leg.effort, "high");
});
