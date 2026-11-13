// The bench's assignment file (redesign §10, M9): <agentDir>/experiments/assignment.json names the run's arm, so the
// engine reads it instead of drawing; pi process levers the bench wrote into settings.json are read back from the
// effective settings (global, then the project's over it).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onAssigned, query, type Levers } from "../core/channel.ts";
import { defaults } from "../core/settings.ts";
import { ENTRY, install } from "../core/shell.ts";
import { fakePi } from "./fake.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: unknown }).__piEconomicsWarned_v1);

const FILE = {
  v: 1, design: "0123456789ab", stratum: "bench", arm: "orch-+",
  factors: {
    routing: { lever: "task-router.routing", assigned: "on" },
    "pi.compaction.reserveTokens": { lever: "pi.compaction.reserveTokens", assigned: 8000 },
  },
};

function world(o: { file?: unknown; settings?: unknown; project?: unknown; mode?: "off" | "explore" } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-file-"));
  const cwd = mkdtempSync(join(tmpdir(), "experiments-file-cwd-"));
  mkdirSync(join(agentDir, "experiments"), { recursive: true });
  if (o.file !== undefined) writeFileSync(join(agentDir, "experiments", "assignment.json"), typeof o.file === "string" ? o.file : JSON.stringify(o.file));
  if (o.settings !== undefined) writeFileSync(join(agentDir, "settings.json"), JSON.stringify(o.settings));
  if (o.project !== undefined) { mkdirSync(join(cwd, ".pi")); writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(o.project)); }
  const f = fakePi();
  const heard: Levers[] = [];
  onAssigned(f.events, (l) => void heard.push(l));
  install(f.pi, { agentDir, settings: { ...defaults(), mode: o.mode ?? "off" }, rng: () => { throw new Error("drew"); }, api: () => undefined });
  const ctx = (sid: string) => ({
    cwd, hasUI: true, ui: { notify: () => {} },
    model: { provider: "anthropic", id: "claude-opus-5-5" },
    sessionManager: { getSessionId: () => sid, getSessionDir: () => join(agentDir, "sessions"), getSessionFile: () => join(agentDir, "sessions", `x_${sid}.jsonl`), getBranch: () => [] },
  });
  const start = (sid: string) => f.fire("session_start", { type: "session_start", reason: "startup" }, ctx(sid));
  const before = (sid: string) => f.fire("before_agent_start", {}, ctx(sid));
  const rows = () => (existsSync(join(agentDir, "experiments", "assignments.jsonl")) ? readFileSync(join(agentDir, "experiments", "assignments.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { ...f, agentDir, heard, start, before, rows };
}

test("T9.3 the engine adopts the file's arm instead of drawing: one v2 row, the entry and the channel carry it (mode off draws nothing)", () => {
  const w = world({ file: FILE });
  w.start("s1");
  const [r, ...more] = w.rows();
  assert.equal(more.length, 0);
  assert.deepEqual({ ...r, ts: 0 }, { v: 2, ts: 0, sessionId: "s1", design: FILE.design, mode: "off", eligible: true, stratum: "bench", arm: "orch-+", factors: FILE.factors });
  assert.equal(query(w.events, "s1")?.arm, "orch-+");
  assert.equal(query(w.events, "s1")?.design, FILE.design);
  assert.equal(w.entries[0].customType, ENTRY);
  assert.equal(existsSync(join(w.agentDir, "experiments", "blocks.json")), false, "no draw, no blocks");
});

test("T9.3 a file that is not a v1 assignment is ignored with a warning and the session is drawn as before (mode off: ineligible)", () => {
  for (const bad of ["{not json", { ...FILE, v: 2 }, { ...FILE, arm: 3 }, { ...FILE, factors: { x: { lever: "a.b" } } }, { ...FILE, stratum: undefined }]) {
    const w = world({ file: bad });
    w.start("s1");
    assert.deepEqual(w.rows().map((r) => [r.eligible, r.arm]), [[false, undefined]], JSON.stringify(bad));
  }
});

test("T9.4 a process lever the bench wrote into settings.json reads back confirmed: s pe, rb confirmed, tier seed", () => {
  const w = world({ file: FILE, settings: { compaction: { reserveTokens: 8000 } } });
  w.start("s1");
  w.before("s1");
  const st = query(w.events, "s1")!.levers["pi.compaction.reserveTokens"];
  assert.deepEqual(st, { v: 8000, s: "pe", a: 8000, rb: "confirmed", tier: "seed" });
  assert.equal(w.heard.at(-1)?.levers["pi.compaction.reserveTokens"].rb, "confirmed", "published on the channel too");
  assert.deepEqual(Object.keys(query(w.events, "s1")!.levers), ["pi.compaction.reserveTokens"], "the router factor has no add-on here");
});

test("T9.4 the project's settings override the global ones: a different effective value is refused, source fixed", () => {
  const w = world({ file: FILE, settings: { compaction: { reserveTokens: 8000 } }, project: { compaction: { reserveTokens: 4000 } } });
  w.start("s1");
  w.before("s1");
  assert.deepEqual(query(w.events, "s1")!.levers["pi.compaction.reserveTokens"], { v: 4000, s: "fixed", a: 8000, rb: "refused", tier: "seed" });
});

test("T9.4 no settings value to observe: unverified (v = a assumed)", () => {
  const w = world({ file: FILE });
  w.start("s1");
  w.before("s1");
  assert.deepEqual(query(w.events, "s1")!.levers["pi.compaction.reserveTokens"], { v: 8000, s: "pe", a: 8000, rb: "unverified", tier: "seed" });
});

test("T9.4 the other compaction levers and enabled=false; an unknown pi lever has no add-on", () => {
  const f = { ...FILE, factors: {
    on: { lever: "pi.compaction.enabled", assigned: false },
    keep: { lever: "pi.compaction.keepRecentTokens", assigned: 5000 },
    other: { lever: "pi.nothing", assigned: 1 },
  } };
  const w = world({ file: f, settings: { compaction: { enabled: false, keepRecentTokens: 5000 } } });
  w.start("s1");
  w.before("s1");
  const l = query(w.events, "s1")!.levers;
  assert.deepEqual(Object.keys(l).sort(), ["pi.compaction.enabled", "pi.compaction.keepRecentTokens"]);
  assert.equal(l["pi.compaction.enabled"].rb, "confirmed");
  assert.equal(l["pi.compaction.keepRecentTokens"].rb, "confirmed");
});
