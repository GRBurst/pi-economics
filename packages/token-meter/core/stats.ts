// Statistics for pi-analyse (the seeded PRNG and bootstrap once copied from pkgs/pi-bench/src/stats.ts; packages do not import each other).
// Pure and seeded, so a report is reproducible.

/** Small seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export type CI = { mean: number; lo: number; hi: number; n: number };
type BootOpts = { iters?: number; alpha?: number; seed?: number };
const ITERS = 2000;

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[i];
}

function boot(stat: () => number, o: BootOpts, point: number, n: number): CI {
  const iters = o.iters ?? ITERS;
  const alpha = o.alpha ?? 0.05;
  // A resample can be undefined (a ratio whose units all lack a denominator): it is dropped.
  const draws = Array.from({ length: iters }, stat).filter(Number.isFinite).sort((a, b) => a - b);
  if (!draws.length) return { mean: point, lo: NaN, hi: NaN, n };
  return { mean: point, lo: percentile(draws, alpha / 2), hi: percentile(draws, 1 - alpha / 2), n };
}

/** Percentile bootstrap CI of Σnum / Σden over units (resampling units). */
export function bootstrapRatioCI(units: Array<{ num: number; den: number }>, o: BootOpts = {}): CI {
  const ratio = (us: typeof units) => us.reduce((s, u) => s + u.num, 0) / us.reduce((s, u) => s + u.den, 0);
  if (units.length === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const rng = mulberry32(o.seed ?? 1);
  return boot(() => ratio(units.map(() => units[Math.floor(rng() * units.length)])), o, ratio(units), units.length);
}

/** A unit of an estimate: its objective (undefined = not measurable) over its active hours. */
export type RatioUnit = { objective?: number; hours: number };
const ratioOf = (us: RatioUnit[]): number => us.reduce((s, u) => s + (u.objective ?? 0), 0) / us.reduce((s, u) => s + u.hours, 0);

/**
 * Bootstrap of the effect ratio(B) / ratio(A) − 1 (ratio = Σ objective / Σ hours; redesign M2c, B8): B draws, each resamples the units
 * of A and of B independently with replacement (PRNG mulberry32(seed), B's units resampled before A's in each draw). Non-finite draws (a ratio without hours, a zero low ratio) are
 * dropped and counted in `dropped`. ci = the 2.5 and 97.5 percentiles, sd = the draws' standard deviation (population); both NaN without a finite draw.
 */
export function bootstrapRatio(unitsA: RatioUnit[], unitsB: RatioUnit[], B: number, seed: number): { ci: [number, number]; sd: number; dropped: number } {
  if (!unitsA.length || !unitsB.length) return { ci: [NaN, NaN], sd: NaN, dropped: 0 };
  const rng = mulberry32(seed);
  const resample = (us: RatioUnit[]): RatioUnit[] => us.map(() => us[Math.floor(rng() * us.length)]);
  const all = Array.from({ length: B }, () => ratioOf(resample(unitsB)) / ratioOf(resample(unitsA)) - 1);
  const draws = all.filter(Number.isFinite), dropped = all.length - draws.length;
  if (!draws.length) return { ci: [NaN, NaN], sd: NaN, dropped };
  const m = mean(draws);
  const sorted = [...draws].sort((a, b) => a - b);
  return { ci: [percentile(sorted, 0.025), percentile(sorted, 0.975)], sd: Math.sqrt(mean(draws.map((x) => (x - m) ** 2))), dropped };
}

/** Σ objective / Σ hours of the units. */
export const ratio = ratioOf;

/** Standard normal draw (Box–Muller) from a uniform source. */
export function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
