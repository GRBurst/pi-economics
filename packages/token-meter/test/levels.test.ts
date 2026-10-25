// levelsOfLine (spec §6.4 "Old → new mapping"): the router's levels and models of an outcome line. A line that carries
// the router's 2026-10-17 fields is returned as written; an older line is mapped by the spec's tables, one case per row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { levelsOfLine, type LevelsContext } from "../core/levels.ts";

const LOCAL = "llama/qwen3.8";
const FREE = "openrouter/qwen/qwen3.8-27b:free";
const SONNET = "anthropic/claude-sonnet-5-5";
const OPUS = "anthropic/claude-opus-5-5";

type Line = Record<string, any>;
const spawn = (taskId: string, kind: string, workerTier: string, rest: Line = {}): Line =>
  ({ v: 1, event: "spawn", taskId, kind, workerTier, workerEffort: "xhigh", base: workerTier, reasons: [], ...rest });
const ctxOf = (lines: Line[]): LevelsContext => ({
  spawns: new Map(lines.filter((l) => l.event === "spawn").map((l) => [l.taskId, l])),
  lastReroute: new Map(lines.filter((l) => l.event === "reroute").map((l) => [l.taskId, l])),
});
const NONE = ctxOf([]);

// ---- spawn: a new line ----------------------------------------------------------------------------

test("a spawn line with the router's fields is returned as written; ranModel is the last reroute's toModel", () => {
  const l = spawn("n1", "implement", "qwen", {
    ability: "write", level: 0, draft: true, workerLevel: 0, reviewLevel: 1, workerMember: "haiku", workerModel: "anthropic/claude-haiku", startEffort: "medium", waitMs: 0,
    reasons: ["qwen chain: cloud"], // a stray old reason never overrides the written fields
  });
  assert.deepEqual(levelsOfLine(l, NONE), {
    ability: "write", level: 0, draft: true, workerLevel: 0, reviewLevel: 1, workerModel: "anthropic/claude-haiku", ranModel: "anthropic/claude-haiku", startEffort: "medium",
  });
  const r = { event: "reroute", taskId: "n1", from: "haiku", to: "T1", fromModel: "anthropic/claude-haiku", toModel: SONNET };
  assert.equal(levelsOfLine(l, ctxOf([l, r])).ranModel, SONNET);
});

// ---- spawn: old lines, table "old line → ability, level, workerLevel, workerModel" ---------------------------

test("old scout/review: read; base qwen/qwen-draft → 0, T1 → 2, T2 → 3; workerLevel on the same map (P20: read T1 is 2)", () => {
  const cases: [string, string, string, number, number][] = [
    ["scout", "qwen", "qwen", 0, 0], ["review", "qwen-draft", "qwen", 0, 0], ["scout", "T1", "T1", 2, 2], ["review", "T2", "T2", 3, 3], ["scout", "qwen", "T1", 0, 2],
  ];
  for (const [kind, base, tier, level, workerLevel] of cases) {
    const v = levelsOfLine(spawn("s", kind, tier, { base }), NONE);
    assert.deepEqual([v.ability, v.level, v.draft, v.workerLevel], ["read", level, undefined, workerLevel], `${kind} ${base} ${tier}`);
  }
});

test("old other routed kinds: write; base qwen → 0, qwen-draft → 0 + draft, T1 → 1, T2 → 2; workerLevel on the same map", () => {
  const cases: [string, string, number, true | undefined, number][] = [
    ["qwen", "qwen", 0, undefined, 0], ["qwen-draft", "qwen", 0, true, 0], ["T1", "T1", 1, undefined, 1], ["T2", "T2", 2, undefined, 2], ["T1", "T2", 1, undefined, 2],
  ];
  for (const [base, tier, level, draft, workerLevel] of cases) {
    const v = levelsOfLine(spawn("w", "implement", tier, { base }), NONE);
    assert.deepEqual([v.ability, v.level, v.draft, v.workerLevel], ["write", level, draft, workerLevel], `${base} ${tier}`);
  }
});

test("old unrouted: no ability or levels; workerModel from the reason \"model …\"", () => {
  const v = levelsOfLine(spawn("u", "unrouted", "vendor/other", { reasons: ["routing off", "model vendor/other"] }), NONE);
  assert.deepEqual(v, { workerModel: "vendor/other", ranModel: "vendor/other", startEffort: "xhigh" });
});

test("old workerModel: T1/T2 → Sonnet/Opus 5.5; qwen by the chain reason; a v0 line without a chain reason → unknown", () => {
  const model = (tier: string, reasons: string[], rest: Line = {}) => levelsOfLine(spawn("m", "implement", tier, { reasons, ...rest }), NONE).workerModel;
  assert.equal(model("T1", ["t0 misses: linear"]), SONNET);
  assert.equal(model("T2", ["t2: auth"]), OPUS);
  assert.equal(model("qwen", ["all t0 criteria hold", "qwen chain: local"]), LOCAL);
  assert.equal(model("qwen", ["all t0 criteria hold", "qwen chain: cloud"]), FREE);
  assert.equal(model("qwen", ["all t0 criteria hold", "qwen chain → Sonnet: qwen slots busy for 300 s"]), SONNET);
  assert.equal(model("qwen", ["all t0 criteria hold"], { v: undefined }), undefined);
});

