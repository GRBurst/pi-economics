import { test } from "node:test";
import assert from "node:assert/strict";
import { check, REASONS, renderProblems, TRIGGERS } from "../core/contract.ts";
import { iso, MIN, T0, turn, world } from "./world.ts";

const fields = (ps: ReturnType<typeof check>) => ps.map((p) => `${p.log}.${p.field}`);

test("a complete set of logs (legacy v0 lines included) satisfies the contract", () => {
  assert.deepEqual(check(world()), []);
  assert.match(renderProblems([]), /contract ok/);
});

test("a child session named by a spawn event must carry parentSessionId", () => {
  const w = world();
  w.meter = w.meter.map((l) => (l.sessionId === "c3" ? (({ parentSessionId, ...r }) => r)(l) : l));
  const ps = check(w);
  assert.deepEqual(fields(ps), ["meter.parentSessionId"]);
  assert.equal(ps[0].count, 5);
  assert.match(ps[0].example, /^c3 @ /);
});

test("arm is required from the root's assignment on, in meter lines, spawn events and guard events", () => {
  const w = world();
  w.meter.push(turn("m3", T0 + 100 * MIN)); // no arm, after m3's assignment
  w.meter.push(turn("m3", T0 + 30 * MIN)); // no arm, before it: experiments not yet running
  w.meter.push(turn("c1", T0 + 100 * MIN, { parentSessionId: "m3" })); // child of an assigned root
  w.outcomes.push({ ts: iso(T0 + 100 * MIN), event: "spawn", taskId: "t7", kind: "implement", workerTier: "T1", workerEffort: "low", sessionId: "c7", parentSessionId: "m4" });
  w.guards.push({ ts: iso(T0 + 100 * MIN), sessionId: "m5", event: "correction" }); // m5 assigned at +119: not due
  w.guards.push({ ts: iso(T0 + 100 * MIN), sessionId: "m4", event: "correction" });
  const ps = check(w);
  assert.deepEqual(fields(ps), ["meter.arm", "outcomes.arm", "guards.arm"]);
  assert.deepEqual(ps.map((p) => p.count), [2, 1, 1]);
});

test("per event and version: spawn tier, verdict value, v1 assignment design, rating value, v type", () => {
  const w = world();
  w.outcomes[0] = (({ workerTier, ...r }) => r)(w.outcomes[0]);
  w.outcomes.push({ v: 1, ts: iso(T0), event: "verdict", taskId: "t1", verdict: "great" });
  w.assignments[2] = (({ design, ...r }) => r)(w.assignments[2]); // a v1 row needs design
  w.assignments[0] = (({ design, ...r }) => r)(w.assignments[0]); // a v0 row does not
  w.guards.push({ v: 1, ts: iso(T0), sessionId: "m1", arm: "-----", event: "rating", value: 9 });
  w.meter.push({ ...turn("m1", T0, { arm: "-----" }), v: "1" });
  assert.deepEqual(fields(check(w)).sort(), ["assignments.design", "guards.value", "meter.v", "outcomes.verdict", "outcomes.workerTier"]);
});

// Meter line v2 (M3a, design §5.2): `retries`/`retryWaitMs` are required up to v1 (the retry extension's counts) and optional
// from v2 (present iff the meter observes native attempts); every v2 field is type-checked when present.
test("meter v2: retries optional, v2 fields typed; v0/v1 lines still need retries", () => {
  const w = world();
  const v2 = { v: 2, ts: iso(T0), sessionId: "m9", provider: "p-local", model: "m", kind: "warming", status: 200,
    input: 1, cacheRead: 2, cacheWrite: 3, output: 4, costUsd: 0 };
  w.meter.push(v2, { ...v2, kind: "turn", retries: 1, retryWaitMs: 2000, billing: "local", durationMs: 900, ttftMs: 100, cacheWrite1h: 3, design: "d" });
  w.meter.push({ ...v2, kind: "turn", status: "error", errorClass: "400", errorKind: "context_overflow" });
  assert.deepEqual(check(w), [], "well-formed v2 lines");
  w.meter.push({ ...v2, billing: "prepaid", durationMs: -1, ttftMs: "1", cacheWrite1h: 1.5, design: "", retries: "0", errorKind: "oops" });
  const { v: _v, ...v0 } = turn("m1", T0, { arm: "-----" });
  w.meter.push((({ retries, retryWaitMs, ...r }) => r)(turn("m1", T0, { arm: "-----" })), (({ retries, ...r }) => r)(v0));
  assert.deepEqual(fields(check(w)).sort(), ["meter.billing", "meter.cacheWrite1h", "meter.design", "meter.durationMs", "meter.errorKind",
    "meter.retries", "meter.retries", "meter.retryWaitMs", "meter.ttftMs"]);
});

