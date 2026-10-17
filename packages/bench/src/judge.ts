import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runLimited } from "./proc.ts";
import type { Paths, RunResult, Task } from "./types.ts";

export const JUDGES: Record<string, { model: string; thinking: string }> = {
	opus: { model: "anthropic/claude-opus-5-5", thinking: "high" },
	gpt: { model: "openrouter/openai/gpt-5.6-sol", thinking: "high" },
};

// --- blinding ----------------------------------------------------------------------------------

export type BlindMap = { A: string; B: string };

/** Random A/B assignment, drawn once per task and recorded; every judge of the task reuses it. */
export function loadOrCreateMap(file: string, x: string, y: string, rng: () => number = Math.random): BlindMap {
	if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
	const map: BlindMap = rng() < 0.5 ? { A: x, B: y } : { A: y, B: x };
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(map) + "\n");
	return map;
}

// --- rubric ------------------------------------------------------------------------------------

export type Verdict = "pass" | "partial" | "fail";
export type Candidate = {
	correct: number; scope: number; quality: number; verdict: Verdict;
	requirements: { req: string; status: string }[]; notes: string;
};
export type Rubric = { A: Candidate; B: Candidate; preference: "A" | "B" | "tie"; preferenceReason: string };

const VERDICTS = ["pass", "partial", "fail"];

function candidate(c: any): Candidate | null {
	const verdict = typeof c?.verdict === "string" ? c.verdict.toLowerCase() : "";
	if (!VERDICTS.includes(verdict)) return null;
	return {
		correct: Number(c.correct ?? 0), scope: Number(c.scope ?? 0), quality: Number(c.quality ?? 0),
		verdict: verdict as Verdict,
		requirements: Array.isArray(c.requirements) ? c.requirements : [],
		notes: String(c.notes ?? ""),
	};
}

/** The last fenced json block of the judge's answer, validated; null when absent or malformed. */
export function parseVerdicts(text: string): Rubric | null {
	const m = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].pop();
	if (!m) return null;
	let o: any;
	try { o = JSON.parse(m[1]); } catch { return null; }
	const A = candidate(o?.A);
	const B = candidate(o?.B);
	if (!A || !B || !["A", "B", "tie"].includes(o.preference)) return null;
	return { A, B, preference: o.preference, preferenceReason: String(o.preferenceReason ?? "") };
}

/** The last fenced json block of the judge's answer as a single-candidate verdict, validated; null when absent or malformed. */
export function parseSingle(text: string): Candidate | null {
	const m = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].pop();
	if (!m) return null;
	let o: any;
	try { o = JSON.parse(m[1]); } catch { return null; }
	return candidate(o);
}

/** A failing harness check (non-zero exit) caps the verdict at partial. */
export function capVerdict(verdict: Verdict, checkExit: number | null): { verdict: Verdict; capped: boolean } {
	if (verdict === "pass" && checkExit !== null && checkExit !== 0) return { verdict: "partial", capped: true };
	return { verdict, capped: false };
}

export type ArmVerdict = Candidate & { capped: boolean };
export type Judged = { arms: Record<string, ArmVerdict>; preference: string; preferenceReason: string };

/** Map A/B back to arm names, applying the check cap (`checks`: arm → harness check exit). */
export function deblind(map: BlindMap, r: Rubric, checks: Record<string, number | null>): Judged {
	const arms: Record<string, ArmVerdict> = {};
	for (const L of ["A", "B"] as const) {
		const arm = map[L];
		arms[arm] = { ...r[L], ...capVerdict(r[L].verdict, checks[arm] ?? null) };
	}
	return { arms, preference: r.preference === "tie" ? "tie" : map[r.preference], preferenceReason: r.preferenceReason };
}

// --- prompt ------------------------------------------------------------------------------------

type Side = { check: string; report: string; patch: string };

const inl = (text: string, file: string, max: number): string => {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	if (lines.length <= max) return lines.join("\n");
	return [...lines.slice(0, max), `[... truncated: ${lines.length} lines total, full file at ./${file} ...]`].join("\n");
};

