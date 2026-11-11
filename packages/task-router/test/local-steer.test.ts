// Local mode L4.T13 (design §3.1.2, §3.2; plan D31, D32; AC-H4): a persistent trip runs a `steer` overseer while its budget
// has room; its findings reach the main session as a steer message. Without room, with `hints.steer: off`, or while one
// runs, the L3 escalation block stays; a failed steer sends the escalation as the steer message (D31).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESCALATION, block } from "../core/local/hints.ts";
import { STEER_TYPE, steerInput, steerTargets } from "../core/local/steer.ts";
import type { BranchRecord } from "../core/local/branches.ts";
import { fakeGit } from "./fake-git.ts";
import type { CallRecord } from "../core/local/tripwires.ts";
import type { Verdict } from "../core/local/verdict.ts";
import { verdictSubmit } from "../core/local/overseer.ts";
import type { Deps } from "../core/shell.ts";
import { fakeApi } from "./fake-api.ts";
import { harness } from "./harness.ts";
import { finding, type Ok } from "./overseer-rig.ts";

type Out = { content: { type: string; text: string }[] } | undefined;
const READ_A = ["read", { path: "a.ts" }] as const;
const STUCK: Verdict = { verdict: "REVISE", summary: "The file is read again and again.", findings: [
  { ...finding("F1"), category: "approach", target: "a.ts", defect: "Rereads a.ts", evidence: "five identical reads", fix: "a.ts is read at most once", blocking: true },
  { ...finding("F2"), category: "correctness", fix: "the check passes." },
] };

function rig(settings: Record<string, unknown> = { mode: "local" }, entries: Array<{ type: string; data: unknown }> = [], o: Partial<Deps> & { active?: BranchRecord } = {}) {
  const { active, ...extra } = o;
  const h = harness({ settings: settings as never, apiExt: true, extra });
  h.f.entries.push(...entries);
  const ctx = {
    sessionManager: { getSessionId: () => "s-main", getBranch: () => h.f.entries.map((e) => ({ type: "custom", customType: e.type, data: e.data })) },
    cwd: "/work", getContextUsage: () => ({ tokens: 1000, percent: 10 }), hasUI: true, ui: { setStatus: () => undefined, notify: () => undefined },
  };
  h.f.fire("session_start", {}, ctx);
  if (active) h.router.branches.put(active);
  let n = 0;
  const pair = (toolName: string, input: unknown) => {
    const id = `tc${++n}`;
    h.f.fire("tool_call", { toolName, toolCallId: id, input }, ctx);
    const results = h.f.fire("tool_result", { toolName, toolCallId: id, input, content: [{ type: "text", text: `result ${id}` }], isError: false }, ctx);
    return results.find((r) => r !== undefined) as Out;
  };
  /** The overseer child submits `v` at its first poll. */
  const submits = (v: unknown) => { h.hooks.onSleep = () => { void (h.a.apiSpawns.at(-1)!.policy as Ok).childTools![0]!.execute(v); }; };
  const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); };
  const hints = () => h.lines().filter((l) => l.event === "hint").map((l) => [l.stage, l.count]);
  return { h, pair, submits, settle, hints };
}

