// Arm assignment (properties P-off, P-balance, P-floor).
// Pure: all randomness comes in as `rng`, so tests seed it deterministically.
import type { Arm } from "./design.ts";

export type Mode = "off" | "explore" | "exploit";

export type State = {
  /** Assignments made per arm id so far (this session set; the extension persists it). */
  counts: Record<string, number>;
  /** Arm ids the guards disabled; never chosen in explore or exploit. */
  disabled: string[];
  /** Posterior (mean, sd) of the primary metric per arm id, from meter-report. */
  posterior?: Record<string, { mean: number; sd: number }>;
};

export function assign(
  mode: Mode,
  arms: Arm[],
  st: State,
  rng: () => number,
  minExplore: number,
  baseline: string,
): Arm {
  const baselineArm = arms.find((a) => a.id === baseline) ?? { id: baseline, flags: {} };
  // P-off: off ⇒ baseline, whatever else the state says.
  if (mode === "off") return baselineArm;
  const enabled = arms.filter((a) => !st.disabled.includes(a.id));
  if (enabled.length === 0) return baselineArm;
  if (mode === "explore") {
    // P-balance: always pick an enabled arm at the current minimum count, so
    // after n assignments max − min over the enabled arms stays ≤ 1.
    const min = Math.min(...enabled.map((a) => st.counts[a.id] ?? 0));
    const pool = enabled.filter((a) => (st.counts[a.id] ?? 0) === min);
    return pick(pool, rng);
  }
  // exploit: P-floor first. With probability minExplore pick uniformly over
  // the enabled arms, which alone gives every enabled arm ≥ minExplore/|A|;
  // the Thompson part below can only add probability.
  if (rng() < minExplore) return pick(enabled, rng);
  // Thompson: sample the posterior of each enabled arm, argmax wins.
  const sample = (a: Arm): number => {
    const p = st.posterior?.[a.id];
    if (!p || p.sd <= 0) return p?.mean ?? 0;
    // Box–Muller normal from two rng draws.
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    return p.mean + p.sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  let best = enabled[0];
  let bestSample = sample(best);
  for (const a of enabled.slice(1)) {
    const s = sample(a);
    if (s > bestSample) {
      best = a;
      bestSample = s;
    }
  }
  return best;
}

function pick(pool: Arm[], rng: () => number): Arm {
  return pool[Math.floor(rng() * pool.length) % pool.length];
}