export function buildJudgePrompt(o: {
	kind: string; task: string; refNote?: string; reference: { name: string; text: string };
	A: Side; B: Side; maxPatchLines?: number;
}): string {
	const max = o.maxPatchLines ?? 1200;
	const cand = (L: "A" | "B") => `## Candidate ${L}
### ${L}.check.txt
${o[L].check}
### ${L}.report.md
${inl(o[L].report, `${L}.report.md`, 200)}
### ${L}.patch
${inl(o[L].patch, `${L}.patch`, max)}`;
	return `You are a strict, fair code reviewer judging two candidate solutions (A and B) to the same task, produced by two different AI coding agents working non-interactively on a fresh checkout. You do not know which agent produced which.

Files in the current directory: baseline/ (the repository before the change), A.patch, B.patch (full diffs against the baseline), A.report.md / B.report.md (each agent's final report), A.check.txt / B.check.txt (result of the repository's checks run by the harness after the agent finished), and the reference the user actually accepted (reference.patch or reference.md). You may read these files with the read-only tools to verify details. Do not modify anything.

The reference is ONE valid solution, not the only one. A candidate that solves the user's goal equally well or better in a different way passes.${o.refNote ? ` Note on the reference: ${o.refNote}.` : ""}

## Rubric (per candidate)
- correct (0-3): does it achieve what the user asked, and would it actually work?
- requirements: list each explicit requirement of the task and mark met / partial / missing.
- scope (0-2): 2 = no unrelated or harmful edits; 0 = significant unrelated, destructive or risky changes.
- quality (0-3): maintainability, fits repo conventions, tests/checks/docs as the repo expects.
- check: a failing harness check caps the verdict at partial (the harness enforces this after your verdict); say in the notes whether the failure looks related to the candidate's change.
- verdict: pass | partial | fail.  For investigation tasks (no patch expected): judge the answer's correctness, completeness and actionability against the reference; any file modification counts against scope.

## Output
Reason briefly, then end with exactly one fenced json block:
\`\`\`json
{"A":{"correct":0,"scope":0,"quality":0,"verdict":"pass|partial|fail","requirements":[{"req":"...","status":"met|partial|missing"}],"notes":"..."},
 "B":{...same...},
 "preference":"A|B|tie","preferenceReason":"..."}
\`\`\`

## Task given to both agents
${o.task}

## Reference
${inl(o.reference.text, `reference.${o.reference.name === "answer" ? "md" : "patch"}`, 800)}

${cand("A")}

${cand("B")}
`;
}

export function buildSingleJudgePrompt(o: {
	kind: string; task: string; refNote?: string; reference: { name: string; text: string };
	candidate: Side; maxPatchLines?: number;
}): string {
	const max = o.maxPatchLines ?? 1200;
	const ref = o.reference.name === "answer" ? "reference.md" : "reference.patch";
	return `You are a strict, fair code reviewer judging one candidate solution to a task, produced by an AI coding agent working non-interactively on a fresh checkout. You do not know which agent produced it.

Files in the current directory: baseline/ (the repository before the change), candidate.patch (the full diff against the baseline), candidate.report.md (the agent's final report), candidate.check.txt (result of the repository's checks run by the harness after the agent finished), and the reference the user actually accepted (${ref}). You may read these files with the read-only tools to verify details. Do not modify anything.

The reference is ONE valid solution, not the only one. A candidate that solves the user's goal equally well or better in a different way passes.${o.refNote ? ` Note on the reference: ${o.refNote}.` : ""}

## Rubric
- correct (0-3): does it achieve what the user asked, and would it actually work?
- requirements: list each explicit requirement of the task and mark met / partial / missing.
- scope (0-2): 2 = no unrelated or harmful edits; 0 = significant unrelated, destructive or risky changes.
- quality (0-3): maintainability, fits repo conventions, tests/checks/docs as the repo expects.
- check: a failing harness check caps the verdict at partial (the harness enforces this after your verdict); say in the notes whether the failure looks related to the candidate's change.
- verdict: pass | partial | fail.  For investigation tasks (no patch expected): judge the answer's correctness, completeness and actionability against the reference; any file modification counts against scope.

## Output
Reason briefly, then end with exactly one fenced json block:
\`\`\`json
{"correct":0,"scope":0,"quality":0,"verdict":"pass|partial|fail","requirements":[{"req":"...","status":"met|partial|missing"}],"notes":"..."}
\`\`\`

## Task given to the agent
${o.task}

## Reference
${inl(o.reference.text, ref, 800)}

## Candidate
### candidate.check.txt
${o.candidate.check}
### candidate.report.md
${inl(o.candidate.report, "candidate.report.md", 200)}
### candidate.patch
${inl(o.candidate.patch, "candidate.patch", max)}
`;
}

// --- running a judge ---------------------------------------------------------------------------

export type JudgeOptions = {
	id: string; judge: string; x: string; y: string; paths: Paths; piBin: string;
	env: Record<string, string | undefined>; rng?: () => number; timeoutSec?: number;
};

const read = (f: string) => readFileSync(f, "utf8");
const tail = (s: string, n: number) => s.split("\n").slice(-n - 1).join("\n");

