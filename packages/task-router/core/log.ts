// Outcome log with verdict tracking: a task killed without a verdict is logged `unjudged`.
import { checkEvent, correctiveEvent, escalateEvent, rerouteEvent, spawnEvent, spotcheckEvent, verdictEvent } from "./outcome.ts";
import type { OutcomeEvent, Verdict } from "./outcome.ts";

export type OutcomeLogDeps = { append: (e: OutcomeEvent) => void; now: () => Date };

export function createOutcomeLog(d: OutcomeLogDeps) {
  const open = new Set<string>(); // spawned, no verdict yet
  const known = new Set<string>();
  const w = (e: OutcomeEvent) => d.append(e);
  return {
    spawn(i: Omit<Parameters<typeof spawnEvent>[0], "now">) { known.add(i.taskId); open.add(i.taskId); w(spawnEvent({ ...i, now: d.now() })); },
    reroute(taskId: string, from: string, to: string, reason: string) { w(rerouteEvent({ now: d.now(), taskId, from, to, reason })); },
    check(taskId: string, exit: number, durationMs: number) { w(checkEvent({ now: d.now(), taskId, exit, durationMs })); },
    corrective(taskId: string) { w(correctiveEvent({ now: d.now(), taskId })); },
    escalate(taskId: string, from: string, to: string, attemptOf?: string) { w(escalateEvent({ now: d.now(), taskId, from, to, attemptOf })); },
    /** false (nothing written) for a task this log never saw spawn. */
    verdict(taskId: string, verdict: Verdict, note?: string, reviewOf?: string): boolean {
      if (!known.has(taskId)) return false;
      open.delete(taskId);
      w(verdictEvent({ now: d.now(), taskId, verdict, note, reviewOf }));
      return true;
    },
    spotcheck(taskId: string) { w(spotcheckEvent({ now: d.now(), taskId })); },
    killed(taskId: string) { if (open.delete(taskId)) w(verdictEvent({ now: d.now(), taskId, verdict: "unjudged" })); },
  };
}
