// (0.3.3) cache-lifecycle's masks (maskOnCold) and infinite-context's folds in one request, on the real code of both:
// upstream's extension (index.ts as the pi-infinite-context input has it, unpatched) and cache-lifecycle's shell. One
// fake pi hosts them and runs pi 1.4's emitContext: a structured clone of the request (the system message first), every
// `context` handler of each extension in load order on the messages without system ones (each given what the one before
// returned, the system messages restored after as pi restores them), then every `context_with_system` handler on the whole transcript. Two
// load orders: the Nix route's (LOAD_ORDER, the module's `loadOrder`) and the package route's (PACKAGE_ORDER: the root
// package.json's extensions, then the pi-infinite-context package after it, as README's "Load order" has it).
//
// The session of the report: a resumed session (the cache is cold) that folded its first tool unit. Upstream's overlay
// matches the session projection in the request by identity or deep equality and refuses a request in which an earlier
// `context` handler changed a projected message (ProjectionMismatchError): with folds it notifies, aborts and sends a
// stub. 0.3.0 to 0.3.2 masked in a `context` handler that ran first. cache-lifecycle masks in `context_with_system`
// now, which pi runs after every `context` handler: the masks apply to the folded request in either order, elide only
// what the folds left and leave the system messages (token-meter's systemHash) as they are.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import infiniteContext from "./ic/extensions/infinite-context/index.ts";
import { INFINITE_CONTEXT_ENTRY, messageItem, snapshot, wrapRootRanges } from "./ic/extensions/infinite-context/forest.ts";
import { STUB_PREFIX, planMasks } from "./cache-lifecycle/core/mask.ts";
import { applyMasks, entriesOf } from "./cache-lifecycle/core/messages.ts";
import { install as installCacheLifecycle } from "./cache-lifecycle/core/shell.ts";
import { systemHash } from "./token-meter/core/system-hash.ts";
// pi-ai 1.4's, copied from the pinned pi (./default.nix): the system message pi rebuilds after a `context` handler.
import { getCurrentSystemMessage } from "./pi-ai/transcript.js";

const IC = "infinite-context";
const CL = "cache-lifecycle";
const TM = "token-meter";
/** The masking of 0.3.0 to 0.3.2: the same plan and masks in a `context` handler. */
const OLD_CL = "cache-lifecycle-0.3.2";
const MASKS = "cache-lifecycle/masks";
const only = (order: string[]) => order.filter((n) => n === IC || n === CL || n === TM);
/** The module's load order, every component on, and the package route's (./default.nix). */
const ORDER = only(JSON.parse(process.env.LOAD_ORDER ?? "[]"));
const PACKAGE_ORDER = only(JSON.parse(process.env.PACKAGE_ORDER ?? "[]"));

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
/** pi's system message: the prompt and its sections (pi-ai 1.4's transcript). */
const SYSTEM: Msg = { role: "system", content: "prompt", sections: { tools: "read" }, timestamp: 0 };

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
  const hashes: Array<string | undefined> = [];
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
    // token-meter's context_with_system handler is `systemHash(e.messages)` (core/shell.ts): the hash it sees, in its slot.
    if (ext === TM) piOf(TM).on("context_with_system", (e) => void hashes.push(systemHash((e as { messages: unknown }).messages)));
    if (ext === OLD_CL)
      piOf(OLD_CL).on("context", (e) => {
        const ms = (e as { messages: Msg[] }).messages;
        return { messages: applyMasks(ms as never, planMasks(entriesOf(ms as never), new Set(), SETTINGS.protectedTailTokens, ["tools", "thinking"])) };
      });
  }
  const fire = async (name: string, event: unknown) => {
    for (const ext of order) for (const x of handlers) if (x.ext === ext && x.name === name) await x.h(event, ctx);
  };
  const of = (name: string) => order.flatMap((ext) => handlers.filter((x) => x.ext === ext && x.name === name));
  /** The request pi sends: its system message, then the session projection. */
  const request = (): Msg[] => [SYSTEM, ...(projection().messages as Msg[])];
  /** pi 1.4's emitContext (dist/core/extensions/runner.js), without its error reporting: a `context` handler's result
   * (returned, or event.messages edited in place) gets the system messages back as restoreSystemMessages does, every
   * one in place when the conversation is the same list, else pi-ai's getCurrentSystemMessage (the real one) as one
   * leading message. */
  const context = async (): Promise<Msg[]> => {
    let current = structuredClone(request());
    const same = (a: Msg[], b: Msg[]) => a.length === b.length && a.every((m, i) => m === b[i]);
    for (const x of of("context")) {
      const visible = current.filter((m) => m.role !== "system");
      const snapshot = visible.slice();
      const r = (await x.h({ type: "context", messages: visible }, ctx)) as { messages?: Msg[] } | undefined;
      const returned = r?.messages ?? (same(visible, snapshot) ? undefined : visible);
      if (!returned || same(returned, snapshot)) continue;
      const head = getCurrentSystemMessage(current) as Msg | undefined;
      current = head ? [head, ...returned] : returned;
    }
    for (const x of of("context_with_system")) {
      const r = (await x.h({ type: "context_with_system", messages: current }, ctx)) as { messages?: Msg[] } | undefined;
      current = r?.messages ?? current;
    }
    return current;
  };
  const errors = () => notes.filter((n) => n.level === "error").map((n) => n.text);
  const masks = () => entries.filter((e) => e.customType === MASKS).flatMap((e) => (e.data as { ids: string[] }).ids);
  return { fire, context, request, errors, masks, hashes, aborts: () => aborts };
}

