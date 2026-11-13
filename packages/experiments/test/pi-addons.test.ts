// The data-only lever kinds that set pi itself (redesign §7.4 control tier, §8.1, M7b): `pi.thinkingLevel` and
// `pi.activeTool(<name>)`. The engine sets them through pi's session control at its session_start and reads back with
// the matching getter at before_agent_start: the EFFECTIVE value (M3b review F3: token-meter's `pi.defaultThinkingLevel`
// is the configured default, not what the session ran with).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THINKING_LEVELS, piAddons } from "../addons/pi.ts";
import { createRegistry, sessionLevers } from "../addons/registry.ts";
import type { Lever } from "../addons/types.ts";
import { onAssigned, query, type Levers } from "../core/channel.ts";
import type { Level } from "../core/design.ts";
import { defaults } from "../core/settings.ts";
import { install } from "../core/shell.ts";
import { fakeControl, fakePi } from "./fake.ts";
import { violations } from "./states.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: unknown }).__piEconomicsWarned_v1);

const THINK = "pi.thinkingLevel";
const tool = (n: string) => `pi.activeTool(${n})`;
/** The registry of a fake session control, and a one-factor session over it. */
function rig(o: Parameters<typeof fakeControl>[0] = {}) {
  const c = fakeControl(o);
  const { levers, kinds } = piAddons(c.control);
  const registry = createRegistry(levers, kinds);
  const session = (lever: string, assigned: Level, levels: readonly Level[], env = { child: false }) =>
    sessionLevers(registry, { sessionId: "s1", factors: { f: { lever, assigned } } }, env, () => levels);
  const at = { sessionId: "s1" };
  return { ...c, registry, session, at };
}

test("T7b.1 pi.thinkingLevel: a control-tier lever of pi, read back before the agent starts; its levels are pi's six", () => {
  const { registry } = rig();
  const l = registry.lever(THINK)!;
  assert.deepEqual([l.id, l.target, l.scope, l.tier, l.readBackAt], [THINK, "pi", "session", "control", "before_agent_start"]);
  assert.deepEqual(THINKING_LEVELS, ["off", "minimal", "low", "medium", "high", "xhigh"]);
  assert.equal(registry.loaded("pi"), true, "pi is always loaded: the lever starts with the session");
  assert.deepEqual(l.feasible({ child: false }, ["medium", "high"]), ["medium", "high"]);
  assert.deepEqual(l.feasible({ child: false }, ["medium", "extreme", "High", 3, true]), ["medium"], "a level pi does not know is refused up front");
});

test("T7b.1 pi.thinkingLevel: set through pi's control when the session starts, confirmed by the getter at before_agent_start", () => {
  const r = rig({ level: "medium" });
  const s = r.session(THINK, "high", ["medium", "high"]);
  assert.equal(s.refresh(), true);
  assert.deepEqual(r.state.calls, ["thinking:high"]);
  assert.deepEqual(s.states()[THINK], { v: "high", s: "pe", a: "high", rb: "unverified", tier: "control" }, "assigned, not yet observed");
  assert.equal(s.observe("message_end", r.at), false, "not read back at message_end");
  assert.equal(s.observe("before_agent_start", r.at), true);
  assert.deepEqual(s.states()[THINK], { v: "high", s: "pe", a: "high", rb: "confirmed", tier: "control" });
  assert.equal(s.refresh(), false);
  assert.deepEqual(r.state.calls, ["thinking:high"], "applied once");
});

test("T7b.1 pi.thinkingLevel is a main session's lever: infeasible in a child (the actor sets a child's level, an orchestrator's explicit choice)", () => {
  const r = rig({ level: "medium" });
  assert.deepEqual(r.registry.lever(THINK)!.feasible({ child: true }, ["medium", "high"]), []);
  const s = r.session(THINK, "high", ["medium", "high"], { child: true });
  s.refresh();
  assert.deepEqual(r.state.calls, [], "never applied in a child");
  s.observe("before_agent_start", r.at);
  assert.deepEqual(s.states()[THINK], { v: "medium", s: "ext", a: "high", rb: "refused", tier: "control" });
});

