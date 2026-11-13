// Cache steps of a session branch (redesign M2a, B3): what a request wrote because the context grew (growth) and what it had to rewrite
// because the cache lost the prefix (miss), and why. From synthetic request sequences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheSteps } from "../core/analyse/cache.ts";
import { mulberry32 } from "../core/stats.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 8, 0, 0);
/** A request `at` minutes after T0 that read `read` and wrote `write` tokens of the cache, with an uncached tail of `input`. */
const R = (at: number, read: number, write: number, extra: Record<string, unknown> = {}) => ({
  ts: new Date(T0 + at * MIN).toISOString(), sessionId: "s", provider: "anthropic", model: "claude-x", kind: "turn", status: 200,
  input: 0, cacheRead: read, cacheWrite: write, output: 10, ...extra,
});
const ttl5m = (): number => 5 * MIN;
const noEvent = (): boolean => false;
const prompt = (l: any): number => l.input + l.cacheRead + l.cacheWrite;

test("B3: a branch that only grows, without gaps: miss 0, growth = the context added each request", () => {
  const branch = [R(0, 0, 1000), R(1, 1000, 200), R(2, 1200, 300)];
  const steps = cacheSteps(branch, ttl5m, noEvent);
  assert.deepEqual(steps.map((s) => [s.i, s.growth, s.miss, s.cause]), [[0, 1000, 0, undefined], [1, 200, 0, undefined], [2, 300, 0, undefined]]);
  assert.ok(steps.every((s) => s.sessionId === "s"));
});

test("B3: the first request's whole write is growth; the uncached input tail of a request is not a miss when the next one does not read it", () => {
  const branch = [R(0, 0, 1000, { input: 10 }), R(1, 1000, 210, { input: 10 }), R(2, 1210, 105, { input: 5 })];
  assert.deepEqual(cacheSteps(branch, ttl5m, noEvent).map((s) => [s.growth, s.miss]), [[1000, 0], [210, 0], [105, 0]]);
});

test("B3: a write that is larger than the context added is a rewrite: growth = the added context only, the rest of the prefix was missed", () => {
  // the prompt stays 1200 but 100 tokens were written again: the cache read only 1100 of the 1200 it held
  const steps = cacheSteps([R(0, 0, 1200), R(1, 1100, 100)], ttl5m, noEvent);
  assert.deepEqual([steps[1].growth, steps[1].miss], [0, 100]);
  // grew by 50 and wrote 150: 50 are growth, 100 were missed
  const grown = cacheSteps([R(0, 0, 1200), R(1, 1100, 150)], ttl5m, noEvent);
  assert.deepEqual([grown[1].growth, grown[1].miss], [50, 100]);
});

test("B3: a shrinking prompt (a fold) has growth 0; its miss is what it had to read again below the new size", () => {
  const steps = cacheSteps([R(0, 0, 1000), R(1, 1000, 0), R(2, 400, 100)], ttl5m, noEvent);
  assert.deepEqual([steps[2].growth, steps[2].miss], [0, 100]); // min(prefix 1000, prompt 500) − read 400
});

test("B3: a warming request refreshes the prefix but is no outcome: it has no step", () => {
  const steps = cacheSteps([R(0, 0, 1000), R(1, 1000, 0, { kind: "warming" }), R(2, 1000, 50)], ttl5m, noEvent);
  assert.deepEqual(steps.map((s) => s.i), [0, 2], "warming is a refresh, not an outcome");
});

test("property (B3): growth ≤ cacheWrite, 0 ≤ miss ≤ the previous prompt; an ideal branch (reads what it cached, no gaps, no events) never misses", () => {
  const rng = mulberry32(3);
  for (let k = 0; k < 200; k++) {
    const ideal: any[] = [];
    const wild: any[] = [];
    let cached = 0;
    for (let i = 0; i < 30; i++) {
      const add = Math.floor(rng() * 500), tail = Math.floor(rng() * 20);
      ideal.push(R(i, cached, add, { input: tail }));
      cached += add;
      wild.push(R(i, Math.floor(rng() * 3000), Math.floor(rng() * 800), { input: Math.floor(rng() * 20) }));
    }
    assert.ok(cacheSteps(ideal, ttl5m, noEvent).every((s) => s.miss === 0));
    for (const s of cacheSteps(wild, ttl5m, noEvent)) {
      assert.ok(s.growth >= 0 && s.growth <= wild[s.i].cacheWrite, `growth ${s.growth}`);
      assert.ok(s.miss >= 0 && (s.i === 0 ? s.miss === 0 : s.miss <= prompt(wild[s.i - 1])), `miss ${s.miss}`);
      assert.equal(s.growth + (wild[s.i].cacheWrite - s.growth), wild[s.i].cacheWrite);
    }
  }
});

// ---- causes (T2a.2: ttl) ----

const HOUR = 60 * MIN;

test("B3: a 6-minute gap at the 5-minute TTL loses the prefix: miss = the previous prompt, cause ttl", () => {
  const steps = cacheSteps([R(0, 0, 1000), R(1, 1000, 200), R(7, 0, 1200)], ttl5m, noEvent);
  assert.deepEqual(steps.map((s) => [s.miss, s.cause]), [[0, undefined], [0, undefined], [1200, "ttl"]]);
  assert.equal(steps[2].growth, 0, "a rewrite is not growth");
});

test("B3: the TTL in force is the previous request's: a 6-minute gap under a 1 h TTL is no ttl miss; the TTL itself is not over it", () => {
  const branch = [R(0, 0, 1000), R(6, 0, 1000)];
  assert.equal(cacheSteps(branch, () => HOUR, noEvent)[1].cause, "other", "a miss without a reason the analyser can name");
  assert.equal(cacheSteps([R(0, 0, 1000), R(5, 0, 1000)], ttl5m, noEvent)[1].cause, "other", "a gap of exactly the TTL has not outlived it");
  const seen: unknown[] = [];
  cacheSteps([R(0, 0, 1000, { model: "a" }), R(9, 0, 1000, { model: "b" })], (l) => (seen.push(l.model), 5 * MIN), noEvent);
  assert.deepEqual(seen, ["a"], "ttlMs is asked about the request before the gap, not the one after");
});

test("B3: a request that read its prefix has no cause, whatever the gap", () => {
  const steps = cacheSteps([R(0, 0, 1000), R(30, 1000, 50)], ttl5m, noEvent);
  assert.deepEqual([steps[1].miss, steps[1].cause], [0, undefined], "the provider kept the cache: nothing was lost");
});

test("B3: a warming request refreshes the prefix and takes part in the gap", () => {
  const warmed = cacheSteps([R(0, 0, 1000), R(4, 1000, 0, { kind: "warming" }), R(8, 1000, 50)], ttl5m, noEvent);
  assert.deepEqual(warmed.map((s) => [s.i, s.miss, s.cause]), [[0, 0, undefined], [2, 0, undefined]]);
  const cold = cacheSteps([R(0, 0, 1000), R(8, 0, 1050)], ttl5m, noEvent);
  assert.deepEqual([cold[1].miss, cold[1].cause], [1000, "ttl"], "the same request without the warm in between");
});
