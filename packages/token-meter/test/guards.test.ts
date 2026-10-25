// Guard (verdict acceptance per arm, from the router's outcome log) and the kill switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptance, killSwitch } from "../core/guards.ts";
import type { ArmStat } from "../core/arms.ts";

const spawn = (taskId: string, arm?: string) => ({ event: "spawn", taskId, ...(arm ? { arm } : {}) });
const verdict = (taskId: string, v: string) => ({ event: "verdict", taskId, verdict: v });

test("acceptance: accepted / judged per arm; the last verdict of a task counts; unjudged, unknown tasks and arm-less spawns are left out", () => {
  const acc = acceptance([
    spawn("t1", "+"), spawn("t2", "+"), spawn("t3", "+"), spawn("t4", "-"), spawn("t5"), spawn("t6", "-"),
    verdict("t1", "accepted"), verdict("t2", "rejected"), verdict("t2", "accepted"), verdict("t3", "unjudged"),
    verdict("t4", "partial"), verdict("t5", "accepted"), verdict("nobody", "accepted"), { event: "check", taskId: "t1", exit: 0 },
  ]);
  assert.deepEqual(acc, { "+": { accepted: 2, judged: 2 }, "-": { accepted: 0, judged: 1 } });
});

const stat = (arm: string, units: number) => ({ arm, units }) as ArmStat;
const limits = { minSessions: 5, threshold: 0.2 };
const acc = (a: number, j: number) => ({ accepted: a, judged: j });

test("kill switch: an arm with ≥ minSessions units whose acceptance is worse than the baseline's by more than the threshold is disabled, with a reason", () => {
  const stats = [stat("-", 9), stat("+", 5), stat("a", 5), stat("b", 4), stat("c", 5), stat("d", 5)];
  const reasons = killSwitch(stats, { "-": acc(9, 10), "+": acc(6, 10), a: acc(7, 10), b: acc(0, 10), c: acc(0, 0) }, limits, "-");
  assert.deepEqual(Object.keys(reasons), ["+"]); // a: exactly 0.2 below is not "more than"; b: too few sessions; c/d: no verdicts; baseline never
  assert.match(reasons["+"], /acceptance 60% \(6\/10\) vs baseline 90% \(9\/10\)/);
});

test("kill switch: no judged baseline tasks → nothing is disabled", () => {
  assert.deepEqual(killSwitch([stat("-", 9), stat("+", 9)], { "+": acc(0, 10) }, limits, "-"), {});
});

// --- guards from <agentDir>/guards/events.jsonl (peek-after-mask, correction, rating) ---
import { signals } from "../core/guards.ts";

const ev = (arm: string | undefined, event: string, sessionId = "s", value?: number) => ({ ts: "2026-10-03T10:00:00Z", sessionId, ...(arm ? { arm } : {}), event, ...(value === undefined ? {} : { value }) });
const many = (n: number, arm: string, event: string) => Array.from({ length: n }, (_, i) => ev(arm, event, `s${i}`));

test("signals: counts per arm; the last rating of a session counts; arm-less and unknown events are left out", () => {
  const s = signals([
    ev("+", "peek-after-mask"), ev("+", "peek-after-mask"), ev("+", "correction"), ev("-", "correction"),
    ev("+", "rating", "a", 2), ev("+", "rating", "a", 4), ev("+", "rating", "b", 5), ev("+", "rating", "c", 9),
    ev(undefined, "peek-after-mask"), ev("+", "something-else"), { event: "rating", arm: "-", value: 3 },
  ]);
  assert.deepEqual(s, { "+": { peeks: 2, corrections: 1, ratings: [4, 5] }, "-": { peeks: 0, corrections: 1, ratings: [] } });
});

const full = { minSessions: 5, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5 };
const sigOf = (events: any[]) => signals(events);

test("kill switch: peeks after masking per session worse than the baseline's by more than peekThreshold", () => {
  const stats = [stat("-", 10), stat("+", 10), stat("a", 10), stat("b", 4)];
  const reasons = killSwitch(stats, {}, full, "-", sigOf([...many(2, "-", "peek-after-mask"), ...many(13, "+", "peek-after-mask"), ...many(12, "a", "peek-after-mask"), ...many(40, "b", "peek-after-mask")]));
  assert.deepEqual(Object.keys(reasons), ["+"]); // a: exactly 1.0 more is not "more than" 1.0; b: too few sessions
  assert.match(reasons["+"], /peeks after masking 1\.30\/session vs baseline 0\.20/);
});

test("kill switch: corrections per session", () => {
  const reasons = killSwitch([stat("-", 10), stat("+", 10)], {}, full, "-", sigOf([...many(5, "-", "correction"), ...many(16, "+", "correction")]));
  assert.match(reasons["+"], /corrections 1\.60\/session vs baseline 0\.50/);
  assert.deepEqual(killSwitch([stat("-", 10), stat("+", 10)], {}, full, "-", sigOf(many(10, "+", "correction"))), {}, "exactly 1.0 more: not more than");
});

test("kill switch: mean rating lower than the baseline's by more than ratingThreshold; needs ratings on both sides", () => {
  const rate = (arm: string, ...vs: number[]) => vs.map((v, i) => ev(arm, "rating", `${arm}${i}`, v));
  const stats = [stat("-", 10), stat("+", 10), stat("a", 10)];
  const reasons = killSwitch(stats, {}, full, "-", sigOf([...rate("-", 5, 4), ...rate("+", 4, 3), ...rate("a", 4, 5)]));
  assert.deepEqual(Object.keys(reasons), ["+"]);
  assert.match(reasons["+"], /rating 3\.5 vs baseline 4\.5/);
  assert.deepEqual(killSwitch(stats, {}, full, "-", sigOf(rate("+", 1, 1))), {}, "no baseline rating");
});

test("kill switch: several guards on one arm are all named; no signals at all → as before", () => {
  const sig = sigOf([...many(3, "+", "peek-after-mask"), ...many(0, "-", "peek-after-mask"), ...many(30, "+", "correction")]);
  const r = killSwitch([stat("-", 10), stat("+", 10)], { "-": acc(9, 10), "+": acc(1, 10) }, full, "-", sig);
  assert.match(r["+"], /acceptance .*; corrections /);
  assert.deepEqual(killSwitch([stat("-", 10), stat("+", 10)], {}, full, "-"), {});
});
