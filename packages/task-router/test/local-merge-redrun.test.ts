// Local mode L6.T8 (design §3.4.2 step 6; plan S26, S27): the red run. The branch check runs at the base (the main tip the
// branch merges onto) in a detached temporary worktree, which is removed afterwards; a check that passes there may be vacuous.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { RED_TEXT, redRun } from "../core/local/merge.ts";
import { mergeRig } from "./merge-rig.ts";

/** A rig whose branch check is `check`; the branch adds `only-in-branch`. */
async function rig(check: string, settings?: Record<string, unknown>) {
  const m = mergeRig({ settings });
  const rec = await m.start("x", check);
  m.r.commit("only-in-branch", "1\n", "b", rec.worktree);
  return { ...m, rec };
}
const worktreeCount = (m: Awaited<ReturnType<typeof rig>>): number => m.r.git(["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).length;

test("red run: a check that passes at the base may be vacuous", async () => {
  const m = await rig("true");
  const red = await redRun(m.ports, m.r.dir, m.mainSha(), "true");
  assert.equal(red, "passed");
  assert.equal(RED_TEXT[red], "passed — the check may be vacuous");
  assert.equal(m.runs.length, 1);
  assert.equal(m.runs[0].cwd, `${m.r.base}/red-1`, "in the temporary worktree");
  assert.equal(existsSync(m.runs[0].cwd), false, "removed afterwards");
  assert.equal(worktreeCount(m), 2, "the main checkout and the branch's worktree only");
});

test("red run: a check that fails at the base fails as expected", async () => {
  const m = await rig("test -f only-in-branch");
  const red = await redRun(m.ports, m.r.dir, m.mainSha(), "test -f only-in-branch");
  assert.equal(red, "failed");
  assert.equal(RED_TEXT[red], "failed as expected");
  assert.equal(existsSync(`${m.r.base}/red-1`), false);
  assert.equal(worktreeCount(m), 2);
});

test("red run: the temporary worktree is gone after a check timeout too", async () => {
  const m = await rig("test -f only-in-branch || sleep 30", { checkTimeoutSec: 1 });
  const red = await redRun(m.ports, m.r.dir, m.mainSha(), "test -f only-in-branch || sleep 30");
  assert.equal(red, "failed");
  assert.equal(existsSync(`${m.r.base}/red-1`), false);
  assert.equal(worktreeCount(m), 2);
});

test("the pipeline runs the red run after the checks; redRun false skips it (no temporary worktree)", async () => {
  const m = await rig("test -f only-in-branch");
  await m.merge();
  assert.deepEqual(m.runs.map((x) => x.cwd), [m.rec.worktree, `${m.r.base}/red-1`]);
  const n = await rig("test -f only-in-branch", { mergeGate: { redRun: false } });
  await n.merge();
  assert.deepEqual(n.runs.map((x) => x.cwd), [n.rec.worktree]);
  assert.equal(RED_TEXT.skipped, "skipped");
});
