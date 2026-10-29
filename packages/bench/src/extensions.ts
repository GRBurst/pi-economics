/**
 * The extensions of a run. The bench names only the flake's own extensions (an arm's list, the orchestrator's and
 * its children's lists); the consumer's own come in through two lists of names under the extension directory:
 * PI_BENCH_BASE_EXTENSIONS, loaded by every run (every arm, the factor arms' children, every judge), such as a
 * provider login, and PI_BENCH_ORCH_EXTENSIONS, loaded by the orchestrator factor arms and their children only, such
 * as a search tool.
 */
import type { Arm, Paths } from "./types.ts";

/** A list variable: comma-separated names, entries trimmed, empty ones dropped; unset is none. */
export const parseList = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * The load order: the base names first (a provider login before the rest), then the list's own names, then the
 * extras; the first occurrence of a name wins, so an old arm that names a base extension loads it once.
 */
export const extensionsOf = (own: readonly string[], base: readonly string[], extra: readonly string[] = []): string[] =>
	[...new Set([...base, ...own, ...extra])];

/** An arm's extensions: an orchestrator factor arm (one with `factors`) also loads the orchestrator's extras. */
export const armExtensions = (arm: Arm, paths: Pick<Paths, "baseExtensions" | "orchExtensions">): string[] =>
	extensionsOf(arm.extensions, paths.baseExtensions, arm.factors ? paths.orchExtensions : []);

/** `-e <extDir>/<name>` per name. */
export const extArgs = (names: readonly string[], extDir: string): string[] => names.flatMap((e) => ["-e", `${extDir}/${e}`]);
