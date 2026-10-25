// FROZEN ORACLE — copy of core/randomize.ts at d79921d, imports rewritten; never edit (spec §8.2; plan T0.3).
// Task-level randomization (T5.21): a share of the spawns the router would put on Qwen (T0 or Qwen
// draft) runs on T1 (Sonnet high) instead, so analysis can compare the tiers on the same task mix.
// The review obligation is kept. Pure; the caller passes the random source.
import type { Plan, RouterSettings } from "./legacy-types.ts";

/** Drawn (qwen worker, enabled, rng() < share) → T1 high, `assigned: "random"`; otherwise `p` itself. */
export function randomize(p: Plan, s: RouterSettings["randomize"], rng: () => number): Plan {
  if (p.worker.tier !== "qwen" || !s.enabled || !(rng() < s.share)) return p;
  return {
    ...p, worker: { tier: "T1", effort: "high" }, assigned: "random", routeBase: "qwen",
    reasons: [...p.reasons, `randomized qwen → T1 (share ${s.share})`],
  };
}
