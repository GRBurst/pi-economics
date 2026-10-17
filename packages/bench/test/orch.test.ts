// T10.5 orchestrator factor arms: the 2^(3-1) half fraction over routing × delegation × t0Widened, and the
// per-run agent dir that carries each arm's settings, AGENTS.md and the logs of the run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultArms, loadArms, resolvePaths } from "../src/config.ts";
import { halfFraction } from "../src/design.ts";
import { CHILD_EXTENSIONS, FACTORS, ORCH_EXTENSIONS, T0_LIMITS, materializeAgentDir, orchArms } from "../src/orch.ts";
import { runOne } from "../src/run.ts";
import type { Task } from "../src/types.ts";
import { fakeRpcPi, sourceRepo, tmp } from "./helpers.ts";

const ARM_IDS = ["orch----", "orch-+-+", "orch--++", "orch-++-"];

test("halfFraction: x3 = −x1·x2, all-low included, balanced, columns orthogonal", () => {
	const arms = halfFraction(FACTORS);
	assert.deepEqual(arms.map((a) => a.id), ["---", "+-+", "-++", "++-"]);
	assert.equal(arms[0].id, "---", "the all-low (baseline) arm is in the design");
	const sign = (a: (typeof arms)[number], j: number) => (a.id[j] === "+" ? 1 : -1);
	for (const a of arms) assert.equal(sign(a, 2), -sign(a, 0) * sign(a, 1));
	for (let j = 0; j < 3; j++) assert.equal(arms.reduce((s, a) => s + sign(a, j), 0), 0, `factor ${j} balanced`);
	for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) assert.equal(arms.reduce((s, a) => s + sign(a, i) * sign(a, j), 0), 0, `columns ${i},${j} orthogonal`);
	assert.deepEqual(arms[1].flags, { routing: "on", delegation: "off", t0Widened: "on" });
	assert.deepEqual(arms[0].flags, { routing: "off", delegation: "off", t0Widened: "off" });
});

test("orchArms: four rpc arms orch-<signs>, Opus 5.5 high, the bench extension list, factor settings", () => {
	const arms = orchArms();
	assert.deepEqual(Object.keys(arms), ARM_IDS);
	for (const a of Object.values(arms)) {
		assert.equal(a.driver, "rpc");
		assert.equal(a.model, "anthropic/claude-opus-5-5");
		assert.equal(a.thinking, "high");
		assert.deepEqual(a.extensions, ORCH_EXTENSIONS);
	}
	assert.deepEqual(ORCH_EXTENSIONS, ["actor-subagents", "claude-auth", "infinite-context", "pi-retry", "token-meter", "task-router", "web-search"]);
	assert.deepEqual(arms["orch----"].factors, { routing: "off", delegation: "off", t0Widened: "off" });
	assert.deepEqual(arms["orch-++-"].factors, { routing: "on", delegation: "on", t0Widened: "off" });
	assert.deepEqual(arms["orch--++"].factors, { routing: "off", delegation: "on", t0Widened: "on" });
});

test("defaultArms and loadArms include the factor arms next to the existing ones", () => {
	assert.ok(ARM_IDS.every((id) => id in defaultArms()));
	assert.ok("orch" in defaultArms() && "sonnet" in defaultArms());
	assert.ok(ARM_IDS.every((id) => id in loadArms(tmp())));
});

test("children never load task-router or the probe (main only); same list as the live actor-subagents settings", () => {
	assert.deepEqual(CHILD_EXTENSIONS, ["claude-auth", "infinite-context", "pi-retry", "token-meter", "web-search"]);
});

test("paths: agent source, AGENTS.md on/off sources, overridable", () => {
	const p = resolvePaths({ HOME: "/h" }, "/pkg");
	assert.equal(p.agentSrc, "/h/.pi/agent");
	assert.equal(p.agentsOn, "/h/.pi/agent/AGENTS.md");
	assert.equal(p.agentsOff, "/h/.pi/agent/notes/2026-10-03-AGENTS.md.before");
	const q = resolvePaths({ HOME: "/h", PI_BENCH_AGENT_SRC: "/a", PI_BENCH_AGENTS_ON: "/on.md", PI_BENCH_AGENTS_OFF: "/off.md" }, "/pkg");
	assert.deepEqual([q.agentSrc, q.agentsOn, q.agentsOff], ["/a", "/on.md", "/off.md"]);
});

