// The engine seeds infinite-context's fold-reminder limit (redesign §7.4, M7a): before the extension's own session_start
// (and again at model_select) it appends the extension's settings record with the level's tokens in the matched rule's
// range; the extension adopts it, and the record after its handlers is the read-back. A stand-in for the extension
// keeps the contract's rule (a record that holds the rule's range and a value in it is kept, anything else drawn anew);
// the real code runs in the check ic-seed-contract.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onAssigned, query, type Levers } from "../core/channel.ts";
import { defaults } from "../core/settings.ts";
import { ENTRY, install } from "../core/shell.ts";
import { fakePi, type Entry } from "./fake.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: unknown }).__piEconomicsWarned_v1);

const LEVER = "infinite-context.nudgeAtTokens";
const NUDGE = { name: "nudge", lever: LEVER, levels: [0.25, 0.75] };
const haiku = { provider: "anthropic", id: "claude-haiku-5-5" };
const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const gpt = { provider: "openai", id: "gpt-5" };
const local = { provider: "example", id: "model-a" };
const localFixed = { provider: "example", id: "fixed" };
type Model = { provider: string; id: string };
type Nudge = number | readonly [number, number];
type Rule = { rule?: string; nudge: Nudge };

/** The settings file as the module renders it, and the same table the stand-in extension resolves by hand. */
const FILE = {
  nudgeAtTokens: 120_000,
  overrides: {
    anthropic: { nudgeAtTokens: [100_000, 200_000] },
    openai: { nudgeAtTokens: [100_000, 200_000] },
    example: { nudgeAtTokens: [300_000, 400_000] },
    "anthropic/claude-opus-5-5": { nudgeAtTokens: 400_000 },
    "example/fixed": { nudgeAtTokens: 250_000 },
  },
};
const RULES: Record<string, Rule> = {
  "anthropic/claude-haiku-5-5": { rule: "anthropic", nudge: [100_000, 200_000] },
  "anthropic/claude-opus-5-5": { rule: "anthropic/claude-opus-5-5", nudge: 400_000 },
  "openai/gpt-5": { rule: "openai", nudge: [100_000, 200_000] },
  "example/model-a": { rule: "example", nudge: [300_000, 400_000] },
  "example/fixed": { rule: "example/fixed", nudge: 250_000 },
};
const key = (m: Model) => `${m.provider}/${m.id}`;
/** What a level q is, in tokens, in [min, max] — written out here, not taken from the add-on under test. */
const at = (r: readonly [number, number], q: number) => Math.round(r[0] + q * (r[1] - r[0]));
const same = (a: unknown, b: readonly number[]) => Array.isArray(a) && a.length === 2 && a[0] === b[0] && a[1] === b[1];

type Rec = Record<string, unknown>;
const records = (entries: Entry[]) => entries.filter((e) => e.customType === "infinite-context:settings").map((e) => e.data as Rec);

/**
 * One runtime on `agentDir`: experiments (a stratum matching every main, one factor on the lever), then the stand-in for
 * infinite-context, which registers its tool and follows the model at session_start and model_select like the patch.
 * `table`: the rules the stand-in resolves (default: RULES, the file's); `ignoresSeed`: it draws whatever it finds.
 */