test("AC-H4: the fifth identical call spawns one steer overseer instead of the escalation; its findings arrive as a steer message", async () => {
  const { h, pair, submits, settle, hints } = rig();
  submits(STUCK);
  for (let i = 0; i < 4; i++) pair(...READ_A);
  assert.equal(pair(...READ_A), undefined, "no escalation block");
  await settle();
  assert.deepEqual(h.a.apiSpawns.map((s) => s.args.name), ["ovs-steer-1"]);
  assert.match(String((h.a.apiSpawns[0]!.args.task as { ticket?: unknown }).ticket), /^[0-9a-f]{32}$/);
  assert.deepEqual(hints(), [["hint", 1], ["steer", 3]]);
  assert.deepEqual(h.f.sent.map((s) => [s.msg.customType, s.opts?.deliverAs]), [[STEER_TYPE, "steer"]]);
  assert.equal(h.f.sent[0]!.msg.content, [
    "[router] steer (identical-call): The file is read again and again.",
    "F1 [blocking] approach a.ts: Rereads a.ts. Evidence: five identical reads. Fix when: a.ts is read at most once",
    "F2 [non-blocking] correctness src/a.ts:1: d. Evidence: e. Fix when: the check passes",
  ].join("\n"));
  assert.deepEqual(h.router.budget, { opusUsed: 1, steerUsed: 1 });
  const input = String(h.a.apiSpawns[0]!.args.message).split("\n");
  assert.deepEqual(input.slice(0, 2), ["Trip: identical-call (3 detections since the last progress).", "The last 5 calls, oldest first (tool, target, result):"]);
  assert.equal(input.length, 7);
  assert.match(input[6]!, /^read key [0-9a-f]{8}: ok$/);
});

test("the steer input names a bash call by its command's first 200 characters (D32)", async () => {
  const { h, pair, settle } = rig();
  const command = `echo ${"y".repeat(300)}`;
  for (let i = 0; i < 5; i++) pair("bash", { command });
  await settle();
  const input = String(h.a.apiSpawns[0]!.args.message).split("\n");
  assert.equal(input[2], `bash ${JSON.stringify(command.slice(0, 200))}: ok`);
});

test("budget exhausted: steerUsed = steerBudget → the escalation block, nothing spawned", async () => {
  const { h, pair, settle } = rig({ mode: "local" }, [{ type: "task-router/budget", data: { opusUsed: 3, steerUsed: 3 } }]);
  for (let i = 0; i < 4; i++) pair(...READ_A);
  assert.deepEqual(pair(...READ_A)!.content[1], { type: "text", text: block("identical-call", 3, ESCALATION) });
  await settle();
  assert.deepEqual([h.a.apiSpawns.length, h.f.sent.length], [0, 0]);
});

test("failure (D31): a steer whose spawn fails sends the escalation as the steer message", async () => {
  const { h, pair, settle } = rig();
  h.a.control.spawnFail = "no";
  for (let i = 0; i < 4; i++) pair(...READ_A);
  assert.equal(pair(...READ_A), undefined);
  await settle();
  assert.deepEqual(h.f.sent.map((s) => [s.msg.customType, s.msg.content, s.opts?.deliverAs]),
    [[STEER_TYPE, block("identical-call", 3, ESCALATION), "steer"]]);
});

test("review F1: another extension's spawn policy holds the API (the router's did not register) → the escalation block, nothing spawned", async () => {
  const foreign = fakeApi({ ext: true });
  foreign.api.registerSpawnPolicy(() => ({ model: "x/any", thinkingLevel: "low" }));
  const { h, pair, settle } = rig({ mode: "local" }, [], { api: () => foreign.api });
  for (let i = 0; i < 4; i++) pair(...READ_A);
  assert.deepEqual(pair(...READ_A)!.content[1], { type: "text", text: block("identical-call", 3, ESCALATION) });
  await settle();
  assert.deepEqual([foreign.apiSpawns.length, h.f.sent.length], [0, 0]);
  assert.deepEqual(await h.router.overseer.run({ role: "merge", input: "x", cwd: "/wt", submit: verdictSubmit() }), { ok: false, outcome: "error" });
  assert.equal(foreign.apiSpawns.length, 0);
});

test("hints.steer off: the L3 escalation block, nothing spawned or sent", async () => {
  const { h, pair, settle } = rig({ mode: "local", hints: { steer: "off" } });
  for (let i = 0; i < 4; i++) pair(...READ_A);
  assert.deepEqual(pair(...READ_A)!.content[1], { type: "text", text: block("identical-call", 3, ESCALATION) });
  await settle();
  assert.deepEqual([h.a.apiSpawns.length, h.f.sent.length], [0, 0]);
});

