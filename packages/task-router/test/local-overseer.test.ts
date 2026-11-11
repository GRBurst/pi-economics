// Local mode L4.T8–T9 (design §3.2.2, plan S20, D27–D30, D34; AC-O3, AC-O4, AC-O5 run part): running an overseer. The
// router spawns it through the API extension with a ticket, awaits its submit tool (resubmits for invalid input), kills it,
// and retries once on the fallback member. Driven by a scripted poll: each `sleep` runs the next scripted child action.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROMPT, verdictSubmit } from "../core/local/overseer.ts";
import { fakeApi } from "./fake-api.ts";
import { finding, OPUS, rig, VALID, type Ok } from "./overseer-rig.ts";

test("happy: one quiet spawn by main with a 32-hex ticket; a valid submit is recorded, the child killed, one review entry", async () => {
  const r = rig();
  const out: unknown[] = [];
  r.script.push(async () => out.push(await r.tool().execute(VALID)));
  const res = await r.run();
  assert.equal(r.h.a.apiSpawns.length, 1);
  const s = r.h.a.apiSpawns[0]!;
  assert.equal(s.args.name, "ovs-merge-1");
  assert.equal(s.args.systemPrompt, PROMPT.merge);
  assert.equal(s.args.message, "review this");
  assert.match((s.args.task as { ticket: string }).ticket, /^[0-9a-f]{32}$/);
  assert.deepEqual(s.opts, { by: "main", quiet: true });
  const p = s.policy as Ok;
  assert.equal(p.model, OPUS);
  assert.equal(p.thinkingLevel, "high");
  assert.equal(p.cwd, "/wt");
  assert.deepEqual(p.tools, r.h.router.settings.overseer.tools);
  assert.deepEqual(p.childTools!.map((t) => t.name), ["submit_verdict"]);
  assert.equal(p.toolGuard!("bash", {}), "overseer: bash is not available; report with submit_verdict");
  assert.deepEqual(out, [{ text: "recorded", terminate: true }]);
  assert.ok(res.ok);
  assert.deepEqual(res.value, VALID);
  assert.match(res.reviewId, /^rv-[0-9a-f]{8}$/);
  assert.deepEqual([res.member, res.model], ["opus", OPUS]);
  assert.deepEqual((p.meta as { taskId: string }).taskId, res.reviewId);
  assert.deepEqual(r.h.a.killed, ["ovs-merge-1"]);
  assert.deepEqual(r.entries.map((e) => e.type), ["task-router/budget", "task-router/review"]); // L4.T12: the budget entry (D30)
  assert.deepEqual(r.entries[1]!.data, { reviewId: res.reviewId, role: "merge", member: "opus", verdict: VALID, approved: true, ts: r.h.clock.t });
  assert.equal(r.h.router.tickets.owner("ovs-merge-1"), undefined);
});

test("AC-O3: a fenced summary or a duplicate id is rejected for resubmission; the run stays open until a valid submit", async () => {
  const r = rig();
  const out: Array<{ text: string; isError?: boolean; terminate?: boolean }> = [];
  r.script.push(async () => out.push(await r.tool().execute({ ...VALID, summary: "see ```x```" })));
  r.script.push(async () => {
    assert.deepEqual(r.h.a.killed, []);
    out.push(await r.tool().execute({ verdict: "REVISE", summary: "s", findings: [finding("F1"), finding("F1")] }));
  });
  r.script.push(async () => out.push(await r.tool().execute(VALID)));
  const res = await r.run();
  assert.ok(res.ok);
  assert.equal(r.h.a.apiSpawns.length, 1);
  assert.deepEqual(out.map((x) => [x.isError, x.terminate]), [[true, undefined], [true, undefined], [undefined, true]]);
  assert.equal(out[0]!.text, "invalid: $.summary: contains a code fence; resubmit");
  assert.equal(out[1]!.text, "invalid: duplicate id F1; resubmit");
});

