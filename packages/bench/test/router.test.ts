// Spec §7, `router`: the base of every orch arm's task-router/settings.json (PI_BENCH_ROUTER), merged
// under the arm's own keys as Nix's lib.recursiveUpdate does. Unset or {}, an arm's file is today's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "../src/config.ts";
import { T0_LIMITS, materializeAgentDir, orchArms, recursiveUpdate } from "../src/orch.ts";
import { tmp } from "./helpers.ts";

/** An agent source with both AGENTS.md variants; `router`, when given, is written to a file and exported. */
function paths(router?: unknown) {
	const home = tmp();
	const src = join(home, ".pi/agent");
	mkdirSync(join(src, "notes"), { recursive: true });
	writeFileSync(join(src, "AGENTS.md"), "on\n");
	writeFileSync(join(src, "notes/2026-10-03-AGENTS.md.before"), "off\n");
	const env: Record<string, string> = { HOME: home, PI_BENCH_EXT_DIR: "/ext", PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp() };
	if (router !== undefined) {
		env.PI_BENCH_ROUTER = join(tmp(), "router.json");
		writeFileSync(env.PI_BENCH_ROUTER, JSON.stringify(router));
	}
	return resolvePaths(env, "/pkg");
}

/** The task-router settings file an arm writes. */
function routerFile(id: string, p: ReturnType<typeof paths>): string {
	const dir = join(tmp(), "agent");
	materializeAgentDir({ dir, arm: orchArms()[id], paths: p });
	return readFileSync(join(dir, "task-router/settings.json"), "utf8");
}

/** The arm's own keys, as the writer at host f6a3c81 (orch.ts:64-68) put them. */
function armKeys(id: string) {
	const f = orchArms()[id].factors!;
	return { routing: f.routing === "on", delegation: { nudge: f.delegation }, t0Limits: T0_LIMITS[f.t0Widened as "off" | "on"] };
}

test("resolvePaths: PI_BENCH_ROUTER names the router base; unset, there is none", () => {
	assert.equal(resolvePaths({ HOME: "/h" }, "/pkg").router, undefined);
	assert.equal(resolvePaths({ HOME: "/h", PI_BENCH_ROUTER: "/r.json" }, "/pkg").router, "/r.json");
});

test("router unset or {}: every arm's task-router/settings.json is today's, byte for byte", () => {
	for (const id of Object.keys(orchArms())) {
		const today = JSON.stringify(armKeys(id), null, 2) + "\n";
		assert.equal(routerFile(id, paths()), today, `${id}, unset`);
		assert.equal(routerFile(id, paths({})), today, `${id}, {}`);
	}
});

test("router base: merged under the arm's keys, deeply; base keys the arm does not set survive", () => {
	const base = {
		models: { worker: "m1", local: "m2" },
		localHealthUrl: "http://h:1",
		routing: true,
		delegation: { nudge: "x", handoff: true },
		t0Limits: { files: 99, extra: 1 },
		randomize: { enabled: false },
	};
	for (const id of Object.keys(orchArms())) {
		const got = JSON.parse(routerFile(id, paths(base)));
		const arm = armKeys(id);
		assert.deepEqual(got, {
			models: base.models,
			localHealthUrl: base.localHealthUrl,
			routing: arm.routing,
			delegation: { nudge: arm.delegation.nudge, handoff: true },
			t0Limits: { ...arm.t0Limits, extra: 1 },
			randomize: base.randomize,
		}, id);
	}
});

test("recursiveUpdate: right wins; objects recurse; lists and scalars are replaced whole; left's key order", () => {
	assert.deepEqual(recursiveUpdate({ a: [1, 2], b: { c: 1, d: 2 }, e: { f: 1 }, g: 1 }, { a: [3], b: { c: 9 }, e: 5, h: { i: 1 } }),
		{ a: [3], b: { c: 9, d: 2 }, e: 5, g: 1, h: { i: 1 } });
	assert.deepEqual(Object.keys(recursiveUpdate({ z: 1, a: 1 }, { m: 1, z: 2 })), ["z", "a", "m"]);
	assert.deepEqual(Object.keys(recursiveUpdate({}, { z: 1, a: 1 })), ["z", "a"]);
});

test("router base: a missing file or a non-object is an error naming the file", () => {
	const missing = { ...paths(), router: "/nonexistent/router.json" };
	assert.throws(() => routerFile("orch----", missing), /router base not found: \/nonexistent\/router\.json/);
	const list = paths([1]);
	assert.throws(() => routerFile("orch----", list), /router base is not a JSON object: .*router\.json/);
});
