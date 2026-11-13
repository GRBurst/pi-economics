// The data-only seed kind `session-entry(<customType>,<field>)` (redesign §7.4 seed tier, §12; M7c): any extension that
// adopts a value recorded on the session branch the way infinite-context does gets the level appended as a custom entry
// before it reads, and the engine reads back the latest entry's field at before_agent_start. The target is not named
// (data-only: no consumer code), so the lever belongs to "pi", always live.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionEntry, sessionEntryKind } from "../addons/session-entry.ts";
import { createRegistry, sessionLevers } from "../addons/registry.ts";
import type { Lever } from "../addons/types.ts";
import { onAssigned, type Levers } from "../core/channel.ts";
import type { Level } from "../core/design.ts";
import { defaults } from "../core/settings.ts";
import { install } from "../core/shell.ts";
import { fakePi, type Entry } from "./fake.ts";
import { violations } from "./states.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: unknown }).__piEconomicsWarned_v1);

const ID = "session-entry(entry-ext:settings,nudge)";
const custom = (customType: string, data?: unknown): Entry => ({ type: "custom", customType, data });

/** A session branch the add-on appends to and reads back from. */
function rig() {
  const branch: Entry[] = [];
  const appended: Array<[string, unknown]> = [];
  const pi = { appendEntry: (t: string, d?: unknown) => void (appended.push([t, d]), branch.push(custom(t, d))) };
  const registry = createRegistry([], [sessionEntryKind(pi)]);
  const at = { sessionId: "s1", branch: () => branch };
  const session = (assigned: Level, levels: readonly Level[] = [100, 200], id = ID, env = { child: false }) =>
    sessionLevers(registry, { sessionId: "s1", factors: { f: { lever: id, assigned } } }, env, () => levels);
  return { branch, appended, registry, at, session };
}

test("T7c.1 session-entry(<customType>,<field>): parsed; anything else is no such lever", () => {
  assert.deepEqual(parseSessionEntry(ID), { customType: "entry-ext:settings", field: "nudge" });
  assert.deepEqual(parseSessionEntry("session-entry(infinite-context:settings,nudgeAtTokens)"), { customType: "infinite-context:settings", field: "nudgeAtTokens" });
  assert.deepEqual(parseSessionEntry("session-entry(a,b)"), { customType: "a", field: "b" });
  for (const bad of ["", "session-entry", "session-entry()", "session-entry(a)", "session-entry(a,)", "session-entry(,b)", "session-entry(a,b,c)", "session-entry(a, b)", "session-entry( a,b)",
    "session-entry(a,b) ", " session-entry(a,b)", "session-entry(a,b)x", "session-entry((a),b)", "session-entry(a,(b))", "session-entry(a b,c)", "Session-entry(a,b)", "session-entries(a,b)", "pi.session-entry(a,b)", "session-entry(a,b))"]) {
    assert.equal(parseSessionEntry(bad), undefined, JSON.stringify(bad));
  }
});

test("T7c.1 the kind resolves the id to a seed-tier lever of pi, one lever per id; a malformed id and other kinds are none", () => {
  const { registry } = rig();
  const l = registry.lever(ID)!;
  assert.deepEqual([l.id, l.target, l.scope, l.tier, l.readBackAt], [ID, "pi", "session", "seed", "before_agent_start"]);
  assert.equal(registry.lever(ID), l);
  assert.equal(registry.lever("session-entry(a)"), undefined);
  assert.equal(registry.lever("pi.thinkingLevel"), undefined);
  assert.equal(registry.loaded("pi"), true);
});

test("T7c.2 apply appends the custom entry { [field]: level } and nothing else, once; every level type", () => {
  for (const level of ["high", 150000, 0.25, true, false]) {
    const r = rig();
    const s = r.session(level, [level, "other"]);
    assert.equal(s.refresh(), true);
    assert.deepEqual(r.appended, [["entry-ext:settings", { nudge: level }]]);
    assert.equal(s.refresh(), false);
    assert.equal(r.appended.length, 1, "applied once");
  }
});

test("T7c.2 observe reads the latest entry of the customType and its field at before_agent_start: adopted → confirmed", () => {
  const r = rig();
  const s = r.session(100);
  s.refresh();
  assert.deepEqual(s.states()[ID], { v: 100, s: "pe", a: 100, rb: "unverified", tier: "seed" });
  assert.equal(s.observe("message_end", r.at), false, "not read back at message_end");
  assert.equal(s.observe("before_agent_start", r.at), true);
  assert.deepEqual(s.states()[ID], { v: 100, s: "pe", a: 100, rb: "confirmed", tier: "seed" });
});

test("T7c.2 the target redraws and records its own value (an out-of-range seed, the infinite-context way) → refused, source ext", () => {
  const r = rig();
  const s = r.session(100);
  s.refresh();
  r.branch.push(custom("entry-ext:settings", { nudge: 175 })); // the target's own draw, after the seed
  assert.equal(s.observe("before_agent_start", r.at), true);
  assert.deepEqual(s.states()[ID], { v: 175, s: "ext", a: 100, rb: "refused", tier: "seed" });
});

