// Local mode L2.T2 (design §3.0.3, AC-L2): the router's `force` line and a forced spawn's fields; no text reaches them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutcomeLog } from "../core/log.ts";
import { EFFORTS } from "../core/members.ts";
import { forceEvent, spawnEvent } from "../core/outcome.ts";
import type { OutcomeEvent } from "../core/outcome.ts";
import type { Card, Plan } from "../core/types.ts";

const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const ACTIONS = ["set", "clear", "used", "expired", "rejected"] as const;
const SOURCES = ["command", "settings"] as const;
const REASONS = ["unknown-model", "usage"] as const;
/** A literal copy of today's outcome keys (test/outcome.test.ts K_ALLOWED): an unforced spawn keeps to them. */
const TODAY_KEYS = new Set([
  "v", "ts", "event", "taskId", "cardHash", "kind", "workerTier", "workerEffort", "reviewTier", "reviewEffort",
  "base", "importance", "reasons", "arm", "sessionId", "parentSessionId", "attemptOf", "from", "to", "reason",
  "exit", "durationMs", "verdict", "note", "unresolved", "assigned", "routeBase", "reviewOf", "requested",
  "ability", "level", "draft", "workerLevel", "reviewLevel", "workerMember", "workerModel", "startEffort", "waitMs",
  "fromModel", "toModel", "fromLevel", "toLevel",
]);
const FORCED_KEYS = ["forced", "forceSource", "routedModel", "routedEffort"];
const card: Card = { kind: "implement", files: ["src/a.ts"], check: "npm test", acceptance: ["ok"], t0: { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true }, t2: [] };
const plan = { ability: "write", level: 0, worker: { tier: "qwen", effort: "xhigh", level: 0 }, base: "qwen", importance: "normal", reasons: ["force: anthropic/claude-sonnet-5-5 high (command)"] } as unknown as Plan;
const start = { member: "sonnet", model: "anthropic/claude-sonnet-5-5", effort: "high" as const, waitMs: 0 };
const MODEL_REF = /^[^\s/]+\/\S+$/;

test("forceEvent: every action is a force line with taskId \"\"; model, effort and reason only when given", () => {
  for (const action of ACTIONS) for (const source of SOURCES) {
    const bare = forceEvent({ now: NOW, action, source });
    assert.deepEqual(bare, { v: 1, ts: NOW.toISOString(), event: "force", taskId: "", action, source });
    const full = forceEvent({ now: NOW, action, source, model: "anthropic/claude-sonnet-5-5", effort: "high", reason: "unknown-model" });
    assert.deepEqual(full, { v: 1, ts: NOW.toISOString(), event: "force", taskId: "", action, source, model: "anthropic/claude-sonnet-5-5", effort: "high", reason: "unknown-model" });
  }
});

test("spawnEvent: a forced spawn carries forced, forceSource, routedModel, routedEffort; an unforced one none of them", () => {
  const f = spawnEvent({ now: NOW, taskId: "t1", card, plan, start, forced: { source: "command", routedModel: "llama/qwen3.8", routedEffort: "xhigh" } });
  assert.deepEqual(Object.fromEntries(FORCED_KEYS.map((k) => [k, f[k]])), { forced: true, forceSource: "command", routedModel: "llama/qwen3.8", routedEffort: "xhigh" });
  assert.deepEqual([f.workerTier, f.workerEffort, f.workerModel, f.startEffort], ["qwen", "xhigh", "anthropic/claude-sonnet-5-5", "high"]);
  const s = spawnEvent({ now: NOW, taskId: "t1", card, plan, start, forced: { source: "settings", routedModel: "llama/qwen3.8", routedEffort: "xhigh" } });
  assert.equal(s.forceSource, "settings");
  const u = spawnEvent({ now: NOW, taskId: "t1", card, plan, start });
  for (const k of FORCED_KEYS) assert.ok(!(k in u), k);
  for (const k of Object.keys(u)) assert.ok(TODAY_KEYS.has(k), `unforced spawn: key ${k} is not one of today's`);
});

test("spawnEvent: a non-member start (member \"\") has no workerMember; its model and effort stay", () => {
  const e = spawnEvent({ now: NOW, taskId: "t1", card, plan, start: { member: "", model: "other/model", effort: "max", waitMs: 0 },
    forced: { source: "command", routedModel: "llama/qwen3.8", routedEffort: "xhigh" } });
  assert.ok(!("workerMember" in e), JSON.stringify(e));
  assert.deepEqual([e.workerModel, e.startEffort, e.waitMs], ["other/model", "max", 0]);
});

test("AC-L2: every string value of a force line is an enum value, an effort, a model reference, or the empty taskId", () => {
  const lines: OutcomeEvent[] = [];
  const log = createOutcomeLog({ append: (e) => void lines.push(e), now: () => NOW });
  const models = [undefined, "anthropic/claude-sonnet-5-5", "openrouter/qwen/x:free", "llama/qwen3.8"];
  for (const action of ACTIONS) for (const source of SOURCES) for (const model of models)
    for (const effort of [undefined, ...EFFORTS]) for (const reason of [undefined, ...REASONS]) log.force({ action, source, model, effort, reason });
  assert.equal(lines.length, ACTIONS.length * SOURCES.length * models.length * (EFFORTS.length + 1) * (REASONS.length + 1));
  const enums = new Set<string>(["force", ...ACTIONS, ...SOURCES, ...REASONS, ...EFFORTS]);
  for (const l of lines) {
    assert.equal(l.event, "force");
    assert.equal(l.taskId, "");
    assert.equal(l.ts, NOW.toISOString());
    for (const [k, v] of Object.entries(l)) {
      if (k === "ts" || k === "taskId" || typeof v !== "string") continue;
      assert.ok(enums.has(v) || MODEL_REF.test(v), `${k}: ${v}`);
    }
  }
});

test("log.spawn passes forced through to the spawn line", () => {
  const lines: OutcomeEvent[] = [];
  const log = createOutcomeLog({ append: (e) => void lines.push(e), now: () => NOW });
  log.spawn({ taskId: "t1", card, plan, start, forced: { source: "settings", routedModel: "llama/qwen3.8", routedEffort: "xhigh" } });
  assert.deepEqual([lines[0].forced, lines[0].forceSource, lines[0].routedModel, lines[0].routedEffort], [true, "settings", "llama/qwen3.8", "xhigh"]);
});
