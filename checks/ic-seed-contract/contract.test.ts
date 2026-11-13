// The seed contract of infinite-context's fold-reminder limit (redesign §7.4, M7a), on the real code of all three sides:
// the patched extension (index.ts, settings.ts as built from the pi-infinite-context input and our patch), the experiments
// engine with its infinite-context add-on, and token-meter's shell writing the levers line. Only pi's own packages are
// stand-ins (./stubs). One fake pi hosts them in load order, experiments first. Cases: adopted, refused up front (a
// fixed-number rule), refused when the extension does not adopt the seed (a rule whose range differs from the range the
// engine read: planted refusal), re-seeded at a model switch, and the matcher's equivalence with the extension's own rule
// resolution over a generated table.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import infiniteContext from "./ic/extensions/infinite-context/index.ts";
import { DEFAULT_SETTINGS, SETTINGS_ENTRY, parseSettings, selectRule } from "./ic/extensions/infinite-context/settings.ts";
import { defaults } from "./experiments/core/settings.ts";
import { ENTRY, install as installExperiments } from "./experiments/core/shell.ts";
import { IC_DEFAULT_NUDGE, IC_ENTRY, IC_TOOL, matchRule, parseIcRules, tokensAt } from "./experiments/addons/infinite-context.ts";
import { install as installMeter } from "./token-meter/core/shell.ts";

type Model = { provider: string; id: string };
type Entry = Record<string, unknown> & { id: string; type: string };
const LEVER = "infinite-context.nudgeAtTokens";
const haiku: Model = { provider: "anthropic", id: "claude-haiku-5-5" };
const opus: Model = { provider: "anthropic", id: "claude-opus-5-5" };
const local: Model = { provider: "example", id: "model-a" };
const FILE = {
  overrides: {
    anthropic: { nudgeAtTokens: [100_000, 200_001] },
    example: { nudgeAtTokens: [300_000, 400_003] },
    "anthropic/claude-opus-5-5": { nudgeAtTokens: 400_000 },
  },
};
/** The seed's value for level q in [min, max], written out here rather than taken from the add-on. */
const at = (r: readonly [number, number], q: number) => Math.round(r[0] + q * (r[1] - r[0]));

function writeIc(dir: string, file: unknown) {
  mkdirSync(path.join(dir, "infinite-context"), { recursive: true });
  writeFileSync(path.join(dir, "infinite-context", "settings.json"), JSON.stringify(file));
}

/**
 * One session. The extension reads its file in `icDir` (as pi's getAgentDir says when it is created); the engine and the
 * meter work in `peDir` (their agentDir) and read the rules from there. Equal directories are the normal case.
 */
function session(o: { icDir: string; peDir: string; draw?: number; rng?: number }) {
  process.env.PI_CODING_AGENT_DIR = o.icDir;
  const handlers = new Map<string, Array<(e: unknown, ctx: unknown) => unknown>>();
  const entries: Entry[] = [{ type: "message", id: "u1", parentId: null, message: { role: "user", content: "one", timestamp: 1 } }];
  const tools: string[] = [];
  const emitter = new EventEmitter();
  const events = {
    emit: (c: string, d: unknown) => void emitter.emit(c, d),
    on: (c: string, h: (d: unknown) => unknown) => {
      const w = async (d: unknown) => { try { await h(d); } catch { /* pi logs a handler's error */ } };
      emitter.on(c, w);
      return () => void emitter.off(c, w);
    },
  };
  const pi = {
    on: (n: string, h: (e: unknown, ctx: unknown) => unknown) => void handlers.set(n, [...(handlers.get(n) ?? []), h]),
    registerTool: (t: { name: string }) => void tools.push(t.name),
    registerCommand() {},
    appendEntry: (customType: string, data: unknown) => void entries.push({ type: "custom", id: `e${entries.length}`, customType, data }),
    sendMessage() {},
    getAllTools: () => tools.map((name) => ({ name })),
    events,
  };
  const state = { model: haiku as Model };
  const ctx = {
    hasUI: true,
    cwd: "/nonexistent",
    isProjectTrusted: () => false,
    get model() { return state.model; },
    sessionManager: {
      getSessionId: () => "s1",
      getSessionFile: () => "/sessions/s1.jsonl",
      getSessionDir: () => "/sessions",
      getBranch: () => entries.map((e, i) => ({ ...e, parentId: i === 0 ? null : entries[i - 1].id })),
      buildSessionProjection: () => ({ entries: entries.filter((e) => e.type === "message").map((e) => ({ sourceEntry: e, messages: [e.message] })) }),
    },
    ui: { notify() {}, setStatus() {} },
    abort() {},
    getContextUsage: () => ({ contextWindow: 1_000_000, tokens: 0 }),
  };
  // Load order: experiments, token-meter, then the extension (config order, modules/common.nix firstNames).
  installExperiments(pi as never, { agentDir: o.peDir, settings: { ...defaults(), strata: { any: { match: {}, factors: [{ name: "nudge", lever: LEVER, levels: [0.25, 0.75] }] } } }, rng: () => o.rng ?? 0.5, api: () => undefined });
  installMeter(pi as never, { agentDir: o.peDir });
  const realRandom = Math.random;
  Math.random = () => o.draw ?? 0; // the extension's own draw (resolveSettings gets Math.random per call)
  try { infiniteContext(pi as never); } finally { Math.random = realRandom; }
  const fire = async (name: string, event: unknown) => {
    const saved = Math.random;
    Math.random = () => o.draw ?? 0;
    try { for (const h of handlers.get(name) ?? []) await h(event, ctx); } finally { Math.random = saved; }
  };
  const start = (model: Model) => { state.model = model; return fire("session_start", { type: "session_start", reason: "startup" }); };
  const select = async (model: Model) => { const previousModel = state.model; state.model = model; await fire("model_select", { type: "model_select", model, previousModel, source: "set" }); };
  const prompt = () => fire("before_agent_start", { type: "before_agent_start", prompt: "hi" });
  const records = () => entries.filter((e) => e.customType === SETTINGS_ENTRY).map((e) => e.data as Record<string, unknown>);
  /** The meter's levers lines (kind "levers") of this agent dir, in file order. */
  const lines = () => {
    const dir = path.join(o.peDir, "meter");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((f) => readFileSync(path.join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l))).filter((l) => l.kind === "levers");
  };
  const lineState = () => lines().at(-1)?.levers?.[LEVER];
  /** The level the engine assigned. */
  const level = (): number => {
    const e = entries.find((x) => x.customType === ENTRY);
    return (e?.data as { factors: { nudge: { assigned: number } } }).factors.nudge.assigned;
  };
  return { entries, tools, state, start, select, prompt, records, lines, lineState, level };
}

