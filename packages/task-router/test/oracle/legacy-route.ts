// FROZEN ORACLE — copy of core/route.ts at d79921d, imports rewritten; never edit (spec §8.2; plan T0.3).
// Base route from the verified card (spec §5.2.4). Checks can only raise.
import { tierRank } from "./legacy-rank.ts";
import type { Base, Card, Profile, Tier } from "./legacy-types.ts";
import type { Verified } from "../../core/verify.ts";

const SOFT = ["bounded", "small"];

export function baseRoute(c: Card, v: Verified, p: Profile): { base: Base; reasons: string[] } {
  if (p.tier) return { base: p.tier, reasons: [`profile=${c.kind}`] };
  const reasons: string[] = [];
  const misses = Object.entries(v.t0).filter(([, ok]) => !ok).map(([k]) => k);
  let base: Base;
  if (c.t2.length || v.forceT2) {
    base = "T2";
    reasons.push(c.t2.length ? `t2: ${c.t2.join(", ")}` : "forced T2 by verification");
  } else if (misses.length === 0) {
    base = "qwen";
    reasons.push("all t0 criteria hold");
  } else if (misses.length === 1 && SOFT.includes(misses[0])) {
    base = "qwen-draft";
    reasons.push(`soft miss: ${misses[0]}`);
  } else {
    base = "T1";
    reasons.push(`t0 misses: ${misses.join(", ")}`);
  }
  const floor: Tier | undefined = p.minTier;
  if (floor && tierRank(floor) > tierRank(base === "qwen-draft" ? "qwen" : (base as Tier))) {
    reasons.push(`minTier=${floor} raises ${base}`);
    base = floor as Base;
  }
  return { base, reasons };
}
