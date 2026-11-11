// Local mode L6.T10 (design §3.4.2 step 9, §3.4.3, §3.3.4; plan S26): the merge itself. Fast-forward only (LD7): main's new tip
// is the reviewed commit, through `merge --ff-only` in the checkout that has main, else `update-ref` from the old tip; then the
// push (when on), the `task-router/main-ref` record, the state `merged` and the cleanup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reasonText } from "../core/local/merge.ts";
import { mergeRig } from "./merge-rig.ts";

async function ready(settings?: Record<string, unknown>) {
  const m = mergeRig({ settings: { mergeGate: { redRun: false, ...(settings?.mergeGate as object) } } });
  const rec = await m.start("x");
  const c = m.r.commit("x.ts", "x\n", "x", rec.worktree);
  return { ...m, rec, c, before: m.mainSha() };
}
const hasRef = (m: Awaited<ReturnType<typeof ready>>, ref: string): boolean => {
  try { m.r.git(["rev-parse", "--verify", "--quiet", ref]); return true; } catch { return false; }
};

test("AC-M3 ff-only: main checked out in a worktree fast-forwards to the reviewed commit; record, state and cleanup follow", async () => {
  const m = await ready();
  const res = await m.merge();
  assert.equal(res.status, "merged", JSON.stringify(res));
  assert.equal(res.commit, m.c);
  assert.equal(res.reviewId, "rv-1");
  assert.equal(res.pushed, undefined);
  assert.equal(res.detail, `merged lm/x into main at ${m.c.slice(0, 7)}`);
  assert.equal(m.mainSha(), m.c, "main's tip is the reviewed commit");
  assert.equal(m.r.git(["rev-parse", "HEAD"]), m.c, "the main checkout moved with it");
  assert.ok(existsSync(join(m.r.dir, "x.ts")));
  assert.equal(m.r.git(["status", "--porcelain"]), "");
  assert.equal(m.store.get(m.r.dir, "lm/x")!.state, "merged");
  assert.deepEqual(m.entries.filter((e) => e.type === "task-router/main-ref").map((e) => e.data), [{ repo: m.r.dir, branch: "main", sha: m.c }]);
  assert.equal(existsSync(m.rec.worktree), false, "worktree removed (removeAfterMerge)");
  assert.equal(hasRef(m, "refs/heads/lm/x"), false, "branch deleted");
});

test("AC-M3 update-ref: main checked out nowhere moves from its old tip; the branch is still removed", async () => {
  const m = await ready();
  m.r.git(["checkout", "-q", "--detach"]);
  const res = await m.merge();
  assert.equal(res.status, "merged", JSON.stringify(res));
  assert.equal(m.mainSha(), m.c);
  assert.equal(m.r.git(["rev-parse", "HEAD"]), m.before, "the detached main checkout stays");
  assert.equal(existsSync(m.rec.worktree), false);
  assert.equal(hasRef(m, "refs/heads/lm/x"), false);
});

test("removeAfterMerge false keeps the worktree and the branch", async () => {
  const m = mergeRig({ settings: { mergeGate: { redRun: false }, worktrees: { removeAfterMerge: false } } });
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  assert.equal((await m.merge()).status, "merged");
  assert.ok(existsSync(rec.worktree));
});

test("main-dirty: the checkout that has main must be clean; main stays, nothing is recorded", async () => {
  const m = await ready();
  writeFileSync(join(m.r.dir, "scratch"), "s\n");
  const res = await m.merge();
  assert.equal(res.status, "refused");
  assert.equal(res.reason, "main-dirty");
  assert.equal(res.detail, reasonText("main-dirty", { checkout: m.r.dir }));
  assert.equal(m.mainSha(), m.before);
  assert.equal(m.store.get(m.r.dir, "lm/x")!.state, "active");
  assert.equal(m.entries.filter((e) => e.type === "task-router/main-ref").length, 0);
});

test("push on: main is pushed to the remote; pushed: true", async () => {
  const m = await ready({ mergeGate: { push: true } });
  const remote = join(m.r.base, "remote.git");
  m.r.git(["init", "-q", "--bare", remote]);
  m.r.git(["remote", "add", "origin", remote]);
  const res = await m.merge();
  assert.equal(res.status, "merged", JSON.stringify(res));
  assert.equal(res.pushed, true);
  assert.equal(res.detail, `merged lm/x into main at ${m.c.slice(0, 7)}; pushed to origin`);
  assert.equal(m.r.git(["rev-parse", "main"], remote), m.c);
});

test("push failing: the merge stands; pushed: false and git's reason", async () => {
  const m = await ready({ mergeGate: { push: true, remote: "nowhere" } });
  const res = await m.merge();
  assert.equal(res.status, "merged");
  assert.equal(res.pushed, false);
  assert.ok(res.detail.startsWith(`merged lm/x into main at ${m.c.slice(0, 7)}; push to nowhere failed: `), res.detail);
  assert.equal(m.mainSha(), m.c);
});

test("HEAD moved after the approval: the new commit is reviewed, never the old one merged", async () => {
  const m = await ready();
  let c2 = "";
  m.hooks.review = () => { if (!c2) c2 = m.r.commit("y.ts", "y\n", "y", m.rec.worktree); };
  const res = await m.merge();
  assert.equal(m.reviews.length, 2);
  assert.deepEqual(m.reviews.map((a) => a.commit), [m.c, c2]);
  assert.equal(res.status, "merged", JSON.stringify(res));
  assert.equal(m.mainSha(), c2);
});
