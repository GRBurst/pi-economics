import { test } from "node:test";
import assert from "node:assert/strict";
import { isCold } from "../core/cold.ts";
import { install } from "../core/shell.ts";
import { defaults } from "../core/settings.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

const TTL = 5 * 60_000;

test("isCold: exactly ttl after the last request is cold, one ms earlier is warm", () => {
  assert.equal(isCold(1000, 1000 + TTL - 1, TTL), false);
  assert.equal(isCold(1000, 1000 + TTL, TTL), true);
  assert.equal(isCold(1000, 1000 + TTL + 1, TTL), true);
});

test("isCold: no request yet (fresh process, resumed session) is cold", () => {
  assert.equal(isCold(undefined, 0, TTL), true);
});

test("isCold: a clock that went backwards is warm, not cold", () => {
  assert.equal(isCold(5000, 1000, TTL), false);
});

test("lastRequestAt is tracked per session, from successful provider responses only", () => {
  const f = fakePi();
  let now = 10_000;
  const h = install(f.pi as never, { settings: defaults(), now: () => now });
  const a = fakeCtx("a"), b = fakeCtx("b");
  assert.equal(h.lastRequestAt("a"), undefined);
  f.fire("after_provider_response", { status: 200, headers: {} }, a);
  now = 20_000;
  f.fire("after_provider_response", { status: 200, headers: {} }, b);
  now = 30_000;
  f.fire("after_provider_response", { status: 429, headers: {} }, a);
  assert.equal(h.lastRequestAt("a"), 10_000);
  assert.equal(h.lastRequestAt("b"), 20_000);
});
