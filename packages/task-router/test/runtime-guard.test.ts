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

/** pi as guardSingleCopy sees it: a bus and the extension's handlers; `fire` is the runner's emit (awaits each handler in turn). */
function fakePi(b = bus()) {
  const handlers = new Map<string, Array<(e: any, ctx: any) => unknown>>();
  const pi = {
    events: b,
    on(ev: string, h: (e: any, ctx: any) => unknown) {
      handlers.set(ev, [...(handlers.get(ev) ?? []), h]);
      return () => void handlers.set(ev, (handlers.get(ev) ?? []).filter((x) => x !== h));
    },
  };
  return {
    pi,
    count: (ev: string) => (handlers.get(ev) ?? []).length,
    fire: async (ev: string, ctx: unknown = {}) => { for (const h of [...(handlers.get(ev) ?? [])]) await h({ type: ev }, ctx); },
  };
}

const twice = (c: string, o: string, p: string, opt: string) =>
  `pi-economics: ${c} is loaded twice (${o} and ${p}); this copy stays inert. Keep one: remove the pi package (pi remove <source>) or disable programs.piEconomics.${opt} in Nix.`;

test("guardSingleCopy: loading installs nothing; the first copy to get session_start installs, a second installs nothing and warns once", async () => {
  const b = bus();
  const one = fakePi(b), two = fakePi(b);
  let installs = 0;
  guardSingleCopy(one.pi, "token-meter", "/nix/token-meter/index.ts", () => void installs++);
  guardSingleCopy(two.pi, "token-meter", "/pkg/packages/token-meter/index.ts", () => void installs++);
  assert.equal(installs, 0, "the claim is made at session_start, never at load");
  const { notes, ctx } = ui();
  await one.fire("session_start", ctx);
  await two.fire("session_start", ctx);
  await two.fire("session_start", ctx);
  assert.equal(installs, 1);
  assert.deepEqual(notes.map((n) => n.text), [twice("token-meter", "/nix/token-meter/index.ts", "/pkg/packages/token-meter/index.ts", "tokenMeter")]);
});

test("guardSingleCopy: a copy that never gets session_start (pi dropped it after a pre-trust load) does not block the copy that does", async () => {
  const b = bus();
  const dropped = fakePi(b), kept = fakePi(b);
  const installed: string[] = [];
  guardSingleCopy(dropped.pi, "task-router", "/user/pkg/packages/task-router/index.ts", () => void installed.push("dropped"));
  guardSingleCopy(kept.pi, "task-router", "/project/pkg/packages/task-router/index.ts", () => void installed.push("kept"));
  const { notes, ctx } = ui();
  await kept.fire("session_start", ctx); // pi's final set holds only the second copy
  assert.deepEqual(installed, ["kept"]);
  assert.deepEqual(notes, []);
});

test("guardSingleCopy: of two copies that both start, the first to get session_start wins, whatever the load order", async () => {
  const b = bus();
  const loadedFirst = fakePi(b), loadedSecond = fakePi(b);
  const installed: string[] = [];
  guardSingleCopy(loadedFirst.pi, "cache-lifecycle", "/user/index.ts", () => void installed.push("user"));
  guardSingleCopy(loadedSecond.pi, "cache-lifecycle", "/project/index.ts", () => void installed.push("project"));
  const { notes, ctx } = ui();
  await loadedSecond.fire("session_start", ctx); // pi orders a project package before a user one
  await loadedFirst.fire("session_start", ctx);
  assert.deepEqual(installed, ["project"]);
  assert.deepEqual(notes.map((n) => n.text), [twice("cache-lifecycle", "/project/index.ts", "/user/index.ts", "cacheLifecycle")]);
});