const dirOf = () => mkdtempSync(path.join(tmpdir(), "ic-seed-contract-"));

test("adopted: the seed has the extension's record shape, the real extension keeps it, and the meter's levers line says confirmed", async () => {
  const levels = new Set<number>();
  for (const rng of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
    const dir = dirOf();
    writeIc(dir, FILE);
    const s = session({ icDir: dir, peDir: dir, rng });
    assert.ok(s.tools.includes(IC_TOOL), "the tool the engine takes as the sign that the extension is loaded");
    await s.start(haiku);
    levels.add(s.level());
    // The range's width is odd: a level's tokens are not always whole until rounded.
    const a = at([100_000, 200_001], s.level());
    const [seed, own] = s.records();
    assert.deepEqual(seed, { nudgeAtTokens: a, nudgeAtTokensRange: [100_000, 200_001], rule: "anthropic" }, "the seed: tokens, the rule's range, the rule's key");
    assert.deepEqual(own, { ...seed, nudgeAtPercent: 75 }, "the extension kept the draw and completed the record");
    assert.equal(s.records().length, 2);
    assert.deepEqual(s.entries.map((e) => e.customType ?? e.type), ["message", ENTRY, SETTINGS_ENTRY, SETTINGS_ENTRY]);
    assert.equal(s.lineState(), undefined, "no levers line before the first prompt");
    await s.prompt();
    assert.deepEqual(s.lineState(), { v: a, s: "pe", a, rb: "confirmed", tier: "seed" });
  }
  assert.deepEqual([...levels].sort(), [0.25, 0.75], "both levels were drawn");
});

test("refused up front: a fixed-number rule draws nothing and ignores records; no seed, the configured number read back as fixed", async () => {
  const dir = dirOf();
  writeIc(dir, FILE);
  const s = session({ icDir: dir, peDir: dir });
  await s.start(opus);
  assert.deepEqual(s.records(), [{ nudgeAtTokens: 400_000, nudgeAtPercent: 75, rule: "anthropic/claude-opus-5-5" }], "only the extension's record");
  await s.prompt();
  assert.deepEqual(s.lineState(), { v: 400_000, s: "fixed", a: s.level(), rb: "refused", tier: "seed" });
});

