import { test } from "node:test";
import assert from "node:assert/strict";
import { accepted, card, harness } from "./harness.ts";

const turn = (name: string) => ({ type: "turn" as const, name, ts: 1 });
const info = (name: string, o: Record<string, unknown> = {}) => ({ name, parent: "main", sessionId: name, model: "x", thinkingLevel: "xhigh" as const, state: "running" as const, ...o });
const notices = (h: ReturnType<typeof harness>) => h.a.sent.filter((s) => s.from === "router");
const settle = () => new Promise((r) => setImmediate(r));

test("request counter > runaway.requests → exactly one notice to the parent", async () => {
  const h = harness({ settings: { runaway: { requests: 3, usd: 10 } } });
  accepted(await h.a.spawn({ name: "q1", task: card() }));
  h.a.agents.push(info("q1"));
  for (let i = 0; i < 3; i++) h.a.emit(turn("q1"));
  assert.equal(notices(h).length, 0);
  h.a.emit(turn("q1"));
  h.a.emit(turn("q1"));
  await settle();
  assert.equal(notices(h).length, 1);
  assert.equal(notices(h)[0].to, "main");
  assert.match(notices(h)[0].text, /q1.*4 requests.*limit 3/);
});

test("cost > runaway.usd → one notice; below the limit nothing", async () => {
  const h = harness();
  accepted(await h.a.spawn({ name: "q1", task: card() }));
  h.a.agents.push(info("q1", { costUsd: 9.99 }));
  h.a.emit(turn("q1"));
  await settle();
  assert.equal(notices(h).length, 0);
  h.a.agents[0] = info("q1", { costUsd: 10.5 });
  h.a.emit(turn("q1")); h.a.emit(turn("q1"));
  await settle();
  assert.equal(notices(h).length, 1);
  assert.match(notices(h)[0].text, /\$10\.50.*limit \$10/);
});

test("context above contextGuard × window → one note, with the window of the child's tier", async () => {
  const h = harness();
  accepted(await h.a.spawn({ name: "q1", task: card() })); // qwen cloud: 262144
  h.a.agents.push(info("q1", { contextTokens: 130_000 }));
  h.a.emit(turn("q1"));
  await settle();
  assert.equal(notices(h).length, 0); // 49.6 %
  h.a.agents[0] = info("q1", { contextTokens: 140_000 });
  h.a.emit(turn("q1")); h.a.emit(turn("q1"));
  await settle();
  assert.equal(notices(h).length, 1);
  assert.match(notices(h)[0].text, /q1.*context 140k.*53 %/);
  assert.match(notices(h)[0].text, /fresh agent|handoff/i);
});

test("unknown children and killed children are ignored; a respawned name starts a fresh count", async () => {
  const h = harness({ settings: { runaway: { requests: 1, usd: 10 } } });
  h.a.emit(turn("ghost"));
  accepted(await h.a.spawn({ name: "q1", task: card() }));
  h.a.agents.push(info("q1"));
  h.a.emit(turn("q1")); h.a.emit(turn("q1"));
  await settle();
  assert.equal(notices(h).length, 1);
  h.a.emit({ type: "kill", name: "q1", ts: 2 });
  accepted(await h.a.spawn({ name: "q1", task: card() }));
  h.a.emit(turn("q1"));
  await settle();
  assert.equal(notices(h).length, 1);
});

test("a child on `sonnet` with a configured contextWindow: 200000 gets the note at 101k (the window of its member)", async () => {
  const h = harness({ settings: { models: { sonnet: { contextWindow: 200_000 } } } as any });
  accepted(await h.a.spawn({ name: "s1", task: card({ t0: { ...card().t0, linear: false } }) })); // T1 → sonnet
  h.a.agents.push(info("s1", { contextTokens: 101_000 }));
  h.a.emit(turn("s1"));
  await settle();
  assert.equal(notices(h).length, 1);
  assert.match(notices(h)[0].text, /s1.*context 101k.*51 %.*200k window/);
});