test("AC-O3 property: with resubmits r ∈ 0…3, submissions 1…r get '; resubmit', the (r+1)-th terminates the attempt as invalid", async () => {
  for (const resubmits of [0, 1, 2, 3]) {
    const r = rig({ overseer: { resubmits } });
    const out: Array<{ text: string; isError?: boolean; terminate?: boolean }> = [];
    for (let i = 0; i <= resubmits; i++) r.script.push(async () => out.push(await r.tool().execute({ verdict: "APPROVE" })));
    const res = await r.run({ role: "steer" }); // one attempt (D28), so the run's outcome is the attempt's
    assert.equal(out.length, resubmits + 1, `r=${resubmits}`);
    for (const x of out.slice(0, -1)) assert.deepEqual([x.text, x.isError, x.terminate], ["invalid: $.summary: is required; $.findings: is required; resubmit", true, undefined]);
    assert.deepEqual(out.at(-1), { text: "invalid: $.summary: is required; $.findings: is required; no resubmits left", isError: true, terminate: true });
    assert.deepEqual(res, { ok: false, outcome: "invalid" }, `r=${resubmits}`);
    assert.deepEqual(r.h.a.killed, ["ovs-steer-1"]);
    assert.deepEqual(r.entries, [{ type: "task-router/budget", data: { opusUsed: 1, steerUsed: 1 } }]); // L4.T12: no review entry
  }
});

const SONNET = "anthropic/claude-sonnet-5-5";
const turn = (r: ReturnType<typeof rig>, name: string) => r.h.a.emit({ type: "turn", name, ts: 0 });

test("reminder: busy then idle → one 'Submit with submit_verdict.' from the router; a second idle fails the attempt → attempt 2 on the fallback", async () => {
  const r = rig();
  r.script.push(() => turn(r, "ovs-merge-1"));
  r.script.push(() => assert.deepEqual(r.h.a.sent, [{ to: "ovs-merge-1", text: "Submit with submit_verdict.", from: "router" }]));
  r.script.push(() => turn(r, "ovs-merge-1"));
  r.script.push(async () => r.tool().execute(VALID));
  const res = await r.run();
  assert.equal(r.h.a.sent.length, 1);
  assert.deepEqual(r.h.a.apiSpawns.map((s) => s.args.name), ["ovs-merge-1", "ovs-merge-2"]);
  assert.deepEqual(r.spawned(), ["ovs-merge-2", SONNET, "xhigh"]);
  assert.deepEqual(r.h.a.killed, ["ovs-merge-1", "ovs-merge-2"]);
  assert.ok(res.ok);
  assert.deepEqual([res.member, res.model], ["sonnet", SONNET]);
});

test("an idle child that never started a turn is not reminded", async () => {
  const r = rig();
  for (let i = 0; i < 5; i++) r.script.push(() => {});
  r.script.push(async () => r.tool().execute(VALID));
  assert.ok((await r.run()).ok);
  assert.deepEqual(r.h.a.sent, []);
});

test("timeout: no submit within timeoutSec → killed, attempt 2", async () => {
  const r = rig();
  const t0 = r.h.clock.t;
  r.on.each = async () => { if (r.h.a.apiSpawns.length === 2) await r.tool().execute(VALID); };
  const res = await r.run();
  assert.deepEqual(r.h.a.killed, ["ovs-merge-1", "ovs-merge-2"]);
  assert.ok(res.ok);
  assert.equal(res.member, "sonnet");
  assert.ok(r.h.clock.t - t0 >= 900_000 && r.h.clock.t - t0 < 910_000, String(r.h.clock.t - t0));
});

test("a kill or error event, or the child gone from the list, fails the attempt", async () => {
  const ends: Array<(r: ReturnType<typeof rig>) => void> = [
    (r) => r.h.a.emit({ type: "kill", name: "ovs-merge-1", ts: 0 }),
    (r) => r.h.a.emit({ type: "error", name: "ovs-merge-1", reason: "boom", ts: 0 }),
    (r) => r.h.a.agents.splice(0, r.h.a.agents.length),
  ];
  for (const end of ends) {
    const r = rig();
    r.script.push(() => end(r));
    r.script.push(async () => r.tool().execute(VALID));
    const res = await r.run();
    assert.deepEqual(r.h.a.apiSpawns.map((s) => s.args.name), ["ovs-merge-1", "ovs-merge-2"]);
    assert.ok(res.ok && res.member === "sonnet");
  }
});

