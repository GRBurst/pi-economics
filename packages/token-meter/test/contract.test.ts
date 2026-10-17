import { test } from "node:test";
import assert from "node:assert/strict";
import { check, renderProblems } from "../core/contract.ts";
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

// T13.9: optional outcome fields of the randomized-routing / spot-check experiment: never required, typed when present.
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
