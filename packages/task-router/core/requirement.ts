// The requirement of a card (spec §4.3): an ability and a level on its scale. Pure.
import { T0_KEYS } from "./card.ts";
import { bottom, firstMeeting, top } from "./members.ts";
import type { Card, Profile, Requirement, RouterSettings } from "./types.ts";
import type { Verified } from "./verify.ts";

const SOFT = ["bounded", "small"];

/** A pin (`level`) ignores t0, t2 and `minLevel`; else write follows t0 (draft on one soft miss), any other ability starts at its
 *  bottom (floor rule: t0 logged, not used); t2 / forceT2 → `top`; `minLevel` only raises, and clears a draft. */
export function requirementOf(c: Card, v: Verified, p: Profile, s: RouterSettings): Requirement {
  const a = p.ability ?? "write", M = s.models;
  if (p.level !== undefined) {
    const L = p.level === "top" ? top(M, a) : p.level;
    return { ability: a, level: L, draft: false, pinned: true, reasons: [`profile=${c.kind}`] };
  }
  const reasons: string[] = [];
  const misses = T0_KEYS.filter((k) => !v.t0[k]);
  let level: number, draft = false;
  if (c.t2.length || v.forceT2) {
    level = top(M, a);
    reasons.push(c.t2.length ? `t2: ${c.t2.join(", ")}` : "forced T2 by verification");
  } else {
    const soft = misses.length === 1 && SOFT.includes(misses[0]);
    reasons.push(!misses.length ? "all t0 criteria hold" : soft ? `soft miss: ${misses[0]}` : `t0 misses: ${misses.join(", ")}`);
    if (a !== "write") level = bottom(M, a);
    else if (!misses.length) level = 0;
    else if (soft) { level = 0; draft = true; }
    else level = 1;
  }
  if (p.minLevel !== undefined && p.minLevel > level) {
    reasons.push(`minLevel=${p.minLevel} raises ${a} ${level}${draft ? " draft" : ""}`);
    level = p.minLevel; draft = false;
  }
  return { ability: a, level, draft, pinned: false, reasons };
}

/** The log's `base` (mi8): the tier of the first member meeting the level, context-free, "-draft" suffixed. */
export const requirementLabel = (s: RouterSettings, r: Requirement): string =>
  firstMeeting(s.models, r.ability, r.level)!.tier + (r.draft ? "-draft" : "");
