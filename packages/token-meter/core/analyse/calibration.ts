// The quota calibration (design §9.2, redesign M4): per completed window, peak quota ≈ Σ_c β_c · API-eq $ of component c, a non-negative
// least-squares fit; R², $/point per window and four divergence flags. A flag means "the quota now weighs tokens differently from API
// prices": the signal to revisit the objective, never an automatic change. Pure.
import { type Component, type Window } from "./budget.ts";
import { sum } from "./logs.ts";

export const COMPONENTS: readonly Component[] = ["input", "cacheRead", "cacheWrite", "output"];
/** Complete windows needed for a fit (P10): fewer is `notEnough`. */
export const MIN_WINDOWS = 8;
const DAY = 86_400_000;
const R2_MIN = 0.8, SIGMAS = 3, DRIFT = 0.15, BETA_BAND = 2;
/** A component with less than this share of the windows' $ is not identifiable: its β is noise (a real log gave 550 for fresh input at 0.01 %). */
export const MATERIAL = 0.01;

export type Flag = { kind: "r2" | "residual" | "drift" | "beta"; window?: string; component?: Component; detail: string };
export type Fit = {
  n: number; beta: Record<Component, number>; r2: number; sigma: number;
  /** Each component's share of the windows' $: a component under 1 % is not identifiable and never raises a beta flag. */
  share: Record<Component, number>;
  usdPerPoint: { window: string; value: number }[]; flags: Flag[];
} | { n: number; notEnough: true };

/** The window's name in flags and tables: `<provider> <kind> <reset>`. */
export const windowId = (w: Pick<Window, "provider" | "kind" | "reset">): string => `${w.provider} ${w.kind} ${w.reset}`;

/** Solve the square system A x = b by Gaussian elimination with partial pivoting; undefined when A is (numerically) singular. */
function solve(A: number[][], b: number[]): number[] | undefined {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  const scale = Math.max(1e-300, ...A.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) <= 1e-11 * scale) return undefined;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) x[r] = (M[r][n] - sum(M[r].slice(r + 1, n).map((v, k) => v * x[r + 1 + k]))) / M[r][r];
  return x;
}

/**
 * Non-negative least squares, min ‖Xβ − y‖² s.t. β ≥ 0 (Lawson–Hanson active set; X is n rows × k columns). A column that would make the
 * passive set singular (a duplicate or all-zero one) is left at 0. (P9)
 */
export function nnls(X: number[][], y: number[]): number[] {
  const k = X[0]?.length ?? 0, n = X.length;
  const beta = new Array<number>(k).fill(0);
  if (!k || !n) return beta;
  const col = (j: number): number[] => X.map((r) => r[j]);
  const dot = (a: number[], b: number[]): number => sum(a.map((v, i) => v * b[i]));
  const cols = Array.from({ length: k }, (_, j) => col(j));
  const tol = 1e-12 * Math.max(1, ...cols.map((c) => Math.sqrt(dot(c, c)))) * Math.max(1, Math.sqrt(dot(y, y)));
  const passive: number[] = [], barred = new Set<number>();
  const lsq = (P: number[]): number[] | undefined => solve(P.map((a) => P.map((b) => dot(cols[a], cols[b]))), P.map((a) => dot(cols[a], y)));
  for (let guard = 0; guard < 10 * k + 10; guard++) {
    const r = y.map((v, i) => v - sum(cols.map((c, j) => c[i] * beta[j])));
    let j = -1, best = tol;
    for (let c = 0; c < k; c++) if (!passive.includes(c) && !barred.has(c)) { const w = dot(cols[c], r); if (w > best) { best = w; j = c; } }
    if (j < 0) break;
    passive.push(j);
    let s = lsq(passive);
    if (!s) { passive.pop(); barred.add(j); continue; }
    while (s && s.some((v) => v <= 0)) {
      let alpha = Infinity;
      passive.forEach((c, i) => { if (s![i] <= 0) alpha = Math.min(alpha, beta[c] / (beta[c] - s![i])); });
      passive.forEach((c, i) => { beta[c] += alpha * (s![i] - beta[c]); });
      for (let i = passive.length - 1; i >= 0; i--) if (beta[passive[i]] <= 1e-14) { beta[passive[i]] = 0; passive.splice(i, 1); }
      s = passive.length ? lsq(passive) : [];
    }
    passive.forEach((c, i) => { beta[c] = s![i]; });
  }
  return beta.map((v) => (v > 0 ? v : 0));
}

/** Points per API-eq $ of each component: a fit's β. */
export type Beta = Record<Component, number>;

/** The 5-hour fit with the most windows (the one the est. points columns use), if any group has a fit. */
export function betaOf(groups: ReadonlyArray<{ kind: "5h" | "7d"; fit: Fit }>): Beta | undefined {
  let best: { n: number; beta: Beta } | undefined;
  for (const g of groups) if (g.kind === "5h" && !("notEnough" in g.fit) && (!best || g.fit.n > best.n)) best = { n: g.fit.n, beta: g.fit.beta };
  return best?.beta;
}

