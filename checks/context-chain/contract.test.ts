// (0.3.3) cache-lifecycle's masks (maskOnCold) and infinite-context's folds in one request, on the real code of both:
// upstream's extension (index.ts as the pi-infinite-context input has it, unpatched) and cache-lifecycle's shell. One
// fake pi hosts them and chains their `context` handlers as pi 1.4's emitContext does: a structured clone of the
// request, then every handler of each extension in load order, each given what the one before returned. The load
// order is the module's (LOAD_ORDER, from ./default.nix).
//
// The session of the report: a resumed session (the cache is cold) that folded its first tool unit. Upstream's overlay
// matches the session projection in the request by identity or deep equality and refuses a request in which another
// handler changed a projected message (ProjectionMismatchError): with folds it notifies, aborts and sends a stub. So
// the masks apply to the folded request: they elide only what the folds left, and they never name a folded message.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import infiniteContext from "./ic/extensions/infinite-context/index.ts";
import { INFINITE_CONTEXT_ENTRY, messageItem, snapshot, wrapRootRanges } from "./ic/extensions/infinite-context/forest.ts";
import { STUB_PREFIX } from "./cache-lifecycle/core/mask.ts";
import { install as installCacheLifecycle } from "./cache-lifecycle/core/shell.ts";

const IC = "infinite-context";
const CL = "cache-lifecycle";
const MASKS = "cache-lifecycle/masks";
/** The module's load order, every component on (./default.nix). */
const ORDER: string[] = JSON.parse(process.env.LOAD_ORDER ?? "[]");
const hosted = ORDER.filter((n) => n === IC || n === CL);

type Msg = Record<string, unknown> & { role: string; content?: unknown };
type Entry = Record<string, unknown> & { id: string; type: string };
const user = (text: string): Msg => ({ role: "user", content: text, timestamp: 1 });
const think = (c: string) => ({ type: "thinking", thinking: c.repeat(4000), thinkingSignature: "sig" });
const call = (id: string) => ({ type: "toolCall", id, name: "read", arguments: { path: id } });
const assistant = (responseId: string, content: unknown[], stopReason = "toolUse"): Msg => ({
  role: "assistant", content, responseId, api: "anthropic-messages", provider: "anthropic", model: "m", stopReason, timestamp: 1,
});
const result = (id: string, c: string): Msg => ({
  role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: c.repeat(4000) }], isError: false, timestamp: 1,
});

/** The branch: u1, a1 r1 (folded as fold-1), a2 r2, u2, a3, u3 (the new prompt). Thinking blocks and results ~1000 tokens. */
const MESSAGES: Array<[string, Msg]> = [
  ["u1", user("task")],
  ["a1", assistant("resp-a1", [think("p"), call("c1")])],
  ["r1", result("c1", "x")],
  ["a2", assistant("resp-a2", [think("q"), call("c2")])],
  ["r2", result("c2", "y")],
  ["u2", user("next")],
  ["a3", assistant("resp-a3", [think("r"), { type: "text", text: "done" }], "stop")],
  ["u3", user("go on")],
];
/** The fold the session made after u2: its roots then, a1 and r1 (one tool unit) wrapped. */
const FOLDED = snapshot(wrapRootRanges(MESSAGES.slice(0, 6).map(([id]) => messageItem(id)), [{ first: 1, last: 2, id: "fold-1", summary: "read c1" }]));
const SETTINGS = { warmPolicy: "native", mainCacheTtl: "5m", maskOnCold: "tools+thinking", protectedTailTokens: 500, identityShim: true } as const;

