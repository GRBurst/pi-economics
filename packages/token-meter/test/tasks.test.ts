// $ per accepted task = the cost of the subtrees of the arm's judged tasks ÷ its accepted tasks
// (join: outcome spawn.sessionId ↔ meter lines, descendants via parentSessionId).
import { test } from "node:test";
import assert from "node:assert/strict";
import { taskCosts } from "../core/tasks.ts";

const line = (sessionId: string, costUsd: number, parentSessionId?: string, extra: Record<string, unknown> = {}) =>
  ({ ts: "2026-10-05T08:00:00Z", sessionId, ...(parentSessionId ? { parentSessionId } : {}), kind: "turn", costUsd, ...extra });
const spawn = (taskId: string, arm: string | undefined, sessionId?: string) => ({ event: "spawn", taskId, ...(arm ? { arm } : {}), ...(sessionId ? { sessionId } : {}) });
const verdict = (taskId: string, v: string) => ({ event: "verdict", taskId, verdict: v });

test("cost of every judged task's subtree (children of children, warming included) per arm, divided by the accepted ones", () => {
  const meter = [
    line("main", 100), // the parent's own cost belongs to no task
    line("c1", 1), line("c1a", 0.5, "c1"), line("c1b", 0.25, "c1a"), line("c1", 0.125, undefined, { kind: "warming" }),
    line("c2", 2), line("c3", 0.25), line("c4", 1), line("c5", 9), line("c6", 7),
  ];
  const outcomes = [
    spawn("t1", "+", "c1"), spawn("t2", "+", "c2"), spawn("t3", "+", "c3"), spawn("t4", "-", "c4"), spawn("t5", "+", "c5"), spawn("t6", "+"), spawn("t7", undefined, "c7"),
    verdict("t1", "accepted"), verdict("t2", "rejected"), verdict("t3", "partial"), verdict("t3", "accepted"), verdict("t4", "accepted"),
    verdict("t5", "unjudged"), verdict("t6", "accepted"), verdict("t7", "accepted"),
  ];
  const r = taskCosts(meter, outcomes);
  // "+": t1 1.875 + t2 2 + t3 0.25 = 4.125 over 2 accepted (t1, t3); t5 unjudged and t6 without a session are not counted; t7 has no arm
  assert.deepEqual(r, { "+": { accepted: 2, judged: 3, costUsd: 4.125, perAccepted: 2.0625 }, "-": { accepted: 1, judged: 1, costUsd: 1, perAccepted: 1 } });
});

test("no accepted task → no ratio; a parent cycle in the meter does not hang", () => {
  const r = taskCosts([line("a", 1, "b"), line("b", 1, "a")], [spawn("t", "+", "a"), verdict("t", "rejected")]);
  assert.equal(r["+"].accepted, 0);
  assert.ok(Number.isNaN(r["+"].perAccepted));
});
