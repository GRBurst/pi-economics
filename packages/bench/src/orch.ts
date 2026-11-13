import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { halfFraction } from "../../experiments/core/design.ts";
import { extensionsOf } from "./extensions.ts";
import type { Factor } from "../../experiments/core/design.ts";
import type { Arm, Paths } from "./types.ts";

/** The factors (README.md, "Orchestrator factor arms"): routing, delegation (handoff + nudge), t0Widened (pilot-derived limits). */
export const FACTORS: Factor[] = [
	{ name: "routing", values: ["off", "on"] },
	{ name: "delegation", values: ["off", "on"] },
	{ name: "t0Widened", values: ["off", "on"] },
];

/** t0Limits per t0Widened level: "off" = the limits before the pilot, "on" = pilot-derived. */
export const T0_LIMITS = { off: { files: 3, tokens: 100000 }, on: { files: 10, tokens: 150000 } };

/**
 * Main session: the flake's extensions a full setup loads (cache-lifecycle/experiments are not part of the bench).
 * The probe is added by the driver; the base extensions come first and the orchestrator's extras (PI_BENCH_ORCH_EXTENSIONS) last.
 */
export const ORCH_EXTENSIONS = ["actor-subagents", "infinite-context", "token-meter", "task-router"];
/** Children (actor-subagents `childExtensions`): the base extensions, the flake's child extensions, the orchestrator's extras; task-router is main only. */
export const CHILD_EXTENSIONS = ["infinite-context", "token-meter"];

/** The 4 arms of the half fraction, `orch-<signs>` (factor order routing, delegation, t0Widened). */
export function orchArms(): Record<string, Arm> {
	return Object.fromEntries(
		halfFraction(FACTORS).map((a) => [
			`orch-${a.id}`,
			{ model: "anthropic/claude-opus-5-5", thinking: "high", driver: "rpc", extensions: [...ORCH_EXTENSIONS], factors: a.flags } satisfies Arm,
		]),
	);
}

/** pi settings of a run; retries are pi's native ones, from the checkout's project settings (RETRY_SETTINGS, workdir.ts). */
const piSettings = () => ({
	defaultThinkingLevel: "high",
	enableInstallTelemetry: false,
	warnings: { anthropicExtraUsage: false },
});

const on = (v: string | undefined) => v !== "off";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Nix's lib.recursiveUpdate: right wins; where both sides hold an object the merge recurses; lists and scalars are replaced whole. */
export function recursiveUpdate(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...left };
	for (const [k, v] of Object.entries(right)) {
		const l = out[k];
		out[k] = isObject(l) && isObject(v) ? recursiveUpdate(l, v) : v;
	}
	return out;
}

/**
 * The router's keys that say which models exist and where to reach them, in its schema and in the legacy forms its
 * loader still maps; `contextFit` too, since the context filter picks among the models by it.
 */
export const ROUTER_MODEL_KEYS: readonly string[] = ["models", "queueMaxSec", "contextFit", "localHealthUrl", "cloudDailyCap", "contextWindow"];

/** The arms run on the models the host configures, never with its randomization or spot checks. */
const SWITCHES_OFF = { randomize: { enabled: false }, spotCheck: { enabled: false } };

function readObject(file: string, what: string): Record<string, unknown> {
	const v: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!isObject(v)) throw new Error(`${what} is not a JSON object: ${file}`);
	return v;
}

/**
 * The base of every orch arm's task-router settings, read at run time (router-extraction design §7.3): the live
 * router settings' (paths.routerLive) model keys with randomize and spotCheck off, {} without that file; the explicit
 * override (paths.router, PI_BENCH_ROUTER) merged over it.
 */
export function routerBase(paths: Pick<Paths, "routerLive" | "router">): Record<string, unknown> {
	const live = existsSync(paths.routerLive) ? readObject(paths.routerLive, "router settings") : undefined;
	const base = live === undefined ? {} : recursiveUpdate(Object.fromEntries(Object.entries(live).filter(([k]) => ROUTER_MODEL_KEYS.includes(k))), SWITCHES_OFF);
	if (paths.router === undefined) return base;
	if (!existsSync(paths.router)) throw new Error(`router base not found: ${paths.router}`);
	return recursiveUpdate(base, readObject(paths.router, "router base"));
}

/**
 * Writes the agent dir of one orchestrator run (PI_CODING_AGENT_DIR): pi settings, task-router and
 * actor-subagents settings from the arm's factors, AGENTS.md (routing on → the new file, off → the old
 * manual rules), infinite-context settings copied from the live setup. Credentials and model definitions
 * are symlinked, never copied (a login extension that seeds auth.json writes through the link). Meter and outcome logs
 * of the run end up in this dir.
 */
export function materializeAgentDir(o: { dir: string; arm: Arm; paths: Paths }): void {
	const { dir, arm, paths } = o;
	const f = arm.factors ?? {};
	const routing = on(f.routing);
	const agents = routing ? paths.agentsOn : paths.agentsOff;
	if (!existsSync(agents)) throw new Error(`AGENTS.md for routing ${routing ? "on" : "off"} not found: ${agents}`);
	const put = (rel: string, content: string) => {
		mkdirSync(join(dir, rel, ".."), { recursive: true });
		writeFileSync(join(dir, rel), content);
	};
	mkdirSync(dir, { recursive: true });
	put("settings.json", JSON.stringify(piSettings(), null, 2) + "\n");
	put("task-router/settings.json", JSON.stringify(recursiveUpdate(routerBase(paths), {
		routing,
		delegation: { nudge: on(f.delegation) ? "on" : "off" },
		t0Limits: T0_LIMITS[on(f.t0Widened) ? "on" : "off"],
	}), null, 2) + "\n");
	put("actor-subagents/settings.json", JSON.stringify({ childExtensions: extensionsOf(CHILD_EXTENSIONS, paths.baseExtensions, paths.orchExtensions).map((n) => `${paths.extDir}/${n}`) }, null, 2) + "\n");
	copyFileSync(agents, join(dir, "AGENTS.md"));
	const ic = join(paths.agentSrc, "infinite-context/settings.json");
	if (existsSync(ic)) {
		mkdirSync(join(dir, "infinite-context"), { recursive: true });
		copyFileSync(ic, join(dir, "infinite-context/settings.json"));
	}
	for (const name of ["auth.json", "models.json", "models-store.json"]) {
		const src = join(paths.agentSrc, name);
		if (!existsSync(src)) continue;
		rmSync(join(dir, name), { force: true });
		symlinkSync(src, join(dir, name));
	}
}
