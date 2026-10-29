export const BOOTSTRAP_ITERS = 10_000;

/** Small seeded PRNG so reports are reproducible. */
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

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export type CI = { mean: number; lo: number; hi: number; n: number };
type BootOpts = { iters?: number; alpha?: number; seed?: number };

function percentile(sorted: number[], p: number): number {
	const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
	return sorted[i];
}

function boot(stat: () => number, o: BootOpts, point: number, n: number): CI {
	const iters = o.iters ?? BOOTSTRAP_ITERS;
	const alpha = o.alpha ?? 0.05;
	const draws = Array.from({ length: iters }, stat).sort((a, b) => a - b);
	return { mean: point, lo: percentile(draws, alpha / 2), hi: percentile(draws, 1 - alpha / 2), n };
}

/** Percentile bootstrap CI of the mean (default: 10 000 resamples, 95 %). */
export function bootstrapMeanCI(xs: number[], o: BootOpts = {}): CI {
	if (xs.length === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
	if (xs.length === 1 || xs.every((x) => x === xs[0])) return { mean: xs[0], lo: xs[0], hi: xs[0], n: xs.length };
	const rng = mulberry32(o.seed ?? 1);
	const pick = (a: number[]) => mean(Array.from({ length: a.length }, () => a[Math.floor(rng() * a.length)]));
	return boot(() => pick(xs), o, mean(xs), xs.length);
}

/** Percentile bootstrap CI of mean(xs) − mean(ys), groups resampled independently. */
export function bootstrapDiffCI(xs: number[], ys: number[], o: BootOpts = {}): CI {
	if (xs.length === 0 || ys.length === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
	const rng = mulberry32(o.seed ?? 1);
	const pick = (a: number[]) => mean(Array.from({ length: a.length }, () => a[Math.floor(rng() * a.length)]));
	return boot(() => pick(xs) - pick(ys), o, mean(xs) - mean(ys), xs.length + ys.length);
}

// --- OLS with two-way interactions ---------------------------------------------------------------

export type Term = { name: string; coef: number; se: number | null };
export type Fit = { terms: Term[]; r2: number; n: number; df: number; aliased: string[] };

/**
 * y ~ factors + all pairwise interactions, treatment coding (baseline = alphabetically first
 * level). Terms that are linearly dependent on earlier ones (empty cells) are dropped and listed
 * in `aliased`. `df` is the residual degrees of freedom; `se` is null when df = 0.
 */
export function olsInteractions(data: Record<string, any>[], y: string, factors: string[]): Fit {
	const levels = Object.fromEntries(factors.map((f) => [f, [...new Set(data.map((r) => String(r[f])))].sort()]));
	type Col = { name: string; x: number[] };
	const dummies: Col[][] = factors.map((f) =>
		levels[f].slice(1).map((l) => ({ name: `${f}=${l}`, x: data.map((r) => (String(r[f]) === l ? 1 : 0)) })),
	);
	const cols: Col[] = [{ name: "(intercept)", x: data.map(() => 1) }, ...dummies.flat()];
	for (let i = 0; i < dummies.length; i++)
		for (let j = i + 1; j < dummies.length; j++)
			for (const a of dummies[i]) for (const b of dummies[j]) cols.push({ name: `${a.name}:${b.name}`, x: a.x.map((v, k) => v * b.x[k]) });

	// Gram–Schmidt: keep a column only if it adds a direction
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
	// normal equations, inverted by Gauss–Jordan
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

// --- agreement -----------------------------------------------------------------------------------

/** Cohen's κ for paired categorical labels; all-agree on one label counts as 1, no pairs is NaN. */
export function cohenKappa(pairs: [string, string][]): number {
	const n = pairs.length;
	if (n === 0) return NaN;
	const po = pairs.filter(([a, b]) => a === b).length / n;
	const count = (i: 0 | 1) => {
		const m = new Map<string, number>();
		for (const p of pairs) m.set(p[i], (m.get(p[i]) ?? 0) + 1);
		return m;
	};
	const ca = count(0);
	const cb = count(1);
	let pe = 0;
	for (const [l, k] of ca) pe += (k / n) * ((cb.get(l) ?? 0) / n);
	return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