test("old startEffort: workerEffort, except a qwen chain → Sonnet fallback → high", () => {
  assert.equal(levelsOfLine(spawn("e", "implement", "qwen", { reasons: ["qwen chain: cloud"] }), NONE).startEffort, "xhigh");
  assert.equal(levelsOfLine(spawn("e", "implement", "qwen", { reasons: ["qwen chain → Sonnet: local down"] }), NONE).startEffort, "high");
});

test("old ranModel: the last reroute's `to` mapped (local, cloud, T1, T2), else workerModel", () => {
  const l = spawn("r1", "implement", "qwen", { reasons: ["qwen chain: cloud"] });
  assert.equal(levelsOfLine(l, NONE).ranModel, FREE);
  for (const [to, m] of [["local", LOCAL], ["cloud", FREE], ["T1", SONNET], ["T2", OPUS]]) {
    const r = { event: "reroute", taskId: "r1", from: "cloud", to, reason: "x" };
    assert.equal(levelsOfLine(l, ctxOf([l, r])).ranModel, m, to);
  }
});

// ---- escalate and reroute ------------------------------------------------------------------------

test("an escalate line with the router's fields is returned as written", () => {
  const e = { event: "escalate", taskId: "b", attemptOf: "a", from: "cloud", to: "T1", fromModel: FREE, toModel: SONNET, ability: "write", fromLevel: 0, toLevel: 1 };
  assert.deepEqual(levelsOfLine(e, NONE), { ability: "write", fromLevel: 0, toLevel: 1, fromModel: FREE, toModel: SONNET });
});

test("old escalate: ability of the spawn named by attemptOf; local/cloud → 0, T1 → 1 (read 2), T2 → 2 (read 3); models by label", () => {
  const w = spawn("a", "implement", "qwen"), s = spawn("sc", "scout", "qwen");
  const ctx = ctxOf([w, s]);
  const esc = (attemptOf: string, from: string, to: string) => levelsOfLine({ event: "escalate", taskId: `${attemptOf}b`, attemptOf, from, to }, ctx);
  assert.deepEqual(esc("a", "local", "T1"), { ability: "write", fromLevel: 0, toLevel: 1, fromModel: LOCAL, toModel: SONNET });
  assert.deepEqual(esc("a", "cloud", "T2"), { ability: "write", fromLevel: 0, toLevel: 2, fromModel: FREE, toModel: OPUS });
  assert.deepEqual(esc("a", "T1", "T2"), { ability: "write", fromLevel: 1, toLevel: 2, fromModel: SONNET, toModel: OPUS });
  assert.deepEqual(esc("sc", "cloud", "T1"), { ability: "read", fromLevel: 0, toLevel: 2, fromModel: FREE, toModel: SONNET });
  assert.deepEqual(esc("sc", "T1", "T2"), { ability: "read", fromLevel: 2, toLevel: 3, fromModel: SONNET, toModel: OPUS });
});

test("old escalate from \"?\": fromLevel from the failed spawn's workerTier, fromModel unknown; no failed spawn → no ability, no levels", () => {
  const ctx = ctxOf([spawn("a", "implement", "T1"), spawn("sc", "review", "qwen")]);
  assert.deepEqual(levelsOfLine({ event: "escalate", taskId: "ab", attemptOf: "a", from: "?", to: "T2" }, ctx), { ability: "write", fromLevel: 1, toLevel: 2, toModel: OPUS });
  assert.deepEqual(levelsOfLine({ event: "escalate", taskId: "sb", attemptOf: "sc", from: "?", to: "T1" }, ctx), { ability: "read", fromLevel: 0, toLevel: 2, toModel: SONNET });
  assert.deepEqual(levelsOfLine({ event: "escalate", taskId: "zb", attemptOf: "z", from: "cloud", to: "T1" }, ctx), { fromModel: FREE, toModel: SONNET });
});

test("reroute: models only — as written when present, else by the label map", () => {
  assert.deepEqual(levelsOfLine({ event: "reroute", taskId: "q", from: "cloud", to: "T1", reason: "x", fromModel: "a/b", toModel: "c/d" }, NONE), { fromModel: "a/b", toModel: "c/d" });
  assert.deepEqual(levelsOfLine({ event: "reroute", taskId: "q", from: "local", to: "cloud", reason: "x" }, NONE), { fromModel: LOCAL, toModel: FREE });
});

test("other events have no levels", () => {
  for (const event of ["check", "verdict", "corrective", "spotcheck"]) assert.deepEqual(levelsOfLine({ event, taskId: "t" }, NONE), {});
});
