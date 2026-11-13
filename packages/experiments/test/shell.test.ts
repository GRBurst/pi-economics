// Session lifecycle of the v2 engine (redesign M5b.1, §7.3, §5.4): stratum and eligibility at session_start,
// assignments v2, the internal channel and the custom entry, spawn → inherit, resume, legacy rows.
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onAssigned, type Assigned } from "../core/channel.ts";
import { design, designFor, type Factor } from "../core/design.ts";
import { V4_FACTORS, defaults, type Settings } from "../core/settings.ts";
import { ENTRY, install } from "../core/shell.ts";
import { fakePi, reloadWorld, type Entry } from "./fake.ts";

type G = { __piExperimentsApi_v1?: any; __piEconomicsWarned_v1?: Set<string> };
beforeEach(() => void delete (globalThis as G).__piEconomicsWarned_v1);
afterEach(() => void delete (globalThis as G).__piExperimentsApi_v1);

/** Deterministic seeded RNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Start = { model?: { provider: string; id: string } | null; file?: string; branch?: Entry[]; reason?: string };
function harness(over: Partial<Settings> = {}, opts: { agents?: any[]; plans?: unknown } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-shell-"));
  if (opts.plans !== undefined) {
    mkdirSync(join(agentDir, "token-meter"), { recursive: true });
    writeFileSync(join(agentDir, "token-meter", "settings.json"), JSON.stringify({ plans: opts.plans }));
  }
  const f = fakePi();
  const listeners: Array<(e: any) => void> = [];
  const sub = { list: () => opts.agents ?? [], subscribe: (l: any) => (listeners.push(l), () => {}) };
  const settings = { ...defaults(), ...over };
  const published: Assigned[] = [];
  onAssigned(f.events, (a) => void published.push(a));
  install(f.pi, { agentDir, settings, rng: mulberry32(11), api: () => sub });
  const sessionDir = join(agentDir, "sessions");
  const notes: string[] = [];
  const ctxOf = (sid: string, s: Start = {}) => ({
    hasUI: true,
    ui: { notify: (m: string) => void notes.push(m) },
    model: s.model === null ? undefined : (s.model ?? { provider: "openai", id: "gpt-5" }),
    sessionManager: { getSessionId: () => sid, getSessionDir: () => sessionDir, getSessionFile: () => s.file ?? join(sessionDir, `x_${sid}.jsonl`), getBranch: () => s.branch ?? [] },
  });
  const start = (sid: string, s: Start = {}) => f.fire("session_start", { type: "session_start", reason: s.reason ?? "startup" }, ctxOf(sid, s));
  const emit = (e: unknown) => listeners.forEach((l) => l(e));
  const file = join(agentDir, "experiments", "assignments.jsonl");
  const rows = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { ...f, agentDir, sessionDir, start, ctxOf, emit, rows, notes, published, api: () => (globalThis as G).__piExperimentsApi_v1, settings };
}

const API = designFor("api", { factors: V4_FACTORS }); // the default stratum of a provider without a plan
const assignedOf = (r: any): Assigned => {
  const { v: _v, ts: _ts, mode: _m, ...a } = r;
  return a;
};

test("T5b1.3 an eligible main: one assignments v2 row with stratum, design, arm and factors; the same Assigned on the channel and as the custom entry", () => {
  const h = harness();
  assert.equal(h.api().version, 1);
  h.start("s1");
  const [r, ...more] = h.rows();
  assert.equal(more.length, 0);
  assert.equal(r.v, 2);
  assert.equal(typeof r.ts, "string");
  assert.deepEqual(Object.keys(r), ["v", "ts", "sessionId", "design", "mode", "eligible", "stratum", "arm", "factors"]);
  assert.deepEqual({ ...r, ts: 0, arm: 0, factors: 0 }, { v: 2, ts: 0, sessionId: "s1", design: API.id, mode: "explore", eligible: true, stratum: "api", arm: 0, factors: 0 });
  const arm = API.arms.find((a) => a.name === r.arm);
  assert.ok(arm, `arm ${r.arm} is one of the design's`);
  assert.deepEqual(r.factors, Object.fromEntries(V4_FACTORS.map((f) => [f.name, { lever: f.lever, assigned: arm.levels[f.name] }])));
  assert.deepEqual(h.published, [assignedOf(r)]);
  assert.deepEqual(h.entries, [{ type: "custom", customType: ENTRY, data: assignedOf(r) }]);
  assert.equal(ENTRY, "pi-economics:assignment");
  // The process-global API (until M5b.2): the arm, its levels by the lever's name, its design and stratum.
  assert.deepEqual(h.api().armFor("s1"), { id: r.arm, flags: Object.fromEntries(V4_FACTORS.map((f) => [f.name, String(arm.levels[f.name])])), design: API.id, stratum: "api" });
});

test("T5b1.3 ineligible mains get a v2 row without arm or factors: mode off, no matching stratum, no model, every arm disabled", () => {
  const off = harness({ mode: "off" });
  off.start("s1");
  assert.deepEqual(off.rows().map((r) => ({ ...r, ts: 0 })), [{ v: 2, ts: 0, sessionId: "s1", design: API.id, mode: "off", eligible: false, stratum: "api" }]);
  assert.equal(off.api().armFor("s1"), undefined);
  assert.equal(off.api().flag("warmPolicy", "own", "s1"), "own");
  assert.deepEqual(off.published, [{ sessionId: "s1", design: API.id, eligible: false, stratum: "api" }]);

  const local = harness({ strata: { local: { match: { billing: ["local"] } } } });
  local.start("s1");
  local.start("s2", { model: null });
  assert.deepEqual(local.rows().map((r) => ({ ...r, ts: 0 })), [
    { v: 2, ts: 0, sessionId: "s1", mode: "explore", eligible: false },
    { v: 2, ts: 0, sessionId: "s2", mode: "explore", eligible: false },
  ]);

  const killed = harness();
  mkdirSync(join(killed.agentDir, "experiments"), { recursive: true });
  writeFileSync(join(killed.agentDir, "experiments", "state.json"), JSON.stringify({ designs: { [API.id]: { api: { disabled: API.arms.map((a) => a.name) } } } }));
  killed.start("s1");
  assert.deepEqual(killed.rows().map((r) => ({ ...r, ts: 0 })), [{ v: 2, ts: 0, sessionId: "s1", design: API.id, mode: "explore", eligible: false, stratum: "api" }]);
});

test("T5b1.3 strata from the settings and plans from token-meter's settings file: a subscription model gets its own stratum and design", () => {
  const h = harness({}, { plans: { anthropic: { billing: "subscription", windows: ["5h"] }, ollama: { billing: "local", windows: [] } } });
  h.start("s1", { model: { provider: "anthropic", id: "claude-opus-4" } });
  h.start("s2", { model: { provider: "ollama", id: "qwen3" } });
  h.start("s3", { model: { provider: "openai", id: "gpt-5" } });
  const [sub, local, api] = h.rows();
  assert.deepEqual([sub.stratum, sub.design, sub.eligible], ["subscription", designFor("subscription", { factors: V4_FACTORS }).id, true]);
  // The default local stratum has no factors (OQ3): its design has one arm, "", and no levels to set.
  assert.deepEqual([local.stratum, local.design, local.eligible, local.arm, local.factors], ["local", designFor("local", { factors: [] }).id, true, "", {}]);
  assert.deepEqual([api.stratum, api.eligible], ["api", true]);
});

test("T5b1.3 explore: permuted blocks over sessions (blocks.json), per stratum; every row with an arm names its design", () => {
  const h = harness({}, { plans: { anthropic: { billing: "subscription", windows: ["5h"] } } });
  const arms: Record<string, string[]> = { api: [], subscription: [] };
  for (let i = 0; i < 16; i++) {
    const model = i % 2 ? { provider: "anthropic", id: "c" } : { provider: "openai", id: "g" };
    h.start(`s${i}`, { model });
    const r = h.rows().at(-1);
    arms[r.stratum].push(r.arm);
  }
  assert.equal(new Set(arms.api).size, 8, "api: each of the 8 arms once");
  assert.equal(new Set(arms.subscription).size, 8, "subscription: each of the 8 arms once");
  assert.ok(existsSync(join(h.agentDir, "experiments", "blocks.json")));
  for (const r of h.rows()) if ("arm" in r) assert.equal(typeof r.design, "string", `row ${r.sessionId}: an arm without design would be read as v4 by its length`);
});

test("T5b1.3 exploit: Thompson over state.json's posterior of this design in this stratum", () => {
  const h = harness({ mode: "exploit", minExplore: 0 });
  mkdirSync(join(h.agentDir, "experiments"), { recursive: true });
  const best = API.arms[5].name;
  writeFileSync(join(h.agentDir, "experiments", "state.json"), JSON.stringify({
    posterior: { "---": { mean: 100, sd: 0 } }, // design v4's (flat, by v4 arm id): never read for a v2 design
    designs: { [API.id]: { api: { posterior: Object.fromEntries(API.arms.map((a) => [a.name, { mean: a.name === best ? -1 : -10, sd: 0 }])) } } },
  }));
  h.start("s1");
  assert.equal(h.rows()[0].arm, best);
});

test("T5b1.3 a malformed stratum is dropped and the user is told why, once per process", () => {
  const h = harness({ strata: { api: { match: {} }, bad: { match: 1 } } });
  h.start("s1");
  h.start("s2");
  assert.deepEqual(h.notes.filter((n) => n.includes("stratum")), ["experiments stratum bad dropped: match is not an object"]);
  assert.deepEqual(h.rows().map((r) => r.stratum), ["api", "api"]);
});

test("a stratum's flags on the global API are keyed by the lever's name; levels become strings", () => {
  const h = harness({ strata: { api: { match: {}, factors: [{ name: "ttl", lever: "cache-lifecycle.mainCacheTtl", levels: ["5m", "1h"] }, { name: "q", lever: "router.quantile", levels: [0.25, 0.75] }] } } });
  h.start("s1");
  const { factors } = h.rows()[0];
  assert.equal(h.api().flag("mainCacheTtl", "own", "s1"), factors.ttl.assigned);
  assert.equal(h.api().flag("quantile", "own", "s1"), String(factors.q.assigned));
  assert.equal(h.api().flag("ttl", "own", "s1"), "own", "the factor's name is a label");
});

test("a spawn event maps the child session to its parent's arm (main and child parents)", () => {
  const h = harness({}, { agents: [{ name: "w1", sessionId: "s-w1" }] });
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

// Rows of the v1 engine (assignments v1: design absent = v1, "v2", "v3", "v4"): a resumed session keeps the arm and flags
// it was run with (no new draw, no new row); they never fill a v2 design's blocks.
const SIX: Factor[] = [
  { name: "warmPolicy", values: ["native", "orchestrator-aware"] },
  { name: "mainCacheTtl", values: ["5m", "1h"] },
  { name: "foldHint", values: ["fixed", "cache-aware"] },
  { name: "maskOnCold", values: ["off", "on"] },
  { name: "freshOnCold", values: ["off", "advise"] },
  { name: "delegationRule", values: ["off", "on"] },
];
const V4: Factor[] = [
  { name: "warmPolicy", values: ["native", "orchestrator-aware"] },
  { name: "mainCacheTtl", values: ["5m", "1h"] },
  { name: "maskOnCold", values: ["off", "on"] },
];
const legacy = [
  { name: "v1", row: { ts: "2026-10-03T08:00:00.000Z", sessionId: "old", arm: "+-+--", mode: "explore", flags: { warmPolicy: "orchestrator-aware", mainCacheTtl: "5m", foldHint: "cache-aware", maskOnCold: "off", freshOnCold: "off" } } },
  ...["v2", "v3"].map((d) => ({ name: d, row: { v: 1, ts: "2026-10-03T08:00:00.000Z", sessionId: "old", arm: design(SIX, 16)[3].id, design: d, mode: "explore", flags: design(SIX, 16)[3].flags } })),
  { name: "v4", row: { v: 1, ts: "2026-10-03T08:00:00.000Z", sessionId: "old", arm: design(V4, 16)[5].id, design: "v4", mode: "explore", flags: design(V4, 16)[5].flags } },
];
for (const { name, row } of legacy) {
  test(`a resumed session assigned under ${name} keeps its arm and flags (no new row); new sessions are v2 and balanced`, () => {
    const h = harness();
    mkdirSync(join(h.agentDir, "experiments"), { recursive: true });
    writeFileSync(join(h.agentDir, "experiments", "assignments.jsonl"), JSON.stringify(row) + "\n");
    h.start("old");
    assert.deepEqual(h.api().armFor("old"), { id: row.arm, flags: row.flags, ...("design" in row ? { design: row.design } : {}) });
    assert.equal(h.api().flag("delegationRule", "off", "old"), (row.flags as Record<string, string>).delegationRule ?? "off");
    assert.deepEqual(h.rows(), [row]);
    assert.deepEqual(h.published, [{ sessionId: "old", eligible: true, arm: row.arm, ...("design" in row ? { design: row.design } : {}) }]);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      h.start(`n${i}`);
      seen.add(h.rows().at(-1).arm);
    }
    assert.equal(seen.size, 8);
    assert.deepEqual(h.rows().slice(1).map((r) => [r.v, r.design]), Array(8).fill([2, API.id]));
  });
}

import { query } from "../core/channel.ts";

test("T5b1.5 children inherit via the actor's spawn events: a child's Assigned is its parent's but for sessionId and parentSessionId", () => {
  for (const mode of ["explore", "off"] as const) {
    const h = harness({ mode }, { agents: [{ name: "w1", sessionId: "s-w1" }] });
    h.start("main-1");
    const main = h.published[0];
    h.emit({ type: "spawn", name: "w1", by: "main", parent: "main", childSessionId: "s-w1", ts: 1 });
    h.emit({ type: "spawn", name: "w2", by: "w1", parent: "w1", childSessionId: "s-w2", ts: 2 });
    h.emit({ type: "spawn", name: "w3", by: "main", parent: "main", ts: 3 }); // no session id yet: ignored
    const w1 = { ...main, sessionId: "s-w1", parentSessionId: "main-1" };
    const w2 = { ...main, sessionId: "s-w2", parentSessionId: "s-w1" };
    assert.deepEqual(h.published, [main, w1, w2], mode);
    assert.deepEqual([query(h.events, "s-w1"), query(h.events, "s-w2"), query(h.events, "s-w3")], [w1, w2, undefined], mode);
    assert.equal(h.rows().length, 1, `${mode}: children get no row`);
    assert.deepEqual(h.entries.map((e) => (e.data as Assigned).sessionId), ["main-1"], `${mode}: nor a custom entry`);
  }
});

test("T5b1.5 a resumed child (no spawn event since the restart) is answered from its session file layout", () => {
  const h = harness();
  h.start("main-1");
  const childDir = join(h.sessionDir, "subagents", "main-1");
  mkdirSync(childDir, { recursive: true });
  writeFileSync(join(childDir, "2026-10-03T12-00-00-000Z_s-child.jsonl"), "");
  mkdirSync(join(h.sessionDir, "subagents", "s-child"), { recursive: true });
  writeFileSync(join(h.sessionDir, "subagents", "s-child", "2026-10-03T12-00-01-000Z_s-grand.jsonl"), "");
  assert.deepEqual(query(h.events, "s-child"), { ...h.published[0], sessionId: "s-child", parentSessionId: "main-1" });
  assert.deepEqual(query(h.events, "s-grand"), { ...h.published[0], sessionId: "s-grand", parentSessionId: "s-child" });
  assert.equal(query(h.events, "s-orphan"), undefined);
});

test("T5b1.5 a child's own runtime (experiments loaded in it) never draws and writes no row", () => {
  const h = harness();
  h.start("s-child", { file: join(h.sessionDir, "subagents", "main-1", "x_s-child.jsonl") });
  assert.deepEqual([h.rows(), h.entries, h.published], [[], [], []]);
});

test("T5b1.6 resume reuses the branch's pi-economics:assignment entry: no draw, no row, no second entry", () => {
  const first = harness();
  first.start("s1");
  const [entry] = first.entries;
  // A later process (another runtime) resumes s1: the branch holds the entry, assignments.jsonl is not consulted.
  const h = harness();
  const blocks = join(h.agentDir, "experiments", "blocks.json");
  for (const reason of ["resume", "reload"]) {
    h.start("s1", { reason, branch: [{ type: "custom", customType: "other", data: { sessionId: "s1", eligible: false } }, entry] });
    assert.deepEqual(h.rows(), [], reason);
    assert.equal(existsSync(blocks), false, `${reason}: no draw`);
    assert.deepEqual(h.entries, [], reason);
    assert.deepEqual(h.published.at(-1), entry.data, reason);
  }
  assert.equal(h.api().armFor("s1").id, (entry.data as Assigned).arm, "the global API serves the reused arm");
});

test("T5b1.6 a fork (the branch's entry names another session) is a new unit; a malformed entry is ignored", () => {
  const h = harness();
  h.start("s1");
  const [entry] = h.entries;
  h.start("s2", { reason: "fork", branch: [entry] });
  h.start("s3", { branch: [{ type: "custom", customType: ENTRY, data: { sessionId: "s3", arm: "000" } }] }); // no eligible flag
  assert.deepEqual(h.rows().map((r) => [r.sessionId, r.eligible]), [["s1", true], ["s2", true], ["s3", true]]);
  assert.deepEqual(h.entries.map((e) => (e.data as Assigned).sessionId), ["s1", "s2", "s3"]);
});

test("T5b1.8 model_select keeps the unit (ITT, §7.3): no new draw, row, entry or Assigned; a reload after the switch keeps the start stratum", () => {
  const h = harness({}, { plans: { anthropic: { billing: "subscription", windows: ["5h"] } } });
  h.start("s1"); // openai: the api stratum
  const before = { rows: h.rows(), entries: [...h.entries], published: [...h.published], arm: h.api().armFor("s1") };
  const claude = { provider: "anthropic", id: "claude-opus-4" };
  h.fire("model_select", { type: "model_select", model: claude, previousModel: { provider: "openai", id: "gpt-5" }, source: "set" }, h.ctxOf("s1", { model: claude }));
  h.start("s1", { reason: "reload", model: claude, branch: before.entries });
  assert.deepEqual(h.rows(), before.rows);
  assert.deepEqual(h.entries, before.entries);
  assert.deepEqual(h.published, [...before.published, before.published[0]], "the reload republishes the same Assigned");
  assert.deepEqual(h.api().armFor("s1"), before.arm);
  assert.equal(before.rows[0].stratum, "api");
});

// Review M1: the actor's engine and __subagentsApi_v1 outlive /reload; a stale runtime's listener must neither stay
// subscribed nor throw into the actor's Engine.emit (spawn_subagent would fail and later listeners miss the event).
test("review M1: /reload → spawn: session_shutdown releases the actor subscription; the live runtime publishes once, nothing throws", () => {
  const w = reloadWorld();
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-reload-"));
  const sessionDir = join(agentDir, "sessions");
  const ctx = { hasUI: false, ui: { notify() {} }, model: { provider: "openai", id: "gpt-5" },
    sessionManager: { getSessionId: () => "main-1", getSessionDir: () => sessionDir, getSessionFile: () => join(sessionDir, "x_main-1.jsonl"), getBranch: () => [] } };
  const published: Assigned[] = [];
  onAssigned(w.raw, (a) => void published.push(a));
  const r1 = w.runtime();
  install(r1.pi, { agentDir, settings: defaults(), rng: mulberry32(3), api: () => w.actor as any });
  r1.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
  r1.fire("session_shutdown", { type: "session_shutdown" }, ctx); // pi emits it before invalidating the runtime
  r1.invalidate();
  const r2 = w.runtime();
  install(r2.pi, { agentDir, settings: defaults(), rng: mulberry32(3), api: () => w.actor as any });
  r2.fire("session_start", { type: "session_start", reason: "reload" }, ctx);
  assert.equal(w.listeners.size, 1, "only the live runtime listens to the actor");
  published.length = 0;
  assert.doesNotThrow(() => w.spawn({ type: "spawn", name: "w1", by: "main", parent: "main", childSessionId: "s-w1", ts: 1 }));
  assert.deepEqual(published.map((a) => [a.sessionId, a.parentSessionId]), [["s-w1", "main-1"]]);
});

test("review M1: a stale runtime still subscribed (no session_shutdown seen) never throws into the actor's engine", () => {
  const w = reloadWorld();
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-reload-"));
  const sessionDir = join(agentDir, "sessions");
  const ctx = { hasUI: false, ui: { notify() {} }, model: { provider: "openai", id: "gpt-5" },
    sessionManager: { getSessionId: () => "main-1", getSessionDir: () => sessionDir, getSessionFile: () => join(sessionDir, "x_main-1.jsonl"), getBranch: () => [] } };
  const r1 = w.runtime();
  install(r1.pi, { agentDir, settings: defaults(), rng: mulberry32(3), api: () => w.actor as any });
  r1.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
  r1.invalidate();
  const seen: string[] = [];
  w.actor.subscribe((e) => void seen.push(e.childSessionId)); // a later listener (the actor's own, the new runtime's)
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => w.spawn({ type: "spawn", name: "w1", by: "main", parent: "main", childSessionId: "s-w1", ts: 1 }));
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(seen, ["s-w1"]);
});

// Review m1: a malformed blocks.json never leaves a session unassigned; the user is told once; another process's
// temporary file is never touched (each writer has its own).
test("review m1: malformed blocks.json → the block is rebuilt, the session assigned, one warning; another process's tmp file untouched", () => {
  const h = harness();
  const dir = join(h.agentDir, "experiments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "blocks.json"), JSON.stringify({ [`${API.id}/api`]: { queue: "011" } }));
  writeFileSync(join(dir, "blocks.json.tmp"), "another process's write in flight");
  h.start("s1");
  h.start("s2");
  assert.deepEqual(h.rows().map((r) => [r.sessionId, r.eligible, typeof r.arm]), [["s1", true, "string"], ["s2", true, "string"]]);
  const b = JSON.parse(readFileSync(join(dir, "blocks.json"), "utf8"));
  assert.ok(Array.isArray(b[`${API.id}/api`].queue) && b[`${API.id}/api`].queue.length === 6, "rebuilt: 8 arms, 2 drawn");
  assert.equal(h.notes.filter((n) => n.startsWith("experiments: blocks.json")).length, 1, h.notes.join("\n"));
  assert.equal(readFileSync(join(dir, "blocks.json.tmp"), "utf8"), "another process's write in flight");
});
