// Cache steps of a session branch (redesign M2a, B3): what a request wrote because the context grew (growth) and what it had to rewrite
// because the cache lost the prefix (miss), and why. From synthetic request sequences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { branchesOf, cacheSection, cacheSteps, foldPremiums, shrinkFold, ttlMsOf } from "../core/analyse/cache.ts";
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

// M3b (M2a review carry-over): the meter v2 systemHash names the misses a system-prompt or tool-list change caused.
test("B3: cause prefix when the system state changed since the branch's previous known one (systemHash)", () => {
  const h = (x: string) => ({ systemHash: x.repeat(16) });
  const steps = cacheSteps([R(0, 0, 1000, h("a")), R(1, 0, 1000, h("b")), R(2, 0, 1000, h("b"))], ttl5m, noEvent);
  assert.deepEqual(steps.map((s) => s.cause), [undefined, "prefix", "other"]);
  // a line without a hash (a warm, a v1 line, an older pi) neither hides a change nor makes one
  const gap = cacheSteps([R(0, 0, 1000, h("a")), R(1, 1000, 0, { kind: "warming" }), R(2, 0, 1000), R(3, 0, 1000, h("c"))], ttl5m, noEvent);
  assert.deepEqual(gap.map((s) => s.cause), [undefined, "other", "prefix"]);
  assert.deepEqual(cacheSteps([R(0, 0, 1000), R(1, 0, 1000, h("a"))], ttl5m, noEvent).map((s) => s.cause), [undefined, "other"], "unknown before: no change seen");
  assert.deepEqual(cacheSteps([R(0, 0, 1000, h("a")), R(1, 1000, 50, h("b"))], ttl5m, noEvent).map((s) => s.cause), [undefined, undefined], "a change without a miss has no cause");
});

test("B3 precedence (P8): ttl > fold > model > prefix > other, whatever else holds", () => {
  const at = (gapMin: number, model: string, hash: string) => [R(0, 0, 1000, { systemHash: "a".repeat(16) }), R(gapMin, 0, 1000, { model, systemHash: hash.repeat(16) })];
  const cause = (gapMin: number, model: string, event: boolean, hash = "b") => cacheSteps(at(gapMin, model, hash), ttl5m, () => event)[1].cause;
  assert.equal(cause(9, "claude-y", true), "ttl", "a gap beyond the TTL loses the prefix whatever happened since");
  assert.equal(cause(1, "claude-y", true), "fold");
  assert.equal(cause(1, "claude-y", false), "model");
  assert.equal(cause(1, "claude-x", false), "prefix");
  assert.equal(cause(1, "claude-x", false, "a"), "other");
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
  assert.deepEqual(c.misses.map((m) => [m.cause, m.n, m.tokens]), [["ttl", 1, 1200], ["fold", 0, 0], ["model", 0, 0], ["prefix", 0, 0], ["other", 1, 500]]);
  close(c.misses[0].usd, 1200 * (1.25 - 0.1) * P);
  close(c.misses[4].usd, 500 * (2.0 - 0.1) * P);
  close(c.missShare, 1700 / 3500);
});

