import { test } from "node:test";
import assert from "node:assert/strict";
import { pickQwen, freeCapHit, type ChainState } from "../core/chain.ts";

const NOW = 1_790_900_000_000;
const st = (o: Partial<ChainState> = {}): ChainState => ({
  localRunning: 0, cloudRunning: 0, localAvailable: true, cloudToday: 0, cloudDailyCap: 950, now: NOW, ...o,
});

test("nothing running → free cloud first", () => {
  assert.deepEqual(pickQwen(st()), { route: "cloud" });
});

test("one cloud running and local free → local", () => {
  assert.deepEqual(pickQwen(st({ cloudRunning: 1 })), { route: "local" });
});

test("local taken by our own child → second cloud, then wait", () => {
  assert.deepEqual(pickQwen(st({ localRunning: 1, cloudRunning: 1 })), { route: "cloud" });
  assert.deepEqual(pickQwen(st({ localRunning: 1, cloudRunning: 2 })), { route: "wait" });
});

test("local down or busy with others: third cloud allowed, fourth waits", () => {
  assert.deepEqual(pickQwen(st({ localAvailable: false, cloudRunning: 2 })), { route: "cloud" });
  assert.deepEqual(pickQwen(st({ localAvailable: false, cloudRunning: 3 })), { route: "wait" });
});

test("daily cap reached → local if free, else sonnet; never cloud", () => {
  const capped = { cloudToday: 950 };
  assert.deepEqual(pickQwen(st(capped)), { route: "local" });
  const r = pickQwen(st({ ...capped, localRunning: 1 }));
  assert.equal(r.route, "sonnet");
  assert.match((r as { reason: string }).reason, /cap/);
  assert.equal(pickQwen(st({ ...capped, localAvailable: false })).route, "sonnet");
  assert.equal(pickQwen(st({ cloudToday: 949 })).route, "cloud");
});

test("cloud blocked until reset → local or sonnet; unblocked at the deadline", () => {
  const blocked = { cloudBlockedUntil: NOW + 1000 };
  assert.deepEqual(pickQwen(st(blocked)), { route: "local" });
  const r = pickQwen(st({ ...blocked, localAvailable: false }));
  assert.equal(r.route, "sonnet");
  assert.match((r as { reason: string }).reason, /blocked|reset|free/i);
  assert.deepEqual(pickQwen(st({ cloudBlockedUntil: NOW })), { route: "cloud" });
});

test("P-caps: from every small state satisfying the caps, the pick keeps local ≤ 1 and cloud ≤ 2 + [¬localAvailable]", () => {
  const nows = [NOW];
  let n = 0;
  for (const localRunning of [0, 1]) for (const cloudRunning of [0, 1, 2, 3]) for (const localAvailable of [true, false])
    for (const cloudToday of [0, 949, 950, 1200]) for (const cloudBlockedUntil of [undefined, NOW - 1, NOW, NOW + 1])
      for (const now of nows) {
        const s = st({ localRunning, cloudRunning, localAvailable, cloudToday, cloudBlockedUntil, now });
        const cap = 2 + (localAvailable ? 0 : 1);
        if (cloudRunning > cap) continue; // unreachable
        const p = pickQwen(s);
        const open = cloudToday < 950 && !(cloudBlockedUntil !== undefined && now < cloudBlockedUntil);
        const l = localRunning + (p.route === "local" ? 1 : 0);
        const c = cloudRunning + (p.route === "cloud" ? 1 : 0);
        assert.ok(l <= 1, `local ${JSON.stringify(s)}`);
        assert.ok(c <= cap, `cloud ${JSON.stringify(s)}`);
        if (p.route === "local") assert.ok(localAvailable, JSON.stringify(s));
        if (p.route === "cloud") assert.ok(open, `cloud while closed ${JSON.stringify(s)}`);
        if (p.route === "wait") assert.ok(open, `wait while closed ${JSON.stringify(s)}`);
        n++;
      }
  assert.ok(n > 100);
});

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
