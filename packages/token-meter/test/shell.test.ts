import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { install, type PiLike } from "../core/shell.ts";
import { parsePlans } from "../core/plans.ts";
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

/** A session's own request: the agent loop's `context` hook, then its send (a warm's send is the bare before_provider_request). */
const turnSend = (f: ReturnType<typeof fakePi>, ctx: unknown) => {
  f.fire("context", { type: "context", messages: [] }, ctx);
  f.fire("before_provider_request", {}, ctx);
};

/** The internal channel (experiments' core/channel.ts): a session's Levers (assignment and read-back states). */
const LEVERS = "pi-economics:levers:v1";
const LEVERS_QUERY = "pi-economics:levers-query:v1";
type Exp = (sid: string) => Record<string, unknown> | undefined;

/** `exp`: an experiments engine on the bus, answering every query with exp(sessionId) (levers {} unless it names some). */
function setup(over: Partial<Parameters<typeof install>[1]> = {}, exp?: Exp) {
  const agentDir = mkdtempSync(join(tmpdir(), "token-meter-shell-"));
  const clock = { t: T0 };
  const f = fakePi();
  if (exp) f.pi.events.on(LEVERS_QUERY, (q: any) => { const a = exp(q.sessionId); if (a) q.reply({ sessionId: q.sessionId, levers: {}, ...a }); });
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

test("billing: the provider's plan class on turn and warming lines; a provider without a plan counts as api", () => {
  const plans = parsePlans({ anthropic: { billing: "subscription", windows: ["5h"] }, "p-local": { billing: "local" } });
  const { f, lines } = setup({ settings: { ...defaults(), plans } });
  const ctx = fakeCtx("s1", { entries: [{ type: "usage", kind: "cache_warm", provider: "anthropic", model: "opus", timestamp: T0, usage }] });
  f.fire("message_end", assistant(), ctx);
  f.fire("message_end", assistant({ provider: "p-local" }), ctx);
  f.fire("message_end", assistant({ provider: "p-other" }), ctx);
  f.fire("after_provider_response", resp, ctx); // a warm
  f.fire("agent_settled", {}, ctx);
  assert.deepEqual(lines().map((l) => [l.kind, l.provider, l.billing]), [
    ["turn", "anthropic", "subscription"], ["turn", "p-local", "local"], ["turn", "p-other", "api"], ["warming", "anthropic", "subscription"]]);
  const plain = setup();
  plain.f.fire("message_end", assistant(), fakeCtx("s2"));
  assert.equal(plain.lines()[0].billing, "api", "no plans: every provider counts as api");
});

// P7: active (serving) time = the session's last send → its message_end; retry waits are not in it.
test("durationMs: the session's last own send → its message_end; a resend restarts it; a warm sent mid-stream does not", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1"), other = fakeCtx("s2");
  f.fire("session_start", {}, ctx);
  clock.t = T0 + 5000;
  turnSend(f, ctx);
  clock.t = T0 + 6000;
  turnSend(f, other); // another session's send
  clock.t = T0 + 6500;
  f.fire("message_end", assistant(), ctx);
  assert.equal(lines()[0].durationMs, 1500);
  // a failed attempt, then pi resends after 2 s
  clock.t = T0 + 10_000;
  turnSend(f, ctx);
  clock.t = T0 + 10_100;
  f.fire("message_end", assistant({ stopReason: "error", errorMessage: "529: overloaded", usage: undefined }), ctx);
  clock.t = T0 + 12_100;
  turnSend(f, ctx);
  clock.t = T0 + 13_000;
  f.fire("message_end", assistant(), ctx);
  assert.deepEqual(lines().slice(1).map((l) => [l.status, l.durationMs]), [["error", 100], [200, 900]]);
  // a warm sent while the turn streams
  clock.t = T0 + 20_000;
  turnSend(f, ctx);
  f.fire("after_provider_response", resp, ctx);
  f.fire("message_start", { message: { role: "assistant" } }, ctx);
  clock.t = T0 + 290_000;
  f.fire("before_provider_request", {}, ctx);
  clock.t = T0 + 420_000;
  f.fire("message_end", assistant(), ctx);
  assert.equal(lines()[3].durationMs, 400_000);
  // no send seen (e.g. a message_end replayed without its request): no measurement
  f.fire("message_end", assistant(), ctx);
  assert.equal("durationMs" in lines()[4], false);
  f.fire("message_end", assistant(), other);
  assert.equal(lines()[5].durationMs, 420_000 - 6000);
});