test("usage is required on successful requests only", () => {
  const w = world();
  w.meter.push({ v: 1, ts: iso(T0), sessionId: "e", provider: "p", model: "m", kind: "turn", status: "error", retries: 1, retryWaitMs: 0, errorClass: "429" });
  w.meter.push({ v: 1, ts: iso(T0), sessionId: "e", provider: "p", model: "m", kind: "turn", status: 200, retries: 0, retryWaitMs: 0 });
  assert.deepEqual(fields(check(w)), ["meter.input", "meter.cacheRead", "meter.cacheWrite", "meter.output", "meter.costUsd"]);
});

test("only lines of the checked set count; joins resolve against all lines", () => {
  const w = world();
  const period = { ...w, meter: w.meter.filter((l) => l.sessionId === "c1") }; // spawn of c1 only in `all`
  assert.deepEqual(check(period, w), []);
  const broken = { ...period, meter: period.meter.map(({ parentSessionId, ...r }) => r) };
  assert.deepEqual(fields(check(broken, { ...w, meter: broken.meter })), ["meter.parentSessionId"]);
});

// Optional outcome fields of the randomized-routing / spot-check experiment: never required, typed when present.
test("optional outcome fields are never required: lines without assigned/routeBase/unresolved/cwd/reviewOf pass; a spotcheck event is a known event", () => {
  const w = world();
  w.outcomes.push({ v: 1, ts: iso(T0 + 80 * MIN), event: "spotcheck", taskId: "t1", requested: true });
  w.outcomes.push({ v: 1, ts: iso(T0 + 80 * MIN), event: "spotcheck", taskId: "t2" }); // requested not required either
  assert.deepEqual(check(w), []);
});

test("optional outcome fields, when present, have their type: assigned router|random, routeBase/cwd/reviewOf strings, unresolved boolean, spotcheck requested true", () => {
  const w = world();
  const ok = { assigned: "random", routeBase: "qwen", unresolved: true, cwd: "/work/repo", reviewOf: "t1" };
  Object.assign(w.outcomes[0], ok);
  w.outcomes.push({ v: 1, ts: iso(T0 + 80 * MIN), event: "verdict", taskId: "t9", verdict: "accepted", reviewOf: "t1" });
  w.outcomes.push({ v: 1, ts: iso(T0 + 80 * MIN), event: "spotcheck", taskId: "t1", requested: true });
  assert.deepEqual(check(w), []);
  Object.assign(w.outcomes[1], { assigned: "dice", routeBase: 3, unresolved: "yes", cwd: "", reviewOf: 7 });
  w.outcomes.push({ v: 1, ts: iso(T0 + 80 * MIN), event: "spotcheck", taskId: "t2", requested: false });
  assert.deepEqual(fields(check(w)).sort(), ["outcomes.assigned", "outcomes.cwd", "outcomes.requested", "outcomes.reviewOf", "outcomes.routeBase", "outcomes.unresolved"]);
});

// T4.4 (MP4): the router's 2026-10-17 fields (spec §6.4) are optional, typed when present.
const ROUTER_SPAWN = { ability: "write", level: 0, draft: true, workerLevel: 0, reviewLevel: 1, workerMember: "sonnet", workerModel: "anthropic/claude-sonnet-5-5", startEffort: "high", waitMs: 0 };
const routerWorld = () => {
  const w = world();
  Object.assign(w.outcomes[0], ROUTER_SPAWN);
  Object.assign(w.outcomes[3], { fromModel: "openrouter/qwen/free", toModel: "anthropic/claude-opus-5-5", ability: "write", fromLevel: 0, toLevel: 2 });
  w.outcomes.push({ v: 1, ts: iso(T0 + 62 * MIN), event: "reroute", taskId: "t1", from: "cloud", to: "T1", reason: "500", fromModel: "openrouter/qwen/free", toModel: "anthropic/claude-sonnet-5-5" });
  return w;
};

test("T4.4 the router's new spawn, reroute and escalate fields pass when valid and are never required", () => {
  assert.deepEqual(check(routerWorld()), []);
  const w = world();
  w.outcomes.push({ v: 1, ts: iso(T0 + 62 * MIN), event: "reroute", taskId: "t1", from: "cloud", to: "T1", reason: "500" });
  assert.deepEqual(check(w), []);
});

