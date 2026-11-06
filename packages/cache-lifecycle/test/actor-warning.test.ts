// Without the patched actor (spec D5, AC6; plan T3.2): one warning at session_start, and the rest works as before
// (the warming decision already returns nothing without the API; masking and the TTL need no actor).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { install } from "../core/shell.ts";
import { defaults } from "../core/settings.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: Set<string> }).__piEconomicsWarned_v1);

const WARNING =
  "cache-lifecycle: needs pi-actor-subagents with the spawn-policy API (__subagentsApi_v1), which is not loaded; " +
  "sessions waiting on their children are not kept warm. Get the patched build via the pi-economics Nix modules; upstream support pending.";

const fn = () => () => {};
const full = { version: 1, registerSpawnPolicy: fn, subscribe: fn, list: () => [], send: async () => {} };

function rig(api: () => typeof full | undefined) {
  const f = fakePi();
  install(f.pi, { settings: defaults(), api });
  const notes: string[] = [];
  const ctx = { ...fakeCtx("s-main"), hasUI: true, ui: { notify: (m: string) => void notes.push(m) } };
  return { f, notes, ctx };
}

test("without the actor's API: the pinned warning once, however many sessions start", () => {
  const { f, notes, ctx } = rig(() => undefined);
  f.fire("session_start", {}, ctx);
  f.fire("session_start", {}, ctx);
  assert.deepEqual(notes, [WARNING]);
  assert.equal(f.call("cache_warming_decision", {}, ctx), undefined, "no warming decision without the API (as before)");
});

test("with the actor's API: no warning", () => {
  const { f, notes, ctx } = rig(() => full);
  f.fire("session_start", {}, ctx);
  assert.deepEqual(notes, []);
});