test("ttftMs: the session's send → its first provider_stream_event; absent without an event after the send", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1"), other = fakeCtx("s2");
  const ev = { type: "provider_stream_event", provider: "anthropic", api: "anthropic-messages", model: "opus", data: { type: "message_start" } };
  f.fire("provider_stream_event", ev, ctx); // before any send: no request to time
  clock.t = T0 + 1000;
  turnSend(f, ctx);
  turnSend(f, other);
  clock.t = T0 + 1100;
  f.fire("provider_stream_event", ev, other);
  clock.t = T0 + 1300;
  f.fire("provider_stream_event", ev, ctx);
  f.fire("message_start", { message: { role: "assistant" } }, ctx);
  clock.t = T0 + 1500;
  f.fire("provider_stream_event", ev, ctx);
  f.fire("before_provider_request", {}, ctx); // a warm, mid-stream
  clock.t = T0 + 1700;
  f.fire("provider_stream_event", ev, ctx);
  clock.t = T0 + 2500;
  f.fire("message_end", assistant(), ctx);
  f.fire("message_end", assistant(), other);
  assert.deepEqual(lines().map((l) => [l.sessionId, l.ttftMs, l.durationMs]), [["s1", 300, 1500], ["s2", 100, 1500]]);
  // the next request fails before any stream event: no ttftMs (the previous request's events do not carry over)
  clock.t = T0 + 3000;
  turnSend(f, ctx);
  clock.t = T0 + 3400;
  f.fire("message_end", assistant({ stopReason: "error", errorMessage: "500: x", usage: undefined }), ctx);
  assert.equal("ttftMs" in lines()[2], false);
  assert.equal(lines()[2].durationMs, 400);
});

