// T5.1: every test here runs on the today fixture (base today): failover is characterized on the free cloud, which the defaults
// drop at T5.4 (D3); the defaults' failover (local error → Haiku) is T5.5's case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accepted, card, harness } from "./harness.ts";
import { defaults } from "../core/settings.ts";

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
  const h = harness({ base: "today", health: { health: 503, slots: 200 } }); // local down: Sonnet stays the target (D8)
  await spawnAll(h, ["q1"]);
  h.a.emit(err("q1", "retries exhausted"));
  await settle();
  assert.deepEqual(h.a.retunes, [{ name: "q1", model: SONNET, thinkingLevel: "high" }]);
  assert.deepEqual(h.a.sent, [{ to: "q1", text: "continue", from: "router" }]);
  const [r] = reroutes(h);
  assert.deepEqual([r.taskId, r.from, r.to], ["q1", "cloud", "T1"]);
  assert.deepEqual([r.fromModel, r.toModel], [CLOUD, SONNET]); // T4.3: the reroute line carries the models
  assert.match(r.reason, /retries exhausted/);
  // a re-spawn with attemptOf still escalates from qwen (the failover did not spend an attempt)
  const b = accepted(await h.a.spawn({ name: "q1b", task: card({ attemptOf: "q1" }) })) as any;
  assert.equal(b.model, SONNET);
  assert.equal(b.thinkingLevel, "high");
});

test("local child → cloud next; Sonnet and Opus children → nothing (no jump to more quota on the same provider)", async () => {
  const h = harness({ base: "today" });
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
  const h = harness({ base: "today", settings: { autoEscalate: false } });
  await spawnAll(h, ["q1"]);
  h.a.emit(err("q1", "x"));
  h.a.emit(err("nobody", "x"));
  await settle();
  assert.deepEqual(h.a.retunes, []);
});

test("free cap: block the cloud at once, move every cloud child, log free-cap; new spawns wait for the busy local, then Sonnet, until reset", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 10 } });
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
  const h = harness({ base: "today" });
  await spawnAll(h, ["q1", "q2", "q3"]); // cloud, cloud, local
  listAs(h, { q1: "running", q2: "running", q3: "idle" });
  h.clock.t += 61_000; // the reservation of q3 ends: the local slot is free
  h.a.emit(err("q1", PILOT));
  await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", LOCAL], ["q2", SONNET]]); // the local slot is q1's now
});

test("review m2: a free-cap move with only blank or down members left fails soft: no reroute, no unhandled rejection", async () => {
  const h = harness({ base: "today", settings: { models: { sonnet: { model: "" }, opus: { model: "" } } } as any, health: { health: 0, slots: 0 } });
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

// --- failover reserves before retune (HP T3.7: spec §4.8, RD5, AC3) ------------------------------------------------------
const warnings = async (fn: () => Promise<void>) => {
  const warned: string[] = [], orig = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.join(" "));
  try { await fn(); } finally { console.warn = orig; }
  return warned;
};
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };

test("slow retune: a spawn during the await retune sees the target taken", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  await spawnAll(h, ["q0", "q1"]); // cloud, cloud: its two slots
  listAs(h, { q0: "running", q1: "running" });
  const g = gate();
  h.a.control.gate = g.p;
  h.a.emit(err("q1", "retries exhausted")); // target: the free local slot
  await settle();
  const q2 = accepted(await h.a.spawn({ name: "q2", task: card() })) as any; // during the await retune
  assert.equal(q2.model, CLOUD); // the slot q1 left, never q1's target
  g.open();
  await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", LOCAL]]);
  assert.deepEqual(reroutes(h).map((r) => [r.taskId, r.from, r.to]), [["q1", "cloud", "local"]]);
});

// RG2 (review-g3 Medium 2): an errored child is listed `idle`, so only the move's reservation (not the listing) holds the
// target's slot while the retune is in flight (RD5, AC3 for moves).
test("slow retune of an idle-listed child: its reservation holds the target; a spawn during the await does not take it", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  await spawnAll(h, ["q0", "q1"]); // cloud, cloud: its two slots
  h.clock.t += 61_000; // the spawn reservations have ended
  listAs(h, { q0: "running", q1: "idle" });
  const g = gate();
  h.a.control.gate = g.p;
  h.a.emit(err("q1", "retries exhausted")); // target: the free local slot
  await settle();
  const q2 = accepted(await h.a.spawn({ name: "q2", task: card() })) as any; // the cloud slot q1 left
  const q3 = accepted(await h.a.spawn({ name: "q3", task: card() })) as any; // local is q1's: neither Qwen slot
  g.open();
  await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", LOCAL]]);
  assert.deepEqual([q2.model, q3.model], [CLOUD, SONNET]);
});

