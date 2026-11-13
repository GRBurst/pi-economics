// M4 (design §9.2): the quota calibration. nnls is non-negative least squares (P9); calibrate fits the windows' peak quota on the API-eq $
// of the four token components and flags divergence (R², residual, drift, a component's β). Synthetic windows, hand-chosen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, nnls, COMPONENTS, MIN_WINDOWS } from "../core/analyse/calibration.ts";
import type { Component, Window } from "../core/analyse/budget.ts";
import { mulberry32 } from "../core/stats.ts";

const DAY = 86_400_000;
const NOW = "2026-11-12T12:00:00.000Z";
const now = Date.parse(NOW);

const matmul = (X: number[][], b: number[]): number[] => X.map((r) => r.reduce((s, x, j) => s + x * b[j], 0));
const gradient = (X: number[][], b: number[], y: number[]): number[] => {
  const res = matmul(X, b).map((v, i) => v - y[i]);
  return X[0].map((_, j) => X.reduce((s, r, i) => s + r[j] * res[i], 0));
};

// ---- nnls (T4.3, T4.4) ----

test("nnls recovers a non-negative β* from y = Xβ* (full-rank random X, zeros in β*), to 1e-9 relative", () => {
  const rng = mulberry32(11);
  for (let t = 0; t < 200; t++) {
    const n = 6 + Math.floor(rng() * 10), k = 1 + Math.floor(rng() * 5);
    const X = Array.from({ length: n }, () => Array.from({ length: k }, () => rng() * 10));
    const b = Array.from({ length: k }, () => (rng() < 0.3 ? 0 : rng() * 5));
    const got = nnls(X, matmul(X, b));
    b.forEach((v, j) => assert.ok(Math.abs(got[j] - v) <= 1e-9 * Math.max(1, Math.abs(v)), `trial ${t} β${j}: ${got[j]} ≈ ${v}`));
  }
});

test("nnls: the KKT conditions hold for arbitrary X, y: β ≥ 0, β_c = 0 ⇒ g_c ≥ −ε, β_c > 0 ⇒ |g_c| ≤ ε (g = Xᵀ(Xβ − y))", () => {
  const rng = mulberry32(5);
  let zeros = 0;
  for (let t = 0; t < 300; t++) {
    const n = 3 + Math.floor(rng() * 12), k = 1 + Math.floor(rng() * 5);
    const X = Array.from({ length: n }, () => Array.from({ length: k }, () => rng() * 4 - 1));
    const y = Array.from({ length: n }, () => rng() * 20 - 10);
    const b = nnls(X, y), g = gradient(X, b, y), eps = 1e-7 * (1 + Math.max(...g.map(Math.abs)));
    b.forEach((v, j) => {
      assert.ok(v >= 0, `trial ${t}: β${j} = ${v}`);
      if (v === 0) { zeros += 1; assert.ok(g[j] >= -eps, `trial ${t}: β${j} = 0, g = ${g[j]}`); } else assert.ok(Math.abs(g[j]) <= eps, `trial ${t}: β${j} = ${v}, g = ${g[j]}`);
    });
  }
  assert.ok(zeros > 50, "the property saw active constraints");
});

test("nnls: where ordinary least squares is negative the coefficient is held at 0 and the others refit", () => {
  // X = [[1,0],[1,1]], y = [2,1]: OLS β = [2, −1]; with β₂ ≥ 0 the optimum is β = [1.5, 0]
  const b = nnls([[1, 0], [1, 1]], [2, 1]);
  assert.ok(Math.abs(b[0] - 1.5) < 1e-12 && b[1] === 0, JSON.stringify(b));
});

test("nnls: a duplicated column does not blow up (one carries the weight), an all-zero column is 0, no rows gives zeros", () => {
  const b = nnls([[1, 1, 0], [2, 2, 0], [3, 3, 0]], [2, 4, 6]);
  assert.ok(b.every((v) => Number.isFinite(v) && v >= 0) && Math.abs(b[0] + b[1] - 2) < 1e-9 && b[2] === 0, JSON.stringify(b));
  assert.deepEqual(nnls([], []), []);
  assert.deepEqual(nnls([[0], [0]], [1, 1]), [0]);
});

// ---- calibrate (T4.5) ----

/** Component $ of window i: deterministic and varied, input a negligible 0.5 % of the total. */
const usdOf = (i: number): Record<Component, number> => {
  const a = 2 + ((i * 7) % 19), b = 1 + ((i * 5) % 13), c = 1 + ((i * 3) % 11);
  return { input: 0.1 * (1 + ((i * 13) % 5)), cacheRead: 3 * a, cacheWrite: 2 * b, output: 3 * c };
};
const BETA: Record<Component, number> = { input: 5, cacheRead: 0.8, cacheWrite: 1.2, output: 1.1 };
const dot = (u: Record<Component, number>, b: Record<Component, number>): number => COMPONENTS.reduce((s, c) => s + b[c] * u[c], 0);

