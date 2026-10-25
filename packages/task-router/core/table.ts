// The importance table per level (spec §4.4): the cell, the draft rule, the pin rule, the read-only rule. Pure.
import { bottom, effortAt, firstMeeting, lvl, next, top } from "./members.ts";
import type { Named } from "./members.ts";
import { candidates } from "./select.ts";
import type { Importance, Leg, Profile, Requirement, RouterSettings, Rows } from "./types.ts";

/** The highest numbered row of a table (−1: none). */
export const topRow = (rows: Rows): number => Math.max(-1, ...Object.keys(rows).filter((k) => /^(0|[1-9][0-9]*)$/.test(k)).map(Number));
/** The table a profile plans on (spec §4.3, S1): its own, else its ability's. */
export const tableOf = (p: Profile): string => p.table ?? p.ability ?? "write";

/** Cap per table (review G2 M2, owner decision (b) 2026-10-25; spec §5.4 amendment): a member's level on the profile's ability
 *  is clamped to the top row of the table the profile plans on, for this plan only; the members are not lowered, so a short
 *  custom table never moves another profile's routing. Nothing to clamp → `s` itself. */
export function capToTable(s: RouterSettings, p: Profile): RouterSettings {
  const a = p.ability ?? "write", rows = s.importanceTable[tableOf(p)];
  if (!rows) return s;
  const max = topRow(rows);
  if (!Object.values(s.models).some((m) => m.abilities[a] > max)) return s;
  const models = Object.fromEntries(Object.entries(s.models).map(([n, m]) =>
    [n, m.abilities[a] > max ? { ...m, abilities: { ...m.abilities, [a]: max } } : m]));
  return { ...s, models };
}

/** The rejection of a requirement or worker leg no enabled member meets (review G2 M1; the tier pipeline's `NotConfigured`). */
export const beyondTop = (a: string, l: number, T: number | undefined): string => T === undefined
  ? `no enabled member has ability ${a} (its members are blank or missing in the router settings)`
  : `no enabled member reaches ${a} level ${l} (the top of ${a} is ${T}; a member above it is blank or missing in the router settings)`;

/** `need`: the files' tokens, for the read-only rule's planned member (its first context candidate, T3.1). `error`: the
 *  worker leg lies above top(a) and the spawn is rejected; a review leg there is lowered to top(a) (review G2 M1). */
export function planLegs(req: Requirement, imp: Importance, p: Profile, s: RouterSettings, need = 0): { worker: Leg; review?: Leg; reasons: string[]; error?: string } {
  const a = req.ability, M = s.models;
  const cell = s.importanceTable[p.table ?? a][String(req.level)][imp];
  let worker: Leg = { ...cell.worker };
  let review: Leg | undefined = cell.review && { ...cell.review };
  const reasons = [`importance=${imp}`];
  const tierAt = (l: number) => firstMeeting(M, a, l)!.tier;
  if (req.draft && !review) review = { level: next(M, a, req.level), step: 0 };       // draft rule
  if (req.pinned) {                                                                     // pin rule
    const L = req.level, raised = worker.level > L;
    worker = { ...worker, level: Math.min(worker.level, L) };
    if (L === bottom(M, a)) { review = undefined; reasons.push(`stays on ${tierAt(L)}`); }
    else if (raised && !review) { review = { level: next(M, a, L), step: 0 }; reasons.push(`pinned tier ${tierAt(L)}`); }
  }
  // Legs above top(a) (spec §5.4 "never a crash"; review G2 M1): as the tier pipeline did with a blank tier, a worker there
  // rejects the spawn (its start had no model), a review there does not (it was a label): it is lowered to top(a).
  const T = top(M, a);
  if (worker.level > T) return { worker, reasons, error: beyondTop(a, worker.level, T) };
  if (review && review.level > T) { reasons.push(`review ${a} ${review.level} above the top: lowered to ${T}`); review = { ...review, level: T }; }
  // Read-only rule (RD4, OD8, OD18): a read-only profile at critical raises the worker instead of adding a review.
  if (s.readOnlyReview === "effort-step" && p.tools === "read-only" && imp === "critical" && review) {
    // The planned member of a leg = its first candidate at the card's need, context filter included (spec §4.1, §4.4 rule 4; r2, M1).
    const planned = (l: number): Named => candidates(s, a, l, need).cands[0];
    const W = planned(worker.level);
    if (worker.step < W.efforts.length - 1) {
      worker = { level: worker.level, step: worker.step + 1 }; review = undefined;
      reasons.push(`read-only critical: review → ${W.tier} ${effortAt(W, worker.step)}`);
    } else if (!req.pinned && next(M, a, lvl(W, a)) > lvl(W, a)) {
      const n = next(M, a, lvl(W, a)), N = planned(n);
      worker = { level: n, step: 0 }; review = undefined;
      reasons.push(`read-only critical: review → ${N.tier} ${effortAt(N, 0)}`);
    } else reasons.push("read-only critical: no step left, review kept");
  }
  return { worker, ...(review ? { review } : {}), reasons };
}
