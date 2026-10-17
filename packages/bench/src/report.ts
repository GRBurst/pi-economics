import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadArms } from "./config.ts";
import { deblind, JUDGES, parseVerdicts, type Verdict } from "./judge.ts";
import { sessionMetrics } from "./metrics.ts";
import { BOOTSTRAP_ITERS, bootstrapDiffCI, bootstrapMeanCI, cohenKappa, olsInteractions, type CI, type Fit } from "./stats.ts";
import type { Paths, RunResult, Task } from "./types.ts";

export type Row = {
	run: string; id: string; kind: string; arm: string; rep: number;
	piexit: number; checkExit: number | null; wallMin: number; files: number;
	req: number; r429: number; peakCtxK: number; folds: number; costUsd: number;
	verdicts: Record<string, Verdict>;
	pass?: number; // share of judges that say pass
	score?: number; // pass 1, partial 0.5, fail 0, averaged over judges
	[factor: string]: unknown; // the arm's factor levels (routing, delegation, t0Widened) for orchestrator arms
};

const SCORE: Record<Verdict, number> = { pass: 1, partial: 0.5, fail: 0 };
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const readJson = (f: string) => JSON.parse(readFileSync(f, "utf8"));

/** Verdict per arm for one task and judge: judge/<id>/<judge>.json, or the pilot's verdict.<judge>.md + map.json. */
function judged(paths: Paths, id: string, judge: string, checks: Record<string, number | null>): Record<string, Verdict> {
	const J = join(paths.data, "judge", id);
	const json = join(J, `${judge}.json`);
	if (existsSync(json)) return Object.fromEntries(Object.entries(readJson(json).arms as Record<string, { verdict: Verdict }>).map(([a, v]) => [a, v.verdict]));
	const md = join(J, `verdict.${judge}.md`);
	const map = join(J, "map.json");
	if (!existsSync(md) || !existsSync(map)) return {};
	const rubric = parseVerdicts(readFileSync(md, "utf8"));
	if (!rubric) return {};
	return Object.fromEntries(Object.entries(deblind(readJson(map), rubric, checks).arms).map(([a, v]) => [a, v.verdict]));
}

/** One row per run: result.json + session metrics + task kind + judge verdicts (per-run layout: every rep; pairwise/pilot layouts: first repetition). */
export function loadRows(paths: Paths): Row[] {
	const tasks: Record<string, Task> = existsSync(join(paths.data, "tasks.json")) ? readJson(join(paths.data, "tasks.json")) : {};
	const runsDir = join(paths.data, "runs");
	if (!existsSync(runsDir)) return [];
	const results = readdirSync(runsDir).sort().flatMap((run): [string, RunResult][] => {
		const f = join(runsDir, run, "result.json");
		return existsSync(f) ? [[run, readJson(f)]] : [];
	});
	const checks = (id: string) => Object.fromEntries(results.filter(([, r]) => r.id === id && r.rep === 1).map(([, r]) => [r.arm, r.checkExit]));
	const arms = loadArms(paths.data);
	const verdictCache = new Map<string, Record<string, Record<string, Verdict>>>();
	const verdictsOf = (id: string) => {
		if (!verdictCache.has(id)) verdictCache.set(id, Object.fromEntries(Object.keys(JUDGES).map((j) => [j, judged(paths, id, j, checks(id))])));
		return verdictCache.get(id)!;
	};
	// multi-arm layout: judge/<id>/<run>/<judge>.json (de-blinded, cap already applied) — wins over the pairwise records
	const perRun = (id: string, run: string, judge: string): Verdict | undefined => {
		const f = join(paths.data, "judge", id, run, `${judge}.json`);
		return existsSync(f) ? readJson(f).verdict : undefined;
	};
	return results.map(([run, r]) => {
		const m = sessionMetrics(join(runsDir, run, "session"));
		const verdicts: Record<string, Verdict> = {};
		for (const j of Object.keys(JUDGES)) {
			const v = perRun(r.id, run, j) ?? (r.rep === 1 ? verdictsOf(r.id)[j][r.arm] : undefined);
			if (v) verdicts[j] = v;
		}
		const vs = Object.values(verdicts);
		return {
			...(arms[r.arm]?.factors ?? {}),
			run, id: r.id, kind: tasks[r.id]?.kind ?? "?", arm: r.arm, rep: r.rep,
			piexit: r.piexit, checkExit: r.checkExit, wallMin: r.wallSec / 60, files: r.filesChanged,
			req: m.req, r429: m.req ? m.errors / m.req : 0, peakCtxK: m.peakCtx / 1000, folds: m.folds, costUsd: m.costUsd,
			verdicts,
			...(vs.length ? { pass: mean(vs.map((v) => (v === "pass" ? 1 : 0))), score: mean(vs.map((v) => SCORE[v])) } : {}),
		};
	});
}

export type Agreement = { judges: [string, string]; n: number; agree: number; kappa: number };

/** Per-candidate agreement of two judges' verdicts (pass/partial/fail). */
export function agreement(rows: Row[], a: string, b: string): Agreement {
	const pairs = rows.flatMap((r): [string, string][] => (r.verdicts[a] && r.verdicts[b] ? [[r.verdicts[a], r.verdicts[b]]] : []));
	return { judges: [a, b], n: pairs.length, agree: pairs.filter(([x, y]) => x === y).length, kappa: cohenKappa(pairs) };
}

