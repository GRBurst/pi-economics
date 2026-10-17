// Shared fixtures: a private-looking source repo and fake `pi` executables.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const tmp = (): string => mkdtempSync(join(tmpdir(), "pi-bench-test-"));

const git = (cwd: string, ...args: string[]): string =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
	}).trim();

const put = (root: string, files: Record<string, string>) => {
	for (const [f, c] of Object.entries(files)) {
		mkdirSync(dirname(join(root, f)), { recursive: true });
		writeFileSync(join(root, f), c);
	}
};

/** A repo with a `proj/` subdirectory and two commits: base, then next (changes proj/a.txt, adds proj/b.txt). */
export function sourceRepo() {
	const dir = tmp();
	git(dir, "init", "-q");
	put(dir, { "proj/a.txt": "one\n", "proj/keep.txt": "keep\n", "outside.txt": "not in sub\n" });
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const base = git(dir, "rev-parse", "HEAD");
	put(dir, { "proj/a.txt": "two\n", "proj/b.txt": "new\n" });
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "next");
	const next = git(dir, "rev-parse", "HEAD");
	return { dir, gitdir: join(dir, ".git"), base, next };
}

/** An executable script `name` in a fresh dir; returns its path. */
export function script(body: string, name = "pi"): string {
	const dir = tmp();
	const p = join(dir, name);
	writeFileSync(p, body);
	chmodSync(p, 0o755);
	return p;
}

/** A fake print-mode pi: logs argv (one per line) and PATH, edits a file, prints a report. */
export const fakePrintPi = (log: string): string =>
	script(`#!/bin/sh
printf '%s\\n' "$@" > ${log}.args
printf '%s' "$PATH" > ${log}.path
pwd > ${log}.cwd
echo changed > changed.txt
echo "final report"
`);

/** Fake pi: after the prompt it settles; `script` is JS run with helpers emit(), wait(ms), probe(n). */
export function fakeRpcPi(body: string): string {
	return script(`#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.PI_BENCH_PROBE_FILE + ".args", args.join("\\n"));
fs.writeFileSync(process.env.PI_BENCH_PROBE_FILE + ".env", JSON.stringify(process.env));
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const probe = (n) => fs.writeFileSync(process.env.PI_BENCH_PROBE_FILE, JSON.stringify({ settled: true, running: n, ts: Date.now() }));
const say = (t) => emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: t }] } });
let buf = "";
process.stdin.on("data", async (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const cmd = JSON.parse(line);
    if (cmd.type === "prompt") { emit({ type: "response", command: "prompt", success: true }); (async () => { ${body} })(); }
  }
});
process.stdin.on("end", () => process.exit(0));
`);
}