test("cacheSection: no Claude request: zeros and a miss share of 0, the cause rows still there", () => {
  const c = cacheSection([]);
  assert.deepEqual([c.requests, c.branches, c.writeTokens, c.newContext.tokens, c.missShare], [0, 0, 0, 0, 0]);
  assert.deepEqual(c.misses.map((m) => m.cause), ["ttl", "fold", "model", "prefix", "other"]);
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

// ---- B4: what a fold or a cold resume costs over reading the same tokens (T2a.5: premium) ----

/** A main session that grows to 10 400 tokens, folds to 5 000 at minute 3 (rewriting `R` = 2000 of them: it read 3000), then grows again. */
const folding = (sessionId = "f", extra: Record<string, unknown> = {}, ww = 1.25) => [
  C(sessionId, 0, 0, 10_000, extra, ww), C(sessionId, 1, 10_000, 200, extra, ww), C(sessionId, 2, 10_200, 200, extra, ww),
  C(sessionId, 3, 3_000, 2_000, extra, ww), C(sessionId, 4, 5_000, 100, extra, ww), C(sessionId, 5, 5_100, 100, extra, ww),
];
const premiums = (meter: any[], flags = {}) => foldPremiums(branchesOf(meter).values(), ttlMsOf(flags), shrinkFold, flags);

test("B4: a fold whose next request rewrites R tokens costs R·(w − r)·p exactly; one fold event, no cold resume", () => {
  const { fold, coldResume } = premiums(folding());
  assert.equal(fold.events, 1);
  close(fold.premiumUsd, 2000 * (1.25 - 0.1) * P);
  assert.equal(coldResume.events, 0);
  assert.deepEqual([coldResume.premiumUsd, coldResume.baselineUsd, coldResume.netUsd], [0, 0, 0]);
});

test("B4: a session without an event: no events, premium 0", () => {
  const steady = [C("s", 0, 0, 10_000), C("s", 1, 10_000, 200), C("s", 2, 10_200, 200), C("s", 3, 10_400, 100)];
  const { fold, coldResume } = premiums(steady);
  assert.deepEqual([fold.events, fold.premiumUsd, coldResume.events, coldResume.premiumUsd], [0, 0, 0, 0]);
});

test("B4: a fold in a 1h-arm main rewrites at 2.0 × p; a cold resume (gap beyond the TTL) costs the prefix it lost at the write premium", () => {
  const h = premiums(folding("f", { arm: "+" }, 2.0), H);
  close(h.fold.premiumUsd, 2000 * (2.0 - 0.1) * P);
  // 6 minutes at 5m: the cache is cold, the request rewrites everything it had (10 400)
  const cold = [C("s", 0, 0, 10_000), C("s", 1, 10_000, 400), C("s", 7, 0, 10_400), C("s", 8, 10_400, 100), C("s", 9, 10_500, 100)];
  const c = premiums(cold);
  assert.equal(c.coldResume.events, 1);
  close(c.coldResume.premiumUsd, 10_400 * (1.25 - 0.1) * P);
  assert.equal(c.fold.events, 0);
});

test("B4: an event's window is its request and the next two, each request counted once: a later misses in the window add to the premium, a following event cuts it", () => {
  // the fold request misses 2000, the next one misses 100 again (cached prefix lost: it read 4 900 of 5 000), the third reads everything
  const again = [...folding().slice(0, 4), C("f", 4, 4_900, 200), C("f", 5, 5_100, 100)];
  close(premiums(again).fold.premiumUsd, (2000 + 100) * (1.25 - 0.1) * P);
  // a cold resume right after the fold: the fold's window ends before it; both events keep their own request
  const both = [...folding().slice(0, 4), C("f", 12, 0, 5_000), C("f", 13, 5_000, 100)];
  const b = premiums(both);
  assert.deepEqual([b.fold.events, b.coldResume.events], [1, 1]);
  close(b.fold.premiumUsd, 2000 * (1.25 - 0.1) * P);
  close(b.coldResume.premiumUsd, 5_000 * (1.25 - 0.1) * P);
});

test("property (B4): premium ≥ 0 and every request is counted in at most one window, over random branches", () => {
  const rng = mulberry32(9);
  for (let k = 0; k < 100; k++) {
    let cachedTokens = 0;
    const lines: any[] = [];
    for (let i = 0, at = 0; i < 40; i++) {
      at += rng() < 0.2 ? 6 : 1;
      const shrink = rng() < 0.1, add = Math.floor(rng() * 500);
      const read = rng() < 0.15 ? 0 : cachedTokens;
      lines.push(C("p", at, read, add + (shrink ? 0 : Math.max(0, cachedTokens - read))));
      cachedTokens = shrink ? Math.floor(cachedTokens * 0.5) : cachedTokens + add;
    }
    const { fold, coldResume } = premiums(lines);
    for (const e of [fold, coldResume]) assert.ok(e.premiumUsd >= 0 && e.events >= 0);
    const steps = cacheSteps(branchesOf(lines).get("p")!, ttlMsOf(), shrinkFold);
    const everyMiss = steps.reduce((s, x) => s + x.miss * (1.25 - 0.1) * P, 0);
    assert.ok(fold.premiumUsd + coldResume.premiumUsd <= everyMiss + 1e-12, "windows do not overlap: no request is paid twice");
  }
});

// ---- B4: the baseline (T2a.6) ----

/** Steady requests that each miss 100 tokens, a fold (misses 2000) and two requests after it that miss 100 again, then one more steady request. */
const noisy = (sessionId: string, missEach = 100) => {
  const l: any[] = [C(sessionId, 0, 0, 10_000)];
  let cachedTokens = 10_000;
  const add = (at: number, miss: number, grow = 200, read?: number) => {
    const r = read ?? cachedTokens - miss;
    l.push(C(sessionId, at, r, grow + miss));
    cachedTokens = r + grow + miss;
  };
  add(1, missEach); add(2, missEach); add(3, missEach);
  l.push(C(sessionId, 4, 3_000, 2_000)); cachedTokens = 5_000; // the fold: prompt 10 600 → 5 000, 2000 rewritten
  add(5, missEach, 100); add(6, missEach, 100); add(7, missEach, 100);
  return l;
};

test("B4: the baseline (what an ordinary request of the same sessions misses) is subtracted: net = premium − events × baseline", () => {
  const { fold } = premiums(noisy("f"));
  const per = 100 * (1.25 - 0.1) * P; // one ordinary request's miss
  assert.equal(fold.events, 1);
  close(fold.premiumUsd, (2000 + 100 + 100) * (1.25 - 0.1) * P);
  close(fold.baselineUsd, per); // the mean over the 4 requests outside the window, times 1 event
  close(fold.netUsd, fold.premiumUsd - per);
  close(fold.netUsd, 2000 * (1.25 - 0.1) * P + per);
});

test("B4: only sessions that have an event of that kind form its baseline; each event gets one request's worth", () => {
  const quiet = [C("q", 0, 0, 10_000)]; // misses 1000 at every request, no fold, no gap
  for (let i = 1, cachedTokens = 10_000; i <= 6; i++) { quiet.push(C("q", i, cachedTokens - 1_000, 1_100)); cachedTokens += 100; }
  const alone = premiums(noisy("f")).fold;
  const withQuiet = premiums([...noisy("f"), ...quiet]).fold;
  close(withQuiet.baselineUsd, alone.baselineUsd); // a session without a fold does not move the fold baseline
  const two = premiums([...noisy("f"), ...noisy("g")]).fold;
  assert.equal(two.events, 2);
  close(two.baselineUsd, 2 * alone.baselineUsd);
  close(two.netUsd, 2 * alone.netUsd);
});

test("B4: no ordinary request to compare with: baseline 0, net = premium", () => {
  const { fold } = premiums([C("b", 0, 0, 10_000), C("b", 1, 1_000, 1_000)]); // the second request is the fold and the whole branch
  assert.equal(fold.events, 1);
  assert.equal(fold.baselineUsd, 0);
  close(fold.netUsd, fold.premiumUsd);
  assert.ok(fold.premiumUsd > 0);
  const bare = premiums([C("b", 0, 0, 1000), C("b", 1, 0, 1000)]); // a miss, no event kind applies (gap 1 min, no shrink)
  assert.deepEqual([bare.fold.events, bare.fold.baselineUsd, bare.coldResume.events], [0, 0, 0]);
});

test("property (B4): net = premium − baseline; premium and baseline are not negative", () => {
  const rng = mulberry32(17);
  for (let k = 0; k < 100; k++) {
    const lines: any[] = [];
    let cachedTokens = 0;
    for (let i = 0, at = 0; i < 30; i++) {
      at += rng() < 0.15 ? 7 : 1;
      const read = rng() < 0.2 ? 0 : Math.floor(cachedTokens * rng());
      const write = Math.floor(rng() * 800) + (rng() < 0.1 ? 0 : Math.max(0, cachedTokens - read));
      lines.push(C("r", at, read, write));
      cachedTokens = rng() < 0.1 ? Math.floor(cachedTokens / 3) : read + write;
    }
    for (const e of Object.values(premiums(lines))) {
      assert.ok(e.premiumUsd >= 0 && e.baselineUsd >= 0);
      close(e.netUsd, e.premiumUsd - e.baselineUsd);
    }
  }
});
