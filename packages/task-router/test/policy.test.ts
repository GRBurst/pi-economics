import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accepted, card, harness } from "./harness.ts";

const CLOUD = "openrouter/qwen/qwen3.8-27b:free";
const LOCAL = "llama/qwen3.8";
const SONNET = "anthropic/claude-sonnet-5-5";

test("registers the spawn policy at install", () => {
  const h = harness();
  assert.ok(h.a.hasPolicy());
});

test("no task card → reject that tells the parent what to pass", async () => {
  const r = await harness().a.spawn({ name: "q1" });
  assert.ok("reject" in r);
  assert.match(r.reject, /task card/i);
  assert.match(r.reject, /kind.*files.*acceptance/s);
});

test("invalid card and unknown kind → reject naming the problem", async () => {
  const h = harness();
  const bad = await h.a.spawn({ name: "q1", task: { kind: "implement" } });
  assert.ok("reject" in bad);
  assert.match(bad.reject, /files: missing/);
  const unk = await h.a.spawn({ name: "q2", task: card({ kind: "nope" }) });
  assert.ok("reject" in unk);
  assert.match(unk.reject, /unknown kind "nope"/);
});

test("all-T0 card → free cloud Qwen at xhigh, brief skips the handshake", async () => {
  const h = harness({ base: "today" });
  const r = accepted(await h.a.spawn({ name: "q1", task: card() }));
  assert.equal((r as any).model, CLOUD);
  assert.equal((r as any).thinkingLevel, "xhigh");
  assert.match((r as any).briefAppend, /Start immediately/);
});

test("card that is not T0 → Sonnet high; T2 trigger → Opus high", async () => {
  const h = harness();
  const t1 = accepted(await h.a.spawn({ name: "s1", task: card({ t0: { ...card().t0, linear: false } }) })) as any;
  assert.deepEqual([t1.model, t1.thinkingLevel], ["anthropic/claude-sonnet-5-5", "high"]);
  const t2 = accepted(await h.a.spawn({ name: "o1", task: card({ t2: ["security"] }) })) as any;
  assert.deepEqual([t2.model, t2.thinkingLevel], ["anthropic/claude-opus-5-5", "high"]);
});

test("explicit lower model is rejected with the routed reasons", async () => {
  const h = harness();
  const r = await h.a.spawn({ name: "o1", model: "anthropic/claude-sonnet-5-5", task: card({ t2: ["security"] }) });
  assert.ok("reject" in r);
  assert.match(r.reject, /below the routed T2/);
});

const listAs = (h: ReturnType<typeof harness>, states: Record<string, "running" | "idle">) => {
  for (const [name, state] of Object.entries(states)) {
    const x = h.a.agents.find((a) => a.name === name);
    if (x) x.state = state;
    else h.a.agents.push({ name, parent: "main", sessionId: name, model: "x", thinkingLevel: "xhigh", state });
  }
};

// D4 (HP T3.4): cost order, the free cloud's 2 slots, no interleave; a busy cheapest pool is waited for, then Sonnet at its step.
test("selection: cloud, cloud (its 2 slots), then local; a fourth waits queueMaxSec, then Sonnet high", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 10 } });
  const models: string[] = [];
  for (const n of ["q1", "q2", "q3"]) models.push((accepted(await h.a.spawn({ name: n, task: card() })) as any).model);
  assert.deepEqual(models, [CLOUD, CLOUD, LOCAL]);
  assert.equal(h.sleeps.length, 0);
  const q4 = accepted(await h.a.spawn({ name: "q4", task: card() })) as any;
  assert.equal(q4.model, "anthropic/claude-sonnet-5-5");
  assert.equal(q4.thinkingLevel, "high"); // Sonnet's effort at the leg's step 0
  assert.ok(h.sleeps.reduce((a, b) => a + b, 0) >= 10_000);
});

// mi11: a reservation holds 60 s whether the child is listed or not, so the idle local child frees its slot only then.
test("a queued spawn proceeds when the local child goes idle and its reservation ends", async () => {
  const h = harness({ base: "today" });
  for (const n of ["q1", "q2", "q3"]) await h.a.spawn({ name: n, task: card() }); // cloud, cloud, local
  listAs(h, { q1: "running", q2: "running", q3: "running" });
  h.hooks.onSleep = () => listAs(h, { q3: "idle" });
  const q4 = accepted(await h.a.spawn({ name: "q4", task: card() })) as any;
  assert.equal(q4.model, LOCAL);
  assert.ok(h.sleeps.reduce((a, b) => a + b, 0) >= 60_000);
});

