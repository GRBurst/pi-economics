// Cache steps of a session branch (redesign M2a, B3): what a request wrote because the context grew (growth) and what it had to rewrite
// because the cache lost the prefix (miss), and why. From synthetic request sequences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { branchesOf, cacheSection, cacheSteps, shrinkFold, ttlMsOf } from "../core/analyse/cache.ts";
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

// ---- causes (T2a.3: fold, model, other; precedence P8) ----

test("B3: cause fold when an event (a fold or compaction) lies between the two requests; asked of the consecutive pair, and only for a miss", () => {
  const branch = [R(0, 0, 1000), R(1, 1000, 0), R(2, 400, 100)];
  const asked: Array<[number, number]> = [];
  const steps = cacheSteps(branch, ttl5m, (a, b) => (asked.push([branch.indexOf(a), branch.indexOf(b)]), b === branch[2]));
  assert.equal(steps[2].cause, "fold");
  assert.deepEqual(asked, [[1, 2]], "the pair of consecutive lines; the request that read its prefix and the first one need no cause");
});

test("B3: cause model when the model changed since the previous request (another model has its own cache)", () => {
  const steps = cacheSteps([R(0, 0, 1000), R(1, 0, 1000, { model: "claude-y" })], ttl5m, noEvent);
  assert.deepEqual([steps[1].miss, steps[1].cause], [1000, "model"]);
});

test("B3: cause other when nothing the analyser can see explains the miss", () => {
  const steps = cacheSteps([R(0, 0, 1000), R(1, 200, 800)], ttl5m, noEvent);
  assert.deepEqual([steps[1].miss, steps[1].cause], [800, "other"]);
});

test("B3 precedence (P8): ttl > fold > model > other, whatever else holds", () => {
  const at = (gapMin: number, model: string) => [R(0, 0, 1000), R(gapMin, 0, 1000, { model })];
  const cause = (gapMin: number, model: string, event: boolean) => cacheSteps(at(gapMin, model), ttl5m, () => event)[1].cause;
  assert.equal(cause(9, "claude-y", true), "ttl", "a gap beyond the TTL loses the prefix whatever happened since");
  assert.equal(cause(1, "claude-y", true), "fold");
  assert.equal(cause(1, "claude-y", false), "model");
  assert.equal(cause(1, "claude-x", false), "other");
});

test("shrinkFold: the 80% rule of arms.ts and the ledger, on whole prompts (strictly below)", () => {
  const p = (n: number) => ({ input: 0, cacheRead: n, cacheWrite: 0 });
  assert.equal(shrinkFold(p(1000), p(799)), true);
  assert.equal(shrinkFold(p(1000), p(800)), false);
  assert.equal(shrinkFold(p(1000), p(1500)), false);
  assert.equal(shrinkFold({ input: 10, cacheRead: 600, cacheWrite: 390 }, { input: 5, cacheRead: 500, cacheWrite: 100 }), true, "prompt = input + cacheRead + cacheWrite");
});

// ---- the Cache section of the report (T2a.4) ----

const P = 1e-6; // $ per input token
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-12 + 1e-9 * Math.abs(b), `${a} ≈ ${b}`);
/** `R` costed the way pi 1.4 does: input 1, read 0.1, write `ww` (1.25: 5 minutes, 2.0: 1 h), output 5 × P. */
const C = (sessionId: string, at: number, read: number, write: number, extra: Record<string, unknown> = {}, ww = 1.25) => {
  const l: any = R(at, read, write, { sessionId, ...extra });
  return { ...l, costUsd: P * (l.input + 0.1 * read + ww * write + 5 * l.output) };
};
const H = { "+": { mainCacheTtl: "1h" } };

