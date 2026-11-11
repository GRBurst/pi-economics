// Outcome log with verdict tracking: a task killed without a verdict is logged `unjudged`.
import { checkEvent, correctiveEvent, escalateEvent, forceEvent, gatebypassEvent, hintEvent, mergeEvent, planEvent, rerouteEvent, reviewEvent, spawnEvent, spotcheckEvent, ticketSpawnEvent, verdictEvent } from "./outcome.ts";
import type { EscalateFields, HintStage, MergeInput, OutcomeEvent, PlanLogInput, ReviewInput, Verdict } from "./outcome.ts";
import type { Trip } from "./local/tripwires.ts";

export type OutcomeLogDeps = { append: (e: OutcomeEvent) => void; now: () => Date };

export function createOutcomeLog(d: OutcomeLogDeps) {
  const open = new Set<string>(); // spawned, no verdict yet
  const known = new Set<string>();
  const w = (e: OutcomeEvent) => d.append(e);
  return {
    spawn(i: Omit<Parameters<typeof spawnEvent>[0], "now">) { known.add(i.taskId); open.add(i.taskId); w(spawnEvent({ ...i, now: d.now() })); },
    reroute(taskId: string, from: string, to: string, reason: string, fromModel?: string, toModel?: string) {
      w(rerouteEvent({ now: d.now(), taskId, from, to, reason, fromModel, toModel }));
    },
    check(taskId: string, exit: number, durationMs: number) { w(checkEvent({ now: d.now(), taskId, exit, durationMs })); },
    corrective(taskId: string) { w(correctiveEvent({ now: d.now(), taskId })); },
    escalate(taskId: string, from: string, to: string, attemptOf?: string, f: EscalateFields = {}) {
      w(escalateEvent({ ...f, now: d.now(), taskId, from, to, attemptOf }));
    },
    /** false (nothing written) for a task this log never saw spawn. */
    verdict(taskId: string, verdict: Verdict, note?: string, reviewOf?: string): boolean {
      if (!known.has(taskId)) return false;
      open.delete(taskId);
      w(verdictEvent({ now: d.now(), taskId, verdict, note, reviewOf }));
      return true;
    },
    spotcheck(taskId: string) { w(spotcheckEvent({ now: d.now(), taskId })); },
    force(i: Omit<Parameters<typeof forceEvent>[0], "now">) { w(forceEvent({ ...i, now: d.now() })); },
    hint(taskId: string, trip: Trip, stage: HintStage, count?: number, sessionId?: string) { w(hintEvent({ now: d.now(), taskId, trip, stage, count, sessionId })); },
    review(i: ReviewInput) { w(reviewEvent({ ...i, now: d.now() })); },
    merge(i: MergeInput) { w(mergeEvent({ ...i, now: d.now() })); },
    gatebypass(i: Omit<Parameters<typeof gatebypassEvent>[0], "now">) { w(gatebypassEvent({ ...i, now: d.now() })); },
    plan(i: PlanLogInput) { w(planEvent({ ...i, now: d.now() })); },
    /** A ticket child (D26): no verdict slot, so its kill logs no `unjudged`. */
    ticketSpawn(i: Omit<Parameters<typeof ticketSpawnEvent>[0], "now">) { w(ticketSpawnEvent({ ...i, now: d.now() })); },
    killed(taskId: string) { if (open.delete(taskId)) w(verdictEvent({ now: d.now(), taskId, verdict: "unjudged" })); },
  };
}
