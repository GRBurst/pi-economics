// Without the patched actor (spec D5, AC6; plan T3.3): an opted-in experiments warns once at session_start that
// children do not inherit the arm, and assigns as before; without its settings file it is inert and silent (D15).
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../core/shell.ts";

type G = { __piExperimentsApi_v1?: any; __piEconomicsWarned_v1?: Set<string> };
beforeEach(() => void delete (globalThis as G).__piEconomicsWarned_v1);
afterEach(() => void delete (globalThis as G).__piExperimentsApi_v1);

const WARNING =
  "experiments: needs pi-actor-subagents with the spawn-policy API (__subagentsApi_v1), which is not loaded; " +
  "child agents do not inherit their parent's arm. Get the patched build via pi-setup's Nix module (programs.pi.actorSubagents); upstream support pending.";

const fn = () => () => {};
const full = { version: 1, registerSpawnPolicy: fn, subscribe: fn, list: () => [], send: async () => {} };

function rig(optedIn: boolean, api: () => typeof full | undefined) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-actor-"));
  if (optedIn) {
    mkdirSync(join(agentDir, "experiments"), { recursive: true });
    writeFileSync(join(agentDir, "experiments", "settings.json"), JSON.stringify({ mode: "explore" }));
  }
  const handlers = new Map<string, Array<(e: any, ctx: any) => void>>();
  const pi = { on: (n: string, h: any) => void handlers.set(n, [...(handlers.get(n) ?? []), h]), registerCommand: () => {} };
  install(pi, { agentDir, rng: () => 0.5, api });
  const notes: string[] = [];
  const ctx = { hasUI: true, ui: { notify: (m: string) => void notes.push(m) }, sessionManager: { getSessionId: () => "s1", getSessionDir: () => join(agentDir, "sessions") } };
  const start = () => { for (const h of handlers.get("session_start") ?? []) h({}, ctx); };
  return { notes, start, assignments: join(agentDir, "experiments", "assignments.jsonl") };
}

test("opted in, without the actor's API: the pinned warning once; the arm is still assigned", () => {
  const r = rig(true, () => undefined);
  r.start();
  r.start();
  assert.deepEqual(r.notes, [WARNING]);
  assert.ok((globalThis as G).__piExperimentsApi_v1.armFor("s1"));
  assert.equal(existsSync(r.assignments), true);
});

test("opted in, with the actor's API: no warning", () => {
  const r = rig(true, () => full);
  r.start();
  assert.deepEqual(r.notes, []);
});

test("not opted in (no settings file): no warning, even without the actor's API", () => {
  const r = rig(false, () => undefined);
  r.start();
  assert.deepEqual(r.notes, []);
});
