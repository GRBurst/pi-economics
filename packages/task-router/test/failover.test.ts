import { test } from "node:test";
import assert from "node:assert/strict";
import { accepted, card, harness } from "./harness.ts";

const SONNET = "anthropic/claude-sonnet-5-5";
const LOCAL = "llama/qwen3.8";
const CLOUD = "openrouter/qwen/qwen3.8-27b:free";
const PILOT =
  '429: {"message":"Rate limit exceeded: free-models-per-day-high-balance. ","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"1000","X-RateLimit-Remaining":"0","X-RateLimit-Reset":"1790985600000"},"limit_source":"openrouter_free_tier_daily"}}';

const err = (name: string, reason: string) => ({ type: "error" as const, name, reason, ts: 1 });
const settle = () => new Promise((r) => setImmediate(r));
async function spawnAll(h: ReturnType<typeof harness>, names: string[], t = card()) {
  for (const n of names) accepted(await h.a.spawn({ name: n, task: t }));
}
const reroutes = (h: ReturnType<typeof harness>) => h.lines().filter((l) => l.event === "reroute");

test("terminal error on a cloud Qwen child → Sonnet (xhigh→high), send continue, log reroute; attempts unchanged", async () => {
  const h = harness();
  await spawnAll(h, ["q1"]);
  h.a.emit(err("q1", "retries exhausted"));
  await settle();
  assert.deepEqual(h.a.retunes, [{ name: "q1", model: SONNET, thinkingLevel: "high" }]);
  assert.deepEqual(h.a.sent, [{ to: "q1", text: "continue", from: "router" }]);
  const [r] = reroutes(h);
  assert.deepEqual([r.taskId, r.from, r.to], ["q1", "cloud", "T1"]);
  assert.match(r.reason, /retries exhausted/);
  // a re-spawn with attemptOf still escalates from qwen (the failover did not spend an attempt)
  const b = accepted(await h.a.spawn({ name: "q1b", task: card({ attemptOf: "q1" }) })) as any;
  assert.equal(b.model, SONNET);
  assert.equal(b.thinkingLevel, "high");
});

test("local child → cloud next; Sonnet and Opus children → nothing (no jump to more quota on the same provider)", async () => {
  const h = harness();
  await spawnAll(h, ["q1", "q2"]); // cloud, local
  h.a.emit(err("q2", "boom"));
  await settle();
  assert.deepEqual(h.a.retunes, [{ name: "q2", model: CLOUD, thinkingLevel: "xhigh" }]);
  const t1 = card({ t0: { ...card().t0, linear: false } });
  await spawnAll(h, ["s1"], t1);
  h.a.emit(err("s1", "overloaded"));
  await settle();
  assert.equal(h.a.retunes.length, 1);
  assert.deepEqual(reroutes(h).map((r) => r.taskId), ["q2"]);
  await spawnAll(h, ["o1"], card({ t2: ["security"] }));
  const n = h.a.retunes.length;
  h.a.emit(err("o1", "overloaded"));
  await settle();
  assert.equal(h.a.retunes.length, n);
});

test("autoEscalate=false → no failover; unknown child ignored", async () => {
  const h = harness({ settings: { autoEscalate: false } });
  await spawnAll(h, ["q1"]);
  h.a.emit(err("q1", "x"));
  h.a.emit(err("nobody", "x"));
  await settle();
  assert.deepEqual(h.a.retunes, []);
});

test("free cap: block the cloud at once, move every cloud child per the chain, log free-cap, route new spawns away until reset", async () => {
  const h = harness();
  await spawnAll(h, ["q1", "q2", "q3"]); // cloud, local, cloud
  h.a.emit(err("q1", PILOT));
  await settle();
  // local is taken by q2 → both cloud children go to Sonnet
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model, r.thinkingLevel]), [["q1", SONNET, "high"], ["q3", SONNET, "high"]]);
  assert.deepEqual(h.a.sent.map((s) => [s.to, s.text]), [["q1", "continue"], ["q3", "continue"]]);
  assert.deepEqual(reroutes(h).map((r) => [r.taskId, r.reason]), [["q1", "free-cap"], ["q3", "free-cap"]]);
  // the same error text arriving from q3 later changes nothing
  h.a.emit(err("q3", PILOT));
  await settle();
  assert.equal(h.a.retunes.length, 2);
  // new spawn: cloud blocked, local busy → Sonnet
  const q4 = accepted(await h.a.spawn({ name: "q4", task: card() })) as any;
  assert.equal(q4.model, SONNET);
  // after the reset the cloud is back
  h.clock.t = 1790985600000 + 1;
  h.a.agents.push(...["q1", "q3", "q4"].map((name) => ({ name, parent: "main", sessionId: name, model: "x", thinkingLevel: "high" as const, state: "idle" as const })));
  const q5 = accepted(await h.a.spawn({ name: "q5", task: card() })) as any;
  assert.equal(q5.model, CLOUD);
});

test("free cap with a free local slot: the erroring child goes local, the other cloud child to Sonnet", async () => {
  const h = harness();
  await spawnAll(h, ["q1", "q2", "q3"]); // cloud, local, cloud
  for (const [name, state] of [["q1", "running"], ["q2", "idle"], ["q3", "running"]] as const) {
    h.a.agents.push({ name, parent: "main", sessionId: name, model: "x", thinkingLevel: "xhigh", state });
  }
  h.a.emit(err("q1", PILOT));
  await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", LOCAL], ["q3", SONNET]]);
});

test("review m2: a free-cap move toward a blank Sonnet fails soft: no reroute, no unhandled rejection", async () => {
  const h = harness({ settings: { models: { sonnet: { model: "" } } } as any });
  await spawnAll(h, ["q1", "q2"]); // cloud, local
  const lost: unknown[] = [];
  const onLost = (e: unknown) => void lost.push(e);
  process.on("unhandledRejection", onLost);
  try {
    h.a.emit(err("q1", PILOT));
    await settle(); await settle();
  } finally { process.off("unhandledRejection", onLost); }
  assert.deepEqual(lost, []);
  assert.deepEqual(h.a.retunes, []);
  assert.deepEqual(reroutes(h), []);
});
