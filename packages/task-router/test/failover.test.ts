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
const listAs = (h: ReturnType<typeof harness>, states: Record<string, "running" | "idle">) => {
  for (const [name, state] of Object.entries(states)) {
    const x = h.a.agents.find((a) => a.name === name);
    if (x) x.state = state;
    else h.a.agents.push({ name, parent: "main", sessionId: name, model: "x", thinkingLevel: "xhigh", state });
  }
};

test("terminal error on a cloud Qwen child, local unavailable → Sonnet (xhigh→high), send continue, log reroute; attempts unchanged", async () => {
  const h = harness({ health: { health: 503, slots: 200 } }); // local down: Sonnet stays the target (D8)
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
  await spawnAll(h, ["q1", "q2", "q3"]); // cloud, cloud, local
  listAs(h, { q1: "idle", q2: "running", q3: "running" });
  h.clock.t += 61_000; // the reservation of q1 ends: one cloud slot free
  h.a.emit(err("q3", "boom"));
  await settle();
  assert.deepEqual(h.a.retunes, [{ name: "q3", model: CLOUD, thinkingLevel: "xhigh" }]);
  const t1 = card({ t0: { ...card().t0, linear: false } });
  await spawnAll(h, ["s1"], t1);
  h.a.emit(err("s1", "overloaded"));
  await settle();
  assert.equal(h.a.retunes.length, 1);
  assert.deepEqual(reroutes(h).map((r) => r.taskId), ["q3"]);
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

test("free cap: block the cloud at once, move every cloud child, log free-cap; new spawns wait for the busy local, then Sonnet, until reset", async () => {
  const h = harness({ settings: { queueMaxSec: 10 } });
  await spawnAll(h, ["q1", "q2", "q3"]); // cloud, cloud, local
  listAs(h, { q3: "running" });
  h.a.emit(err("q1", PILOT));
  await settle();
  // local is taken by q3 → both cloud children go to Sonnet
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model, r.thinkingLevel]), [["q1", SONNET, "high"], ["q2", SONNET, "high"]]);
  assert.deepEqual(h.a.sent.map((s) => [s.to, s.text]), [["q1", "continue"], ["q2", "continue"]]);
  assert.deepEqual(reroutes(h).map((r) => [r.taskId, r.reason]), [["q1", "free-cap"], ["q2", "free-cap"]]);
  // the same error text arriving from q2, now on Sonnet, changes nothing
  h.a.emit(err("q2", PILOT));
  await settle();
  assert.equal(h.a.retunes.length, 2);
  // new spawn: cloud blocked, local busy → waits queueMaxSec for the local slot (D5), then Sonnet
  const q4 = accepted(await h.a.spawn({ name: "q4", task: card() })) as any;
  assert.equal(q4.model, SONNET);
  assert.ok(h.sleeps.reduce((a, b) => a + b, 0) >= 10_000);
  // after the reset the cloud is back
  h.clock.t = 1790985600000 + 1;
  listAs(h, { q3: "idle" });
  const q5 = accepted(await h.a.spawn({ name: "q5", task: card() })) as any;
  assert.equal(q5.model, CLOUD);
});

test("free cap with a free local slot: the erroring child goes local, the other cloud child to Sonnet", async () => {
  const h = harness();
  await spawnAll(h, ["q1", "q2", "q3"]); // cloud, cloud, local
  listAs(h, { q1: "running", q2: "running", q3: "idle" });
  h.clock.t += 61_000; // the reservation of q3 ends: the local slot is free
  h.a.emit(err("q1", PILOT));
  await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", LOCAL], ["q2", SONNET]]); // the local slot is q1's now
});