test("spawn {ok: false} → attempt 2; both failing → {ok: false}", async () => {
  const r = rig();
  r.h.a.agents.push({ name: "ovs-merge-1", parent: "main", sessionId: "s-x", model: "m", thinkingLevel: undefined, state: "idle" });
  r.script.push(async () => r.tool().execute(VALID));
  const res = await r.run();
  assert.deepEqual(r.h.a.apiSpawns.map((s) => s.result.ok), [false, true]);
  assert.ok(res.ok && res.member === "sonnet");
  assert.equal(r.h.router.tickets.owner("ovs-merge-1"), undefined);

  const both = rig();
  both.h.a.control.spawnFail = "no";
  assert.deepEqual(await both.run(), { ok: false, outcome: "error", why: "no" }); // the refusal, once (L4 note decided in L6)
  assert.equal(both.h.a.apiSpawns.length, 2);
  assert.deepEqual(both.entries, []);
});

test("review F4: a spawn that fails before the policy took its ticket (a duplicate name, a throwing spawn) revokes the ticket", async () => {
  const ticketOf = (r: ReturnType<typeof rig>, i: number) => (r.h.a.apiSpawns[i]!.args.task as { ticket: string }).ticket;
  const r = rig();
  r.h.a.agents.push({ name: "ovs-merge-1", parent: "main", sessionId: "s-x", model: "m", thinkingLevel: undefined, state: "idle" });
  r.script.push(async () => r.tool().execute(VALID));
  assert.ok((await r.run()).ok);
  assert.equal(r.h.a.apiSpawns[0]!.policy, undefined); // the duplicate never reached the policy
  // The open ticket would answer with the overseer's fields; a revoked one falls through to card routing (no card: reject).
  assert.ok("reject" in await r.h.a.spawn({ name: "probe", task: { ticket: ticketOf(r, 0) } }));

  const t = rig(), tickets: string[] = [];
  t.h.a.api.spawn = async (args) => { tickets.push((args.task as { ticket: string }).ticket); throw new Error("session creation failed"); };
  assert.deepEqual(await t.run(), { ok: false, outcome: "error", why: "session creation failed" });
  assert.equal(tickets.length, 2);
  for (const [i, id] of tickets.entries()) assert.ok("reject" in await t.h.a.spawn({ name: `probe-${i}`, task: { ticket: id } }), `ticket ${i}`);
});

test("review F1: a child the router's policy did not take the ticket for (a foreign policy, none) is killed at once: error, no charge, no attempt 2", async () => {
  const foreign = fakeApi({ ext: true });
  foreign.api.registerSpawnPolicy(() => ({ model: "x/any", thinkingLevel: "low" }));
  for (const other of [foreign, fakeApi({ ext: true })]) {
    const r = rig();
    r.d.api = () => other.api;
    assert.deepEqual(await r.run(), { ok: false, outcome: "error" });
    assert.deepEqual(other.apiSpawns.map((s) => s.args.name), ["ovs-merge-1"]);
    assert.deepEqual(other.killed, ["ovs-merge-1"]);
    assert.deepEqual(r.d.budget, { opusUsed: 0, steerUsed: 0 });
    assert.deepEqual(r.entries, []);
    assert.deepEqual(r.warnings, ["task-router: ovs-merge-1 was not spawned through the task-router policy; killed, the review fails"]);
    assert.deepEqual(r.h.lines().filter((l) => l.event === "review").map((l) => [l.outcome, l.attempt]), [["error", 1]]);
  }
});

test("review F1: without the router's policy registered nothing is spawned", async () => {
  const r = rig();
  r.d.policyOn = () => false;
  assert.deepEqual(await r.run(), { ok: false, outcome: "error" });
  assert.equal(r.h.a.apiSpawns.length, 0);
});

test("both attempts invalid → {ok: false, outcome: 'invalid'}; an invalid attempt 1 is retried (D28)", async () => {
  const r = rig({ overseer: { resubmits: 0 } });
  r.on.each = async () => { await r.tool().execute({}); };
  assert.deepEqual(await r.run(), { ok: false, outcome: "invalid" });
  assert.deepEqual(r.h.a.apiSpawns.map((s) => s.args.name), ["ovs-merge-1", "ovs-merge-2"]);
});