function runtime(o: { agentDir?: string; loaded?: boolean; table?: Record<string, Rule>; ignoresSeed?: boolean; entries?: Entry[]; draw?: number; rng?: number; silent?: boolean; others?: string[]; defaultStrata?: boolean; strata?: Record<string, unknown>; mode?: "off" | "explore" } = {}) {
  const agentDir = o.agentDir ?? mkdtempSync(join(tmpdir(), "experiments-ic-"));
  mkdirSync(join(agentDir, "infinite-context"), { recursive: true });
  writeFileSync(join(agentDir, "infinite-context", "settings.json"), JSON.stringify(FILE));
  const f = fakePi();
  const tools: string[] = []; // the names pi's getAllTools reports
  Object.assign(f.pi, { getAllTools: () => tools.map((name) => ({ name })) });
  f.entries.push(...(o.entries ?? []));
  const heard: Levers[] = [];
  onAssigned(f.events, (l) => void heard.push(l));
  // defaultStrata: no `strata` setting, provider example bills as local: the default local stratum (P12) applies to it.
  if (o.defaultStrata) {
    mkdirSync(join(agentDir, "token-meter"), { recursive: true });
    writeFileSync(join(agentDir, "token-meter", "settings.json"), JSON.stringify({ plans: { example: { billing: "local", windows: [] } } }));
  }
  install(f.pi, { agentDir, settings: { ...defaults(), ...(o.mode === undefined ? {} : { mode: o.mode }), ...(o.defaultStrata ? {} : { strata: o.strata ?? { any: { match: {}, factors: [NUDGE] } } }) }, rng: () => o.rng ?? 0.5, api: () => undefined });
  const table = o.table ?? RULES;
  tools.push(...(o.others ?? []));
  if (o.loaded !== false) tools.push("context_fold");
  const follow = (model: Model) => {
    const { rule, nudge } = table[key(model)] ?? { nudge: 150_000 };
    const named = rule === undefined ? {} : { rule };
    const latest = records(f.entries).at(-1);
    let next: Rec;
    if (typeof nudge === "number") next = { nudgeAtTokens: nudge, nudgeAtPercent: 75, ...named };
    else {
      const kept = latest?.nudgeAtTokens;
      const keep = !o.ignoresSeed && same(latest?.nudgeAtTokensRange, nudge) && typeof kept === "number" && kept >= nudge[0] && kept <= nudge[1];
      const drawn = keep ? (kept as number) : nudge[0] + Math.floor((o.draw ?? 0.5) * (nudge[1] - nudge[0] + 1));
      next = { nudgeAtTokens: drawn, nudgeAtPercent: 75, nudgeAtTokensRange: nudge, ...named };
    }
    if (JSON.stringify(latest) !== JSON.stringify(next)) f.pi.appendEntry("infinite-context:settings", next);
  };
  if (o.loaded !== false && o.silent !== true) {
    f.pi.on("session_start", (_e: unknown, ctx: { model: Model }) => follow(ctx.model));
    f.pi.on("model_select", (e: { model: Model }) => follow(e.model));
  }
  const sessionDir = join(agentDir, "sessions");
  const ctxOf = (sid: string, model: Model, file?: string) => ({
    hasUI: true,
    ui: { notify() {} },
    model,
    sessionManager: { getSessionId: () => sid, getSessionDir: () => sessionDir, getSessionFile: () => file ?? join(sessionDir, `x_${sid}.jsonl`), getBranch: () => f.entries },
  });
  const start = (sid: string, model: Model, file?: string) => f.fire("session_start", { type: "session_start", reason: "startup" }, ctxOf(sid, model, file));
  const select = (sid: string, model: Model, previous: Model) => f.fire("model_select", { type: "model_select", model, previousModel: previous, source: "set" }, ctxOf(sid, model));
  const agentStart = (sid: string, model: Model) => f.fire("before_agent_start", { type: "before_agent_start", prompt: "hi" }, ctxOf(sid, model));
  const state = (sid: string) => query(f.events, sid)?.levers[LEVER];
  /** The level the engine assigned (a fraction of the range). */
  const level = (sid: string) => query(f.events, sid)!.factors!.nudge.assigned as number;
  return { ...f, agentDir, heard, start, select, agentStart, state, level, ctxOf };
}