// --- statistics ----------------------------------------------------------------------------------

export const METRICS = ["pass", "score", "wallMin", "req", "r429", "peakCtxK", "costUsd"] as const;
export type Metric = (typeof METRICS)[number];
const CONTRAST: Metric[] = ["pass", "score", "wallMin", "costUsd"];

export type LevelStats = { level: string; n: number; metrics: Record<Metric, CI> };
export type Contrast = { level: string; vs: string } & Record<"pass" | "score" | "wallMin" | "costUsd", CI>;
export type FactorStats = { factor: string; levels: LevelStats[]; contrasts: Contrast[] };
export type Report = { iters: number; n: number; factors: FactorStats[]; ols: Fit & { outcome: string; factors: string[] }; agreement: Agreement };

const values = (rows: Row[], m: Metric): number[] => rows.flatMap((r) => (typeof r[m] === "number" ? [r[m] as number] : []));

export function buildReport(rows: Row[], o: { factors?: string[]; seed?: number; iters?: number } = {}): Report {
	const factors = o.factors ?? ["arm", "kind"];
	const opts = { seed: o.seed ?? 1, iters: o.iters ?? BOOTSTRAP_ITERS };
	const by = (f: string, level: string) => rows.filter((r) => String((r as any)[f]) === level);
	const stats: FactorStats[] = factors.map((f) => {
		const levels = [...new Set(rows.map((r) => String((r as any)[f])))].sort();
		const lv = levels.map((level) => {
			const g = by(f, level);
			return { level, n: g.length, metrics: Object.fromEntries(METRICS.map((m) => [m, bootstrapMeanCI(values(g, m), opts)])) as Record<Metric, CI> };
		});
		const contrasts = levels.slice(1).map((level) => ({
			level, vs: levels[0],
			...Object.fromEntries(CONTRAST.map((m) => [m, bootstrapDiffCI(values(by(f, level), m), values(by(f, levels[0]), m), opts)])),
		})) as Contrast[];
		return { factor: f, levels: lv, contrasts };
	});
	const judgedRows = rows.filter((r) => r.score !== undefined);
	const fit = olsInteractions(judgedRows, "score", factors);
	const [ja, jb] = Object.keys(JUDGES);
	return { iters: opts.iters, n: rows.length, factors: stats, ols: { ...fit, outcome: "score", factors }, agreement: agreement(rows, ja, jb) };
}

// --- markdown ------------------------------------------------------------------------------------

const f2 = (x: number) => (Number.isNaN(x) ? "–" : (Math.round(x * 100) / 100).toString());
const ci = (c: CI) => (c.n === 0 ? "–" : `${f2(c.mean)} [${f2(c.lo)}, ${f2(c.hi)}]`);

export function renderReport(r: Report): string {
	const out = [`# Bench report`, "", `${r.n} runs. Cells: mean [95% CI] (percentile bootstrap, ${r.iters} resamples). pass = share of judges saying pass; score = pass 1 / partial 0.5 / fail 0; a failing harness check caps pass at partial.`, ""];
	for (const f of r.factors) {
		out.push(`## ${f.factor}`, "", "| level | n | pass | score | wall min | requests | 429 share | peak ctx k | $ |", "|---|---|---|---|---|---|---|---|---|");
		for (const l of f.levels) out.push(`| ${l.level} | ${l.n} | ${METRICS.map((m) => ci(l.metrics[m])).join(" | ")} |`);
		if (f.contrasts.length) {
			out.push("", `Difference to ${f.contrasts[0].vs} (mean [95% CI]):`, "", "| level | pass | score | wall min | $ |", "|---|---|---|---|---|");
			for (const c of f.contrasts) out.push(`| ${c.level} | ${CONTRAST.map((m) => ci(c[m])).join(" | ")} |`);
		}
		out.push("");
	}
	out.push("## Interactions", "", `OLS of ${r.ols.outcome} on ${r.ols.factors.join(" × ")} with two-way interactions (baseline = first level alphabetically). n = ${r.ols.n}, residual df = ${r.ols.df}, R² = ${f2(r.ols.r2)}.`, "", "| term | coef | se |", "|---|---|---|");
	for (const t of r.ols.terms) out.push(`| ${t.name} | ${f2(t.coef)} | ${t.se === null ? "–" : f2(t.se)} |`);
	if (r.ols.aliased.length) out.push("", `Not estimable (empty cells): ${r.ols.aliased.join(", ")}.`);
	const a = r.agreement;
	out.push("", "## Judge agreement", "", `${a.judges[0]} vs ${a.judges[1]}: ${a.agree}/${a.n} candidates agree, Cohen's κ = ${f2(a.kappa)}.`, "");
	return out.join("\n");
}

/** Build, render and store reports/<stamp>.md; returns the markdown. */
export function writeReport(paths: Paths, factors?: string[], stamp = new Date().toISOString().replace(/[:.]/g, "-")): { md: string; file: string } {
	const md = renderReport(buildReport(loadRows(paths), { factors }));
	mkdirSync(join(paths.data, "reports"), { recursive: true });
	const file = join(paths.data, "reports", `${stamp}.md`);
	writeFileSync(file, md);
	return { md, file };
}
