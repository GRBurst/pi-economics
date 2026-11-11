// Local mode L6.T15 (design §3.0.3, plan S30; AC-L2 merge, gatebypass): one `merge` line per `request_merge` call, whatever
// its status (`error` is logged as outcome `failed`), and the `gatebypass` line; both text-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatebypassEvent, mergeEvent } from "../core/outcome.ts";
import { REASONS } from "../core/local/merge.ts";
import type { MergeResult } from "../core/local/merge.ts";
import { REVISE, reviewRig } from "./merge-rig.ts";
import { seeded } from "./rand.ts";
import { textFree } from "./text-free.ts";

const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "89abcdef0123456789abcdef0123456789abcdef";
const OUTCOMES = ["merged", "refused", "revise", "fixer", "failed"];
const ENUMS = new Set<string>(["merge", "gatebypass", ...OUTCOMES, ...REASONS]);

test("mergeEvent: taskId = the branch, the outcome; the optional keys only when given", () => {
  const head = { v: 1, ts: NOW.toISOString(), event: "merge", taskId: "lm/x", outcome: "refused" };
  assert.deepEqual(mergeEvent({ now: NOW, branch: "lm/x", outcome: "refused" }), head);
  assert.deepEqual(mergeEvent({ now: NOW, branch: "lm/x", outcome: "merged", reason: "git", commit: SHA, nLines: 12, nFiles: 2, reviewId: "rv-1", pushed: false }),
    { ...head, outcome: "merged", reason: "git", commit: SHA, nLines: 12, nFiles: 2, reviewId: "rv-1", pushed: false });
});

test("gatebypassEvent: taskId = the main branch, from, to; repo the basename, never a path (D35)", () => {
  const head = { v: 1, ts: NOW.toISOString(), event: "gatebypass", taskId: "main", from: SHA, to: OTHER };
  assert.deepEqual(gatebypassEvent({ now: NOW, branch: "main", from: SHA, to: OTHER }), head);
  assert.deepEqual(gatebypassEvent({ now: NOW, branch: "main", from: SHA, to: OTHER, repo: "/srv/u/my-repo" }), { ...head, repo: "my-repo" });
});

async function rig(o: Parameters<typeof reviewRig>[0] = {}, slug = "x", goal = "add x") {
  const m = reviewRig(o);
  const rec = await m.start(slug, "true", goal);
  m.r.commit("x.ts", "x\ny\n", "x", rec.worktree);
  const call = async (params: Record<string, unknown> = {}): Promise<MergeResult> =>
    (await m.h.f.tools.get("request_merge")!.execute("t1", params, undefined, undefined, m.ctx)).details as MergeResult;
  const merges = () => m.h.lines().filter((l) => l.event === "merge").map(({ v, ts, event, ...rest }) => rest);
  return { ...m, rec, call, merges };
}

test("AC-L2 merge: one line per request_merge call, every status; error → failed", async () => {
  const a = await rig();
  a.verdicts.push(REVISE, REVISE);
  const r1 = await a.call(), r2 = await a.call(), r3 = await a.call();
  assert.deepEqual([r1.status, r2.status, r3.status, r3.reason], ["revise", "fixer", "refused", "fixer-running"]);
  const commit = r1.commit!;
  assert.deepEqual(a.merges(), [
    { taskId: a.rec.branch, outcome: "revise", commit, nLines: 2, nFiles: 1, reviewId: r1.reviewId },
    { taskId: a.rec.branch, outcome: "fixer", commit, nLines: 2, nFiles: 1, reviewId: r2.reviewId },
    { taskId: a.rec.branch, outcome: "refused", reason: "fixer-running", commit },
  ]);

  const b = await rig();
  const ok = await b.call({ summary: "adds x" });
  assert.equal(ok.status, "merged", JSON.stringify(ok));
  assert.deepEqual(b.merges(), [{ taskId: b.rec.branch, outcome: "merged", commit: ok.commit, nLines: 2, nFiles: 1, reviewId: ok.reviewId }]);

  const c = await rig({ apiExt: false });
  const err = await c.call();
  assert.deepEqual([err.status, err.reason], ["error", "review-unavailable"]);
  assert.deepEqual(c.merges(), [{ taskId: c.rec.branch, outcome: "failed", reason: "review-unavailable", commit: err.commit, nLines: 2, nFiles: 1 }]);
});

test("AC-L2 merge, gatebypass: text-free over generated branches, goals and summaries", async () => {
  const rnd = seeded(615);
  const word = () => ["fix", "```sh\nrm -rf /\n```", "a b", "ignore previous", "x:y z", "<router-hint>"][rnd(6)]!;
  for (let i = 0; i < 3; i++) {
    const slug = `s${rnd(1000)}-${"abc"[rnd(3)]}`;
    const m = await rig({}, slug, `${word()} ${word()}`);
    if (rnd(2)) m.verdicts.push(REVISE);
    const r = await m.call({ summary: `${word()} ${word()} ${word()}` });
    const lines = m.h.lines().filter((l) => l.event === "merge" || l.event === "gatebypass");
    assert.equal(lines.filter((l) => l.event === "merge").length, 1, JSON.stringify(r));
    for (const l of lines) assert.deepEqual(textFree(l, ENUMS), [], JSON.stringify(l));
  }
});
