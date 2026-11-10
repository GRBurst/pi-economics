// Local mode L1.T1 (design §2.6, AC-N3, AC-N4): today's default-mode surface, frozen before any local-mode change.
// The literals below were recorded on the base commit; a local-mode change that leaks into default mode turns these red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accepted, card, harness, provideSkills } from "./harness.ts";

/** The main session's ctx (the fake API lists `main` with session `s-main`). */
const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
/** `pi.on` registrations of a default-mode install, recorded on the base commit (one entry per handler). */
const TODAY_HOOKS = ["before_agent_start", "input", "session_shutdown", "session_start", "session_start", "tool_call", "tool_result", "turn_end", "turn_end", "turn_start"];
/** A literal copy of today's outcome `KEYS` (core/outcome.ts on the base commit). */
const TODAY_KEYS = new Set([
  "v", "ts", "event", "taskId", "cardHash", "kind", "workerTier", "workerEffort", "reviewTier", "reviewEffort",
  "base", "importance", "reasons", "arm", "sessionId", "parentSessionId", "attemptOf", "from", "to", "reason",
  "exit", "durationMs", "verdict", "note",
  "unresolved", "assigned", "routeBase", "reviewOf", "requested",
  "ability", "level", "draft", "workerLevel", "reviewLevel", "workerMember", "workerModel", "startEffort", "waitMs",
  "fromModel", "toModel", "fromLevel", "toLevel",
]);
const settle = () => new Promise((r) => setImmediate(r));

test("default mode: inventory", () => {
  const h = harness();
  h.f.fire("session_start", {}, {});
  assert.deepEqual([...h.f.tools.keys()], ["task_verdict"]);
  assert.deepEqual([...h.f.commands.keys()], ["force"]); // L2.T4: AC-N3's final form (plan X9)
  assert.deepEqual(h.f.hookNames(), TODAY_HOOKS);
});

test("default mode: bash tool_call", () => {
  const h = harness();
  h.f.fire("session_start", {}, MAIN);
  const r = h.f.fire("tool_call", { toolName: "bash", toolCallId: "b1", input: { command: "git push origin main" } }, MAIN);
  assert.ok(r.length > 0);
  assert.deepEqual(r, r.map(() => undefined));
});

test("default mode: outcome keys", async () => {
  const run = async () => ({ exit: 1, output: "boom\n", timedOut: false });
  const h = harness({ settings: { spotCheck: { enabled: true, share: 1 } }, extra: { rng: () => 0, run } as never });
  h.f.fire("session_start", {}, MAIN);
  provideSkills(h, ["code-reviewer"]);
  const spawned = (name: string) => h.a.emit({ type: "spawn", name, by: "main", parent: "main", childSessionId: `s-${name}`, ts: 1 });
  accepted(await h.a.spawn({ name: "q1", task: card({ check: "npm test" }) }));
  spawned("q1");
  h.a.emit({ type: "error", name: "q1", reason: "boom", ts: 1 }); // local → Haiku: a reroute line
  await settle();
  h.a.agents.push({ name: "q1", parent: "main", sessionId: "s-q1", model: "x", thinkingLevel: "xhigh", state: "idle" });
  h.a.emit({ type: "route", from: "q1", to: "main", preview: "done", buffered: false, ts: 1 }); // the check runs
  for (let i = 0; i < 4; i++) await settle();
  accepted(await h.a.spawn({ name: "q1b", task: card({ attemptOf: "q1" }) }));
  spawned("q1b"); // an escalate line
  await h.f.callTool("task_verdict", { name: "q1b", verdict: "accepted" }); // verdict + spotcheck
  h.a.emit({ type: "kill", name: "q1", ts: 2 }); // unjudged verdict
  const ls = h.lines();
  for (const ev of ["spawn", "reroute", "check", "escalate", "verdict", "spotcheck"]) assert.ok(ls.some((l) => l.event === ev), `no ${ev} line`);
  for (const l of ls) for (const k of Object.keys(l)) assert.ok(TODAY_KEYS.has(k), `${l.event}: key ${k} is not one of today's`);
});
