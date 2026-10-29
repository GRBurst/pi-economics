// T5.1: every test here runs on the today fixture (base today): they characterize the free cloud and its counter, which the
// defaults drop at T5.4 (D3, MP2) and the rollback keeps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accepted, card, harness, todayWith } from "./harness.ts";

const turn = (name: string) => ({ type: "turn" as const, name, ts: 1 });
const countFile = (dir: string) => join(dir, "task-router", "member-count.json");
const read = (dir: string) => JSON.parse(readFileSync(countFile(dir), "utf8"));
/** The today fixture without its `models.qwen-cloud.dailyCap` (a file older than the member keys), so the legacy key
 *  `cloudDailyCap` maps onto the member; with both set the new key wins (spec §5.4). */
const legacyToday = (o: Record<string, unknown>): any => {
  const r = todayWith(o);
  delete r.models["qwen-cloud"].dailyCap;
  return r;
};

test("every request of a cloud child counts, keyed by UTC date; local, Sonnet and unknown children do not", async () => {
  const h = harness({ base: "today" });
  for (const n of ["c1", "c2", "l1"]) accepted(await h.a.spawn({ name: n, task: card() })); // cloud, cloud, local
  accepted(await h.a.spawn({ name: "s1", task: card({ t0: { ...card().t0, linear: false } }) }));
  for (const n of ["c1", "c1", "c1", "l1", "s1", "ghost"]) h.a.emit(turn(n));
  assert.deepEqual(read(h.agentDir), { "2026-10-02": { "qwen-cloud": 3 } });
});

test("429 retries are requests too: each retry's turn counts", async () => {
  const h = harness({ base: "today" });
  accepted(await h.a.spawn({ name: "c1", task: card() }));
  h.a.emit(turn("c1"));
  h.a.emit({ type: "error", name: "c1", reason: "429: Rate limit exceeded", ts: 2 });
  h.a.emit(turn("c1"));
  assert.deepEqual(read(h.agentDir), { "2026-10-02": { "qwen-cloud": 2 } });
});

test("the count survives a restart and rolls over at 00:00 UTC", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "task-router-cloud-"));
  const h1 = harness({ base: "today", agentDir });
  accepted(await h1.a.spawn({ name: "c1", task: card() }));
  h1.a.emit(turn("c1")); h1.a.emit(turn("c1"));
  const h2 = harness({ base: "today", agentDir });
  accepted(await h2.a.spawn({ name: "c1", task: card() }));
  h2.a.emit(turn("c1"));
  assert.deepEqual(read(agentDir), { "2026-10-02": { "qwen-cloud": 3 } });
  h2.clock.t = Date.UTC(2026, 9, 3, 0, 0, 1);
  h2.a.emit(turn("c1"));
  assert.deepEqual(read(agentDir), { "2026-10-03": { "qwen-cloud": 1 } });
});

test("the counter feeds the chain: at cloudDailyCap new Qwen spawns leave the free cloud", async () => {
  const h = harness({ base: "today", settings: { models: { "qwen-cloud": { dailyCap: 2 } } as any }, health: { health: 0, slots: 0 } });
  accepted(await h.a.spawn({ name: "c1", task: card() }));
  h.a.emit(turn("c1")); h.a.emit(turn("c1"));
  const next = accepted(await h.a.spawn({ name: "c2", task: card() })) as any;
  assert.equal(next.model, "anthropic/claude-sonnet-5-5");
});

test("legacy cloudDailyCap: 2 still caps the cloud", async () => {
  const h = harness({ settings: legacyToday({ cloudDailyCap: 2 }), health: { health: 0, slots: 0 } });
  accepted(await h.a.spawn({ name: "c1", task: card() }));
  h.a.emit(turn("c1")); h.a.emit(turn("c1"));
  const next = accepted(await h.a.spawn({ name: "c2", task: card() })) as any;
  assert.equal(next.model, "anthropic/claude-sonnet-5-5");
});

