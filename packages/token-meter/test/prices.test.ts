// M4 (M2a review carry-over): a per-model price table. pi-ai's registry prices Opus 5.5 reads at 0.05 × input (0.2 of 4 $/Mtok),
// Sonnet 5.5 at 0.05 (anthropic provider; others list 0.2); the analyser's single ratio set (read 0.1) mis-split Opus lines and understated the fold ledger's rewrite cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIST, weightsOf, WEIGHT } from "../core/analyse/prices.ts";
import { allocate, apiUsd, pIn, writeWeight } from "../core/analyse/units.ts";
import { prices } from "../core/ledger.ts";
import { cacheSection } from "../core/analyse/cache.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-12 + 1e-9 * Math.abs(b), `${a} ≈ ${b}`);
const P = 4e-6; // Opus 5.5 input price, $ per token
/** A line costed with pi-ai's Opus 5.5 prices: input 4, read 0.2, 5-minute write 5, 1 h write 8, output 20 $/Mtok. */
const opus = (t: { input: number; cacheRead: number; cacheWrite: number; output: number }, cw1h = 0, extra: Record<string, unknown> = {}) => ({
  provider: "anthropic", model: "claude-opus-5-5", kind: "turn", status: 200, ...t, cacheWrite1h: cw1h, ...extra,
  costUsd: 1e-6 * (4 * t.input + 0.2 * t.cacheRead + 5 * (t.cacheWrite - cw1h) + 8 * cw1h + 20 * t.output),
});

test("weightsOf: the anthropic provider's ratios per model id; opus-5-5 and sonnet-5-5 read at 0.05 (0.2 of 4, 0.1 of 2 $/Mtok), sonnet-5 and opus-5 at 0.1, haiku-5-5 at 0.1; 1 h writes 2.0 × input", () => {
  assert.deepEqual(weightsOf("claude-opus-5-5", "anthropic"), { input: 1, cacheRead: 0.05, cacheWrite5m: 1.25, cacheWrite1h: 2, output: 5 });
  assert.deepEqual(weightsOf("claude-sonnet-5-5", "anthropic"), { input: 1, cacheRead: 0.05, cacheWrite5m: 1.25, cacheWrite1h: 2, output: 5 }, "a real log: read ≈ 0.114 $/Mtok of 2");
  assert.equal(weightsOf("claude-sonnet-5", "anthropic").cacheRead, 0.1);
  assert.equal(weightsOf("claude-haiku-5-5", "anthropic").cacheRead, 0.1);
  for (const id of ["claude-haiku-4-5-20251001", "claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929"]) assert.equal(weightsOf(id, "anthropic").cacheRead, 0.1, id);
});

test("weightsOf: the registry price depends on the provider — the table holds the anthropic provider's; another provider's line of the same model id gets the default ratios; a line without a provider falls back to the model alone", () => {
  assert.deepEqual(weightsOf("claude-sonnet-5-5", "cloudflare-ai-gateway"), WEIGHT, "that gateway lists Sonnet 5.5 reads at 0.2 $/Mtok: not this table");
  assert.deepEqual(weightsOf("claude-opus-5-5", "openrouter"), WEIGHT);
  assert.equal(weightsOf("claude-opus-5-5", undefined).cacheRead, 0.05);
  assert.equal(weightsOf("claude-opus-5-5").cacheRead, 0.05);
  assert.deepEqual(weightsOf("claude-opus-5-5", ""), WEIGHT, "a present but unknown provider is not 'no provider'");
});

test("weightsOf: a model without an entry (a local or unknown one, a non-string) gets the Anthropic list ratios", () => {
  for (const m of ["qwen3.8", "claude-x", "", undefined, null, 7, "__proto__", "constructor"]) for (const p of [undefined, "anthropic", "__proto__"]) assert.deepEqual(weightsOf(m, p), WEIGHT);
  assert.deepEqual(WEIGHT, { input: 1, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2.0, output: 5 });
});

test("LIST: every entry is a positive price and its ratios are finite", () => {
  for (const [m, p] of Object.entries(LIST.anthropic)) {
    for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) assert.ok(p[k] > 0 && Number.isFinite(p[k]), `${m}.${k}`);
    for (const x of Object.values(weightsOf(m, "anthropic"))) assert.ok(Number.isFinite(x) && x > 0, m);
  }
});

test("pIn recovers the input price of an Opus 5.5 line (read 0.05): the single ratio set gave 0.1-read prices", () => {
  const l = opus({ input: 1000, cacheRead: 100_000, cacheWrite: 2000, output: 500 });
  close(pIn(l), P);
  close(pIn(opus({ input: 10, cacheRead: 50_000, cacheWrite: 1000, output: 5 }, 1000)), P);
});

test("allocate: an Opus 5.5 line splits by its own weights and adds up to its cost", () => {
  const l = opus({ input: 1000, cacheRead: 100_000, cacheWrite: 2000, output: 500 }, 600);
  const a = allocate(l);
  close(a.cacheRead, 0.05 * P * 100_000);
  close(a.cacheWrite1h, 2 * P * 600);
  close(a.cacheWrite5m, 1.25 * P * 1400);
  close(a.output, 5 * P * 500);
  close(Object.values(a).reduce((s, x) => s + x, 0), apiUsd(l));
});

test("writeWeight and the ledger's prices use the model's read weight: r = 0.05·p for Opus 5.5 and Sonnet 5.5, 0.1·p for Sonnet 5", () => {
  const mk = (model: string, pRead: number) => [0, 1, 2].map((i) => ({ ts: new Date(Date.UTC(2026, 10, 1, 9, i)).toISOString(), sessionId: "s", provider: "anthropic", model, kind: "turn", input: 100, cacheRead: 50_000, cacheWrite: 1000, output: 100,
    costUsd: 1e-6 * (100 + pRead * 50_000 + 1.25 * 1000 + 5 * 100) }));
  const o = prices(mk("claude-opus-5-5", 0.05)).get("claude-opus-5-5")!;
  close(o.r, 0.05 * 1e-6);
  close(o.w, 1.25 * 1e-6);
  close(prices(mk("claude-sonnet-5-5", 0.05)).get("claude-sonnet-5-5")!.r, 0.05 * 1e-6);
  close(prices(mk("claude-sonnet-5", 0.1)).get("claude-sonnet-5")!.r, 0.1 * 1e-6);
  close(writeWeight(opus({ input: 1, cacheRead: 1, cacheWrite: 1000, output: 1 }, 500), 500), 1.625);
});

test("cache section: a miss of Opus 5.5 is priced (write − 0.05) × p, not (write − 0.1) × p", () => {
  const at = (i: number) => new Date(Date.UTC(2026, 10, 1, 9, 0, 0) + i * 60_000).toISOString();
  const first = opus({ input: 10, cacheRead: 0, cacheWrite: 10_000, output: 10 }, 0, { ts: at(0), sessionId: "s" });
  const second = opus({ input: 10, cacheRead: 0, cacheWrite: 10_000, output: 10 }, 0, { ts: at(20), sessionId: "s" }); // a gap beyond the TTL: the whole prefix is missed
  const c = cacheSection([first, second]);
  const miss = c.misses.reduce((s, m) => s + m.tokens, 0);
  assert.equal(miss, 10_000);
  close(c.misses.reduce((s, m) => s + m.usd, 0), miss * (1.25 - 0.05) * P);
});
