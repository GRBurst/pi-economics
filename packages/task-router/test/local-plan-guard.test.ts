// Local mode L7.T10 (design §3.5.6; AC-P5, G9): the plan guard. An `edit` or `write` of a plan file (in the main checkout or a
// worktree of its repository) is computed in memory: `edit` applies `edits[]` (pi 1.4) or the legacy `oldText`/`newText` to
// the current text and is blocked when it cannot be applied; the result may differ only in ticked task boxes. Else the reason
// is "change the plan with amend_plan". The main session's `tool_call` and every routed child's toolGuard run it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPlan, type Skeleton, skeletonHash } from "../core/local/plan.ts";
import { applyEdit, PLAN_REASON, planGuard } from "../core/local/planguard.ts";
import { PLAN_TYPE } from "../core/local/plans.ts";
import { fakeGit } from "./fake-git.ts";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const SK: Skeleton = {
  invariants: [],
  milestones: [{ id: "M1", goal: "a parser", acceptance: [], branch: "task", dependsOn: [], tasks: [
    { id: "M1.T1", goal: "write the parser", files: ["src/a.ts"], forbidden: [], check: "test -f src/a.ts", dependsOn: [] },
    { id: "M1.T2", goal: "wire it", files: ["src/b.ts"], forbidden: [], check: "test -f src/b.ts", dependsOn: ["M1.T1"] },
  ] }],
};
const TEXT = renderPlan({ slug: "p", request: "add a parser" }, SK, new Set());
const TICKED = TEXT.replace("- [ ] M1.T1:", "- [x] M1.T1:");
const TICK = { oldText: "- [ ] M1.T1: write the parser", newText: "- [x] M1.T1: write the parser" };

test("applyEdit: edits[] apply to the original text; the legacy oldText/newText too; an edit that cannot apply is undefined", () => {
  assert.equal(applyEdit("a b c\n", { edits: [{ oldText: "a", newText: "x" }, { oldText: "c", newText: "z" }] }), "x b z\n");
  assert.equal(applyEdit("a b c\n", { edits: [{ oldText: "c", newText: "a" }, { oldText: "a", newText: "c" }] }), "c b a\n", "against the original");
  assert.equal(applyEdit("a b c\n", { oldText: "b", newText: "y" }), "a y c\n");
  assert.equal(applyEdit("a\r\nb\r\n", { edits: [{ oldText: "a\r\nb", newText: "x\ny" }] }), "x\ny\n", "line endings are LF, as pi's");
  const bad = (text: string, input: unknown) => assert.equal(applyEdit(text, input), undefined, JSON.stringify(input));
  bad("a b c\n", { edits: [{ oldText: "q", newText: "x" }] }); // not found
  bad("a b a\n", { edits: [{ oldText: "a", newText: "x" }] }); // found twice
  bad("a b c\n", { edits: [{ oldText: "", newText: "x" }] });
  bad("a b c\n", { edits: [{ oldText: "a b", newText: "x" }, { oldText: "b c", newText: "y" }] }); // overlapping
  for (const x of [{ edits: [] }, { edits: [{ oldText: 1, newText: "x" }] }, { edits: [{ oldText: "a" }] }, {}, null, "x"]) bad("a b c\n", x);
});

function planDir() {
  const repo = mkdtempSync(join(tmpdir(), "task-router-pg-"));
  mkdirSync(join(repo, "docs/plans"), { recursive: true });
  const file = join(repo, "docs/plans/p.md");
  writeFileSync(file, TEXT);
  return { repo, file };
}

test("AC-P5 a tick on a task line passes; any other change, an edit that cannot apply, or other written content is blocked", () => {
  const { repo, file } = planDir();
  const g = (tool: string, input: unknown, cwd = repo) => planGuard({ tool, input, cwd, files: [file], read: (p) => (p === file ? TEXT : undefined) });
  assert.equal(g("edit", { path: file, edits: [TICK] }), undefined);
  assert.equal(g("edit", { path: "docs/plans/p.md", oldText: TICK.oldText, newText: TICK.newText }), undefined, "relative to cwd, legacy shape");
  assert.equal(g("write", { path: file, content: TICKED }), undefined, "a write of the ticked text");
  assert.equal(g("edit", { path: file, edits: [{ oldText: "write the parser", newText: "write two parsers" }] }), PLAN_REASON);
  assert.equal(g("edit", { path: file, edits: [{ oldText: '"check": "test -f src/a.ts"', newText: '"check": "true"' }] }), PLAN_REASON);
  assert.equal(g("edit", { path: file, edits: [{ oldText: "- [ ] M9.T9", newText: "- [x] M9.T9" }] }), PLAN_REASON, "cannot apply");
  assert.equal(g("write", { path: file, content: TEXT + "\nnotes\n" }), PLAN_REASON);
  assert.equal(g("write", { path: file }), PLAN_REASON, "no content");
  assert.equal(PLAN_REASON, "change the plan with amend_plan");
  const unticking = planGuard({ tool: "edit", input: { path: file, edits: [{ oldText: "- [x] M1.T1", newText: "- [ ] M1.T1" }] }, cwd: repo, files: [file], read: () => TICKED });
  assert.equal(unticking, PLAN_REASON, "AC-P5 untick blocked");
  assert.equal(planGuard({ tool: "edit", input: { path: file, edits: [TICK] }, cwd: repo, files: [file], read: () => undefined }), PLAN_REASON, "unreadable");
  assert.equal(g("edit", { path: join(repo, "docs/plans/q.md"), edits: [TICK] }), undefined, "no plan's file");
  assert.equal(g("read", { path: file }), undefined);
  assert.equal(g("bash", { command: `echo x > ${file}` }), undefined, "bash is not parsed (start_branch and request_merge re-hash)");
  assert.equal(g("edit", { path: 3 }), undefined);
});

