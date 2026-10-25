// Fold ledger — net = n·R·r − K·(w − r) per fold, from synthetic request sequences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldLedger, prices, summarise, value, bucketOf } from "../core/ledger.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 8, 0, 0);
const P = 1e-6; // $ per input token; r = 0.1·P, w = 1.25·P
const R_ = 0.1 * P, W_ = 1.25 * P;
/** A line `at` minutes after T0 whose cost follows the weights exactly (so prices() recovers P). */
const L = (sid: string, at: number, ctx: number, write: number, extra: Record<string, unknown> = {}) => {
  const input = 2, cacheWrite = write, cacheRead = ctx - input - write, output = 10;
  return { ts: new Date(T0 + at * MIN).toISOString(), sessionId: sid, provider: "anthropic", model: "claude-x", kind: "turn", status: 200,
    input, cacheRead, cacheWrite, output, costUsd: P * (input + 0.1 * cacheRead + 1.25 * cacheWrite + 5 * output), ...extra };
};
/** `warm` warm turns (1 min apart, ctx 100k, write 1k), then a fold to `ctx` writing `write`, then `after` warm turns. */
const withFold = (ctx: number, write: number, after: number, gap = 1, sid = "s") => {
  const lines = Array.from({ length: 5 }, (_, i) => L(sid, i, 100_000, 1_000));
  lines.push(L(sid, 4 + gap, ctx, write));
  for (let i = 1; i <= after; i++) lines.push(L(sid, 4 + gap + i, ctx, 1_000));
  return lines;
};
const approx = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-12 + 1e-9 * Math.abs(b), `${a} ≈ ${b}`);

test("prices: per-model r and w recovered from the lines' own cost and token fields", () => {
  const p = prices(withFold(50_000, 3_000, 3)).get("claude-x")!;
  approx(p.r, R_);
  approx(p.w, W_);
});

test("a shallow fold in a warm cache pays off: net = n·R·r − K·(w − r)", () => {
  const [f, ...rest] = foldLedger(withFold(50_000, 3_000, 10));
  assert.equal(rest.length, 0);
  assert.equal(f.R, 50_000);
  assert.equal(f.K, 2_000); // 3000 written − typical 1000
  assert.equal(f.n, 10);
  assert.equal(f.cold, false);
  approx(f.savings, 10 * 50_000 * R_);
  approx(f.rewrite, 2_000 * (W_ - R_));
  approx(f.net, f.savings - f.rewrite);
  assert.ok(f.net > 0);
});

test("a deep fold in a warm cache loses: a huge rewrite, almost no later request", () => {
  const [f] = foldLedger(withFold(75_000, 75_000, 1));
  assert.equal(f.K, 74_000);
  assert.equal(f.n, 1);
  assert.ok(f.net < 0);
  approx(f.net, 1 * 25_000 * R_ - 74_000 * (W_ - R_));
});

test("a fold after a cold gap costs 0 extra: K = 0, net = savings", () => {
  const [f] = foldLedger(withFold(50_000, 50_000, 4, 10)); // 10 min gap ≥ 5 min TTL
  assert.equal(f.cold, true);
  assert.equal(f.K, 0);
  assert.equal(f.rewrite, 0);
  assert.equal(f.n, 4);
  approx(f.net, 4 * 50_000 * R_);
});

test("n stops at the next cold gap; a 1 h arm keeps counting across a 10 min gap", () => {
  const lines = [...withFold(50_000, 3_000, 3), L("s", 4 + 1 + 3 + 10, 50_000, 1_000), L("s", 4 + 1 + 3 + 11, 50_000, 1_000)];
  assert.equal(foldLedger(lines)[0].n, 3);
  const h = foldLedger(lines.map((l) => ({ ...l, arm: "+" })), { flags: { "+": { mainCacheTtl: "1h" } } })[0];
  assert.equal(h.n, 5);
  // a child session of a 1 h arm keeps the 5 min TTL, as in arms.ts
  assert.equal(foldLedger(lines.map((l) => ({ ...l, arm: "+", parentSessionId: "p" })), { flags: { "+": { mainCacheTtl: "1h" } } })[0].n, 3);
});

