import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DoneTracker, rpcArgs, runRpc } from "../src/driver-rpc.ts";
import { defaultArms, resolvePaths } from "../src/config.ts";
import probe, { countRunning } from "../probe/index.ts";
import { fakeRpcPi, tmp } from "./helpers.ts";

const S = 1000;

// --- done condition: settled ∧ probe.running = 0 ∧ quiet ≥ 30 s -----------------------------

function tracker() {
	const t = new DoneTracker({ quietMs: 30 * S, maxProbeAgeMs: 10 * S });
	return t;
}

test("done needs the NEXT agent_settled after the prompt, not an earlier one", () => {
	const t = tracker();
	t.event("agent_settled", 0); // startup settle, before any prompt
	t.prompted(1 * S);
	t.probe({ running: 0, ts: 100 * S });
	assert.equal(t.isDone(100 * S), false, "no settle since the prompt");
	t.event("agent_settled", 5 * S);
	t.probe({ running: 0, ts: 40 * S });
	assert.equal(t.isDone(40 * S), true);
});

test("done needs probe.running = 0, however long it has been quiet", () => {
	const t = tracker();
	t.prompted(0);
	t.event("agent_settled", 1 * S);
	t.probe({ running: 1, ts: 600 * S });
	assert.equal(t.isDone(600 * S), false, "a child is still running");
	t.probe({ running: 0, ts: 601 * S });
	assert.equal(t.isDone(601 * S), true);
});

test("done needs 30 s without any event; the boundary counts", () => {
	const t = tracker();
	t.prompted(0);
	t.event("agent_settled", 10 * S);
	t.probe({ running: 0, ts: 39 * S });
	assert.equal(t.isDone(39 * S), false, "29 s quiet");
	t.probe({ running: 0, ts: 40 * S });
	assert.equal(t.isDone(40 * S), true, "exactly 30 s quiet");
	t.event("message_update", 41 * S);
	t.probe({ running: 0, ts: 42 * S });
	assert.equal(t.isDone(42 * S), false, "any event restarts the quiet period");
});

test("a new agent_start (a child's reply wakes the orchestrator) un-settles until the next settle", () => {
	const t = tracker();
	t.prompted(0);
	t.event("agent_settled", 1 * S);
	t.event("agent_start", 20 * S);
	t.probe({ running: 0, ts: 100 * S });
	assert.equal(t.isDone(100 * S), false, "running again");
	t.event("agent_settled", 101 * S);
	t.probe({ running: 0, ts: 131 * S });
	assert.equal(t.isDone(131 * S), true);
});

test("no probe sample, or a stale one, is never done", () => {
	const t = tracker();
	t.prompted(0);
	t.event("agent_settled", 1 * S);
	assert.equal(t.isDone(100 * S), false, "no sample");
	t.probe({ running: 0, ts: 50 * S });
	assert.equal(t.isDone(100 * S), false, "sample is 50 s old");
	assert.equal(t.isDone(55 * S), true, "5 s old is fresh");
});

// --- probe extension --------------------------------------------------------------------------

test("countRunning ignores main and counts only running agents", () => {
	assert.equal(countRunning([]), 0);
	assert.equal(countRunning([{ name: "main", state: "running" }, { name: "a", state: "idle" }, { name: "b", state: "paused" }]), 0);
	assert.equal(countRunning([{ name: "main", state: "idle" }, { name: "a", state: "running" }, { name: "b", state: "running" }]), 2);
});

