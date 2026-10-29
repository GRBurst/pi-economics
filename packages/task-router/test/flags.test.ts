// T8.5 (R10): routing / verifyGate / autoEscalate / freshOnCold read through `__piExperimentsApi_v1.flag`,
// the router's own setting as the default. Absent API → own setting.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { withFlags } from "../core/flags.ts";
import { defaults } from "../core/settings.ts";
import { accepted, card, harness } from "./harness.ts";

type G = { __piExperimentsApi_v1?: unknown };
const g = globalThis as G;
afterEach(() => void delete g.__piExperimentsApi_v1);
/** An experiments API whose arm sets `flags` for every session; records the (name, def, sessionId) calls. */
const arm = (flags: Record<string, string>) => {
  const calls: unknown[][] = [];
  g.__piExperimentsApi_v1 = { version: 1, flag: (n: string, d: string, s?: string) => (calls.push([n, d, s]), flags[n] ?? d) };
  return calls;
};
const settle = () => new Promise((r) => setImmediate(r));

test("withFlags: live view over the settings; the own setting is the default; other keys untouched", () => {
  const s = defaults();
  let flags: Record<string, string> = {};
  const v = withFlags(s, (n, d) => flags[n] ?? d);
  assert.deepEqual([v.routing, v.verifyGate, v.autoEscalate, v.freshOnCold], [true, true, true, s.freshOnCold]);
  flags = { routing: "off", verifyGate: "off", autoEscalate: "off", freshOnCold: "off" };
  assert.deepEqual([v.routing, v.verifyGate, v.autoEscalate], [false, false, false]);
  assert.deepEqual(v.freshOnCold, { ...s.freshOnCold, mode: "off" });
  assert.deepEqual(v.models, s.models);
  flags = { routing: "on" };
  assert.equal(withFlags({ ...s, routing: false }, (n, d) => flags[n] ?? d).routing, true);
});

test("withFlags passes importanceTable through", () => {
  const s = defaults();
  const v = withFlags(s, (_n, d) => d);
  assert.deepEqual(v.importanceTable, s.importanceTable);
  assert.equal(v.readOnlyReview, s.readOnlyReview);
  assert.equal(v.contextFit, s.contextFit);
});

test("routing flag off → no task_cards section", () => {
  const calls = arm({ routing: "off" });
  const h = harness();
  const options = { sections: {} as Record<string, string>, skills: [] };
  h.f.fire("session_start", {}, { sessionManager: { getSessionId: () => "s-main" } });
  h.f.fire("before_agent_start", { systemPromptOptions: options }, {});
  assert.equal(options.sections.task_cards, undefined);
  assert.deepEqual(calls.at(-1), ["routing", "on", "s-main"]);
});

test("autoEscalate flag off → no failover (absent API: failover runs)", async () => {
  for (const off of [false, true]) {
    if (off) arm({ autoEscalate: "off" });
    const h = harness();
    accepted(await h.a.spawn({ name: "q1", task: card() }));
    h.a.emit({ type: "error", name: "q1", reason: "x", ts: 1 });
    await settle();
    assert.equal(h.a.retunes.length === 0, off);
  }
});

test("verifyGate flag off → the check does not run", async () => {
  arm({ verifyGate: "off" });
  const runs: string[] = [];
  const h = harness({ extra: { run: async (cmd: string) => (runs.push(cmd), { exit: 0, output: "", timedOut: false }) } as any });
  accepted(await h.a.spawn({ name: "q1", task: card({ check: "npm test" }) }));
  h.a.agents.splice(0, h.a.agents.length, { name: "q1", parent: "main", sessionId: "q1", model: "x", thinkingLevel: "xhigh", state: "idle" } as any);
  h.a.emit({ type: "route", from: "q1", to: "main", preview: "done", buffered: false, ts: 1 });
  await settle(); await settle();
  assert.deepEqual(runs, []);
});

test("freshOnCold flag off → a send to a cold, big child is untouched", () => {
  for (const off of [false, true]) {
    if (off) arm({ freshOnCold: "off" });
    const h = harness();
    h.a.agents.push({ name: "w1", parent: "main", sessionId: "w1", model: "m", thinkingLevel: "high", state: "idle", lastRequestAt: h.clock.t - 600_000, contextTokens: 180_000 } as any);
    h.f.fire("tool_call", { toolName: "send_message", toolCallId: "t", input: { to: ["w1"], content: "x" } }, {});
    const r = h.f.fire("tool_result", { toolName: "send_message", toolCallId: "t", content: [{ type: "text", text: "sent" }] }, {})[0] as any;
    assert.equal(r === undefined, off);
  }
});

test("the spawn outcome line records the parent session's arm id; no API → no arm key", async () => {
  const spawned = async () => {
    const h = harness();
    accepted(await h.a.spawn({ name: "q1", task: card() }));
    h.a.emit({ type: "spawn", name: "q1", by: "main", parent: "main", childSessionId: "s-q1", ts: 1 });
    return h.lines().find((l) => l.event === "spawn")!;
  };
  assert.ok(!("arm" in (await spawned())));
  g.__piExperimentsApi_v1 = { version: 1, flag: (_n: string, d: string) => d, armFor: (s: string) => (s === "s-main" ? { id: "+-+--", flags: {} } : undefined) };
  assert.equal((await spawned()).arm, "+-+--");
});
