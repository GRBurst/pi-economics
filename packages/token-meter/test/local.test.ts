// M8 (design §9.3; T8.1, T8.2, T8.8): local cost = Σ request time × the provider's rate, the union of the serving intervals, queue share,
// per-model rows with one rate per provider, prefix reuse; currency conversion. Hand-computed fixtures; rates are fixtures, never an owner's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, localCost, localRows } from "../core/analyse/local.ts";
import { parsePlans } from "../core/plans.ts";

const H = 3_600_000;
const T = Date.parse("2026-11-02T10:00:00Z");
const close = (a: number, b: number, m = "") => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${m} ${a} ≈ ${b}`);
const plans = parsePlans({ llama: { billing: "local", windows: [], rate: { amount: 2, currency: "EUR", per: "hour" } }, bare: { billing: "local", windows: [] }, anthropic: { billing: "subscription", windows: ["5h"] } });
/** A local request that ended `endMin` minutes after T and took `minutes`. */
const req = (endMin: number, minutes: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ v: 2, ts: new Date(T + endMin * 60_000).toISOString(), sessionId: "s", provider: "llama", model: "q5", kind: "turn", billing: "local", status: 200,
    input: 100, cacheRead: 0, cacheWrite: 0, output: 600, costUsd: 0, durationMs: minutes * 60_000, ...extra });
// A: [T-30, T] B: [T+15-30, T+15] (overlaps A for 15 min) · C: [T+120-30, T+120] on the other model
const lines = (): Record<string, unknown>[] => [req(0, 30), req(15, 30), req(120, 30, { model: "q4", output: 1800 })];

test("T8.1 localCost: Σ durationMs / 3.6e6 × the provider's rate in its currency; not billed local, warming and failed lines add nothing", () => {
  const r = localCost([...lines(), req(130, 30, { billing: "api" }), req(131, 30, { kind: "warming" }), req(132, 30, { status: "error" }), { ...req(133, 0), durationMs: undefined }], plans).llama;
  assert.ok(r && !("notMeasurable" in r));
  if ("notMeasurable" in r) return;
  close(r.sumH, 1.5, "sumH"); close(r.cost, 3, "cost"); assert.equal(r.currency, "EUR"); assert.equal(r.rate, 2);
});

test("T8.1 localCost: a provider without a rate is not measurable, its wall time (Σ request time) shown instead; no rate is never a cost of 0", () => {
  const r = localCost([req(0, 30, { provider: "bare" }), req(60, 15, { provider: "bare" })], plans).bare;
  assert.deepEqual(r, { notMeasurable: "no rate", wallH: 0.75 });
  assert.deepEqual(localCost([req(0, 30, { provider: "nowhere", billing: "local" })], plans).nowhere, { notMeasurable: "no rate", wallH: 0.5 }, "a provider without a plan, a line of its own billing local");
});

test("T8.2 unionH: the union of [ts − durationMs, ts] over a provider's requests; 15 of the first two requests' 30 min overlap", () => {
  const r = localCost(lines(), plans).llama;
  assert.ok(!("notMeasurable" in r));
  if ("notMeasurable" in r) return;
  close(r.unionH, 0.75 + 0.5, "unionH");
  assert.ok(r.unionH < r.sumH);
});

test("T8.2 property: unionH ≤ sumH, equal exactly when no two intervals overlap (random intervals)", () => {
  let s = 7; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let round = 0; round < 200; round++) {
    const n = 1 + Math.floor(rnd() * 6);
    const xs = Array.from({ length: n }, () => ({ end: Math.floor(rnd() * 600), dur: 1 + Math.floor(rnd() * 90) }));
    const r = localCost(xs.map((x) => req(x.end, x.dur)), plans).llama;
    assert.ok(!("notMeasurable" in r));
    if ("notMeasurable" in r) return;
    const overlap = xs.some((a, i) => xs.some((b, j) => i < j && a.end - a.dur < b.end && b.end - b.dur < a.end));
    assert.ok(r.unionH <= r.sumH + 1e-12, "union ≤ sum");
    assert.equal(Math.abs(r.unionH - r.sumH) < 1e-12, !overlap, `equal iff no overlap: ${JSON.stringify(xs)}`);
  }
});

test("T8.8 localRows: queue share = 1 − union/sum per provider (0 when nothing overlapped); one slot: > 0 means requests queued", () => {
  const [row] = localRows(lines(), plans);
  close(row.queueShare, 1 - 1.25 / 1.5, "queue share");
  assert.equal(localRows([req(0, 30), req(60, 30)], plans)[0].queueShare, 0);
});

test("T8.8 per-model rows: two model ids of one provider share one rate; requests, hours, tok/s (output ÷ durationMs, or ÷ genMs when the lines carry it), EUR per 1M output tokens", () => {
  const [row] = localRows(lines(), plans);
  assert.deepEqual(row.models.map((m) => m.model), ["q4", "q5"]);
  const [q4, q5] = row.models;
  assert.equal(q5.requests, 2); close(q5.sumH, 1); assert.equal(q5.output, 1200);
  close(q5.tokPerS!, 1200 / 3600, "q5 tok/s by durationMs"); assert.equal(q5.basis, "durationMs");
  close(q5.costPerMOut!, (1 * 2 / 1200) * 1e6, "q5 EUR / 1M");
  assert.equal(q4.requests, 1); close(q4.sumH, 0.5); close(q4.costPerMOut!, (0.5 * 2 / 1800) * 1e6, "the same rate for q4 (per provider, not per model)");
  // genMs: output over the generation time of the lines that carry it
  const g = localRows([req(0, 30, { genMs: 20_000, output: 800 }), req(60, 30, { genMs: 20_000, output: 1200 }), req(90, 30)], plans)[0].models[0];
  assert.equal(g.basis, "genMs"); close(g.tokPerS!, 2000 / 40, "tok/s = 50"); assert.equal(g.output, 2000, "the output of the lines the throughput covers; the one without genMs is left out");
});

test("T8.8 per-model rows without a rate have no cost per 1M tokens (never 0)", () => {
  const row = localRows([req(0, 30, { provider: "bare" })], plans)[0];
  assert.equal(row.rate, undefined); assert.equal(row.cost, undefined); assert.equal(row.models[0].costPerMOut, undefined);
});

test("T8.8 prefix reuse: Σ cacheN ÷ Σ (cacheN + promptN) from llama.cpp timings; else Σ cacheRead ÷ Σ (input + cacheRead); none when nothing was cached or read", () => {
  const t = localRows([req(0, 30, { cacheN: 900, promptN: 100 }), req(30, 30, { cacheN: 100, promptN: 900 }), req(60, 30, { input: 5000, cacheRead: 0 })], plans)[0];
  assert.deepEqual(t.prefix, { share: 0.5, basis: "timings", requests: 2 });
  const u = localRows([req(0, 30, { input: 100, cacheRead: 300 }), req(30, 30, { input: 100, cacheRead: 100 })], plans)[0];
  assert.deepEqual(u.prefix, { share: 400 / 600, basis: "usage", requests: 2 });
  assert.equal(localRows([req(0, 30, { input: 0, cacheRead: 0 })], plans)[0].prefix, undefined);
});

test("convert: key FROM/TO (1 FROM = rate TO), the inverse of TO/FROM when only that exists, same currency as is, else undefined; A→B→A returns x", () => {
  const rates = { "USD/EUR": 0.92, "GBP/USD": 1.25 };
  close(convert(10, "USD", "EUR", rates)!, 9.2);
  close(convert(9.2, "EUR", "USD", rates)!, 10, "inverse");
  assert.equal(convert(5, "EUR", "EUR", {}), 5);
  assert.equal(convert(5, "EUR", "GBP", rates), undefined, "no chaining through a third currency");
  assert.equal(convert(5, "USD", "EUR", {}), undefined);
  for (const x of [0, 1, 123.456]) close(convert(convert(x, "USD", "EUR", rates)!, "EUR", "USD", rates)!, x, "round trip");
  assert.equal(convert(5, "USD", "EUR", { "USD/EUR": 0 }), undefined, "a zero rate is no rate");
});
