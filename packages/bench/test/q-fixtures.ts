// Step Q (spec §7): fixtures for the retired `qwen` arm's old runs and the judge's default pair.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Arm } from "../src/types.ts";
import { fakePrintPi, script, sourceRepo, tmp } from "./helpers.ts";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");

/** `pi-bench <args>` in a child node; the parent environment is kept (see cli.test.ts), `env` wins. */
export const cliRun = (env: Record<string, string>, ...args: string[]): string =>
	execFileSync("node", ["--experimental-strip-types", "--no-warnings", cli, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });

/**
 * The retired arm as an old data dir's `arms.json` defines it again; its model is irrelevant to runs with a fake pi.
 * Old arms name the consumer's own extensions next to the flake's (`auth-ext` stands for a provider login).
 */
export const OLD_QWEN: Arm = { model: "old/qwen", thinking: "xhigh", driver: "print", extensions: ["infinite-context", "auth-ext"] };

export const cand = (verdict: string) => ({ correct: 3, scope: 2, quality: 3, verdict, requirements: [], notes: "" });
const PAIR_ANSWER = "```json\n" + JSON.stringify({ A: cand("pass"), B: cand("partial"), preference: "A", preferenceReason: "r" }) + "\n```";

/**
 * Task `T` with refs and one finished run per arm (`qwen` through `arms.json`), `more` added to the environment;
 * a fake pairwise judge; `args(arm)` is the argv the arm's fake agent got.
 */
export function judgeBench(arms: string[], more: Record<string, string> = {}): {
	data: string; env: Record<string, string>; judged: (judge: string) => string[] | null; args: (arm: string) => string[];
} {
	const repo = sourceRepo();
	const data = tmp();
	const env: Record<string, string> = {
		PI_BENCH_DATA: data, PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext", HOME: tmp(),
		...more,
	};
	writeFileSync(join(data, "tasks.json"), JSON.stringify({ T: { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], prompt: "p", check: "true" } }));
	writeFileSync(join(data, "arms.json"), JSON.stringify({ qwen: OLD_QWEN }));
	const logs = tmp();
	for (const arm of arms) cliRun({ ...env, PI_BENCH_PI: fakePrintPi(join(logs, arm)) }, "run", "T", arm, "1");
	cliRun(env, "refs");
	const judge = script(`#!/bin/sh\ncat >/dev/null\ncat <<'EOF'\n${PAIR_ANSWER}\nEOF\n`);
	const judged = (j: string) => {
		const f = join(data, "judge/T", `${j}.json`);
		return existsSync(f) ? Object.keys(JSON.parse(readFileSync(f, "utf8")).arms).sort() : null;
	};
	const args = (arm: string) => readFileSync(join(logs, `${arm}.args`), "utf8").trim().split("\n");
	return { data, env: { ...env, PI_BENCH_PI: judge }, judged, args };
}