test("T7b.2 pi.activeTool(<name>): the kind resolves by id; a malformed id is no lever", () => {
  const { registry } = rig();
  const l = registry.lever(tool("codemode"))!;
  assert.deepEqual([l.id, l.target, l.scope, l.tier, l.readBackAt], [tool("codemode"), "pi", "session", "control", "before_agent_start"]);
  assert.equal(registry.lever(tool("codemode")), l, "one lever per id");
  assert.equal(registry.lever(tool("mcp__srv.tool-1"))?.id, tool("mcp__srv.tool-1"));
  for (const bad of ["pi.activeTool", "pi.activeTool()", "pi.activeTool(a b)", "pi.activeTool(a,b)", "pi.activeTool((a))", "pi.activeTool(a)x", "x.activeTool(a)", "pi.activeTools(a)", "pi.thinkingLevel(a)", "pi.activeTool( a)"]) {
    assert.equal(registry.lever(bad), undefined, bad);
  }
});

test("T7b.2 pi.activeTool(<name>): levels [false, true]; an unknown tool or a non-boolean level is infeasible", () => {
  const { registry } = rig({ all: ["read", "bash", "codemode"] });
  const known = registry.lever(tool("codemode"))!;
  assert.deepEqual(known.feasible({ child: false }, [false, true]), [false, true]);
  assert.deepEqual(known.feasible({ child: false }, [true, false]), [true, false]);
  assert.deepEqual(known.feasible({ child: false }, ["on", 1, true]), [true]);
  assert.deepEqual(known.feasible({ child: true }, [false, true]), [], "a child's tools are the actor's choice");
  assert.deepEqual(registry.lever(tool("nope"))!.feasible({ child: false }, [false, true]), [], "an unknown tool cannot be assigned");
});

test("T7b.2 pi.activeTool(<name>): true adds the tool to the active set, false removes it, others stay; read back by getActiveTools", () => {
  const on = rig({ active: ["read", "bash"], all: ["read", "bash", "codemode"] });
  const a = on.session(tool("codemode"), true, [false, true]);
  a.refresh();
  assert.deepEqual(on.state.calls, ["tools:read,bash,codemode"]);
  a.observe("before_agent_start", on.at);
  assert.deepEqual(a.states()[tool("codemode")], { v: true, s: "pe", a: true, rb: "confirmed", tier: "control" });

  const off = rig({ active: ["read", "codemode", "bash"], all: ["read", "bash", "codemode"] });
  const b = off.session(tool("codemode"), false, [true, false]);
  b.refresh();
  assert.deepEqual(off.state.calls, ["tools:read,bash"]);
  b.observe("before_agent_start", off.at);
  assert.deepEqual(b.states()[tool("codemode")], { v: false, s: "pe", a: false, rb: "confirmed", tier: "control" });

  const same = rig({ active: ["read", "codemode"], all: ["read", "codemode"] });
  same.session(tool("codemode"), true, [false, true]).refresh();
  assert.deepEqual(same.state.calls, [], "already in the assigned state: pi is not called");
});

test("T7b.2 pi.activeTool(<name>) of an unknown tool: feasible = [] → never applied; the tool's own state is recorded (a = false) or refused (a = true)", () => {
  const r = rig({ all: ["read", "bash"] });
  const t = r.session(tool("nope"), true, [false, true]);
  t.refresh();
  assert.deepEqual(r.state.calls, []);
  t.observe("before_agent_start", r.at);
  assert.deepEqual(t.states()[tool("nope")], { v: false, s: "ext", a: true, rb: "refused", tier: "control" });
});

