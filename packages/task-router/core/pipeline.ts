// The plan layer of one spawn as one pure function (spec §4; plan T1.1, T2.9): verified card → requirement → importance legs →
// randomization → attempts → labels → explicit model/effort. `createPolicy` runs it; the golden grid and the host replay run it too.
import { respawn } from "./attempts.ts";
import type { AttemptState, Escalation } from "./attempts.ts";
import { acceptModel } from "./explicit.ts";
import type { Accepted } from "./explicit.ts";
import { randomizeLeg } from "./randomize.ts";
import { requirementLabel, requirementOf } from "./requirement.ts";
import { candidates, labelLeg } from "./select.ts";
import { levels } from "./members.ts";
import { beyondTop, capToTable, planLegs } from "./table.ts";
import type { Verified } from "./verify.ts";
import type { Card, Importance, Plan, Profile, Result, RouterSettings, ThinkingLevel } from "./types.ts";

export type SpawnIn = { taskId: string; card: Card; verified: Verified; profile: Profile; importance: Importance; model?: string; effort?: ThinkingLevel };
/** `cands`: the worker leg's candidate names in (cost, order, name) order, on this plan's capped settings and need (D12); the
 *  policy selects over them, so plan and selection never disagree on a member the plan clamped. */
export type SpawnPlan = { plan: Plan; start: Accepted; esc?: Escalation; cands: string[] };
export type PlanDeps = { settings: RouterSettings; attempts: AttemptState; rng: () => number };

export function planSpawn(d: PlanDeps, i: SpawnIn): Result<SpawnPlan> {
  const s = capToTable(d.settings, i.profile); // the member cap is per table, for this plan only (review G2 M2 (b))
  const req = requirementOf(i.card, i.verified, i.profile, s);
  const a = req.ability, need = i.verified.tokens ?? 0; // the files' tokens: the context filter's need (T3.1)
  const T = levels(s.models, a).at(-1); // a requirement above top(a) (a floor; spec "never a crash") is rejected (review G2 M1)
  if (T === undefined || req.level > T) return { ok: false, errors: [beyondTop(a, req.level, T)] };
  const legs = planLegs(req, i.importance, i.profile, s, need);
  if (legs.error !== undefined) return { ok: false, errors: [legs.error] };
  const reasons = [...req.reasons, ...i.verified.reasons, ...legs.reasons];
  let worker = legs.worker, assigned: "router" | "random" = "router", routeBase: string | undefined;
  // A re-spawn escalates and a pinned profile is a pin: neither is randomized. Before respawn, so a failure escalates from where it ran.
  if (i.card.attemptOf === undefined && !req.pinned) {
    const r = randomizeLeg(s, a, worker, need, d.rng);
    if (r) { worker = r.worker; assigned = "random"; routeBase = r.from; reasons.push(r.reason); }
  }
  const att = respawn(d.attempts, s, { taskId: i.taskId, attemptOf: i.card.attemptOf, a, worker, need });
  if (!att.ok) return att;
  worker = att.value.worker; reasons.push(...att.value.reasons);
  const W = labelLeg(s, a, worker, need);
  if (W.reason) reasons.push(W.reason);
  const plan: Plan = {
    ability: a, level: req.level, ...(req.draft ? { draft: true as const } : {}), worker: W.leg,
    ...(legs.review ? { review: labelLeg(s, a, legs.review, 0).leg } : {}), // static review leg (mi5)
    base: requirementLabel(s, req), importance: i.importance, reasons, assigned, routeBase: routeBase ?? W.leg.tier,
  };
  const acc = acceptModel(plan, i.model, i.effort, s);
  const cands = candidates(s, a, worker.level, need).cands.map((m) => m.name);
  return acc.ok ? { ok: true, value: { plan, start: acc.value, ...(att.value.esc ? { esc: att.value.esc } : {}), cands } } : acc;
}
