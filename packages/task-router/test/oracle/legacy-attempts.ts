// FROZEN ORACLE — copy of core/attempts.ts at d79921d, imports rewritten; never edit (spec §8.2; plan T0.3).
// Attempts per task lineage (spec §5.2.6, R6, P-att): a re-spawn with `attemptOf` is raised one
// tier; at T2 one retry is allowed, a further one is rejected.
import { tierRank } from "./legacy-rank.ts";
import type { Leg, Plan, Result } from "./legacy-types.ts";

export type AttemptState = Map<string, { tier: Leg["tier"]; retriesAtTier: number }>;

export const escalate = (t: Leg["tier"]): Leg["tier"] => (t === "qwen" ? "T1" : "T2");

export function onRespawn(st: AttemptState, taskId: string, attemptOf: string | undefined, plan: Plan): Result<Plan> {
  if (attemptOf === undefined) {
    st.set(taskId, { tier: plan.worker.tier, retriesAtTier: 0 });
    return { ok: true, value: plan };
  }
  const prev = st.get(attemptOf) ?? { tier: plan.worker.tier, retriesAtTier: 0 };
  const target = escalate(prev.tier);
  if (target === prev.tier && prev.retriesAtTier >= 1) {
    return { ok: false, errors: [`task ${attemptOf} already retried at ${prev.tier}; report the failure to the user instead of a third attempt`] };
  }
  if (tierRank(plan.worker.tier) > tierRank(target)) {
    st.set(taskId, { tier: plan.worker.tier, retriesAtTier: 0 });
    return { ok: true, value: plan };
  }
  st.set(taskId, { tier: target, retriesAtTier: target === prev.tier ? prev.retriesAtTier + 1 : 0 });
  const reasons = [...plan.reasons, `escalated ${prev.tier} → ${target} after failure of ${attemptOf}`];
  return { ok: true, value: { ...plan, worker: { tier: target, effort: "high" }, reasons } };
}