test("T7b.3 another party changes the level after the engine set it → refused with the observed level, source ext", () => {
  const r = rig({ level: "medium" });
  const s = r.session(THINK, "high", ["medium", "high"]);
  s.refresh();
  s.observe("before_agent_start", r.at);
  assert.equal(s.states()[THINK].rb, "confirmed");
  r.control.setThinkingLevel("low"); // an extension (or /thinking) at its own session_start or hook
  assert.equal(s.observe("before_agent_start", r.at), true);
  assert.deepEqual(s.states()[THINK], { v: "low", s: "ext", a: "high", rb: "refused", tier: "control" });
  r.control.setThinkingLevel("high");
  assert.equal(s.observe("before_agent_start", r.at), true);
  assert.equal(s.states()[THINK].rb, "confirmed", "changed back: the last observation counts");
});

test("T7b.3 pi's own clamp (the model cannot take the level) is refused with source fixed, not ext", () => {
  const r = rig({ level: "medium", clamp: () => "off" }); // a model without reasoning
  const s = r.session(THINK, "xhigh", ["medium", "xhigh"]);
  s.refresh();
  s.observe("before_agent_start", r.at);
  assert.deepEqual(s.states()[THINK], { v: "off", s: "fixed", a: "xhigh", rb: "refused", tier: "control" });
});

test("T7b.3 another extension changes the active tools after the engine set them → refused, source ext; a tool pi ignores → fixed", () => {
  const r = rig({ active: ["read"], all: ["read", "bash", "codemode"] });
  const s = r.session(tool("codemode"), true, [false, true]);
  s.refresh();
  s.observe("before_agent_start", r.at);
  assert.equal(s.states()[tool("codemode")].rb, "confirmed");
  r.control.setActiveTools(["read"]);
  s.observe("before_agent_start", r.at);
  assert.deepEqual(s.states()[tool("codemode")], { v: false, s: "ext", a: true, rb: "refused", tier: "control" });
});

test("T7b property: ∀ assigned level, ∀ later level the states keep every §5.3 invariant", () => {
  let seen = 0;
  for (const a of THINKING_LEVELS) {
    for (const later of [undefined, ...THINKING_LEVELS]) {
      for (const clamp of [undefined, () => "off"]) {
        const r = rig({ level: "medium", ...(clamp ? { clamp } : {}) });
        const s = r.session(THINK, a, THINKING_LEVELS);
        s.refresh();
        if (later !== undefined) r.control.setThinkingLevel(later);
        s.observe("before_agent_start", r.at);
        seen++;
        assert.deepEqual(violations(s.states()[THINK]), [], JSON.stringify([a, later, !!clamp, s.states()[THINK]]));
      }
    }
  }
  assert.ok(seen > 80);
});

test("T7b.1 an add-on whose apply throws (pi's control before it is active) is warned about once and does not stop the others", () => {
  const c = fakeControl();
  const broken = { ...c.control, setThinkingLevel: () => { throw new Error("not initialized"); } };
  const { levers, kinds } = piAddons(broken);
  const reg = createRegistry(levers, kinds);
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: unknown) => void warned.push(String(m));
  try {
    const s = sessionLevers(reg, { sessionId: "s1", factors: { a: { lever: THINK, assigned: "high" }, b: { lever: tool("codemode"), assigned: true } } }, { child: false }, () => [false, true, "medium", "high"]);
    assert.equal(s.refresh(), true);
    assert.deepEqual(warned, [`experiments: ${THINK}: apply failed: not initialized`]);
    assert.equal(c.state.calls.length, 1, "the other lever was applied");
    s.observe("before_agent_start", { sessionId: "s1" });
    assert.deepEqual(s.states()[THINK], { v: "medium", s: "ext", a: "high", rb: "refused", tier: "control" });
  } finally {
    console.warn = warn;
  }
});