test("probe writes {settled, running, ts} from __subagentsApi_v1.list()", () => {
	const file = join(tmp(), "probe.json");
	const handlers: Record<string, (() => void)[]> = {};
	const g = globalThis as Record<string, unknown>;
	const before = g.__subagentsApi_v1;
	let agents = [{ name: "main", state: "running" }, { name: "kid", state: "running" }];
	g.__subagentsApi_v1 = { version: 1, list: () => agents };
	process.env.PI_BENCH_PROBE_FILE = file;
	process.env.PI_BENCH_PROBE_INTERVAL_MS = "3600000";
	try {
		probe({ on: (e: string, h: () => void) => void (handlers[e] ??= []).push(h) } as never);
		const read = () => JSON.parse(readFileSync(file, "utf8"));
		handlers.session_start?.forEach((h) => h());
		assert.deepEqual({ ...read(), ts: 0 }, { settled: true, running: 1, ts: 0 });
		assert.ok(Math.abs(read().ts - Date.now()) < 5000);
		handlers.agent_start?.forEach((h) => h());
		assert.equal(read().settled, false);
		agents = [{ name: "main", state: "idle" }, { name: "kid", state: "idle" }];
		handlers.agent_end?.forEach((h) => h());
		assert.deepEqual({ ...read(), ts: 0 }, { settled: true, running: 0, ts: 0 });
		delete g.__subagentsApi_v1; // actor-subagents absent: nothing running
		handlers.agent_end?.forEach((h) => h());
		assert.equal(read().running, 0);
	} finally {
		g.__subagentsApi_v1 = before;
		delete process.env.PI_BENCH_PROBE_FILE;
		delete process.env.PI_BENCH_PROBE_INTERVAL_MS;
	}
});

// --- driver against a fake `pi --mode rpc` ---------------------------------------------------

function opts(piBin: string, over: Record<string, unknown> = {}) {
	const runDir = tmp();
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	return {
		piBin, arm: defaultArms().orch, paths, cwd: tmp(), prompt: "go", sessionDir: join(runDir, "session"), runDir,
		env: { PATH: process.env.PATH, PI_BENCH_PROBE_FILE: join(runDir, "probe.json") },
		timeoutSec: 20, killGraceSec: 1, quietMs: 400, pollMs: 40, ...over,
	};
}

test("rpcArgs: rpc mode, explicit extensions plus the probe, session dir", () => {
	const paths = resolvePaths({ HOME: "/h", PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	const a = rpcArgs(defaultArms().orch, paths, "/s");
	assert.deepEqual(a.slice(0, 2), ["--mode", "rpc"]);
	assert.ok(!a.includes("-p"));
	assert.ok(a.join(" ").includes("-e /ext/actor-subagents"));
	assert.ok(a.join(" ").includes("-e /ext/claude-auth"));
	assert.deepEqual(a.slice(-4), ["-e", "/pkg/probe", "--session-dir", "/s"]);
});

test("runRpc waits for a running child after the orchestrator settled, then reports 0", async () => {
	const o = opts(fakeRpcPi(`
		emit({ type: "agent_start" }); probe(1); say("spawned"); emit({ type: "agent_settled" });
		await wait(900); probe(0);               // the child finishes only now
	`));
	const t0 = Date.now();
	const code = await runRpc(o);
	assert.equal(code, 0);
	assert.ok(Date.now() - t0 >= 900 - 50, "waited for the child, not just the quiet period");
	assert.match(readFileSync(join(o.runDir, "final.md"), "utf8"), /spawned/);
	assert.ok(existsSync(join(o.runDir, "events.jsonl")));
	assert.match(readFileSync(o.env.PI_BENCH_PROBE_FILE + ".args", "utf8"), /--mode\nrpc/);
});

test("runRpc takes the answer of the orchestrator's second turn (child reply wakes it)", async () => {
	const o = opts(fakeRpcPi(`
		emit({ type: "agent_start" }); probe(1); say("first"); emit({ type: "agent_settled" });
		await wait(250); probe(0);
		emit({ type: "agent_start" }); say("final answer"); emit({ type: "agent_settled" });
	`));
	assert.equal(await runRpc(o), 0);
	assert.match(readFileSync(join(o.runDir, "final.md"), "utf8"), /final answer/);
});

test("runRpc kills a run that never finishes and reports 124", async () => {
	const o = opts(fakeRpcPi(`emit({ type: "agent_start" }); probe(1);`), { timeoutSec: 1 });
	const t0 = Date.now();
	assert.equal(await runRpc(o), 124);
	assert.ok(Date.now() - t0 < 8000);
});
