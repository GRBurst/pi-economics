// The merge gate's pipeline (design §3.4.2; plan S26): `request_merge` resolves the branch, refuses what must not merge
// (cheap and deterministic first), runs the checks and the red run, reviews through the overseer (Opus last), then
// fast-forwards main. Every git call goes through the port (core/local/git.ts), so a failure is a value, never an exception.
import type { Runner } from "../gate.ts";
import type { RouterSettings } from "../types.ts";
import type { BranchRecord, BranchStore } from "./branches.ts";
import type { Git, Stat } from "./git.ts";
import type { createOverseer } from "./overseer.ts";
import { refreshFacts } from "./worktree.ts";

export const REASONS = ["main-branch", "dirty", "behind", "fixer-running", "abandoned", "blocked", "size", "scope",
  "check", "main-dirty", "plan-changed", "no-worktree", "review-unavailable", "aborted", "git"] as const;
export type MergeReason = (typeof REASONS)[number];
export type MergeStatus = "merged" | "refused" | "revise" | "fixer" | "error";
export type MergeResult = { status: MergeStatus; reason?: MergeReason; detail: string;
  commit?: string; reviewId?: string; findings?: string[]; pushed?: boolean };
export type Facts = { isMain: boolean; state: BranchRecord["state"] | undefined; dirty: boolean; behind: boolean };

/** Step 2, in the fixed order of S26. */
export const refusal = (f: Facts): MergeReason | undefined =>
  f.isMain ? "main-branch" : f.state === "abandoned" ? "abandoned" : f.state === "blocked" ? "blocked"
  : f.state === "fixer" ? "fixer-running" : f.dirty ? "dirty" : f.behind ? "behind" : undefined;

/** Step 3: the lines (added + deleted) and files of a numstat; a plan file whose change is tick-only does not count (L7). */
export const sizeOf = (st: Stat, planFile?: string, tickOnly = false): { lines: number; files: number } => {
  const xs = st.filter((x) => !(tickOnly && x.path === planFile));
  return { lines: xs.reduce((n, x) => n + x.added + x.deleted, 0), files: xs.length };
};
export const oversize = (st: Stat, s: RouterSettings, planFile?: string, tickOnly = false): boolean => {
  const z = sizeOf(st, planFile, tickOnly);
  return z.lines > s.mergeGate.maxDiffLines || z.files > s.mergeGate.maxDiffFiles;
};

/** The model-facing text of a reason (Q18; pinned by test/local-merge-refuse.test.ts). `x` carries the values it names. */
export function reasonText(r: MergeReason, x: Record<string, string>): string {
  switch (r) {
    case "main-branch": return `${x.branch} is a main branch; make a branch with start_branch and request its merge`;
    case "dirty": return `the worktree ${x.worktree} has uncommitted changes; commit them, then request again`;
    case "behind": return `${x.main} is not an ancestor of the branch; rebase onto ${x.main} in the worktree, then request again`;
    case "fixer-running": return `fixes were delegated to ${x.fixer}; wait for its report, then call request_merge`;
    case "abandoned": return `${x.branch} is abandoned; start a new branch`;
    case "blocked": return `${x.branch} is blocked: the fixer's changes were rejected again; abandon the branch and start a new one with a smaller goal`;
    case "size": return `the branch changes ${x.lines} lines in ${x.files} files (at most ${x.maxLines} lines and ${x.maxFiles} files); split the branch`;
    case "scope": return "the branch changes files outside its plan task";
    case "check": return `\`${x.cmd}\` exit ${x.exit}${x.tail ? `\n${x.tail}` : ""}`;
    case "main-dirty": return `the main checkout ${x.checkout} has uncommitted changes; the merge needs it clean`;
    case "plan-changed": return "the plan changed since the branch started";
    case "no-worktree": return `${x.branch} has no worktree; start_branch makes one`;
    case "review-unavailable": return "error: review unavailable";
    case "aborted": return "aborted";
    case "git": return `git failed: ${x.err}`;
    default: { const none: never = r; return none; }
  }
}

export type OverseerPort = Pick<ReturnType<typeof createOverseer>, "run" | "ready">;
export type MergePorts = {
  git: Git; run: Runner; overseer: OverseerPort; branches: BranchStore; settings: RouterSettings;
  /** `pi.appendEntry` (design §3.0.2). */
  append(customType: string, data: unknown): void;
  /** A fresh path for the red run's temporary worktree (it must not exist). */
  tmp(): string;
  signal?: AbortSignal;
};
type Input = { branch?: string; summary?: string };
/** A check the pipeline ran (step 5), for the review input (S27). */
type CheckRun = { cmd: string; exit: number; output: string };
/** The tail of a check's output: the last 40 lines, at most 4 kB (design §3.2.1). */
const TAIL_LINES = 40, TAIL_BYTES = 4096;
export const tailOf = (out: string): string => out.trimEnd().split("\n").slice(-TAIL_LINES).join("\n").slice(-TAIL_BYTES);