// pi 1.4 normalises Anthropic's cache_creation.ephemeral_1h_input_tokens into usage.cacheWrite1h (pi-ai types.d.ts Usage).
test("cacheWrite1h: from pi's usage when the provider reports the 1 h split (0 included); absent otherwise", () => {
  const { f, lines } = setup();
  const ctx = fakeCtx("s1", { entries: [{ type: "usage", kind: "cache_warm", provider: "anthropic", model: "opus", timestamp: T0,
    usage: { ...usage, cacheWrite1h: 7 } }] });
  f.fire("message_end", assistant({ usage: { ...usage, cacheWrite1h: 20 } }), ctx);
  f.fire("message_end", assistant({ usage: { ...usage, cacheWrite1h: 0 } }), ctx);
  f.fire("message_end", assistant(), ctx);
  f.fire("after_provider_response", resp, ctx);
  f.fire("agent_settled", {}, ctx);
  assert.deepEqual(lines().map((l) => [l.kind, l.cacheWrite, l.cacheWrite1h]), [["turn", 20, 20], ["turn", 20, 0], ["turn", 20, undefined], ["warming", 20, 7]]);
  assert.equal("cacheWrite1h" in lines()[2], false);
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

test("error message_end → errorKind: context overflow (Anthropic, llama.cpp) apart from rate limits and other errors", () => {
  const { f, lines } = setup();
  const ctx = fakeCtx("s1");
  const fail = (errorMessage: string) => f.fire("message_end", assistant({ stopReason: "error", errorMessage, usage: undefined }), ctx);
  fail('400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 213462 tokens > 200000 maximum"}}');
  fail("400 the request exceeds the available context size, try increasing it");
  fail("429: rate limited");
  fail("500 boom");
  assert.deepEqual(lines().map((l) => [l.errorClass, l.errorKind]), [["400", "context_overflow"], ["400", "context_overflow"], ["429", "rate_limit"], ["500", "other"]]);
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

// pi 1.4 cache warming (CacheWarmer, cacheWarming "streaming"/"idle"): the warm
// timer runs 270 s (5-min TTL) from the START of a turn's request, so a turn that
// streams longer gets a warm request mid-stream, through the same
// before_provider_request/after_provider_response. A turn's own response always
// precedes its assistant message_start (the provider awaits onResponse before
// "start"); its cache_warm usage entry lands after the warm's result.
const warmUsage = { input: 0, output: 1, cacheRead: 359_332, cacheWrite: 0, totalTokens: 359_333,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.07 } };
const respQ = (q5h: string) => ({ ...resp, headers: { [P + "unified-5h-utilization"]: q5h } });
const streamingTurn = () => ({ type: "message_start", message: { role: "assistant", provider: "anthropic", model: "opus" } });

test("warm answered during a streaming turn: the turn keeps its own response, the warm gets a warming line with its cache_warm usage", () => {
  const { f, clock, lines } = setup();
  const entries: unknown[] = [];
  const ctx = fakeCtx("s1", { entries });
  f.fire("session_start", {}, ctx);
  const user = { message: { role: "user", content: "go" } }; // only assistant messages stream a response
  f.fire("message_start", user, ctx); f.fire("message_end", user, ctx);
  f.fire("before_provider_request", {}, ctx); // the turn's request
  f.fire("after_provider_response", respQ("0.09"), ctx); // the turn's headers, at T0
  f.fire("message_start", streamingTurn(), ctx);
  clock.t = T0 + 270_000;
  f.fire("before_provider_request", {}, ctx); // the warm's request, mid-stream
  clock.t = T0 + 280_000;
  f.fire("after_provider_response", respQ("0.13"), ctx); // the warm's headers
  entries.push({ type: "usage", kind: "cache_warm", provider: "anthropic", model: "opus",
    timestamp: new Date(T0 + 281_000).toISOString(), usage: warmUsage });
  clock.t = T0 + 400_000;
  f.fire("message_end", assistant(), ctx); // the turn ends
  f.fire("before_provider_request", {}, ctx); // the next turn's request
  const ls = lines();
  assert.deepEqual(ls.map((l) => l.kind).sort(), ["turn", "warming"]);
  const turn = ls.find((l) => l.kind === "turn"), warm = ls.find((l) => l.kind === "warming");
  assert.equal(turn.q5h, 9); assert.equal(turn.cacheRead, 100); assert.equal(turn.costUsd, 0.25);
  assert.equal(turn.ts, new Date(T0 + 400_000).toISOString());
  assert.equal(warm.q5h, 13); assert.equal(warm.cacheRead, 359_332); assert.equal(warm.output, 1);
  // M3a: a v2 warming line carries no `retries` (v1 had 0): pi's session retry never resends a warm
  assert.equal(warm.costUsd, 0.07); assert.equal("retries" in warm, false);
  assert.equal(warm.ts, new Date(T0 + 280_000).toISOString());
});

test("warm aborted during a streaming turn before its headers: only the turn's line, with the turn's quota", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("before_provider_request", {}, ctx);
  f.fire("after_provider_response", respQ("0.09"), ctx);
  f.fire("message_start", streamingTurn(), ctx);
  clock.t = T0 + 270_000;
  f.fire("before_provider_request", {}, ctx); // the warm's request; the next request aborts it
  clock.t = T0 + 287_000;
  f.fire("message_end", assistant(), ctx);
  f.fire("before_provider_request", {}, ctx);
  f.fire("agent_settled", {}, ctx);
  const [l, ...rest] = lines();
  assert.equal(rest.length, 0);
  assert.equal(l.kind, "turn"); assert.equal(l.q5h, 9); assert.equal(l.cacheRead, 100);
});

test("warm sent during a streaming turn, answered after its end: a warming line at the next request, the turn keeps its quota", () => {
  const { f, clock, lines } = setup();
  const entries: unknown[] = [];
  const ctx = fakeCtx("s1", { entries });
  f.fire("before_provider_request", {}, ctx);
  f.fire("after_provider_response", respQ("0.09"), ctx);
  f.fire("message_start", streamingTurn(), ctx);
  clock.t = T0 + 270_000;
  f.fire("before_provider_request", {}, ctx); // the warm's request
  clock.t = T0 + 271_000;
  f.fire("message_end", assistant(), ctx);
  clock.t = T0 + 275_000;
  f.fire("after_provider_response", respQ("0.13"), ctx); // the warm's headers, after the turn
  entries.push({ type: "usage", kind: "cache_warm", provider: "anthropic", model: "opus",
    timestamp: new Date(T0 + 276_000).toISOString(), usage: warmUsage });
  f.fire("before_provider_request", {}, ctx);
  const ls = lines();
  assert.deepEqual(ls.map((l) => [l.kind, l.q5h]), [["turn", 9], ["warming", 13]]);
  assert.equal(ls[1].cacheRead, 359_332);
});

test("no pending snapshot → nothing flushed", () => {
  const { f, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("before_provider_request", {}, ctx);
  f.fire("agent_settled", {}, ctx);
  f.fire("session_shutdown", {}, ctx);
  assert.deepEqual(lines(), []);
});

// D19, P18 (M3a): the retry extension is gone (M10); its bus events and their tests went with it. pi's native retry
// resends a failed attempt after a backoff: the failed attempt reaches message_end (stopReason "error"), then pi sends
// again with no message in between (agent-session _prepareRetry → agent.continue). The resent request's line carries
// `retries: 1` and `retryWaitMs` = its send − the failed attempt's message_end.
const failed = (errorMessage: string) => assistant({ stopReason: "error", errorMessage, usage: undefined });

test("native retry: send, 429, resend after 2000 ms, success → the success line has retries 1, retryWaitMs 2000", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1");
  turnSend(f, ctx);
  clock.t = T0 + 300;
  f.fire("message_end", failed("429: rate limited"), ctx);
  clock.t = T0 + 2300;
  turnSend(f, ctx);
  f.fire("after_provider_response", resp, ctx);
  clock.t = T0 + 3000;
  f.fire("message_end", assistant(), ctx);
  assert.deepEqual(lines().map((l) => [l.status, l.retries, l.retryWaitMs]), [["error", 0, 0], [200, 1, 2000]]);
});

test("native retry: a chain of failures puts each resend on its own line (Σ = attempts resent, Σ wait = backoff)", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1"), other = fakeCtx("s2");
  const send = (at: number, c = ctx) => { clock.t = T0 + at; turnSend(f, c); };
  const end = (at: number, m: unknown, c = ctx) => { clock.t = T0 + at; f.fire("message_end", m, c); };
  send(0); end(100, failed("529 overloaded"));
  send(1100); end(1200, failed("500 boom"));
  send(5200, other); end(5300, assistant(), other); // another session in between
  send(5200); end(6000, assistant());
  assert.deepEqual(lines().map((l) => [l.sessionId, l.retries, l.retryWaitMs]),
    [["s1", 0, 0], ["s1", 1, 1000], ["s2", 0, 0], ["s1", 1, 4000]]);
});

test("native retry: a context overflow is no retry; nor is a send after the run settled or after a new message", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1");
  const send = (at: number) => { clock.t = T0 + at; turnSend(f, ctx); };
  send(0); f.fire("message_end", failed("400 prompt is too long: 9 tokens > 8 maximum"), ctx);
  send(1000); f.fire("message_end", assistant(), ctx); // pi compacted and sent again: no retry
  send(2000); f.fire("message_end", failed("429: daily cap"), ctx);
  f.fire("agent_settled", {}, ctx); // no retry followed
  send(60_000); f.fire("message_end", assistant(), ctx);
  send(61_000); f.fire("message_end", failed("500 boom"), ctx);
  f.fire("message_end", { message: { role: "user", content: "queued" } }, ctx); // a queued message starts the next run
  send(62_000); f.fire("message_end", assistant(), ctx);
  assert.deepEqual(lines().map((l) => [l.status, l.retries, l.retryWaitMs]),
    [["error", 0, 0], [200, 0, 0], ["error", 0, 0], [200, 0, 0], ["error", 0, 0], [200, 0, 0]]);
});