test("health probe: local down → no local route; result cached 30 s", async () => {
  const h = harness({ base: "today", health: { health: 503, slots: 200 } });
  const a = accepted(await h.a.spawn({ name: "q1", task: card() })) as any;
  const b = accepted(await h.a.spawn({ name: "q2", task: card() })) as any;
  assert.deepEqual([a.model, b.model], [CLOUD, CLOUD]);
  assert.deepEqual(h.urls, ["http://earth:11545/health"]); // one probe for both spawns
  listAs(h, { q1: "idle", q2: "idle" });
  h.clock.t += 61_000;
  assert.equal((accepted(await h.a.spawn({ name: "q3", task: card() })) as any).model, CLOUD);
  assert.equal(h.urls.length, 2); // the TTL itself: health.test.ts
});

test("health probe: busy slot (503) or unreachable host is not available; 404/501 is unknown = available", async () => {
  const first = async (health: any) => {
    const h = harness({ base: "today", settings: { models: { "qwen-cloud": { model: "" } }, queueMaxSec: 0 } as any, health });
    return (accepted(await h.a.spawn({ name: "q1", task: card() })) as any).model;
  };
  assert.equal(await first({ health: 200, slots: 503 }), SONNET);
  assert.equal(await first({ health: 0, slots: 0 }), SONNET);
  assert.equal(await first({ health: 200, slots: 404 }), LOCAL);
  assert.equal(await first({ health: 200, slots: 501 }), LOCAL);
});

test("our own running local child: with the slot busy, a free cloud slot is taken at once", async () => {
  const h = harness({ base: "today", health: { health: 200, slots: 200 } });
  for (const n of ["q1", "q2", "q3"]) await h.a.spawn({ name: n, task: card() }); // cloud, cloud, local
  listAs(h, { q1: "idle", q2: "running", q3: "running" });
  h.clock.t += 61_000;
  h.health.slots = 503; // our local child occupies the slot
  const q4 = accepted(await h.a.spawn({ name: "q4", task: card() })) as any;
  assert.equal(q4.model, CLOUD);
  assert.equal(h.sleeps.length, 0);
});

test("spawn event logs the routed plan with reasons and the child's session id", async () => {
  const h = harness({ base: "today" });
  await h.a.spawn({ name: "q1", task: card() }, { policyMeta: undefined });
  h.a.emit({ type: "spawn", name: "q1", by: "main", parent: "main", childSessionId: "s-q1", ts: 1 });
  const [e] = h.lines();
  assert.equal(e.event, "spawn");
  assert.equal(e.taskId, "q1");
  assert.equal(e.sessionId, "s-q1");
  assert.equal(e.parentSessionId, "s-main");
  assert.equal(e.workerTier, "qwen");
  assert.ok((e.reasons as string[]).some((r) => /all t0 criteria hold/.test(r)));
  assert.ok((e.reasons as string[]).some((r) => /cloud/.test(r)));
});

test("meta carries the importance for the child's own spawns", async () => {
  const h = harness();
  const r = accepted(await h.a.spawn({ name: "q1", task: card({ importance: "high" }) })) as any;
  assert.equal(r.meta.importance, "high");
  const child = accepted(await h.a.spawn({ name: "q1a", task: card() }, { name: "q1", policyMeta: r.meta })) as any;
  assert.equal(child.meta.importance, "high"); // parent importance propagates (P-imp: max of sources)
});

test("respawn with attemptOf escalates one tier; a second retry at the same tier is rejected", async () => {
  const h = harness();
  await h.a.spawn({ name: "q1", task: card() });
  const r2 = accepted(await h.a.spawn({ name: "q1b", task: card({ attemptOf: "q1" }) })) as any;
  assert.equal(r2.model, "anthropic/claude-sonnet-5-5");
  const r3 = await h.a.spawn({ name: "q1c", task: card({ attemptOf: "q1b" }) });
  accepted(r3); // → T2
  const r4 = await h.a.spawn({ name: "q1d", task: card({ attemptOf: "q1c" }) });
  accepted(r4); // one retry at T2 allowed
  const r5 = await h.a.spawn({ name: "q1e", task: card({ attemptOf: "q1d" }) });
  assert.ok("reject" in r5);
});