/** Candidate files for the judge: baseline checkout, patches, reports, check results, reference. */
function buildPacket(o: JudgeOptions, task: Task, map: BlindMap, pkt: string): Record<"A" | "B", Side> & { checks: Record<string, number | null> } {
	mkdirSync(pkt, { recursive: true });
	const sides = {} as Record<"A" | "B", Side>;
	const checks: Record<string, number | null> = {};
	for (const L of ["A", "B"] as const) {
		const name = `${o.id}.${map[L]}.1`;
		const R = join(o.paths.data, "runs", name);
		const res: RunResult = JSON.parse(read(join(R, "result.json")));
		checks[map[L]] = res.checkExit;
		const logFile = join(R, "check.log");
		const check = [
			`harness check: ${res.checkExit} (exit code; null = no check)`,
			`agent exit: ${res.piexit} (124 = time limit hit)`,
			...(existsSync(logFile) ? [tail(read(logFile), 40)] : []),
		].join("\n");
		const report = read(join(R, "final.md"));
		const patch = read(join(R, "diff.patch"));
		writeFileSync(join(pkt, `${L}.check.txt`), check + "\n");
		writeFileSync(join(pkt, `${L}.report.md`), report);
		writeFileSync(join(pkt, `${L}.patch`), patch);
		sides[L] = { check, report, patch };
	}
	const base = join(pkt, "baseline");
	if (!existsSync(base)) {
		const first = `${o.id}.${map.A}.1`;
		const res: RunResult = JSON.parse(read(join(o.paths.data, "runs", first, "result.json")));
		mkdirSync(base);
		execFileSync("bash", ["-o", "pipefail", "-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "bash", join(o.paths.work, "runs", first, "work"), res.baseSha, base]);
	}
	const refFile = join(o.paths.data, "refs", task.kind === "scout" ? `${o.id}.md` : `${o.id}.patch`);
	writeFileSync(join(pkt, task.kind === "scout" ? "reference.md" : "reference.patch"), read(refFile));
	return { ...sides, checks };
}

/**
 * Blind pairwise judgement of runs `<id>.<x>.1` vs `<id>.<y>.1`: packet and prompt are written
 * under judge/<id>/, the judge reads the prompt from stdin with read-only tools, and the result
 * (de-blinded, check cap applied) lands in judge/<id>/<judge>.json.
 */
export async function runJudge(o: JudgeOptions): Promise<Judged & { map: BlindMap }> {
	const spec = JUDGES[o.judge];
	if (!spec) throw new Error(`unknown judge: ${o.judge}`);
	const tasks: Record<string, Task> = JSON.parse(read(join(o.paths.data, "tasks.json")));
	const task = tasks[o.id];
	if (!task) throw new Error(`unknown task: ${o.id}`);
	const J = join(o.paths.data, "judge", o.id);
	const pkt = join(J, "pkt");
	const map = loadOrCreateMap(join(J, "map.json"), o.x, o.y, o.rng);
	const packet = buildPacket(o, task, map, pkt);
	const refName = task.kind === "scout" ? "answer" : "patch";
	const prompt = buildJudgePrompt({
		kind: task.kind, task: task.prompt, refNote: task.refNote,
		reference: { name: refName, text: read(join(pkt, task.kind === "scout" ? "reference.md" : "reference.patch")) },
		A: packet.A, B: packet.B,
	});
	const promptFile = join(J, `prompt.${o.judge}.md`);
	writeFileSync(promptFile, prompt); // via stdin: an argv over 128 KiB fails
	const verdictFile = join(J, `verdict.${o.judge}.md`);
	const r = await runLimited({
		cmd: o.piBin, cwd: pkt, env: o.env, stdin: promptFile, stdout: verdictFile, stderr: join(J, `stderr.${o.judge}`),
		timeoutSec: o.timeoutSec ?? 1500,
		args: ["-p", "--model", spec.model, "--thinking", spec.thinking, "-ne", "-ns", "-e", `${o.paths.extDir}/claude-auth`,
			"--session-dir", join(J, `sess.${o.judge}`), "--tools", "read,grep,find,ls"],
	});
	const rubric = parseVerdicts(read(verdictFile));
	if (!rubric) throw new Error(`${o.id}/${o.judge}: no valid rubric block in the answer (exit ${r.code})`);
	const judged = deblind(map, rubric, packet.checks);
	writeFileSync(join(J, `${o.judge}.json`), JSON.stringify({ id: o.id, judge: o.judge, map, ...judged }, null, 1) + "\n");
	return { ...judged, map };
}

// --- per-run absolute judging ------------------------------------------------------------------

export type SingleJudgeOptions = {
	id: string; run: string; judge: string; paths: Paths; piBin: string;
	env: Record<string, string | undefined>; timeoutSec?: number;
};

export type SingleJudged = { id: string; run: string; arm: string; rep: number; judge: string } & Candidate & { capped: boolean };

/** `git archive <ref> | tar -x -C <dest>` (ref relative to gitdir, or a checkout via -C). */
const archiveTo = (gitdir: string, ref: string, dest: string) =>
	execFileSync("bash", ["-o", "pipefail", "-c", 'git archive "$1" | tar -x -C "$2"', "bash", ref, dest], { env: { ...process.env, GIT_DIR: gitdir } });

/**
 * Absolute rubric verdict of one run (no counterpart, no arm name anywhere):
 * judge/<id>/pkt-<hash of run>/ is the blind packet and the judge's cwd (candidate.* files, baseline/, reference);
 * judge/<id>/<run>/ holds the prompt, the answer and the de-blinded record <judge>.json (check cap applied).
 */
export async function runSingleJudge(o: SingleJudgeOptions): Promise<SingleJudged> {
	const spec = JUDGES[o.judge];
	if (!spec) throw new Error(`unknown judge: ${o.judge}`);
	const tasks: Record<string, Task> = JSON.parse(read(join(o.paths.data, "tasks.json")));
	const task = tasks[o.id];
	if (!task) throw new Error(`unknown task: ${o.id}`);
	const R = join(o.paths.data, "runs", o.run);
	const res: RunResult = JSON.parse(read(join(R, "result.json")));
	const J = join(o.paths.data, "judge", o.id, o.run);
	// the judge's cwd shows in its tool paths: a hash, never the run name (it carries the arm)
	const pkt = join(o.paths.data, "judge", o.id, `pkt-${createHash("sha1").update(o.run).digest("hex").slice(0, 8)}`);
	mkdirSync(pkt, { recursive: true });
	mkdirSync(J, { recursive: true });
	const logFile = join(R, "check.log");
	const check = [
		`harness check: ${res.checkExit} (exit code; null = no check)`,
		`agent exit: ${res.piexit} (124 = time limit hit)`,
		...(existsSync(logFile) ? [tail(read(logFile), 40)] : []),
	].join("\n");
	writeFileSync(join(pkt, "candidate.check.txt"), check + "\n");
	writeFileSync(join(pkt, "candidate.report.md"), read(join(R, "final.md")));
	writeFileSync(join(pkt, "candidate.patch"), read(join(R, "diff.patch")));
	// baseline: the tmpfs work checkout if it still exists (includes overlays), else the task gitdir
	const base = join(pkt, "baseline");
	if (!existsSync(base)) {
		const W = join(o.paths.work, "runs", o.run, "work");
		mkdirSync(base);
		if (existsSync(join(W, ".git"))) execFileSync("bash", ["-o", "pipefail", "-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "bash", W, res.baseSha, base]);
		else archiveTo(task.gitdir, task.sub ? `${task.base}:${task.sub}` : task.base, base);
	}
	const refName = task.kind === "scout" ? "answer" : "patch";
	writeFileSync(join(pkt, refName === "answer" ? "reference.md" : "reference.patch"), read(join(o.paths.data, "refs", `${o.id}.${refName === "answer" ? "md" : "patch"}`)));
	const prompt = buildSingleJudgePrompt({
		kind: task.kind, task: task.prompt, refNote: task.refNote,
		reference: { name: refName, text: read(join(pkt, refName === "answer" ? "reference.md" : "reference.patch")) },
		candidate: { check, report: read(join(pkt, "candidate.report.md")), patch: read(join(pkt, "candidate.patch")) },
	});
	const promptFile = join(J, `prompt.${o.judge}.md`);
	writeFileSync(promptFile, prompt); // via stdin: an argv over 128 KiB fails
	const verdictFile = join(J, `verdict.${o.judge}.md`);
	const r = await runLimited({
		cmd: o.piBin, cwd: pkt, env: o.env, stdin: promptFile, stdout: verdictFile, stderr: join(J, `stderr.${o.judge}`),
		timeoutSec: o.timeoutSec ?? 1500,
		args: ["-p", "--model", spec.model, "--thinking", spec.thinking, "-ne", "-ns", "-e", `${o.paths.extDir}/claude-auth`,
			"--session-dir", join(J, `sess.${o.judge}`), "--tools", "read,grep,find,ls"],
	});
	const cand = parseSingle(read(verdictFile));
	if (!cand) throw new Error(`${o.run}/${o.judge}: no valid rubric block in the answer (exit ${r.code})`);
	const out: SingleJudged = { id: o.id, run: o.run, arm: res.arm, rep: res.rep, judge: o.judge, ...cand, ...capVerdict(cand.verdict, res.checkExit) };
	writeFileSync(join(J, `${o.judge}.json`), JSON.stringify(out, null, 1) + "\n");
	return out;
}
