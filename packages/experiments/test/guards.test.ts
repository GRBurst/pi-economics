// T8.7 guards: user corrections (regex setting) and the /rate command, logged to <agentDir>/guards/events.jsonl
// (`{ts, sessionId, arm, event: "correction" | "rating", value?}`; never prompt text).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, type Settings } from "../core/settings.ts";
import { install } from "../core/shell.ts";

afterEach(() => void delete (globalThis as { __piExperimentsApi_v1?: unknown }).__piExperimentsApi_v1);

function harness(over: Partial<Settings> = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-guards-"));
  const handlers = new Map<string, Array<(e: any, ctx: any) => unknown>>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => unknown }>();
  const pi = { on: (n: string, h: any) => void handlers.set(n, [...(handlers.get(n) ?? []), h]), registerCommand: (n: string, c: any) => void commands.set(n, c) };
  install(pi, { agentDir, settings: { ...defaults(), ...over }, rng: () => 0.5, api: () => undefined });
  const notes: string[] = [];
  const ctx = (sid: string) => ({ sessionManager: { getSessionId: () => sid }, ui: { notify: (m: string) => void notes.push(m) } });
  const fire = (n: string, e: unknown, sid = "s1") => (handlers.get(n) ?? []).forEach((h) => h(e, ctx(sid)));
  const file = join(agentDir, "guards", "events.jsonl");
  const rows = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  const said = (role: string, sid = "s1") => fire("message_end", { message: { role } }, sid);
  const typed = (text: string, source = "interactive", sid = "s1") => fire("input", { text, source }, sid);
  return { fire, rows, commands, ctx, notes, said, typed, agentDir };
}

test("a user message right after an assistant turn that matches the regex is a correction (text never logged)", () => {
  const h = harness();
  h.fire("session_start", {});
  h.said("assistant");
  h.typed("No, that's wrong, revert it");
  const [r] = h.rows();
  assert.deepEqual({ event: r.event, sessionId: r.sessionId, keys: Object.keys(r).sort() }, { event: "correction", sessionId: "s1", keys: ["arm", "event", "sessionId", "ts", "v"] });
  assert.equal(r.v, 1); // schema version of the guards log (LOGS.md)
  assert.match(r.arm, /^[-+]{6}$/);
});

test("no correction: not directly after an assistant turn, extension-injected input, or no match", () => {
  const h = harness();
  h.fire("session_start", {});
  h.typed("no"); // first message of the session
  h.said("assistant");
  h.typed("no", "extension");
  h.typed("looks good, continue");
  h.said("assistant");
  h.said("toolResult");
  h.typed("wrong"); // after a tool result: mid-run steering, not a reaction to a finished turn
  assert.deepEqual(h.rows(), []);
});

test("correctionRegex is a setting", () => {
  const h = harness({ correctionRegex: "\\bnope\\b" });
  h.fire("session_start", {});
  h.said("assistant");
  h.typed("no");
  assert.deepEqual(h.rows(), []);
  h.said("assistant");
  h.typed("Nope");
  assert.equal(h.rows().length, 1);
});

test("/rate 1-5 appends one rating line; anything else is refused with a notice", () => {
  const h = harness();
  h.fire("session_start", {});
  const rate = h.commands.get("rate")!;
  rate.handler(" 4 ", h.ctx("s1"));
  rate.handler("6", h.ctx("s1"));
  rate.handler("", h.ctx("s1"));
  rate.handler("great", h.ctx("s1"));
  assert.deepEqual(h.rows().map((r) => [r.event, r.value, r.sessionId]), [["rating", 4, "s1"]]);
  assert.equal(h.notes.filter((n) => /usage: \/rate 1-5/.test(n)).length, 3);
});
