import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { Task } from "./types.ts";

/**
 * pi-retry cannot retry in -p mode (its loop is detached after agent_end); native retry with the
 * same policy (fixed 2 s delay, 100 retries) via an untracked project settings file.
 */
export const RETRY_SETTINGS = { retry: { enabled: true, maxRetries: 100, baseDelayMs: 2000, maxAgentDelayMs: 2000 } };

const gitIn = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 }).trim();

/**
 * Fresh checkout of `task.base[:sub]` (git archive, no history) plus overlay and extra files,
 * as a new single-commit repository. Returns the baseline commit.
 */
export function checkout(task: Task, work: string, dataDir: string): string {
	const env = { ...process.env, GIT_DIR: task.gitdir };
	const sub = task.sub ?? "";
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	execFileSync("bash", ["-o", "pipefail", "-c", 'git archive "$1" | tar -x -C "$2"', "bash", sub ? `${task.base}:${sub}` : task.base, work], {
		env,
		cwd: homedir(),
		stdio: ["ignore", "ignore", "inherit"],
	});
	for (const [file, commit] of Object.entries(task.overlay ?? {})) {
		const content = execFileSync("git", ["show", `${commit}:${sub ? `${sub}/${file}` : file}`], { env, cwd: homedir(), maxBuffer: 1 << 30 });
		mkdirSync(dirname(join(work, file)), { recursive: true });
		writeFileSync(join(work, file), content);
	}
	for (const [file, src] of Object.entries(task.extraFiles ?? {})) {
		mkdirSync(dirname(join(work, file)), { recursive: true });
		copyFileSync(isAbsolute(src) ? src : join(dataDir, src), join(work, file));
	}
	gitIn(work, "init", "-q");
	gitIn(work, "config", "commit.gpgsign", "false");
	gitIn(work, "config", "user.email", "bench@local");
	gitIn(work, "config", "user.name", "bench");
	gitIn(work, "add", "-A");
	gitIn(work, "commit", "-qm", `bench baseline (${task.base})`);
	mkdirSync(join(work, ".pi"), { recursive: true });
	writeFileSync(join(work, ".pi/settings.json"), JSON.stringify(RETRY_SETTINGS) + "\n");
	appendFileSync(join(work, ".git/info/exclude"), ".pi/settings.json\n");
	return gitIn(work, "rev-parse", "HEAD");
}