/** A harness whose session holds an approved plan `p` of the repository `repo` (a fake git repository at a real directory). */
function rig() {
  const { repo, file } = planDir();
  const g = fakeGit({ repos: [{ root: repo }] });
  const wt = `${repo}.worktrees/lm--p--M1.T1`;
  void g.git.worktreeAdd(repo, wt, "lm/p/M1.T1", "main");
  mkdirSync(join(wt, "docs/plans"), { recursive: true });
  writeFileSync(join(wt, "docs/plans/p.md"), TEXT);
  const h = harness({ settings: { mode: "local" } as never, extra: { git: g.git } as never });
  const rec = { slug: "p", repo, file: "docs/plans/p.md", skeletonHash: skeletonHash(SK), approvedBy: "rv-1", triggers: [] };
  const ctx = (cwd = repo) => ({ sessionManager: { getSessionId: () => "s-main", getBranch: () => [{ type: "custom", customType: PLAN_TYPE, data: rec }] }, cwd });
  h.f.fire("session_start", {}, ctx());
  const call = async (toolName: string, input: unknown, cwd = repo) =>
    (await Promise.all(h.f.fire("tool_call", { toolName, toolCallId: `t${Math.random()}`, input }, ctx(cwd)))).filter((x) => x !== undefined);
  return { repo, file, wt, g, h, call };
}

test("AC-P5 the main session: an edit of the plan file in the main checkout or a worktree is guarded", async () => {
  const x = rig();
  await x.h.router.settled();
  assert.deepEqual(await x.call("edit", { path: x.file, edits: [TICK] }), []);
  assert.deepEqual(await x.call("edit", { path: x.file, edits: [{ oldText: "wire it", newText: "wire it twice" }] }), [{ block: true, reason: PLAN_REASON }]);
  assert.deepEqual(await x.call("write", { path: join(x.wt, "docs/plans/p.md"), content: "# gone\n" }, x.wt), [{ block: true, reason: PLAN_REASON }]);
  assert.deepEqual(await x.call("edit", { path: join(x.repo, "src/a.ts"), edits: [{ oldText: "a", newText: "b" }] }), [], "no plan file");
});

test("AC-P5 a routed child: the same guard in its composed toolGuard", async () => {
  const x = rig();
  await x.h.router.settled();
  provideSkills(x.h, ["tdd-implementation-planner"]);
  const r = accepted(await x.h.a.spawn({ name: "c1", task: card() })) as { toolGuard?: (t: string, i: unknown) => unknown };
  assert.equal(typeof r.toolGuard, "function");
  assert.equal(await r.toolGuard!("edit", { path: x.file, edits: [{ oldText: "wire it", newText: "wire it twice" }] }), PLAN_REASON);
  assert.equal(await r.toolGuard!("write", { path: join(x.wt, "docs/plans/p.md"), content: TICKED }), undefined);
});

test("AC-P5 plans off: no plan guard", async () => {
  const { repo, file } = planDir();
  const g = fakeGit({ repos: [{ root: repo }] });
  const h = harness({ settings: { mode: "local", plans: { enabled: "off" } } as never, extra: { git: g.git } as never });
  const rec = { slug: "p", repo, file: "docs/plans/p.md", skeletonHash: skeletonHash(SK), approvedBy: "rv-1", triggers: [] };
  const ctx = { sessionManager: { getSessionId: () => "s-main", getBranch: () => [{ type: "custom", customType: PLAN_TYPE, data: rec }] }, cwd: repo };
  h.f.fire("session_start", {}, ctx);
  const r = (await Promise.all(h.f.fire("tool_call", { toolName: "write", toolCallId: "t1", input: { path: file, content: "x" } }, ctx))).filter((v) => v !== undefined);
  assert.deepEqual(r, []);
});