test("AC-O4: with opusUsed = budget the only spawn is on fallbackMember/fallbackEffort and opusUsed is unchanged", async () => {
  const r = rig({ budget: { opusUsed: 15 } });
  r.script.push(async () => r.tool().execute(VALID));
  const res = await r.run();
  assert.equal(r.h.a.apiSpawns.length, 1);
  assert.deepEqual(r.spawned(), ["ovs-merge-1", SONNET, "xhigh"]);
  assert.ok(res.ok && res.member === "sonnet");
  assert.deepEqual(r.d.budget, { opusUsed: 15, steerUsed: 0 });
});

test("AC-O4 property: k successful runs → opusUsed = min(k, budget)", async () => {
  for (const budget of [1, 2, 3]) for (let k = 0; k <= budget + 2; k++) {
    const r = rig({ overseer: { budget } });
    r.on.each = async () => { await r.tool().execute(VALID); };
    for (let i = 0; i < k; i++) assert.ok((await r.run()).ok);
    assert.equal(r.d.budget.opusUsed, Math.min(k, budget), `budget ${budget}, k ${k}`);
    assert.deepEqual(r.h.a.apiSpawns.map((s) => (s.policy as Ok).model), [...Array(k)].map((_, i) => (i < budget ? OPUS : SONNET)));
  }
});

test("review L5: concurrent runs reserve the Opus budget when they pick: with one left, one runs on Opus, the other on the fallback", async () => {
  const r = rig({ overseer: { budget: 1 } });
  let release!: () => void;
  r.h.a.control.spawnGate = new Promise((res) => { release = res; });
  r.on.each = async () => { for (const s of r.h.a.apiSpawns) await (s.policy as Ok).childTools?.[0]?.execute(VALID); };
  const both = Promise.all([r.run(), r.run()]);
  release();
  const res = await both;
  assert.ok(res.every((x) => x.ok));
  assert.deepEqual(r.h.a.apiSpawns.map((s) => (s.policy as Ok).model), [OPUS, SONNET]);
  assert.deepEqual(r.d.budget, { opusUsed: 1, steerUsed: 0 });
  assert.deepEqual(r.h.lines().filter((l) => l.event === "review").map((l) => l.fallback ?? null).sort(), ["budget", null]);
});

test("review L5: a reservation whose spawn failed is released: the next run gets the last Opus review", async () => {
  const r = rig({ overseer: { budget: 1 } });
  r.h.a.control.spawnFail = "no";
  assert.deepEqual(await r.run(), { ok: false, outcome: "error", why: "no" });
  r.h.a.control.spawnFail = undefined;
  r.on.each = async () => { await r.tool().execute(VALID); };
  const res = await r.run();
  assert.ok(res.ok && res.member === "opus");
  assert.deepEqual(r.d.budget, { opusUsed: 1, steerUsed: 0 });
});

test("an Opus attempt that times out still counts (D30); attempt 2 on the fallback does not", async () => {
  const r = rig();
  r.on.each = async () => { if (r.h.a.apiSpawns.length === 2) await r.tool().execute(VALID); };
  assert.ok((await r.run()).ok);
  assert.deepEqual(r.d.budget, { opusUsed: 1, steerUsed: 0 });
});

test("budget 0: Opus is never used (the first attempt is on the fallback, opusUsed stays 0); steerBudget 0: no steer", async () => {
  const r = rig({ overseer: { budget: 0 } });
  r.script.push(async () => r.tool().execute(VALID));
  const res = await r.run();
  assert.deepEqual(r.spawned(), ["ovs-merge-1", SONNET, "xhigh"]);
  assert.ok(res.ok && res.member === "sonnet");
  assert.deepEqual(r.d.budget, { opusUsed: 0, steerUsed: 0 });
  const none = rig({ overseer: { steerBudget: 0 } });
  assert.deepEqual(await none.run({ role: "steer" }), { ok: false, outcome: "skipped" });
  assert.equal(none.h.a.apiSpawns.length, 0);
});