const done = (status: MergeStatus, reason: MergeReason | undefined, detail: string, commit?: string): MergeResult =>
  ({ status, ...(reason && { reason }), detail, ...(commit !== undefined && { commit }) });
const refuse = (reason: MergeReason, x: Record<string, string>, commit?: string): MergeResult => done("refused", reason, reasonText(reason, x), commit);
const gitError = (err: string, commit?: string): MergeResult => done("error", "git", reasonText("git", { err }), commit);

/** `request_merge` (design §3.4.2). Total: an unexpected exception is a `git` error, and nothing after it runs. */
export async function requestMerge(p: MergePorts, input: Input, cwd: string): Promise<MergeResult> {
  try { return await pipeline(p, input, cwd); } catch (err) { return gitError((err as Error)?.message ?? String(err)); }
}

async function pipeline(p: MergePorts, input: Input, cwd: string): Promise<MergeResult> {
  const s = p.settings, g = s.mergeGate, git = p.git;
  // ── 1 resolve: the repository, the branch (given, else the active one), its worktree, the main branch, the commit ──
  const active = p.branches.active() ?? p.branches.latest(["fixer", "blocked"]);
  let repo: string | undefined, branch: string;
  if (typeof input.branch === "string" && input.branch !== "") { repo = await git.root(cwd); branch = input.branch.replace(/^refs\/heads\//, ""); }
  else if (active) { repo = active.repo; branch = active.branch; }
  else return done("refused", "no-worktree", "no branch is given and none is active; start_branch makes one");
  if (repo === undefined) return gitError(`${cwd} is not in a git repository`);
  await refreshFacts({ git, store: p.branches, settings: s }, repo); // D39
  let main: { name: string; sha: string } | undefined;
  for (const name of g.mainBranches) { const sha = await git.sha(repo, name); if (sha !== undefined) { main = { name, sha }; break; } }
  if (!main) return gitError(`none of the main branches (${g.mainBranches.join(", ")}) exists in ${repo}`);
  const rec = p.branches.get(repo, branch), x = { branch, main: main.name };
  const isMain = g.mainBranches.includes(branch);
  const wt = isMain ? undefined : (await git.worktrees(repo)).find((w) => w.branch === branch && !w.prunable);
  if (!wt) { // a branch without a worktree: its state says more than its missing worktree
    const why = refusal({ isMain, state: rec?.state, dirty: false, behind: false });
    return refuse(why ?? "no-worktree", { ...x, fixer: rec?.fixer ?? "" });
  }
  const commit = await git.sha(wt.dir, "HEAD");
  if (commit === undefined) return gitError(`cannot read HEAD of ${wt.dir}`);
  // ── 2 refuse ──
  const why = refusal({ isMain, state: rec?.state, dirty: await git.dirty(wt.dir), behind: !(await git.isAncestor(repo, main.sha, commit)) });
  if (why) return refuse(why, { ...x, worktree: wt.dir, fixer: rec?.fixer ?? "" }, commit);
  // ── 3 size ──
  const st = await git.numstat(repo, main.sha, commit);
  if (st === undefined) return gitError(`cannot diff ${main.name}...${commit}`, commit);
  if (oversize(st, s)) {
    const z = sizeOf(st);
    return refuse("size", { lines: String(z.lines), files: String(z.files), maxLines: String(g.maxDiffLines), maxFiles: String(g.maxDiffFiles) }, commit);
  }
  // ── 5 checks: the branch check, then mergeGate.extraChecks, in the worktree; the first failure refuses ──
  const checks: CheckRun[] = [];
  for (const cmd of [...(rec?.check ? [rec.check] : []), ...g.extraChecks]) {
    const r = await p.run(cmd, wt.dir, s.checkTimeoutSec * 1000);
    checks.push({ cmd, exit: r.exit, output: tailOf(r.output) });
    if (r.exit !== 0) return refuse("check", { cmd, exit: String(r.exit), tail: tailOf(r.output) }, commit);
  }
  // Steps 6–9 follow (L6.T8–T10); until then nothing merges.
  void checks;
  return done("error", "review-unavailable", reasonText("review-unavailable", {}), commit);
}
