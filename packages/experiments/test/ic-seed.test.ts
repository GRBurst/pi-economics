// The engine seeds infinite-context's fold-reminder limit (redesign §7.4, M7a): before the extension's own session_start
// (and again at model_select) it appends the extension's settings record with the level's tokens in the matched rule's
// range; the extension adopts it, and the record after its handlers is the read-back. A stand-in for the extension
// keeps the contract's rule (a record that holds the rule's range and a value in it is kept, anything else drawn anew);
// the real code runs in the check ic-seed-contract.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  },
};
const RULES: Record<string, Rule> = {
  "anthropic/claude-haiku-5-5": { rule: "anthropic", nudge: [100_000, 200_000] },
  "anthropic/claude-opus-5-5": { rule: "anthropic/claude-opus-5-5", nudge: 400_000 },
  "openai/gpt-5": { rule: "openai", nudge: [100_000, 200_000] },
  "example/model-a": { rule: "example", nudge: [300_000, 400_000] },
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
function runtime(o: { agentDir?: string; loaded?: boolean; table?: Record<string, Rule>; ignoresSeed?: boolean; entries?: Entry[]; draw?: number; rng?: number } = {}) {
  const agentDir = o.agentDir ?? mkdtempSync(join(tmpdir(), "experiments-ic-"));
  mkdirSync(join(agentDir, "infinite-context"), { recursive: true });
  writeFileSync(join(agentDir, "infinite-context", "settings.json"), JSON.stringify(FILE));
  const f = fakePi();
  f.entries.push(...(o.entries ?? []));
  const heard: Levers[] = [];
  onAssigned(f.events, (l) => void heard.push(l));
  install(f.pi, { agentDir, settings: { ...defaults(), strata: { any: { match: {}, factors: [NUDGE] } } }, rng: () => o.rng ?? 0.5, api: () => undefined });
  const table = o.table ?? RULES;
  if (o.loaded !== false) f.tools.push("context_fold");
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
  if (o.loaded !== false) {
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

test("T7a.5 a fixed-number rule is refused up front: nothing seeded, the configured number read back with source fixed", () => {
  const r = runtime();
  r.start("s1", opus);
  const q = r.level("s1");
  assert.deepEqual(r.entries.map((e) => e.customType), [ENTRY, "infinite-context:settings"], "the extension's record only");
  assert.deepEqual(records(r.entries)[0], { nudgeAtTokens: 400_000, nudgeAtPercent: 75, rule: "anthropic/claude-opus-5-5" });
  assert.equal(r.state("s1"), undefined, "not recorded before anything is observed");
  r.agentStart("s1", opus);
  // a is the level: a rule without a range has no tokens to assign.
  assert.deepEqual(r.state("s1"), { v: 400_000, s: "fixed", a: q, rb: "refused", tier: "seed" });
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
