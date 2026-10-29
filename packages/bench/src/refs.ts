import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Task } from "./types.ts";

/**
 * refs/<id>.patch: the accepted solution (base → last of `refs`, paths relative to `sub`, minus
 * `refExclude`); refs/<id>.md for scouts, copied from tasks/<ref_answer>/ref_answer.md.
 */
export function makeRefs(tasks: Record<string, Task>, dataDir: string): void {
	mkdirSync(join(dataDir, "refs"), { recursive: true });
	for (const [id, t] of Object.entries(tasks)) {
		if (t.kind === "scout") {
			copyFileSync(join(dataDir, "tasks", t.ref_answer ?? id, "ref_answer.md"), join(dataDir, "refs", `${id}.md`));
			continue;
		}
		const last = (t.refs ?? []).at(-1)?.split("..").pop();
		if (!last) throw new Error(`task ${id}: no refs`);
		const sub = t.sub ?? "";
		const pre = sub ? `${sub}/` : "";
		const spec = [sub || ".", ...(t.refExclude ?? []).map((x) => `:(exclude)${pre}${x}`)];
		const args = ["diff", "-M", ...(sub ? [`--relative=${sub}`] : []), t.base, last, "--", ...spec];
		const patch = execFileSync("git", args, { env: { ...process.env, GIT_DIR: t.gitdir }, cwd: homedir(), maxBuffer: 1 << 30 });
		writeFileSync(join(dataDir, "refs", `${id}.patch`), patch);
	}
}