test("guardSingleCopy: the install's session_start handlers run in the guard's session_start, in order, with pi's event and context; other events reach pi", async () => {
  const f = fakePi();
  const calls: unknown[][] = [];
  guardSingleCopy(f.pi, "experiments", "/a/index.ts", (p) => {
    p.on("session_start", (e, ctx) => void calls.push(["first", e, ctx]));
    p.on("session_start", (e, ctx) => void calls.push(["second", e, ctx]));
    p.on("message_end", () => {});
  });
  assert.equal(f.count("message_end"), 0, "nothing is installed at load");
  const ctx = { hasUI: false };
  await f.fire("session_start", ctx);
  assert.deepEqual(calls, [["first", { type: "session_start" }, ctx], ["second", { type: "session_start" }, ctx]]);
  assert.equal(f.count("message_end"), 1);
  assert.equal(f.count("session_start"), 1, "pi holds the guard's handler only; the install's are dispatched by it");
  await f.fire("session_start", ctx); // the same instance again: no second install, the handlers run again
  assert.equal(f.count("message_end"), 1);
  assert.equal(calls.length, 4);
});

test("guardSingleCopy: a throwing session_start handler of the install does not skip the next one; the error reaches pi", async () => {
  const f = fakePi();
  let ran = false;
  guardSingleCopy(f.pi, "token-meter", "/a/index.ts", (p) => {
    p.on("session_start", () => { throw new Error("boom"); });
    p.on("session_start", () => void (ran = true));
  });
  await assert.rejects(f.fire("session_start"), /boom/);
  assert.equal(ran, true);
});

test("guardSingleCopy: an install that throws keeps its claim and goes inert: its held and plain handlers and bus listeners stop, a later copy installs nothing and warns, the error reaches pi", async () => {
  const b = bus();
  const bad = fakePi(b), later = fakePi(b);
  const ran: string[] = [];
  guardSingleCopy(bad.pi, "task-router", "/bad/index.ts", (p) => {
    p.on("session_start", () => void ran.push("held"));
    p.on("message_end" as "session_start", () => void ran.push("plain"));
    p.events.on("pi-retry:x", () => void ran.push("bus"));
    throw new Error("no install");
  });
  let installed = false;
  guardSingleCopy(later.pi, "task-router", "/good/index.ts", () => void (installed = true));
  await assert.rejects(bad.fire("session_start"), /no install/);
  await bad.fire("session_start"); // again on the same instance: inert, no second install, no throw
  await bad.fire("message_end");
  b.emit("pi-retry:x", {});
  assert.deepEqual(ran, [], "nothing the failed install registered runs");
  const { notes, ctx } = ui();
  await later.fire("session_start", ctx);
  assert.equal(installed, false, "no partial set next to a full one");
  assert.deepEqual(notes.map((n) => n.text), [twice("task-router", "/bad/index.ts", "/good/index.ts", "taskRouter")]);
});

test("guardSingleCopy: every failing held session_start handler is reported, not only the first (one error as itself, several as one AggregateError naming all)", async () => {
  const f = fakePi();
  guardSingleCopy(f.pi, "token-meter", "/a/index.ts", (p) => {
    p.on("session_start", () => { throw new Error("first boom"); });
    p.on("session_start", () => { throw new Error("second boom"); });
  });
  await assert.rejects(f.fire("session_start"), (err: any) => err instanceof AggregateError && err.errors.length === 2 && /first boom; second boom/.test(err.message));
  const g = fakePi();
  guardSingleCopy(g.pi, "experiments", "/b/index.ts", (p) => {
    p.on("session_start", () => { throw new Error("only boom"); });
  });
  await assert.rejects(g.fire("session_start"), (err: any) => err.constructor === Error && err.message === "only boom");
});

test("guardSingleCopy: the first copy releases its claim at session_shutdown", async () => {
  const b = bus();
  const one = fakePi(b);
  guardSingleCopy(one.pi, "experiments", "/a/index.ts", () => {});
  await one.fire("session_start");
  await one.fire("session_shutdown");
  let installed = false;
  const two = fakePi(b);
  guardSingleCopy(two.pi, "experiments", "/b/index.ts", () => void (installed = true));
  await two.fire("session_start");
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
