// Local mode L6.T9 (design §3.4.2 steps 7–8, §3.4.3, §3.2.2; plan S26, S27): the merge review and the approval binding. The
// overseer runs in the main checkout and reads the worktree under review by its absolute path (LD14); an approval holds for
// (repo, branch, commit, tree) only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APPROVAL_TYPE, diffBudget, RED_TEXT, reviewInput } from "../core/local/merge.ts";
import { findingLine } from "../core/local/verdict.ts";
import { createMemberCounter } from "../core/counter.ts";
import { finding, mergeRig, REVISE, reviewRig } from "./merge-rig.ts";
import type { Ok } from "./overseer-rig.ts";

test("AC-O1: request_merge spawns exactly one overseer with a ticket; its cwd is the main checkout, the worktree is in its brief", async () => {
  const m = reviewRig();
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  writeFileSync(join(m.r.dir, "scratch"), "keeps the merge off\n"); // the main checkout is dirty: no fast-forward (L6.T10)
  await m.merge();
  assert.equal(m.h.a.apiSpawns.length, 1);
  const s = m.h.a.apiSpawns[0]!, p = s.policy as Ok;
  assert.match(String((s.args.task as { ticket?: unknown }).ticket), /^[0-9a-f]{32}$/);
  assert.deepEqual(s.opts, { by: "main", quiet: true });
  assert.equal(p.cwd, m.r.dir, "the main checkout (LD14), never the worktree");
  assert.ok(s.args.message.startsWith(`The worktree under review: ${rec.worktree} (`), s.args.message.split("\n")[0]);
  assert.deepEqual(p.childTools!.map((t) => t.name), ["submit_verdict"]);
  assert.equal((p.meta as { role?: string }).role, "merge");
});

test("AC-M4: an approval binds (repo, branch, commit, tree); a new commit is reviewed again; approvals survive a restart", async () => {
  const m = reviewRig();
  const rec = await m.start("x");
  const c1 = m.r.commit("x.ts", "x\n", "x", rec.worktree);
  writeFileSync(join(m.r.dir, "scratch"), "keeps the merge off\n");
  await m.merge();
  assert.equal(m.h.a.apiSpawns.length, 1);
  const approvals = () => m.h.f.entries.filter((e) => e.type === APPROVAL_TYPE).map((e) => e.data as Record<string, string>);
  assert.equal(approvals().length, 1);
  assert.equal(approvals()[0]!.commit, c1);
  assert.deepEqual(Object.keys(approvals()[0]!).sort(), ["branch", "commit", "repo", "reviewId", "tree"]);
  // A new commit with the same tree (an amended message): the approval of c1 does not hold for it.
  m.r.git(["-c", "commit.gpgsign=false", "commit", "-q", "--amend", "-m", "x, reworded"], rec.worktree);
  const c2 = m.r.git(["rev-parse", "HEAD"], rec.worktree);
  assert.notEqual(c2, c1);
  await m.merge();
  assert.equal(m.h.a.apiSpawns.length, 2, "c2 is reviewed");
  assert.deepEqual(approvals().map((a) => a.commit), [c1, c2]);
  await m.merge();
  assert.equal(m.h.a.apiSpawns.length, 2, "c2's approval is reused");
  // A new session on the same repository, rebuilt from the entries: still no review for c2.
  const n = reviewRig({ repo: m.r, entries: m.h.f.entries });
  await n.h.router.ready();
  await n.merge();
  assert.equal(n.h.a.apiSpawns.length, 0, "approvals rebuilt from the session");
});

test("not approved: revise with one V3 line per finding; rejections counts up", async () => {
  const m = mergeRig({ settings: { mergeGate: { rejectionsBeforeFixer: 5 } } });
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  const v = { ...REVISE, findings: [finding("F1"), finding("F2", false)] };
  m.verdicts.push(v);
  const before = m.mainSha();
  const res = await m.merge();
  assert.equal(res.status, "revise", JSON.stringify(res));
  assert.equal(res.reason, undefined);
  assert.equal(res.reviewId, "rv-1");
  assert.deepEqual(res.findings, v.findings.map(findingLine));
  assert.equal(res.detail, "the review asks for changes: fix the blocking findings, commit, then call request_merge again");
  assert.equal(m.store.get(m.r.dir, "lm/x")!.rejections, 1);
  assert.equal(m.mainSha(), before);
  assert.equal(m.entries.filter((e) => e.type === APPROVAL_TYPE).length, 0);
});

