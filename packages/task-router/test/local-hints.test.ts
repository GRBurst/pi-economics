// Local mode L3.T7 (design §3.1.1, §3.1.2, §3.1.4; plan S12, D14, D17, Q5): the main session's hints, end to end through the
// shell. Tool calls are fired like pi does (tool_call, then tool_result with the same toolCallId); file hashes come from a map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusText } from "../core/local/mode.ts";
import { ESCALATION, HINT_TEXT, block } from "../core/local/hints.ts";
import { defaults } from "../core/settings.ts";
import { harness } from "./harness.ts";

const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
type Out = { content: { type: string; text: string }[] } | undefined;

function rig(settings: Record<string, unknown> = { mode: "local" }, extra: Record<string, unknown> = {}) {
  const files = new Map<string, string>();
  const h = harness({ settings: settings as never, extra: { hash: (abs: string) => files.get(abs), ...extra } as never });
  const usage = { tokens: 1000, percent: 10 };
  const status: [string, string | undefined][] = [];
  const ctx = { ...MAIN, cwd: "/work", getContextUsage: () => usage, hasUI: true, ui: { setStatus: (k: string, v: string | undefined) => void status.push([k, v]), notify: () => undefined } };
  h.f.fire("session_start", {}, ctx);
  let n = 0;
  /** One call and its result; `between` runs while the tool "executes". */
  const pair = (toolName: string, input: unknown, o: { isError?: boolean; text?: string; between?: () => void } = {}) => {
    const id = `tc${++n}`;
    const calls = h.f.fire("tool_call", { toolName, toolCallId: id, input }, ctx);
    o.between?.();
    const content = [{ type: "text", text: o.text ?? `result ${id}` }];
    const results = h.f.fire("tool_result", { toolName, toolCallId: id, input, content, isError: o.isError ?? false }, ctx);
    const defined = results.filter((r) => r !== undefined) as Out[];
    assert.ok(defined.length <= 1, "one handler annotates");
    return { calls, content, out: defined[0] };
  };
  const hints = () => h.lines().filter((l) => l.event === "hint").map(({ v, ts, event, ...rest }) => rest);
  return { h, files, usage, status, ctx, pair, hints };
}
const H = defaults().hints, P = defaults().plans;
const READ_A = ["read", { path: "a.ts" }] as const;

test("AC-H2: the third identical call's result gets exactly one identical-call block; the fourth adds nothing; one hint line", () => {
  const { pair, hints } = rig();
  for (let i = 0; i < 2; i++) assert.equal(pair(...READ_A).out, undefined);
  const third = pair(...READ_A);
  assert.ok(third.calls.length > 0 && third.calls.every((r) => r === undefined), "tool_call never returns a value");
  assert.deepEqual(third.out!.content.slice(0, 1), third.content);
  assert.equal(third.out!.content.length, 2);
  assert.match(third.out!.content[1].text, /^<router-hint trip="identical-call" n="1">/);
  assert.deepEqual(third.out!.content[1], { type: "text", text: block("identical-call", 1, HINT_TEXT["identical-call"](H, P)) });
  assert.equal(pair(...READ_A).out, undefined); // within cooldownCalls
  assert.deepEqual(hints(), [{ taskId: "main", trip: "identical-call", stage: "hint", count: 1, sessionId: "s-main" }]);
});

test("AC-H4 (L3): the fifth identical call gets the fixed escalation; nothing is spawned or sent; a steer line", () => {
  const { h, pair, hints } = rig();
  for (let i = 0; i < 4; i++) pair(...READ_A);
  const fifth = pair(...READ_A);
  assert.equal(fifth.out!.content.length, 2);
  assert.deepEqual(fifth.out!.content[1], { type: "text", text: block("identical-call", 3, ESCALATION) });
  assert.deepEqual(h.a.sent, []);
  assert.deepEqual(h.f.sent, []);
  assert.ok(!h.lines().some((l) => l.event === "spawn"));
  assert.deepEqual(hints().map((l) => [l.stage, l.count]), [["hint", 1], ["steer", 3]]);
});

test("progress: an edit that changes its file's hash between the repeats prevents the trip; a no-op edit does not", () => {
  const { files, pair } = rig();
  files.set("/work/f.ts", "h1");
  pair(...READ_A);
  pair(...READ_A);
  pair("edit", { path: "f.ts", oldText: "x", newText: "y" }, { between: () => files.set("/work/f.ts", "h2") });
  assert.equal(pair(...READ_A).out, undefined);
  assert.equal(pair(...READ_A).out, undefined);
  const g = rig();
  g.files.set("/work/f.ts", "h1");
  g.pair(...READ_A);
  g.pair(...READ_A);
  g.pair("edit", { path: "f.ts", oldText: "x", newText: "x" }); // the hash stays: no progress
  assert.match(g.pair(...READ_A).out!.content[1].text, /^<router-hint trip="identical-call" n="1">/);
});

test("turn-end queue: stallTurns turns at or above contextPercent → the next tool result carries context-stall", () => {
  const { h, usage, ctx, pair, hints } = rig({ mode: "local", hints: { stallTurns: 3 } });
  usage.percent = 90;
  for (let i = 0; i < 3; i++) h.f.fire("turn_end", { message: { stopReason: "toolUse" }, toolResults: [] }, ctx);
  const r = pair("read", { path: "b.ts" });
  assert.equal(r.out!.content.length, 2);
  assert.match(r.out!.content[1].text, /^<router-hint trip="context-stall" n="1">/);
  assert.equal(pair("read", { path: "c.ts" }).out, undefined); // delivered once
  assert.deepEqual(hints().map((l) => l.trip), ["context-stall"]);
});