test("native retry: every overflow pi-ai 1.4 names is no retry (pi compacts and resends), whatever its wording", () => {
  for (const msg of ["input is too long for requested model", "413", "Please reduce the length of the messages or completion",
    "prompt token count of 9 exceeds the limit of 8", "too many tokens"]) {
    const { f, clock, lines } = setup();
    const ctx = fakeCtx("s1");
    const send = (at: number) => { clock.t = T0 + at; turnSend(f, ctx); };
    send(0); f.fire("message_end", failed(msg), ctx);
    send(30_000); f.fire("message_end", assistant(), ctx); // the resend after compaction
    assert.deepEqual(lines().map((l) => [l.errorKind, l.retries, l.retryWaitMs]), [["context_overflow", 0, 0], [undefined, 0, 0]], msg);
  }
});

// pi 1.4's CacheWarmer replays a request straight to the provider: its send fires before_provider_request but no
// `context` event, which the agent loop fires before each of the session's own requests (sdk.js transformContext).
test("a warm's send (no context event) neither restarts durationMs nor ends a retry wait; the context handler changes nothing", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1");
  const own = (at: number) => {
    clock.t = T0 + at;
    assert.deepEqual(f.fireAll("context", { type: "context", messages: [] }, ctx), [undefined], "the messages stay as they are");
    f.fire("before_provider_request", {}, ctx);
  };
  const warmSend = (at: number) => { clock.t = T0 + at; f.fire("before_provider_request", {}, ctx); };
  own(0);
  warmSend(400); // a warm before the turn's message_start (a long prompt evaluation)
  f.fire("message_start", { message: { role: "assistant" } }, ctx);
  clock.t = T0 + 1000; f.fire("message_end", assistant(), ctx);
  own(2000);
  clock.t = T0 + 2100; f.fire("message_end", failed("429: x"), ctx);
  warmSend(3000); // a warm in the backoff window
  own(4100);
  clock.t = T0 + 5000; f.fire("message_end", assistant(), ctx);
  assert.deepEqual(lines().map((l) => [l.status, l.durationMs, l.retries, l.retryWaitMs]),
    [[200, 1000, 0, 0], ["error", 100, 0, 0], [200, 900, 1, 2000]]);
});

test("native retry: warming lines carry no retries (pi's session retry never resends a warm: not observed, so absent)", () => {
  const { f, lines } = setup();
  const ctx = fakeCtx("s1");
  f.fire("message_end", failed("429: x"), ctx);
  f.fire("after_provider_response", resp, ctx); // a warm
  f.fire("before_provider_request", {}, ctx);
  const warm = lines().find((l) => l.kind === "warming");
  assert.ok(warm);
  assert.ok(!("retries" in warm) && !("retryWaitMs" in warm));
});

test("one bus listener: the internal channel's levers publications (D19's retry events retired; M5b.2)", () => {
  const names: string[] = [];
  const pi = { on: () => {}, events: { on: (n: string) => (names.push(n), () => {}), emit: () => {} } };
  install(pi as PiLike, { agentDir: mkdtempSync(join(tmpdir(), "token-meter-shell-")) });
  assert.deepEqual(names, [LEVERS]);
});

