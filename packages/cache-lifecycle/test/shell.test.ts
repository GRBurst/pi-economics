import { test } from "node:test";
import assert from "node:assert/strict";
import { install } from "../core/shell.ts";
import { defaults } from "../core/settings.ts";
import { fakePi } from "./fake-pi.ts";

// --- masking on the first request after cache expiry ---
import { fakeCtx } from "./fake-pi.ts";
import { asst, tool, user } from "./msgs.ts";

const MIN = 60_000;
const big = (n: number) => "x".repeat(n * 4);
const base = () => [
  user("go"), asst("r1", [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }]), tool("c1", "bash", big(3000)),
  asst("r2", [{ type: "toolCall", id: "c2", name: "read", arguments: {} }]), tool("c2", "read", big(3000)),
  asst("r3", [{ type: "text", text: "ok" }]),
];
const setup = (settings: Partial<ReturnType<typeof defaults>> = {}) => {
  const f = fakePi();
  const clock = { now: 100 * MIN };
  const h = install(f.pi as never, { settings: { ...defaults(), maskOnCold: "tools", protectedTailTokens: 3000, ...settings }, now: () => clock.now });
  return { f, clock, h };
};
const ctx = fakeCtx("s1");
const ctxOf = (res: any) => res?.messages as any[] | undefined;
const respond = (f: ReturnType<typeof fakePi>, c = ctx) => f.fire("after_provider_response", { status: 200, headers: {} }, c);

