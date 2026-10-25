// Today's tier vocabulary over the new pipeline (plan T2.10a; r2 H1, L8): thin wrappers over requirementOf/requirementLabel,
// planSpawn and acceptModel that return tier labels, shared by route.test.ts, brief.test.ts and delegation.test.ts. The tier labels
// mean today's models only under the today configuration, so every wrapper runs under TODAY (no M5 flip moves these tests).
import { acceptModel } from "../core/explicit.ts";
import { enabled, stepOf } from "../core/members.ts";
import { planSpawn } from "../core/pipeline.ts";
import { profileFor } from "../core/profile.ts";
import { requirementLabel, requirementOf } from "../core/requirement.ts";
import { labelLeg } from "../core/select.ts";
import { parseSettings } from "../core/settings.ts";
import { TODAY_RAW } from "./harness.ts";
import type { Card, Importance, Plan, Profile, Result, RouterSettings, ThinkingLevel, T0 } from "../core/types.ts";
import type { Verified } from "../core/verify.ts";

/** The types core no longer has after T2.10. */
export type Tier = "qwen" | "T1" | "T2";
export type Base = "qwen" | "qwen-draft" | "T1" | "T2";
export type TierLeg = { tier: Tier; effort: ThinkingLevel };
export type TierPlan = { worker: TierLeg; review?: TierLeg; base: Base; importance: Importance; reasons: string[] };

export const TODAY: RouterSettings = parseSettings(TODAY_RAW).settings;
/** rank(qwen) = 0 < rank(T1) = 1 < rank(T2) = 2 (today's core/rank.ts:5). */
export const tierRank = (t: string): number => ["qwen", "T1", "T2"].indexOf(t);

/** A profile as the loader makes it: legacy `tier`/`minTier` literals are mapped there (spec §5.4 row 7), not here. */
export function profileOf(kind: string, raw: Record<string, unknown> = {}): Profile {
  const r = profileFor(kind, parseSettings({ ...TODAY_RAW, profiles: raw }).settings);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

/** The base label of a card and the requirement's reasons. */
export function baseRoute(c: Card, v: Verified, p: Profile): { base: Base; reasons: string[] } {
  const req = requirementOf(c, v, p, TODAY);
  return { base: requirementLabel(TODAY, req) as Base, reasons: req.reasons };
}

const leg = (l: { tier: string; effort: ThinkingLevel }): TierLeg => ({ tier: l.tier as Tier, effort: l.effort });
const tierPlan = (p: Plan): TierPlan =>
  ({ worker: leg(p.worker), ...(p.review ? { review: leg(p.review) } : {}), base: p.base as Base, importance: p.importance, reasons: p.reasons });

/** The plan of one first spawn through `planSpawn` under TODAY (no randomization draw). */
export function planOf(c: Card, v: Verified, i: Importance, p = profileOf(c.kind)): TierPlan {
  const r = planSpawn({ settings: TODAY, attempts: new Map(), rng: () => 0.99 }, { taskId: "t", card: c, verified: v, profile: p, importance: i });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return tierPlan(r.value.plan);
}

const ALL: T0 = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
/** A base is produced by its card: qwen all t0; qwen-draft small false; T1 linear + specified false; T2 t2: security. */
const CARD_OF: Record<Base, Pick<Card, "t0" | "t2">> = {
  qwen: { t0: ALL, t2: [] },
  "qwen-draft": { t0: { ...ALL, small: false }, t2: [] },
  T1: { t0: { ...ALL, linear: false, specified: false }, t2: [] },
  T2: { t0: ALL, t2: ["security"] },
};
export function planFor(base: Base, i: Importance, kind: string, p?: Profile): TierPlan {
  const c: Card = { kind, files: [], acceptance: [], ...CARD_OF[base] };
  return planOf(c, { t0: c.t0, forceT2: false, reasons: [] }, i, p ?? profileOf(kind));
}

/** The explicit check on a tier plan: the plan is rebuilt from its tier leg (level = the write level of the first enabled member
 *  with that tier, step = its ladder step of the effort), then `acceptModel` decides. */
export function acceptExplicit(plan: TierPlan, m: string | undefined, e: ThinkingLevel | undefined, s: RouterSettings): Result<TierLeg> {
  const W = enabled(s.models).find((x) => x.tier === plan.worker.tier)!;
  const worker = labelLeg(s, "write", { level: W.abilities.write, step: stepOf(W, plan.worker.effort) }, 0).leg;
  const r = acceptModel({ ability: "write", worker, reasons: plan.reasons }, m, e, s);
  return r.ok ? { ok: true, value: leg(r.value) } : r;
}
