// T8.7 guard: `context_peek` use after masking is logged as `peek-after-mask` to <agentDir>/guards/events.jsonl
// (the file format meter-report --arms reads; no prompt text, no tool arguments).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../core/shell.ts";
import { defaults } from "../core/settings.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";
import { asst, tool, user } from "./msgs.ts";

type G = { __piExperimentsApi_v1?: unknown };
afterEach(() => void delete (globalThis as G).__piExperimentsApi_v1);

const MIN = 60_000;
const big = "x".repeat(12000); // ~3000 tokens: c1 falls outside the protected tail below, c2 stays inside
const msgs = () => [
  user("go"), asst("r1", [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }]), tool("c1", "bash", big),
  asst("r2", [{ type: "toolCall", id: "c2", name: "read", arguments: {} }]), tool("c2", "read", big),
  asst("r3", [{ type: "text", text: "ok" }]),
];
function setup(maskOnCold: "off" | "tools" = "tools") {
  const agentDir = mkdtempSync(join(tmpdir(), "cache-guards-"));
  const f = fakePi();
  const clock = { now: Date.parse("2026-10-03T10:00:00Z") };
  install(f.pi as never, { agentDir, settings: { ...defaults(), maskOnCold, protectedTailTokens: 3000 }, now: () => clock.now, api: () => undefined });
  const file = join(agentDir, "guards", "events.jsonl");
  const rows = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { f, clock, rows };
}
const peek = { toolName: "context_peek", toolCallId: "p1", input: { id: "secret-prompt-text" } };

test("a context_peek call after a masking event on its session is logged (no arguments)", () => {
  const { f, clock, rows } = setup();
  const ctx = fakeCtx("s1");
  f.fire("session_start", { reason: "startup" }, ctx);
  f.fire("tool_call", peek, ctx); // nothing masked yet
  assert.deepEqual(rows(), []);
  f.call("context", { messages: msgs() }, ctx); // cold → masks c1
  clock.now += MIN;
  f.fire("tool_call", peek, ctx);
  f.fire("tool_call", { ...peek, toolName: "context_map" }, ctx);
  f.fire("tool_call", peek, fakeCtx("other")); // another session: nothing masked there
  assert.deepEqual(rows(), [{ v: 1, ts: new Date(clock.now).toISOString(), sessionId: "s1", event: "peek-after-mask" }]);
});

test("the line carries the session's experiment arm when the API is there", () => {
  const { f, rows } = setup();
  (globalThis as G).__piExperimentsApi_v1 = { flag: (_n: string, d: string) => d, armFor: (s: string) => (s === "s1" ? { id: "+-+--" } : undefined) };
  const ctx = fakeCtx("s1");
  f.call("context", { messages: msgs() }, ctx);
  f.fire("tool_call", peek, ctx);
  assert.equal(rows()[0].arm, "+-+--");
});

test("a resumed session whose branch holds masks counts too; without maskOnCold and masks nothing is logged", () => {
  const { f, rows } = setup();
  const entries = [{ type: "custom", customType: "cache-lifecycle/masks", data: { ids: ["tool:c1"], at: 1 } }];
  const ctx = fakeCtx("s2", { entries });
  f.fire("session_start", { reason: "resume" }, ctx);
  f.fire("tool_call", peek, ctx);
  assert.equal(rows().length, 1);
  const off = setup("off");
  off.f.fire("tool_call", peek, fakeCtx("s1"));
  assert.deepEqual(off.rows(), []);
});
