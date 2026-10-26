// Attempts per task lineage (spec §4.6, §5.2.6, R6, P-att): a re-spawn with `attemptOf` goes one level above the failed member's
// level on the new card's ability; at the top one retry is allowed, a further one is rejected.
import { firstMeeting, lvl, next } from "./members.ts";
import { labelLeg } from "./select.ts";
import type { Ability, Leg, Result, RouterSettings } from "./types.ts";

/** Per task: the member it was planned on, the member it ran on (after failovers), retries at the same level. */
export type AttemptState = Map<string, { member: string; ranMember: string; retries: number }>;
/** `known` false: `attemptOf` is not in this process's state (a restart, a typo); `ranMember` and `fromLevel` are then step 1's
 *  stand-in (the new plan's member), not where the attempt ran, and the `escalate` line logs `from: "?"` (RG6, spec §4.6 erratum). */
export type Escalation = { ranMember: string; fromLevel: number; toLevel: number; known: boolean };

/** A re-spawn (`attemptOf`) goes one level above the failed member's level on the new card's ability; at the top one retry,
 *  then a rejection. A plan already above the target stands (mi2). `fromRan` (D7, T5.7): from = the higher of planned and ran. */
export function respawn(st: AttemptState, s: RouterSettings, i: { taskId: string; attemptOf?: string; a: Ability; worker: Leg; need: number; fromRan?: boolean }):
  Result<{ worker: Leg; reasons: string[]; esc?: Escalation }> {
  const M = s.models, a = i.a;
  const W = labelLeg(s, a, i.worker, i.need).leg;
  if (i.attemptOf === undefined) {
    st.set(i.taskId, { member: W.member, ranMember: W.member, retries: 0 });
    return { ok: true, value: { worker: i.worker, reasons: [] } };
  }
  const known = st.has(i.attemptOf);
  const prev = st.get(i.attemptOf) ?? { member: W.member, ranMember: W.member, retries: 0 };
  let from = i.fromRan ? Math.max(lvl(M[prev.member], a), lvl(M[prev.ranMember], a)) : lvl(M[prev.member], a);
  if (from < 0) from = i.worker.level;
  const target = next(M, a, from);
  const tierAt = (l: number) => firstMeeting(M, a, l)?.tier ?? "?";
  if (target === from && prev.retries >= 1)
    return { ok: false, errors: [`task ${i.attemptOf} already retried at ${a} level ${from} (${tierAt(from)}); report the failure to the user instead of a third attempt`] };
  const esc = (toLevel: number): Escalation => ({ ranMember: prev.ranMember, fromLevel: from, toLevel, known });
  if (lvl(M[W.member], a) > target) {
    st.set(i.taskId, { member: W.member, ranMember: W.member, retries: 0 });
    return { ok: true, value: { worker: i.worker, reasons: [], esc: esc(i.worker.level) } };
  }
  const worker = { level: target, step: 0 };
  const T = labelLeg(s, a, worker, i.need).leg;
  st.set(i.taskId, { member: T.member, ranMember: T.member, retries: target === from ? prev.retries + 1 : 0 });
  return { ok: true, value: { worker, reasons: [`escalated ${tierAt(from)} → ${tierAt(target)} after failure of ${i.attemptOf}`], esc: esc(target) } };
}