/** A message in short: role, then its text or its blocks' types (an elided result as `stub`). */
const brief = (m: Msg): string =>
  `${m.role}: ${typeof m.content === "string" ? m.content : (m.content as Array<{ type: string; text?: string }>).map((b) => (b.text?.startsWith(STUB_PREFIX) ? "stub" : b.type)).join(",")}`;
/** The request the session should send: fold-1's summary, a2's thinking and r2 elided, a3 kept (the protected tail). */
const EXPECTED = ["system: prompt", "user: task", "user: fold-1 archived fold summary:\nread c1", "assistant: toolCall", "toolResult: stub", "user: next", "assistant: thinking,text", "user: go on"];

const routes: Array<[string, string[]]> = [["the Nix route (the module's load order)", ORDER], ["the package route (pi-infinite-context's package after pi-economics')", PACKAGE_ORDER]];

test("the routes host all three: token-meter, infinite-context, cache-lifecycle", () => {
  for (const [route, order] of routes) assert.deepEqual([...order].sort(), [CL, IC, TM], `${route}: ${JSON.stringify(order)}`);
  // The Nix route keeps infinite-context before cache-lifecycle; the package route cannot (one package holds the components).
  assert.ok(ORDER.indexOf(IC) < ORDER.indexOf(CL), `the module: ${JSON.stringify(ORDER)}`);
  assert.ok(PACKAGE_ORDER.indexOf(CL) < PACKAGE_ORDER.indexOf(IC), `the package route as tested: ${JSON.stringify(PACKAGE_ORDER)}`);
});

for (const [route, order] of routes) {
  test(`${route}: a cold resumed session with a fold sends the folded request, masked, its system message as it was`, async () => {
    const s = host(order);
    await s.fire("session_start", { type: "session_start", reason: "resume" });
    const out = await s.context();
    assert.deepEqual(s.errors(), [], "infinite-context refused the request");
    assert.equal(s.aborts(), 0, "the request was aborted");
    assert.deepEqual(out.map(brief), EXPECTED);
    assert.deepEqual(s.masks().sort(), ["think:resp-a2:0", "tool:c2"], "the masks name only what the fold left");
    assert.deepEqual(out[0], SYSTEM, "the system message at index 0, unchanged");
    const h = systemHash(s.request());
    assert.ok(h !== undefined);
    assert.deepEqual([...s.hashes, systemHash(out)], [h, h], "token-meter's hash, in its slot of the chain, is the request's");
  });

  test(`${route}: a branch that holds masks of folded messages (written by 0.3.0 to 0.3.2) sends the folded request`, async () => {
    const old = { type: "custom", id: "old-masks", customType: MASKS, data: { ids: ["tool:c2", "think:resp-a2:0", "tool:c1", "think:resp-a1:0"], at: 1 } };
    const s = host(order, [old]);
    await s.fire("session_start", { type: "session_start", reason: "resume" });
    const out = await s.context();
    assert.deepEqual(s.errors(), [], "infinite-context refused the request");
    assert.equal(s.aborts(), 0, "the request was aborted");
    assert.deepEqual(out.map(brief), EXPECTED);
    assert.deepEqual(s.masks(), ["tool:c2", "think:resp-a2:0", "tool:c1", "think:resp-a1:0"], "no new masks: the cold request adds none");
  });

  test(`${route}: a warm request after the cold one repeats it byte for byte`, async () => {
    const s = host(order);
    await s.fire("session_start", { type: "session_start", reason: "resume" });
    const cold = await s.context();
    await s.fire("after_provider_response", { type: "after_provider_response", status: 200 });
    const warm = await s.context();
    assert.equal(JSON.stringify(warm), JSON.stringify(cold));
    assert.deepEqual(s.errors(), []);
  });
}

test("the root cause: masks applied in a `context` handler before the overlay (0.3.0 to 0.3.2) are refused", async () => {
  const s = host([OLD_CL, IC]);
  await s.fire("session_start", { type: "session_start", reason: "resume" });
  const out = await s.context();
  assert.equal(s.aborts(), 1, "infinite-context accepted a request whose projected messages were masked before it");
  assert.ok(s.errors().some((t) => t.includes('Projected entry "a1" (assistant) is missing from the request')), `notices: ${JSON.stringify(s.errors())}`);
  assert.deepEqual(out.map(brief), ["system: prompt", "user: Reply only: folds could not be applied."]);
});