/** A fake ~/.pi/agent with credentials, models, both AGENTS.md variants and infinite-context settings. */
function fakeHome() {
	const home = tmp();
	const src = join(home, ".pi/agent");
	mkdirSync(join(src, "notes"), { recursive: true });
	mkdirSync(join(src, "infinite-context"), { recursive: true });
	writeFileSync(join(src, "auth.json"), '{"anthropic":{"type":"oauth"}}');
	writeFileSync(join(src, "models.json"), '{"providers":{}}');
	writeFileSync(join(src, "AGENTS.md"), "NEW routing rules\n");
	writeFileSync(join(src, "notes/2026-10-03-AGENTS.md.before"), "OLD manual rules\n");
	writeFileSync(join(src, "infinite-context/settings.json"), '{"reminders":{}}');
	return { home, src, paths: resolvePaths({ HOME: home, PI_BENCH_EXT_DIR: "/ext", PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp() }, "/pkg") };
}
const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));

test("materializeAgentDir: task-router settings carry the arm's routing, delegation and t0Limits", () => {
	const { paths } = fakeHome();
	const arms = orchArms();
	const expect: Record<string, [boolean, string, { files: number; tokens: number }]> = {
		"orch----": [false, "off", { files: 3, tokens: 100000 }],
		"orch-+-+": [true, "off", { files: 10, tokens: 150000 }],
		"orch--++": [false, "on", { files: 10, tokens: 150000 }],
		"orch-++-": [true, "on", { files: 3, tokens: 100000 }],
	};
	assert.deepEqual(T0_LIMITS, { off: { files: 3, tokens: 100000 }, on: { files: 10, tokens: 150000 } });
	for (const [id, [routing, nudge, t0Limits]] of Object.entries(expect)) {
		const dir = join(tmp(), "agent");
		materializeAgentDir({ dir, arm: arms[id], paths });
		assert.deepEqual(json(join(dir, "task-router/settings.json")), { routing, delegation: { nudge }, t0Limits }, id);
	}
});

test("materializeAgentDir: AGENTS.md — routing on → the new file, routing off → the old manual rules", () => {
	const { paths } = fakeHome();
	const on = join(tmp(), "agent"), off = join(tmp(), "agent");
	materializeAgentDir({ dir: on, arm: orchArms()["orch-++-"], paths });
	materializeAgentDir({ dir: off, arm: orchArms()["orch----"], paths });
	assert.equal(readFileSync(join(on, "AGENTS.md"), "utf8"), "NEW routing rules\n");
	assert.equal(readFileSync(join(off, "AGENTS.md"), "utf8"), "OLD manual rules\n");
});

test("materializeAgentDir: child extensions, pi-retry incl. the subagent regex, infinite-context settings", () => {
	const { paths } = fakeHome();
	const dir = join(tmp(), "agent");
	materializeAgentDir({ dir, arm: orchArms()["orch-++-"], paths });
	assert.deepEqual(json(join(dir, "actor-subagents/settings.json")), { childExtensions: CHILD_EXTENSIONS.map((n) => `/ext/${n}`) });
	const s = json(join(dir, "settings.json"));
	assert.deepEqual(s.piRetry.subagents.match.systemPromptRegex, [{ flags: "m", pattern: '^You were spawned by "' }]);
	assert.deepEqual([s.piRetry.baseDelayMs, s.piRetry.maxDelayMs, s.piRetry.multiplier, s.piRetry.maxRetriesAtMaxDelay], [2000, 2000, 1, 100]);
	assert.equal(s.packages, undefined, "no packages: extensions come from -e only");
	assert.equal(readFileSync(join(dir, "infinite-context/settings.json"), "utf8"), '{"reminders":{}}');
});

test("materializeAgentDir: credentials and models are linked, never copied (no secrets in the data dir)", () => {
	const { paths, src } = fakeHome();
	const dir = join(tmp(), "agent");
	materializeAgentDir({ dir, arm: orchArms()["orch----"], paths });
	for (const f of ["auth.json", "models.json"]) {
		assert.ok(lstatSync(join(dir, f)).isSymbolicLink(), f);
		assert.equal(readlinkSync(join(dir, f)), join(src, f));
	}
	assert.equal(existsSync(join(dir, "models-store.json")), false, "absent in the source → no dangling link");
});

