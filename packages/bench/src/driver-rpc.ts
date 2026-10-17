import { spawn } from "node:child_process";
import { closeSync, createWriteStream, openSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { Arm, Paths } from "./types.ts";

/**
 * "Done" for an orchestrator run: the orchestrator settled (the NEXT agent_settled after the
 * prompt), no child runs (fresh probe sample with running = 0) and nothing happened on the RPC
 * stream for `quietMs`. A child's reply that wakes the orchestrator un-settles it again.
 * Times are plain millisecond numbers so the rule is testable without a clock.
 */
export class DoneTracker {
	private quietMs: number;
	private maxProbeAgeMs: number;
	private prompt: number | undefined;
	private settled = false;
	private lastEvent = 0;
	private sample: { running: number; ts: number } | undefined;

	constructor(o: { quietMs?: number; maxProbeAgeMs?: number } = {}) {
		this.quietMs = o.quietMs ?? 30_000;
		this.maxProbeAgeMs = o.maxProbeAgeMs ?? 10_000;
	}
	prompted(now: number) {
		this.prompt = now;
		this.settled = false;
		this.lastEvent = now;
	}
	event(type: string, now: number) {
		this.lastEvent = now;
		if (this.prompt === undefined) return;
		if (type === "agent_start") this.settled = false;
		if (type === "agent_settled") this.settled = true;
	}
	probe(s: { running: number; ts: number }) {
		this.sample = s;
	}
	isDone(now: number): boolean {
		if (this.prompt === undefined || !this.settled || !this.sample) return false;
		return this.sample.running === 0 && now - this.sample.ts <= this.maxProbeAgeMs && now - this.lastEvent >= this.quietMs;
	}
}

/** `pi --mode rpc` with the explicit extension list plus the probe. */
export const rpcArgs = (arm: Arm, paths: Paths, sessionDir: string): string[] => [
	"--mode", "rpc", "--model", arm.model, "--thinking", arm.thinking, "-ne", "--approve",
	...arm.extensions.flatMap((e) => ["-e", `${paths.extDir}/${e}`]),
	"-e", paths.probeExt, "--session-dir", sessionDir,
];

export type RpcOptions = {
	piBin: string; arm: Arm; paths: Paths; cwd: string; env: Record<string, string | undefined>;
	prompt: string; sessionDir: string; runDir: string; timeoutSec: number;
	killGraceSec?: number; quietMs?: number; pollMs?: number;
};

const textOf = (m: { content?: { type: string; text?: string }[] }) =>
	(m.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");

/**
 * Drive one prompt through `pi --mode rpc` until DoneTracker says done. Logs events (minus
 * streaming deltas) to events.jsonl, writes the last assistant text to final.md. Returns 0 when
 * done, 124 on timeout, else pi's own exit code when it exited early.
 */
export function runRpc(o: RpcOptions): Promise<number> {
	const probeFile = join(o.runDir, "probe.json");
	const errFd = openSync(join(o.runDir, "pi.stderr"), "w");
	const events = createWriteStream(join(o.runDir, "events.jsonl"));
	const env = { ...o.env, PI_BENCH_PROBE_FILE: probeFile } as NodeJS.ProcessEnv;
	const child = spawn(o.piBin, rpcArgs(o.arm, o.paths, o.sessionDir), { cwd: o.cwd, env, detached: true, stdio: ["pipe", "pipe", errFd] });
	const tracker = new DoneTracker({ quietMs: o.quietMs });
	let last = "";
	createInterface({ input: child.stdout! }).on("line", (l) => {
		let ev: { type?: string; message?: { role?: string; content?: { type: string; text?: string }[] } };
		try { ev = JSON.parse(l); } catch { return; }
		tracker.event(ev.type ?? "", Date.now());
		if (ev.type === "message_end" && ev.message?.role === "assistant") last = textOf(ev.message) || last;
		if (ev.type !== "message_update" && ev.type !== "tool_execution_update") events.write(l + "\n");
	});
	const group = (sig: NodeJS.Signals) => { try { process.kill(-child.pid!, sig); } catch {} };
	return new Promise((resolve) => {
		let verdict: number | undefined;
		let poll: ReturnType<typeof setInterval> | undefined;
		let finished = false;
		const finish = (code: number) => {
			if (finished) return;
			finished = true;
			clearInterval(poll); clearTimeout(limit);
			writeFileSync(join(o.runDir, "final.md"), last + "\n");
			events.end(); closeSync(errFd);
			resolve(verdict ?? code);
		};
		const stop = (v: number) => {
			if (verdict !== undefined) return;
			verdict = v;
			clearInterval(poll);
			child.stdin!.end();
			group("SIGTERM");
			setTimeout(() => group("SIGKILL"), (o.killGraceSec ?? 30) * 1000).unref();
		};
		const limit = setTimeout(() => stop(124), o.timeoutSec * 1000);
		child.on("error", () => finish(127));
		child.on("close", (code) => finish(code ?? 1));
		child.stdin!.on("error", () => {});
		tracker.prompted(Date.now());
		child.stdin!.write(JSON.stringify({ type: "prompt", message: o.prompt }) + "\n");
		poll = setInterval(() => {
			try {
				const s = JSON.parse(readFileSync(probeFile, "utf8"));
				if (typeof s.running === "number" && typeof s.ts === "number") tracker.probe({ running: s.running, ts: s.ts });
			} catch {}
			if (tracker.isDone(Date.now())) stop(0);
		}, o.pollMs ?? 1000);
	});
}
