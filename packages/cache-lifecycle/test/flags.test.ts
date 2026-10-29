// warmPolicy / mainCacheTtl / maskOnCold read through `__piExperimentsApi_v1.flag(name, own, sessionId)`.
// Absent API → the own setting.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { install } from "../core/shell.ts";
import { defaults } from "../core/settings.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";
import { asst, tool, user } from "./msgs.ts";

type G = { __piExperimentsApi_v1?: unknown };
const g = globalThis as G;
afterEach(() => void delete g.__piExperimentsApi_v1);
/** An experiments API whose arm sets `flags` for every session; records (name, def, sessionId). */
const arm = (flags: Record<string, string>) => {
  const calls: unknown[][] = [];
  g.__piExperimentsApi_v1 = { version: 1, flag: (n: string, d: string, s?: string) => (calls.push([n, d, s]), flags[n] ?? d) };
  return calls;
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

test("warmPolicy flag native → pi's rule (undefined); own setting and absent API → orchestrator-aware warming", () => {
  assert.deepEqual(decide(setup({}, running), "main"), { action: "warm" });
  const calls = arm({ warmPolicy: "native" });
  assert.equal(decide(setup({}, running), "main"), undefined);
  assert.deepEqual(calls.at(-1), ["warmPolicy", "orchestrator-aware", "main"]);
  arm({ warmPolicy: "orchestrator-aware" });
  assert.deepEqual(decide(setup({ warmPolicy: "native" }, running), "main"), { action: "warm" });
});

test("mainCacheTtl flag 1h → main gets ttl 1h, a child (listed by the subagents API) still 5m", () => {
  const f = setup({}, [{ name: "a", sessionId: "c1", state: "idle" }]);
  assert.equal(f.call("before_provider_request", req(), fakeCtx("main")), undefined);
  const calls = arm({ mainCacheTtl: "1h" });
  assert.equal(ttlOf(f.call("before_provider_request", req(), fakeCtx("main"))), "1h");
  assert.deepEqual(calls.at(-1), ["mainCacheTtl", "5m", "main"]);
  assert.equal(f.call("before_provider_request", req(), fakeCtx("c1")), undefined);
});

test("maskOnCold flag: on → tools+thinking when the own setting is off, the own level otherwise; off → no masking", () => {
  const run = (own: "off" | "tools", flag: string) => {
    arm({ maskOnCold: flag });
    return setup({ maskOnCold: own }).call("context", { messages: [...msgs(), user("x"), asst("r4", [{ type: "text", text: big(500) }])] }, fakeCtx("s1"));
  };
  assert.match((run("off", "on") as any).messages[2].content[0].text, /^\[elided after cache expiry/);
  assert.match((run("tools", "on") as any).messages[2].content[0].text, /^\[elided/);
  assert.equal(run("tools", "off"), undefined);
  delete g.__piExperimentsApi_v1;
  assert.equal(setup({ maskOnCold: "off" }).call("context", { messages: msgs() }, fakeCtx("s1")), undefined);
});