test("routing=false → inherits the caller's model and effort", async () => {
  const h = harness({ settings: { routing: false } });
  const r = accepted(await h.a.spawn({ name: "q1" })) as any;
  assert.deepEqual([r.model, r.thinkingLevel], ["anthropic/claude-opus-5-5", "high"]);
});

test("kill without a verdict is logged unjudged; a respawn with attemptOf logs escalate", async () => {
  const h = harness();
  await h.a.spawn({ name: "q1", task: card() });
  h.a.emit({ type: "spawn", name: "q1", by: "main", parent: "main", childSessionId: "s1", ts: 1 });
  await h.a.spawn({ name: "q1b", task: card({ attemptOf: "q1" }) });
  h.a.emit({ type: "spawn", name: "q1b", by: "main", parent: "main", childSessionId: "s2", ts: 2 });
  h.a.emit({ type: "kill", name: "q1", ts: 3 });
  const ev = h.lines().map((l) => [l.event, l.taskId, l.verdict ?? l.to]);
  assert.deepEqual(ev, [["spawn", "q1", undefined], ["spawn", "q1b", undefined], ["escalate", "q1b", "T1"], ["verdict", "q1", "unjudged"]]);
});

test("profile skills are inlined from the skills pi reports at before_agent_start; unknown skill → reject", async () => {
  const h = harness();
  const dir = mkdtempSync(join(tmpdir(), "task-router-skill-"));
  writeFileSync(join(dir, "SKILL.md"), "SKILL BODY");
  const t = card({ kind: "debug-design" });
  const none = await h.a.spawn({ name: "d1", task: t });
  assert.ok("reject" in none);
  assert.match(none.reject, /unknown skill "systematic-debugging"/);
  h.f.fire("before_agent_start", { systemPromptOptions: { skills: [{ name: "systematic-debugging", filePath: join(dir, "SKILL.md"), baseDir: dir }] } }, {});
  const r = accepted(await h.a.spawn({ name: "d2", task: t })) as any;
  assert.match(r.briefAppend, /^<skill name="systematic-debugging"/);
  assert.match(r.briefAppend, /SKILL BODY/);
  assert.match(r.briefAppend, /Skill approval gates/);
  assert.equal(r.model, "anthropic/claude-sonnet-5-5"); // minTier T1
});

test("API that appears after install is picked up at session_start; shutdown unregisters so a reload can register again", async () => {
  const { fakeApi } = await import("./fake-api.ts");
  const { fakePi } = await import("./fake-pi.ts");
  const { install } = await import("../core/shell.ts");
  const a = fakeApi();
  let present = false;
  const f = fakePi();
  install(f.pi, { agentDir: mkdtempSync(join(tmpdir(), "task-router-late-")), api: () => (present ? a.api : undefined) });
  assert.ok(!a.hasPolicy());
  present = true;
  f.fire("session_start", {}, {});
  assert.ok(a.hasPolicy());
  f.fire("session_shutdown", {}, {});
  assert.ok(!a.hasPolicy());
  f.fire("session_start", {}, {});
  assert.ok(a.hasPolicy());
});