test("ttlMsOf: 1 h for a line that wrote 1 h or a main session of a mainCacheTtl 1h arm, else 5 minutes", () => {
  const ttl = ttlMsOf(H);
  assert.equal(ttl(R(0, 0, 10, { arm: "+" })), HOUR);
  assert.equal(ttl(R(0, 0, 10, { arm: "-" })), 5 * MIN);
  assert.equal(ttl(R(0, 0, 10, { arm: "+", parentSessionId: "p" })), 5 * MIN, "a child keeps 5 minutes");
  assert.equal(ttl(R(0, 0, 10, { arm: "-", parentSessionId: "p", cacheWrite1h: 10 })), HOUR, "a measured 1 h write");
  assert.equal(ttl(R(0, 0, 10, { arm: "-", cacheWrite1h: 0 })), 5 * MIN);
  assert.equal(ttlMsOf()(R(0, 0, 10, { arm: "+" })), 5 * MIN, "without flags");
});

test("branchesOf: one branch per session of Claude turn and warming requests in ts order; errors, nested requests and other models are out", () => {
  const lines = [
    R(2, 5, 5, { sessionId: "a" }), R(0, 0, 10, { sessionId: "a" }), R(1, 0, 0, { sessionId: "a", status: "error" }), R(3, 0, 0, { sessionId: "a", kind: "nested" }),
    R(1, 0, 10, { sessionId: "b", kind: "warming" }), R(0, 0, 10, { sessionId: "q", provider: "llama", model: "qwen" }), { ts: "bad", sessionId: "a" }, { sessionId: "a" },
  ];
  const b = branchesOf(lines);
  assert.deepEqual([...b.keys()].sort(), ["a", "b"]);
  assert.deepEqual(b.get("a")!.map((l) => l.ts), [R(0, 0, 0).ts, R(2, 0, 0).ts]);
});

test("cacheSection: new context, misses by cause and their premium at the line's input price, over Claude branches only", () => {
  const meter = [
    C("a", 0, 0, 1000), C("a", 1, 1000, 200), C("a", 4, 0, 0, { status: "error" }), C("a", 8, 0, 1200), C("a", 9, 1200, 100), // a ttl miss of 1200 at 5 minutes
    C("b", 0, 0, 500, { arm: "+" }, 2.0), C("b", 20, 0, 500, { arm: "+" }, 2.0), // a 1h-arm main: 20 minutes is within the TTL: an unexplained miss of 500
    C("c", 0, 0, 900, { parentSessionId: "a", provider: "llama", model: "qwen" }), // a local model: not modelled here
  ];
  const c = cacheSection(meter, H);
  assert.equal(c.requests, 6);
  assert.equal(c.branches, 2);
  assert.equal(c.writeTokens, 3500);
  assert.equal(c.newContext.tokens, 1800);
  close(c.newContext.usd, 1300 * 1.25 * P + 500 * 2.0 * P);
  assert.deepEqual(c.misses.map((m) => [m.cause, m.n, m.tokens]), [["ttl", 1, 1200], ["fold", 0, 0], ["model", 0, 0], ["other", 1, 500]]);
  close(c.misses[0].usd, 1200 * (1.25 - 0.1) * P);
  close(c.misses[3].usd, 500 * (2.0 - 0.1) * P);
  close(c.missShare, 1700 / 3500);
});

test("cacheSection: no Claude request: zeros and a miss share of 0, the cause rows still there", () => {
  const c = cacheSection([]);
  assert.deepEqual([c.requests, c.branches, c.writeTokens, c.newContext.tokens, c.missShare], [0, 0, 0, 0, 0]);
  assert.deepEqual(c.misses.map((m) => m.cause), ["ttl", "fold", "model", "other"]);
});

test("cacheSection: a fold shows as cause fold (the 80% rule on the lines); a long log is stepped in linear time", () => {
  const folded = [C("a", 0, 0, 10_000), C("a", 1, 10_000, 100), C("a", 2, 1_000, 1_500)]; // prompt 10 100 → 2 500: a fold, 1500 − ... rewritten
  const c = cacheSection(folded);
  assert.deepEqual(c.misses.filter((m) => m.n).map((m) => [m.cause, m.tokens]), [["fold", 1_500]]);
  const n = 100_000;
  const long = Array.from({ length: n }, (_, i) => C("big", i / 60, i * 10, 10));
  const t = Date.now();
  assert.equal(cacheSection(long).requests, n);
  assert.ok(Date.now() - t < 5_000, `${Date.now() - t} ms`);
});