test("arm comes from the internal channel; no engine → no arm key", () => {
  const withArm = setup({}, (sid) => ({ eligible: true, arm: `arm-of-${sid}` }));
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
  // review n1: only the subagents/<root>/ directory that holds the file (the actor's layout) names a parent
  f.fire("message_end", assistant(), fakeCtx("deep", { file: "/x/subagents/proj/sessions/2026_deep.jsonl" }));
  assert.equal(lines()[0].parentSessionId, "parent-1");
  assert.equal("parentSessionId" in lines()[1], false);
  assert.equal("parentSessionId" in lines()[2], false);
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

// Every line carries the experiment arm id, read from the internal channel (M5b.2; the process-global API is gone).
test("arm: lines carry the session's arm from the channel; a session the engine does not know → no arm field", () => {
  let on = false;
  const { f, lines } = setup({}, (sid) => (on && (sid === "s-main" || sid === "s-child") ? { eligible: true, arm: "+-+--" } : undefined));
  const turn = (sid: string) => { const ctx = fakeCtx(sid); f.fire("after_provider_response", resp, ctx); f.fire("message_end", assistant(), ctx); };
  turn("s-none");
  on = true;
  turn("s-main"); turn("s-child"); turn("s-other");
  const [none, main, child, other] = lines();
  assert.ok(!("arm" in none) && !("arm" in other));
  assert.equal(main.arm, "+-+--"); assert.equal(child.arm, "+-+--");
  // M3a T3a.9: `design` is written iff the assignment names one (a v1-engine row names none before v2).
  assert.ok(!("design" in main) && !("design" in child));
});

test("T5b2.5 no global API is read: a stale __piExperimentsApi_v1 changes nothing", () => {
  const g = globalThis as { __piExperimentsApi_v1?: unknown };
  g.__piExperimentsApi_v1 = { version: 1, armFor: () => ({ id: "+-+--", flags: {} }) };
  try {
    const { f, lines } = setup();
    f.fire("message_end", assistant(), fakeCtx("s1"));
    assert.equal("arm" in lines()[0], false);
  } finally {
    delete g.__piExperimentsApi_v1;
  }
});

test("M5b.1 carry-over 1: an arm of the v2 engine names its design and stratum: request and levers lines carry them", () => {
  {
    const { f, lines } = setup({ env: {} }, () => ({ eligible: true, arm: "010", design: "b4d458675108", stratum: "api" }));
    const ctx = fakeCtx("s-v2");
    agentStart(f, ctx);
    f.fire("after_provider_response", resp, ctx);
    f.fire("message_end", assistant(), ctx);
    const [lev, req] = lines();
    assert.deepEqual([lev.kind, lev.arm, lev.design, lev.stratum, lev.eligible], ["levers", "010", "b4d458675108", "api", true]);
    assert.deepEqual([req.arm, req.design, "stratum" in req], ["010", "b4d458675108", false]); // no stratum on request lines
  }
});

// --- M3b: levers lines (design §5.3, §8.1) ---
const agentStart = (f: ReturnType<typeof fakePi>, ctx: unknown) => f.fireAll("before_agent_start", { type: "before_agent_start", prompt: "p" }, ctx);
const putJson = (file: string, v: unknown) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(v)); };
const leversOf = (ls: any[]) => ls.filter((l) => l.kind === "levers");

test("levers: one line at the session's first before_agent_start (global + trusted project settings), none while nothing changes", () => {
  const { f, agentDir, lines } = setup({ env: {} });
  putJson(join(agentDir, "settings.json"), { transport: "sse", retry: { maxRetries: 5 } });
  const cwd = mkdtempSync(join(tmpdir(), "token-meter-project-"));
  putJson(join(cwd, ".pi", "settings.json"), { retry: { maxRetries: 1 } });
  const ctx = fakeCtx("s1", { cwd, trusted: true, model: { provider: "anthropic", id: "opus" } });
  assert.deepEqual(agentStart(f, ctx), [undefined], "the handler changes nothing");
  turnSend(f, ctx); f.fire("message_end", assistant(), ctx);
  agentStart(f, ctx); turnSend(f, ctx); f.fire("message_end", assistant(), ctx);
  const ls = lines();
  assert.deepEqual(ls.map((l) => l.kind), ["levers", "turn", "turn"]);
  const [l] = ls;
  assert.deepEqual(Object.keys(l), ["v", "ts", "sessionId", "kind", "eligible", "levers"]);
  assert.deepEqual([l.v, l.ts, l.sessionId, l.eligible], [2, new Date(T0).toISOString(), "s1", false]);
  assert.deepEqual(l.levers["pi.transport"], { v: "sse", s: "fixed" });
  assert.deepEqual(l.levers["pi.retry.maxRetries"], { v: 1, s: "fixed" });
  assert.deepEqual(l.levers["pi.retry.baseDelayMs"], { v: 2000, s: "fixed" });
  assert.deepEqual(l.levers["pi.promptCache"], { v: "short", s: "fixed" });
});

test("levers: an untrusted project's settings are not pi's; PI_CACHE_RETENTION sets promptCache", () => {
  const { f, lines } = setup({ env: { PI_CACHE_RETENTION: "long" } });
  const cwd = mkdtempSync(join(tmpdir(), "token-meter-project-"));
  putJson(join(cwd, ".pi", "settings.json"), { transport: "websocket" });
  agentStart(f, fakeCtx("s1", { cwd, trusted: false }));
  const [l] = lines();
  assert.equal(l.levers["pi.transport"].v, "auto");
  assert.equal(l.levers["pi.promptCache"].v, "long");
});

