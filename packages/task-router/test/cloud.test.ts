import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accepted, card, harness } from "./harness.ts";

const turn = (name: string) => ({ type: "turn" as const, name, ts: 1 });
const countFile = (dir: string) => join(dir, "task-router", "cloud-count.json");
const read = (dir: string) => JSON.parse(readFileSync(countFile(dir), "utf8"));

test("every request of a cloud child counts, keyed by UTC date; local, Sonnet and unknown children do not", async () => {
  const h = harness();
  for (const n of ["c1", "l1"]) accepted(await h.a.spawn({ name: n, task: card() })); // cloud, local
  accepted(await h.a.spawn({ name: "s1", task: card({ t0: { ...card().t0, linear: false } }) }));
  for (const n of ["c1", "c1", "c1", "l1", "s1", "ghost"]) h.a.emit(turn(n));
  assert.deepEqual(read(h.agentDir), { "2026-10-02": 3 });
});

test("429 retries are requests too: each retry's turn counts", async () => {
  const h = harness();
  accepted(await h.a.spawn({ name: "c1", task: card() }));
  h.a.emit(turn("c1"));
  h.a.emit({ type: "error", name: "c1", reason: "429: Rate limit exceeded", ts: 2 });
  h.a.emit(turn("c1"));
  assert.equal(read(h.agentDir)["2026-10-02"], 2);
});

test("the count survives a restart and rolls over at 00:00 UTC", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "task-router-cloud-"));
  const h1 = harness({ agentDir });
  accepted(await h1.a.spawn({ name: "c1", task: card() }));
  h1.a.emit(turn("c1")); h1.a.emit(turn("c1"));
  const h2 = harness({ agentDir });
  accepted(await h2.a.spawn({ name: "c1", task: card() }));
  h2.a.emit(turn("c1"));
  assert.equal(read(agentDir)["2026-10-02"], 3);
  h2.clock.t = Date.UTC(2026, 9, 3, 0, 0, 1);
  h2.a.emit(turn("c1"));
  assert.deepEqual(read(agentDir), { "2026-10-03": 1 });
});

test("the counter feeds the chain: at cloudDailyCap new Qwen spawns leave the free cloud", async () => {
  const h = harness({ settings: { models: { "qwen-cloud": { dailyCap: 2 } } as any }, health: { health: 0, slots: 0 } });
  accepted(await h.a.spawn({ name: "c1", task: card() }));
  h.a.emit(turn("c1")); h.a.emit(turn("c1"));
  const next = accepted(await h.a.spawn({ name: "c2", task: card() })) as any;
  assert.equal(next.model, "anthropic/claude-sonnet-5-5");
});

test("legacy cloudDailyCap: 2 still caps the cloud", async () => {
  const h = harness({ settings: { cloudDailyCap: 2 } as any, health: { health: 0, slots: 0 } });
  accepted(await h.a.spawn({ name: "c1", task: card() }));
  h.a.emit(turn("c1")); h.a.emit(turn("c1"));
  const next = accepted(await h.a.spawn({ name: "c2", task: card() })) as any;
  assert.equal(next.model, "anthropic/claude-sonnet-5-5");
});

test("a corrupt or missing count file starts at 0", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "task-router-cloud-"));
  mkdirSync(join(agentDir, "task-router"));
  writeFileSync(countFile(agentDir), "{not json");
  const h = harness({ agentDir });
  accepted(await h.a.spawn({ name: "c1", task: card() }));
  h.a.emit(turn("c1"));
  assert.equal(read(agentDir)["2026-10-02"], 1);
});

// --- review fixes: cap 0 and blank members at runtime (G0/G1 review m1, m2) ----------------------

const SONNET = "anthropic/claude-sonnet-5-5";
const LOCAL = "llama/qwen3.8";
const CLOUD = "openrouter/qwen/qwen3.8-27b:free";
const blank = (name: string) => ({ models: { [name]: { model: "" } } }) as any;
const t1Card = () => card({ t0: { ...card().t0, linear: false } });

test("legacy cloudDailyCap: 0 never selects the cloud: local when it is free, else Sonnet", async () => {
  const h = harness({ settings: { cloudDailyCap: 0 } as any });
  assert.equal((accepted(await h.a.spawn({ name: "a", task: card() })) as any).model, LOCAL);
  const down = harness({ settings: { cloudDailyCap: 0 } as any, health: { health: 0, slots: 0 } });
  assert.equal((accepted(await down.a.spawn({ name: "a", task: card() })) as any).model, SONNET);
});

test("a blank qwen-cloud is skipped: local first, then Sonnet (a cloud that is never selected); never model \"\"", async () => {
  const h = harness({ settings: blank("qwen-cloud") });
  const first = accepted(await h.a.spawn({ name: "a", task: card() })) as any;
  const second = accepted(await h.a.spawn({ name: "b", task: card() })) as any;
  assert.deepEqual([first.model, second.model], [LOCAL, SONNET]);
});

test("a blank qwen-local is skipped: the cloud, then Sonnet; never model \"\"", async () => {
  const h = harness({ settings: blank("qwen-local") });
  const models = [];
  for (const n of ["a", "b", "c"]) models.push(((accepted(await h.a.spawn({ name: n, task: card() }))) as any).model);
  assert.deepEqual(models.slice(0, 2), [CLOUD, CLOUD]);
  assert.ok(models.every((m) => m !== ""), models.join());
});

test("both Qwen members blank → Sonnet at once", async () => {
  const h = harness({ settings: { models: { "qwen-local": { model: "" }, "qwen-cloud": { model: "" } } } as any });
  assert.equal((accepted(await h.a.spawn({ name: "a", task: card() })) as any).model, SONNET);
});

// T2.9: the plan layer plans on enabled members (MP2: a blank member does not exist), so a blank Sonnet moves T1 work to the next
// member up and a blank Opus makes Sonnet the top; only the Qwen chain's fixed Sonnet fallback (the bridge until T3.4) still rejects.
test("a blank sonnet: a T1 card goes to Opus; a blank opus: a t2 card goes to Sonnet (the top that exists); never model \"\"", async () => {
  const s = harness({ settings: blank("sonnet") });
  assert.equal((accepted(await s.a.spawn({ name: "a", task: t1Card() })) as any).model, "anthropic/claude-opus-5-5");
  const o = harness({ settings: blank("opus") });
  assert.equal((accepted(await o.a.spawn({ name: "a", task: card({ t2: ["security"] }) })) as any).model, SONNET);
});

test("a blank sonnet: the Qwen chain's fallback to Sonnet rejects the spawn, naming the tier", async () => {
  const s = harness({ settings: { ...blank("sonnet"), cloudDailyCap: 0 }, health: { health: 0, slots: 0 } });
  const r = await s.a.spawn({ name: "a", task: card() }) as any;
  assert.ok("reject" in r && /T1/.test(r.reject) && /not configured|blank/.test(r.reject), JSON.stringify(r));
});