test("one at a time: while a steer runs, the next escalation gets the block", async () => {
  const { h, pair, settle } = rig();
  let release!: () => void;
  h.a.control.spawnGate = new Promise((r) => { release = r; });
  for (let i = 0; i < 4; i++) pair(...READ_A);
  assert.equal(pair(...READ_A), undefined);
  for (let i = 0; i < 2; i++) assert.equal(pair(...READ_A), undefined); // counted, the hint in its cooldown
  assert.deepEqual(pair(...READ_A)!.content[1], { type: "text", text: block("identical-call", 3, ESCALATION) });
  release();
  await settle();
  assert.equal(h.a.apiSpawns.length, 1);
});

test("steerInput (D32): the trip and the last 12 calls, one line each, no bodies", () => {
  const rec = (o: Partial<CallRecord>): CallRecord => ({ tool: "read", key: "read:0123456789abcdef", isWrite: false, turn: 1, ...o });
  const records = [
    ...Array.from({ length: 3 }, () => rec({ tool: "ls", key: "ls:ffffffffffff" })),
    rec({}),
    rec({ tool: "bash", key: "bash:aaaa", cmd: "npm test -- --grep \"x\"", isError: true, errSig: `error: expected # got #${" x".repeat(100)}` }),
    rec({ tool: "edit", key: "edit:bbbb", isWrite: true, path: "/work/src/a.ts", hashBefore: "h1", hashAfter: "h1" }),
    rec({ tool: "write", key: "write:cccc", isWrite: true, path: "/work/src/b.ts", hashBefore: "h1", hashAfter: "h2" }),
    ...Array.from({ length: 8 }, () => rec({})),
  ];
  const text = steerInput("repeated-error", 3, records, (p) => p.replace("/work/", ""));
  assert.equal(text, [
    "Trip: repeated-error (3 detections since the last progress).",
    "The last 12 calls, oldest first (tool, target, result):",
    "read key 01234567: ok",
    `bash "npm test -- --grep \\"x\\"": error ${`error: expected # got #${" x".repeat(100)}`.slice(0, 120).trimEnd()}`,
    "edit src/a.ts: ok, file unchanged",
    "write src/b.ts: ok, file changed",
    ...Array.from({ length: 8 }, () => "read key 01234567: ok"),
  ].join("\n"));
  assert.equal(steerInput("churn", 4, [], (p) => p), "Trip: churn (4 detections since the last progress).\nThe last 0 calls, oldest first (tool, target, result):");
});

// --- L5.T13: the branch part of the steer input, and its targets (design §3.1.2; plan D32, D33) ---------------------------

const BRANCH: BranchRecord = { repo: "/r/x", branch: "lm/a", worktree: "/wt", base: "B", state: "active", rejections: 0, fixerRuns: 0, goal: "add parse", check: "npm test -- parse" };
const READ1: CallRecord = { tool: "read", key: "read:0123456789abcdef", isWrite: false, turn: 1 };
const HEAD = ["Trip: identical-call (3 detections since the last progress).", "The last 1 calls, oldest first (tool, target, result):", "read key 01234567: ok"];

test("steerInput with a branch: Goal, Check and the diff (≤ 80 lines) after the call lines; (no changes) for an empty diff", () => {
  const id = (p: string) => p;
  assert.equal(steerInput("identical-call", 3, [READ1], id, { goal: "add parse", check: "npm test -- parse", diff: "diff --git a/a.ts b/a.ts\n+x" }),
    [...HEAD, "Goal: add parse", "Check: npm test -- parse", "Diff (≤ 80 lines):", "diff --git a/a.ts b/a.ts", "+x"].join("\n"));
  assert.equal(steerInput("identical-call", 3, [READ1], id, { goal: "g", check: "c", diff: "" }), [...HEAD, "Goal: g", "Check: c", "Diff (≤ 80 lines):", "(no changes)"].join("\n"));
  assert.equal(steerInput("identical-call", 3, [READ1], id, { goal: "two\nlines  \r\nof goal", check: "make\ttest" }),
    [...HEAD, "Goal: two lines of goal", "Check: make test"].join("\n"), "one line each; a part that is missing is left out");
  assert.equal(steerInput("identical-call", 3, [READ1], id, {}), HEAD.join("\n"));
  assert.equal(steerInput("identical-call", 3, [READ1], id), HEAD.join("\n"));
});

