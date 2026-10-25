// T10.5 follow-up: with routing=false the router still writes the outcome log (spawn, verdict, unjudged),
// because the bench's routing-off arms need verdicts and $ per task; only the routing decision is skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";

const agent = (name: string, sessionId: string, model: string, thinkingLevel: any = "high") => ({ name, parent: "main", sessionId, model, thinkingLevel, state: "running" as const });

function rig(settings: Record<string, unknown> = { routing: false }) {
  const h = harness({ settings });
  h.a.agents.push(agent("main", "s-main", "anthropic/claude-opus-5-5"), agent("kid", "s-kid", "anthropic/claude-sonnet-5-5"), agent("qk", "s-qk", "openrouter/qwen/qwen3.8-27b:free", "xhigh"));
  return h;
}
const spawned = (h: ReturnType<typeof rig>, name: string, sid: string) =>
  h.a.emit({ type: "spawn", name, by: "main", parent: "main", childSessionId: sid, ts: 0 });

test("routing=false: a spawn is logged as kind unrouted with the model it got and the sessions", async () => {
  const h = rig();
  await h.a.spawn({ name: "kid", model: "anthropic/claude-sonnet-5-5", thinkingLevel: "high" });
  spawned(h, "kid", "s-kid");
  const [l] = h.lines();
  assert.equal(l.event, "spawn");
  assert.equal(l.taskId, "kid");
  assert.equal(l.kind, "unrouted");
  assert.equal(l.workerTier, "T1");
  assert.equal(l.workerEffort, "high");
  assert.equal(l.sessionId, "s-kid");
  assert.equal(l.parentSessionId, "s-main");
  assert.ok(l.reasons.includes("routing off"));
});

test("routing=false: Qwen logs as tier qwen, an unknown model by its name; verdict and unjudged work", async () => {
  const h = rig();
  spawned(h, "qk", "s-qk");
  assert.equal(h.lines()[0].workerTier, "qwen");
  h.a.agents.push(agent("odd", "s-odd", "vendor/other-model"));
  spawned(h, "odd", "s-odd");
  assert.equal(h.lines()[1].workerTier, "vendor/other-model");
  spawned(h, "kid", "s-kid");
  const r = await h.f.callTool("task_verdict", { name: "kid", verdict: "accepted", note: "ok" });
  assert.ok(!r.isError, r.content[0].text);
  h.a.emit({ type: "kill", name: "kid", ts: 1 });
  h.a.emit({ type: "kill", name: "qk", ts: 1 });
  const ev = h.lines().map((l) => `${l.event}:${l.taskId}:${l.verdict ?? ""}`);
  assert.deepEqual(ev, ["spawn:qk:", "spawn:odd:", "spawn:kid:", "verdict:kid:accepted", "verdict:qk:unjudged"]);
});

test("routing=true: a spawn event the policy never saw is still not logged (unchanged)", () => {
  const h = rig({});
  spawned(h, "kid", "s-kid");
  assert.deepEqual(h.lines(), []);
});

test("routing=false: the engine's own spawn event for main (it registers itself) is not a task", () => {
  const h = rig();
  h.a.emit({ type: "spawn", name: "main", by: "main", parent: "main", childSessionId: "s-main", ts: 0 });
  assert.deepEqual(h.lines(), []);
});