test("steer: steerUsed = steerBudget → skipped, no spawn; a steer spawn counts both; a failing steer gets no attempt 2", async () => {
  const full = rig({ budget: { steerUsed: 3 } });
  assert.deepEqual(await full.run({ role: "steer" }), { ok: false, outcome: "skipped" });
  assert.equal(full.h.a.apiSpawns.length, 0);

  const opusOut = rig({ budget: { opusUsed: 15 } });
  assert.deepEqual(await opusOut.run({ role: "steer" }), { ok: false, outcome: "skipped" });
  assert.equal(opusOut.h.a.apiSpawns.length, 0);

  const ok = rig();
  ok.script.push(async () => ok.tool().execute(VALID));
  assert.ok((await ok.run({ role: "steer" })).ok);
  assert.deepEqual(ok.d.budget, { opusUsed: 1, steerUsed: 1 });

  const failing = rig();
  failing.script.push(() => failing.h.a.emit({ type: "kill", name: "ovs-steer-1", ts: 0 }));
  assert.deepEqual(await failing.run({ role: "steer" }), { ok: false, outcome: "error" });
  assert.equal(failing.h.a.apiSpawns.length, 1);
});

test("abort: an aborted signal ends the run as aborted, kills the child, no attempt 2; aborted before the start → no spawn", async () => {
  const r = rig();
  const c = new AbortController();
  r.script.push(() => c.abort());
  assert.deepEqual(await r.run({ signal: c.signal }), { ok: false, outcome: "aborted" });
  assert.equal(r.h.a.apiSpawns.length, 1);
  assert.deepEqual(r.h.a.killed, ["ovs-merge-1"]);

  const early = rig();
  assert.deepEqual(await early.run({ signal: AbortSignal.abort() }), { ok: false, outcome: "aborted" });
  assert.equal(early.h.a.apiSpawns.length, 0);
});

test("review F3: every role's prompt says no go-ahead comes and that the run ends with its submit tool", () => {
  for (const [role, text] of Object.entries(PROMPT)) {
    const tool = role === "plan-author" ? "submit_plan" : "submit_verdict";
    assert.ok(text.split("\n").includes(`No one answers you and no go-ahead comes: start at once, and end by calling ${tool}.`), role);
  }
});

test("review F5 (LD14): without a cwd the overseer starts in the main checkout; the worktree is named first in its brief", async () => {
  const r = rig();
  r.script.push(async () => void (await r.tool().execute(VALID)));
  const res = await r.run({ cwd: undefined, worktree: "/repo/.worktrees/feat" });
  assert.ok(res.ok);
  const s = r.h.a.apiSpawns[0]!;
  assert.equal((s.policy as Ok).cwd, "/repo");
  assert.equal(s.args.message, "The worktree under review: /repo/.worktrees/feat (read its files by this absolute path; your cwd is the main checkout).\n\nreview this");
});

test("review F5 (LD14): a cwd inside the worktree under review, or a relative path, fails the run before any spawn", async () => {
  for (const x of [{ cwd: "/repo/.worktrees/feat" }, { cwd: "/repo/.worktrees/feat/src" }, { cwd: "repo" }, { cwd: undefined, worktree: "wt" }]) {
    const r = rig();
    assert.deepEqual(await r.run({ worktree: "/repo/.worktrees/feat", ...x }), { ok: false, outcome: "error" }, JSON.stringify(x));
    assert.equal(r.h.a.apiSpawns.length, 0);
    assert.equal(r.warnings.length, 1);
    assert.equal(r.warnings[0]!.startsWith("task-router: an overseer runs in the main checkout with absolute paths (LD14)"), true);
  }
  // A worktree next to the checkout, or a cwd that only shares a prefix with it, is fine.
  for (const x of [{ cwd: "/repo", worktree: "/repo-wt/feat" }, { cwd: "/repo/.worktrees/feature", worktree: "/repo/.worktrees/feat" }]) {
    const r = rig();
    r.script.push(async () => void (await r.tool().execute(VALID)));
    assert.equal((await r.run(x)).ok, true, JSON.stringify(x));
  }
});

test("L7.T7: a submit spec's own resubmits (plan_request: plans.rounds) stand for overseer.resubmits", async () => {
  const r = rig({ overseer: { resubmits: 0 } });
  const out: Array<{ text: string; isError?: boolean; terminate?: boolean }> = [];
  for (let i = 0; i < 3; i++) r.script.push(async () => out.push(await r.tool().execute({ verdict: "APPROVE" })));
  const res = await r.run({ role: "steer", submit: { ...verdictSubmit(), resubmits: 2 } });
  assert.deepEqual(out.map((x) => [x.isError, x.terminate]), [[true, undefined], [true, undefined], [true, true]]);
  assert.deepEqual(res, { ok: false, outcome: "invalid" });
});