// RG4 (review-g3 Low 2): `prev` is the pending marker (spec §4.8). A second error while the retune is in flight comes from
// the provider being left, not from the target the entry already names: it starts no second move.
test("a second error during an in-flight retune starts no second move (no move back to the failed provider)", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  await spawnAll(h, ["q0", "q1"]); // cloud, cloud: its two slots
  listAs(h, { q0: "running", q1: "running" });
  const g = gate();
  h.a.control.gate = g.p;
  h.a.emit(err("q1", "retries exhausted")); // q1 → local, retune in flight
  await settle();
  h.a.emit(err("q1", "retries exhausted")); // the same failure, seen again before the retune took effect
  await settle();
  g.open();
  await settle(); await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", LOCAL]]);
  assert.deepEqual(reroutes(h).map((r) => [r.taskId, r.from, r.to]), [["q1", "cloud", "local"]]);
});

// RG5 (review-g4 Medium 1): the pending marker is read twice, at the start of a move (before its candidates are taken from the
// entry) and after its probes (an error that arrives while the first move probes). Probes here are gated through `fetch`.
const slowFetch = () => {
  const ctl: { gate?: Promise<void> } = {};
  return { ctl, fetch: async (_url: string) => { await ctl.gate; return { status: 200 }; } };
};

test("RG5: a duplicate error whose probe outlasts the first move's retune starts no second move (the check before the probes)", async () => {
  const f = slowFetch();
  const h = harness({ base: "today", settings: { queueMaxSec: 0 }, extra: { fetch: f.fetch } as never });
  await spawnAll(h, ["q0", "q1", "q2"]); // cloud, cloud, local
  listAs(h, { q0: "running", q1: "running", q2: "running" });
  h.clock.t += 61_000; // the spawn reservations and the probe cache have expired
  listAs(h, { q0: "idle" }); // a cloud slot is free
  const rg = gate();
  h.a.control.gate = rg.p;
  h.a.emit(err("q2", "retries exhausted")); // q2: local → cloud (no probe: the cloud has no health URL)
  await settle(); await settle();
  const fg = gate();
  f.ctl.gate = fg.p; // the next probe is slow
  h.a.emit(err("q2", "retries exhausted")); // the same failure again: without the early check it would probe local
  await settle();
  rg.open(); await settle(); await settle(); // the first move completes: its marker is gone
  fg.open(); await settle(); await settle(); await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q2", CLOUD]]);
  assert.deepEqual(reroutes(h).map((r) => [r.taskId, r.from, r.to]), [["q2", "local", "cloud"]]);
});

test("RG5: a duplicate error during the first move's probes starts no second move (the check after the probes)", async () => {
  const f = slowFetch();
  const h = harness({ base: "today", settings: { queueMaxSec: 0 }, extra: { fetch: f.fetch } as never });
  await spawnAll(h, ["q0", "q1"]); // cloud, cloud
  listAs(h, { q0: "running", q1: "running" });
  h.clock.t += 31_000; // the probe cache has expired
  const fg = gate(), rg = gate();
  f.ctl.gate = fg.p;
  h.a.control.gate = rg.p;
  h.a.emit(err("q1", "retries exhausted")); // the first move probes local
  await settle();
  h.a.emit(err("q1", "retries exhausted")); // during those probes: neither move has written its marker yet
  await settle();
  fg.open(); await settle(); await settle(); await settle();
  rg.open(); await settle(); await settle(); await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", LOCAL]]);
});

// RG8 (review-g4 Low 1): the marker counts as pending only while the move's reservation runs (PENDING_MS), so a retune that
// never settles does not keep every later error from moving the child.
test("RG8: a retune that never settles: an error after the move's reservation has ended moves the child again", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  await spawnAll(h, ["q0", "q1"]); // cloud, cloud
  listAs(h, { q0: "running", q1: "running" });
  h.a.control.gate = new Promise(() => {}); // never resolves
  h.a.emit(err("q1", "retries exhausted")); // q1 → local, stuck in retune
  await settle(); await settle();
  h.a.control.gate = undefined; // later retunes work
  h.clock.t += 30_000; // within the move's reservation: still pending
  h.a.emit(err("q1", "retries exhausted"));
  await settle(); await settle();
  assert.equal(h.a.retunes.length, 0); // (not deepEqual: it would narrow `retunes` to never[] below)
  h.clock.t += 3_600_000; // an hour later, a real error
  h.a.emit(err("q1", "retries exhausted"));
  await settle(); await settle(); await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", CLOUD]]);
  assert.deepEqual(reroutes(h).map((r) => [r.taskId, r.from, r.to]), [["q1", "local", "cloud"]]);
});