test("cold first request: older tool results are stubbed and the masks are appended as a session entry", () => {
  const { f, clock } = setup();
  const out = ctxOf(f.call("context", { messages: base() }, ctx))!;
  assert.match(out[2].content[0].text, /^\[elided after cache expiry: 3000 tok; tool bash call c1;/);
  assert.equal(out[4].content[0].text.length, 12000, "inside the protected tail: untouched");
  assert.deepEqual(f.appended, [{ type: "cache-lifecycle/masks", data: { ids: ["tool:c1"], at: clock.now } }]);
});

test("warm follow-up request repeats the masked prefix byte for byte and appends nothing", () => {
  const { f, clock } = setup();
  const first = ctxOf(f.call("context", { messages: base() }, ctx))!;
  respond(f);
  clock.now += 1 * MIN;
  const longer = [...base(), user("more"), asst("r4", [{ type: "text", text: big(4000) }])]; // a cold plan would now mask c2
  const second = ctxOf(f.call("context", { messages: longer }, ctx))!;
  assert.equal(JSON.stringify(second.slice(0, first.length)), JSON.stringify(first));
  assert.equal(f.appended.length, 1);
});

test("a later cold request extends the masks with only the new ids", () => {
  const { f, clock } = setup();
  f.call("context", { messages: base() }, ctx);
  respond(f);
  clock.now += 6 * MIN;
  const longer = [...base(), user("more"), asst("r4", [{ type: "text", text: big(4000) }])];
  const out = ctxOf(f.call("context", { messages: longer }, ctx))!;
  assert.deepEqual(f.appended.map((e) => (e.data as any).ids), [["tool:c1"], ["tool:c2"]]);
  assert.match(out[4].content[0].text, /^\[elided/);
});

test("session_start rebuilds the masks from the branch: a resumed warm session sends the same prefix", () => {
  const entries = [{ type: "custom", customType: "cache-lifecycle/masks", data: { ids: ["tool:c1"], at: 1 } }, { type: "custom", customType: "other", data: {} }];
  const { f } = setup();
  const resumed = fakeCtx("s2", { entries });
  f.fire("session_start", { reason: "resume" }, resumed);
  respond(f, resumed);
  const out = ctxOf(f.call("context", { messages: base() }, resumed))!;
  assert.match(out[2].content[0].text, /^\[elided/);
  assert.equal(out[4].content[0].text.length, 12000);
  assert.deepEqual(f.appended, []);
});

test("masks belong to their session", () => {
  const { f } = setup();
  f.call("context", { messages: base() }, ctx);
  const other = fakeCtx("s3");
  respond(f, other);
  assert.equal(f.call("context", { messages: base() }, other), undefined, "s3: warm and nothing masked there");
});

test("maskOnCold off: context handler leaves messages alone", () => {
  const { f } = setup({ maskOnCold: "off" });
  assert.equal(f.call("context", { messages: base() }, ctx), undefined);
  assert.deepEqual(f.appended, []);
});

test("tools+thinking also drops old thinking blocks", () => {
  const { f } = setup({ maskOnCold: "tools+thinking" });
  const m = [user("go"), asst("r1", [{ type: "thinking", thinking: big(500) }, { type: "text", text: "a" }]), user("x"), asst("r2", [{ type: "text", text: big(4000) }])];
  const out = ctxOf(f.call("context", { messages: m }, ctx))!;
  assert.deepEqual(out[1].content, [{ type: "text", text: "a" }]);
  assert.deepEqual((f.appended[0].data as any).ids, ["think:r1:0"]);
});

// --- 1 h TTL for the main session ---
const req = () => ({ payload: { system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }], messages: [] } });
const ttlOf = (res: any) => res?.system[0].cache_control.ttl;
const withApi = (sessionIds: string[]) => ({ list: () => sessionIds.map((sessionId) => ({ sessionId })) });
const setupTtl = (settings: Partial<ReturnType<typeof defaults>>, api?: ReturnType<typeof withApi>) => {
  const f = fakePi();
  const clock = { now: 100 * MIN };
  install(f.pi as never, { settings: { ...defaults(), ...settings }, now: () => clock.now, api: () => api as never });
  return { f, clock };
};

test("mainCacheTtl 1h: the main session's requests get ttl 1h", () => {
  const { f } = setupTtl({ mainCacheTtl: "1h" }, withApi(["child-1"]));
  assert.equal(ttlOf(f.call("before_provider_request", req(), fakeCtx("main"))), "1h");
});

test("a child session (id listed by the subagents API) keeps the default TTL", () => {
  const { f } = setupTtl({ mainCacheTtl: "1h" }, withApi(["child-1"]));
  assert.equal(f.call("before_provider_request", req(), fakeCtx("child-1")), undefined);
});

test("mainCacheTtl 5m (default): payload untouched", () => {
  const { f } = setupTtl({}, withApi([]));
  assert.equal(f.call("before_provider_request", req(), fakeCtx("main")), undefined);
});

test("without the subagents API the session is the main one", () => {
  const { f } = setupTtl({ mainCacheTtl: "1h" });
  assert.equal(ttlOf(f.call("before_provider_request", req(), fakeCtx("main"))), "1h");
});

test("cache expiry follows the TTL in force: with 1h, six minutes after a request is still warm", () => {
  const { f, clock } = setupTtl({ mainCacheTtl: "1h", maskOnCold: "tools", protectedTailTokens: 3000 });
  const c = fakeCtx("main");
  f.fire("after_provider_response", { status: 200, headers: {} }, c);
  clock.now += 6 * MIN;
  assert.equal(f.call("context", { messages: base() }, c), undefined);
  clock.now += 55 * MIN;
  assert.ok(f.call("context", { messages: base() }, c));
});

// --- warming decision ---
type Info = { name: string; sessionId: string; state: "running" | "idle" | "paused" };
const mkApi = (infos: Info[]) => {
  const listeners: Array<(e: any) => void> = [];
  return { infos, list: () => infos as never, subscribe: (l: (e: any) => void) => (listeners.push(l), () => {}), emit: (e: unknown) => listeners.forEach((l) => l(e)) };
};
const setupWarm = (api?: ReturnType<typeof mkApi>) => {
  const f = fakePi();
  const clock = { now: 100 * MIN };
  install(f.pi as never, { settings: defaults(), now: () => clock.now, api: () => api });
  const decide = (c: string) => f.call("cache_warming_decision", { type: "cache_warming_decision", action: "stop" }, fakeCtx(c));
  return { f, clock, decide };
};

test("identityShim is on by default: the warming rules below rely on it (T7.0)", () => {
  assert.equal(defaults().identityShim, true);
  const f = fakePi();
  install(f.pi as never, { settings: defaults() });
  const orig = () => ({ entries: [], messages: [] });
  const sm = { getSessionId: () => "s", getBranch: () => [], buildSessionProjection: orig };
  f.fire("session_start", {}, { sessionManager: sm });
  assert.notEqual(sm.buildSessionProjection, orig, "the projection is wrapped");
});

test("main session with a running child: warm", () => {
  const { decide } = setupWarm(mkApi([{ name: "a", sessionId: "c1", state: "running" }]));
  assert.deepEqual(decide("main"), { action: "warm" });
});

test("main session with only idle children, or without the API: native rule", () => {
  assert.equal(setupWarm(mkApi([{ name: "a", sessionId: "c1", state: "idle" }])).decide("main"), undefined);
  assert.equal(setupWarm().decide("main"), undefined);
});

test("child that sent a message and waits: warm; a reply to it ends the wait", () => {
  const api = mkApi([{ name: "a", sessionId: "c1", state: "idle" }]);
  const { decide } = setupWarm(api);
  assert.equal(decide("c1"), undefined);
  api.emit({ type: "route", from: "a", to: "main", preview: "?", buffered: false, ts: 1 });
  assert.deepEqual(decide("c1"), { action: "warm" });
  api.emit({ type: "route", from: "main", to: "a", preview: "yes", buffered: false, ts: 2 });
  assert.equal(decide("c1"), undefined);
});

test("a paused or killed child is finished: stop", () => {
  const api = mkApi([{ name: "a", sessionId: "c1", state: "idle" }]);
  const { decide } = setupWarm(api);
  api.emit({ type: "route", from: "a", to: "main", preview: "?", buffered: false, ts: 1 });
  api.infos[0].state = "paused";
  assert.deepEqual(decide("c1"), { action: "stop" });
  api.infos[0].state = "idle";
  api.emit({ type: "kill", name: "a", ts: 3 });
  assert.equal(decide("c1"), undefined, "kill also ends the wait");
});

// Live check of 2026-10-03: actor-subagents' list() carries a `main`
// record carrying the MAIN session id (index.ts: the singleton record is
// refreshed to the foreground sessionId). It must not count as a child.
const MAIN = { name: "main", sessionId: "main", state: "running" as const };

test("mainCacheTtl 1h: main keeps its 1 h TTL when list() contains the main record", () => {
  const f = fakePi();
  install(f.pi as never, {
    settings: { ...defaults(), mainCacheTtl: "1h" },
    now: () => 100 * MIN,
    api: () => ({ list: () => [MAIN, { name: "a", sessionId: "c1", state: "idle" }] }) as never,
  });
  assert.equal(ttlOf(f.call("before_provider_request", req(), fakeCtx("main"))), "1h");
});

test("warming: the main record does not make the main session a child (main rule fires)", () => {
  const { decide } = setupWarm(mkApi([MAIN, { name: "a", sessionId: "c1", state: "running" }]));
  assert.deepEqual(decide("main"), { action: "warm" });
});

test("warming: without running children the main record alone defers to the native rule", () => {
  const { decide } = setupWarm(mkApi([MAIN, { name: "a", sessionId: "c1", state: "idle" }]));
  assert.equal(decide("main"), undefined);
});

test("cap: 60 minutes after the last real message, warming stops; warm pings do not extend it", () => {
  const { f, clock, decide } = setupWarm(mkApi([{ name: "a", sessionId: "c1", state: "running" }]));
  f.fire("message_end", { message: { role: "assistant" } }, fakeCtx("main"));
  clock.now += 59 * MIN;
  f.fire("after_provider_response", { status: 200, headers: {} }, fakeCtx("main"));
  assert.deepEqual(decide("main"), { action: "warm" });
  clock.now += 1 * MIN;
  assert.deepEqual(decide("main"), { action: "stop" });
});