test("T7a.3 adopted: the seed precedes the extension's record, is read back unverified, then confirmed at before_agent_start", () => {
  const r = runtime();
  r.start("s1", haiku);
  const q = r.level("s1");
  assert.ok(q === 0.25 || q === 0.75);
  const a = at([100_000, 200_000], q);
  assert.deepEqual(r.entries.map((e) => e.customType), [ENTRY, "infinite-context:settings", "infinite-context:settings"]);
  // The seed's shape is the extension's record without the percentage: the tokens, the rule's range, the rule's key.
  assert.deepEqual(records(r.entries)[0], { nudgeAtTokens: a, nudgeAtTokensRange: [100_000, 200_000], rule: "anthropic" });
  assert.deepEqual(records(r.entries)[1], { nudgeAtTokens: a, nudgeAtPercent: 75, nudgeAtTokensRange: [100_000, 200_000], rule: "anthropic" }, "the extension adopted it");
  assert.deepEqual(r.state("s1"), { v: a, s: "pe", a, rb: "unverified", tier: "seed" });
  const n = r.heard.length;
  r.agentStart("s1", haiku);
  assert.deepEqual(r.state("s1"), { v: a, s: "pe", a, rb: "confirmed", tier: "seed" });
  assert.equal(r.heard.length, n + 1, "the change is published once");
  r.agentStart("s1", haiku);
  assert.equal(r.heard.length, n + 1, "the same observation again: no publication");
});

test("T7a.3 property: ∀ engine draws, ∀ rules with a range: the seeded tokens lie in the rule's range, are the level's, and are adopted", () => {
  const seen = new Set<number>();
  for (const rng of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
    for (const [model, range] of [[haiku, [100_000, 200_000]], [gpt, [100_000, 200_000]], [local, [300_000, 400_000]]] as Array<[Model, [number, number]]>) {
      const r = runtime({ rng });
      r.start("s1", model);
      const q = r.level("s1");
      seen.add(q);
      const seed = records(r.entries)[0].nudgeAtTokens as number;
      assert.ok(seed >= range[0] && seed <= range[1], `${key(model)}: ${seed}`);
      assert.equal(seed, at(range, q));
      r.agentStart("s1", model);
      assert.equal(r.state("s1")?.rb, "confirmed", key(model));
    }
  }
  assert.deepEqual([...seen].sort(), [0.25, 0.75], "both levels were drawn");
});

test("T7a.3 a target that is not loaded is inert: no seed, no state (the extension's tool is the sign it is loaded)", () => {
  const r = runtime({ loaded: false });
  r.start("s1", haiku);
  assert.deepEqual(r.entries.map((e) => e.customType), [ENTRY]);
  assert.deepEqual(query(r.events, "s1")!.levers, {});
  assert.equal(r.state("s1"), undefined);
});

test("T7a.3 a resumed session whose branch already holds the seed's tokens and range appends none", () => {
  const first = runtime();
  first.start("s1", haiku);
  const a = records(first.entries)[0].nudgeAtTokens as number;
  const resumed = runtime({ agentDir: first.agentDir, entries: [...first.entries] });
  const before = resumed.entries.length;
  resumed.start("s1", haiku);
  assert.equal(resumed.entries.length, before, "assignment from the branch, the record already there");
  assert.deepEqual(resumed.state("s1"), { v: a, s: "pe", a, rb: "unverified", tier: "seed" });
  resumed.agentStart("s1", haiku);
  assert.equal(resumed.state("s1")?.rb, "confirmed");
});

test("T7a.4 model_select to a rule with another range: the same level is seeded in the new range before the extension's handler, which keeps it", () => {
  const r = runtime();
  r.start("s1", haiku);
  const q = r.level("s1");
  r.agentStart("s1", haiku);
  const n = r.entries.length;
  r.select("s1", local, haiku);
  const a = at([300_000, 400_000], q);
  assert.deepEqual(r.entries.slice(n).map((e) => e.data), [
    { nudgeAtTokens: a, nudgeAtTokensRange: [300_000, 400_000], rule: "example" },
    { nudgeAtTokens: a, nudgeAtPercent: 75, nudgeAtTokensRange: [300_000, 400_000], rule: "example" },
  ]);
  // Until the next read-back the state is the assignment's, unverified; then the extension's record confirms it.
  assert.deepEqual(r.state("s1"), { v: a, s: "pe", a, rb: "unverified", tier: "seed" });
  r.agentStart("s1", local);
  assert.deepEqual(r.state("s1"), { v: a, s: "pe", a, rb: "confirmed", tier: "seed" });
  // Back to the first range: seeded again, with the same level.
  r.select("s1", haiku, local);
  assert.equal(records(r.entries).at(-2)!.nudgeAtTokens, at([100_000, 200_000], q));
  r.agentStart("s1", haiku);
  assert.equal(r.state("s1")?.a, at([100_000, 200_000], q));
  assert.equal(r.state("s1")?.rb, "confirmed");
  assert.equal(r.level("s1"), q, "the assignment never changes (ITT)");
});