test("retune throws → entry restored, the target's slot free at once, one warning, no reroute line", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  await spawnAll(h, ["q0", "q1"]); // cloud, cloud: its two slots
  listAs(h, { q0: "running", q1: "running" });
  h.a.control.fail = new Error("no such agent");
  const warned = await warnings(async () => { h.a.emit(err("q1", "retries exhausted")); await settle(); await settle(); });
  delete h.a.control.fail;
  assert.equal(warned.length, 1, warned.join("\n"));
  assert.match(warned[0], /reroute of q1 failed: no such agent/);
  assert.deepEqual(reroutes(h), []);
  assert.equal((accepted(await h.a.spawn({ name: "q2", task: card() })) as any).model, LOCAL); // the target's slot is free
  // q1 is back on the cloud: its two slots are full, the local slot is q2's
  assert.equal((accepted(await h.a.spawn({ name: "q3", task: card() })) as any).model, SONNET);
});

// RG7 (review-g4 Low 2, plant MD): only a completed move changes where the attempt runs (`ranMember`, D9).
test("RG7: retune throws → the attempt still ran on the cloud: its re-spawn escalates from cloud, not from the target", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  await spawnAll(h, ["q0", "q1"]); // cloud, cloud
  listAs(h, { q0: "running", q1: "running" });
  h.a.control.fail = new Error("no such agent");
  await warnings(async () => { h.a.emit(err("q1", "retries exhausted")); await settle(); await settle(); }); // target: local
  delete h.a.control.fail;
  h.a.emit({ type: "kill", name: "q1", ts: 2 });
  accepted(await h.a.spawn({ name: "q1b", task: card({ attemptOf: "q1" }) }));
  h.a.emit({ type: "spawn", name: "q1b", by: "main", parent: "main", childSessionId: "s-q1b", ts: 3 });
  const l = h.lines().find((x) => x.event === "escalate")!;
  assert.deepEqual([l.from, l.fromModel], ["cloud", CLOUD]);
});

test("P-slots with a move and two spawns in flight", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  await spawnAll(h, ["q1"]); // cloud
  listAs(h, { q1: "running" });
  const g = gate();
  h.a.control.gate = g.p;
  h.a.emit(err("q1", "retries exhausted")); // q1 → local, retune in flight
  await settle();
  const spawns = Promise.all(["q2", "q3"].map((n) => h.a.spawn({ name: n, task: card() })));
  g.open();
  const models = [LOCAL, ...(await spawns).map((r) => (accepted(r) as any).model)]; // q1 now runs on local
  await settle();
  const on = (m: string) => models.filter((x) => x === m).length;
  assert.ok(on(LOCAL) <= 1 && on(CLOUD) <= 2, models.join());
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", LOCAL]]);
});

// RG1 (review-g3 Medium 1, S8): the pinned failover filter compares levels on the plan's capped settings (capToTable), as
// acceptModel and the selection do (G2 M2(b)): on a short custom table an explicit Opus is capped to the table's top, so a
// second-provider member at that level is a failover target.
test("RG1 S8: an explicit Opus on a short custom read table fails over to a second-provider member at the capped level", async () => {
  const OPUS = "anthropic/claude-opus-5-5";
  const sonnet2 = {
    model: "openrouter/anthropic/claude-sonnet", tier: "T1", route: "T1b", abilities: { write: 1, read: 2 },
    efforts: ["high", "xhigh"], contextWindow: 1000000, cost: 3, order: 1,
  };
  const mine = structuredClone(defaults().importanceTable.write); // rows 0–2: read is capped at 2
  const h = harness({ base: "today", settings: { importanceTable: { mine }, profiles: { x: { ability: "read", table: "mine" } }, models: { sonnet2 } } as any });
  assert.equal((accepted(await h.a.spawn({ name: "x1", model: OPUS, task: card({ kind: "x", t2: ["security"] }) })) as any).model, OPUS);
  listAs(h, { x1: "running" });
  h.a.emit(err("x1", "overloaded"));
  await settle(); await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["x1", sonnet2.model]]);
});
