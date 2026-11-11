// Local mode L6.T14 (design §3.4.6): bypass detection. After every main-session `bash` result and every child `turn` event the
// router reads each known repository's main ref (off the event) and compares it with the last `task-router/main-ref` record; a
// ref that moved outside the gate gives one `gatebypass` line, one warning and a new record at once, and one
// `<router-hint trip="gatebypass">` block on the next main tool result (plan D17, as over-size).
import { test } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { MAIN_REF_TYPE } from "../core/local/merge.ts";
import { reviewRig } from "./merge-rig.ts";
import { tempRepo } from "./git-repo.ts";
import { startBranch } from "../core/local/worktree.ts";

const HINT = '<router-hint trip="gatebypass"';

async function rig() {
  const notes: Array<[string, string]> = [];
  const m = reviewRig({ ctx: { hasUI: true, ui: { notify: (t: string, l: string) => void notes.push([t, l]), setStatus: () => undefined } } });
  let n = 0;
  /** One main-session call of `tool` and its result; the hint blocks the result handlers appended. */
  const result = async (tool = "bash"): Promise<string[]> => {
    const id = `c${++n}`, input = tool === "bash" ? { command: "true" } : { path: "x" };
    await Promise.all(m.h.f.fire("tool_call", { toolName: tool, toolCallId: id, input }, m.ctx));
    const outs = m.h.f.fire("tool_result", { toolName: tool, toolCallId: id, input, content: [{ type: "text", text: "ok" }], isError: false }, m.ctx);
    await m.h.router.settled();
    return outs.flatMap((o: any) => (Array.isArray(o?.content) ? o.content : []))
      .map((c: any) => String(c?.text)).filter((t: string) => t.startsWith(HINT));
  };
  const bypasses = () => m.h.lines().filter((l) => l.event === "gatebypass");
  const refs = () => m.h.f.entries.filter((e) => e.type === MAIN_REF_TYPE).map((e) => e.data as { repo: string; branch: string; sha: string });
  /** Moves main to a new commit with main's tree, as `git update-ref` by hand would. */
  const moveMain = (): string => {
    const to = m.r.git(["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "by hand"]);
    m.r.git(["update-ref", "refs/heads/main", to]);
    return to;
  };
  return { ...m, notes, result, bypasses, refs, moveMain };
}

test("AC-M6: main moved outside the gate, then a bash result → one gatebypass line, one warning, the record updated; the next result carries one hint", async () => {
  const m = await rig();
  const from = m.mainSha();
  assert.deepEqual(await m.result(), []);
  assert.deepEqual(m.refs(), [{ repo: m.r.dir, branch: "main", sha: from }], "first sight of the repository records silently");
  assert.deepEqual(m.bypasses(), []);
  assert.deepEqual(m.notes, []);
  assert.deepEqual(await m.result(), []);
  const to = m.moveMain();
  assert.deepEqual(await m.result(), []);
  const text = `main moved outside the gate (${basename(m.r.dir)} main ${from.slice(0, 7)}→${to.slice(0, 7)})`;
  const lines = m.bypasses();
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.taskId, "main");
  assert.equal(lines[0]!.from, from);
  assert.equal(lines[0]!.to, to);
  assert.equal(lines[0]!.repo, basename(m.r.dir));
  assert.deepEqual(m.notes, [[`task-router: ${text}`, "warning"]]);
  assert.deepEqual(m.refs().at(-1), { repo: m.r.dir, branch: "main", sha: to });
  const hints = await m.result("read");
  assert.equal(hints.length, 1);
  assert.ok(hints[0]!.startsWith(`${HINT}>${text}.`), hints[0]);
  assert.deepEqual(await m.result(), [], "later results: nothing");
  assert.deepEqual(await m.result("read"), []);
  assert.equal(m.bypasses().length, 1);
  assert.equal(m.notes.length, 1);
});

test("AC-M6: a result of another tool does not read the refs", async () => {
  const m = await rig();
  await m.result();
  m.moveMain();
  await m.result("read");
  await m.result("read");
  assert.deepEqual(m.bypasses(), []);
});

test("AC-M6: a child turn event reads the refs; its hint waits for the next main tool result", async () => {
  const m = await rig();
  await m.result();
  m.moveMain();
  m.h.a.emit({ type: "turn", name: "w1", ts: 0 });
  await m.h.router.settled();
  assert.equal(m.bypasses().length, 1);
  assert.equal(m.notes.length, 1);
  assert.equal((await m.result("read")).length, 1);
  assert.deepEqual(await m.result("read"), []);
});

test("AC-M6: a merge through the gate writes no gatebypass line", async () => {
  const m = await rig();
  await m.result();
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  const r = await m.h.f.tools.get("request_merge")!.execute("t1", { summary: "adds x" }, undefined, undefined, m.ctx);
  assert.equal((r as any).details.status, "merged", JSON.stringify((r as any).details));
  await m.result();
  assert.deepEqual(await m.result(), []);
  assert.deepEqual(m.bypasses(), []);
  assert.deepEqual(m.notes, []);
});

test("AC-M6: a rebuilt session keeps the record", async () => {
  const m = await rig();
  await m.result();
  const from = m.mainSha();
  const again = reviewRig({ repo: m.r, entries: m.h.f.entries.map((e) => ({ ...e })), ctx: { hasUI: true, ui: { notify: () => undefined, setStatus: () => undefined } } });
  m.moveMain();
  again.h.f.fire("tool_call", { toolName: "bash", toolCallId: "z", input: { command: "true" } }, again.ctx);
  again.h.f.fire("tool_result", { toolName: "bash", toolCallId: "z", input: { command: "true" }, content: [], isError: false }, again.ctx);
  await again.h.router.settled();
  const lines = again.h.lines().filter((l) => l.event === "gatebypass");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.from, from);
});

