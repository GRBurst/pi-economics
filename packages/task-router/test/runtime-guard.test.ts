// The runtime helpers shared by the four pi-economics extensions (core/runtime-guard.ts, one file copied byte-identical
// into each package; checks/runtime-guard-copies.nix pins the copies, so this copy's tests stand for all four).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { actorMissing, claimSingleCopy, guardSingleCopy, hasSubagentsApiV1, loadedTwice, warnOnce } from "../core/runtime-guard.ts";

type G = { __piEconomicsWarned_v1?: Set<string> };
beforeEach(() => void delete (globalThis as G).__piEconomicsWarned_v1);

/** A synchronous bus like pi's createEventBus: `emit` runs the handlers in subscription order before it returns. */
function bus() {
  const handlers = new Map<string, Array<(d: any) => void>>();
  return {
    emit(channel: string, data: unknown) { for (const h of [...(handlers.get(channel) ?? [])]) h(data); },
    on(channel: string, h: (d: any) => void) {
      handlers.set(channel, [...(handlers.get(channel) ?? []), h]);
      return () => void handlers.set(channel, (handlers.get(channel) ?? []).filter((x) => x !== h));
    },
  };
}

const ui = () => {
  const notes: Array<{ text: string; level: string }> = [];
  return { notes, ctx: { hasUI: true, ui: { notify: (text: string, level: "warning") => void notes.push({ text, level }) } } };
};

const fn = () => undefined;
const full = { version: 1, registerSpawnPolicy: fn, subscribe: fn, list: fn, send: fn };

test("hasSubagentsApiV1 holds only for version 1 with registerSpawnPolicy, subscribe, list and send", () => {
  const { send: _send, ...noSend } = full;
  const table: Array<[unknown, boolean]> = [
    [undefined, false], [null, false], [{}, false], [{ ...full, version: 2 }, false], [noSend, false],
    [{ ...full, list: "x" }, false], [full, true],
  ];
  for (const [api, want] of table) assert.equal(hasSubagentsApiV1(api), want, JSON.stringify(api));
});

test("warnOnce: one notify per key however often it is called; another key warns again", () => {
  const { notes, ctx } = ui();
  for (let i = 0; i < 3; i++) warnOnce(ctx, "k1", "first text");
  warnOnce(ctx, "k2", "second text");
  assert.deepEqual(notes, [{ text: "first text", level: "warning" }, { text: "second text", level: "warning" }]);
});

test("warnOnce without a UI (print mode, a child) writes the text to console.warn, once", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  warnOnce({ hasUI: false }, "k", "plain text");
  warnOnce(undefined, "k", "plain text");
  assert.deepEqual(warn.mock.calls.map((c) => c.arguments), [["plain text"]]);
});

test("claimSingleCopy: the first copy wins; a second and a third copy learn the first copy's path", () => {
  const b = bus();
  const a = claimSingleCopy(b, "token-meter", "/nix/a/index.ts");
  assert.equal(a.first, true);
  assert.deepEqual(claimSingleCopy(b, "token-meter", "/pkg/b/index.ts"), { first: false, owner: "/nix/a/index.ts" });
  assert.deepEqual(claimSingleCopy(b, "token-meter", "/pkg/c/index.ts"), { first: false, owner: "/nix/a/index.ts" });
});

test("claimSingleCopy: components do not see each other's claims", () => {
  const b = bus();
  assert.equal(claimSingleCopy(b, "token-meter", "/x/index.ts").first, true);
  assert.equal(claimSingleCopy(b, "task-router", "/y/index.ts").first, true);
});

test("claimSingleCopy: the same path twice is no duplicate (no owner, both first)", () => {
  const b = bus();
  assert.equal(claimSingleCopy(b, "experiments", "/same/index.ts").first, true);
  const again = claimSingleCopy(b, "experiments", "/same/index.ts");
  assert.equal(again.first, true);
  assert.equal("owner" in again, false);
});

