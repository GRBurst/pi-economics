#!/usr/bin/env node
// pi-bench CLI: run | sched | judge | judge-all | refs | metrics | report
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PAIR, resolvePaths, timeoutSec } from "./config.ts";
import { runJudge, runSingleJudge } from "./judge.ts";
import { sessionMetrics } from "./metrics.ts";
import { makeRefs } from "./refs.ts";
import { writeReport } from "./report.ts";
import { runOne } from "./run.ts";
import type { Task } from "./types.ts";

const USAGE = `usage: pi-bench <command>
  run TASK ARM [REP]              one run (ARM: qwenl | sonnet | orch | orch-<signs> | arms.json); prints result.json
  sched ARM PARALLEL TASK...      each task once, PARALLEL at a time; log in <work>/sched.ARM.log
  judge TASK JUDGE [X Y]          blind pairwise judge (opus | gpt) of runs TASK.X.1 vs TASK.Y.1 (default ${DEFAULT_PAIR.x} ${DEFAULT_PAIR.y})
  judge --all [--judges opus,gpt] [--parallel N] [--min-runs M]
                                  absolute rubric verdict for every run of every task with ≥M runs (default 2);
                                  per-run file judge/TASK/RUN/JUDGE.json, idempotent (skips judged runs)
  judge-all [--once] [X]          pairwise: judge every task whose runs are finished, until all are judged
  refs                            build refs/ (reference patches and answers) from tasks.json
  metrics                         session metrics of every run, one JSON line each
  report [--factors a,b]          bench-report: factor CIs, interactions, judge agreement
environment: PI_BENCH_DATA (~/.pi/agent/bench), PI_BENCH_WORK ($XDG_RUNTIME_DIR/pi/tmp/bench),
  PI_BENCH_EXT_DIR, PI_BENCH_PI (pi binary), BENCH_TIMEOUT (seconds per run, default 5400)`;

