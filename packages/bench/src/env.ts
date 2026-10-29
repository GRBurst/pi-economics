import type { Paths, Task } from "./types.ts";

/** The devenv/rustup shims replace the real devenv (blocked by the sandbox) for tasks that check with it. */
export const needsDevenvShim = (task: Task): boolean => /\bdevenv\b/.test(task.check ?? "");

export function runEnv(base: Record<string, string | undefined>, paths: Paths, shim: boolean, tmpDir: string): Record<string, string | undefined> {
	return {
		...base,
		PATH: shim ? `${paths.shimBin}:${base.PATH ?? ""}` : base.PATH,
		XDG_CACHE_HOME: `${paths.work}/cache`,
		XDG_DATA_HOME: `${paths.work}/data`,
		PI_BENCH_WORK: paths.work,
		TMPDIR: tmpDir,
	};
}
