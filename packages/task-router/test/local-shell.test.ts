// Local mode L1.T6 (design §2.4, §2.5, LD3, AC-R4, OQ12): no delegation nudge in local mode; the status line says "local".
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusText } from "../core/local/mode.ts";
import { harness } from "./harness.ts";

const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
const turn = (tools: string[]) => ({ message: { stopReason: "toolUse" }, toolResults: tools.map((toolName) => ({ toolName })) });
const nudges = (h: ReturnType<typeof harness>) => h.f.sent.filter((s) => s.msg.customType === "task-router/delegation-nudge");
const LOCAL = { provider: "llama", id: "qwen3.8" };
const SONNET = { provider: "anthropic", id: "claude-sonnet-5-5" };
/** A main ctx with a status spy and a model. */
const withStatus = (model?: { provider: string; id: string }) => {
  const calls: [string, string | undefined][] = [];
  return { calls, ctx: { ...MAIN, hasUI: true, ...(model ? { model } : {}), ui: { setStatus: (k: string, v: string | undefined) => void calls.push([k, v]), notify: () => undefined } } };
};

test("AC-R4: local mode, 20 inline edits (one per turn, then 20 in one turn) → no delegation nudge", () => {
  const h = harness({ settings: { mode: "local" } });
  h.f.fire("session_start", {}, MAIN);
  for (let i = 0; i < 20; i++) h.f.fire("turn_end", turn(["edit"]), MAIN);
  h.f.fire("turn_end", turn(Array(20).fill("edit")), MAIN);
  assert.deepEqual(nudges(h), []);
  const d = harness(); // contrast: default mode nudges on the same calls
  d.f.fire("session_start", {}, MAIN);
  for (let i = 0; i < 20; i++) d.f.fire("turn_end", turn(["edit"]), MAIN);
  assert.ok(nudges(d).length > 0);
});

test("statusText: local, local with a non-local main, default mode", () => {
  const localModels = ["llama/qwen3.8"];
  const cases: [Parameters<typeof statusText>[0], string | undefined][] = [
    [{ local: false, localModels }, undefined],
    [{ local: false, main: "anthropic/claude-sonnet-5-5", localModels }, undefined],
    [{ local: true, localModels }, "local"],
    [{ local: true, main: "llama/qwen3.8", localModels }, "local"],
    [{ local: true, main: "anthropic/claude-sonnet-5-5", localModels }, "local (main: anthropic/claude-sonnet-5-5)"],
    [{ local: true, main: "llama/qwen3.8", localModels: [] }, "local (main: llama/qwen3.8)"],
  ];
  for (const [x, want] of cases) assert.equal(statusText(x), want, JSON.stringify(x));
});

test("status: local mode sets task-router to local, names a non-local main, follows model_select", () => {
  const h = harness({ settings: { mode: "local" } });
  const a = withStatus(LOCAL);
  h.f.fire("session_start", {}, a.ctx);
  assert.deepEqual(a.calls, [["task-router", "local"]]);
  const g = harness({ settings: { mode: "local" } });
  const b = withStatus(SONNET);
  g.f.fire("session_start", {}, b.ctx);
  assert.deepEqual(b.calls, [["task-router", "local (main: anthropic/claude-sonnet-5-5)"]]);
  g.f.fire("model_select", { model: LOCAL, previousModel: SONNET, source: "set" }, b.ctx);
  assert.deepEqual(b.calls.at(-1), ["task-router", "local"]);
  g.f.fire("model_select", { model: SONNET, previousModel: LOCAL, source: "cycle" }, b.ctx);
  assert.deepEqual(b.calls.at(-1), ["task-router", "local (main: anthropic/claude-sonnet-5-5)"]);
});

test("status: default mode never touches the status line and registers no model_select hook", () => {
  const h = harness();
  const a = withStatus(SONNET);
  h.f.fire("session_start", {}, a.ctx);
  h.f.fire("model_select", { model: LOCAL, previousModel: SONNET, source: "set" }, a.ctx);
  assert.deepEqual(a.calls, []);
  assert.ok(!h.f.hookNames().includes("model_select"));
});

test("status: a session without ui or model does not throw", () => {
  const h = harness({ settings: { mode: "local" } });
  h.f.fire("session_start", {}, undefined);
  h.f.fire("session_start", {}, {});
  h.f.fire("model_select", {}, {});
  h.f.fire("model_select", undefined, undefined);
});
