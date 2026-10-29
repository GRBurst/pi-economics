// Candidates of a leg and its label (spec §4.1, §4.5 first item, mi5), with the context filter (T3.1), and the runtime pick over them (T3.2). Pure.
import { effortAt, meeting } from "./members.ts";
import type { Named } from "./members.ts";
import type { Ability, Leg, PlanLeg, RouterSettings } from "./types.ts";

/** The enabled members meeting the level, in (cost, order, name) order, filtered by context (spec §4.5, OD17): with
 *  `contextFit > 0` and `need` (the files' tokens) > 0, those whose `contextFit · contextWindow` holds the files, the others named
 *  in the reason; none holds them → the largest window, still in (cost, order, name) order, with a reason. Never empty for context. */
export function candidates(s: RouterSettings, a: Ability, level: number, need: number): { cands: Named[]; reason?: string } {
  const meet = meeting(s.models, a, level);
  if (!(s.contextFit > 0) || !(need > 0)) return { cands: meet };
  const fit = meet.filter((m) => need <= s.contextFit * m.contextWindow);
  const out = meet.filter((m) => !fit.includes(m));
  const n = Math.round(need);
  if (fit.length) return { cands: fit, ...(out.length ? { reason: `context: files need ~${n} tokens; excluded ${out.map((m) => `${m.name} (${m.contextWindow})`).join(", ")}` } : {}) };
  const maxW = Math.max(...meet.map((m) => m.contextWindow));
  const big = meet.filter((m) => m.contextWindow === maxW);
  return { cands: big, reason: `context: files need ~${n} tokens (whole files); no member meeting ${a} ${level} holds them; took the largest window (${big[0].name}, ${maxW} tokens): list only the files the task reads, or split the task` };
}

/** A leg labelled with its planned member: the first candidate, its effort at the step (clamped to its ladder). */
export function labelLeg(s: RouterSettings, a: Ability, leg: Leg, need: number): { leg: PlanLeg; reason?: string } {
  const { cands, reason } = candidates(s, a, leg.level, need);
  const m = cands[0];
  return { leg: { ...leg, member: m.name, model: m.model, tier: m.tier, effort: effortAt(m, leg.step) }, ...(reason ? { reason } : {}) };
}

/** A candidate's runtime state (spec §4.5): `up` its endpoint answers, `free` up with a slot left. */
export type MemberState = { name: string; cost: number; up: boolean; free: boolean };
export type Pick = { pick: string } | { wait: true } | { none: string };
/** The pick over `cands`, ordered by (cost, order, name) (spec §4.5): before the queue expires, a free member of the cheapest up pool,
 *  else wait; after it, the first free up member. A down member is skipped at once; nothing up → none. */
export function pickMember(cands: MemberState[], expired: boolean): Pick {
  const up = cands.filter((m) => m.up);
  if (up.length === 0) return { none: "no member up" };
  const pool = up.filter((m) => m.cost === up[0].cost);
  const f = pool.find((m) => m.free) ?? (expired ? up.find((m) => m.free) : undefined);
  return f ? { pick: f.name } : expired ? { none: "no member free" } : { wait: true };
}