test("a chain fallback to Sonnet is member `sonnet`: its turns count nothing and its guard reads Sonnet's window", async () => {
  const h = harness({ base: "today", settings: { models: { "qwen-cloud": { dailyCap: 1 } }, queueMaxSec: 0 } as any, health: { health: 0, slots: 0 } });
  const info = (name: string, contextTokens: number) => ({ name, parent: "main", sessionId: name, model: "x", thinkingLevel: "high" as const, state: "running" as const, contextTokens });
  assert.equal((accepted(await h.a.spawn({ name: "q1", task: card() })) as any).model, CLOUD);
  h.a.emit({ type: "turn", name: "q1", ts: 1 }); // count 1 = cap
  assert.equal((accepted(await h.a.spawn({ name: "q2", task: card() })) as any).model, "anthropic/claude-sonnet-5-5");
  h.a.agents.push(info("q2", 140_000));
  h.a.emit({ type: "turn", name: "q2", ts: 2 });
  h.a.emit({ type: "turn", name: "q2", ts: 3 });
  await new Promise((r) => setImmediate(r));
  const file = join(h.agentDir, "task-router", "member-count.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "2026-10-02": { "qwen-cloud": 1 } });
  assert.deepEqual(h.a.sent.filter((s) => s.from === "router"), []); // 1M window: 14 %; 262k would give 53 %
});

// --- selection over members (HP T3.4): reservations, blank members, static review leg, P-nomax, explicit start, D12 ----------

const BLANK_CLOUD = { models: { "qwen-cloud": { model: "" } } } as any;

test("a child listed `idle` right after its spawn still holds its slot (mi11); after 60 s the slot is free", async () => {
  const h = harness({ base: "today", settings: { ...BLANK_CLOUD, queueMaxSec: 0 } });
  assert.equal((accepted(await h.a.spawn({ name: "q1", task: card() })) as any).model, LOCAL);
  listAs(h, { q1: "idle" }); // pi lists a fresh child idle before its first turn
  assert.equal((accepted(await h.a.spawn({ name: "q2", task: card() })) as any).model, SONNET);
  h.clock.t += 61_000;
  assert.equal((accepted(await h.a.spawn({ name: "q3", task: card() })) as any).model, LOCAL);
});

test("blank `qwen-cloud`: never probed, counted or waited for (MP2)", async () => {
  const h = harness({ base: "today", settings: BLANK_CLOUD, health: { health: 0, slots: 0 } });
  const r = accepted(await h.a.spawn({ name: "q1", task: card() })) as any;
  assert.equal(r.model, SONNET); // local down, the cloud does not exist: Sonnet at once
  assert.deepEqual(h.sleeps, []);
  assert.ok(h.urls.every((u) => u.startsWith("http://earth:11545/")), h.urls.join());
  h.a.emit({ type: "turn", name: "q1", ts: 1 });
  const file = join(h.agentDir, "task-router", "member-count.json");
  assert.ok(!existsSync(file) || !JSON.stringify(JSON.parse(readFileSync(file, "utf8"))).includes("qwen-cloud"));
});

test("the review leg is named statically: local down does not change it", async () => {
  const run = async (health: { health: number; slots: number }) => {
    const h = harness({ base: "today", settings: { ...BLANK_CLOUD, queueMaxSec: 0 }, health });
    const r = accepted(await h.a.spawn({ name: "q1", task: card({ importance: "high" }) })) as any;
    h.a.emit({ type: "spawn", name: "q1", by: "main", parent: "main", childSessionId: "s", ts: 1 });
    const [e] = h.lines();
    return [r.model, e.reviewTier, e.reviewEffort];
  };
  assert.deepEqual(await run({ health: 200, slots: 200 }), [LOCAL, "T1", "high"]);
  assert.deepEqual(await run({ health: 0, slots: 0 }), [SONNET, "T1", "high"]);
});

test("P-nomax: every router-chosen effort is on its member's ladder and never max", async () => {
  const { defaults } = await import("../core/settings.ts");
  const ms = Object.values(defaults().models);
  const cards = [card(), card({ t0: { ...card().t0, linear: false } }), card({ t2: ["security"] })];
  let n = 0;
  for (const c of cards) for (const importance of [undefined, "high", "critical"] as const) for (const health of [200, 0]) {
    const h = harness({ health: { health, slots: health } });
    for (const name of ["a", "b", "c", "d"]) {
      const r = accepted(await h.a.spawn({ name, task: { ...c, ...(importance ? { importance } : {}) } })) as any;
      const m = ms.find((x) => x.model === r.model)!;
      assert.ok(r.thinkingLevel !== "max" && m.efforts.includes(r.thinkingLevel), `${r.model} ${r.thinkingLevel}`);
      n++;
    }
  }
  assert.equal(n, 72);
});

test("explicit Sonnet → SONNET while the cloud is free (a pinned start is not selected over the leg)", async () => {
  const h = harness({ base: "today" });
  const r = accepted(await h.a.spawn({ name: "q1", model: SONNET, task: card() })) as any;
  assert.equal(r.model, SONNET);
});

// Review Focus 2 (D12): the selection runs on the plan's candidates, computed on the plan's capped settings.
test("short custom table: selection over the plan's candidates", async () => {
  const { defaults, parseSettings } = await import("../core/settings.ts");
  const { planSpawn } = await import("../core/pipeline.ts");
  const { profileFor } = await import("../core/profile.ts");
  const mine = structuredClone(defaults().importanceTable.write);
  const raw = { importanceTable: { mine }, profiles: { x: { ability: "read", table: "mine" } } };
  const s = parseSettings(structuredClone(raw)).settings;
  const c = card({ kind: "x", t2: ["security"] });
  const sp = planSpawn({ settings: s, attempts: new Map(), rng: () => 0.99 }, {
    taskId: "x1", card: c, verified: { t0: c.t0, forceT2: false, reasons: [], tokens: 0 } as any, profile: (profileFor("x", s) as any).value, importance: "normal",
  });
  assert.ok(sp.ok);
  const cands: string[] = (sp.value as any).cands;
  assert.ok(Array.isArray(cands) && cands.length > 0, `SpawnPlan.cands: ${JSON.stringify(cands)}`);
  const h = harness({ settings: raw as any });
  const r = accepted(await h.a.spawn({ name: "x1", task: c })) as any;
  const started = Object.entries(s.models).find(([, m]) => m.model === r.model)![0];
  assert.ok(cands.includes(started), `${started} ∉ ${cands}`);
  assert.equal(started, cands[0]);
});

// --- reservation at the pick; ghost sweep (HP T3.5: AC3, RD5, mi11) -------------------------------------------------------
const warnings = async (fn: () => Promise<void>) => {
  const warned: string[] = [], orig = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.join(" "));
  try { await fn(); } finally { console.warn = orig; }
  return warned;
};
const settle = () => new Promise((r) => setImmediate(r));
const PILOT =
  '429: {"message":"Rate limit exceeded: free-models-per-day-high-balance. ","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"1000","X-RateLimit-Remaining":"0","X-RateLimit-Reset":"1790985600000"},"limit_source":"openrouter_free_tier_daily"}}';