test("planted refusal: the extension does not adopt a seed whose range is not its rule's — it draws its own, and the meter's line says refused", async () => {
  const icDir = dirOf();
  const peDir = dirOf();
  writeIc(icDir, { overrides: { anthropic: { nudgeAtTokens: [150_000, 300_000] } } });
  writeIc(peDir, FILE); // the engine read [100000, 200000] for the same rule
  const s = session({ icDir, peDir, draw: 0 });
  await s.start(haiku);
  const a = at([100_000, 200_001], s.level());
  assert.deepEqual(s.records()[0], { nudgeAtTokens: a, nudgeAtTokensRange: [100_000, 200_001], rule: "anthropic" });
  assert.deepEqual(s.records().at(-1), { nudgeAtTokens: 150_000, nudgeAtPercent: 75, nudgeAtTokensRange: [150_000, 300_000], rule: "anthropic" }, "redrawn: the minimum of its range (Math.random = 0)");
  await s.prompt();
  assert.deepEqual(s.lineState(), { v: 150_000, s: "ext", a, rb: "refused", tier: "seed" });
});

test("re-seeded: a switch to a rule with another range is seeded in that range before the extension's handler, which keeps it; a fixed rule is refused", async () => {
  const dir = dirOf();
  writeIc(dir, FILE);
  const s = session({ icDir: dir, peDir: dir });
  await s.start(haiku);
  const q = s.level();
  await s.prompt();
  const n = s.records().length;
  await s.select(local);
  const a = at([300_000, 400_003], q);
  assert.deepEqual(s.records().slice(n), [
    { nudgeAtTokens: a, nudgeAtTokensRange: [300_000, 400_003], rule: "example" },
    { nudgeAtTokens: a, nudgeAtPercent: 75, nudgeAtTokensRange: [300_000, 400_003], rule: "example" },
  ]);
  await s.prompt();
  assert.deepEqual(s.lineState(), { v: a, s: "pe", a, rb: "confirmed", tier: "seed" });
  await s.select(opus);
  assert.deepEqual(s.records().at(-1), { nudgeAtTokens: 400_000, nudgeAtPercent: 75, rule: "anthropic/claude-opus-5-5" });
  await s.prompt();
  assert.deepEqual(s.lineState(), { v: 400_000, s: "fixed", a: q, rb: "refused", tier: "seed" });
  await s.select(haiku);
  const b = at([100_000, 200_001], q);
  assert.equal(s.records().at(-2)!.nudgeAtTokens, b);
  await s.prompt();
  assert.deepEqual(s.lineState(), { v: b, s: "pe", a: b, rb: "confirmed", tier: "seed" });
});

test("equivalence: matchRule is the extension's rule resolution for nudgeAtTokens, over a generated table of files and models", () => {
  assert.equal(IC_DEFAULT_NUDGE, DEFAULT_SETTINGS.nudgeAtTokens, "upstream's default");
  assert.equal(IC_ENTRY, SETTINGS_ENTRY);
  let seed = 7;
  const rnd = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const values: unknown[] = [undefined, 5, 100_000, [100, 200], [300, 400], [5, 5], [6, 5], 0, -3, 1.5, "x", null, true, [], [1], [1, 2, 3], [0, 9], ["1", 2], {}, { nudgeAtTokens: 9 }];
  const keys = ["anthropic", "openai", "example", "anthropic/claude-opus-5-5", "anthropic/claude-haiku-5-5", "openai/gpt-5", "constructor", "__proto__"];
  const providers = ["anthropic", "openai", "example", "other", "", undefined];
  const ids = ["claude-opus-5-5", "claude-haiku-5-5", "gpt-5", "model-a", "", undefined];
  let ranged = 0;
  for (let i = 0; i < 400; i++) {
    const pick = () => values[rnd(values.length)];
    const overrides: Record<string, unknown> = {};
    for (const k of keys) if (rnd(3) === 0) Object.defineProperty(overrides, k, { value: rnd(5) === 0 ? pick() : { nudgeAtTokens: pick(), ...(rnd(2) ? { nudgeAtPercent: 50 } : {}) }, enumerable: true, configurable: true, writable: true });
    const text = JSON.stringify(rnd(8) === 0 ? pick() : { ...(rnd(2) ? { nudgeAtTokens: pick() } : {}), ...(rnd(6) ? { overrides } : { overrides: pick() }) });
    const rules = parseIcRules(text);
    const file = parseSettings(text);
    for (const provider of providers) {
      for (const id of ids) {
        const theirs = selectRule(file, { provider, id });
        const ours = matchRule(rules.overrides, rules.top, provider, id);
        assert.deepEqual(ours.nudge, theirs.nudgeAtTokens, `${text} ${provider}/${id}`);
        assert.equal(ours.rule, theirs.rule, `${text} ${provider}/${id}: the rule`);
        if (typeof theirs.nudgeAtTokens !== "number") {
          ranged++;
          const [min, max] = theirs.nudgeAtTokens;
          for (const q of [0, 0.25, 0.75, 1]) assert.ok(tokensAt(ours.nudge as [number, number], q) >= min && tokensAt(ours.nudge as [number, number], q) <= max);
        }
      }
    }
  }
  assert.ok(ranged > 100, "the table reaches ranges");
});
