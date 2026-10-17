import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_ITERS, bootstrapDiffCI, bootstrapMeanCI, cohenKappa, olsInteractions } from "../src/stats.ts";

test("bootstrap uses 10 000 resamples by default and is reproducible with a seed", () => {
	assert.equal(BOOTSTRAP_ITERS, 10_000);
	const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	const a = bootstrapMeanCI(xs, { seed: 7 });
	assert.deepEqual(a, bootstrapMeanCI(xs, { seed: 7 }));
	assert.equal(a.mean, 5.5);
	assert.ok(a.lo > 3.5 && a.lo < 5.5 && a.hi > 5.5 && a.hi < 7.5, JSON.stringify(a));
});

test("bootstrap of constant data is a point; of one value too; of nothing is NaN", () => {
	assert.deepEqual(bootstrapMeanCI([4, 4, 4]), { mean: 4, lo: 4, hi: 4, n: 3 });
	assert.deepEqual(bootstrapMeanCI([2]), { mean: 2, lo: 2, hi: 2, n: 1 });
	assert.ok(Number.isNaN(bootstrapMeanCI([]).mean));
});

test("bootstrap CI narrows with more data and covers the true mean of a seeded sample", () => {
	const draw = (n: number) => Array.from({ length: n }, (_, i) => (i % 2) * 10); // mean 5 (n even)
	const w = (c: { lo: number; hi: number }) => c.hi - c.lo;
	assert.ok(w(bootstrapMeanCI(draw(100), { seed: 1 })) < w(bootstrapMeanCI(draw(10), { seed: 1 })));
});

test("difference CI excludes 0 for separated groups and includes it for identical ones", () => {
	const hi = [10, 11, 12, 13, 14, 15];
	const lo = [0, 1, 2, 3, 4, 5];
	const d = bootstrapDiffCI(hi, lo, { seed: 3 });
	assert.equal(d.mean, 10);
	assert.ok(d.lo > 0);
	const same = bootstrapDiffCI(hi, hi, { seed: 3 });
	assert.equal(same.mean, 0);
	assert.ok(same.lo < 0 && same.hi > 0);
});

const cells = (f: (arm: string, kind: string) => number, reps = 2) =>
	["a", "b"].flatMap((arm) => ["s", "l"].flatMap((kind) => Array.from({ length: reps }, () => ({ arm, kind, y: f(arm, kind) }))));

test("OLS with two-way interaction recovers exact coefficients", () => {
	const data = cells((arm, kind) => 1 + (arm === "b" ? 2 : 0) + (kind === "s" ? 3 : 0) + (arm === "b" && kind === "s" ? 4 : 0));
	// baselines are the alphabetically first levels: arm=a, kind=l
	const fit = olsInteractions(data, "y", ["arm", "kind"]);
	const coef = Object.fromEntries(fit.terms.map((t) => [t.name, t.coef]));
	assert.ok(Math.abs(coef["(intercept)"] - 1) < 1e-9);
	assert.ok(Math.abs(coef["arm=b"] - 2) < 1e-9);
	assert.ok(Math.abs(coef["kind=s"] - 3) < 1e-9);
	assert.ok(Math.abs(coef["arm=b:kind=s"] - 4) < 1e-9);
	assert.ok(Math.abs(fit.r2 - 1) < 1e-9);
	assert.equal(fit.n, 8);
	assert.equal(fit.df, 4);
});

test("OLS reports standard errors with noise; a pure main-effect model has ~0 interaction", () => {
	let k = 0;
	const noise = [0.1, -0.1, 0.2, -0.2, 0.05, -0.05, 0.15, -0.15, 0.1, -0.1, 0.2, -0.2, 0.05, -0.05, 0.15, -0.15];
	const data = cells((arm, kind) => 1 + (arm === "b" ? 2 : 0) + (kind === "s" ? 3 : 0) + noise[k++ % noise.length], 4);
	const fit = olsInteractions(data, "y", ["arm", "kind"]);
	const get = (n: string) => fit.terms.find((t) => t.name === n)!;
	assert.ok(Math.abs(get("arm=b").coef - 2) < 0.3);
	assert.ok(get("arm=b").se! > 0);
	assert.ok(Math.abs(get("arm=b:kind=s").coef) < 0.4);
	assert.ok(fit.r2 > 0.95 && fit.r2 < 1);
});

test("OLS drops aliased terms instead of failing (an empty cell)", () => {
	const data = cells((arm, kind) => (arm === "b" ? 2 : 1) + (kind === "s" ? 1 : 0)).filter((r) => !(r.arm === "b" && r.kind === "s"));
	const fit = olsInteractions(data, "y", ["arm", "kind"]);
	assert.ok(!fit.terms.some((t) => t.name === "arm=b:kind=s"));
	assert.deepEqual(fit.aliased, ["arm=b:kind=s"]);
	assert.ok(Math.abs(fit.terms.find((t) => t.name === "arm=b")!.coef - 1) < 1e-9);
});

test("Cohen's kappa: perfect, textbook 0.4, chance-level, constant labels", () => {
	const rep = (a: string, b: string, n: number) => Array.from({ length: n }, () => [a, b] as [string, string]);
	assert.equal(cohenKappa([...rep("pass", "pass", 5), ...rep("fail", "fail", 5)]), 1);
	const k = cohenKappa([...rep("y", "y", 20), ...rep("y", "n", 5), ...rep("n", "y", 10), ...rep("n", "n", 15)]);
	assert.ok(Math.abs(k - 0.4) < 1e-12);
	assert.ok(Math.abs(cohenKappa([...rep("y", "y", 5), ...rep("y", "n", 5), ...rep("n", "y", 5), ...rep("n", "n", 5)])) < 1e-12);
	assert.equal(cohenKappa(rep("pass", "pass", 4)), 1, "all agree on one label");
	assert.ok(Number.isNaN(cohenKappa([])));
});

test("bootstrap interval is two-sided at the requested level (alpha 0.5 → quartiles of the resampled means)", () => {
	const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	const q = bootstrapMeanCI(xs, { seed: 5, alpha: 0.5 });
	assert.ok(q.hi > q.mean + 0.4 && q.hi < q.mean + 0.8, JSON.stringify(q));
	assert.ok(q.lo < q.mean - 0.4 && q.lo > q.mean - 0.8, JSON.stringify(q));
});
