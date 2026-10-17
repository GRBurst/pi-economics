import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { orchArms } from "./orch.ts";
import type { Arm, Paths } from "./types.ts";

type Env = Record<string, string | undefined>;

const printArm = (model: string, thinking: string): Arm => ({
	model,
	thinking,
	driver: "print",
	extensions: ["infinite-context", "claude-auth"],
});

/** claude-auth is required for anthropic models (without it: 400 "out of extra usage"). */
export const defaultArms = (): Record<string, Arm> => ({
	qwen: printArm("openrouter/qwen/qwen3.8-27b:free", "xhigh"),
	qwenl: printArm("llama/qwen3.8", "xhigh"),
	sonnet: printArm("anthropic/claude-sonnet-5-5", "high"),
	orch: {
		model: "anthropic/claude-sonnet-5-5",
		thinking: "medium",
		driver: "rpc",
		extensions: ["infinite-context", "claude-auth", "actor-subagents"],
	},
	...orchArms(),
});

/** Defaults overlaid with `<data>/arms.json` (same shape) when present. */
export function loadArms(dataDir: string): Record<string, Arm> {
	const f = join(dataDir, "arms.json");
	return { ...defaultArms(), ...(existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}) };
}

export function resolvePaths(env: Env, pkgRoot: string): Paths {
	const home = env.HOME ?? "";
	const agentSrc = env.PI_BENCH_AGENT_SRC ?? `${home}/.pi/agent`;
	return {
		data: env.PI_BENCH_DATA ?? `${home}/.pi/agent/bench`,
		work: env.PI_BENCH_WORK ?? `${env.XDG_RUNTIME_DIR ?? "/tmp"}/pi/tmp/bench`,
		extDir: env.PI_BENCH_EXT_DIR ?? `${home}/.pi/agent/extensions`,
		probeExt: `${pkgRoot}/probe`,
		shimBin: `${pkgRoot}/bin`,
		agentSrc,
		agentsOn: env.PI_BENCH_AGENTS_ON ?? `${agentSrc}/AGENTS.md`,
		agentsOff: env.PI_BENCH_AGENTS_OFF ?? `${agentSrc}/notes/2026-10-03-AGENTS.md.before`,
	};
}

/** Per-run limit; the pilot's 2700 s default was a bug (long tasks were cut off). */
export const timeoutSec = (env: Env): number => Number(env.BENCH_TIMEOUT ?? 5400);
