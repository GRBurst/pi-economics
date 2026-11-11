// Local mode L6.T13 (design §3.4.1; plan D48, D49): the `request_merge` tool. Registered while the merge gate is active; its
// result is text plus `details` (the MergeResult); `isError` only for `status: "error"` and invalid input; an abort kills the
// overseer in flight and answers `aborted`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REQUEST_MERGE_SCHEMA, mergeText } from "../core/local/merge.ts";
import type { MergeResult } from "../core/local/merge.ts";
import { harness } from "./harness.ts";
import { REVISE, reviewRig } from "./merge-rig.ts";

const tools = (settings: Record<string, unknown>) => {
  const h = harness({ settings: settings as never, apiExt: true });
  h.f.fire("session_start", {}, { cwd: "/r" });
  return h.f.tools;
};

test("request_merge: registered while the merge gate is active (local mode, or on in default mode, OQ11), with the §3.4.1 schema", () => {
  assert.equal(tools({ mode: "local" }).has("request_merge"), true);
  assert.equal(tools({ mode: "local", mergeGate: { enabled: "off" } }).has("request_merge"), false);
  assert.equal(tools({}).has("request_merge"), false);
  assert.equal(tools({ mergeGate: { enabled: "on" } }).has("request_merge"), true);
  assert.deepEqual(tools({ mode: "local" }).get("request_merge")!.parameters, REQUEST_MERGE_SCHEMA);
  assert.deepEqual(REQUEST_MERGE_SCHEMA, {
    type: "object", additionalProperties: false,
    properties: {
      branch: { type: "string", description: "default: the active worktree's branch" },
      summary: { type: "string", maxLength: 500, description: "what the branch does, for the reviewer" },
    },
  });
});

test("mergeText: `status: <s> (<reason>)`, the detail, then one line per finding", () => {
  assert.equal(mergeText({ status: "merged", detail: "merged lm/x into main at abc1234", commit: "c" }), "status: merged\nmerged lm/x into main at abc1234");
  assert.equal(mergeText({ status: "refused", reason: "dirty", detail: "d" }), "status: refused (dirty)\nd");
  assert.equal(mergeText({ status: "revise", detail: "d", findings: ["F1 a", "F2 b"] }), "status: revise\nd\nF1 a\nF2 b");
});

async function rig(o: Parameters<typeof reviewRig>[0] = {}) {
  const m = reviewRig(o);
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  const call = (params: unknown, signal?: AbortSignal) => m.h.f.tools.get("request_merge")!.execute("t1", params, signal, undefined, m.ctx);
  return { ...m, rec, call };
}

test("request_merge: merged → text and details = the MergeResult, no isError", async () => {
  const m = await rig();
  const r = await m.call({ summary: "adds x" });
  const d = r.details as MergeResult;
  assert.equal(d.status, "merged", JSON.stringify(d));
  assert.equal(r.isError, undefined);
  assert.deepEqual(r.content, [{ type: "text", text: mergeText(d) }]);
  assert.equal(m.mainSha(), d.commit);
  assert.ok(m.h.a.apiSpawns[0]!.args.message.includes("Summary from the author: adds x"));
});

test("request_merge: revise and refused are no errors; the findings follow the detail", async () => {
  const m = await rig();
  m.verdicts.push(REVISE);
  const r = await m.call({});
  assert.equal((r.details as MergeResult).status, "revise");
  assert.equal(r.isError, undefined);
  assert.ok((r.content[0]!.text).split("\n").some((l: string) => l.startsWith("F1 [blocking]")), r.content[0]!.text);
  writeFileSync(join(m.rec.worktree, "scratch"), "s\n");
  const q = await m.call({});
  assert.deepEqual([(q.details as MergeResult).status, (q.details as MergeResult).reason, q.isError], ["refused", "dirty", undefined]);
});

test("request_merge: status error is an error; invalid input is refused before anything runs", async () => {
  const m = await rig({ apiExt: false });
  const r = await m.call({});
  assert.deepEqual([(r.details as MergeResult).status, (r.details as MergeResult).reason, r.isError], ["error", "review-unavailable", true]);
  for (const bad of [{ branch: 5 }, { summary: "s".repeat(501) }, { other: 1 }, "x"]) {
    const b = await m.call(bad);
    assert.equal(b.isError, true, JSON.stringify(bad));
    assert.equal((b.details as { status?: string }).status, "error");
  }
});

test("D49: an abort during the review kills the overseer and answers aborted; main unchanged", async () => {
  const m = await rig();
  const before = m.mainSha(), ac = new AbortController();
  m.h.hooks.onSleep = () => { if (!ac.signal.aborted) ac.abort(); };
  const r = await m.call({}, ac.signal);
  const d = r.details as MergeResult;
  assert.deepEqual([d.status, d.reason, r.isError], ["error", "aborted", true], JSON.stringify(d));
  assert.equal(m.h.a.apiSpawns.length, 1, "no fallback attempt after an abort");
  assert.deepEqual(m.h.a.killed, [m.h.a.apiSpawns[0]!.args.name]);
  assert.equal(m.mainSha(), before);
});
