// Local mode L4.T10 (design §3.0.3, plan S30, D26; AC-L2 review): the overseer's `review` line per attempt and the ticket
// child's `spawn` line, both text-free; a ticket child has no verdict slot, so its kill logs no `unjudged`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewEvent, serializeEvent, ticketSpawnEvent } from "../core/outcome.ts";
import type { Role } from "../core/local/overseer.ts";
import type { Finding, Verdict } from "../core/local/verdict.ts";
import { CATEGORIES } from "../core/local/verdict.ts";
import { card, harness } from "./harness.ts";
import { OPUS, rig, VALID } from "./overseer-rig.ts";
import { textFree } from "./text-free.ts";

const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const SONNET = "anthropic/claude-sonnet-5-5";
const SHA = "0123456789abcdef0123456789abcdef01234567";

test("reviewEvent: the required keys; the optional ones only when given", () => {
  const req = { reviewId: "rv-0000abcd", role: "merge" as const, member: "opus", model: OPUS, outcome: "approve" as const, attempt: 1, durationMs: 2000 };
  const head = { v: 1, ts: NOW.toISOString(), event: "review", taskId: "rv-0000abcd", role: "merge", member: "opus", model: OPUS, outcome: "approve", attempt: 1, durationMs: 2000 };
  assert.deepEqual(reviewEvent({ now: NOW, ...req }), head);
  assert.deepEqual(reviewEvent({ now: NOW, ...req, fallback: "budget", findings: 3, blocking: 1, inconsistent: true, commit: SHA, branch: "wt/a-b" }),
    { ...head, fallback: "budget", findings: 3, blocking: 1, inconsistent: true, commit: SHA, branch: "wt/a-b" });
});

test("ticketSpawnEvent: kind overseer (a fixer: implement), the ticket's role, the member's tier, model and effort", () => {
  const i = { now: NOW, taskId: "ovs-merge-1", role: "merge" as const, member: "opus", tier: "T2", model: OPUS, effort: "high" as const, sessionId: "s-ovs-merge-1", parentSessionId: "s-main" };
  const line = { v: 1, ts: NOW.toISOString(), event: "spawn", taskId: "ovs-merge-1", kind: "overseer", ticket: "merge", workerTier: "T2", workerEffort: "high",
    workerMember: "opus", workerModel: OPUS, sessionId: "s-ovs-merge-1", parentSessionId: "s-main" };
  assert.deepEqual(ticketSpawnEvent(i), line);
  assert.deepEqual(ticketSpawnEvent({ ...i, role: "fixer", taskId: "fix-1" }), { ...line, taskId: "fix-1", kind: "implement", ticket: "fixer" });
});

test("a run logs one review line per attempt and the shell one ticket spawn line per child", async () => {
  const r = rig();
  r.script.push(async () => r.tool().execute({ verdict: "APPROVE", summary: "s", findings: [
    { id: "F1", category: "scope", target: "src/a.ts:3", defect: "d", evidence: "e", fix: "f", blocking: true },
    { id: "F2", category: "check", target: "src/b.ts", defect: "d", evidence: "e", fix: "f", blocking: false }] }));
  const res = await r.run({ commit: SHA, branch: "wt/a" });
  assert.ok(res.ok);
  const ls = r.h.lines();
  const ts = (t: number) => new Date(t).toISOString();
  assert.deepEqual(ls.find((l) => l.event === "spawn"), {
    v: 1, ts: ls[0]!.ts, event: "spawn", taskId: "ovs-merge-1", kind: "overseer", ticket: "merge", workerTier: "T2", workerEffort: "high",
    workerMember: "opus", workerModel: OPUS, sessionId: "s-ovs-merge-1", parentSessionId: "s-main" });
  assert.deepEqual(ls.filter((l) => l.event === "review"), [{
    v: 1, ts: ts(r.h.clock.t), event: "review", taskId: res.reviewId, role: "merge", member: "opus", model: OPUS, outcome: "revise",
    attempt: 1, durationMs: 2000, findings: 2, blocking: 1, inconsistent: true, commit: SHA, branch: "wt/a" }]);
  assert.deepEqual(ls.map((l) => l.event), ["spawn", "review"]);
});

test("failed attempts: timeout, spawn failure, invalid and abort each get a line; the second attempt names fallback 'error'", async () => {
  const t = rig();
  t.on.each = async () => { if (t.h.a.apiSpawns.length === 2) await t.tool().execute(VALID); };
  await t.run();
  const rv = (x: ReturnType<typeof rig>) => x.h.lines().filter((l) => l.event === "review").map((l) => [l.attempt, l.member, l.model, l.outcome, l.fallback]);
  assert.deepEqual(rv(t), [[1, "opus", OPUS, "timeout", undefined], [2, "sonnet", SONNET, "approve", "error"]]);

  const f = rig();
  f.h.a.control.spawnFail = "no";
  await f.run();
  assert.deepEqual(rv(f), [[1, "opus", OPUS, "error", undefined], [2, "sonnet", SONNET, "error", "error"]]);
  assert.deepEqual(f.h.lines().filter((l) => l.event === "spawn"), []);

  const inv = rig({ overseer: { resubmits: 1 } });
  inv.on.each = async () => { await inv.tool().execute({ verdict: "MAYBE" }); };
  await inv.run();
  assert.deepEqual(rv(inv), [[1, "opus", OPUS, "invalid", undefined], [2, "sonnet", SONNET, "invalid", "error"]]);

  const ab = rig();
  const c = new AbortController();
  ab.script.push(() => c.abort());
  assert.deepEqual(await ab.run({ signal: c.signal }), { ok: false, outcome: "aborted" });
  assert.deepEqual(rv(ab), [[1, "opus", OPUS, "error", undefined]]);
});

