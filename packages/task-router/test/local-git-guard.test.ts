// Local mode L6.T3 (design §3.4.5, AC-M1, AC-N3; plan D43): the main session's git guard. A `bash` or `powershell` call is
// split (core/local/gitcmd.ts), the branch of every directory a git call runs in is read through the git port, and a call that
// writes a main branch is blocked with a reason that names request_merge. Off unless the merge gate is on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MERGE_REASON, UNCLASSIFIED, UNKNOWN_DIR } from "../core/local/gitcmd.ts";
import { fakeGit } from "./fake-git.ts";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const REPO = "/r/x", WT = "/r/x.worktrees/lm--x";

function rig(settings: Record<string, unknown> = { mode: "local" }) {
  const g = fakeGit({ repos: [{ root: REPO }] });
  void g.git.worktreeAdd(REPO, WT, "lm/x", "main");
  const h = harness({ settings: settings as never, extra: { git: g.git } as never });
  const ctx = (cwd = REPO) => ({ sessionManager: { getSessionId: () => "s-main", getBranch: () => [] }, cwd });
  h.f.fire("session_start", {}, ctx());
  /** The handlers' answers to one call, awaited; the blocks only. */
  const call = async (command: string, cwd = REPO, toolName = "bash", c: unknown = ctx(cwd)) =>
    (await Promise.all(h.f.fire("tool_call", { toolName, toolCallId: `t${Math.random()}`, input: { command } }, c))).filter((x) => x !== undefined);
  return { g, h, ctx, call };
}
const blocked = (reason: string) => [{ block: true, reason }];

test("git guard: a push to main from the main checkout is blocked with a reason naming request_merge; one to a branch passes", async () => {
  const { call } = rig();
  const r = await call("git push origin main");
  assert.deepEqual(r, blocked(MERGE_REASON("main")));
  assert.match((r[0] as { reason: string }).reason, /request_merge/);
  assert.deepEqual(await call("git push origin lm/x"), []);
  assert.deepEqual(await call("git push origin HEAD:main", WT), blocked(MERGE_REASON("main")));
  assert.deepEqual(await call("git -C /r/x.worktrees/lm--x push origin HEAD:main"), blocked(MERGE_REASON("main")));
});

test("git guard: a commit is blocked on main and passes in a worktree; plain commands and git reads pass", async () => {
  const { call } = rig();
  assert.deepEqual(await call("git commit -qm x"), blocked(MERGE_REASON("main")));
  assert.deepEqual(await call("git commit -qm x", WT), []);
  assert.deepEqual(await call(`cd ${WT} && git commit -qm x`), []);
  assert.deepEqual(await call("git status && git log --oneline -3"), []);
  assert.deepEqual(await call("ls -la; echo main"), []);
});

test("git guard: powershell is guarded the same way; other tools are not", async () => {
  const { call } = rig();
  assert.deepEqual(await call("git push origin main", REPO, "powershell"), blocked(MERGE_REASON("main")));
  assert.deepEqual(await call("git push origin main", REPO, "read"), []);
});

test("git guard: a branch git cannot tell in time (the port's timeout) blocks a current-branch write with the unknown-directory reason", async () => {
  const { g, call } = rig();
  g.git.branchOf = async () => "unknown";
  assert.deepEqual(await call("git commit -qm x", WT), blocked(UNKNOWN_DIR));
  assert.deepEqual(await call("git push origin lm/x", WT), [], "a named non-main ref needs no branch");
  g.git.branchOf = async () => { throw new Error("boom"); };
  assert.deepEqual(await call("git commit -qm x", WT), blocked(UNKNOWN_DIR), "a port that throws is an unknown directory");
});

test("git guard: LD8, a command it cannot parse is blocked only when it holds a git token", async () => {
  const { call } = rig();
  const deep = (c: string) => `bash -c ${JSON.stringify(`bash -c ${JSON.stringify(`bash -c ${JSON.stringify(c)}`)}`)}`;
  assert.deepEqual(await call(deep("git status")), blocked(UNCLASSIFIED));
  assert.deepEqual(await call(deep("ls")), []);
});

