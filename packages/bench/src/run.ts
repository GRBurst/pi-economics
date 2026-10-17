import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadArms } from "./config.ts";
import { printArgs } from "./driver-print.ts";
import { runRpc } from "./driver-rpc.ts";
import { needsDevenvShim, runEnv } from "./env.ts";
import { materializeAgentDir } from "./orch.ts";
import { buildPrompt } from "./prompt.ts";
import { runLimited } from "./proc.ts";
import type { Paths, RunResult, Task } from "./types.ts";
import { checkout } from "./workdir.ts";

export type RunOptions = {
	id: string; task: Task; arm: string; rep: number; paths: Paths; piBin: string;
	env: Record<string, string | undefined>; timeoutSec: number; killGraceSec?: number; quietMs?: number;
};

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
const now = () => Math.floor(Date.now() / 1000);

/**
 * One task × arm × rep: fresh checkout, agent (print or rpc driver), harness check, result.json.
 * Results live in `<data>/runs/<id>.<arm>.<rep>`, the checkout in `<work>/runs/<id>.<arm>.<rep>`.
 */
export async function runOne(o: RunOptions): Promise<RunResult> {
	const arm = loadArms(o.paths.data)[o.arm];
	if (!arm) throw new Error(`unknown arm: ${o.arm}`);
	const name = `${o.id}.${o.arm}.${o.rep}`;
	const R = join(o.paths.data, "runs", name);
	const W = join(o.paths.work, "runs", name);
	const work = join(W, "work");
	const tmpDir = join(W, "tmp");
	rmSync(R, { recursive: true, force: true });
	mkdirSync(R, { recursive: true });
	mkdirSync(tmpDir, { recursive: true });
	const baseSha = checkout(o.task, work, o.paths.data);
	const env = runEnv(o.env, o.paths, needsDevenvShim(o.task), tmpDir);
	if (arm.factors) { // orchestrator factor arm: own agent dir, so settings, AGENTS.md and meter/outcome logs are per run
		const agentDir = join(R, "agent");
		materializeAgentDir({ dir: agentDir, arm, paths: o.paths });
		env.PI_CODING_AGENT_DIR = agentDir;
	}
	const prompt = buildPrompt(o.task.kind, o.task.prompt);
	writeFileSync(join(R, "prompt.md"), prompt + "\n");
	const sessionDir = join(R, "session");

	const t0 = now();
	let piexit: number;
	if (arm.driver === "rpc") {
		piexit = await runRpc({
			piBin: o.piBin, arm, paths: o.paths, cwd: work, env, prompt, sessionDir, runDir: R,
			timeoutSec: o.timeoutSec, killGraceSec: o.killGraceSec, quietMs: o.quietMs,
		});
	} else {
		piexit = (await runLimited({
			cmd: o.piBin, args: printArgs(arm, o.paths.extDir, sessionDir, prompt), cwd: work, env,
			stdout: join(R, "final.md"), stderr: join(R, "pi.stderr"),
			timeoutSec: o.timeoutSec, killGraceSec: o.killGraceSec,
		})).code;
	}
	const t1 = now();

	git(work, "add", "-A");
	writeFileSync(join(R, "diff.patch"), git(work, "diff", "--cached", "--binary", "-M", baseSha, "--", ".", ":(exclude).pi", ":(exclude).devenv"));
	const filesChanged = git(work, "diff", "--cached", "--name-only", baseSha, "--", ".", ":(exclude).pi", ":(exclude).devenv").split("\n").filter(Boolean).length;
	let checkExit: number | null = null;
	let t2 = t1;
	if (o.task.check && o.task.kind !== "scout") {
		checkExit = (await runLimited({
			cmd: "bash", args: ["-c", o.task.check], cwd: work, env,
			stdout: join(R, "check.log"), stderr: join(R, "check.err"), timeoutSec: 1500, killGraceSec: o.killGraceSec,
		})).code;
		t2 = now();
	}
	const result: RunResult = {
		id: o.id, arm: o.arm, rep: o.rep, model: arm.model, think: arm.thinking,
		piexit, checkExit, wallSec: t1 - t0, checkSec: t2 - t1, filesChanged, baseSha,
	};
	writeFileSync(join(R, "result.json"), JSON.stringify(result) + "\n");
	return result;
}