/** `n` complete windows ending `daysAgo(i)` before NOW, peak = peakOf(i, usd). */
const windows = (n: number, peakOf: (i: number, u: Record<Component, number>) => number, daysAgo = (i: number) => 1 + ((i * 2) % 55)): Window[] =>
  Array.from({ length: n }, (_, i) => {
    const usd = usdOf(i), end = now - daysAgo(i) * DAY;
    return { provider: "anthropic", kind: "5h", reset: new Date(end).toISOString(), start: new Date(end - 5 * 3_600_000).toISOString(), complete: true,
      peak: peakOf(i, usd), lockoutMs: 0, usd, requests: 100, r429: 0 };
  });
const kinds = (ws: Window[]): string[] => {
  const f = calibrate(ws, NOW);
  return "notEnough" in f ? ["notEnough"] : f.flags.map((x) => x.kind);
};
const exact = (i: number, u: Record<Component, number>) => dot(u, BETA);

test("calibrate: windows that follow β exactly recover β and R² = 1, with no flag; $/point per window", () => {
  const f = calibrate(windows(24, exact), NOW);
  assert.ok(!("notEnough" in f));
  if ("notEnough" in f) return;
  assert.equal(f.n, 24);
  assert.ok(Math.abs(f.r2 - 1) < 1e-9 && f.sigma < 1e-6);
  for (const c of ["cacheRead", "cacheWrite", "output"] as const) assert.ok(Math.abs(f.beta[c] - BETA[c]) < 1e-6, `${c} ${f.beta[c]}`);
  assert.deepEqual(f.flags, []);
  assert.equal(f.usdPerPoint.length, 24);
  const w0 = windows(24, exact)[0];
  assert.ok(Math.abs(f.usdPerPoint[0].value - COMPONENTS.reduce((s, c) => s + w0.usd[c], 0) / w0.peak) < 1e-9);
  assert.equal(f.usdPerPoint[0].window, `${w0.provider} ${w0.kind} ${w0.reset}`);
});

test("calibrate: whole-percent peaks (rounded) of a clean relation raise no flag", () => {
  assert.deepEqual(kinds(windows(24, (i, u) => Math.round(dot(u, BETA)))), []);
});

test("calibrate: fewer than MIN_WINDOWS (8) complete windows is notEnough with the count; incomplete windows do not count (P10)", () => {
  assert.equal(MIN_WINDOWS, 8);
  assert.deepEqual(calibrate(windows(7, exact), NOW), { n: 7, notEnough: true });
  assert.deepEqual(calibrate([], NOW), { n: 0, notEnough: true });
  const ws = windows(9, exact);
  ws[0].complete = false; ws[1].complete = false;
  assert.deepEqual(calibrate(ws, NOW), { n: 7, notEnough: true });
  assert.ok(!("notEnough" in calibrate(windows(8, exact), NOW)));
});

test("flag r2: peaks only loosely tied to $ (R² < 0.8), no residual, drift or β flag", () => {
  // ±noise in pairs, equal in both 28-day periods: R² ≈ 0.5, but bounded (no 3σ residual) and without drift
  const noise = (i: number) => (i % 2 ? 14 : -14);
  const ws = windows(24, (i, u) => dot(u, BETA) + noise(i), (i) => 1 + (i % 12) * 4.5 + (i >= 12 ? 28 : 0));
  const f = calibrate(ws, NOW);
  assert.ok(!("notEnough" in f) && f.r2 < 0.8 && f.r2 > 0, JSON.stringify(f));
  assert.deepEqual(kinds(ws), ["r2"]);
});

test("flag residual: one window 20 points off an otherwise exact relation (> 3σ), nothing else", () => {
  const ws = windows(24, (i, u) => dot(u, BETA) + (i === 5 ? 20 : 0));
  const f = calibrate(ws, NOW);
  assert.deepEqual(kinds(ws), ["residual"]);
  assert.ok(!("notEnough" in f) && f.flags[0].window === `${ws[5].provider} ${ws[5].kind} ${ws[5].reset}`);
});

test("flag drift: the last 28 days cost 25 % more points per $ than the 28 days before (> 15 %), nothing else", () => {
  const ws = windows(24, (i, u) => dot(u, BETA) * (i < 12 ? 1.25 : 1), (i) => (i < 12 ? 1 + i * 2 : 29 + (i - 12) * 2));
  assert.deepEqual(kinds(ws), ["drift"]);
  assert.deepEqual(kinds(windows(24, (i, u) => dot(u, BETA) * (i < 12 ? 1.1 : 1), (i) => (i < 12 ? 1 + i * 2 : 29 + (i - 12) * 2))), [], "10 % is within ±15 %");
});

test("flag beta: a material component weighs more than 2 × (or less than 0.5 ×) the $-weighted mean; an immaterial one (input, 0.5 % of $) never", () => {
  const heavy = { input: 5, cacheRead: 1, cacheWrite: 1, output: 6 };
  const ws = windows(24, (i, u) => dot(u, heavy));
  const f = calibrate(ws, NOW);
  assert.deepEqual(kinds(ws).filter((k, i, a) => a.indexOf(k) === i), ["beta"]);
  assert.ok(!("notEnough" in f) && f.flags.some((x) => x.component === "output") && f.flags.every((x) => x.component !== "input"));
});

test("calibrate: β is never negative whatever the peaks", () => {
  const f = calibrate(windows(24, (i, u) => 50 - 2 * u.cacheRead + (i % 3)), NOW);
  assert.ok(!("notEnough" in f) && COMPONENTS.every((c) => f.beta[c] >= 0));
});
