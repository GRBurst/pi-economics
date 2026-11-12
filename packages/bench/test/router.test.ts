// Spec §7, `router`: the base of every orch arm's task-router/settings.json, merged under the arm's own keys
// as Nix's lib.recursiveUpdate does. The base is read at run time (router-extraction design §7.3): the live
// router settings (<agent source>/task-router/settings.json), their model keys with randomize and spotCheck
// off, and an explicit override (PI_BENCH_ROUTER) merged over that. Neither present, an arm's file is today's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "../src/config.ts";
import { ROUTER_MODEL_KEYS, T0_LIMITS, materializeAgentDir, orchArms, recursiveUpdate, routerBase } from "../src/orch.ts";
import { tmp } from "./helpers.ts";

/**
 * An agent source with both AGENTS.md variants; `router`, when given, is written to a file and exported;
 * `live`, when given, is the agent source's task-router/settings.json.
 */
function paths(router?: unknown, live?: unknown) {
	const home = tmp();
	const src = join(home, ".pi/agent");
	mkdirSync(join(src, "notes"), { recursive: true });
	writeFileSync(join(src, "AGENTS.md"), "on\n");
	writeFileSync(join(src, "notes/2026-10-03-AGENTS.md.before"), "off\n");
	if (live !== undefined) {
		mkdirSync(join(src, "task-router"), { recursive: true });
		writeFileSync(join(src, "task-router/settings.json"), JSON.stringify(live));
	}
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

// The run-time base (router-extraction design §7.3): what the Nix default of bench.router was, read from the
// live router settings instead of taskRouter.settings.

/** The keys that name the models and where to reach them (formerly routerModelKeys in modules/bench.nix). */
const K = ["models", "queueMaxSec", "contextFit", "localHealthUrl", "cloudDailyCap", "contextWindow"];
const OFF = { randomize: { enabled: false }, spotCheck: { enabled: false } };
type Obj = Record<string, unknown>;

/** routerBase over a live file and an override file, each written only when given. */
function base(live?: unknown, override?: unknown): Obj {
	const d = tmp();
	const put = (name: string, v: unknown): string => {
		writeFileSync(join(d, name), JSON.stringify(v));
		return join(d, name);
	};
	return routerBase({
		routerLive: live === undefined ? join(d, "absent.json") : put("live.json", live),
		router: override === undefined ? undefined : put("override.json", override),
	});
}

test("resolvePaths: routerLive is task-router/settings.json under the agent source", () => {
	assert.equal(resolvePaths({ HOME: "/h" }, "/pkg").routerLive, "/h/.pi/agent/task-router/settings.json");
	assert.equal(resolvePaths({ HOME: "/h", PI_BENCH_AGENT_SRC: "/a" }, "/pkg").routerLive, "/a/task-router/settings.json");
});

test("ROUTER_MODEL_KEYS: the router's keys that name the models and where to reach them", () => {
	assert.deepEqual([...ROUTER_MODEL_KEYS], K);
});

/** mulberry32: a seeded generator, so a failing case reproduces. */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Random router settings: model keys and others, the two switches among them, nested values of every JSON kind. */
function settingsGen(r: () => number): () => Obj {
	const one = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	const value = (depth: number): unknown => {
		switch (Math.floor(r() * (depth > 1 ? 4 : 5))) {
			case 0: return Math.floor(r() * 100);
			case 1: return one(["", "llama/q", "http://h:1"]);
			case 2: return r() < 0.5;
			case 3: return [Math.floor(r() * 9), "x"];
			default: return Object.fromEntries(Array.from({ length: Math.floor(r() * 4) }, () => [one(["model", "health", "a", "b"]), value(depth + 1)]));
		}
	};
	const keys = [...K, "randomize", "spotCheck", "mode", "routing", "t0Limits", "profiles"];
	return () => Object.fromEntries(keys.filter(() => r() < 0.5).map((k) => [k, k === "randomize" || k === "spotCheck" ? { enabled: r() < 0.5, share: r() } : value(0)]));
}

test("property: base = pick(live, model keys) ⊕ switches off ⊕ override; no live file: the override alone", () => {
	const r = prng(20261112);
	const gen = settingsGen(r);
	const seen = { noLive: 0, noOverride: 0, both: 0, reEnabled: 0, otherKeys: 0 };
	for (let i = 0; i < 200; i++) {
		const live = r() < 0.15 ? undefined : gen();
		const override = r() < 0.3 ? undefined : gen();
		const pick = live === undefined ? {} : recursiveUpdate(Object.fromEntries(Object.entries(live).filter(([k]) => K.includes(k))), OFF);
		const want = recursiveUpdate(pick, override ?? {});
		assert.deepEqual(base(live, override), want, `case ${i}: live ${JSON.stringify(live)}, override ${JSON.stringify(override)}`);
		if (live === undefined) seen.noLive++;
		if (override === undefined) seen.noOverride++;
		if (live !== undefined && override !== undefined) seen.both++;
		if ((override?.randomize as Obj | undefined)?.enabled === true) seen.reEnabled++;
		if (live !== undefined && Object.keys(live).some((k) => !K.includes(k))) seen.otherKeys++;
	}
	for (const [k, n] of Object.entries(seen)) assert.ok(n >= 10, `the generator covers ${k} (${n} cases)`);
});

test("live base = the former Nix default of bench.router: model keys, switches off; an override replaces one leaf", () => {
	const s = {
		models: { sonnet: { model: "m" } }, localHealthUrl: "http://h:1", queueMaxSec: 5, contextFit: 1, cloudDailyCap: 7,
		contextWindow: { T1: 200000 }, randomize: { enabled: true, share: 0.2 }, spotCheck: { enabled: true, share: 0.1 },
		t0Limits: { files: 3 }, profiles: { x: { ability: "read" } },
	};
	const want = {
		models: { sonnet: { model: "m" } }, localHealthUrl: "http://h:1", queueMaxSec: 5, contextFit: 1, cloudDailyCap: 7,
		contextWindow: { T1: 200000 }, ...OFF,
	};
	assert.deepEqual(base(s), want);
	assert.deepEqual(base(s, { queueMaxSec: 9 }), { ...want, queueMaxSec: 9 }, "a definition replaces one key");
	assert.deepEqual(base({}), OFF, "empty settings: the switches only");
	const models = { "qwen-local": { model: "llama/q", health: "http://h:2" }, "qwen-cloud": { model: "" }, sonnet: { model: "m" } };
	assert.deepEqual(base({ models }, { models: { "qwen-local": { model: "llama/other" } } }).models,
		{ ...models, "qwen-local": { model: "llama/other", health: "http://h:2" } }, "one member's model: the leaf only");
});

test("materializeAgentDir: with live router settings, every arm's file is the run-time base under the arm's keys", () => {
	const live = { models: { w: { model: "m" } }, mode: "local", randomize: { enabled: true, share: 0.2 }, t0Limits: { files: 1, extra: 1 } };
	for (const override of [undefined, { models: { w: { model: "o" } }, spotCheck: { enabled: true } }]) {
		const p = paths(override, live);
		for (const id of Object.keys(orchArms())) {
			const arm = armKeys(id);
			assert.deepEqual(JSON.parse(routerFile(id, p)), {
				models: { w: { model: override === undefined ? "m" : "o" } },
				randomize: { enabled: false },
				spotCheck: { enabled: override !== undefined },
				routing: arm.routing,
				delegation: arm.delegation,
				t0Limits: arm.t0Limits,
			}, `${id}, override ${JSON.stringify(override)}`);
		}
	}
});

test("live router settings that are not a JSON object: an error naming the file", () => {
	assert.throws(() => routerFile("orch----", paths(undefined, [1])), /router settings is not a JSON object: .*task-router\/settings\.json/);
});