test("warming requests after the fold read the prompt too and count in n", () => {
  const lines = [...withFold(50_000, 3_000, 2), L("s", 8, 50_000, 0, { kind: "warming" })];
  assert.equal(foldLedger(lines)[0].n, 3);
});

test("the typical write is the median of non-fold, non-cold, non-first turns", () => {
  const lines = withFold(50_000, 3_000, 0).map((l, i) => (i === 2 ? L("s", 2, 100_000, 9_000) : l)); // writes 1000 ×3, 9000 ×1, median of [1000,9000,1000,1000]
  assert.equal(foldLedger(lines)[0].K, 2_000);
});

test("no fold: no entry; non-Claude models and sessions without a cost are left out", () => {
  assert.deepEqual(foldLedger(Array.from({ length: 6 }, (_, i) => L("s", i, 100_000, 1_000))), []);
  assert.deepEqual(foldLedger(withFold(50_000, 3_000, 3).map((l) => ({ ...l, provider: "llama", model: "qwen" }))), []);
  assert.deepEqual(foldLedger(withFold(50_000, 3_000, 3).map((l) => ({ ...l, costUsd: 0 }))), []);
});

test("property: net = savings − rewrite exactly, over random sessions", () => {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let folds = 0;
  for (let k = 0; k < 200; k++) {
    let ctx = 50_000 + Math.floor(rnd() * 150_000);
    let at = 0;
    const lines: any[] = [];
    for (let i = 0; i < 25; i++) {
      at += rnd() < 0.15 ? 6 + Math.floor(rnd() * 70) : 1 + Math.floor(rnd() * 3);
      ctx = rnd() < 0.2 ? Math.max(5_000, Math.floor(ctx * (0.2 + rnd() * 0.9))) : ctx + Math.floor(rnd() * 3_000);
      lines.push(L("s", at, ctx, Math.min(ctx - 4, Math.floor(rnd() * ctx * 0.6)), rnd() < 0.1 ? { kind: "warming" } : {}));
    }
    const p = prices(lines).get("claude-x")!;
    for (const f of foldLedger(lines)) {
      folds += 1;
      assert.ok(f.R > 0 && f.K >= 0 && f.n >= 0);
      assert.equal(f.net, f.savings - f.rewrite);
      approx(f.net, f.n * f.R * p.r - f.K * (p.w - p.r));
      assert.deepEqual(value(f.R, f.K, f.n, p), { savings: f.savings, rewrite: f.rewrite, net: f.net });
      if (f.cold) assert.equal(f.rewrite, 0);
    }
  }
  assert.ok(folds > 50, `${folds} folds generated`);
});

test("summary: count, sum, share negative, K/R buckets, groups and models", () => {
  const lines = [...withFold(50_000, 3_000, 10, 1, "a"), ...withFold(75_000, 75_000, 1, 1, "b"), ...withFold(50_000, 50_000, 4, 10, "c")];
  const es = foldLedger(lines);
  assert.equal(es.length, 3);
  const sum = summarise(es, (e) => (e.sessionId === "b" ? "v3 cache-aware" : "v3 fixed"));
  assert.equal(sum.n, 3);
  assert.equal(sum.cold, 1);
  assert.equal(sum.negative, 1);
  approx(sum.negativeShare, 1 / 3);
  approx(sum.netUsd, es.reduce((x, e) => x + e.net, 0));
  approx(sum.netUsd, sum.savingsUsd - sum.rewriteUsd);
  assert.deepEqual(sum.byDepth.map((d) => [d.name, d.n]), [["< 0.25", 2], ["0.25 – 0.5", 0], ["0.5 – 1", 0], ["1 – 2", 0], ["≥ 2", 1]]); // K/R: 0.04, 0, 2.96
  assert.deepEqual(sum.byGroup.map((g) => [g.name, g.n, g.negative]), [["v3 cache-aware", 1, 1], ["v3 fixed", 2, 0]]);
  assert.deepEqual(sum.byModel.map((m) => [m.name, m.n]), [["claude-x", 3]]);
  assert.equal(bucketOf(0.5), "0.5 – 1");
});