test("levers: a new line only when a lever, the arm or the model's levers change", () => {
  let arm: string | undefined;
  const { f, agentDir, clock, lines } = setup({ env: {} }, () => (arm === undefined ? undefined : { eligible: true, arm }));
  putJson(join(agentDir, "settings.json"), { compaction: { modelOverrides: { "anthropic/opus": { reserveTokens: 9000 } } } });
  const opts: any = { model: { provider: "anthropic", id: "sonnet" } };
  const ctx = fakeCtx("s1", opts);
  agentStart(f, ctx);
  clock.t += 1000; agentStart(f, ctx); // nothing changed
  clock.t += 1000; opts.model = { provider: "anthropic", id: "opus" }; agentStart(f, ctx); // per-model lever
  clock.t += 1000; agentStart(f, ctx);
  clock.t += 1000; putJson(join(agentDir, "settings.json"), { transport: "sse", compaction: { modelOverrides: { "anthropic/opus": { reserveTokens: 9000 } } } }); agentStart(f, ctx);
  clock.t += 1000; arm = "+-+--"; agentStart(f, ctx);
  const ls = leversOf(lines());
  assert.deepEqual(ls.map((l) => Date.parse(l.ts) - T0), [0, 2000, 4000, 5000]);
  assert.deepEqual(ls.map((l) => l.levers["pi.compaction.reserveTokens"].v), [16384, 9000, 9000, 9000]);
  assert.deepEqual(ls.map((l) => l.levers["pi.transport"].v), ["auto", "auto", "sse", "sse"]);
  assert.deepEqual(ls.map((l) => [l.arm, l.eligible]), [[undefined, false], [undefined, false], [undefined, false], ["+-+--", true]]);
});

test("levers: per session; a child carries parentSessionId and is never eligible, even with its parent's arm", () => {
  const { f, lines } = setup({ env: {} }, () => ({ eligible: true, arm: "+-+--" }));
  agentStart(f, fakeCtx("main"));
  agentStart(f, fakeCtx("child", { file: "/x/sessions/subagents/main/2026_child.jsonl" }));
  agentStart(f, fakeCtx("main"));
  const [m, c, ...rest] = lines();
  assert.equal(rest.length, 0);
  assert.deepEqual([m.sessionId, m.parentSessionId, m.arm, m.eligible], ["main", undefined, "+-+--", true]);
  assert.deepEqual([c.sessionId, c.parentSessionId, c.arm, c.eligible], ["child", "main", "+-+--", false]);
});

// M5b.2 (design §5.3, §7.4): pi-economics' own levers and their read-back come from the engine on the internal channel.
const PE = {
  "cache-lifecycle.warmPolicy": { v: "native", s: "pe", a: "native", rb: "unverified", tier: "replace" },
  "cache-lifecycle.mainCacheTtl": { v: "1h", s: "pe", a: "1h", rb: "unverified", tier: "replace" },
};

test("T5b2.5 levers: the engine's lever states join the line beside pi's settings; eligible is the engine's", () => {
  const { f, lines } = setup({ env: {} }, () => ({ eligible: true, design: "b4d458675108", stratum: "api", arm: "010", levers: PE }));
  agentStart(f, fakeCtx("s1"));
  const [l] = lines();
  assert.deepEqual([l.arm, l.design, l.stratum, l.eligible], ["010", "b4d458675108", "api", true]);
  assert.deepEqual(l.levers["cache-lifecycle.warmPolicy"], PE["cache-lifecycle.warmPolicy"]);
  assert.deepEqual(l.levers["cache-lifecycle.mainCacheTtl"], PE["cache-lifecycle.mainCacheTtl"]);
  assert.deepEqual(l.levers["pi.transport"], { v: "auto", s: "fixed" });
  const off = setup({ env: {} }, () => ({ eligible: false, design: "b4d458675108", stratum: "api" }));
  agentStart(off.f, fakeCtx("s2"));
  assert.deepEqual(["arm" in off.lines()[0], off.lines()[0].eligible], [false, false]);
});

test("T5b2.5 levers: a publication that changes a session's states writes a new line; the same states or an unseen session do not", () => {
  let levers: Record<string, unknown> = PE;
  const { f, clock, lines } = setup({ env: {} }, () => ({ eligible: true, arm: "010", levers }));
  const pub = (sid: string) => f.pi.events.emit(LEVERS, { sessionId: sid, eligible: true, arm: "010", levers });
  pub("s1");
  assert.deepEqual(lines(), [], "no line before the session's first prompt");
  agentStart(f, fakeCtx("s1"));
  clock.t += 1000; pub("s1");
  levers = { ...PE, "cache-lifecycle.mainCacheTtl": { v: "1h", s: "pe", a: "1h", rb: "confirmed", tier: "replace" } };
  clock.t += 1000; pub("s1");
  pub("s2");
  const ls = leversOf(lines());
  assert.deepEqual(ls.map((l) => [l.sessionId, Date.parse(l.ts) - T0, l.levers["cache-lifecycle.mainCacheTtl"].rb]), [["s1", 0, "unverified"], ["s1", 2000, "confirmed"]]);
  assert.deepEqual(ls[1].levers["pi.transport"], { v: "auto", s: "fixed" }, "the settings levers of the last prompt stay");
});