test("the review run: role merge, cwd the main checkout, the worktree, commit and branch, targets = the diff's paths", async () => {
  const m = mergeRig({ settings: { mergeGate: { redRun: false } } });
  const rec = await m.start("x", "true", "add x for the users");
  const c = m.r.commit("x.ts", "x\n", "x", rec.worktree);
  writeFileSync(join(m.r.dir, "scratch"), "keeps the merge off\n");
  await m.merge({ summary: "adds x" });
  assert.equal(m.reviews.length, 1);
  const a = m.reviews[0]!;
  assert.equal(a.role, "merge");
  assert.equal(a.cwd, m.r.dir);
  assert.equal(a.worktree, rec.worktree);
  assert.equal(a.commit, c);
  assert.equal(a.branch, "lm/x");
  assert.equal(a.submit.name, "submit_verdict");
  assert.equal((await a.submit.check({ ...REVISE, findings: [finding("F1", true, "x.ts:1")] })).ok, true);
  assert.equal((await a.submit.check({ ...REVISE, findings: [finding("F1", true, "other.ts")] })).ok, false);
  const base = m.mainSha();
  assert.equal(a.input, reviewInput({ goal: "add x for the users", summary: "adds x", checks: [{ cmd: "true", exit: 0, output: "" }], red: "skipped",
    risky: [], stat: [{ path: "x.ts", added: 1, deleted: 0 }], base, commit: c, diff: m.r.git(["diff", base, c]), maxLines: diffBudget(m.settings.mergeGate) }));
  assert.equal(diffBudget(m.settings.mergeGate), 1248, "review F9: 8 × (150 lines + 6 files)");
});

// Review F9: a diff the size gate lets through reaches the review whole; one that cannot fit fails the review closed.
function sixFiles(m: ReturnType<typeof mergeRig>, wt: string, lines = 3): string {
  for (let i = 1; i <= 6; i++) writeFileSync(join(wt, `f${i}.ts`), Array.from({ length: lines }, (_, k) => `line ${k} of f${i}`).join("\n") + "\n");
  m.r.git(["-C", wt, "add", "-A"]);
  m.r.git(["-C", wt, "commit", "-qm", "six files"]);
  return m.r.git(["-C", wt, "rev-parse", "HEAD"]);
}

test("review F9: a near-limit diff (18 changed lines in 6 files, maxDiffLines 20) reaches the review uncut", async () => {
  const m = mergeRig({ settings: { mergeGate: { redRun: false, maxDiffLines: 20, maxDiffFiles: 6 } } });
  const rec = await m.start("x");
  const c = sixFiles(m, rec.worktree);
  writeFileSync(join(m.r.dir, "scratch"), "keeps the merge off\n");
  await m.merge();
  assert.equal(m.reviews.length, 1);
  const whole = m.r.git(["diff", m.mainSha(), c]);
  assert.ok(whole.split("\n").length > 20, "the diff is longer than maxDiffLines");
  const input = m.reviews[0]!.input;
  assert.ok(input.endsWith(`\n${whole}`), input.split("\n").slice(-3).join(" | "));
  assert.ok(!input.split("\n").some((l) => l.startsWith("… ")), "no cut marker");
});

test("review F9: a diff longer than the review's budget fails the review closed (no review, main unchanged)", async () => {
  const m = mergeRig({ settings: { mergeGate: { redRun: false, maxDiffLines: 20, maxDiffFiles: 6 } } });
  m.r.commit("big.ts", Array.from({ length: 400 }, (_, k) => `line ${k}`).join("\n") + "\n", "big");
  m.r.git(["config", "diff.context", "1000"]); // every line of big.ts becomes context
  const rec = await m.start("x");
  m.r.commit("big.ts", Array.from({ length: 400 }, (_, k) => (k === 200 ? "changed" : `line ${k}`)).join("\n") + "\n", "one line", rec.worktree);
  const before = m.mainSha();
  const r = await m.merge();
  assert.equal(m.reviews.length, 0, "no review of a cut diff");
  assert.equal(r.status, "error");
  assert.equal(r.reason, "review-unavailable");
  assert.match(r.detail, /diff/);
  assert.equal(m.mainSha(), before);
});