test("concurrent spawns: exactly one takes the local slot, the other waits queueMaxSec, then Sonnet", async () => {
  const h = harness({ base: "today", settings: { ...BLANK_CLOUD, queueMaxSec: 10 } });
  const rs = await Promise.all(["q1", "q2"].map((n) => h.a.spawn({ name: n, task: card() })));
  const models = rs.map((r) => (accepted(r) as any).model);
  assert.deepEqual(models.filter((m) => m === LOCAL).length, 1, models.join());
  assert.deepEqual([...models].sort(), [LOCAL, SONNET].sort());
  assert.ok(h.sleeps.reduce((a, b) => a + b, 0) >= 10_000);
});

test("P-slots: five concurrent spawns never put more children on a member than its slots", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  const rs = await Promise.all(["q1", "q2", "q3", "q4", "q5"].map((n) => h.a.spawn({ name: n, task: card() })));
  const models = rs.map((r) => (accepted(r) as any).model);
  const on = (m: string) => models.filter((x) => x === m).length;
  assert.ok(on(CLOUD) <= 2 && on(LOCAL) <= 1, models.join());
  assert.deepEqual([...models].sort(), [CLOUD, CLOUD, LOCAL, SONNET, SONNET].sort());
});

test("a ghost reservation (never listed) holds its slot 60 s; then the next spawn sweeps it and takes the slot, and a later free cap moves no ghost", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  assert.equal((accepted(await h.a.spawn({ name: "g1", task: card() })) as any).model, CLOUD); // never listed: a ghost
  assert.equal((accepted(await h.a.spawn({ name: "c1", task: card() })) as any).model, CLOUD);
  listAs(h, { c1: "running" });
  h.clock.t += 30_000;
  assert.equal((accepted(await h.a.spawn({ name: "x1", task: card() })) as any).model, LOCAL); // the ghost still holds a cloud slot
  listAs(h, { x1: "idle" }); // listed: x1 keeps the local slot until its own reservation ends
  h.clock.t += 31_000;
  assert.equal((accepted(await h.a.spawn({ name: "n1", task: card() })) as any).model, CLOUD); // the ghost's slot
  listAs(h, { n1: "running" });
  const warned = await warnings(async () => { h.a.emit({ type: "error", name: "c1", reason: PILOT, ts: 1 }); await settle(); });
  const moved = h.a.retunes.map((r) => r.name).sort();
  assert.deepEqual(moved, ["c1", "n1"]); // the cloud's live children; the swept ghost is gone
  assert.ok(!warned.some((w) => w.includes("g1")), warned.join("\n"));
});

