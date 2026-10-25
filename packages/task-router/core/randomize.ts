// Task-level randomization (T5.21; spec §6.1): a share of the spawns the router would put at the bottom of the card's ability
// (today: Qwen) runs one level up instead, so analysis can compare the levels on the same task mix. The review obligation is
// kept. Pure; the caller passes the random source and skips re-spawns and pins.
import { bottom, next } from "./members.ts";
import { labelLeg } from "./select.ts";
import type { Ability, Leg, RouterSettings } from "./types.ts";

/** A worker at the bottom of its ability goes one level up at step 0 with probability `share`. */
export function randomizeLeg(s: RouterSettings, a: Ability, worker: Leg, need: number, rng: () => number):
  { worker: Leg; from: string; reason: string } | undefined {
  const b = bottom(s.models, a);
  if (worker.level !== b || !s.randomize.enabled || !(rng() < s.randomize.share)) return undefined;
  const to = { level: next(s.models, a, b), step: 0 };
  const from = labelLeg(s, a, worker, need).leg.tier, toTier = labelLeg(s, a, to, need).leg.tier;
  return { worker: to, from, reason: `randomized ${from} → ${toTier} (share ${s.randomize.share})` };
}