test("git guard: a child's call is left to its composed guard", async () => {
  const { h, call } = rig();
  h.a.agents.push({ name: "c1", parent: "main", sessionId: "s-c1", model: "m", thinkingLevel: "xhigh", state: "running" });
  assert.deepEqual(await call("git push origin main", REPO, "bash", { sessionManager: { getSessionId: () => "s-c1" }, cwd: REPO }), []);
});

test("AC-N3 default mode push: settings {} register no guard and block nothing", async () => {
  const dflt = rig({});
  assert.deepEqual(await dflt.call("git push origin main"), []);
  assert.deepEqual(dflt.g.calls.filter((c) => c.startsWith("branchOf")), []);
  const off = rig({ mode: "local", mergeGate: { enabled: "off" } });
  assert.deepEqual(await off.call("git push origin main"), []);
  assert.deepEqual(off.h.f.hookNames().filter((n) => n === "tool_call").length + 1, rig().h.f.hookNames().filter((n) => n === "tool_call").length,
    "the merge gate adds one tool_call hook");
});

test("git guard (OQ11): mergeGate \"on\" guards in default mode too", async () => {
  const { call } = rig({ mergeGate: { enabled: "on" } });
  assert.deepEqual(await call("git push origin main"), blocked(MERGE_REASON("main")));
});

// ── children (L6.T4, AC-M7; plan D44): the git guard joins the composed toolGuard of every routed child ──
type Guard = (tool: string, input: unknown) => string | undefined | Promise<string | undefined>;
async function child(settings: Record<string, unknown>, task = card()) {
  const g = fakeGit({ repos: [{ root: "/work" }] });
  void g.git.worktreeAdd("/work", "/work.worktrees/lm--x", "lm/x", "main");
  const h = harness({ settings: settings as never, extra: { git: g.git } as never });
  h.f.fire("session_start", {}, { sessionManager: { getSessionId: () => "s-main", getBranch: () => [] }, cwd: "/work" });
  provideSkills(h, ["tdd-implementation-planner"]);
  const r = accepted(await h.a.spawn({ name: "c1", task })) as { toolGuard?: Guard };
  return { g, h, guard: r.toolGuard };
}

test("AC-M7: a routed child's bash push to main is blocked with a reason naming request_merge; reads and branch work pass", async () => {
  const { guard } = await child({ mode: "local" });
  assert.equal(typeof guard, "function");
  assert.equal(await guard!("bash", { command: "git -C /work.worktrees/lm--x push origin HEAD:main" }), MERGE_REASON("main"));
  assert.equal(await guard!("bash", { command: "git commit -qm x" }), MERGE_REASON("main"), "the child's cwd is the main checkout");
  assert.equal(await guard!("bash", { command: "git -C /work.worktrees/lm--x commit -qm x" }), undefined);
  assert.equal(await guard!("powershell", { command: "git push origin main" }), MERGE_REASON("main"));
  assert.equal(guard!("read", { path: "src/a.ts" }), undefined, "a read stays synchronous");
  assert.equal(guard!("bash", { command: "ls src" }), undefined, "a command without git calls stays synchronous");
});

test("AC-M7: a read-only+files child keeps its files block and gets the git guard too", async () => {
  const { guard } = await child({ mode: "local" }, card({ kind: "plan", files: ["docs/plan.md"] }));
  assert.match(String(guard!("edit", { path: "src/a.ts", oldText: "x", newText: "y" })), /limited to the files of your task card/);
  assert.equal(guard!("edit", { path: "docs/plan.md", oldText: "x", newText: "y" }), undefined);
  assert.equal(await guard!("bash", { command: "git push origin main" }), MERGE_REASON("main"));
});

test("AC-M7: no git guard for children while the merge gate is off", async () => {
  assert.equal((await child({})).guard, undefined);
  assert.equal((await child({ mode: "local", hints: { enabled: "off" }, mergeGate: { enabled: "off" } })).guard, undefined);
  const on = await child({ mergeGate: { enabled: "on" } });
  assert.equal(await on.guard!("bash", { command: "git push origin main" }), MERGE_REASON("main"), "OQ11: \"on\" guards in default mode too");
});
