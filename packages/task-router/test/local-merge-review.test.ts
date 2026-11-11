// Local mode L6.T9 (design §3.4.2 steps 7–8, §3.4.3, §3.2.2; plan S26, S27): the merge review and the approval binding. The
// overseer runs in the main checkout and reads the worktree under review by its absolute path (LD14); an approval holds for
// (repo, branch, commit, tree) only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { APPROVAL_TYPE, RED_TEXT, reviewInput } from "../core/local/merge.ts";
import { findingLine } from "../core/local/verdict.ts";
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
    risky: [], stat: [{ path: "x.ts", added: 1, deleted: 0 }], base, commit: c, diff: m.r.git(["diff", base, c]), maxLines: 150 }));
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
