/**
 * Process-scope levers of a bench arm (redesign §10, M9). A factor named `pi.<lever>` (see PROCESS_SETTINGS) is a pi
 * setting the run's settings.json carries; its level is a number or a boolean. Such an arm also loads the experiments
 * engine, which reads the run's assignment file, and a compaction arm loads no infinite-context unless it adds it
 * (`ic: true`): infinite-context cancels every native compaction (D18), so the lever would do nothing.
 */
import { PROCESS_SETTINGS } from "../../experiments/core/process-levers.ts";
import type { Level } from "../../experiments/core/design.ts";
import type { Arm } from "./types.ts";

export const isPiFactor = (name: string): boolean => name.startsWith("pi.");

/** A level as the factor writes it ("8000", "true"), typed per the lever; an unknown lever or a level of another kind throws. */
export function processLevel(name: string, level: string): Level {
	const spec = PROCESS_SETTINGS[name];
	if (spec === undefined) throw new Error(`unknown pi process lever ${name} (known: ${Object.keys(PROCESS_SETTINGS).join(", ")})`);
	if (spec.kind === "boolean" && (level === "true" || level === "false")) return level === "true";
	if (spec.kind === "tokens" && /^\d+$/.test(level)) return Number(level);
	throw new Error(`${name}: level ${JSON.stringify(level)} is not ${spec.kind === "boolean" ? "true or false" : "a whole number"}`);
}

/** The pi process levers of an arm, with typed levels and the settings path of each. */
export function processLevers(arm: Arm): { id: string; path: readonly string[]; level: Level }[] {
	return Object.entries(arm.factors ?? {}).filter(([n]) => isPiFactor(n)).map(([id, l]) => ({ id, path: PROCESS_SETTINGS[id]?.path ?? [], level: processLevel(id, l) }));
}

export const hasProcessLevers = (arm: Arm): boolean => Object.keys(arm.factors ?? {}).some(isPiFactor);

/** The arm's list of names the main loads, before the base and the extras: a process-lever arm drops infinite-context (unless `ic`) and adds experiments. */
export const withProcess = (names: readonly string[], arm: Arm): string[] =>
	hasProcessLevers(arm) ? [...names.filter((n) => arm.ic === true || n !== "infinite-context"), "experiments"] : [...names];