/** A premium as two parts, priced in quota points: β_cacheWrite × the $ it cost to write − β_cacheRead × the $ it would have cost to read. */
export const estPoints = (parts: { write: number; read: number }, beta: Beta): number => beta.cacheWrite * parts.write - beta.cacheRead * parts.read;

const total = (u: Record<Component, number>): number => sum(COMPONENTS.map((c) => u[c]));

/**
 * The fit over `ws`'s complete windows (one provider and kind): y_w = peak_w (whole percent), x_w = the components' $. No intercept: a
 * window starts at 0. R² is the centred one (1 − SSE ÷ Σ(y − ȳ)²). Flags: R² < 0.8; a window whose residual exceeds 3σ, σ = √(SSE ÷ (n − k)) (a
 * single outlier needs n − k ≥ 10 to reach 3σ: below ~14 windows the flag cannot fire); drift: Σ$ ÷ Σpoints over the windows ending in (now −
 * 28 d, now] against (now − 56 d, now − 28 d] differing by more than 15 %; β_c outside [0.5, 2] × β̄ = Σβ_c·$_c ÷ Σ$_c for a component with at
 * least 1 % of the $.
 */
export function calibrate(ws: readonly Window[], now: string): Fit {
  const done = ws.filter((w) => w.complete);
  if (done.length < MIN_WINDOWS) return { n: done.length, notEnough: true };
  const X = done.map((w) => COMPONENTS.map((c) => w.usd[c])), y = done.map((w) => w.peak);
  const b = nnls(X, y);
  const beta = Object.fromEntries(COMPONENTS.map((c, j) => [c, b[j]])) as Record<Component, number>;
  const res = X.map((r, i) => y[i] - sum(r.map((x, j) => x * b[j])));
  const sse = sum(res.map((r) => r * r)), mean = sum(y) / y.length, sst = sum(y.map((v) => (v - mean) ** 2));
  const r2 = sst > 0 ? 1 - sse / sst : sse < 1e-9 ? 1 : 0;
  const sigma = Math.sqrt(sse / Math.max(1, done.length - COMPONENTS.length));
  const grand = sum(done.map((w) => total(w.usd)));
  const used = Object.fromEntries(COMPONENTS.map((c) => [c, sum(done.map((w) => w.usd[c]))])) as Record<Component, number>;
  const share = Object.fromEntries(COMPONENTS.map((c) => [c, grand ? used[c] / grand : 0])) as Record<Component, number>;
  const flags: Flag[] = [];
  if (r2 < R2_MIN) flags.push({ kind: "r2", detail: `R² ${r2.toFixed(2)} < ${R2_MIN}: the windows' quota is not explained by the token $ alone` });
  done.forEach((w, i) => {
    if (sigma > 1e-9 && Math.abs(res[i]) > SIGMAS * sigma) flags.push({ kind: "residual", window: windowId(w), detail: `peak ${w.peak} vs fitted ${(w.peak - res[i]).toFixed(1)} (${(Math.abs(res[i]) / sigma).toFixed(1)} σ)` });
  });
  const ending = (lo: number, hi: number): Window[] => done.filter((w) => { const t = Date.parse(w.reset); return t > Date.parse(now) - hi * DAY && t <= Date.parse(now) - lo * DAY; });
  const perPoint = (xs: Window[]): number => sum(xs.map((w) => total(w.usd))) / sum(xs.map((w) => w.peak));
  const [recent, before] = [ending(0, 28), ending(28, 56)];
  if (recent.length && before.length) {
    const r1 = perPoint(recent), r0 = perPoint(before);
    if (Number.isFinite(r1) && Number.isFinite(r0) && r0 > 0 && Math.abs(r1 / r0 - 1) > DRIFT) flags.push({ kind: "drift", detail: `$/point ${r1.toFixed(2)} over the last 28 days vs ${r0.toFixed(2)} over the 28 before (${r1 / r0 > 1 ? "+" : ""}${((r1 / r0 - 1) * 100).toFixed(0)} %)` });
  }
  const mean$ = grand ? sum(COMPONENTS.map((c) => beta[c] * used[c])) / grand : 0;
  if (mean$ > 0) for (const c of COMPONENTS) {
    if (share[c] >= MATERIAL && (beta[c] < mean$ / BETA_BAND || beta[c] > BETA_BAND * mean$)) flags.push({ kind: "beta", component: c, detail: `β ${beta[c].toFixed(2)} outside [${(mean$ / BETA_BAND).toFixed(2)}, ${(BETA_BAND * mean$).toFixed(2)}] (${BETA_BAND}× around the $-weighted mean ${mean$.toFixed(2)})` });
  }
  return { n: done.length, beta, r2, sigma, share, usdPerPoint: done.map((w) => ({ window: windowId(w), value: w.peak > 0 ? total(w.usd) / w.peak : NaN })), flags };
}