test("review F9: a diff git cannot produce (empty, while numstat shows changes) fails closed as a git error, no review", async () => {
  const m = mergeRig({ settings: { mergeGate: { redRun: false } } });
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  m.git.diff = async () => "";
  const r = await m.merge();
  assert.equal(m.reviews.length, 0);
  assert.equal(r.status, "error");
  assert.equal(r.reason, "git");
});

test("reviewInput: the S27 text", () => {
  const text = reviewInput({ goal: "g", summary: undefined, checks: [{ cmd: "npm test", exit: 0, output: "ok\nall" }, { cmd: "true", exit: 0, output: "" }],
    red: "failed", risky: ["src/auth/a.ts"], stat: [{ path: "src/auth/a.ts", added: 2, deleted: 1 }], base: "b".repeat(40), commit: "c".repeat(40),
    diff: "diff --git a b", maxLines: 150 });
  assert.equal(text, [
    "Goal: g",
    "Summary from the author: none",
    "Check: `npm test` exit 0",
    "ok",
    "all",
    "Check: `true` exit 0",
    `Red run at base: ${RED_TEXT.failed}`,
    "Risky paths: src/auth/a.ts",
    "Invariants: none",
    "Numstat:",
    "2\t1\tsrc/auth/a.ts",
    `Diff ${"b".repeat(40)}..${"c".repeat(40)} (≤ 150 lines):`,
    "diff --git a b",
  ].join("\n"));
  assert.ok(reviewInput({ checks: [], red: "skipped", risky: [], stat: [], base: "b", commit: "c", diff: "", maxLines: 150 }).startsWith("Goal: none\nSummary from the author: none\nCheck: none\n"));
});

// ── L6.T12 (design §3.2.2 steps 1 and 5, §3.0.4): a review that cannot run fails closed; a spent budget falls back ──
async function committed(o: Parameters<typeof reviewRig>[0] = {}) {
  const m = reviewRig(o);
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  return { ...m, rec, before: m.mainSha() };
}

test("AC-O5: both attempts fail to spawn → error review-unavailable, main unchanged, nothing approved", async () => {
  const m = await committed();
  m.h.a.control.spawnFail = "agent cap";
  const res = await m.merge();
  assert.deepEqual([res.status, res.reason, res.detail], ["error", "review-unavailable", "error: review unavailable: agent cap"], JSON.stringify(res)); // with the spawn refusal (L4 note)
  assert.equal(m.h.a.apiSpawns.length, 2, "the first attempt and its fallback");
  assert.equal(m.mainSha(), m.before);
  assert.equal(m.h.f.entries.filter((e) => e.type === APPROVAL_TYPE).length, 0);
  assert.equal(m.h.router.branches.get(m.r.dir, "lm/x")!.rejections, 0, "no rejection either");
});

test("AC-O4: with the Opus budget spent the merge review runs on fallbackMember at fallbackEffort, logged fallback budget", async () => {
  const m = await committed();
  m.h.router.budget.opusUsed = m.h.router.settings.overseer.budget;
  const res = await m.merge();
  assert.equal(res.status, "merged", JSON.stringify(res));
  assert.equal(m.h.a.apiSpawns.length, 1);
  const p = m.h.a.apiSpawns[0]!.policy as Ok;
  assert.deepEqual([p.model, p.thinkingLevel], [m.h.router.settings.models.sonnet!.model, "xhigh"]);
  const lines = m.h.lines().filter((l) => l.event === "review");
  assert.deepEqual(lines.map((l) => [l.role, l.member, l.fallback, l.outcome]), [["merge", "sonnet", "budget", "approve"]]);
  assert.equal(m.h.router.budget.opusUsed, m.h.router.settings.overseer.budget, "a fallback is not charged");
});

