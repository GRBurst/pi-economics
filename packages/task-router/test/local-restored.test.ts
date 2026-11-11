// Local mode L8 (open from the L6 review fixes, F4): the actor restores a persisted routed child (spawn_subagent) after a
// restart without the spawn policy's tool guard and cwd. In local mode the router kills, at session start, every agent its own
// policy did not place: listed then (the actor restored first) or announced by its spawn event (the actor restores after the
// router's session_start). One warning names them; their branches and worktrees stay. A reload keeps the live children (they
// kept their guards); default mode, routing off and a child session that loads the router kill nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AgentInfo } from "../core/api.ts";
import { restoredText } from "../core/local/install.ts";
import { card, harness } from "./harness.ts";
import { reviewRig } from "./merge-rig.ts";

const agent = (name: string): AgentInfo => ({ name, parent: "main", sessionId: `s-${name}`, model: "m", thinkingLevel: "high", state: "paused" });
const spawned = (name: string) => ({ type: "spawn" as const, name, by: "main", parent: "main", childSessionId: `s-${name}`, ts: 0 });
const settle = () => new Promise((r) => setTimeout(r, 10));
function notesCtx() {
  const notes: [string, string][] = [];
  return { notes, ctx: { hasUI: true, ui: { notify: (m: string, l: string) => void notes.push([m, l]), setStatus: () => undefined } } };
}
const restoredNotes = (notes: [string, string][]) => notes.filter(([m]) => m.includes("restored subagent"));

test("restoredText names each child, its guard and cwd, and that branches and worktrees stay", () => {
  assert.equal(restoredText(["w1"]), "task-router: killed the restored subagent w1: the actor restores a routed child without the router's tool guard and cwd; branches and worktrees stay");
  assert.ok(restoredText(["w1", "w2"]).startsWith("task-router: killed the restored subagents w1, w2: "));
});

test("routed children the actor restored before session_start are killed, one warning; the branch and its worktree stay", async () => {
  const m = reviewRig();
  const rec = await m.start("x", "true", "add x");
  const before = m.h.router.branches.get(m.r.dir, "lm/x");
  const { notes, ctx } = notesCtx();
  const again = reviewRig({ repo: m.r, entries: m.h.f.entries.map((e) => ({ ...e })), agents: [agent("w1"), agent("w2")], ctx });
  await again.h.router.ready();
  await settle();
  assert.deepEqual(again.h.a.killed, ["w1", "w2"]);
  assert.deepEqual(restoredNotes(notes), [[restoredText(["w1", "w2"]), "warning"]]);
  assert.deepEqual(again.h.router.branches.get(m.r.dir, "lm/x"), before);
  assert.ok(existsSync(rec.worktree));
});

test("a routed child the actor restores after session_start (its spawn event, no policy call) is killed", async () => {
  const { notes, ctx } = notesCtx();
  const m = reviewRig({ ctx });
  m.h.a.agents.push(agent("w1"));
  m.h.a.emit(spawned("w1"));
  await settle();
  assert.deepEqual(m.h.a.killed, ["w1"]);
  assert.deepEqual(restoredNotes(notes), [[restoredText(["w1"]), "warning"]]);
});

test("a child the router's policy placed is not killed", async () => {
  const m = reviewRig();
  const r = await m.h.a.api.spawn!({ name: "c1", systemPrompt: "s", message: "go", task: card() });
  assert.ok(r.ok, JSON.stringify(r));
  await settle();
  assert.deepEqual(m.h.a.killed, []);
});

test("a reload keeps the live children: they were spawned with their guards", async () => {
  const m = reviewRig({ agents: [agent("w1")], event: { reason: "reload" } });
  await settle();
  assert.deepEqual(m.h.a.killed, []);
});

test("default mode, local mode with routing off, and a child session that loads the router kill nothing", async () => {
  const run = async (settings: Record<string, unknown>, sessionId = "s-main") => {
    const h = harness({ settings, apiExt: true });
    h.a.agents.push(agent("w1"));
    h.f.fire("session_start", {}, { sessionManager: { getSessionId: () => sessionId, getBranch: () => [] } });
    h.a.agents.push(agent("w2"));
    h.a.emit(spawned("w2"));
    await settle();
    return h.a.killed;
  };
  assert.deepEqual(await run({}), []);
  assert.deepEqual(await run({ mode: "local", routing: false }), []);
  assert.deepEqual(await run({ mode: "local" }, "s-w1"), []); // isChild only: the child is listed first here (spot-check F4 below: the real order)
  assert.deepEqual(await run({ mode: "local" }), ["w1", "w2"]); // the contrast
});

// ── spot-check F4: the guard against a child session's copy of the router ──
test("spot-check F4: a child session's copy kills nothing: the actor takes one policy, so it cannot register while main's is, and its own record is not listed yet", async () => {
  const local = { mode: "local" as const };
  const start = (h: ReturnType<typeof harness>, sessionId: string) => h.f.fire("session_start", {}, { sessionManager: { getSessionId: () => sessionId, getBranch: () => [] } });
  const main = harness({ settings: local, apiExt: true });
  start(main, "s-main"); // main's policy is registered
  main.a.agents.push(agent("w2")); // a child main placed, as the child's copy sees it
  // the child's session exists before its own record is listed (the actor creates the session, then lists the agent)
  const child = harness({ settings: local, apiExt: true, extra: { api: () => main.a.api } });
  start(child, "s-w1");
  main.a.emit(spawned("w1")); // the actor's announcement, which the child's copy hears too
  await settle();
  assert.deepEqual(main.a.killed, []);
});

// ── spot-check F5: a spawn in flight across a reload ──
test("spot-check F5: a child whose policy call ran before a /reload (its record is listed, pending) is not killed as restored when its spawn event arrives", async () => {
  const { notes, ctx } = notesCtx();
  const m = reviewRig({ agents: [agent("w1")], event: { reason: "reload" }, ctx });
  await settle();
  m.h.a.emit(spawned("w1")); // the attach of the spawn the old instance placed
  await settle();
  assert.deepEqual(m.h.a.killed, []);
  assert.deepEqual(restoredNotes(notes), []);
  m.h.a.agents.push(agent("w9")); // an agent that appears after the reload without this process's policy: restored
  m.h.a.emit(spawned("w9"));
  await settle();
  assert.deepEqual(m.h.a.killed, ["w9"]);
});
