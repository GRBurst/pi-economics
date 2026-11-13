// Experiments is opt-in (spec D15, AC16; plan T3.3): without <agentDir>/experiments/settings.json the extension is
// inert: no arm, no answer on the internal channel (so every factor keeps the reader's own value), no assignments.jsonl,
// no warning. Writing the
// file opts in; its `mode` decides, absent keys take defaults().
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "../core/channel.ts";
import { V4_FACTORS } from "../core/settings.ts";
import { install } from "../core/shell.ts";
import { bus, fakeControl } from "./fake.ts";

type G = { __piEconomicsWarned_v1?: Set<string> };
beforeEach(() => void delete (globalThis as G).__piEconomicsWarned_v1);

function rig(settingsFile?: unknown) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-opt-in-"));
  if (settingsFile !== undefined) {
    mkdirSync(join(agentDir, "experiments"), { recursive: true });
    writeFileSync(join(agentDir, "experiments", "settings.json"), JSON.stringify(settingsFile));
  }
  const handlers = new Map<string, Array<(e: any, ctx: any) => void>>();
  const commands: string[] = [];
  const pi = { on: (n: string, h: any) => void handlers.set(n, [...(handlers.get(n) ?? []), h]), registerCommand: (n: string) => void commands.push(n), appendEntry: () => {}, events: bus(), ...fakeControl().control };
  install(pi, { agentDir, rng: () => 0.5, api: () => undefined });
  const notes: string[] = [];
  const ctx = { hasUI: true, ui: { notify: (m: string) => void notes.push(m) }, model: { provider: "openai", id: "gpt-5" }, sessionManager: { getSessionId: () => "s1", getSessionDir: () => join(agentDir, "sessions") } };
  for (const h of handlers.get("session_start") ?? []) h({}, ctx);
  const assignments = join(agentDir, "experiments", "assignments.jsonl");
  /** How cache-lifecycle reads a factor: the level assigned to its lever on the internal channel, else its own setting. */
  const read = (lever: string, own: unknown) => Object.values(query(pi.events, "s1")?.factors ?? {}).find((f) => f.lever === lever)?.assigned ?? own;
  return { handlers, commands, notes, assignments, events: pi.events, read };
}

test("no settings file: inert (no answer on the channel, no handler, no command, no assignments.jsonl, no warning)", () => {
  const r = rig();
  assert.equal(query(r.events, "s1"), undefined);
  assert.deepEqual([[...r.handlers.keys()], r.commands], [[], []]);
  assert.equal(existsSync(r.assignments), false);
  assert.deepEqual(r.notes, []);
});

test("no settings file: every factor (warmPolicy, mainCacheTtl, maskOnCold) keeps the base value", () => {
  const r = rig();
  for (const f of V4_FACTORS) assert.equal(r.read(f.lever, f.levels[0]), f.levels[0], f.name);
});

test("a settings file opts in: an arm for the session and one assignments.jsonl row in the file's mode", () => {
  const r = rig({ mode: "explore" });
  assert.ok(query(r.events, "s1")?.arm);
  const rows = readFileSync(r.assignments, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => [x.sessionId, x.mode]), [["s1", "explore"]]);
});

test("the file's mode decides: off makes the session ineligible (no arm: every factor keeps the reader's own value)", () => {
  const r = rig({ mode: "off" });
  assert.equal(query(r.events, "s1")?.arm, undefined);
  for (const f of V4_FACTORS) assert.equal(r.read(f.lever, "own"), "own", f.name);
  const rows = readFileSync(r.assignments, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => [x.sessionId, x.mode, x.eligible, x.arm]), [["s1", "off", false, undefined]]);
});

test("T5b2.7 no process-global API (M5b.2, G5): an opted-in runtime publishes nothing on globalThis, so none outlives it", () => {
  const before = Object.getOwnPropertyNames(globalThis).filter((k) => k !== "__piEconomicsWarned_v1");
  const r = rig({ mode: "explore" });
  assert.ok(query(r.events, "s1")?.arm);
  assert.equal("__piExperimentsApi_v1" in globalThis, false);
  assert.deepEqual(Object.getOwnPropertyNames(globalThis).filter((k) => k !== "__piEconomicsWarned_v1"), before);
});