// Review m2: a stratum may assign a level that is no level name ("1H"); the engine then reports it as `a`. Only that state
// goes (one warning per lever id); the line, pi's settings levers, the arm and the other states stay.
test("review m2: an engine state that breaks the levers rules is dropped alone, with one warning per lever id; the line is written", () => {
  const bad = { v: "5m", s: "fixed", a: "1H", rb: "refused", tier: "replace" };
  let levers: Record<string, unknown> = { ...PE, "cache-lifecycle.mainCacheTtl": bad };
  const errs: unknown[][] = [];
  const oe = console.error;
  console.error = (...x: unknown[]) => void errs.push(x);
  try {
    const { f, clock, lines } = setup({ env: {} }, () => ({ eligible: true, arm: "1", stratum: "api", levers }));
    agentStart(f, fakeCtx("s1"));
    levers = { ...levers, "cache-lifecycle.warmPolicy": { v: "native", s: "pe", a: "native", rb: "confirmed", tier: "replace" } };
    clock.t += 1000;
    f.pi.events.emit(LEVERS, { sessionId: "s1", eligible: true, arm: "1", stratum: "api", levers });
    const ls = leversOf(lines());
    assert.equal(ls.length, 2, "both lines written");
    for (const l of ls) {
      assert.equal("cache-lifecycle.mainCacheTtl" in l.levers, false);
      assert.deepEqual([l.arm, l.stratum, l.eligible], ["1", "api", true]);
      assert.deepEqual(l.levers["pi.transport"], { v: "auto", s: "fixed" });
    }
    assert.deepEqual(ls[1].levers["cache-lifecycle.warmPolicy"].rb, "confirmed");
    assert.equal(errs.length, 1, "one warning for the lever id");
    assert.ok(String(errs[0].join(" ")).includes("cache-lifecycle.mainCacheTtl"));
  } finally {
    console.error = oe;
  }
});

test("T5b2.5 an in-memory child (no session file): parent from the channel; its levers line is never eligible", () => {
  const { f, lines } = setup({ env: {} }, () => ({ eligible: true, arm: "010", parentSessionId: "m1" }));
  const ctx = fakeCtx("c1");
  agentStart(f, ctx);
  f.fire("message_end", assistant(), ctx);
  const [l, r] = lines();
  assert.deepEqual([l.parentSessionId, l.arm, l.eligible], ["m1", "010", false]);
  assert.deepEqual([r.parentSessionId, r.arm], ["m1", "010"]);
  const file = setup({}, () => ({ eligible: true, arm: "010", parentSessionId: "m1" }));
  file.f.fire("message_end", assistant(), fakeCtx("c2", { file: "/x/sessions/subagents/m0/2026_c2.jsonl" }));
  assert.equal(file.lines()[0].parentSessionId, "m0", "the session file decides when it names a parent");
});

test("levers: unreadable settings read as pi's defaults; a ctx without model, cwd or trust still gets a line; never throws", () => {
  const { f, agentDir, lines } = setup({ env: {} });
  writeFileSync(join(agentDir, "settings.json"), "{ not json");
  const bare = { sessionManager: { getSessionId: () => "s1" } };
  assert.doesNotThrow(() => agentStart(f, bare));
  const [l] = lines();
  assert.equal(l.levers["pi.transport"].v, "auto");
  assert.equal(l.levers["pi.compaction.reserveTokens"].v, 16384);
  assert.doesNotThrow(() => agentStart(f, {}));
});

test("levers: infinite-context's settings entry on the branch → pi.compaction.enabled {false, ext} (IC cancels pi's compaction)", () => {
  const { f, clock, lines } = setup({ env: {} });
  const IC = { type: "custom", id: "e1", customType: "infinite-context:settings", data: { nudgeAtTokens: 100000 } };
  const opts: any = { branch: [{ type: "custom", customType: "other:settings", data: {} }, { type: "message", message: { role: "user" } }] };
  const ctx = fakeCtx("s1", opts);
  agentStart(f, ctx);
  clock.t += 1000; opts.branch = [...opts.branch, IC]; agentStart(f, ctx);
  agentStart(f, fakeCtx("s2", { branch: [IC] }));
  const [before, after, other] = leversOf(lines());
  assert.deepEqual(before.levers["pi.compaction.enabled"], { v: true, s: "fixed" });
  assert.deepEqual(after.levers["pi.compaction.enabled"], { v: false, s: "ext" });
  assert.deepEqual(other.levers["pi.compaction.enabled"], { v: false, s: "ext" });
  // the other compaction levers are still recorded (inert while IC is loaded; the analyser skips them)
  assert.deepEqual(after.levers["pi.compaction.reserveTokens"], { v: 16384, s: "fixed" });
});