/** Run `fn` over `items`, at most `par` at a time. */
export async function pool<T>(items: T[], par: number, fn: (t: T) => Promise<void>): Promise<void> {
	const queue = [...items];
	await Promise.all(Array.from({ length: Math.max(1, par) }, async () => {
		for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
	}));
}

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = () => new Date().toTimeString().slice(0, 8);

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
	const [cmd, ...a] = argv;
	const paths = resolvePaths(env, pkgRoot);
	const piBin = env.PI_BENCH_PI ?? "pi";
	const tasks = (): Record<string, Task> => JSON.parse(readFileSync(join(paths.data, "tasks.json"), "utf8"));
	const task = (id: string) => tasks()[id] ?? (() => { throw new Error(`unknown task: ${id}`); })();
	const runArgs = (id: string, arm: string, rep: number) => ({ id, task: task(id), arm, rep, paths, piBin, env, timeoutSec: timeoutSec(env) });

	switch (cmd) {
		case "run": {
			if (a.length < 2) break;
			console.log(JSON.stringify(await runOne(runArgs(a[0], a[1], Number(a[2] ?? 1)))));
			return 0;
		}
		case "sched": {
			if (a.length < 3) break;
			const [arm, par, ...ids] = a;
			mkdirSync(paths.work, { recursive: true });
			const log = join(paths.work, `sched.${arm}.log`);
			await pool(ids, Number(par), async (id) => {
				appendFileSync(log, `${stamp()} start ${id} ${arm}\n`);
				try { appendFileSync(log, JSON.stringify(await runOne(runArgs(id, arm, 1))) + "\n"); }
				catch (e) { appendFileSync(log, `error ${id}: ${(e as Error).message}\n`); }
				appendFileSync(log, `${stamp()} end ${id} ${arm}\n`);
			});
			appendFileSync(log, `${stamp()} ALL DONE ${arm}\n`);
			return 0;
		}
		case "judge": {
			const flag = (n: string): string | undefined => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
			if (a.includes("--all")) {
				const judges = (flag("--judges") ?? "opus,gpt").split(",").map((s) => s.trim()).filter(Boolean);
				const par = Number(flag("--parallel") ?? 2);
				const minRuns = Number(flag("--min-runs") ?? 2);
				const runsDir = join(paths.data, "runs");
				const byTask = new Map<string, string[]>();
				for (const run of existsSync(runsDir) ? readdirSync(runsDir).sort() : []) {
					const f = join(runsDir, run, "result.json");
					if (!existsSync(f)) continue;
					const id = JSON.parse(readFileSync(f, "utf8")).id;
					if (!Object.keys(tasks()).includes(id)) continue;
					byTask.set(id, [...(byTask.get(id) ?? []), run]);
				}
				const jobs: { id: string; run: string; judge: string }[] = [];
				for (const [id, runs] of [...byTask.entries()].sort())
					if (runs.length >= minRuns)
						for (const run of runs)
							for (const j of judges)
								if (!existsSync(join(paths.data, "judge", id, run, `${j}.json`)))
									jobs.push({ id, run, judge: j });
				if (!jobs.length) { console.log(`nothing to judge (${judges.join(", ")} verdicts on file)`); return 0; }
				await pool(jobs, par, async (job) => {
					try {
						const v = await runSingleJudge({ id: job.id, run: job.run, judge: job.judge, paths, piBin, env });
						console.log(`${stamp()} judged ${job.run} ${job.judge}: ${v.verdict}${v.capped ? " (capped by check)" : ""}`);
					} catch (e) { console.error(`${stamp()} ${job.run}/${job.judge}: ${(e as Error).message}`); }
				});
				return 0;
			}
			if (a.length < 2) break;
			const r = await runJudge({ id: a[0], judge: a[1], x: a[2] ?? DEFAULT_PAIR.x, y: a[3] ?? DEFAULT_PAIR.y, paths, piBin, env });
			console.log(JSON.stringify({ id: a[0], judge: a[1], preference: r.preference, map: r.map, verdicts: Object.fromEntries(Object.entries(r.arms).map(([k, v]) => [k, v.verdict])) }));
			return 0;
		}
		case "judge-all": {
			const once = a.includes("--once");
			const x = a.find((s) => !s.startsWith("--")) ?? DEFAULT_PAIR.x;
			for (;;) {
				let left = 0;
				for (const id of Object.keys(tasks())) {
					const todo = ["opus", "gpt"].filter((j) => !existsSync(join(paths.data, "judge", id, `${j}.json`)));
					if (!todo.length) continue;
					left++;
					if (!existsSync(join(paths.data, "runs", `${id}.${x}.1/result.json`)) || !existsSync(join(paths.data, "runs", `${id}.${DEFAULT_PAIR.y}.1/result.json`))) continue;
					for (const judge of todo) {
						try { await runJudge({ id, judge, x, y: DEFAULT_PAIR.y, paths, piBin, env }); console.log(`${stamp()} judged ${id} ${judge}`); }
						catch (e) { console.error(`${id}/${judge}: ${(e as Error).message}`); }
					}
				}
				if (!left || once) return 0;
				await new Promise((r) => setTimeout(r, 60_000));
			}
		}
		case "refs":
			makeRefs(tasks(), paths.data);
			return 0;
		case "metrics": {
			const runs = join(paths.data, "runs");
			for (const run of existsSync(runs) ? readdirSync(runs).sort() : []) {
				const f = join(runs, run, "result.json");
				const res = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
				console.log(JSON.stringify({ run, ...res, ...sessionMetrics(join(runs, run, "session")) }));
			}
			return 0;
		}
		case "report": {
			const i = a.indexOf("--factors");
			const { md, file } = writeReport(paths, i >= 0 ? a[i + 1].split(",") : undefined);
			console.log(md);
			console.error(`written ${file}`);
			return 0;
		}
	}
	console.error(USAGE);
	return 2;
}

if (import.meta.main) {
	main(process.argv.slice(2), process.env).then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
