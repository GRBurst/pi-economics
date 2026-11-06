// Activation at session_start (spec D5, §4.2; plan T3.1): the router routes only when actor-subagents' spawn-policy
// API is loaded. Without it: one warning, no task_verdict, no task_cards section, no nudge; the effort guard and
// fresh-on-cold stay on. Every extension factory runs before the first session_start, so the check there does not
// depend on load order.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeApi } from "./fake-api.ts";
import { harness } from "./harness.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: Set<string> }).__piEconomicsWarned_v1);

const WARNING =
  "task-router: needs pi-actor-subagents with the spawn-policy API (__subagentsApi_v1), which is not loaded; " +
  "task-router routing is off (no task_verdict, no task_cards, no nudge); the effort guard and fresh-on-cold stay on. " +
  "Get the patched build via the pi-economics Nix modules; upstream support pending.";

const ui = () => {
  const notes: string[] = [];
  return { notes, ctx: { hasUI: true, ui: { notify: (m: string) => void notes.push(m) }, sessionManager: { getSessionId: () => "s-main" } } };
};
const cards = (h: ReturnType<typeof harness>, ctx: unknown) => {
  const options = { sections: { task_cards: "stale", other: "kept" } as Record<string, string>, skills: [] };
  h.f.fire("before_agent_start", { systemPromptOptions: options }, ctx);
  return options.sections;
};
const turn = (n: number) => ({ message: { stopReason: "toolUse" }, toolResults: Array.from({ length: n }, () => ({ toolName: "bash" })) });
const nudges = (h: ReturnType<typeof harness>) => h.f.sent.filter((s) => s.msg.customType === "task-router/delegation-nudge");
/** Counts registerTool calls per tool name from here on. */
const countTools = (h: ReturnType<typeof harness>) => {
  const counts = new Map<string, number>();
  const register = h.f.pi.registerTool;
  h.f.pi.registerTool = (t) => { counts.set(t.name, (counts.get(t.name) ?? 0) + 1); register(t); };
  return counts;
};

test("without the API: one warning, no task_verdict, the task_cards section removed, no nudge", () => {
  const h = harness({ extra: { api: () => undefined } });
  const { notes, ctx } = ui();
  h.f.fire("session_start", {}, ctx);
  h.f.fire("session_start", {}, ctx);
  assert.deepEqual(notes, [WARNING]);
  assert.equal(h.f.tools.has("task_verdict"), false);
  assert.deepEqual(cards(h, ctx), { other: "kept" });
  h.f.fire("turn_end", turn(30), ctx);
  assert.equal(nudges(h).length, 0);
});

test("without the API the effort guard and fresh-on-cold stay installed (m1)", () => {
  const h = harness({ extra: { api: () => undefined } });
  h.f.fire("session_start", {}, ui().ctx);
  h.f.thinking.level = "high";
  h.f.fire("turn_start", {}, {});
  h.f.fire("turn_end", {}, {});
  h.f.thinking.level = "max";
  h.f.fire("turn_start", {}, {});
  h.f.fire("turn_end", {}, {});
  assert.deepEqual(h.f.thinking.sets, ["high"], "max is a burst: restored after maxBurstTurns");
  // fresh-on-cold reads the API per call, so without it there is nothing to advise; its hooks are there all the same.
  const active = harness();
  active.f.fire("session_start", {}, ui().ctx);
  for (const ev of ["tool_call", "tool_result"]) {
    const n = h.f.fire(ev, { toolName: "send_message", toolCallId: "t", input: { to: ["w"] } }, {}).length;
    assert.ok(n > 0, ev);
    assert.equal(n, active.f.fire(ev, { toolName: "send_message", toolCallId: "t", input: { to: ["w"] } }, {}).length, ev);
  }
});

test("with the API: task_verdict is registered at the first session_start, once; the policy once; no warning", () => {
  const h = harness();
  const counts = countTools(h);
  assert.equal(h.f.tools.has("task_verdict"), false, "not at load");
  assert.equal(h.a.hasPolicy(), true, "the policy connects at load when the API is there");
  const { notes, ctx } = ui();
  h.f.fire("session_start", {}, ctx);
  h.f.fire("session_start", {}, ctx);
  assert.equal(counts.get("task_verdict"), 1);
  assert.deepEqual(notes, []);
  assert.ok(cards(h, ctx).task_cards?.includes("spawn_subagent"));
  h.f.fire("turn_end", turn(6), ctx);
  assert.equal(nudges(h).length, 1);
});

test("an API loaded after the router (load order) activates it at session_start", () => {
  let api: ReturnType<typeof fakeApi>["api"] | undefined;
  const late = fakeApi();
  const h = harness({ extra: { api: () => api } });
  assert.equal(late.hasPolicy(), false);
  api = late.api;
  const { notes, ctx } = ui();
  h.f.fire("session_start", {}, ctx);
  assert.equal(late.hasPolicy(), true);
  assert.equal(h.f.tools.has("task_verdict"), true);
  assert.deepEqual(notes, []);
});
