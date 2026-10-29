// Session lifecycle: assignment on session_start, assignments.jsonl, spawn → inherit.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { design } from "../core/design.ts";
import { defaults, type Settings } from "../core/settings.ts";
import { install } from "../core/shell.ts";

type G = { __piExperimentsApi_v1?: any };
afterEach(() => void delete (globalThis as G).__piExperimentsApi_v1);

function harness(over: Partial<Settings> = {}, agents: any[] = []) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-shell-"));
  const handlers = new Map<string, Array<(e: any, ctx: any) => void>>();
  const listeners: Array<(e: any) => void> = [];
  const pi = { on: (n: string, h: any) => void handlers.set(n, [...(handlers.get(n) ?? []), h]), registerCommand: () => {} };
  const sub = { list: () => agents, subscribe: (l: any) => (listeners.push(l), () => {}) };
  const settings = { ...defaults(), ...over };
  install(pi, { agentDir, settings, rng: () => 0.5, api: () => sub });
  const sessionDir = join(agentDir, "sessions");
  const start = (sid: string) => handlers.get("session_start")!.forEach((h) => h({}, { sessionManager: { getSessionId: () => sid, getSessionDir: () => sessionDir } }));
  const emit = (e: unknown) => listeners.forEach((l) => l(e));
  const rows = () => readFileSync(join(agentDir, "experiments", "assignments.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { agentDir, sessionDir, start, emit, rows, api: () => (globalThis as G).__piExperimentsApi_v1, settings };
}

test("session_start assigns an arm, publishes the API and appends one assignments.jsonl row", () => {
  const h = harness();
  assert.equal(h.api().version, 1);
  h.start("s1");
  const arm = h.api().armFor("s1");
  assert.ok(design(h.settings.factors, 16).some((a) => a.id === arm.id));
  assert.deepEqual(h.rows().map((r) => ({ sessionId: r.sessionId, arm: r.arm, mode: r.mode, flags: r.flags })), [{ sessionId: "s1", arm: arm.id, mode: "explore", flags: arm.flags }]);
  assert.equal(typeof h.rows()[0].ts, "string");
  assert.equal(h.rows()[0].v, 1); // schema version of assignments.jsonl (LOGS.md)
});

test("explore balances across sessions (counts come from assignments.jsonl); resuming a session keeps its arm", () => {
  const h = harness();
  const ids: string[] = [];
  for (let i = 0; i < 16; i++) {
    h.start(`s${i}`);
    ids.push(h.api().armFor(`s${i}`).id);
  }
  assert.equal(new Set(ids).size, 16);
  h.start("s3");
  assert.equal(h.api().armFor("s3").id, ids[3]);
  assert.equal(h.rows().length, 16);
});

test("mode off → baseline arm; disabled arms from state.json are skipped", () => {
  const off = harness({ mode: "off" });
  off.start("s1");
  assert.equal(off.api().armFor("s1").id, defaults().baseline);
  const h = harness();
  const ids = design(h.settings.factors, 16).map((a) => a.id);
  mkdirSync(join(h.agentDir, "experiments"), { recursive: true });
  writeFileSync(join(h.agentDir, "experiments", "state.json"), JSON.stringify({ disabled: ids.slice(1), posterior: {} }));
  for (const sid of ["a", "b", "c"]) {
    h.start(sid);
    assert.equal(h.api().armFor(sid).id, ids[0]);
  }
});

test("a spawn event maps the child session to its parent's arm (main and child parents)", () => {
  const h = harness({}, [{ name: "w1", sessionId: "s-w1" }]);
  h.start("main-1");
  h.emit({ type: "spawn", name: "w1", by: "main", parent: "main", childSessionId: "s-w1", ts: 1 });
  h.emit({ type: "spawn", name: "w2", by: "w1", parent: "w1", childSessionId: "s-w2", ts: 2 });
  h.emit({ type: "spawn", name: "w3", by: "main", parent: "main", ts: 3 }); // no session id yet: ignored
  const main = h.api().armFor("main-1");
  assert.deepEqual(h.api().armFor("s-w1"), main);
  assert.deepEqual(h.api().armFor("s-w2"), main);
  assert.equal(h.api().flag("mainCacheTtl", "x", "s-w2"), main.flags.mainCacheTtl);
  assert.equal(h.rows().length, 1); // children are not assigned
});

test("no factors → the baseline arm with no flags: every flag falls back to the caller's setting", () => {
  const h = harness({ factors: [] });
  h.start("s1");
  assert.equal(h.api().flag("warmPolicy", "own", "s1"), "own");
});

// The restart drops the in-memory inheritance of a RESUMED child (its spawn event
// fired before its session started), so its arm is re-derived from the session file layout
// <sessionDir>/subagents/<parent>/*_<child>.jsonl (token-meter's parentSessionId rule).
test("resumed child without a spawn event: arm re-derived from the session file layout; no new row", () => {
  const h = harness();
  h.start("main-1");
  const arm = h.api().armFor("main-1");
  const childDir = join(h.sessionDir, "subagents", "main-1");
  mkdirSync(childDir, { recursive: true });
  writeFileSync(join(childDir, "2026-10-03T12-00-00-000Z_s-child.jsonl"), "");
  assert.deepEqual(h.api().armFor("s-child"), arm);
  assert.equal(h.api().flag("warmPolicy", "own", "s-child"), arm.flags.warmPolicy);
  assert.deepEqual(h.api().armFor("s-child"), arm); // cached
  assert.equal(h.rows().length, 1); // a resumed child gets no assignment of its own
});

test("child of an unassigned root stays unknown; so does a root session", () => {
  const h = harness();
  h.start("main-1");
  const orphanDir = join(h.sessionDir, "subagents", "other-root");
  mkdirSync(orphanDir, { recursive: true });
  writeFileSync(join(orphanDir, "2026-10-03T12-00-00-000Z_s-orphan.jsonl"), "");
  assert.equal(h.api().armFor("s-orphan"), undefined); // parent has no assignment
  assert.equal(h.api().armFor("main-1-other"), undefined); // no such session file: not a child
});

test("exploit reads the posterior meter-report wrote to state.json (rewards: the highest mean wins)", () => {
  const h = harness({ mode: "exploit" });
  const ids = design(h.settings.factors, 16).map((a) => a.id);
  mkdirSync(join(h.agentDir, "experiments"), { recursive: true });
  writeFileSync(join(h.agentDir, "experiments", "state.json"), JSON.stringify({
    disabled: [], posterior: Object.fromEntries(ids.map((id, i) => [id, { mean: -(10 - (i === 5 ? 9 : 0)), sd: 0 }])), reasons: {},
  }));
  h.start("s1");
  assert.equal(h.api().armFor("s1").id, ids[5]);
});

// The assignment line names its design. Lines without `design` are v1 (the five-factor 2^(5-1) design, 5-char arm ids).
test("assignment lines carry design \"v3\" (6-char arm ids, the same six factors as v2)", () => {
  const h = harness();
  h.start("s1");
  const [r] = h.rows();
  assert.equal(r.design, "v3");
  assert.match(r.arm, /^[-+]{6}$/);
  assert.equal(Object.keys(r.flags).length, 6);
  assert.ok("delegationRule" in r.flags);
});

test("a session assigned under v1 keeps its arm and flags (not re-assigned, no new row); v1 rows do not skew the v2 balance", () => {
  const h = harness();
  mkdirSync(join(h.agentDir, "experiments"), { recursive: true });
  const v1 = { ts: "2026-10-03T08:00:00.000Z", sessionId: "old", arm: "+-+--", mode: "explore", flags: { warmPolicy: "orchestrator-aware", mainCacheTtl: "5m", foldHint: "cache-aware", maskOnCold: "off", freshOnCold: "off" } };
  writeFileSync(join(h.agentDir, "experiments", "assignments.jsonl"), JSON.stringify(v1) + "\n");
  h.start("old");
  assert.deepEqual(h.api().armFor("old"), { id: "+-+--", flags: v1.flags });
  assert.equal(h.api().flag("delegationRule", "off", "old"), "off"); // v1 had no such factor: the consumer's own setting
  assert.equal(h.api().flag("foldHint", "fixed", "old"), "cache-aware");
  assert.equal(h.rows().length, 1);
  // 16 new sessions still cover the 16 v2 arms exactly once.
  const ids = new Set<string>();
  for (let i = 0; i < 16; i++) {
    h.start(`n${i}`);
    ids.add(h.api().armFor(`n${i}`).id);
  }
  assert.equal(ids.size, 16);
  assert.deepEqual(h.rows().slice(1).map((r) => r.design), Array(16).fill("v3"));
});

// v3 = v2's factors and arms with a new meaning of foldHint = cache-aware: resumed v2 sessions keep "v2", v2 rows do not balance v3.
test("a resumed v2 session keeps its arm and design \"v2\" (no new row); new sessions are v3 and v2 rows do not skew their balance", () => {
  const h = harness();
  const arms = design(h.settings.factors, 16);
  mkdirSync(join(h.agentDir, "experiments"), { recursive: true });
  const old = arms[3];
  const v2 = { v: 1, ts: "2026-10-03T08:00:00.000Z", sessionId: "old", arm: old.id, design: "v2", mode: "explore", flags: old.flags };
  writeFileSync(join(h.agentDir, "experiments", "assignments.jsonl"), JSON.stringify(v2) + "\n");
  h.start("old");
  assert.equal(h.api().armFor("old").id, old.id);
  assert.deepEqual(h.rows(), [v2]); // no new row, the row still says v2
  const seen: string[] = [];
  for (let i = 0; i < 16; i++) {
    h.start(`n${i}`);
    seen.push(h.api().armFor(`n${i}`).id);
  }
  assert.equal(new Set(seen).size, 16); // the v2 session's arm is not counted: all 16 arms still get one v3 session
  assert.deepEqual(h.rows().slice(1).map((r) => r.design), Array(16).fill("v3"));
  h.start("old"); // resuming again, after v3 rows exist
  assert.equal(h.rows().length, 17);
  assert.equal(h.rows()[0].design, "v2");
});