test("AC-M6: a repository with a registered worktree is known, besides the session cwd's", async () => {
  const m = await rig();
  const other = tempRepo();
  const res = await startBranch({ git: m.git, store: m.h.router.branches, settings: m.h.router.settings }, { slug: "y", goal: "add y", check: "true" }, other.dir);
  assert.equal(res.ok, true);
  await m.result();
  const from = other.git(["rev-parse", "main"]);
  const to = other.git(["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "by hand"]);
  other.git(["update-ref", "refs/heads/main", to]);
  await m.result();
  assert.deepEqual(m.bypasses().map((l) => [l.repo, l.from, l.to]), [[basename(other.dir), from, to]]);
  assert.equal((await m.result("read")).length, 1);
});

// Review F2: the baseline is taken when the session starts (and when start_branch registers a repository), so a move in the
// session's first bash call is a bypass, not a silent first sight.
test("AC-M6 (review F2): the session's first bash call moves main → one gatebypass line and one warning", async () => {
  const m = await rig();
  await m.h.router.settled();
  const from = m.mainSha();
  const to = m.moveMain();
  assert.deepEqual(await m.result(), []);
  assert.deepEqual(m.bypasses().map((l) => [l.from, l.to]), [[from, to]]);
  assert.equal(m.notes.length, 1);
});

test("AC-M6 (review F2): a repository start_branch registers is known from then on; its first move is a bypass", async () => {
  const m = await rig();
  const other = tempRepo();
  const res = await m.h.f.tools.get("start_branch")!.execute("s1", { slug: "y", goal: "add y", check: "true", repo: other.dir }, undefined, undefined, m.ctx);
  assert.equal((res as any).isError, undefined, JSON.stringify(res));
  const from = other.git(["rev-parse", "main"]);
  const to = other.git(["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "by hand"]);
  other.git(["update-ref", "refs/heads/main", to]);
  await m.result();
  assert.deepEqual(m.bypasses().map((l) => [l.repo, l.from, l.to]), [[basename(other.dir), from, to]]);
});