test("no API → no sweep: the router keeps its entries", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 0 } });
  accepted(await h.a.spawn({ name: "g1", task: card() }));
  h.clock.t += 61_000;
  const api = h.a.api;
  (h.a as any).api = undefined; // the router sees no API: nothing is listed, so nothing is swept
  try {
    accepted(await h.a.spawn({ name: "q2", task: card() }));
  } finally { (h.a as any).api = api; }
  h.a.emit({ type: "error", name: "g1", reason: PILOT, ts: 1 });
  await settle();
  assert.ok(h.a.retunes.some((r) => r.name === "g1")); // g1's entry survived the spawn without an API
});

// --- explicit model resolution (HP T3.6: D14, OD19, §4.10 row 15); Step 2b: the same with the cloud blank (MP2) ---------
const explicitLocal = async (settings: Record<string, unknown>, health: { health: number; slots: number }) => {
  const h = harness({ settings: { queueMaxSec: 10, ...settings } as any, health });
  const r = await h.a.spawn({ name: "q1", model: LOCAL, task: card() });
  h.a.emit({ type: "turn", name: "q1", ts: 1 });
  const file = join(h.agentDir, "task-router", "member-count.json");
  const counted = existsSync(file) ? JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) : "";
  return { r: r as any, slept: h.sleeps.reduce((a, b) => a + b, 0), urls: h.urls, cloud: counted.includes("qwen-cloud") };
};
for (const [variant, settings] of [["", {}], [" (qwen-cloud blank)", BLANK_CLOUD]] as const) {
  test(`explicit llama/qwen3.8${variant}: local free → LOCAL, never the cloud; no cloud probe or count`, async () => {
    const x = await explicitLocal(settings, { health: 200, slots: 200 });
    assert.equal(x.r.model, LOCAL);
    assert.equal(x.slept, 0);
    assert.ok(x.urls.every((u) => u.startsWith("http://earth:11545/")), x.urls.join());
    assert.equal(x.cloud, false);
  });
  test(`explicit llama/qwen3.8${variant}: local busy → waits queueMaxSec, then rejected; never the cloud`, async () => {
    const x = await explicitLocal(settings, { health: 200, slots: 503 });
    assert.equal(x.r.reject, "explicit model llama/qwen3.8: no free slot after 10 s; leave `model` unset to let the router choose");
    assert.ok(x.slept >= 10_000);
    assert.equal(x.cloud, false);
  });
  test(`explicit llama/qwen3.8${variant}: local down → rejected at once`, async () => {
    const x = await explicitLocal(settings, { health: 0, slots: 0 });
    assert.equal(x.r.reject, "explicit model llama/qwen3.8: down; leave `model` unset to let the router choose");
    assert.equal(x.slept, 0);
  });
}

test("explicit Sonnet with the local slot busy → Sonnet at once", async () => {
  const h = harness({ settings: { ...BLANK_CLOUD, queueMaxSec: 10 }, health: { health: 200, slots: 503 } });
  assert.equal((accepted(await h.a.spawn({ name: "s1", model: SONNET, task: card() })) as any).model, SONNET);
  assert.deepEqual(h.sleeps, []);
});

test("an explicit model whose window is below the files' need is accepted, with the context reason (contextFit 1)", async () => {
  const h = harness({ base: "today", settings: { contextFit: 1, models: { "qwen-local": { contextWindow: 200 } } } as any });
  assert.equal((accepted(await h.a.spawn({ name: "q1", model: LOCAL, task: card() })) as any).model, LOCAL);
  h.a.emit({ type: "spawn", name: "q1", by: "main", parent: "main", childSessionId: "s-q1", ts: 1 });
  const [e] = h.lines();
  assert.ok((e.reasons as string[]).includes("context: files need ~278 tokens; explicit qwen-local holds 200"), e.reasons.join("\n"));
});

