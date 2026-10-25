// Explicit model and effort (spec §4.7, RD3, P-explicit): accepted only at or above the plan. Pure; texts change in T5.9.
import { byModel, effortAt, enabled, lvl, named, stepOf } from "./members.ts";
import type { Ability, PlanLeg, Result, RouterSettings, ThinkingLevel } from "./types.ts";

export type Accepted = { member: string; tier: string; effort: ThinkingLevel; pinned: boolean };
/** What `acceptModel` reads of a plan. */
export type Planned = { ability: Ability; worker: PlanLeg; reasons: string[] };
const no = (e: string): Result<Accepted> => ({ ok: false, errors: [e] });

/** The first matching rule decides: 1 unknown model, 2 max, 3 no level on the ability, (4 context never rejects, OD17),
 *  5 a lower level, 6 at an equal level an effort below the plan's step on the model's own ladder, 7 accepted. */
export function acceptModel(plan: Planned, model: string | undefined, e: ThinkingLevel | undefined, s: RouterSettings): Result<Accepted> {
  const a = plan.ability, step = plan.worker.step;
  const W = named(s.models, plan.worker.member)!;
  const M = model === undefined ? W : byModel(s.models, model);
  if (!M) return no(`model ${model} is not in the routing table (${enabled(s.models).map((m) => m.model).join(", ")})`); // 1
  if (e === "max") return no("effort max is never used; ask for xhigh"); // 2
  if (M.abilities[a] === undefined) return no(`model ${model} has no ${a} level`); // 3
  if (lvl(M, a) < lvl(W, a)) return no(`model ${model} (${M.tier}) is below the routed ${W.tier}: ${plan.reasons.join("; ")}`); // 5
  if (lvl(M, a) === lvl(W, a) && e !== undefined && stepOf(M, e) < Math.min(step, M.efforts.length - 1))
    return no(`effort ${e} is below the routed ${effortAt(W, step)} for ${W.tier}`); // 6
  const we = effortAt(W, step); // 7
  return { ok: true, value: { member: M.name, tier: M.tier, effort: e ?? (M.efforts.includes(we) ? we : effortAt(M, step)), pinned: model !== undefined } };
}
