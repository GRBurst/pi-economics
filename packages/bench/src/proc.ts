import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";

export type Limited = { code: number; timedOut: boolean };

/**
 * Run a command with stdout/stderr to files and a wall-clock limit (SIGTERM, then SIGKILL after
 * `killGraceSec`, to the whole process group). A timeout reports 124 like timeout(1).
 */
export function runLimited(o: {
	cmd: string; args: string[]; cwd: string; env: Record<string, string | undefined>;
	stdout: string; stderr: string; timeoutSec: number; killGraceSec?: number; stdin?: string;
}): Promise<Limited> {
	const out = openSync(o.stdout, "w");
	const err = openSync(o.stderr, "w");
	const inFd = o.stdin ? openSync(o.stdin, "r") : undefined;
	return new Promise((resolve) => {
		const child = spawn(o.cmd, o.args, {
			cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, detached: true,
			stdio: [inFd ?? "ignore", out, err],
		});
		let timedOut = false;
		const group = (sig: NodeJS.Signals) => { try { process.kill(-child.pid!, sig); } catch {} };
		const t1 = setTimeout(() => {
			timedOut = true;
			group("SIGTERM");
			setTimeout(() => group("SIGKILL"), (o.killGraceSec ?? 30) * 1000).unref();
		}, o.timeoutSec * 1000);
		let finished = false;
		const finish = (code: number) => {
			if (finished) return;
			finished = true;
			clearTimeout(t1);
			closeSync(out); closeSync(err); if (inFd !== undefined) closeSync(inFd);
			resolve({ code: timedOut ? 124 : code, timedOut });
		};
		child.on("error", () => finish(127));
		child.on("close", (code, sig) => finish(code ?? (sig ? 128 : 1)));
	});
}