test("steerTargets (D33): the written paths of the records (as the input shows them) and the branch's changed files", () => {
  const rel = (p: string) => p.replace("/wt/", "");
  const w = (path: string): CallRecord => ({ tool: "edit", key: "k", isWrite: true, path, turn: 1 });
  assert.deepEqual([...steerTargets([READ1, w("/wt/src/a.ts"), w("/wt/src/a.ts"), w("/wt/b.ts")], [{ path: "src/c.ts" }, { path: "src/a.ts" }], rel)].sort(), ["b.ts", "src/a.ts", "src/c.ts"]);
  assert.deepEqual([...steerTargets([READ1], [], rel)], []);
});

function branchRig() {
  const fake = fakeGit({ repos: [{ root: "/r/x" }] });
  fake.diffs.set("/wt", "diff --git a/src/p.ts b/src/p.ts\n+x");
  fake.stats.set("/wt", [{ path: "src/p.ts", added: 1, deleted: 0 }]);
  return { fake, ...rig({ mode: "local" }, [], { git: fake.git, active: BRANCH }) };
}

test("AC-H4 with an active branch: the steer input carries the goal, the check and the diff; the overseer reads the worktree by its absolute path and runs in the main checkout (LD14)", async () => {
  const { h, fake, pair, submits, settle } = branchRig();
  submits(STUCK);
  for (let i = 0; i < 5; i++) pair(...READ_A);
  await settle();
  const message = String(h.a.apiSpawns[0]!.args.message);
  assert.ok(message.endsWith(["Goal: add parse", "Check: npm test -- parse", "Diff (≤ 80 lines):", "diff --git a/src/p.ts b/src/p.ts", "+x"].join("\n")), message);
  assert.ok(message.startsWith("The worktree under review: /wt (read its files by this absolute path; your cwd is the main checkout).\n\nTrip:"), message);
  assert.equal((h.a.apiSpawns[0]!.policy as Ok).cwd, "/work");
  assert.deepEqual(fake.calls.filter((c) => c.startsWith("diff")), ["diffStat /wt B", "diff /wt B  80"]);
});

test("D33: with an active branch a steer finding must name a written or changed file; another target goes back for resubmission", async () => {
  const { h, pair, settle } = branchRig();
  const outs: { text: string; isError?: boolean }[] = [];
  h.hooks.onSleep = () => {
    if (outs.length) return;
    const tool = (h.a.apiSpawns.at(-1)!.policy as Ok).childTools![0]!;
    void (async () => {
      outs.push(await tool.execute({ ...STUCK, findings: [{ ...finding("F1"), target: "src/other.ts:3" }] }));
      outs.push(await tool.execute({ ...STUCK, findings: [{ ...finding("F1"), target: "src/p.ts:3" }] }));
    })();
  };
  for (let i = 0; i < 5; i++) pair(...READ_A);
  await settle();
  assert.deepEqual(outs.map((o) => [o.isError, o.text]), [[true, "invalid: target src/other.ts:3 is not in the diff or plan; resubmit"], [undefined, "recorded"]]);
  assert.equal(h.f.sent.length, 1);
});

test("without an active branch the input and the overseer's cwd are as in L4", async () => {
  const { h, pair, submits, settle } = rig();
  submits(STUCK);
  for (let i = 0; i < 5; i++) pair(...READ_A);
  await settle();
  assert.ok(!String(h.a.apiSpawns[0]!.args.message).includes("Goal:"));
  assert.equal((h.a.apiSpawns[0]!.policy as Ok).cwd, "/work");
});