test("effort without a model on a Qwen plan whose fallback is Sonnet → Sonnet at its own step (high)", async () => {
  const h = harness({ base: "today", settings: { ...BLANK_CLOUD, queueMaxSec: 0 }, health: { health: 0, slots: 0 } });
  const r = accepted(await h.a.spawn({ name: "q1", thinkingLevel: "xhigh", task: card() })) as any;
  assert.deepEqual([r.model, r.thinkingLevel], [SONNET, "high"]);
});

test("an explicit model's failover stays at or above it: an explicit Sonnet child moves to another provider's T1, never down to Qwen", async () => {
  const sonnet2 = {
    model: "openrouter/anthropic/claude-sonnet", tier: "T1", route: "T1", abilities: { write: 1, read: 2 },
    efforts: ["high", "xhigh"], contextWindow: 1000000, cost: 3, order: 1,
  };
  const h = harness({ settings: { models: { sonnet2 } } as any });
  assert.equal((accepted(await h.a.spawn({ name: "s1", model: SONNET, task: card() })) as any).model, SONNET);
  h.a.emit({ type: "error", name: "s1", reason: "retries exhausted", ts: 1 });
  await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["s1", sonnet2.model]]);
});

// T4.1 (AC4, RD2, MP4): the spawn line carries the requirement, the plan's levels and what the child started on.
const LOG_KEYS = ["workerTier", "workerEffort", "ability", "level", "draft", "workerLevel", "reviewLevel", "workerMember", "workerModel", "startEffort", "waitMs"];
const spawnLine = (h: ReturnType<typeof harness>, name: string): Record<string, unknown> => {
  h.a.emit({ type: "spawn", name, by: "main", parent: "main", childSessionId: `s-${name}`, ts: 0 });
  const l = h.lines().find((x) => x.event === "spawn" && x.taskId === name)!;
  return Object.fromEntries(LOG_KEYS.filter((k) => k in l).map((k) => [k, l[k]]));
};

test("T4.1 spawn line: an all-t0 card logs write 0, worker level 0, no review, and the member it started on", async () => {
  const h = harness({ base: "today" });
  accepted(await h.a.spawn({ name: "q1", task: card() }));
  assert.deepEqual(spawnLine(h, "q1"), {
    workerTier: "qwen", workerEffort: "xhigh", ability: "write", level: 0, workerLevel: 0,
    workerMember: "qwen-cloud", workerModel: CLOUD, startEffort: "xhigh", waitMs: 0,
  });
});

test("T4.1 spawn line: a draft (one soft miss) logs draft and the draft rule's review level", async () => {
  const h = harness({ base: "today" });
  accepted(await h.a.spawn({ name: "d1", task: card({ t0: { ...card().t0, small: false } }) }));
  const l = spawnLine(h, "d1");
  assert.deepEqual([l.ability, l.level, l.draft, l.workerLevel, l.reviewLevel], ["write", 0, true, 0, 1]);
});

test("T4.1 spawn line: a Sonnet fallback of a write-0 plan logs the planned qwen xhigh and the started sonnet high after the wait (RD2)", async () => {
  const h = harness({ base: "today", settings: { queueMaxSec: 10 } });
  for (const n of ["q1", "q2", "q3"]) accepted(await h.a.spawn({ name: n, task: card() }));
  assert.equal((accepted(await h.a.spawn({ name: "q4", task: card() })) as any).model, SONNET);
  const l = spawnLine(h, "q4");
  assert.deepEqual([l.workerTier, l.workerEffort, l.workerMember, l.workerModel, l.startEffort], ["qwen", "xhigh", "sonnet", SONNET, "high"]);
  assert.ok((l.waitMs as number) >= 10_000, String(l.waitMs));
});

test("T4.1 spawn line: an explicit effort logs workerEffort planned and startEffort given; an explicit model is the started member", async () => {
  const h = harness({ base: "today" });
  const t1 = card({ t0: { ...card().t0, linear: false } });
  assert.equal((accepted(await h.a.spawn({ name: "s1", thinkingLevel: "xhigh", task: t1 })) as any).thinkingLevel, "xhigh");
  assert.deepEqual(spawnLine(h, "s1"), {
    workerTier: "T1", workerEffort: "high", ability: "write", level: 1, workerLevel: 1,
    workerMember: "sonnet", workerModel: SONNET, startEffort: "xhigh", waitMs: 0,
  });
  accepted(await h.a.spawn({ name: "o1", model: "anthropic/claude-opus-5-5", task: t1 }));
  const o = spawnLine(h, "o1");
  assert.deepEqual([o.workerTier, o.workerEffort, o.workerMember, o.workerModel, o.startEffort], ["T1", "high", "opus", "anthropic/claude-opus-5-5", "high"]);
});