// The engine: pi's control reaches the add-ons through the shell's pi, at session_start and before_agent_start.
function engine(factors: unknown[], controlOptions?: Parameters<typeof fakeControl>[0]) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-pi-"));
  const f = fakePi(controlOptions);
  const heard: Levers[] = [];
  onAssigned(f.events, (l) => void heard.push(l));
  const settings = { ...defaults(), strata: { all: { match: {}, objective: "apiUsd", factors } } };
  install(f.pi, { agentDir, settings, rng: () => 0.5, api: () => undefined });
  const ctx = (sid: string) => ({
    model: { provider: "openai", id: "gpt-5" },
    sessionManager: { getSessionId: () => sid, getSessionDir: () => join(agentDir, "sessions"), getSessionFile: () => join(agentDir, "sessions", `x_${sid}.jsonl`), getBranch: () => [] },
  });
  const start = (sid: string) => f.fire("session_start", { type: "session_start", reason: "startup" }, ctx(sid));
  const prompt = (sid: string) => f.fire("before_agent_start", { type: "before_agent_start", prompt: "x" }, ctx(sid));
  return { ...f, heard, start, prompt };
}

test("T7b.3 the engine: the level is set at session_start (no target to wait for), read back at the first prompt, a later change is published as refused", () => {
  const e = engine([{ name: "think", lever: THINK, levels: ["medium", "high"] }, { name: "codemode", lever: tool("codemode"), levels: [false, true] }]);
  e.start("s1");
  const a = e.heard[0];
  const assigned = (n: string) => a.factors![n].assigned;
  assert.deepEqual(e.control.calls.filter((c) => c.startsWith("thinking:")), [`thinking:${assigned("think")}`]);
  assert.equal(e.control.level, assigned("think"));
  assert.equal(e.control.active.includes("codemode"), assigned("codemode"));
  assert.deepEqual(Object.keys(a.levers), [THINK, tool("codemode")]);
  for (const id of [THINK, tool("codemode")]) assert.deepEqual([a.levers[id].rb, a.levers[id].tier], ["unverified", "control"]);
  const n = e.heard.length;
  e.prompt("s1");
  assert.equal(e.heard.length, n + 1, "the read-back changed the states: one publication");
  const b = e.heard.at(-1)!;
  for (const id of [THINK, tool("codemode")]) assert.equal(b.levers[id].rb, "confirmed", id);
  e.prompt("s1");
  assert.equal(e.heard.length, n + 1, "nothing changed: nothing published");
  e.pi.setThinkingLevel(assigned("think") === "high" ? "low" : "high");
  e.prompt("s1");
  const c = e.heard.at(-1)!;
  assert.deepEqual([c.levers[THINK].rb, c.levers[THINK].s, c.levers[THINK].a], ["refused", "ext", assigned("think")]);
  assert.deepEqual(query(e.events, "s1")?.levers, c.levers);
});

test("T7b.2 the engine: an unknown tool is refused up front (never set), the rest of the design runs", () => {
  const e = engine([{ name: "ghost", lever: tool("ghost"), levels: [false, true] }, { name: "think", lever: THINK, levels: ["medium", "high"] }]);
  e.start("s1");
  e.prompt("s1");
  const a = e.heard.at(-1)!;
  assert.equal(e.control.calls.some((c) => c.startsWith("tools:")), false);
  const g = a.factors!.ghost.assigned; // observed: not active (there is no such tool)
  assert.deepEqual(a.levers[tool("ghost")], g === true ? { v: false, s: "ext", a: true, rb: "refused", tier: "control" } : { v: false, s: "ext" });
  assert.equal(a.levers[THINK].rb, "confirmed");
});

test("T7b.1 the engine: a child runs its root's arm but never takes pi's controls (its level and tools stay the actor's)", () => {
  const e = engine([{ name: "think", lever: THINK, levels: ["medium", "high"] }]);
  e.start("s1");
  const sets = e.control.calls.length;
  const kid = { sessionManager: { getSessionId: () => "kid", getSessionFile: () => "/x/sessions/subagents/s1/k.jsonl", getBranch: () => [] } };
  e.fire("session_start", { type: "session_start", reason: "startup" }, kid);
  assert.equal(e.control.calls.length, sets, "no setThinkingLevel for the child");
});