test("materializeAgentDir: a missing AGENTS.md source is an error naming it; re-running overwrites", () => {
	const { paths, src } = fakeHome();
	const dir = join(tmp(), "agent");
	materializeAgentDir({ dir, arm: orchArms()["orch----"], paths });
	writeFileSync(join(src, "notes/2026-10-03-AGENTS.md.before"), "OLD v2\n");
	materializeAgentDir({ dir, arm: orchArms()["orch----"], paths });
	assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "OLD v2\n");
	const bare = resolvePaths({ HOME: tmp() }, "/pkg");
	assert.throws(() => materializeAgentDir({ dir: join(tmp(), "a"), arm: orchArms()["orch-++-"], paths: bare }), /AGENTS\.md/);
});

// --- runOne with an orchestrator factor arm ------------------------------------------------------

test("runOne: a factor arm gets its own agent dir under the run (PI_CODING_AGENT_DIR), the rest is unchanged", async () => {
	const { paths } = fakeHome();
	const repo = sourceRepo();
	const task: Task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "Change a.txt.", check: "true" };
	const pi = fakeRpcPi(`emit({ type: "agent_start" }); probe(0); say("done"); emit({ type: "agent_settled" });`);
	const res = await runOne({ id: "T1", task, arm: "orch-++-", rep: 1, paths, piBin: pi, env: { PATH: process.env.PATH! }, timeoutSec: 30, killGraceSec: 1, quietMs: 300 });
	const R = join(paths.data, "runs/T1.orch-++-.1");
	assert.equal(res.piexit, 0);
	assert.equal(res.model, "anthropic/claude-opus-5-5");
	assert.equal(res.think, "high");
	const env = json(join(R, "probe.json.env"));
	assert.equal(env.PI_CODING_AGENT_DIR, join(R, "agent"));
	assert.deepEqual(json(join(R, "agent/task-router/settings.json")).delegation, { nudge: "on" });
	assert.equal(readFileSync(join(R, "agent/AGENTS.md"), "utf8"), "NEW routing rules\n");
	const args = readFileSync(join(R, "probe.json.args"), "utf8").split("\n");
	for (const e of ORCH_EXTENSIONS) assert.ok(args.includes(`/ext/${e}`), e);
	assert.ok(args.includes("/pkg/probe"));
	assert.deepEqual(args.slice(args.indexOf("--session-dir")), ["--session-dir", join(R, "session")]);
	assert.ok(readdirSync(join(R, "agent")).includes("settings.json"));
});

test("runOne: arms without factors (print arms, plain orch) get no agent dir and no PI_CODING_AGENT_DIR override", async () => {
	const { paths } = fakeHome();
	const repo = sourceRepo();
	const task: Task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "x", check: null };
	const pi = fakeRpcPi(`emit({ type: "agent_start" }); probe(0); say("done"); emit({ type: "agent_settled" });`);
	await runOne({ id: "T2", task, arm: "orch", rep: 1, paths, piBin: pi, env: { PATH: process.env.PATH!, PI_CODING_AGENT_DIR: "/keep/me" }, timeoutSec: 30, killGraceSec: 1, quietMs: 300 });
	const R = join(paths.data, "runs/T2.orch.1");
	assert.equal(existsSync(join(R, "agent")), false);
	assert.equal(json(join(R, "probe.json.env")).PI_CODING_AGENT_DIR, "/keep/me");
});

// --- report: factor columns for orchestrator arms ------------------------------------------------

test("bench-report: runs of factor arms carry routing/delegation/t0Widened columns for --factors", async () => {
	const { loadRows, buildReport } = await import("../src/report.ts");
	const { paths } = fakeHome();
	const levels: Record<string, [string, string, string]> = {};
	for (const [id, a] of Object.entries(orchArms())) {
		levels[id] = [a.factors!.routing, a.factors!.delegation, a.factors!.t0Widened];
		const R = join(paths.data, "runs", `S1.${id}.1`);
		mkdirSync(R, { recursive: true });
		writeFileSync(join(R, "result.json"), JSON.stringify({ id: "S1", arm: id, rep: 1, model: a.model, think: a.thinking, piexit: 0, checkExit: 0, wallSec: 60, checkSec: 0, filesChanged: 1, baseSha: "x" }));
	}
	const rows = loadRows(paths);
	assert.equal(rows.length, 4);
	for (const r of rows) assert.deepEqual([r.routing, r.delegation, r.t0Widened], levels[r.arm]);
	const rep = buildReport(rows, { factors: ["routing", "delegation", "t0Widened"], iters: 50 });
	assert.deepEqual(rep.factors.map((f) => f.factor), ["routing", "delegation", "t0Widened"]);
	assert.ok(rep.factors.every((f) => f.levels.length === 2 && f.levels.every((l) => l.n === 2)));
});