// T4.2 (HS §6.4, D9): the escalate line comes from the attempt state: `from` is the route the failed attempt ran on (its
// `ranMember`, set at the pick and by a move), `to` the started member's; with the models, the ability and the levels.
const ESC_KEYS = ["from", "to", "fromModel", "toModel", "ability", "fromLevel", "toLevel", "attemptOf"];
const escalateLine = (h: ReturnType<typeof harness>, name: string): Record<string, unknown> => {
  const l = h.lines().find((x) => x.event === "escalate" && x.taskId === name)!;
  return Object.fromEntries(ESC_KEYS.filter((k) => k in l).map((k) => [k, l[k]]));
};
const emitSpawn = (h: ReturnType<typeof harness>, name: string) =>
  h.a.emit({ type: "spawn", name, by: "main", parent: "main", childSessionId: `s-${name}`, ts: 1 });

test("T4.2 escalate fields: a killed cloud child's re-spawn logs from cloud (not \"?\") to T1, with models, ability and levels", async () => {
  const h = harness({ base: "today" });
  assert.equal((accepted(await h.a.spawn({ name: "q1", task: card() })) as any).model, CLOUD);
  emitSpawn(h, "q1");
  h.a.emit({ type: "kill", name: "q1", ts: 2 });
  accepted(await h.a.spawn({ name: "q1b", task: card({ attemptOf: "q1" }) }));
  emitSpawn(h, "q1b");
  assert.deepEqual(escalateLine(h, "q1b"), {
    from: "cloud", to: "T1", fromModel: CLOUD, toModel: SONNET, ability: "write", fromLevel: 0, toLevel: 1, attemptOf: "q1",
  });
});

// RG6 (review-g4 Medium 2; main's decision, spec \u00a74.6 erratum): the attempt state lives in memory, so after a restart or a typo
// the failed task is unknown. Step 1's stand-in (the new plan's member) still sets the escalation level, but the line does not
// claim it as the route the attempt ran on: `from` "?", no `fromModel`, no `fromLevel`; the new child's side as written.
test("RG6: a re-spawn of a task this process never saw logs from \"?\" without fromModel and fromLevel", async () => {
  const h = harness({ base: "today" });
  accepted(await h.a.spawn({ name: "w2b", task: card({ attemptOf: "typo" }) }));
  emitSpawn(h, "w2b");
  assert.deepEqual(escalateLine(h, "w2b"), { from: "?", to: "T1", toModel: SONNET, ability: "write", toLevel: 1, attemptOf: "typo" });
  accepted(await h.a.spawn({ name: "w1b", task: card({ t2: ["security"], attemptOf: "w1-from-yesterday" }) }));
  emitSpawn(h, "w1b");
  assert.deepEqual(escalateLine(h, "w1b"), {
    from: "?", to: "T2", toModel: "anthropic/claude-opus-5-5", ability: "write", toLevel: 2, attemptOf: "w1-from-yesterday",
  });
});

test("T4.2 escalate fields: after a failover to Sonnet the re-spawn logs from T1 (the member it ran on)", async () => {
  const h = harness({ base: "today", health: { health: 503, slots: 200 } }); // local down: the move goes to Sonnet
  assert.equal((accepted(await h.a.spawn({ name: "q1", task: card() })) as any).model, CLOUD);
  emitSpawn(h, "q1");
  h.a.emit({ type: "error", name: "q1", reason: "retries exhausted", ts: 2 });
  await settle();
  assert.deepEqual(h.a.retunes.map((r) => [r.name, r.model]), [["q1", SONNET]]);
  accepted(await h.a.spawn({ name: "q1b", task: card({ attemptOf: "q1" }) }));
  emitSpawn(h, "q1b");
  const l = escalateLine(h, "q1b");
  assert.deepEqual([l.from, l.fromModel, l.to, l.toModel, l.fromLevel, l.toLevel], ["T1", SONNET, "T1", SONNET, 0, 1]);
});