test("T7a.4 model_select to a rule with the same range: nothing to seed (the extension keeps its limit and names the new rule)", () => {
  const r = runtime();
  r.start("s1", haiku);
  r.agentStart("s1", haiku);
  const a = r.state("s1")!.a;
  const n = r.entries.length;
  r.select("s1", gpt, haiku);
  assert.deepEqual(r.entries.slice(n).map((e) => e.data), [{ nudgeAtTokens: a, nudgeAtPercent: 75, nudgeAtTokensRange: [100_000, 200_000], rule: "openai" }], "only the extension's record");
  r.agentStart("s1", gpt);
  assert.deepEqual(r.state("s1"), { v: a, s: "pe", a, rb: "confirmed", tier: "seed" });
});

const NOT_LOADED = "infinite-context.nudgeAtTokens: the target extension is not loaded";
const NO_LEVEL = "infinite-context.nudgeAtTokens: no level can be set for the session's model (the matched rule has no range)";
const row = (r: { agentDir: string }, sid: string) =>
  readFileSync(join(r.agentDir, "experiments", "assignments.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.sessionId === sid);

test("P12 a session whose matched rule has a fixed number is ineligible, not refused: a v2 row with a reason, no arm, nothing seeded or observed", () => {
  for (const [model, rule] of [[opus, "anthropic/claude-opus-5-5"], [localFixed, "example/fixed"]] as const) {
    const r = runtime({ ...(model === localFixed ? { defaultStrata: true } : {}) });
    r.start("s1", model);
    const x = row(r, "s1");
    assert.equal(x.eligible, false, rule);
    assert.equal(x.reason, NO_LEVEL, rule);
    assert.deepEqual([x.arm, x.factors], [undefined, undefined]);
    assert.equal(typeof x.stratum, "string");
    assert.equal(typeof x.design, "string");
    assert.deepEqual(r.entries.map((e) => e.customType), [ENTRY, "infinite-context:settings"], "the extension's record only; no seed");
    assert.deepEqual(records(r.entries)[0], { nudgeAtTokens: model === opus ? 400_000 : 250_000, nudgeAtPercent: 75, rule });
    r.agentStart("s1", model);
    assert.deepEqual(query(r.events, "s1")!.levers, {}, "no lever state, so no refusal");
    assert.equal(query(r.events, "s1")!.eligible, false);
    assert.equal(existsSync(join(r.agentDir, "experiments", "blocks.json")), false, "no draw consumed a block");
  }
});

test("P12 the default local stratum: its factor is the nudge at levels 0.25 / 0.75; a range rule is eligible, seeded and confirmed", () => {
  const r = runtime({ defaultStrata: true });
  r.start("s1", local);
  const x = row(r, "s1");
  assert.deepEqual([x.stratum, x.eligible, x.reason], ["local", true, undefined]);
  assert.equal(x.factors.nudge.lever, LEVER);
  assert.ok([0.25, 0.75].includes(x.factors.nudge.assigned));
  const a = at([300_000, 400_000], x.factors.nudge.assigned);
  assert.deepEqual(records(r.entries)[0], { nudgeAtTokens: a, nudgeAtTokensRange: [300_000, 400_000], rule: "example" }, "seeded");
  r.agentStart("s1", local);
  assert.deepEqual(r.state("s1"), { v: a, s: "pe", a, rb: "confirmed", tier: "seed" });
  // Both levels are drawn over sessions (permuted blocks of the two arms).
  const seen = new Set<unknown>();
  for (let i = 0; i < 4; i++) { r.start(`t${i}`, local); seen.add(row(r, `t${i}`).factors.nudge.assigned); }
  assert.deepEqual([...seen].sort(), [0.25, 0.75]);
});

test("P12 the extension is not loaded: ineligible with a reason, whatever the rule (explicit or default strata)", () => {
  for (const defaultStrata of [false, true]) {
    const r = runtime({ loaded: false, defaultStrata });
    r.start("s1", defaultStrata ? local : haiku);
    const x = row(r, "s1");
    assert.deepEqual([x.eligible, x.reason, x.arm], [false, NOT_LOADED, undefined], String(defaultStrata));
    assert.deepEqual(r.entries.map((e) => e.customType), [ENTRY]);
    assert.deepEqual(query(r.events, "s1")!.levers, {});
  }
});

// F1: the gate is all-or-nothing per session: a partial design would break the factorial, so one failing gating lever makes the
// session ineligible whatever its other factors (the design record's own example is a TTL factor with the nudge).
test("review F1 a design with a TTL factor and the nudge, on a fixed-rule model: the whole session is ineligible (no partial design)", () => {
  const TTL = { name: "ttl", lever: "cache-lifecycle.mainCacheTtl", levels: ["5m", "1h"] };
  const mixed = { any: { match: {}, factors: [TTL, NUDGE] } };
  const fixed = runtime({ strata: mixed });
  fixed.start("s1", opus);
  const x = row(fixed, "s1");
  assert.deepEqual([x.eligible, x.arm, x.factors, x.reason], [false, undefined, undefined, NO_LEVEL]);
  const ranged = runtime({ strata: mixed });
  ranged.start("s1", haiku);
  assert.deepEqual([row(ranged, "s1").eligible, Object.keys(row(ranged, "s1").factors)], [true, ["ttl", "nudge"]], "negative case: a range rule draws both factors");
});

// F3: every level must be settable (not some), and a mode-off row says nothing about a gate.
test("review F3 a design whose levels are only partly settable (0.5 and 2 on a range rule) is ineligible", () => {
  const partly = { any: { match: {}, factors: [{ name: "nudge", lever: LEVER, levels: [0.5, 2] }] } };
  const r = runtime({ strata: partly });
  r.start("s1", haiku);
  assert.deepEqual([row(r, "s1").eligible, row(r, "s1").reason], [false, NO_LEVEL]);
});

test("review F3 mode off: the row carries no reason, whether or not the gate would fail (extension not loaded, fixed rule)", () => {
  for (const [loaded, model] of [[false, haiku], [true, opus]] as const) {
    const r = runtime({ mode: "off", loaded });
    r.start("s1", model);
    const x = row(r, "s1");
    assert.deepEqual([x.eligible, x.mode, "reason" in x], [false, "off", false], String(loaded));
  }
});

test("P12 the model switch of a session never makes it ineligible (ITT): a drawn session keeps its arm", () => {
  const r = runtime({ defaultStrata: true });
  r.start("s1", local);
  const q = row(r, "s1").factors.nudge.assigned;
  r.select("s1", localFixed, local);
  r.agentStart("s1", localFixed);
  assert.equal(query(r.events, "s1")!.eligible, true);
  assert.equal(r.state("s1")?.rb, "refused", "refused, as before: a switch is the session's own");
  assert.equal(r.state("s1")?.a, q);
});

test("T7a.5 a switch to a fixed-number rule is refused, and back to a range it is seeded again", () => {
  const r = runtime();
  r.start("s1", haiku);
  const q = r.level("s1");
  r.agentStart("s1", haiku);
  const n = r.entries.length;
  r.select("s1", opus, haiku);
  assert.deepEqual(r.entries.slice(n).map((e) => e.data), [{ nudgeAtTokens: 400_000, nudgeAtPercent: 75, rule: "anthropic/claude-opus-5-5" }]);
  assert.equal(r.state("s1"), undefined, "the earlier read-back no longer holds; nothing observed yet");
  r.agentStart("s1", opus);
  assert.deepEqual(r.state("s1"), { v: 400_000, s: "fixed", a: q, rb: "refused", tier: "seed" });
  r.select("s1", haiku, opus);
  r.agentStart("s1", haiku);
  assert.equal(r.state("s1")?.rb, "confirmed");
  assert.equal(r.state("s1")?.a, at([100_000, 200_000], q));
});

test("T7a.R planted refusal: an extension that ignores the seed is detected — refused, with the value it drew and source ext", () => {
  const r = runtime({ ignoresSeed: true, draw: 0 });
  r.start("s1", haiku);
  const q = r.level("s1");
  const a = at([100_000, 200_000], q);
  assert.notEqual(a, 100_000, "the draw (the range's minimum) differs from both seeds");
  r.agentStart("s1", haiku);
  assert.deepEqual(r.state("s1"), { v: 100_000, s: "ext", a, rb: "refused", tier: "seed" });
  const last = r.heard.at(-1)!;
  assert.deepEqual(last.levers[LEVER], r.state("s1"), "published for the meter's levers line");
});

test("T7a.R planted refusal: the extension's rule has another range than the file the engine read — it redraws, refused", () => {
  const table = { ...RULES, "anthropic/claude-haiku-5-5": { rule: "anthropic", nudge: [150_000, 300_000] as const } };
  const r = runtime({ table, draw: 0 });
  r.start("s1", haiku);
  const q = r.level("s1");
  r.agentStart("s1", haiku);
  assert.deepEqual(r.state("s1"), { v: 150_000, s: "ext", a: at([100_000, 200_000], q), rb: "refused", tier: "seed" });
});

test("T7a.3 a child runs its root's level in its own model's range, in its own branch", () => {
  const main = runtime();
  main.start("root", haiku);
  const q = main.level("root");
  const file = join(main.agentDir, "sessions", "subagents", "root", "x_child.jsonl");
  mkdirSync(join(main.agentDir, "sessions", "subagents", "root"), { recursive: true });
  const child = runtime({ agentDir: main.agentDir });
  child.start("child", local, file);
  assert.equal(child.level("child"), q);
  const a = at([300_000, 400_000], q);
  assert.deepEqual(records(child.entries)[0], { nudgeAtTokens: a, nudgeAtTokensRange: [300_000, 400_000], rule: "example" });
  assert.equal(child.entries.some((e) => e.customType === ENTRY), false, "a child writes no assignment entry");
  child.agentStart("child", local);
  assert.deepEqual(child.state("child"), { v: a, s: "pe", a, rb: "confirmed", tier: "seed" });
});

// Review m1 (PROBE-A): a target that is listed as loaded but never runs (a tool of that name from another extension, a
// misordered load, a host where its handlers do not run) leaves the engine's own seed as the branch's latest record; reading
// that back is no evidence, so the state stays unverified.
test("review m1 a loaded but silent target: the seed is the latest record and stays unverified, never confirmed", () => {
  const r = runtime({ silent: true });
  r.start("s1", haiku);
  const a = at([100_000, 200_000], r.level("s1"));
  assert.deepEqual(records(r.entries), [{ nudgeAtTokens: a, nudgeAtTokensRange: [100_000, 200_000], rule: "anthropic" }]);
  r.agentStart("s1", haiku);
  assert.deepEqual(r.state("s1"), { v: a, s: "pe", a, rb: "unverified", tier: "seed" });
  r.select("s1", local, haiku);
  r.agentStart("s1", local);
  assert.equal(r.state("s1")?.rb, "unverified", "after a switch too");
});

// Review m3: the tool name is the only sign that the extension is loaded; other tools, even its siblings', are none.
test("review m3 other tools listed, no context_fold: the target is not loaded — inert, nothing seeded", () => {
  const r = runtime({ loaded: false, others: ["read", "bash", "context_peek", "context_map", "context_search", "context_unfold"] });
  r.start("s1", haiku);
  assert.deepEqual(r.entries.map((e) => e.customType), [ENTRY]);
  r.agentStart("s1", haiku);
  assert.deepEqual(query(r.events, "s1")!.levers, {});
  // The same tools plus context_fold: loaded.
  const loaded = runtime({ others: ["read", "bash", "context_peek"] });
  loaded.start("s1", haiku);
  assert.equal(records(loaded.entries).length, 2);
});

test("review m3 a host whose pi has no getAllTools, or whose getAllTools throws or answers no list: not loaded", () => {
  for (const getAllTools of [undefined, () => { throw new Error("not bound"); }, () => undefined, () => "context_fold", () => [null, 3, { name: 5 }]]) {
    const r = runtime({ loaded: false });
    Object.assign(r.pi, { getAllTools });
    r.start("s1", haiku);
    assert.deepEqual(r.entries.map((e) => e.customType), [ENTRY], String(getAllTools));
  }
});

// Review m4: the extension reads its settings file once, when its factory runs; the engine reads the rules once per runtime too.
// A file a home-manager switch rewrites mid-session is the next session's, and must not turn the next model switch into a
// refusal (the extension still runs the rules it read, the engine would seed a range it does not have).
test("review m4 the rules are read once per runtime: a file rewritten mid-session changes no seed", () => {
  const r = runtime();
  r.start("s1", haiku);
  const q = r.level("s1");
  r.agentStart("s1", haiku);
  writeFileSync(join(r.agentDir, "infinite-context", "settings.json"), JSON.stringify({ overrides: { example: { nudgeAtTokens: [500_000, 600_000] }, anthropic: { nudgeAtTokens: 90_000 } } }));
  r.select("s1", local, haiku);
  const a = at([300_000, 400_000], q);
  assert.deepEqual(records(r.entries).at(-2), { nudgeAtTokens: a, nudgeAtTokensRange: [300_000, 400_000], rule: "example" }, "the rule the extension runs, not the new file's");
  r.agentStart("s1", local);
  assert.deepEqual(r.state("s1"), { v: a, s: "pe", a, rb: "confirmed", tier: "seed" });
  // Back to the first model: the rewritten file's fixed 90000 for anthropic is not seen either.
  r.select("s1", haiku, local);
  r.agentStart("s1", haiku);
  assert.equal(r.state("s1")?.rb, "confirmed");
  assert.equal(r.state("s1")?.a, at([100_000, 200_000], q));
});

// Review n6: a model switch that changes a state is published at once (the meter writes a levers line on change), not at
// the next read-back.
test("review n6 a model switch publishes the changed state at the switch", () => {
  const r = runtime();
  r.start("s1", haiku);
  r.agentStart("s1", haiku);
  const q = r.level("s1");
  const n = r.heard.length;
  r.select("s1", local, haiku);
  assert.equal(r.heard.length, n + 1, "one publication at the switch");
  const a = at([300_000, 400_000], q);
  assert.deepEqual(r.heard.at(-1)!.levers[LEVER], { v: a, s: "pe", a, rb: "unverified", tier: "seed" });
  r.select("s1", gpt, local);
  assert.equal(r.heard.length, n + 2, "back to a rule with a range: the value changes again");
  const same = runtime();
  same.start("s1", haiku);
  same.agentStart("s1", haiku);
  const m = same.heard.length;
  same.select("s1", haiku, haiku); // pi's model_select with source "restore": the model did not change
  assert.equal(same.heard.length, m, "no change of model: nothing re-evaluated, nothing published");
  assert.equal(same.state("s1")?.rb, "confirmed", "the read-back stands");
});
