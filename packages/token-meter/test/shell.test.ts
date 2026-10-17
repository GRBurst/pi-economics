import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../core/shell.ts";
import { defaults } from "../core/settings.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

const P = "anthropic-ratelimit-";
const T0 = Date.parse("2026-10-02T12:00:00Z");
const usage = { input: 10, output: 5, cacheRead: 100, cacheWrite: 20, totalTokens: 135, reasoning: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 } };
const assistant = (extra: object = {}) => ({ type: "message_end", message: { role: "assistant",
  provider: "anthropic", model: "opus", usage, stopReason: "stop", thinkingLevel: "high", ...extra } });
const resp = { type: "after_provider_response", status: 200,
  headers: { [P + "unified-5h-utilization"]: "0.09", "request-id": "r" } };

function setup(over: Partial<Parameters<typeof install>[1]> = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "token-meter-shell-"));
  const clock = { t: T0 };
  const f = fakePi();
  install(f.pi, { agentDir, now: () => new Date(clock.t), ...over });
  const lines = (): any[] => {
    const file = join(agentDir, "meter", "2026-10.jsonl");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { f, agentDir, clock, lines };
}

test("response + assistant message_end → one turn line with quota, usage, effort", () => {
  const { f, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("session_start", {}, ctx);
  f.fire("before_provider_request", {}, ctx);
  f.fire("after_provider_response", resp, ctx);
  f.fire("message_end", assistant(), ctx);
  const [l, ...rest] = lines();
  assert.equal(rest.length, 0);
  assert.equal(l.kind, "turn"); assert.equal(l.sessionId, "s1"); assert.equal(l.status, 200);
  assert.equal(l.q5h, 9); assert.equal(l.input, 10); assert.equal(l.cacheRead, 100);
  assert.equal(l.cacheWrite, 20); assert.equal(l.output, 5); assert.equal(l.reasoning, 3);
  assert.equal(l.costUsd, 0.25); assert.equal(l.effort, "high");
  assert.equal(l.provider, "anthropic"); assert.equal(l.model, "opus");
  assert.equal(l.ts, new Date(T0).toISOString());
});

test("user message_end → no line", () => {
  const { f, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("message_end", { type: "message_end", message: { role: "user", content: "hi" } }, ctx);
  assert.deepEqual(lines(), []);
});

test("error message_end → status error, errorClass from message, no usage, no text", () => {
  const { f, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("message_end", assistant({ stopReason: "error", errorMessage: "429: daily cap SECRET", usage: undefined }), ctx);
  const [l] = lines();
  assert.equal(l.status, "error"); assert.equal(l.errorClass, "429");
  assert.equal("input" in l, false);
  assert.equal(JSON.stringify(l).includes("SECRET"), false);
});

test("warming: unconsumed snapshot flushed at next before_provider_request with cache_warm usage", () => {
  const { f, clock, lines } = setup();
  const entries: unknown[] = [];
  const ctx = fakeCtx("s1", { entries });
  f.fire("after_provider_response", resp, ctx); // warm ping, no message_end
  entries.push({ type: "usage", kind: "cache_warm", provider: "anthropic", model: "opus",
    timestamp: new Date(T0 + 1000).toISOString(), usage });
  clock.t = T0 + 5000;
  f.fire("before_provider_request", {}, ctx);
  const [l, ...rest] = lines();
  assert.equal(rest.length, 0);
  assert.equal(l.kind, "warming"); assert.equal(l.cacheRead, 100); assert.equal(l.costUsd, 0.25);
  assert.equal(l.q5h, 9); assert.equal(l.model, "opus");
  // the following turn does not get the old snapshot again
  f.fire("after_provider_response", { ...resp, headers: {} }, ctx);
  f.fire("message_end", assistant(), ctx);
  assert.equal(lines().length, 2);
  assert.equal(lines()[1].q5h, undefined);
});

test("warming: entries older than the snapshot are ignored; flushed on agent_settled and session_shutdown, written without usage", () => {
  const { f, lines } = setup();
  const old = { type: "usage", kind: "cache_warm", provider: "p", model: "m", timestamp: T0 - 1, usage };
  const ctx = fakeCtx("s1", { entries: [old] });
  f.fire("after_provider_response", resp, ctx);
  f.fire("agent_settled", {}, ctx);
  const ctx2 = fakeCtx("s2");
  f.fire("after_provider_response", resp, ctx2);
  f.fire("session_shutdown", {}, ctx2);
  const ls = lines();
  assert.equal(ls.length, 2);
  for (const l of ls) { assert.equal(l.kind, "warming"); assert.equal("input" in l, false); }
});

// D5 (2026-10-03 live check, L6): the warming line is flushed late -- when the
// session becomes active again -- but its ts must carry the warm RESPONSE time,
// so time-bucketed analyses see the ping where it hit the wire.
test("warming line's ts is the warm response time, not the flush time", () => {
  const { f, clock, lines } = setup();
  const entries: unknown[] = [];
  const ctx = fakeCtx("s1", { entries });
  f.fire("after_provider_response", resp, ctx); // the warm ping, at T0
  entries.push({ type: "usage", kind: "cache_warm", provider: "anthropic", model: "opus",
    timestamp: new Date(T0 + 1000).toISOString(), usage });
  clock.t = T0 + 83_000; // 83 s later the session becomes active again
  f.fire("agent_settled", {}, ctx);
  const [l] = lines();
  assert.equal(l.kind, "warming");
  assert.equal(l.ts, new Date(T0).toISOString());
});

test("no pending snapshot → nothing flushed", () => {
  const { f, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("before_provider_request", {}, ctx);
  f.fire("agent_settled", {}, ctx);
  f.fire("session_shutdown", {}, ctx);
  assert.deepEqual(lines(), []);
});

test("retries (started/completed/cancelled) are counted on the next turn line", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("session_start", {}, ctx);
  f.emit("pi-retry:started", { retryId: "a" });
  clock.t += 2000;
  f.emit("pi-retry:completed", { retryId: "a" });
  f.emit("pi-retry:started", { retryId: "b" });
  clock.t += 500;
  f.emit("pi-retry:cancelled", { retryId: "b" });
  f.fire("after_provider_response", resp, ctx);
  f.fire("message_end", assistant(), ctx);
  assert.equal(lines()[0].retries, 2); assert.equal(lines()[0].retryWaitMs, 2500);
});

// D1 (2026-10-03 live check, L4): pi-retry emits NUMBERS (retry.ts
// emitRetryLifecycleEvent(event, retryId: number), also for children); the real
// wire shape is { retryId: 1 }, not { retryId: "a" }.
test("numeric retryId (pi-retry's real event shape) is counted on the next turn line", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("session_start", {}, ctx);
  f.emit("pi-retry:started", { retryId: 1 });
  clock.t += 2000;
  f.emit("pi-retry:completed", { retryId: 1 });
  f.emit("pi-retry:started", { retryId: 2 });
  clock.t += 1500;
  f.emit("pi-retry:completed", { retryId: 2 });
  f.fire("after_provider_response", resp, ctx);
  f.fire("message_end", assistant(), ctx);
  assert.equal(lines()[0].retries, 2);
  assert.equal(lines()[0].retryWaitMs, 3500);
});

// D8 (2026-10-03 live check, L4): pi-retry emits `started` BEFORE the retried
// request and `completed` only in its finally, i.e. AFTER the retried request's
// message_end. The open episode must close on that (non-error) message_end — not
// on the late `completed` — or the wait lands on an unrelated later line.
test("D8: open retry closes on the retried request's ok message_end; late completed does not double-count", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("session_start", {}, ctx);
  f.fire("message_end", assistant({ stopReason: "error", errorMessage: "429: overloaded", usage: undefined }), ctx);
  assert.equal(lines()[0].retries, 0);
  f.emit("pi-retry:started", { retryId: 1 });
  clock.t += 3000;
  f.fire("after_provider_response", resp, ctx);
  f.fire("message_end", assistant(), ctx); // the retried request succeeds; `completed` still pending
  assert.equal(lines()[1].retries, 1);
  assert.ok(lines()[1].retryWaitMs > 0);
  f.emit("pi-retry:completed", { retryId: 1 }); // arrives after the message_end
  f.fire("message_end", assistant(), ctx);
  assert.equal(lines()[2].retries, 0); // the late completed must not double-count on the next line
});

test("arm comes from the experiments stub; absent → no arm key", () => {
  const withArm = setup({ arm: (sid) => `arm-of-${sid}` });
  const ctx = fakeCtx("s1");
  withArm.f.fire("message_end", assistant(), ctx);
  assert.equal(withArm.lines()[0].arm, "arm-of-s1");
  const without = setup();
  without.f.fire("message_end", assistant(), ctx);
  assert.equal("arm" in without.lines()[0], false);
});

test("parentSessionId from …/subagents/<parent>/… session file; none otherwise", () => {
  const { f, lines } = setup();
  f.fire("message_end", assistant(), fakeCtx("child", { file: "/x/sessions/subagents/parent-1/2026_child.jsonl" }));
  f.fire("message_end", assistant(), fakeCtx("top", { file: "/x/sessions/2026_top.jsonl" }));
  assert.equal(lines()[0].parentSessionId, "parent-1");
  assert.equal("parentSessionId" in lines()[1], false);
});

test("sessions are independent", () => {
  const { f, lines } = setup();
  const a = fakeCtx("a"), b = fakeCtx("b");
  f.fire("after_provider_response", resp, a);
  f.fire("message_end", assistant(), b);
  assert.equal(lines()[0].q5h, undefined);
});

test("settings.enabled=false installs nothing, writes nothing", () => {
  const { f, lines } = setup({ settings: { ...defaults(), enabled: false } });
  assert.equal(f.handlerCount(), 0);
  f.fire("message_end", assistant(), fakeCtx("s1"));
  assert.deepEqual(lines(), []);
});

test("settings.rawRatelimit=false omits rawRatelimit; custom dir is honoured", () => {
  const { f, agentDir } = setup({ settings: { ...defaults(), rawRatelimit: false, dir: "m2" } });
  const ctx = fakeCtx("s1");
  f.fire("after_provider_response", resp, ctx);
  f.fire("message_end", assistant(), ctx);
  const l = JSON.parse(readFileSync(join(agentDir, "m2", "2026-10.jsonl"), "utf8"));
  assert.equal("rawRatelimit" in l, false); assert.equal(l.q5h, 9);
});

test("write failure never throws into pi", () => {
  const blocker = join(mkdtempSync(join(tmpdir(), "token-meter-shell-")), "file");
  writeFileSync(blocker, "x"); // a file where a directory is needed → mkdir fails
  const { f } = setup({ agentDir: join(blocker, "sub") });
  assert.doesNotThrow(() => f.fire("message_end", assistant(), fakeCtx("s1")));
});

// T8.5: every line carries the experiment arm id, read from the process-global experiments API.
test("arm: lines carry armFor(sessionId).id from __piExperimentsApi_v1; children via inheritance; absent API → no arm field", () => {
  const g = globalThis as { __piExperimentsApi_v1?: unknown };
  try {
    const { f, lines } = setup();
    const turn = (sid: string) => { const ctx = fakeCtx(sid); f.fire("after_provider_response", resp, ctx); f.fire("message_end", assistant(), ctx); };
    turn("s-none");
    g.__piExperimentsApi_v1 = { version: 1, armFor: (sid: string) => (sid === "s-main" || sid === "s-child" ? { id: "+-+--", flags: {} } : undefined) };
    turn("s-main"); turn("s-child"); turn("s-other");
    const [none, main, child, other] = lines();
    assert.ok(!("arm" in none) && !("arm" in other));
    assert.equal(main.arm, "+-+--"); assert.equal(child.arm, "+-+--");
  } finally {
    delete g.__piExperimentsApi_v1;
  }
});
