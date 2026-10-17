// pi-bench probe: tells the RPC driver whether the orchestrator's children are still running.
// Writes $PI_BENCH_PROBE_FILE = {settled, running, ts} on session_start, on every turn boundary and
// every PI_BENCH_PROBE_INTERVAL_MS (default 1000). `running` counts the agents other than main that
// __subagentsApi_v1.list() reports as running (0 when actor-subagents is absent).
import { writeFileSync } from "node:fs";

type Info = { name: string; state: string };
type ProbeApi = { on(event: string, handler: () => void): void };
/** What the probe reads of actor-subagents' globalThis.__subagentsApi_v1; the type check compares it with the provider's SubagentsApiV1 (spec §5.3). */
export type SubagentsApi = { list(): Info[] };

export const countRunning = (agents: Info[]): number =>
	agents.filter((a) => a.name !== "main" && a.state === "running").length;

export default function (pi: ProbeApi) {
	const file = process.env.PI_BENCH_PROBE_FILE;
	if (!file) return;
	let settled = true;
	const write = () => {
		const api = (globalThis as { __subagentsApi_v1?: SubagentsApi }).__subagentsApi_v1;
		let running = 0;
		try {
			running = api ? countRunning(api.list()) : 0;
		} catch {
			return; // engine mid-reload: keep the last sample, it goes stale and blocks "done"
		}
		writeFileSync(file, JSON.stringify({ settled, running, ts: Date.now() }));
	};
	pi.on("session_start", write);
	pi.on("agent_start", () => { settled = false; write(); });
	pi.on("agent_end", () => { settled = true; write(); });
	setInterval(write, Number(process.env.PI_BENCH_PROBE_INTERVAL_MS ?? 1000)).unref();
}