for (const [i, bad, field] of [
  [0, { workerLevel: "1" }, "workerLevel"], [0, { waitMs: -1 }, "waitMs"], [0, { draft: false }, "draft"], [3, { fromLevel: 0.5 }, "fromLevel"],
  [0, { level: -1 }, "level"], [0, { reviewLevel: 1.5 }, "reviewLevel"], [0, { workerMember: "" }, "workerMember"], [0, { workerModel: 3 }, "workerModel"],
  [0, { startEffort: "" }, "startEffort"], [0, { ability: 1 }, "ability"], [3, { toLevel: "2" }, "toLevel"], [3, { ability: "" }, "ability"],
  [3, { fromModel: "" }, "fromModel"], [8, { toModel: 5 }, "toModel"], [0, { waitMs: Number.NaN }, "waitMs"],
] as const) {
  test(`T4.4 an invalid ${field} on line ${i} (${JSON.stringify(bad)}) is one problem naming it`, () => {
    const w = routerWorld();
    Object.assign(w.outcomes[i], bad);
    assert.deepEqual(fields(check(w)), [`outcomes.${field}`]);
  });
}

// Local mode L2.T3 (design §3.0.3, AC-L1, plan D21): the session-level `force` line, with `taskId: ""` (only there), and a
// forced spawn's optional fields.
const FORCE = { v: 1, ts: iso(T0 + 61 * MIN), event: "force", taskId: "", action: "set", source: "command", model: "anthropic/claude-sonnet-5-5", effort: "high" };

test("force lines: a valid line passes, with taskId \"\"; action and source are required enums; model, effort, reason typed", () => {
  const w = world();
  w.outcomes.push(FORCE, { ...FORCE, action: "rejected", source: "settings", model: "nosuch/x", effort: undefined, reason: "unknown-model" });
  w.outcomes.push({ v: 1, ts: iso(T0 + 61 * MIN), event: "force", taskId: "", action: "clear", source: "command" });
  w.outcomes.push({ v: 1, ts: iso(T0 + 61 * MIN), event: "force", taskId: "", action: "rejected", source: "command", reason: "usage" });
  assert.deepEqual(check(JSON.parse(JSON.stringify(w))), []);
  for (const [bad, field] of [
    [{ action: undefined }, "action"], [{ action: "maybe" }, "action"], [{ source: undefined }, "source"], [{ source: "user" }, "source"],
    [{ model: "" }, "model"], [{ effort: "huge" }, "effort"], [{ reason: "nope" }, "reason"], [{ taskId: undefined }, "taskId"], [{ taskId: 3 }, "taskId"],
  ] as const) {
    const x = world();
    x.outcomes.push(JSON.parse(JSON.stringify({ ...FORCE, ...bad })));
    assert.deepEqual(fields(check(x)), [`outcomes.${field}`], JSON.stringify(bad));
  }
});

test("force lines: only a force line may have an empty taskId", () => {
  const w = world();
  w.outcomes.push({ v: 1, ts: iso(T0 + 80 * MIN), event: "verdict", taskId: "", verdict: "accepted" });
  assert.deepEqual(fields(check(w)), ["outcomes.taskId"]);
});

test("force lines: a forced spawn's fields pass when valid and are never required; forced must be true", () => {
  const w = world();
  Object.assign(w.outcomes[0], { forced: true, forceSource: "settings", routedModel: "llama/qwen3.8", routedEffort: "xhigh" });
  assert.deepEqual(check(w), []);
  for (const [bad, field] of [[{ forced: "yes" }, "forced"], [{ forced: false }, "forced"], [{ forceSource: "user" }, "forceSource"], [{ routedModel: "" }, "routedModel"], [{ routedEffort: 3 }, "routedEffort"]] as const) {
    const x = world();
    Object.assign(x.outcomes[0], bad);
    assert.deepEqual(fields(check(x)), [`outcomes.${field}`], JSON.stringify(bad));
  }
});

// Local mode L3.T5 (design §3.0.3, AC-L1): the `hint` line — taskId "main" or a child, trip and stage required enums.
const HINT = { v: 1, ts: iso(T0 + 61 * MIN), event: "hint", taskId: "main", trip: "identical-call", stage: "hint", count: 1 };