test("claimSingleCopy: after release another path claims first", () => {
  const b = bus();
  const a = claimSingleCopy(b, "cache-lifecycle", "/one/index.ts");
  assert.ok(a.first);
  a.release();
  a.release(); // idempotent
  assert.equal(claimSingleCopy(b, "cache-lifecycle", "/two/index.ts").first, true);
});

/** pi as guardSingleCopy sees it: a bus and session handlers. */
function fakePi(b = bus()) {
  const handlers = new Map<string, Array<(e: unknown, ctx: any) => void>>();
  return {
    pi: { events: b, on: (ev: "session_start" | "session_shutdown", h: (e: unknown, ctx: any) => void) => void handlers.set(ev, [...(handlers.get(ev) ?? []), h]) },
    fire: (ev: string, ctx: unknown = {}) => { for (const h of handlers.get(ev) ?? []) h({}, ctx); },
  };
}

test("guardSingleCopy: the first copy installs; a second copy installs nothing and warns once at session_start", () => {
  const b = bus();
  const one = fakePi(b), two = fakePi(b);
  let installs = 0;
  guardSingleCopy(one.pi, "token-meter", "/nix/token-meter/index.ts", () => void installs++);
  guardSingleCopy(two.pi, "token-meter", "/pkg/packages/token-meter/index.ts", () => void installs++);
  assert.equal(installs, 1);
  const { notes, ctx } = ui();
  two.fire("session_start", ctx);
  two.fire("session_start", ctx);
  assert.deepEqual(notes.map((n) => n.text), [
    "pi-economics: token-meter is loaded twice (/nix/token-meter/index.ts and /pkg/packages/token-meter/index.ts); this copy stays inert. " +
      "Keep one: remove the pi package (pi remove <source>) or disable programs.piEconomics.tokenMeter in Nix.",
  ]);
});

test("guardSingleCopy: the first copy releases its claim at session_shutdown", () => {
  const b = bus();
  const one = fakePi(b);
  guardSingleCopy(one.pi, "experiments", "/a/index.ts", () => {});
  one.fire("session_shutdown");
  let installed = false;
  guardSingleCopy(fakePi(b).pi, "experiments", "/b/index.ts", () => void (installed = true));
  assert.equal(installed, true);
});

test("loadedTwice names the Nix option of each component", () => {
  const option = { "token-meter": "tokenMeter", experiments: "experiments", "cache-lifecycle": "cacheLifecycle", "task-router": "taskRouter" } as const;
  for (const [c, o] of Object.entries(option)) {
    assert.equal(loadedTwice(c as keyof typeof option, "/o", "/p"),
      `pi-economics: ${c} is loaded twice (/o and /p); this copy stays inert. Keep one: remove the pi package (pi remove <source>) or disable programs.piEconomics.${o} in Nix.`);
  }
});

test("actorMissing: the pinned texts of the three components that use the actor's API (spec §4.2)", () => {
  const tail = " Get the patched build via the pi-economics Nix modules; upstream support pending.";
  assert.equal(actorMissing("task-router", "task-router routing is off (no task_verdict, no task_cards, no nudge); the effort guard and fresh-on-cold stay on"),
    "task-router: needs pi-actor-subagents with the spawn-policy API (__subagentsApi_v1), which is not loaded; task-router routing is off (no task_verdict, no task_cards, no nudge); the effort guard and fresh-on-cold stay on." + tail);
  assert.equal(actorMissing("cache-lifecycle", "sessions waiting on their children are not kept warm"),
    "cache-lifecycle: needs pi-actor-subagents with the spawn-policy API (__subagentsApi_v1), which is not loaded; sessions waiting on their children are not kept warm." + tail);
  assert.equal(actorMissing("experiments", "child agents do not inherit their parent's arm"),
    "experiments: needs pi-actor-subagents with the spawn-policy API (__subagentsApi_v1), which is not loaded; child agents do not inherit their parent's arm." + tail);
});
