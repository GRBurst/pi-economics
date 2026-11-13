// Session lifecycle of the v2 engine (redesign M5b.1, §7.3, §5.4): stratum and eligibility at session_start,
// assignments v2, the internal channel and the custom entry, resume, legacy rows. Children: child.test.ts (M5b.2).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onAssigned, query, type Assigned } from "../core/channel.ts";
import { design, designFor, type Factor } from "../core/design.ts";
import { V4_FACTORS, defaults, type Settings } from "../core/settings.ts";
import { ENTRY, install } from "../core/shell.ts";
import { fakePi, type Entry } from "./fake.ts";

type G = { __piEconomicsWarned_v1?: Set<string> };
beforeEach(() => void delete (globalThis as G).__piEconomicsWarned_v1);

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
  const subscribed: unknown[] = [];
  const sub = { list: () => opts.agents ?? [], subscribe: (l: unknown) => (subscribed.push(l), () => {}) };
  const settings = { ...defaults(), ...over };
  const published: Assigned[] = [];
  // The assignment part of each publication (the levers states are levers.test.ts's; no target asks here: always {}).
  onAssigned(f.events, ({ levers: _levers, ...a }) => void published.push(a));
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
  const file = join(agentDir, "experiments", "assignments.jsonl");
  const rows = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { ...f, agentDir, sessionDir, start, ctxOf, rows, notes, published, subscribed, settings };
}

const API = designFor("api", { factors: V4_FACTORS }); // the default stratum of a provider without a plan
const assignedOf = (r: any): Assigned => {
  const { v: _v, ts: _ts, mode: _m, ...a } = r;
  return a;
};

test("T5b1.3 an eligible main: one assignments v2 row with stratum, design, arm and factors; the same Assigned on the channel and as the custom entry", () => {
  const h = harness();
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
  // The channel's answer (the same Assigned, with the levers states; no target asked here: none).
  assert.deepEqual(query(h.events, "s1"), { ...assignedOf(r), levers: {} });
});

test("T5b1.3 ineligible mains get a v2 row without arm or factors: mode off, no matching stratum, no model, every arm disabled", () => {
  const off = harness({ mode: "off" });
  off.start("s1");
  assert.deepEqual(off.rows().map((r) => ({ ...r, ts: 0 })), [{ v: 2, ts: 0, sessionId: "s1", design: API.id, mode: "off", eligible: false, stratum: "api" }]);
  assert.deepEqual([query(off.events, "s1")?.arm, query(off.events, "s1")?.factors], [undefined, undefined]);
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

test("a stratum's factors on the channel name their levers; a level keeps its type", () => {
  const h = harness({ strata: { api: { match: {}, factors: [{ name: "ttl", lever: "cache-lifecycle.mainCacheTtl", levels: ["5m", "1h"] }, { name: "q", lever: "router.quantile", levels: [0.25, 0.75] }] } } });
  h.start("s1");
  const { factors } = h.rows()[0];
  assert.deepEqual(query(h.events, "s1")?.factors, factors);
  assert.equal(typeof factors.q.assigned, "number");
});

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
    assert.deepEqual(h.rows(), [row]);
    // The add-ons read factors: the row's flags of the v4 factors, over their levers (M5b.2).
    const factors = Object.fromEntries(V4_FACTORS.filter((f) => f.name in row.flags).map((f) => [f.name, { lever: f.lever, assigned: (row.flags as Record<string, string>)[f.name] }]));
    assert.deepEqual(h.published, [{ sessionId: "old", eligible: true, arm: row.arm, ...("design" in row ? { design: row.design } : {}), factors }]);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      h.start(`n${i}`);
      seen.add(h.rows().at(-1).arm);
    }
    assert.equal(seen.size, 8);
    assert.deepEqual(h.rows().slice(1).map((r) => [r.v, r.design]), Array(8).fill([2, API.id]));
  });
}

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
  assert.equal(query(h.events, "s1")?.arm, (entry.data as Assigned).arm, "the channel serves the reused arm");
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
  const before = { rows: h.rows(), entries: [...h.entries], published: [...h.published], answer: query(h.events, "s1") };
  const claude = { provider: "anthropic", id: "claude-opus-4" };
  h.fire("model_select", { type: "model_select", model: claude, previousModel: { provider: "openai", id: "gpt-5" }, source: "set" }, h.ctxOf("s1", { model: claude }));
  h.start("s1", { reason: "reload", model: claude, branch: before.entries });
  assert.deepEqual(h.rows(), before.rows);
  assert.deepEqual(h.entries, before.entries);
  assert.deepEqual(h.published, [...before.published, before.published[0]], "the reload republishes the same Assigned");
  assert.deepEqual(query(h.events, "s1"), before.answer);
  assert.equal(before.rows[0].stratum, "api");
});

// Review M1 (the actor's engine outlives /reload; a stale runtime's listener must not throw into it) is moot since
// M5b.2: the engine no longer subscribes to the actor; a child's runtime derives its own assignment (child.test.ts).
test("T5b2.7 the engine never subscribes to the actor's events (D5: no parent-side inheritance)", () => {
  const h = harness({}, { agents: [{ name: "main", sessionId: "s1" }, { name: "w1", sessionId: "c1" }] });
  h.start("s1");
  assert.deepEqual(h.subscribed, []);
  assert.equal(query(h.events, "c1"), undefined, "a child's session is its own runtime's to answer");
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

// Review m3: the v1 engine's keys set on purpose (package route; Nix warns at build time) are named once.
test("review m3: settings with the v1 engine's factors/maxArms/baseline → one warning naming them; the session still gets a v2 arm", () => {
  const h = harness({ legacy: ["factors", "baseline"] });
  h.start("s1");
  h.start("s2");
  const w = h.notes.filter((n) => n.startsWith("experiments: ignores"));
  assert.deepEqual(w, ["experiments: ignores the settings factors, baseline (the v1 engine's): its factors come from strata (default: one stratum per billing class); baseline only labels the analyses of v1–v4 designs"]);
  assert.equal(h.rows()[0].design, API.id);
  delete (globalThis as G).__piEconomicsWarned_v1;
  const none = harness();
  none.start("s3");
  assert.equal(none.notes.filter((n) => n.startsWith("experiments: ignores")).length, 0);
});