test("hint lines: a valid line passes; trip and stage are required enums; count and sessionId typed", () => {
  const w = world();
  w.outcomes.push(HINT, { ...HINT, taskId: "c1", trip: "context-stall", stage: "parent", count: 3, sessionId: "m1" });
  w.outcomes.push({ v: 1, ts: iso(T0 + 61 * MIN), event: "hint", taskId: "main", trip: "risky-path", stage: "steer" });
  assert.deepEqual(check(JSON.parse(JSON.stringify(w))), []);
  for (const [bad, field] of [
    [{ trip: undefined }, "trip"], [{ trip: "loop" }, "trip"], [{ stage: undefined }, "stage"], [{ stage: "x" }, "stage"],
    [{ count: -1 }, "count"], [{ count: 1.5 }, "count"], [{ sessionId: "" }, "sessionId"], [{ taskId: "" }, "taskId"],
  ] as const) {
    const x = world();
    x.outcomes.push(JSON.parse(JSON.stringify({ ...HINT, ...bad })));
    assert.deepEqual(fields(check(x)), [`outcomes.${field}`], JSON.stringify(bad));
  }
});

// Local mode L5.T8 (design §3.3.3, AC-L1): the write guard's trip, and the contract's list is the router's.
test("hint lines: the outside-worktree trip passes", () => {
  const w = world();
  w.outcomes.push({ ...HINT, trip: "outside-worktree", count: 2 });
  assert.deepEqual(check(JSON.parse(JSON.stringify(w))), []);
});

// Local mode L4.T11 (design §3.0.3, AC-L1): the overseer's `review` line (taskId = the review id) and a ticket child's spawn.
const REVIEW = { v: 1, ts: iso(T0 + 61 * MIN), event: "review", taskId: "rv-0000abcd", role: "merge", member: "opus", model: "anthropic/claude-opus-5-5", outcome: "approve" };

test("review lines: a valid line passes; role, member, model and outcome are required; the optional keys typed", () => {
  const w = world();
  for (const role of ["merge", "plan-author", "plan-review", "delta", "steer"])
    for (const outcome of ["approve", "revise", "invalid", "timeout", "error"]) w.outcomes.push({ ...REVIEW, role, outcome });
  w.outcomes.push({ ...REVIEW, outcome: "revise", blocking: 1, findings: 2, fallback: "error", inconsistent: true, attempt: 2, durationMs: 9000,
    commit: "0123abc", branch: "wt/a" }, { ...REVIEW, fallback: "budget", blocking: 0, findings: 0, inconsistent: false, attempt: 1, durationMs: 0, commit: "0".repeat(40) });
  assert.deepEqual(check(JSON.parse(JSON.stringify(w))), []);
  for (const [bad, field] of [
    [{ outcome: undefined }, "outcome"], [{ outcome: "x" }, "outcome"], [{ role: undefined }, "role"], [{ role: "fixer" }, "role"],
    [{ member: "" }, "member"], [{ model: undefined }, "model"], [{ taskId: "" }, "taskId"],
    [{ blocking: -1 }, "blocking"], [{ findings: 1.5 }, "findings"], [{ fallback: "x" }, "fallback"], [{ inconsistent: "yes" }, "inconsistent"],
    [{ attempt: 0 }, "attempt"], [{ durationMs: -1 }, "durationMs"], [{ commit: "main" }, "commit"], [{ branch: "" }, "branch"],
  ] as const) {
    const x = world();
    x.outcomes.push(JSON.parse(JSON.stringify({ ...REVIEW, ...bad })));
    assert.deepEqual(fields(check(x)), [`outcomes.${field}`], JSON.stringify(bad));
  }
});

test("review without outcome: one outcomes.outcome problem", () => {
  const x = world();
  x.outcomes.push((({ outcome, ...r }) => r)(REVIEW));
  assert.deepEqual(fields(check(x)), ["outcomes.outcome"]);
});

const TICKET = { v: 1, ts: iso(T0 + 63 * MIN), event: "spawn", taskId: "ovs-merge-1", kind: "overseer", ticket: "merge", workerTier: "T2",
  workerEffort: "high", workerMember: "opus", workerModel: "anthropic/claude-opus-5-5", arm: "++++++", sessionId: "o1", parentSessionId: "m4" };

test("spawn ticket: a ticket child's line passes for every role and fixer; another value fails", () => {
  const w = world();
  for (const ticket of ["merge", "plan-author", "plan-review", "delta", "steer", "fixer"]) w.outcomes.push({ ...TICKET, ticket, ...(ticket === "fixer" && { kind: "implement" }) });
  assert.deepEqual(check(w), []);
  const x = world();
  x.outcomes.push({ ...TICKET, ticket: "x" });
  assert.deepEqual(fields(check(x)), ["outcomes.ticket"]);
});

// Local mode L6.T16 (design §3.0.3, AC-L1): the merge gate's `merge` line (taskId = the branch) and `gatebypass` line
// (taskId = the main branch).
const MERGE = { v: 1, ts: iso(T0 + 64 * MIN), event: "merge", taskId: "lm/x", outcome: "merged" };
const MERGE_REASONS = ["main-branch", "dirty", "behind", "fixer-running", "abandoned", "blocked", "size", "scope", "check", "main-dirty",
  "plan-changed", "no-worktree", "review-unavailable", "aborted", "git"];
