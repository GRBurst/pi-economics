// Local mode L5.T7 (design §3.3.3, AC-W3; plan S23, D39): while a worktree is active, `edit` and `write` in the main checkout
// are blocked with the worktree's path; everything else passes. The pure guard by property, the hook over a real repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import type { BranchRecord } from "../core/local/branches.ts";
import { createGit, gitRunner } from "../core/local/git.ts";
import { writeGuard } from "../core/local/worktree.ts";
import { harness } from "./harness.ts";
import { seeded } from "./rand.ts";
import { tempRepo } from "./git-repo.ts";

const MAIN = "/r/x", WT = "/r/x.worktrees/lm--a", NESTED = "/r/x/wt/lm--b";
const active: BranchRecord = { repo: MAIN, branch: "lm/a", worktree: WT, base: "b", state: "active", rejections: 0, fixerRuns: 0 };
const reason = (wt: string) => `write in the worktree ${wt}; use absolute paths under it`;
const guard = (tool: string, path: unknown, o: { cwd?: string; active?: BranchRecord | undefined; mainCheckout?: string | undefined; worktrees?: string[] } = {}) =>
  writeGuard({ tool, input: path === undefined ? {} : { path }, cwd: o.cwd ?? MAIN, active: "active" in o ? o.active : active,
    mainCheckout: "mainCheckout" in o ? o.mainCheckout : MAIN, worktrees: o.worktrees ?? [MAIN, WT] });

test("write guard: a write in the main checkout is blocked with the worktree; one in the worktree is not", () => {
  assert.equal(guard("edit", `${MAIN}/a.ts`), reason(WT));
  assert.equal(guard("write", `${MAIN}/sub/deep/b.ts`), reason(WT));
  assert.equal(guard("edit", `${WT}/a.ts`), undefined);
  assert.equal(guard("edit", "a.ts"), reason(WT), "a relative path resolves against the cwd (the main checkout)");
  assert.equal(guard("edit", "a.ts", { cwd: WT }), undefined, "…and against a cwd inside the worktree");
  assert.equal(guard("edit", "../x.worktrees/lm--a/a.ts", { cwd: MAIN }), undefined);
  assert.equal(guard("edit", `${MAIN}/../y/a.ts`), undefined, "outside the main checkout");
});

test("write guard: other tools, a missing or non-string path, no active branch, no known main checkout", () => {
  assert.equal(guard("read", `${MAIN}/a.ts`), undefined);
  assert.equal(guard("bash", `${MAIN}/a.ts`), undefined);
  assert.equal(guard("edit", undefined), undefined);
  assert.equal(guard("edit", 5), undefined);
  assert.equal(writeGuard({ tool: "edit", input: null, cwd: MAIN, active, mainCheckout: MAIN, worktrees: [] }), undefined);
  assert.equal(guard("edit", `${MAIN}/a.ts`, { active: undefined }), undefined);
  assert.equal(guard("edit", `${MAIN}/a.ts`, { mainCheckout: undefined }), undefined);
});

test("write guard: a registered worktree nested in the main checkout is not the main checkout", () => {
  const o = { worktrees: [MAIN, WT, NESTED] };
  assert.equal(guard("edit", `${NESTED}/a.ts`, o), undefined);
  assert.equal(guard("edit", `${MAIN}/wt/other.ts`, o), reason(WT));
  assert.equal(guard("edit", `${MAIN}/wt/lm--bx/a.ts`, o), reason(WT), "a sibling that shares the prefix");
});

test("write guard property: blocked ⇔ tool ∈ {edit, write} ∧ inside(p, main) ∧ no linked worktree holds p", () => {
  const rnd = seeded(77);
  const roots = [MAIN, `${MAIN}y`, WT, NESTED, "/r", "/other", `${NESTED}z`, `${WT}x`];
  const rest = ["", "/a.ts", "/s/b.ts", "/../a.ts", "/s/../../c.ts"];
  let blocked = 0, passed = 0;
  for (let i = 0; i < 600; i++) {
    const tool = ["edit", "write", "read", "bash"][rnd(4)]!, p = roots[rnd(roots.length)]! + rest[rnd(rest.length)]!;
    const worktrees = [MAIN, WT, ...(rnd(2) ? [NESTED] : [])];
    const abs = resolve(MAIN, p), under = (q: string, d: string) => q === d || q.startsWith(`${d}/`); // a reference that shares no code with `inside`
    const expected = (tool === "edit" || tool === "write") && under(abs, MAIN) && !worktrees.filter((w) => w !== MAIN).some((w) => under(abs, w));
    const got = guard(tool, p, { worktrees });
    assert.equal(got !== undefined, expected, `${tool} ${p} [${worktrees.length}]`);
    if (got !== undefined) assert.equal(got, reason(WT));
    if (expected) blocked++; else passed++;
  }
  assert.ok(blocked > 50 && passed > 50, `${blocked}/${passed}`);
});