test("context-soft: the result of the call that crosses contextSoftTokens carries it, once", () => {
  const { usage, pair } = rig();
  assert.equal(pair("read", { path: "b.ts" }).out, undefined);
  usage.tokens = 40_000;
  assert.deepEqual(pair("read", { path: "c.ts" }).out!.content[1], { type: "text", text: block("context-soft", 1, HINT_TEXT["context-soft"](H, P)) });
  assert.equal(pair("read", { path: "d.ts" }).out, undefined);
});

test("AC-H5: a throwing detector leaves every tool_call result undefined and the tool_result unchanged; one warning", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const { pair, hints } = rig({ mode: "local" }, { detect: () => { throw new Error("boom"); } });
  for (let i = 0; i < 4; i++) {
    const r = pair(...READ_A);
    assert.ok(r.calls.every((x) => x === undefined));
    assert.equal(r.out, undefined);
  }
  assert.deepEqual(warn.mock.calls.map((c) => c.arguments), [["task-router: hint engine: boom"]]);
  assert.deepEqual(hints(), []);
});

test("AC-H5: a throwing hash likewise (at the call and at the result)", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  let failAt = "call";
  const { pair } = rig({ mode: "local" }, { hash: () => { if (failAt !== "") throw new Error(`hash ${failAt}`); return "h"; } });
  for (let i = 0; i < 3; i++) {
    const r = pair("edit", { path: "f.ts", oldText: "x", newText: "y" });
    assert.ok(r.calls.every((x) => x === undefined));
    assert.equal(r.out, undefined);
  }
  failAt = "";
  const late = pair("write", { path: "g.ts", content: "z" }, { between: () => { failAt = "result"; } });
  assert.ok(late.calls.every((x) => x === undefined));
  assert.equal(late.out, undefined);
  assert.deepEqual(warn.mock.calls.map((c) => c.arguments), [["task-router: hint engine: hash call"]]);
});

test("default mode: no hint hooks unless hints are on (OQ11); off in local mode removes them", () => {
  const names = (settings: Record<string, unknown>) => harness({ settings: settings as never }).f.hookNames();
  const today = names({});
  assert.deepEqual(names({ mode: "local", hints: { enabled: "off" } }).filter((n) => n !== "model_select"), today);
  const on = names({ hints: { enabled: "on" } });
  const extra = [...on];
  for (const n of today) extra.splice(extra.indexOf(n), 1);
  assert.deepEqual(extra, ["tool_call", "tool_result", "turn_end"]);
  const { pair } = rig({ hints: { enabled: "on" } });
  pair(...READ_A);
  pair(...READ_A);
  assert.match(pair(...READ_A).out!.content[1].text, /^<router-hint trip="identical-call"/);
});

test("child sessions: the main-session hooks ignore a child's calls", () => {
  const { h, pair } = rig();
  h.a.agents.push({ name: "c1", parent: "main", sessionId: "s-c1", model: "x", thinkingLevel: "high", state: "running" });
  const child = { sessionManager: { getSessionId: () => "s-c1" }, cwd: "/work" };
  for (let i = 0; i < 3; i++) {
    h.f.fire("tool_call", { toolName: "read", toolCallId: `k${i}`, input: { path: "a.ts" } }, child);
    const rs = h.f.fire("tool_result", { toolName: "read", toolCallId: `k${i}`, content: [{ type: "text", text: "x" }] }, child);
    assert.ok(rs.every((r) => r === undefined));
  }
  assert.equal(pair(...READ_A).out, undefined); // the main's own count starts at one
});

test("nested calls (ctx.executeTool, parentToolCallId): not recorded, never annotated, the queue and context-soft wait for the main's own result", () => {
  const { h, usage, ctx, pair, hints } = rig({ mode: "local", hints: { stallTurns: 1 } });
  let k = 0;
  const nested = (toolName: string, input: unknown) => {
    const id = `tc0/${++k}`;
    const calls = h.f.fire("tool_call", { toolName, toolCallId: id, parentToolCallId: "tc0", input }, ctx);
    const rs = h.f.fire("tool_result", { toolName, toolCallId: id, parentToolCallId: "tc0", input, content: [{ type: "text", text: "x" }], isError: false }, ctx);
    assert.ok([...calls, ...rs].every((r) => r === undefined));
  };
  for (let i = 0; i < 4; i++) nested(...READ_A);
  pair(...READ_A);
  pair(...READ_A); // two of the main's own: no trip yet
  usage.percent = 90;
  h.f.fire("turn_end", { message: { stopReason: "toolUse" }, toolResults: [] }, ctx); // queues context-stall
  usage.tokens = 40_000; // crosses contextSoftTokens
  nested("read", { path: "z.ts" });
  assert.deepEqual(hints(), []);
  const third = pair(...READ_A);
  assert.deepEqual(third.out!.content.slice(1).map((c) => /^<router-hint trip="([a-z-]+)" n="1">/.exec(c.text)?.[1]),
    ["context-stall", "identical-call", "context-soft"]);
});

test("status (Q5): a hint adds `hint <trip>` until the next progress", () => {
  assert.equal(statusText({ local: true, localModels: [], hint: "identical-call" }), "local · hint identical-call");
  assert.equal(statusText({ local: false, localModels: [], hint: "churn" }), "hint churn");
  assert.equal(statusText({ local: true, localModels: [], force: "force a/b", hint: "churn" }), "local · force a/b · hint churn");
  const { files, status, pair } = rig();
  for (let i = 0; i < 3; i++) pair(...READ_A);
  assert.deepEqual(status.at(-1), ["task-router", "local · hint identical-call"]);
  files.set("/work/f.ts", "h1");
  pair("edit", { path: "f.ts", oldText: "x", newText: "y" }, { between: () => files.set("/work/f.ts", "h2") });
  assert.deepEqual(status.at(-1), ["task-router", "local"]);
});
