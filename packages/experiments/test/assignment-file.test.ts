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

function world(o: { file?: unknown; settings?: unknown; project?: unknown; mode?: "off" | "explore" | "exploit"; trusted?: boolean } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-file-"));
  const cwd = mkdtempSync(join(tmpdir(), "experiments-file-cwd-"));
  mkdirSync(join(agentDir, "experiments"), { recursive: true });
  if (o.file !== undefined) writeFileSync(join(agentDir, "experiments", "assignment.json"), typeof o.file === "string" ? o.file : JSON.stringify(o.file));
  if (o.settings !== undefined) writeFileSync(join(agentDir, "settings.json"), JSON.stringify(o.settings));
  if (o.project !== undefined) { mkdirSync(join(cwd, ".pi")); writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(o.project)); }
  const notes: string[] = [];
  const f = fakePi();
  const heard: Levers[] = [];
  onAssigned(f.events, (l) => void heard.push(l));
  install(f.pi, { agentDir, settings: { ...defaults(), mode: o.mode ?? "off" }, rng: () => { throw new Error("drew"); }, api: () => undefined });
  const ctx = (sid: string) => ({
    cwd, isProjectTrusted: () => o.trusted ?? true, hasUI: true, ui: { notify: (m: string) => void notes.push(m) },
    model: { provider: "anthropic", id: "claude-opus-5-5" },
    sessionManager: { getSessionId: () => sid, getSessionDir: () => join(agentDir, "sessions"), getSessionFile: () => join(agentDir, "sessions", `x_${sid}.jsonl`), getBranch: () => [] },
  });
  const start = (sid: string) => f.fire("session_start", { type: "session_start", reason: "startup" }, ctx(sid));
  const before = (sid: string) => f.fire("before_agent_start", {}, ctx(sid));
  const rows = () => (existsSync(join(agentDir, "experiments", "assignments.jsonl")) ? readFileSync(join(agentDir, "experiments", "assignments.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { ...f, agentDir, heard, start, before, rows, notes };
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

test("T9.3 / review M1 a file that is not a v1 assignment (unparseable included) is ignored with exactly one notification and the session is drawn as before (mode off: ineligible); an absent file is silent", () => {
  for (const bad of ["{not json", "", "null", { ...FILE, v: 2 }, { ...FILE, arm: 3 }, { ...FILE, factors: { x: { lever: "a.b" } } }, { ...FILE, stratum: undefined }, { ...FILE, stratum: "api" }]) {
    delete (globalThis as { __piEconomicsWarned_v1?: unknown }).__piEconomicsWarned_v1;
    const w = world({ file: bad });
    w.start("s1");
    assert.deepEqual(w.rows().map((r) => [r.eligible, r.arm]), [[false, undefined]], JSON.stringify(bad));
    const mine = () => w.notes.filter((n) => n.includes("assignment.json")); // the actor-missing notice is another
    assert.equal(mine().length, 1, `one notification for ${JSON.stringify(bad)}`);
    w.start("s2");
    assert.equal(mine().length, 1, "once per process");
  }
  const none = world();
  none.start("s1");
  assert.deepEqual(none.notes.filter((n) => n.includes("assignment.json")), []);
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

test("review M2 no settings value: pi runs its default, which is what is recorded: refused (settings not honoured), or confirmed when the assignment is the default", () => {
  const w = world({ file: FILE });
  w.start("s1");
  w.before("s1");
  assert.deepEqual(query(w.events, "s1")!.levers["pi.compaction.reserveTokens"], { v: 16384, s: "fixed", a: 8000, rb: "refused", tier: "seed" });
  const d = world({ file: { ...FILE, factors: { r: { lever: "pi.compaction.reserveTokens", assigned: 16384 }, k: { lever: "pi.compaction.keepRecentTokens", assigned: 20000 }, e: { lever: "pi.compaction.enabled", assigned: true } } } });
  d.start("s1");
  d.before("s1");
  const l = query(d.events, "s1")!.levers;
  assert.deepEqual(Object.values(l).map((x) => [x.v, x.rb]), [[16384, "confirmed"], [20000, "confirmed"], [true, "confirmed"]]);
});

test("review M2 an untrusted project's settings are not read (pi skips them); a trusted one's are", () => {
  const settings = { compaction: { reserveTokens: 8000 } };
  const project = { compaction: { reserveTokens: 4000 } };
  const u = world({ file: FILE, settings, project, trusted: false });
  u.start("s1");
  u.before("s1");
  assert.equal(query(u.events, "s1")!.levers["pi.compaction.reserveTokens"].rb, "confirmed");
  const t = world({ file: FILE, settings, project, trusted: true });
  t.start("s1");
  t.before("s1");
  assert.equal(query(t.events, "s1")!.levers["pi.compaction.reserveTokens"].v, 4000);
});

test("review M2 compaction.modelOverrides of the session's model win over the ordinary setting (pi's order: override, setting, default)", () => {
  const overrides = (m: string, r: number) => ({ compaction: { reserveTokens: 8000, modelOverrides: { [m]: { reserveTokens: r } } } });
  const hit = world({ file: FILE, settings: overrides("anthropic/claude-opus-5-5", 2000) });
  hit.start("s1");
  hit.before("s1");
  assert.deepEqual(query(hit.events, "s1")!.levers["pi.compaction.reserveTokens"], { v: 2000, s: "fixed", a: 8000, rb: "refused", tier: "seed" });
  const same = world({ file: FILE, settings: overrides("anthropic/claude-opus-5-5", 8000) });
  same.start("s1");
  same.before("s1");
  assert.equal(query(same.events, "s1")!.levers["pi.compaction.reserveTokens"].rb, "confirmed");
  const other = world({ file: FILE, settings: overrides("openai/gpt-5", 2000) });
  other.start("s1");
  other.before("s1");
  assert.equal(query(other.events, "s1")!.levers["pi.compaction.reserveTokens"].rb, "confirmed", "another model's override does not apply");
});

test("review M2 / n2 a value pi rejects (negative, fractional, unsafe, wrong type) is not an observation: unverified", () => {
  for (const bad of [-1, 1.5, 2 ** 60, "8000", null]) {
    const w = world({ file: FILE, settings: { compaction: { reserveTokens: bad } } });
    w.start("s1");
    w.before("s1");
    assert.equal(query(w.events, "s1")!.levers["pi.compaction.reserveTokens"].rb, "unverified", String(bad));
  }
  const f = { ...FILE, factors: { r: { lever: "pi.compaction.reserveTokens", assigned: 2 ** 60 }, n: { lever: "pi.compaction.keepRecentTokens", assigned: 1.5 } } };
  const w = world({ file: f });
  w.start("s1");
  w.before("s1");
  assert.deepEqual(Object.values(query(w.events, "s1")!.levers).map((x) => [x.rb, x.s]), [["refused", "fixed"], ["refused", "fixed"]], "an infeasible level (not a safe count) is refused up front: pi's own value stands");
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

test("review m3 the file is adopted in every mode (off, explore, exploit), and nothing is drawn or blocked", () => {
  for (const mode of ["off", "explore", "exploit"] as const) {
    const w = world({ file: FILE, mode });
    w.start("s1");
    const [r] = w.rows();
    assert.deepEqual([r.mode, r.eligible, r.arm, r.stratum], [mode, true, "orch-+", "bench"], mode);
    assert.equal(existsSync(join(w.agentDir, "experiments", "blocks.json")), false, mode);
  }
});

test("review m3 a resumed session keeps its branch entry or its row: the file is only for a new unit", () => {
  const entry = { type: "custom", customType: ENTRY, data: { sessionId: "s1", eligible: true, arm: "old", design: "ffffffffffff", stratum: "api", factors: {} } };
  const w = world({ file: FILE });
  w.fire("session_start", { type: "session_start", reason: "resume" }, { hasUI: true, ui: { notify: () => {} }, model: { provider: "anthropic", id: "m" }, sessionManager: { getSessionId: () => "s1", getSessionDir: () => "/x", getSessionFile: () => "/x/x_s1.jsonl", getBranch: () => [entry] } });
  assert.equal(query(w.events, "s1")?.arm, "old");
  assert.deepEqual([w.rows(), w.entries], [[], []]);
  const v = world({ file: FILE });
  writeFileSync(join(v.agentDir, "experiments", "assignments.jsonl"), JSON.stringify({ v: 2, ts: "t", sessionId: "s1", design: "eeeeeeeeeeee", mode: "off", eligible: true, stratum: "api", arm: "rowarm", factors: {} }) + "\n");
  v.start("s1");
  assert.equal(query(v.events, "s1")?.arm, "rowarm");
  assert.equal(v.rows().length, 1, "no second row");
});

test("review m3 without experiments/settings.json (the opt-in) the engine stays inert even with the file", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-file-optin-"));
  mkdirSync(join(agentDir, "experiments"), { recursive: true });
  writeFileSync(join(agentDir, "experiments", "assignment.json"), JSON.stringify(FILE));
  const f = fakePi();
  install(f.pi, { agentDir, rng: () => 0.5, api: () => undefined });
  f.fire("session_start", { type: "session_start", reason: "startup" }, { hasUI: true, ui: { notify: () => {} }, model: { provider: "anthropic", id: "m" }, sessionManager: { getSessionId: () => "s1", getSessionDir: () => join(agentDir, "sessions"), getSessionFile: () => join(agentDir, "sessions", "x_s1.jsonl"), getBranch: () => [] } });
  assert.equal(existsSync(join(agentDir, "experiments", "assignments.jsonl")), false);
  assert.deepEqual(f.entries, []);
  assert.equal(query(f.events, "s1"), undefined);
});

test("review m3 a child under a file-adopted root runs the root's bench arm: no draw, no row of its own", () => {
  const w = world({ file: FILE });
  w.start("main-1");
  assert.equal(w.rows().length, 1);
  const child = fakePi();
  const heard: Levers[] = [];
  onAssigned(child.events, (l) => void heard.push(l));
  install(child.pi, { agentDir: w.agentDir, settings: defaults(), rng: () => { throw new Error("drew"); }, api: () => undefined });
  child.fire("session_start", { type: "session_start", reason: "startup" }, { hasUI: false, model: { provider: "anthropic", id: "m" }, sessionManager: { getSessionId: () => "c1", getSessionDir: () => join(w.agentDir, "sessions"), getSessionFile: () => join(w.agentDir, "sessions", "subagents", "main-1", "x_c1.jsonl"), getBranch: () => [] } });
  const a = query(child.events, "c1")!;
  assert.deepEqual([a.arm, a.design, a.stratum, a.parentSessionId, a.eligible], ["orch-+", FILE.design, "bench", "main-1", true]);
  assert.equal(w.rows().length, 1, "the engine writes no child row");
  assert.deepEqual(child.entries, []);
});
