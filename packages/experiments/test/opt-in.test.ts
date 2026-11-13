// Experiments is opt-in (spec D15, AC16; plan T3.3): without <agentDir>/experiments/settings.json the extension is
// inert: no arm, no API (so every factor keeps the reader's own value), no assignments.jsonl, no warning. Writing the
// file opts in; its `mode` decides, absent keys take defaults().
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V4_FACTORS } from "../core/settings.ts";
import { install } from "../core/shell.ts";
import { bus } from "./fake.ts";

type G = { __piExperimentsApi_v1?: any; __piEconomicsWarned_v1?: Set<string> };
beforeEach(() => void delete (globalThis as G).__piEconomicsWarned_v1);
afterEach(() => void delete (globalThis as G).__piExperimentsApi_v1);

function rig(settingsFile?: unknown) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-opt-in-"));
  if (settingsFile !== undefined) {
    mkdirSync(join(agentDir, "experiments"), { recursive: true });
    writeFileSync(join(agentDir, "experiments", "settings.json"), JSON.stringify(settingsFile));
  }
  const handlers = new Map<string, Array<(e: any, ctx: any) => void>>();
  const commands: string[] = [];
  const pi = { on: (n: string, h: any) => void handlers.set(n, [...(handlers.get(n) ?? []), h]), registerCommand: (n: string) => void commands.push(n), appendEntry: () => {}, events: bus() };
  install(pi, { agentDir, rng: () => 0.5, api: () => undefined });
  const notes: string[] = [];
  const ctx = { hasUI: true, ui: { notify: (m: string) => void notes.push(m) }, model: { provider: "openai", id: "gpt-5" }, sessionManager: { getSessionId: () => "s1", getSessionDir: () => join(agentDir, "sessions") } };
  for (const h of handlers.get("session_start") ?? []) h({}, ctx);
  const assignments = join(agentDir, "experiments", "assignments.jsonl");
  return { handlers, commands, notes, assignments };
}
/** How cache-lifecycle, token-meter and the task-router read a factor: the arm's value, else their own setting. */
const read = (name: string, own: string) => (globalThis as G).__piExperimentsApi_v1?.flag(name, own, "s1") ?? own;

test("no settings file: inert (no API, no handler, no command, no assignments.jsonl, no warning)", () => {
  const r = rig();
  assert.equal((globalThis as G).__piExperimentsApi_v1, undefined);
  assert.deepEqual([[...r.handlers.keys()], r.commands], [[], []]);
  assert.equal(existsSync(r.assignments), false);
  assert.deepEqual(r.notes, []);
});

test("no settings file: every factor (warmPolicy, mainCacheTtl, maskOnCold) keeps the base value", () => {
  rig();
  for (const f of V4_FACTORS) assert.equal(read(f.name, String(f.levels[0])), f.levels[0], f.name);
});

test("a settings file opts in: an arm for the session and one assignments.jsonl row in the file's mode", () => {
  const r = rig({ mode: "explore" });
  assert.ok((globalThis as G).__piExperimentsApi_v1.armFor("s1"));
  const rows = readFileSync(r.assignments, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => [x.sessionId, x.mode]), [["s1", "explore"]]);
});

test("the file's mode decides: off makes the session ineligible (no arm: every factor keeps the reader's own value)", () => {
  const r = rig({ mode: "off" });
  assert.equal((globalThis as G).__piExperimentsApi_v1.armFor("s1"), undefined);
  for (const f of V4_FACTORS) assert.equal(read(f.name, "own"), "own", f.name);
  const rows = readFileSync(r.assignments, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => [x.sessionId, x.mode, x.eligible, x.arm]), [["s1", "off", false, undefined]]);
});

test("a stale API of an earlier runtime in the same process does not survive an inert install (opt-out, then /reload)", () => {
  rig({ mode: "explore" });
  assert.ok((globalThis as G).__piExperimentsApi_v1);
  rig(); // the settings file is gone, the runtime is rebuilt
  assert.equal((globalThis as G).__piExperimentsApi_v1, undefined);
  for (const f of V4_FACTORS) assert.equal(read(f.name, String(f.levels[0])), f.levels[0], f.name);
});
