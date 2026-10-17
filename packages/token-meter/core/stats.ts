// Statistics for pi-analyse, copied from pkgs/pi-bench/src/stats.ts (packages do not import each other).
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

/** Percentile bootstrap CI of mean(xs) − mean(ys), groups resampled independently. */
export function bootstrapDiffCI(xs: number[], ys: number[], o: BootOpts = {}): CI {
  if (xs.length === 0 || ys.length === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const rng = mulberry32(o.seed ?? 1);
  const pick = (a: number[]) => mean(Array.from({ length: a.length }, () => a[Math.floor(rng() * a.length)]));
  return boot(() => pick(xs) - pick(ys), o, mean(xs) - mean(ys), xs.length + ys.length);
}

/** Percentile bootstrap CI of Σnum / Σden over units (resampling units). */
export function bootstrapRatioCI(units: Array<{ num: number; den: number }>, o: BootOpts = {}): CI {
  const ratio = (us: typeof units) => us.reduce((s, u) => s + u.num, 0) / us.reduce((s, u) => s + u.den, 0);
  if (units.length === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const rng = mulberry32(o.seed ?? 1);
  return boot(() => ratio(units.map(() => units[Math.floor(rng() * units.length)])), o, ratio(units), units.length);
}

// --- OLS with two-way interactions ---------------------------------------------------------------

function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f !== 0) for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r) => r.slice(n));
}

export type Term = { name: string; coef: number; se: number | null };
export type Fit = { terms: Term[]; r2: number; n: number; df: number; aliased: string[] };

/**
 * OLS of `y` on the factors (treatment coding: first level of `levelsOf` — or alphabetical — is the
 * reference) plus every two-way interaction. Columns that add no direction (aliased in a fraction,
 * or too few units) are dropped by Gram–Schmidt and listed in `aliased`; se is null without residual df.
 */
export function olsInteractions(data: Record<string, any>[], y: string, factors: string[], levelsOf: Record<string, string[]> = {}): Fit {
  const levels = Object.fromEntries(factors.map((f) => {
    const seen = [...new Set(data.map((r) => String(r[f])))].sort();
    const order = levelsOf[f] ?? [];
    return [f, [...order.filter((l) => seen.includes(l)), ...seen.filter((l) => !order.includes(l))]];
  }));
  type Col = { name: string; x: number[] };
  const dummies: Col[][] = factors.map((f) =>
    levels[f].slice(1).map((l) => ({ name: `${f}=${l}`, x: data.map((r) => (String(r[f]) === l ? 1 : 0)) })),
  );
  const cols: Col[] = [{ name: "(intercept)", x: data.map(() => 1) }, ...dummies.flat()];
  for (let i = 0; i < dummies.length; i++)
    for (let j = i + 1; j < dummies.length; j++)
      for (const a of dummies[i]) for (const b of dummies[j]) cols.push({ name: `${a.name}:${b.name}`, x: a.x.map((v, k) => v * b.x[k]) });

  const kept: Col[] = [];
  const basis: number[][] = [];
  const aliased: string[] = [];
  for (const c of cols) {
    const r = [...c.x];
    for (const q of basis) {
      const d = q.reduce((s, v, k) => s + v * r[k], 0);
      for (let k = 0; k < r.length; k++) r[k] -= d * q[k];
    }
    const norm = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
    if (norm < 1e-9) { aliased.push(c.name); continue; }
    basis.push(r.map((v) => v / norm));
    kept.push(c);
  }
  const p = kept.length;
  const n = data.length;
  const Y = data.map((r) => Number(r[y]));
  const XtX = kept.map((a) => kept.map((b) => a.x.reduce((s, v, k) => s + v * b.x[k], 0)));
  const inv = invert(XtX);
  const XtY = kept.map((a) => a.x.reduce((s, v, k) => s + v * Y[k], 0));
  const beta = inv.map((row) => row.reduce((s, v, k) => s + v * XtY[k], 0));
  const fitted = Y.map((_, k) => kept.reduce((s, c, i) => s + beta[i] * c.x[k], 0));
  const sse = Y.reduce((s, v, k) => s + (v - fitted[k]) ** 2, 0);
  const my = mean(Y);
  const sst = Y.reduce((s, v) => s + (v - my) ** 2, 0);
  const df = n - p;
  const sigma2 = df > 0 ? sse / df : NaN;
  return {
    terms: kept.map((c, i) => ({ name: c.name, coef: beta[i], se: df > 0 ? Math.sqrt(Math.max(0, sigma2 * inv[i][i])) : null })),
    r2: sst === 0 ? 1 : 1 - sse / sst,
    n, df, aliased,
  };
}

/** Standard normal draw (Box–Muller) from a uniform source. */
export function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
