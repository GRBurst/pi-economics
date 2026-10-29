// FROZEN ORACLE — copy of core/plan.ts at d79921d, imports rewritten; never edit (spec §8.2; plan T0.3).
// Route plan per importance (spec §5.2.5 table) and the explicit model/effort check.
import { effortRank, tierRank } from "./legacy-rank.ts";
import type { Base, Importance, Kind, Leg, Plan, Profile, Result, RouterSettings, ThinkingLevel, Tier } from "./legacy-types.ts";

const L = (tier: Tier, effort: ThinkingLevel): Leg => ({ tier, effort });
const REV_T1 = L("T1", "high");
const REV_T2 = L("T2", "high");

// [worker, review?] per base and importance (normal, high, critical).
const TABLE: Record<Base, Record<Importance, [Leg, Leg?]>> = {
  qwen: { normal: [L("qwen", "xhigh")], high: [L("qwen", "xhigh"), REV_T1], critical: [L("T1", "high"), REV_T2] },
  "qwen-draft": { normal: [L("qwen", "xhigh"), REV_T1], high: [L("qwen", "xhigh"), REV_T1], critical: [L("T1", "high"), REV_T2] },
  T1: { normal: [L("T1", "high")], high: [L("T1", "xhigh")], critical: [L("T2", "xhigh")] },
  T2: { normal: [L("T2", "high")], high: [L("T2", "xhigh")], critical: [L("T2", "xhigh"), L("T2", "xhigh")] },
};

/** Qwen-pinned profiles (the built-in scout) stay on Qwen; `plan` always routes as T2; a pinned T1 keeps T1 (P-scout, P-plan, P-profile). */
export function planFor(base: Base, i: Importance, kind: Kind, p?: Profile): Plan {
  const reasons = [`importance=${i}`];
  if (kind === "plan") base = "T2";
  let [worker, review] = TABLE[base][i];
  if (p?.tier === "qwen") {
    [worker, review] = [L("qwen", "xhigh"), undefined];
    reasons.push("stays on qwen");
  } else if (p?.tier === "T1" && worker.tier !== "T1") {
    [worker, review] = [L("T1", "xhigh"), REV_T2];
    reasons.push("pinned tier T1");
  }
  return { worker, ...(review ? { review } : {}), base, importance: i, reasons };
}

const modelTier = (m: string, s: RouterSettings): Tier | undefined =>
  m === s.models.T2 ? "T2" : m === s.models.T1 ? "T1" : m === s.models.qwenLocal || m === s.models.qwenCloud ? "qwen" : undefined;

/** Explicit model/effort only at or above the planned worker; never `max` (P-explicit). */
export function acceptExplicit(p: Plan, m: string | undefined, e: ThinkingLevel | undefined, s: RouterSettings): Result<Leg> {
  const w = p.worker;
  const tier = m === undefined ? w.tier : modelTier(m, s);
  if (!tier) return { ok: false, errors: [`model ${m} is not in the routing table (${Object.values(s.models).join(", ")})`] };
  if (e === "max") return { ok: false, errors: ["effort max is never used; ask for xhigh"] };
  if (tierRank(tier) < tierRank(w.tier)) return { ok: false, errors: [`model ${m} (${tier}) is below the routed ${w.tier}: ${p.reasons.join("; ")}`] };
  if (tierRank(tier) === tierRank(w.tier) && e !== undefined && effortRank(e) < effortRank(w.effort)) {
    return { ok: false, errors: [`effort ${e} is below the routed ${w.effort} for ${w.tier}`] };
  }
  return { ok: true, value: { tier, effort: e ?? w.effort } };
}
