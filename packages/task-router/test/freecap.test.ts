import { test } from "node:test";
import assert from "node:assert/strict";
import { freeCapHit } from "../core/freecap.ts";

const NOW = 1_790_900_000_000;

const PILOT =
  '429: {"message":"Rate limit exceeded: free-models-per-day-high-balance. ","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"1000","X-RateLimit-Remaining":"0","X-RateLimit-Reset":"1790985600000"},"limit_source":"openrouter_free_tier_daily","remedy_hint":"Wait for the daily reset (see X-RateLimit-Reset), or purchase credits to raise your free-model daily limit.","provider_name":null}}';

test("freeCapHit: the literal pilot message → until = X-RateLimit-Reset", () => {
  assert.deepEqual(freeCapHit(PILOT, NOW), { until: 1790985600000 });
});

test("freeCapHit: marker without reset header → next 00:00 UTC", () => {
  const now = Date.UTC(2026, 9, 2, 18, 41, 0);
  const next = Date.UTC(2026, 9, 3, 0, 0, 0);
  assert.deepEqual(freeCapHit("429: free-models-per-day", now), { until: next });
  assert.deepEqual(freeCapHit('429: {"limit_source":"openrouter_free_tier_daily"}', now), { until: next });
  assert.deepEqual(freeCapHit("429: free-models-per-day", Date.UTC(2026, 9, 3, 0, 0, 0)), { until: Date.UTC(2026, 9, 4, 0, 0, 0) });
});

test("freeCapHit: a stale reset (≤ now) falls back to the next midnight", () => {
  const now = 1790985600001;
  const r = freeCapHit(PILOT, now);
  assert.ok(r && r.until > now);
});

test("freeCapHit: ordinary 429s and other errors → null", () => {
  assert.equal(freeCapHit('429: {"message":"Rate limit exceeded: free-models-per-min","code":429}', NOW), null);
  assert.equal(freeCapHit("429: Provider returned error", NOW), null);
  assert.equal(freeCapHit("", NOW), null);
});
