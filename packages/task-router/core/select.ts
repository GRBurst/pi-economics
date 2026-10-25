// Candidates of a leg and its label (spec §4.1, §4.5 first item, mi5). Pure. T3.1 adds the context part, T3.2 `pickMember`.
import { effortAt, meeting } from "./members.ts";
import type { Named } from "./members.ts";
import type { Ability, Leg, PlanLeg, RouterSettings } from "./types.ts";

/** The enabled members meeting the level, in (cost, order, name) order. `need` (tokens of the files) is read from T3.1 on. */
export function candidates(s: RouterSettings, a: Ability, level: number, need: number): { cands: Named[]; reason?: string } {
  return { cands: meeting(s.models, a, level) };
}

/** A leg labelled with its planned member: the first candidate, its effort at the step (clamped to its ladder). */
export function labelLeg(s: RouterSettings, a: Ability, leg: Leg, need: number): { leg: PlanLeg; reason?: string } {
  const { cands, reason } = candidates(s, a, leg.level, need);
  const m = cands[0];
  return { leg: { ...leg, member: m.name, model: m.model, tier: m.tier, effort: effortAt(m, leg.step) }, ...(reason ? { reason } : {}) };
}