test("no spawn API (design §3.0.4): review-unavailable without a spawn, main unchanged", async () => {
  const m = await committed({ apiExt: false });
  const res = await m.merge();
  assert.deepEqual([res.status, res.reason, res.detail], ["error", "review-unavailable", "error: review unavailable"], JSON.stringify(res));
  assert.equal(m.h.a.apiSpawns.length, 0);
  assert.equal(m.mainSha(), m.before);
});

// Review F8: a rejection does not change which branch is active, and a hand-made branch (D40) the review rejected once is still
// left alone after its merge (no cleanup) and never becomes the active branch.
test("review F8: rejecting lm/x by name while lm/y is active keeps lm/y active", async () => {
  const m = reviewRig();
  const x = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", x.worktree);
  await m.start("y");
  m.verdicts.push(REVISE);
  const res = await m.merge({ branch: "lm/x" });
  assert.equal(res.status, "revise", JSON.stringify(res));
  assert.equal(m.h.router.branches.active()!.branch, "lm/y");
});

test("review F8: a hand-made branch rejected once is never active and is not cleaned up after its merge", async () => {
  const m = reviewRig();
  const y = await m.start("y");
  const wt = join(m.r.base, "hand");
  m.r.git(["worktree", "add", "-q", "-b", "hand", wt]);
  m.r.commit("h.ts", "h\n", "h", wt);
  m.verdicts.push({ ...REVISE, findings: [finding("F1", true, "h.ts:1")] });
  assert.equal((await m.merge({ branch: "hand" })).status, "revise");
  assert.equal(m.h.router.branches.active()!.branch, y.branch);
  const res = await m.merge({ branch: "hand" });
  assert.equal(res.status, "merged", JSON.stringify(res));
  assert.ok(existsSync(wt), "the worktree stays");
  assert.equal(m.r.git(["rev-parse", "--verify", "-q", "refs/heads/hand"]), m.mainSha(), "the branch stays");
});

// ── The L4 open note, decided in L6: ticket spawns count toward dailyCap and respect member slots; with no member left for
// the review it fails closed and the merge is refused. ──
const bump = (m: ReturnType<typeof reviewRig>, member: string): void =>
  createMemberCounter(join(m.h.agentDir, "task-router", "member-count.json"), () => new Date(m.h.clock.t)).bump(member);

test("caps: the overseer member and its fallback at their dailyCap: the review fails closed naming the cap; main unchanged", async () => {
  const m = reviewRig({ settings: { models: { opus: { dailyCap: 1 }, sonnet: { dailyCap: 1 } }, mergeGate: { redRun: false } } });
  bump(m, "opus"); bump(m, "sonnet");
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  const before = m.mainSha();
  const r = await m.merge();
  assert.deepEqual([r.status, r.reason], ["error", "review-unavailable"], JSON.stringify(r));
  assert.match(r.detail, /opus reached its dailyCap \(1\)/);
  assert.match(r.detail, /sonnet reached its dailyCap \(1\)/);
  assert.equal(m.h.a.agents.length, 0, "no overseer ran");
  assert.equal(m.mainSha(), before);
});

test("caps: the Opus member at its dailyCap: the review's first attempt does not start, the fallback reviews", async () => {
  const m = reviewRig({ settings: { models: { opus: { dailyCap: 1 } }, mergeGate: { redRun: false } } });
  bump(m, "opus");
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  const r = await m.merge();
  assert.equal(r.status, "merged", JSON.stringify(r));
  assert.deepEqual(m.h.a.apiSpawns.map((s) => s.result.ok), [false, true]);
  assert.equal((m.h.a.apiSpawns[1]!.policy as Ok).model, m.h.router.settings.models.sonnet!.model);
});

test("caps: the fixer member at its dailyCap: no fixer starts; revise says why", async () => {
  const m = reviewRig({ settings: { models: { sonnet: { dailyCap: 1 } }, mergeGate: { redRun: false } } });
  bump(m, "sonnet");
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  m.verdicts.push(REVISE, REVISE);
  await m.merge();
  const r = await m.merge();
  assert.equal(r.status, "revise", JSON.stringify(r));
  assert.match(r.detail, /the fixer could not start: .*sonnet reached its dailyCap \(1\)/);
  assert.equal(m.h.router.branches.get(m.r.dir, "lm/x")!.state, "active");
});