// --- the hook over a real repository -------------------------------------------------------------------------------------

function rig(settings: Record<string, unknown> = { mode: "local" }) {
  const r = tempRepo();
  const h = harness({ settings: settings as never, extra: { git: createGit(gitRunner("git", r.env)) } as never });
  const ctx = { sessionManager: { getSessionId: () => "s-main", getBranch: () => [] }, cwd: r.dir };
  h.f.fire("session_start", {}, ctx);
  const call = (toolName: string, input: unknown, c: unknown = ctx) => h.f.fire("tool_call", { toolName, toolCallId: `t${Math.random()}`, input }, c);
  const start = () => h.f.callTool("start_branch", { slug: "a", goal: "g", check: "true" }, ctx);
  const hints = () => h.lines().filter((l) => l.event === "hint" && l.trip === "outside-worktree");
  return { r, h, ctx, call, start, hints };
}
const blocks = (rs: unknown[]) => rs.filter((x) => x !== undefined);

test("AC-W3: with an active worktree an edit or write in the main checkout is blocked; one in the worktree passes; one hint line per block", async () => {
  const { r, ctx, call, start, hints } = rig();
  await start();
  const wt = join(r.base, "repo.worktrees", "lm--a");
  assert.deepEqual(blocks(call("edit", { path: join(r.dir, "a.ts") })), [{ block: true, reason: reason(wt) }]);
  assert.deepEqual(blocks(call("write", { path: join(r.dir, "sub", "b.ts"), content: "x" })), [{ block: true, reason: reason(wt) }]);
  assert.deepEqual(blocks(call("edit", { path: join(wt, "a.ts") })), []);
  assert.deepEqual(blocks(call("edit", { path: "a.ts" }, { ...ctx, cwd: r.dir })), [{ block: true, reason: reason(wt) }]);
  assert.deepEqual(blocks(call("read", { path: join(r.dir, "a.ts") })), []);
  assert.deepEqual(hints().map(({ taskId, trip, stage, sessionId }) => ({ taskId, trip, stage, sessionId })),
    Array(3).fill({ taskId: "main", trip: "outside-worktree", stage: "hint", sessionId: "s-main" }));
  assert.deepEqual(hints().map((l) => l.count), [1, 2, 1], "the count of blocks since the last write that passed (the edit in the worktree reset it)");
  call("edit", { path: join(wt, "a.ts") });
  call("edit", { path: join(r.dir, "a.ts") });
  assert.equal(hints().at(-1)!.count, 1);
});

test("AC-W3: no active worktree → nothing is blocked, nothing logged", () => {
  const { r, call, hints } = rig();
  assert.deepEqual(blocks(call("edit", { path: join(r.dir, "a.ts") })), []);
  assert.deepEqual(hints(), []);
});

test("the guard runs with hints off, and not when worktrees are off or the mode is default", async () => {
  const off = rig({ mode: "local", hints: { enabled: "off" } });
  await off.start();
  assert.equal(blocks(off.call("edit", { path: join(off.r.dir, "a.ts") })).length, 1);
  const none = rig({ mode: "local", worktrees: { enabled: "off" } });
  assert.equal(none.h.f.tools.has("start_branch"), false);
  assert.deepEqual(blocks(none.call("edit", { path: join(none.r.dir, "a.ts") })), []);
  const dflt = rig({});
  assert.deepEqual(blocks(dflt.call("edit", { path: join(dflt.r.dir, "a.ts") })), []);
});

test("the guard is total: a context without a session, an event without input, a child session", async () => {
  const { r, h, ctx, start } = rig();
  await start();
  assert.deepEqual(blocks(h.f.fire("tool_call", { toolName: "edit" }, ctx)), []);
  assert.deepEqual(blocks(h.f.fire("tool_call", { toolName: "edit", input: { path: join(r.dir, "a.ts") } }, undefined)), [{ block: true, reason: reason(join(r.base, "repo.worktrees", "lm--a")) }]);
  h.a.agents.push({ name: "c1", parent: "main", sessionId: "s-c1", model: "m", thinkingLevel: "xhigh", state: "running" });
  const child = { sessionManager: { getSessionId: () => "s-c1" }, cwd: r.dir };
  assert.deepEqual(blocks(h.f.fire("tool_call", { toolName: "edit", toolCallId: "c", input: { path: join(r.dir, "a.ts") } }, child)), []);
});