test("T7c.2 only the customType's entries count, the latest wins, an entry without the field or with a non-level value shows nothing", () => {
  const r = rig();
  const s = r.session(100);
  s.refresh();
  r.branch.push(custom("other:settings", { nudge: 999 }), { type: "message" } as unknown as Entry, custom("entry-ext:settings", { other: 1 }), custom("entry-ext:settings"), custom("entry-ext:settings", { nudge: { x: 1 } }), custom("entry-ext:settings", { nudge: Number.NaN }), custom("entry-ext:settings", { nudge: null }));
  s.observe("before_agent_start", r.at);
  assert.equal(s.states()[ID].rb, "unverified", "nothing seen: no claim");
  r.branch.push(custom("entry-ext:settings", { nudge: 200 }));
  s.observe("before_agent_start", r.at);
  assert.deepEqual(s.states()[ID], { v: 200, s: "ext", a: 100, rb: "refused", tier: "seed" });
  r.branch.push(custom("entry-ext:settings", { nudge: 100 }));
  s.observe("before_agent_start", r.at);
  assert.equal(s.states()[ID].rb, "confirmed", "the latest entry wins");
});

test("T7c.2 a read-back without a branch (a host that does not give one) or with a throwing getter shows nothing", () => {
  const r = rig();
  const s = r.session(100);
  s.refresh();
  assert.equal(s.observe("before_agent_start", { sessionId: "s1" }), false);
  assert.equal(s.observe("before_agent_start", { sessionId: "s1", branch: () => { throw new Error("stale"); } }), false);
  assert.equal(s.states()[ID].rb, "unverified");
});

test("T7c.2 seed levers are inherited by a child (its target reads the child's own branch): feasible = every level", () => {
  const r = rig();
  assert.deepEqual(r.registry.lever(ID)!.feasible({ child: true }, [100, 200]), [100, 200]);
  assert.deepEqual(r.registry.lever(ID)!.feasible({ child: false }, ["a", 1, true]), ["a", 1, true]);
});

test("T7c property: ∀ assigned level, ∀ later entry the state keeps every §5.3 invariant", () => {
  const levels: Level[] = ["a", "b", 1, 2, true, false];
  let seen = 0;
  for (const a of levels) {
    for (const later of [undefined, ...levels]) {
      const r = rig();
      const s = r.session(a, levels);
      s.refresh();
      if (later !== undefined) r.branch.push(custom("entry-ext:settings", { nudge: later }));
      s.observe("before_agent_start", r.at);
      seen++;
      assert.deepEqual(violations(s.states()[ID]), [], JSON.stringify([a, later, s.states()[ID]]));
    }
  }
  assert.ok(seen > 40);
});

// The engine: the branch reaches the add-on through the shell's ctx, at session_start (the seed) and before_agent_start.
function engine(factors: unknown[]) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-seed-"));
  const f = fakePi();
  const heard: Levers[] = [];
  onAssigned(f.events, (l) => void heard.push(l));
  const settings = { ...defaults(), strata: { all: { match: {}, objective: "apiUsd", factors } } };
  install(f.pi, { agentDir, settings, rng: () => 0.5, api: () => undefined });
  const ctx = (sid: string, file = join(agentDir, "sessions", `x_${sid}.jsonl`)) => ({
    model: { provider: "openai", id: "gpt-5" },
    sessionManager: { getSessionId: () => sid, getSessionDir: () => join(agentDir, "sessions"), getSessionFile: () => file, getBranch: () => f.entries },
  });
  const start = (sid: string, file?: string) => f.fire("session_start", { type: "session_start", reason: "startup" }, ctx(sid, file));
  const prompt = (sid: string) => f.fire("before_agent_start", { type: "before_agent_start", prompt: "x" }, ctx(sid));
  return { ...f, heard, start, prompt, agentDir };
}
const seeds = (e: ReturnType<typeof engine>) => e.entries.filter((x) => x.customType === "entry-ext:settings");

test("T7c.2 the engine seeds the level at session_start, before a target's own session_start, and reads it back at the first prompt", () => {
  const e = engine([{ name: "nudge", lever: ID, levels: [100, 200] }]);
  e.start("s1");
  const a = e.heard[0];
  const assigned = a.factors!.nudge.assigned;
  assert.deepEqual(seeds(e).map((x) => x.data), [{ nudge: assigned }]);
  assert.ok(e.entries.findIndex((x) => x.customType === "pi-economics:assignment") < e.entries.findIndex((x) => x.customType === "entry-ext:settings"));
  assert.deepEqual(a.levers[ID], { v: assigned, s: "pe", a: assigned, rb: "unverified", tier: "seed" });
  const n = e.heard.length;
  e.prompt("s1");
  assert.equal(e.heard.length, n + 1);
  assert.equal(e.heard.at(-1)!.levers[ID].rb, "confirmed");
  e.entries.push(custom("entry-ext:settings", { nudge: assigned === 100 ? 200 : 100 })); // the target redraws later
  e.prompt("s1");
  const b = e.heard.at(-1)!.levers[ID];
  assert.deepEqual([b.rb, b.s, b.a], ["refused", "ext", assigned]);
});

test("T7c.2 the engine: a child runs its root's arm, so its own branch is seeded with the root's level", () => {
  const e = engine([{ name: "nudge", lever: ID, levels: [100, 200] }]);
  e.start("s1");
  const root = seeds(e)[0].data;
  e.start("kid", join(e.agentDir, "sessions", "subagents", "s1", "kid.jsonl"));
  assert.deepEqual(seeds(e).map((x) => x.data), [root, root]);
});
