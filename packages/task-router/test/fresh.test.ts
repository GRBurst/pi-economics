import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";

const MIN = 60_000;
function rig(mode = "advise", agent: Record<string, unknown> = {}) {
  const h = harness({ settings: { freshOnCold: { mode, minTokens: 150_000 } } });
  h.a.agents.push({
    name: "w1", parent: "main", sessionId: "w1", model: "m", thinkingLevel: "high", state: "idle",
    lastRequestAt: h.clock.t - 10 * MIN, contextTokens: 180_000, ...agent,
  } as any);
  const call = (input: unknown, toolName = "send_message", toolCallId = "tc1") => h.f.fire("tool_call", { toolName, toolCallId, input }, { ui: {} })[0] as any;
  const result = (toolCallId = "tc1") => h.f.fire("tool_result", { toolName: "send_message", toolCallId, content: [{ type: "text", text: "sent" }] }, {})[0] as any;
  return { h, call, result };
}
const msg = (to: string[] = ["w1"]) => ({ to, content: "more work" });

test("advise: idle + cold + ≥ minTokens → the send goes through, the tool result gets a handoff note", () => {
  const { call, result } = rig();
  assert.equal(call(msg()), undefined);
  const r = result();
  assert.equal(r.content[0].text, "sent");
  assert.match(r.content[1].text, /w1.*cold.*180k/s);
  assert.match(r.content[1].text, /fresh agent.*handoff/is);
});

test("enforce: blocked with the handoff instruction", () => {
  const { call, result } = rig("enforce");
  const r = call(msg());
  assert.equal(r.block, true);
  assert.match(r.reason, /w1.*cold.*180k/s);
  assert.match(r.reason, /spawn.*fresh agent.*handoff/is);
  assert.equal(result(), undefined); // nothing to annotate: the call never ran
});

test("warm, running, small, unknown targets and other tools are untouched", () => {
  for (const agent of [{ lastRequestAt: undefined, state: "running" }, { lastRequestAt: Date.UTC(2026, 9, 2, 12, 0, 0) - MIN }, { contextTokens: 149_999 }, { state: "running" }]) {
    const { call, result } = rig("enforce", agent);
    // `lastRequestAt: undefined` + running must not count as cold; the others are warm, small or running
    assert.equal(call(msg()), undefined, JSON.stringify(agent));
    assert.equal(result(), undefined);
  }
  const { call } = rig("enforce");
  assert.equal(call(msg(["main", "ghost"])), undefined);
  assert.equal(call({ command: "ls" }, "bash"), undefined);
  assert.equal(call({ nonsense: 1 }), undefined);
});

test("mode off → nothing; multicast names every cold target", () => {
  assert.equal(rig("off").call(msg()), undefined);
  const { h, call } = rig("enforce");
  h.a.agents.push({ ...h.a.agents[0], name: "w2" } as any);
  const r = call(msg(["w1", "w2"]));
  assert.match(r.reason, /w1/);
  assert.match(r.reason, /w2/);
});
