import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accepted, card, harness } from "./harness.ts";

const CLOUD = "openrouter/qwen/qwen3.8-27b:free";
const LOCAL = "llama/qwen3.8";

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
  const h = harness();
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

test("Qwen chain: cloud, then local, then cloud; a fourth waits and falls back to Sonnet after queueMaxSec", async () => {
  const h = harness({ settings: { queueMaxSec: 10 } });
  const models: string[] = [];
  for (const n of ["q1", "q2", "q3"]) models.push((accepted(await h.a.spawn({ name: n, task: card() })) as any).model);
  assert.deepEqual(models, [CLOUD, LOCAL, CLOUD]);
  assert.equal(h.sleeps.length, 0);
  const q4 = accepted(await h.a.spawn({ name: "q4", task: card() })) as any;
  assert.equal(q4.model, "anthropic/claude-sonnet-5-5");
  assert.equal(q4.thinkingLevel, "high"); // xhigh → high on Sonnet
  assert.ok(h.sleeps.reduce((a, b) => a + b, 0) >= 10_000);
});

test("a queued spawn proceeds when a Qwen child goes idle", async () => {
  const h = harness();
  for (const n of ["q1", "q2", "q3"]) await h.a.spawn({ name: n, task: card() });
  h.a.agents.push(...["q1", "q2", "q3"].map((name) => ({ name, parent: "main", sessionId: name, model: "x", thinkingLevel: "xhigh" as const, state: "running" as const })));
  h.hooks.onSleep = () => { h.a.agents.find((x) => x.name === "q2")!.state = "idle"; };
  const q4 = accepted(await h.a.spawn({ name: "q4", task: card() })) as any;
  assert.equal(q4.model, LOCAL);
});

test("health probe: local down → no local route; result cached 30 s", async () => {
  const h = harness({ health: { health: 503, slots: 200 } });
  const a = accepted(await h.a.spawn({ name: "q1", task: card() })) as any;
  const b = accepted(await h.a.spawn({ name: "q2", task: card() })) as any;
  assert.deepEqual([a.model, b.model], [CLOUD, CLOUD]);
  assert.deepEqual(h.urls, ["http://earth:11545/health"]); // one probe for both spawns
  h.clock.t += 31_000;
  await h.a.spawn({ name: "q3", task: card() });
  assert.equal(h.urls.length, 2);
});

test("health probe: busy slot (503) or unreachable host is not available; 404/501 is unknown = available", async () => {
  const urlsFor = async (health: any) => {
    const h = harness({ health });
    await h.a.spawn({ name: "q1", task: card() });
    return (accepted(await h.a.spawn({ name: "q2", task: card() })) as any).model;
  };
  assert.equal(await urlsFor({ health: 200, slots: 503 }), CLOUD);
  assert.equal(await urlsFor({ health: 0, slots: 0 }), CLOUD);
  assert.equal(await urlsFor({ health: 200, slots: 404 }), LOCAL);
  assert.equal(await urlsFor({ health: 200, slots: 501 }), LOCAL);
});

test("our own running local child does not make the busy slot look like a third-party load", async () => {
  const h = harness({ health: { health: 200, slots: 200 } });
  for (const n of ["q1", "q2"]) await h.a.spawn({ name: n, task: card() }); // cloud, local
  h.health.slots = 503; // our local child now occupies the slot
  h.clock.t += 31_000;
  const q3 = accepted(await h.a.spawn({ name: "q3", task: card() })) as any;
  assert.equal(q3.model, CLOUD); // second cloud, not a wait
  assert.equal(h.sleeps.length, 0);
});

test("spawn event logs the routed plan with reasons and the child's session id", async () => {
  const h = harness();
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