/** One session in a fake pi; `carried`: entries the branch holds before the new prompt (a resumed session's). */
function host(order: string[], carried: Entry[] = []) {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(path.join(tmpdir(), "context-chain-")); // no settings file: upstream's defaults
  const entries: Entry[] = [];
  for (const [id, message] of MESSAGES) {
    entries.push({ type: "message", id, message });
    if (id === "u2") entries.push({ type: "custom", id: "snap", customType: INFINITE_CONTEXT_ENTRY, data: FOLDED });
    if (id === "a3") entries.push(...carried);
  }
  const handlers: Array<{ ext: string; name: string; h: (e: unknown, ctx: unknown) => unknown }> = [];
  const emitter = new EventEmitter();
  const events = {
    emit: (c: string, d: unknown) => void emitter.emit(c, d),
    on: (c: string, h: (d: unknown) => unknown) => {
      emitter.on(c, h);
      return () => void emitter.off(c, h);
    },
  };
  const piOf = (ext: string) => ({
    on: (name: string, h: (e: unknown, ctx: unknown) => unknown) => void handlers.push({ ext, name, h }),
    registerTool() {},
    registerCommand() {},
    appendEntry: (customType: string, data: unknown) => void entries.push({ type: "custom", id: `e${entries.length}`, customType, data }),
    sendMessage() {},
    getAllTools: () => [],
    events,
  });
  const notes: Array<{ text: string; level: string }> = [];
  let aborts = 0;
  const projection = () => {
    const es = entries.filter((e) => e.type === "message").map((e) => ({ sourceEntry: e, messages: [e.message] }));
    return { entries: es, messages: es.flatMap((e) => e.messages) };
  };
  const ctx = {
    hasUI: true,
    cwd: "/nonexistent",
    isProjectTrusted: () => false,
    model: { provider: "anthropic", id: "m" },
    sessionManager: {
      getSessionId: () => "s1",
      getSessionFile: () => "/sessions/s1.jsonl",
      getSessionDir: () => "/sessions",
      getBranch: () => entries.map((e, i) => ({ ...e, parentId: i === 0 ? null : entries[i - 1].id })),
      buildSessionProjection: projection,
    },
    ui: { notify: (text: string, level: string) => void notes.push({ text, level }), setStatus() {} },
    abort: () => void aborts++,
    getContextUsage: () => ({ contextWindow: 1_000_000, tokens: 0 }),
  };
  // The factories run in load order; pi runs an event's handlers per extension, in load order.
  for (const ext of order) {
    if (ext === IC) infiniteContext(piOf(IC) as never);
    if (ext === CL) installCacheLifecycle(piOf(CL) as never, { settings: SETTINGS, now: () => 1_000_000_000, api: () => undefined });
  }
  const fire = async (name: string, event: unknown) => {
    let last: unknown = undefined;
    for (const ext of order) for (const x of handlers) if (x.ext === ext && x.name === name) last = (await x.h(event, ctx)) ?? last;
    return last;
  };
  /** pi 1.4's emitContext: a clone of the request, each handler given the messages the one before returned. */
  const context = async (): Promise<Msg[]> => {
    let current = structuredClone(projection().messages) as Msg[];
    for (const ext of order)
      for (const x of handlers)
        if (x.ext === ext && x.name === "context") {
          const r = (await x.h({ type: "context", messages: current }, ctx)) as { messages?: Msg[] } | undefined;
          if (r?.messages) current = r.messages;
        }
    return current;
  };
  const errors = () => notes.filter((n) => n.level === "error").map((n) => n.text);
  const masks = () => entries.filter((e) => e.customType === MASKS).flatMap((e) => (e.data as { ids: string[] }).ids);
  return { entries, fire, context, errors, masks, aborts: () => aborts };
}

/** A message in short: role, then its text or its blocks' types (an elided result as `stub`). */
const brief = (m: Msg): string =>
  `${m.role}: ${typeof m.content === "string" ? m.content : (m.content as Array<{ type: string; text?: string }>).map((b) => (b.text?.startsWith(STUB_PREFIX) ? "stub" : b.type)).join(",")}`;
/** The request the session should send: fold-1's summary, a2's thinking and r2 elided, a3 kept (the protected tail). */
const EXPECTED = ["user: task", "user: fold-1 archived fold summary:\nread c1", "assistant: toolCall", "toolResult: stub", "user: next", "assistant: thinking,text", "user: go on"];

test("the module loads infinite-context before cache-lifecycle", () => {
  assert.deepEqual(hosted.length, 2, `the module's load order lacks a component: ${JSON.stringify(ORDER)}`);
  assert.deepEqual(hosted, [IC, CL], `cache-lifecycle's context handler would change the projection infinite-context matches: ${JSON.stringify(ORDER)}`);
});

test("in the module's load order, a cold resumed session with a fold sends the folded request, masked", async () => {
  const s = host(hosted);
  await s.fire("session_start", { type: "session_start", reason: "resume" });
  const out = await s.context();
  assert.deepEqual(s.errors(), [], "infinite-context refused the request");
  assert.equal(s.aborts(), 0, "the request was aborted");
  assert.deepEqual(out.map(brief), EXPECTED);
  assert.deepEqual(s.masks().sort(), ["think:resp-a2:0", "tool:c2"], "the masks name only what the fold left");
});

test("a branch that holds masks of folded messages (written under the former order) still sends the folded request", async () => {
  const old = { type: "custom", id: "old-masks", customType: MASKS, data: { ids: ["tool:c2", "think:resp-a2:0", "tool:c1", "think:resp-a1:0"], at: 1 } };
  const s = host(hosted, [old]);
  await s.fire("session_start", { type: "session_start", reason: "resume" });
  const out = await s.context();
  assert.deepEqual(s.errors(), [], "infinite-context refused the request");
  assert.equal(s.aborts(), 0, "the request was aborted");
  assert.deepEqual(out.map(brief), EXPECTED);
  assert.deepEqual(s.masks(), ["tool:c2", "think:resp-a2:0", "tool:c1", "think:resp-a1:0"], "no new masks: the cold request adds none");
});

test("a warm request after the cold one repeats it byte for byte", async () => {
  const s = host(hosted);
  await s.fire("session_start", { type: "session_start", reason: "resume" });
  const cold = await s.context();
  await s.fire("after_provider_response", { type: "after_provider_response", status: 200 });
  const warm = await s.context();
  assert.equal(JSON.stringify(warm), JSON.stringify(cold));
  assert.deepEqual(s.errors(), []);
});

test("the root cause: with cache-lifecycle's handler first, the overlay refuses the masked request", async () => {
  const s = host([CL, IC]);
  await s.fire("session_start", { type: "session_start", reason: "resume" });
  const out = await s.context();
  assert.equal(s.aborts(), 1, "infinite-context accepted a request whose projected messages were masked: the order constraint may be obsolete");
  assert.ok(s.errors().some((t) => t.includes('Projected entry "a1" (assistant) is missing from the request')), `notices: ${JSON.stringify(s.errors())}`);
  assert.deepEqual(out.map(brief), ["user: Reply only: folds could not be applied."]);
});