test("AC-O4 line: with the budget spent the only attempt names fallback 'budget'", async () => {
  const r = rig({ budget: { opusUsed: 15 } });
  r.script.push(async () => r.tool().execute(VALID));
  await r.run();
  assert.deepEqual(r.h.lines().filter((l) => l.event === "review").map((l) => [l.attempt, l.member, l.outcome, l.fallback]), [[1, "sonnet", "approve", "budget"]]);
});

/** mulberry32: a seeded generator, so a failing case can be replayed. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("AC-L2: review and ticket spawn lines from generated verdicts hold no free text (spaces and fences in every text)", async () => {
  const roles: Role[] = ["merge", "delta", "plan-review", "steer"];
  for (let seed = 1; seed <= 40; seed++) {
    const g = rng(seed), pick = <T>(xs: readonly T[]): T => xs[Math.floor(g() * xs.length)]!;
    const free = (k: string) => `${k} ${seed} with spaces${g() < 0.15 ? " ```js\nx()\n```" : ""}`;
    const findings: Finding[] = [...Array(Math.floor(g() * 5))].map((_, i) => ({ id: `F${i + 1}`, category: pick(CATEGORIES),
      target: free("src/a b.ts:1"), defect: free("defect"), evidence: free("evidence"), fix: free("fix"), blocking: g() < 0.4 }));
    const v: Verdict = { verdict: pick(["APPROVE", "REVISE"] as const), summary: free("summary"), findings };
    const texts = [v.summary, ...findings.flatMap((f) => [f.target, f.defect, f.evidence, f.fix])];
    const r = rig();
    r.on.each = async () => { await r.tool().execute(v); };
    await r.run({ role: pick(roles), commit: SHA.slice(0, 7 + Math.floor(g() * 34)), branch: `wt/task-${seed}` });
    const ls = r.h.lines();
    assert.ok(ls.some((l) => l.event === "review") && ls.some((l) => l.event === "spawn"), `seed ${seed}: no review or spawn line`);
    for (const l of ls) {
      assert.deepEqual(textFree(l), [], `seed ${seed}`);
      const s = serializeEvent(l as never);
      for (const t of texts) assert.ok(s.replaceAll(JSON.stringify(t).slice(1, -1), "") === s, `seed ${seed}: a verdict text in ${s}`);
    }
  }
});

test("ticket spawn: no unjudged line after the kill; a card child still gets one; routing off writes no unrouted line", async () => {
  for (const routing of [true, false]) {
    const h = harness({ settings: { mode: "local", routing }, apiExt: true });
    const s = h.router.settings;
    const ticket = h.router.tickets.issue({ role: "merge", reviewId: "rv-0000abcd", member: "opus", model: s.models.opus!.model, effort: "high",
      cwd: "/wt", tools: s.overseer.tools, childTools: [] });
    assert.ok((await h.a.api.spawn!({ name: "ovs-merge-1", systemPrompt: "s", message: "m", task: { ticket } }, { by: "main", quiet: true })).ok);
    if (routing) assert.ok((await h.a.api.spawn!({ name: "c1", systemPrompt: "s", message: "m", task: card() })).ok);
    await h.a.api.kill!(["ovs-merge-1", ...(routing ? ["c1"] : [])]);
    const ls = h.lines();
    assert.deepEqual(ls.filter((l) => l.event === "spawn").map((l) => [l.taskId, l.kind, l.ticket]),
      [["ovs-merge-1", "overseer", "merge"], ...(routing ? [["c1", "implement", undefined]] : [])], `routing ${routing}`);
    assert.deepEqual(ls.filter((l) => l.event === "verdict").map((l) => [l.taskId, l.verdict]), routing ? [["c1", "unjudged"]] : []);
  }
});

test("a ticket spawn line carries the parent session's experiment arm (the contract requires it once the root is assigned)", async () => {
  const g = globalThis as { __piExperimentsApi_v1?: unknown };
  const saved = g.__piExperimentsApi_v1;
  try {
    g.__piExperimentsApi_v1 = { version: 1, flag: (_n: string, d: string) => d, armFor: (s: string) => (s === "s-main" ? { id: "+-+--", flags: {} } : undefined) };
    const h = harness({ settings: { mode: "local" }, apiExt: true });
    const s = h.router.settings;
    const ticket = h.router.tickets.issue({ role: "steer", reviewId: "rv-0000abcd", member: "opus", model: s.models.opus!.model, effort: "high", cwd: "/wt", childTools: [] });
    assert.ok((await h.a.api.spawn!({ name: "ovs-steer-1", systemPrompt: "s", message: "m", task: { ticket } }, { by: "main", quiet: true })).ok);
    assert.equal(h.lines().find((l) => l.event === "spawn")!.arm, "+-+--");
  } finally {
    g.__piExperimentsApi_v1 = saved;
  }
});
