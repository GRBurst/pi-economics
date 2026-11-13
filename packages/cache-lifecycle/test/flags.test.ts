// warmPolicy / mainCacheTtl / maskOnCold: the level the experiments engine assigned the session, read from the internal
// channel (redesign §7.7, M5b.2: a query on pi.events, asking as the lever target "cache-lifecycle"), else the own setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { install } from "../core/shell.ts";
import { defaults } from "../core/settings.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";
import { asst, tool, user } from "./msgs.ts";

const LEVERS = "pi-economics:levers:v1";
const LEVERS_QUERY = "pi-economics:levers-query:v1";

/** An experiments engine on the bus: every session gets `flags` as factors over cache-lifecycle's levers; records the queries. */
const engine = (f: ReturnType<typeof fakePi>, flags: Record<string, string>, extra: Record<string, unknown> = {}) => {
  const asked: Array<[string, string | undefined]> = [];
  const factors = Object.fromEntries(Object.entries(flags).map(([n, v]) => [`f-${n}`, { lever: `cache-lifecycle.${n}`, assigned: v }]));
  f.pi.events.on(LEVERS_QUERY, (q: any) => {
    asked.push([q.sessionId, q.target]);
    q.reply({ sessionId: q.sessionId, eligible: true, arm: "010", factors, levers: {}, ...extra });
  });
  return asked;
};

const MIN = 60_000;
const big = (n: number) => "x".repeat(n * 4);
const msgs = () => [
  user("go"), asst("r1", [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }]), tool("c1", "bash", big(3000)),
  asst("r3", [{ type: "text", text: "ok" }]),
];
const setup = (settings: Partial<ReturnType<typeof defaults>> = {}, children: Array<{ name: string; sessionId: string; state: string }> = []) => {
  const f = fakePi();
  const clock = { now: 100 * MIN };
  install(f.pi as never, { settings: { ...defaults(), protectedTailTokens: 100, ...settings }, now: () => clock.now, api: () => ({ list: () => children as never, subscribe: () => () => {} }) });
  return f;
};
const req = () => ({ payload: { system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }], messages: [] } });
const ttlOf = (res: any) => res?.system[0].cache_control.ttl;
const decide = (f: ReturnType<typeof fakePi>, sid: string) => f.call("cache_warming_decision", { action: "stop" }, fakeCtx(sid));
const running = [{ name: "a", sessionId: "c1", state: "running" }];

test("defaults: warmPolicy is orchestrator-aware (the extension's own behaviour)", () => {
  assert.equal(defaults().warmPolicy, "orchestrator-aware");
});

test("warmPolicy native from the channel → pi's rule (undefined); own setting and no engine → orchestrator-aware warming", () => {
  assert.deepEqual(decide(setup({}, running), "main"), { action: "warm" });
  const f = setup({}, running);
  const asked = engine(f, { warmPolicy: "native" });
  assert.equal(decide(f, "main"), undefined);
  assert.deepEqual(asked.at(-1), ["main", "cache-lifecycle"]);
  const g = setup({ warmPolicy: "native" }, running);
  engine(g, { warmPolicy: "orchestrator-aware" });
  assert.deepEqual(decide(g, "main"), { action: "warm" });
});

test("mainCacheTtl 1h from the channel → main gets ttl 1h; a child (listed by the actor, or a child's Assigned) still 5m", () => {
  const f = setup({}, [{ name: "a", sessionId: "c1", state: "idle" }]);
  assert.equal(f.call("before_provider_request", req(), fakeCtx("main")), undefined);
  engine(f, { mainCacheTtl: "1h" });
  assert.equal(ttlOf(f.call("before_provider_request", req(), fakeCtx("main"))), "1h");
  assert.equal(f.call("before_provider_request", req(), fakeCtx("c1")), undefined);
  // An in-process child's runtime: the actor has not attached it yet, its Assigned names the root as parent.
  const c = setup();
  engine(c, { mainCacheTtl: "1h" }, { parentSessionId: "main" });
  assert.equal(c.call("before_provider_request", req(), fakeCtx("c2")), undefined);
});

test("maskOnCold from the channel: on → tools+thinking when the own setting is off, the own level otherwise; off → no masking", () => {
  const run = (own: "off" | "tools", flag: string) => {
    const f = setup({ maskOnCold: own });
    engine(f, { maskOnCold: flag });
    return f.call("context", { messages: [...msgs(), user("x"), asst("r4", [{ type: "text", text: big(500) }])] }, fakeCtx("s1"));
  };
  assert.match((run("off", "on") as any).messages[2].content[0].text, /^\[elided after cache expiry/);
  assert.match((run("tools", "on") as any).messages[2].content[0].text, /^\[elided/);
  assert.equal(run("tools", "off"), undefined);
  assert.equal(setup({ maskOnCold: "off" }).call("context", { messages: msgs() }, fakeCtx("s1")), undefined);
});

test("T5b2.4 cache-lifecycle asks as the lever target: at session_start, and when it hears an assignment (an engine started after it)", () => {
  const f = setup();
  const asked = engine(f, {});
  f.fire("session_start", { reason: "startup" }, fakeCtx("s1"));
  assert.deepEqual(asked, [["s1", "cache-lifecycle"]]);
  f.pi.events.emit(LEVERS, { sessionId: "s2", eligible: true, levers: {}, factors: { x: { lever: "cache-lifecycle.mainCacheTtl", assigned: "1h" } } });
  assert.deepEqual(asked.at(-1), ["s2", "cache-lifecycle"]);
  const n = asked.length;
  f.pi.events.emit(LEVERS, { sessionId: "s3", eligible: false, levers: {} }); // no cache-lifecycle lever: nothing to load
  assert.equal(asked.length, n);
});

test("T5b2.4 no global API is read: a stale __piExperimentsApi_v1 changes nothing", () => {
  (globalThis as { __piExperimentsApi_v1?: unknown }).__piExperimentsApi_v1 = { version: 1, flag: () => "1h", armFor: () => ({ id: "x" }) };
  try {
    assert.equal(setup().call("before_provider_request", req(), fakeCtx("main")), undefined);
  } finally {
    delete (globalThis as { __piExperimentsApi_v1?: unknown }).__piExperimentsApi_v1;
  }
});