const BYPASS = { v: 1, ts: iso(T0 + 65 * MIN), event: "gatebypass", taskId: "main", from: "0123abc", to: "89abcdef" };

test("merge lines: every outcome and reason passes; the optional keys typed; a refusal without a branch has taskId \"\"", () => {
  const w = world();
  for (const outcome of ["merged", "refused", "revise", "fixer", "failed"]) w.outcomes.push({ ...MERGE, outcome });
  for (const reason of MERGE_REASONS) w.outcomes.push({ ...MERGE, outcome: "refused", reason });
  w.outcomes.push({ ...MERGE, commit: "0".repeat(40), nLines: 0, nFiles: 0, reviewId: "rv-1", pushed: false },
    { ...MERGE, outcome: "refused", reason: "no-worktree", taskId: "" });
  assert.deepEqual(check(JSON.parse(JSON.stringify(w))), []);
  for (const [bad, field] of [
    [{ outcome: undefined }, "outcome"], [{ outcome: "error" }, "outcome"], [{ reason: "nope" }, "reason"], [{ commit: "main" }, "commit"],
    [{ nLines: -1 }, "nLines"], [{ nFiles: 1.5 }, "nFiles"], [{ reviewId: "" }, "reviewId"], [{ pushed: "yes" }, "pushed"], [{ taskId: undefined }, "taskId"],
  ] as const) {
    const x = world();
    x.outcomes.push(JSON.parse(JSON.stringify({ ...MERGE, ...bad })));
    assert.deepEqual(fields(check(x)), [`outcomes.${field}`], JSON.stringify(bad));
  }
});

test("merge reason: a value outside the router's codes fails", () => {
  const x = world();
  x.outcomes.push({ ...MERGE, outcome: "refused", reason: "nope" });
  assert.deepEqual(fields(check(x)), ["outcomes.reason"]);
});

test("gatebypass lines: from and to are shas, repo optional; without to one problem", () => {
  const w = world();
  w.outcomes.push(BYPASS, { ...BYPASS, repo: "my-repo" });
  assert.deepEqual(check(w), []);
  for (const [bad, field] of [[{ to: undefined }, "to"], [{ from: "main" }, "from"], [{ repo: "" }, "repo"], [{ taskId: "" }, "taskId"]] as const) {
    const x = world();
    x.outcomes.push(JSON.parse(JSON.stringify({ ...BYPASS, ...bad })));
    assert.deepEqual(fields(check(x)), [`outcomes.${field}`], JSON.stringify(bad));
  }
});

test("REASONS: the contract's merge codes are the literal list above", () => {
  assert.deepEqual(REASONS, MERGE_REASONS);
});

// Local mode L7.T16 (design §3.0.3, AC-L1): the plan's line (taskId = the plan's slug).
const PLAN = { v: 1, ts: iso(T0 + 66 * MIN), event: "plan", taskId: "parser", action: "skeleton" };
const PLAN_TRIGGERS = ["non-whitelisted", "interface-break", "regression", "over-budget", "remediation-failed"];

test("plan lines: every action and trigger passes; the optional keys typed; trigger: \"x\" fails", () => {
  const w = world();
  for (const action of ["skeleton", "approve", "trigger", "amend", "reject"]) w.outcomes.push({ ...PLAN, action });
  for (const trigger of PLAN_TRIGGERS) w.outcomes.push({ ...PLAN, action: "trigger", trigger });
  w.outcomes.push({ ...PLAN, action: "amend", trigger: "over-budget", nTasks: 3, reviewId: "rv-2", full: false });
  assert.deepEqual(check(JSON.parse(JSON.stringify(w))), []);
  for (const [bad, field] of [
    [{ action: undefined }, "action"], [{ action: "set" }, "action"], [{ trigger: "x" }, "trigger"], [{ nTasks: 0 }, "nTasks"],
    [{ reviewId: "" }, "reviewId"], [{ full: "yes" }, "full"], [{ taskId: "" }, "taskId"],
  ] as const) {
    const x = world();
    x.outcomes.push(JSON.parse(JSON.stringify({ ...PLAN, ...bad })));
    assert.deepEqual(fields(check(x)), [`outcomes.${field}`], JSON.stringify(bad));
  }
});

test("TRIGGERS: the contract's plan trigger codes are the literal list above", () => {
  assert.deepEqual(TRIGGERS, PLAN_TRIGGERS);
});