test("a corrupt or missing count file starts at 0", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "task-router-cloud-"));
  mkdirSync(join(agentDir, "task-router"));
  writeFileSync(countFile(agentDir), "{not json");
  const h = harness({ base: "today", agentDir });
  accepted(await h.a.spawn({ name: "c1", task: card() }));
  h.a.emit(turn("c1"));
  assert.deepEqual(read(agentDir), { "2026-10-02": { "qwen-cloud": 1 } });
});

// --- review fixes: cap 0 and blank members at runtime (G0/G1 review m1, m2) ----------------------

const SONNET = "anthropic/claude-sonnet-5-5";
const LOCAL = "llama/qwen3.8";
const CLOUD = "openrouter/qwen/qwen3.8-27b:free";
const blank = (name: string) => ({ models: { [name]: { model: "" } } }) as any;
const t1Card = () => card({ t0: { ...card().t0, linear: false } });

test("legacy cloudDailyCap: 0 never selects the cloud: local when it is free, else Sonnet", async () => {
  const h = harness({ settings: legacyToday({ cloudDailyCap: 0 }) });
  assert.equal((accepted(await h.a.spawn({ name: "a", task: card() })) as any).model, LOCAL);
  const down = harness({ settings: legacyToday({ cloudDailyCap: 0 }), health: { health: 0, slots: 0 } });
  assert.equal((accepted(await down.a.spawn({ name: "a", task: card() })) as any).model, SONNET);
});

test("a blank qwen-cloud is skipped: local first, then (after waiting for the local slot, D5) Sonnet; never model \"\"", async () => {
  const h = harness({ base: "today", settings: { ...blank("qwen-cloud"), queueMaxSec: 10 } });
  const first = accepted(await h.a.spawn({ name: "a", task: card() })) as any;
  const second = accepted(await h.a.spawn({ name: "b", task: card() })) as any;
  assert.deepEqual([first.model, second.model], [LOCAL, SONNET]);
  assert.ok(h.sleeps.reduce((x, y) => x + y, 0) >= 10_000);
});

test("a blank qwen-local is skipped: the cloud, then Sonnet; never model \"\"", async () => {
  const h = harness({ base: "today", settings: blank("qwen-local") });
  const models = [];
  for (const n of ["a", "b", "c"]) models.push(((accepted(await h.a.spawn({ name: n, task: card() }))) as any).model);
  assert.deepEqual(models.slice(0, 2), [CLOUD, CLOUD]);
  assert.ok(models.every((m) => m !== ""), models.join());
});

test("both Qwen members blank → Sonnet at once", async () => {
  const h = harness({ base: "today", settings: { models: { "qwen-local": { model: "" }, "qwen-cloud": { model: "" } } } as any });
  assert.equal((accepted(await h.a.spawn({ name: "a", task: card() })) as any).model, SONNET);
});

// T2.9: the plan layer plans on enabled members (MP2: a blank member does not exist), so a blank Sonnet moves T1 work to the next
// member up and a blank Opus makes Sonnet the top; T3.4: the selection does the same for a Qwen leg (no fixed Sonnet fallback).
test("a blank sonnet: a T1 card goes to Opus; a blank opus: a t2 card goes to Sonnet (the top that exists); never model \"\"", async () => {
  const s = harness({ base: "today", settings: blank("sonnet") });
  assert.equal((accepted(await s.a.spawn({ name: "a", task: t1Card() })) as any).model, "anthropic/claude-opus-5-5");
  const o = harness({ base: "today", settings: blank("opus") });
  assert.equal((accepted(await o.a.spawn({ name: "a", task: card({ t2: ["security"] }) })) as any).model, SONNET);
});

test("a blank sonnet: a Qwen leg with both Qwen members unavailable goes to the next candidate up, Opus (no rejection)", async () => {
  const s = harness({ settings: legacyToday({ ...blank("sonnet"), cloudDailyCap: 0 }), health: { health: 0, slots: 0 } });
  const r = accepted(await s.a.spawn({ name: "a", task: card() })) as any;
  assert.deepEqual([r.model, r.thinkingLevel], ["anthropic/claude-opus-5-5", "high"]);
});