// --- M3b: compaction metering. pi 1.4's compact() calls the model outside the agent loop: no before_provider_request,
// after_provider_response or message_end; only session_compact (its compactionEntry.usage) shows the request. ---
const compactEvent = (extra: object = {}) => ({ type: "session_compact", reason: "threshold", fromExtension: false,
  compactionEntry: { type: "compaction", id: "c1", summary: "s", firstKeptEntryId: "e1", tokensBefore: 150000, usage }, ...extra });

test("compaction: session_compact with usage → one kind compaction line, the session's model, usage and cost, no timing or retries", () => {
  const plans = parsePlans({ anthropic: { billing: "subscription", windows: ["5h"] } });
  const { f, lines } = setup({ settings: { ...defaults(), plans } }, () => ({ eligible: true, arm: "+-+--" }));
  const ctx = fakeCtx("s1", { model: { provider: "anthropic", id: "opus" }, file: "/x/sessions/subagents/p/2026_s1.jsonl" });
  turnSend(f, ctx); f.fire("message_end", assistant(), ctx);
  f.fire("session_compact", compactEvent(), ctx);
  const [, c, ...rest] = lines();
  assert.equal(rest.length, 0);
  assert.deepEqual(c, { v: 2, ts: new Date(T0).toISOString(), sessionId: "s1", parentSessionId: "p", arm: "+-+--", provider: "anthropic",
    model: "opus", kind: "compaction", billing: "subscription", input: 10, cacheRead: 100, cacheWrite: 20, output: 5, reasoning: 3,
    costUsd: 0.25, status: 200 });
});

test("compaction: an extension's summary has an unknown model; no usage → no line; the next turn keeps its own timing", () => {
  const { f, clock, lines } = setup();
  const ctx = fakeCtx("s1", { model: { provider: "anthropic", id: "opus" } });
  f.fire("session_compact", compactEvent({ fromExtension: true }), ctx);
  f.fire("session_compact", compactEvent({ compactionEntry: { type: "compaction", summary: "s" } }), ctx);
  turnSend(f, ctx);
  clock.t += 700;
  f.fire("session_compact", compactEvent(), ctx); // a compaction while a turn is out (not pi 1.4, but harmless)
  f.fire("message_end", assistant(), ctx);
  const ls = lines();
  assert.deepEqual(ls.map((l) => [l.kind, l.provider, l.model]), [["compaction", "unknown", "unknown"], ["compaction", "anthropic", "opus"], ["turn", "anthropic", "opus"]]);
  assert.equal(ls[2].durationMs, 700);
});

// --- M3b: systemHash (M2a review carry-over: the `prefix` cause of a cache miss) ---
test("systemHash: a turn line carries the hash of its last context_with_system; none without one; warming lines never", () => {
  const { f, clock, lines } = setup();
  const sysMsg = (content: string) => ({ role: "system", content, timestamp: 0 });
  const ctx = fakeCtx("s1", { entries: [{ type: "usage", kind: "cache_warm", provider: "anthropic", model: "opus", timestamp: T0, usage }] });
  const send = (content: string) => {
    f.fire("context", { type: "context", messages: [] }, ctx);
    assert.deepEqual(f.fireAll("context_with_system", { type: "context_with_system", messages: [sysMsg(content), { role: "user", content: "x" }] }, ctx), [undefined]);
    f.fire("before_provider_request", {}, ctx);
  };
  send("A"); f.fire("message_end", assistant(), ctx);
  send("A"); f.fire("after_provider_response", resp, ctx); f.fire("message_end", assistant(), ctx);
  send("B"); f.fire("message_end", assistant(), ctx);
  clock.t += 1000;
  f.fire("after_provider_response", resp, ctx); // a warm
  turnSend(f, ctx); // a send without context_with_system (an older pi): unknown
  f.fire("message_end", assistant(), ctx);
  const [a1, a2, b, warm, none] = lines();
  assert.equal(warm.kind, "warming");
  assert.match(a1.systemHash, /^[0-9a-f]{16}$/);
  assert.equal(a2.systemHash, a1.systemHash);
  assert.notEqual(b.systemHash, a1.systemHash);
  assert.ok(!("systemHash" in warm) && !("systemHash" in none));
  // other sessions keep their own
  f.fire("message_end", assistant(), fakeCtx("s2"));
  assert.ok(!("systemHash" in lines().at(-1)));
});

test("levers: a levers line that cannot be written warns once on its own; a later meter line failure still warns (M3b review F8)", (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const { f, agentDir } = setup({ env: {} });
  writeFileSync(join(agentDir, "meter"), "not a directory");
  const ctx = fakeCtx("s1", { model: { provider: "anthropic", id: "opus" } });
  agentStart(f, ctx); agentStart(f, ctx);
  turnSend(f, ctx); f.fire("message_end", assistant(), ctx);
  turnSend(f, ctx); f.fire("message_end", assistant(), ctx);
  assert.deepEqual(errors.mock.calls.map((c) => String(c.arguments[0])), ["token-meter: cannot write levers line:", "token-meter: cannot write meter line:"]);
});
