import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { halfFraction } from "./design.ts";
import type { Factor } from "./design.ts";
import type { Arm, Paths } from "./types.ts";

/** Spec §5.6.5: routing, delegation (handoff + nudge), t0Widened (pilot-derived limits). */
export const FACTORS: Factor[] = [
	{ name: "routing", values: ["off", "on"] },
	{ name: "delegation", values: ["off", "on"] },
	{ name: "t0Widened", values: ["off", "on"] },
];

/** t0Limits per t0Widened level: "off" = the spec defaults, "on" = pilot-derived (T0.3). */
export const T0_LIMITS = { off: { files: 3, tokens: 100000 }, on: { files: 10, tokens: 150000 } };

/** Main session: everything the user's setup loads (cache-lifecycle/experiments are not part of the bench). The probe is added by the driver. */
export const ORCH_EXTENSIONS = ["actor-subagents", "claude-auth", "infinite-context", "pi-retry", "token-meter", "task-router", "web-search"];
/** Children (actor-subagents `childExtensions`): same as ~/.pi/agent/actor-subagents/settings.json; task-router is main only. */
export const CHILD_EXTENSIONS = ["claude-auth", "infinite-context", "pi-retry", "token-meter", "web-search"];

/** The 4 arms of the half fraction, `orch-<signs>` (factor order routing, delegation, t0Widened). */
export function orchArms(): Record<string, Arm> {
	return Object.fromEntries(
		halfFraction(FACTORS).map((a) => [
			`orch-${a.id}`,
			{ model: "anthropic/claude-opus-5-5", thinking: "high", driver: "rpc", extensions: [...ORCH_EXTENSIONS], factors: a.flags } satisfies Arm,
		]),
	);
}

/** pi settings of a run: pi-retry as in the live setup (fixed 2 s, 100 retries, children matched by their system prompt). */
const piSettings = () => ({
	defaultThinkingLevel: "high",
	enableInstallTelemetry: false,
	warnings: { anthropicExtraUsage: false },
	piRetry: {
		baseDelayMs: 2000, maxDelayMs: 2000, multiplier: 1, maxRetriesAtMaxDelay: 100,
		subagents: { match: { systemPromptRegex: [{ flags: "m", pattern: '^You were spawned by "' }] } },
	},
});

const on = (v: string | undefined) => v !== "off";

/**
 * Writes the agent dir of one orchestrator run (PI_CODING_AGENT_DIR): pi settings, task-router and
 * actor-subagents settings from the arm's factors, AGENTS.md (routing on → the new file, off → the old
 * manual rules), infinite-context settings copied from the live setup. Credentials and model definitions
 * are symlinked, never copied (claude-auth seeds auth.json through the link). Meter and outcome logs
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
	put("task-router/settings.json", JSON.stringify({
		routing,
		delegation: { nudge: on(f.delegation) ? "on" : "off" },
		t0Limits: T0_LIMITS[on(f.t0Widened) ? "on" : "off"],
	}, null, 2) + "\n");
	put("actor-subagents/settings.json", JSON.stringify({ childExtensions: CHILD_EXTENSIONS.map((n) => `${paths.extDir}/${n}`) }, null, 2) + "\n");
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