test("review m2: a free-cap move with only blank or down members left fails soft: no reroute, no unhandled rejection", async () => {
  const h = harness({ settings: { models: { sonnet: { model: "" }, opus: { model: "" } } } as any, health: { health: 0, slots: 0 } });
  await spawnAll(h, ["q1", "q2"]); // cloud, cloud
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

// --- targets on members (HP T3.4): other provider, free now, no wait; the free cap is OpenRouter's (D8, MP2, r2 L2, L6) -------

test("cloud error, local free → LOCAL xhigh (D8)", async () => {
  const h = harness({ base: "today" });
  await spawnAll(h, ["q1"]); // cloud
  h.a.emit(err("q1", "retries exhausted"));
  await settle();
  assert.deepEqual(h.a.retunes, [{ name: "q1", model: LOCAL, thinkingLevel: "xhigh" }]);
  assert.deepEqual(reroutes(h).map((r) => [r.taskId, r.from, r.to]), [["q1", "cloud", "local"]]);
});

test("stale cap text on a Sonnet child changes nothing: no block, no move", async () => {
  const h = harness({ base: "today" });
  const t1 = card({ t0: { ...card().t0, linear: false } });
  await spawnAll(h, ["s1"], t1);
  h.a.emit(err("s1", PILOT));
  await settle();
  assert.deepEqual(h.a.retunes, []);
  assert.deepEqual(reroutes(h), []);
  assert.equal((accepted(await h.a.spawn({ name: "s2", task: t1 })) as any).model, SONNET); // Sonnet is not blocked
  assert.equal((accepted(await h.a.spawn({ name: "q1", task: card() })) as any).model, CLOUD); // nor the free cloud
});

test("a blank member is no target: a blank Sonnet is skipped, the cloud child moves to Opus; never model \"\"", async () => {
  const h = harness({ base: "today", settings: { models: { sonnet: { model: "" } } } as any, health: { health: 0, slots: 0 } });
  await spawnAll(h, ["q1"]); // cloud
  h.a.emit(err("q1", "retries exhausted"));
  await settle();
  assert.deepEqual(h.a.retunes, [{ name: "q1", model: "anthropic/claude-opus-5-5", thinkingLevel: "high" }]);
});

test("an uncapped OpenRouter member is blocked and its children move", async () => {
  const cloud2 = {
    model: "openrouter/qwen/other:free", tier: "qwen", route: "cloud", provider: "openrouter", abilities: { write: 0, read: 0 },
    efforts: ["xhigh"], contextWindow: 262144, cost: 0, order: -2, slots: 1,
  };
  const h = harness({ base: "today", settings: { models: { "qwen-cloud2": cloud2 } } as any });
  assert.equal((accepted(await h.a.spawn({ name: "q1", task: card() })) as any).model, cloud2.model);
  h.a.emit(err("q1", PILOT));
  await settle();
  // the other OpenRouter member shares the provider, so it is no target: q1 → LOCAL
  assert.deepEqual(h.a.retunes, [{ name: "q1", model: LOCAL, thinkingLevel: "xhigh" }]);
  assert.equal((accepted(await h.a.spawn({ name: "q2", task: card() })) as any).model, CLOUD); // qwen-cloud2 is blocked
});

test("a Haiku child whose files Qwen cannot hold does not move to LOCAL (P-ctx for failover targets)", async () => {
  const HAIKU = "anthropic/claude-haiku-4-5";
  const h = harness({
    base: "today", settings: { models: { haiku: { model: HAIKU }, "qwen-cloud": { model: "" } }, contextFit: 1 } as any,
    extra: { fs: { exists: (p: string) => p.startsWith("/work/src/"), size: () => 1_800_000, isDir: (p: string) => p === "/work" || p.startsWith("/work/src") } },
  });
  const r = accepted(await h.a.spawn({ name: "k1", task: card() })) as any;
  assert.equal(r.model, HAIKU); // ~500k tokens: Haiku, Sonnet, Opus hold them; local (262k) does not
  h.a.emit(err("k1", "overloaded"));
  await settle();
  assert.deepEqual(h.a.retunes, []);
  assert.deepEqual(reroutes(h), []);
});
