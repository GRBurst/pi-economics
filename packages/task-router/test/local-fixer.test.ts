// Local mode L6.T11 (design §3.4.4, AC-M5; plan S28, D45–D47): after `rejectionsBeforeFixer` rejections the router spawns the
// fixer itself (a ticket, `fixerMember` at `fixerEffort`, in the worktree, not quiet); the branch is the fixer's until its report
// or its death; a fixer round rejected again with `fixerRounds` used up blocks the branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { reasonText } from "../core/local/merge.ts";
import { fixerCard, fixerBrief } from "../core/local/merge.ts";
import { REVISE, finding, reviewRig } from "./merge-rig.ts";
import type { Ok } from "./overseer-rig.ts";

const HAIKU = "anthropic/claude-haiku-5-5";
const registry = { find: (p: string, id: string) => (`${p}/${id}` === HAIKU ? { provider: p, id } : undefined), getAvailable: () => [] };

/** A branch with one commit (x.ts) whose first two reviews ask for changes. */
async function rejectedTwice(o: { settings?: Record<string, unknown>; ctx?: Record<string, unknown> } = {}) {
  const m = reviewRig(o);
  const rec = await m.start("x", "true", "add x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  m.verdicts.push(REVISE, REVISE);
  const first = await m.merge();
  assert.equal(first.status, "revise", JSON.stringify(first));
  const second = await m.merge();
  return { ...m, rec, first, second, get: () => m.h.router.branches.get(m.r.dir, "lm/x")! };
}
const blocks = (rs: unknown[]) => rs.filter((x) => x !== undefined);

test("AC-M5: the second rejection spawns one fixer (fixerMember, fixerEffort, the worktree, not quiet) with the fix criteria", async () => {
  const m = await rejectedTwice();
  assert.equal(m.second.status, "fixer", JSON.stringify(m.second));
  assert.equal(m.h.a.apiSpawns.length, 3, "two reviews, one fixer");
  const fx = m.h.a.apiSpawns[2]!, p = fx.policy as Ok, name = fx.args.name;
  assert.ok(fx.result.ok);
  assert.deepEqual(fx.opts, { by: "main", quiet: false });
  assert.ok(typeof (fx.args.task as { ticket?: unknown }).ticket === "string", "a ticket");
  assert.equal(p.model, m.h.router.settings.models.sonnet!.model);
  assert.equal(p.thinkingLevel, "high");
  assert.equal(p.cwd, m.rec.worktree);
  assert.deepEqual(p.childTools, []);
  assert.equal(p.tools, undefined, "every tool");
  assert.ok(p.briefAppend?.includes("- fix F1"), p.briefAppend);
  assert.ok(p.briefAppend?.includes("x.ts"), p.briefAppend);
  assert.equal(m.second.detail, reasonText("fixer-running", { fixer: name }));
  assert.deepEqual(m.second.findings?.length, 1);
  // its git guard: no push to main from the worktree
  const why = await p.toolGuard!("bash", { command: `git -C ${m.rec.worktree} push origin HEAD:main` });
  assert.match(String(why), /request_merge/);
  assert.deepEqual([m.get().state, m.get().fixer, m.get().fixerRuns, m.get().rejections], ["fixer", name, 1, 2]);
  // the spawn line: kind implement, ticket fixer
  const line = m.h.lines().find((l) => l.event === "spawn" && l.taskId === name)!;
  assert.deepEqual([line.kind, line.ticket, line.workerMember], ["implement", "fixer", "sonnet"]);

  // request_merge while the fixer works → fixer-running, no review
  const busy = await m.merge();
  assert.deepEqual([busy.status, busy.reason, busy.detail], ["refused", "fixer-running", reasonText("fixer-running", { fixer: name })]);
  assert.equal(m.h.a.apiSpawns.length, 3);
  // the main session cannot write into the fixer's worktree
  const edit = () => blocks(m.h.f.fire("tool_call", { toolName: "edit", toolCallId: "e1", input: { path: join(m.rec.worktree, "x.ts") } }, m.ctx));
  assert.deepEqual(edit(), [{ block: true, reason: "a fixer owns this branch" }]);

  // the fixer's report (a route fixer→main): the branch is active again, the fixer killed
  m.h.a.emit({ type: "route", from: name, to: "main", preview: "done", buffered: false, ts: 0 });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual([m.get().state, m.get().fixer], ["active", undefined]);
  assert.ok(m.h.a.killed.includes(name), "fixer killed");
  assert.deepEqual(edit(), []);

  // rejected again with fixerRounds (1) used → blocked
  m.verdicts.push(REVISE);
  const third = await m.merge();
  assert.deepEqual([third.status, third.reason, third.detail], ["refused", "blocked", reasonText("blocked", { branch: "lm/x" })]);
  assert.equal(third.findings?.length, 1);
  assert.equal(m.h.a.apiSpawns.length, 4, "one more review, no second fixer");
  assert.equal(m.get().state, "blocked");
  const fourth = await m.merge();
  assert.deepEqual([fourth.status, fourth.reason], ["refused", "blocked"]);
  assert.equal(m.h.a.apiSpawns.length, 4);
});

test("a fixer's death (error or kill event) ends fixer-running", async () => {
  for (const type of ["error", "kill"] as const) {
    const m = await rejectedTwice();
    const name = m.h.a.apiSpawns[2]!.args.name;
    m.h.a.emit(type === "error" ? { type, name, reason: "boom", ts: 0 } : { type, name, ts: 0 });
    assert.deepEqual([m.get().state, m.get().fixer], ["active", undefined], type);
  }
});

test("fixerRounds 2: a second rejection after the fixer's report spawns a second fixer", async () => {
  const m = await rejectedTwice({ settings: { mergeGate: { fixerRounds: 2 } } });
  const first = m.h.a.apiSpawns[2]!.args.name;
  m.h.a.emit({ type: "route", from: first, to: "main", preview: "done", buffered: false, ts: 0 });
  m.verdicts.push(REVISE);
  const again = await m.merge();
  assert.equal(again.status, "fixer", JSON.stringify(again));
  assert.equal(m.get().fixerRuns, 2);
  assert.notEqual(m.get().fixer, first);
});

test("a fixer that cannot start: revise, the branch stays active", async () => {
  const m = reviewRig();
  const rec = await m.start("x", "true", "add x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  m.verdicts.push(REVISE, REVISE);
  await m.merge();
  // the second review itself must spawn: only the fixer's spawn fails
  const real = m.h.a.api.spawn!.bind(m.h.a.api);
  m.h.a.api.spawn = async (a, o) => (a.name.startsWith("ovs-") ? real(a, o) : { ok: false, reason: "agent cap" });
  const res = await m.merge();
  assert.equal(res.status, "revise", JSON.stringify(res));
  assert.ok(res.detail.endsWith("the fixer could not start: agent cap"), res.detail);
  const now = m.h.router.branches.get(m.r.dir, "lm/x")!;
  assert.deepEqual([now.state, now.fixerRuns, now.rejections], ["active", 0, 2]);
});

test("D47: a settings force applies to the fixer (forced: true); the reviews stay on the overseer member", async () => {
  const m = await rejectedTwice({ settings: { force: { model: HAIKU } }, ctx: { modelRegistry: registry } });
  assert.equal(m.second.status, "fixer", JSON.stringify(m.second));
  const fx = m.h.a.apiSpawns[2]!, p = fx.policy as Ok;
  assert.equal(p.model, HAIKU);
  assert.equal((m.h.a.apiSpawns[0]!.policy as Ok).model, "anthropic/claude-opus-5-5");
  const line = m.h.lines().find((l) => l.event === "spawn" && l.taskId === fx.args.name)!;
  assert.deepEqual([line.forced, line.forceSource, line.routedModel, line.routedEffort], [true, "settings", m.h.router.settings.models.sonnet!.model, "high"]);
});

test("fixerCard and fixerBrief: changed files ∪ finding targets, the branch check, the blocking findings' fix criteria", () => {
  const c = fixerCard(["x.ts", "y.ts"], [finding("F1", true, "z.ts:3"), finding("F2", false, "x.ts"), finding("F3", true, "x.ts:1-4")], "npm test");
  assert.deepEqual(c, { kind: "implement", files: ["x.ts", "y.ts", "z.ts"], check: "npm test", acceptance: ["fix F1", "fix F3"],
    t0: { bounded: false, specified: false, verifiable: false, lowRisk: false, small: false, linear: false }, t2: [] });
  assert.equal(fixerBrief(c), [
    "Task card (from the merge review; the router spawned you):",
    "kind: implement",
    "files: x.ts, y.ts, z.ts",
    "check: `npm test`",
    "acceptance (the review's blocking findings):",
    "- fix F1",
    "- fix F3",
  ].join("\n"));
});

// Review F5/F4: a fixer this process did not spawn. After a restart the branch's fixer is gone (or the actor restored it without
// its ticket's guard and cwd): the branch is active again, and a restored fixer is killed, listed at session_start or announced
// later (the actor pauses what it restores). In the same process a fixer that vanished without an event, or that reported before
// its branch record, does not hold the branch either.
/** request_merge through the registered tool (the shell's ports: the fixer's liveness). */
const viaTool = async (m: ReturnType<typeof reviewRig>) =>
  ((await m.h.f.tools.get("request_merge")!.execute("t", {}, undefined, undefined, m.ctx)) as { details: { status: string } }).details;
const restarted = async (o: { listed?: boolean } = {}) => {
  const m = await rejectedTwice();
  const name = m.get().fixer!;
  const agents = o.listed ? [{ name, parent: "main", sessionId: `s-${name}`, model: "m", thinkingLevel: "high" as const, state: "idle" as const }] : [];
  const again = reviewRig({ repo: m.r, entries: m.h.f.entries.map((e) => ({ ...e })), agents });
  await again.h.router.ready();
  return { m, again, name, get: () => again.h.router.branches.get(m.r.dir, "lm/x")! };
};

test("review F5: after a restart a branch whose fixer is gone is active again; request_merge reviews it", async () => {
  const x = await restarted();
  assert.deepEqual([x.get().state, x.get().fixer, x.get().fixerRuns], ["active", undefined, 1]);
  const res = await x.again.merge();
  assert.equal(res.status, "merged", JSON.stringify(res));
});

test("review F4: a fixer the actor restored (listed at session_start, no ticket here) is killed; the branch is active", async () => {
  const x = await restarted({ listed: true });
  assert.deepEqual(x.again.h.a.killed, [x.name]);
  assert.equal(x.get().state, "active");
});

test("review F4: a restored fixer announced after session_start (the actor's restore pause) is killed", async () => {
  const x = await restarted();
  x.again.h.a.agents.push({ name: x.name, parent: "main", sessionId: `s-${x.name}`, model: "m", thinkingLevel: "high", state: "idle" });
  x.again.h.a.emit({ type: "pause", names: [x.name], ts: 0 });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(x.again.h.a.killed, [x.name]);
});

test("review F5: a fixer that vanished without an event does not hold the branch: request_merge reviews again", async () => {
  const m = await rejectedTwice();
  const name = m.get().fixer!;
  m.h.a.agents.splice(m.h.a.agents.findIndex((a) => a.name === name), 1);
  const res = await viaTool(m);
  assert.equal(res.status, "merged", JSON.stringify(res));
});

test("review F5 (spawn race): a fixer that reports before its branch record is killed and does not hold the branch", async () => {
  const m = reviewRig();
  m.h.a.api.subscribe((e) => {
    if (e.type === "spawn" && e.name.startsWith("fixer-")) m.h.a.emit({ type: "route", from: e.name, to: "main", preview: "done", buffered: false, ts: 0 });
  });
  const rec = await m.start("x", "true", "add x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  m.verdicts.push(REVISE, REVISE);
  await m.merge();
  const second = await m.merge();
  assert.equal(second.status, "fixer", JSON.stringify(second));
  const name = m.h.a.apiSpawns[2]!.args.name;
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(m.h.a.killed.includes(name), "the fixer that reported is killed (D46)");
  const res = await viaTool(m);
  assert.equal(res.status, "merged", JSON.stringify(res));
});

test("review F8: the fixer's report gives its branch back without making it the active branch", async () => {
  const m = await rejectedTwice();
  const name = m.get().fixer!;
  await m.start("y");
  m.h.a.emit({ type: "route", from: name, to: "main", preview: "done", buffered: false, ts: 0 });
  assert.equal(m.get().state, "active");
  assert.equal(m.h.router.branches.active()!.branch, "lm/y");
});
