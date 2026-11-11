// Local mode L4.T7 (design §3.2.2 step 3, plan S19, D25; AC-O1 policy, AC-O6, AC-F6): the router's own spawns carry a
// ticket; its spawn policy answers a known ticket first (single use) with the overseer's fields and no card parsing.
// An unknown ticket falls through to card routing.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChildTool, PolicyResult } from "../core/api.ts";
import { createTickets, overseerGuard, type Ticket } from "../core/local/overseer.ts";
import { accepted, card, harness } from "./harness.ts";
import { join } from "node:path";
import { createMemberCounter } from "../core/counter.ts";
import { memberState, PENDING_MS } from "../core/policy.ts";

type Ok = Exclude<PolicyResult, { reject: string }>;
type H = ReturnType<typeof harness>;
const submit: ChildTool = { name: "submit_verdict", description: "d", parameters: { type: "object" }, execute: async () => ({ text: "recorded", terminate: true }) };
const ticketOf = (h: H, o: Partial<Ticket> = {}): Ticket => {
  const s = h.router.settings, tools = s.overseer.tools;
  return { role: "merge", reviewId: "rv-0000abcd", member: "opus", model: s.models.opus!.model, effort: "high", cwd: "/wt",
    tools, childTools: [submit], toolGuard: overseerGuard([...tools, submit.name]), ...o };
};
const OPUS = "anthropic/claude-opus-5-5";

test("AC-O1 policy: a ticket spawn gets the ticket's model, effort, cwd, overseer tools, its child tool, the guard and meta", async () => {
  const h = harness({ settings: { mode: "local" }, apiExt: true });
  const id = h.router.tickets.issue(ticketOf(h));
  assert.match(id, /^[0-9a-f]{32}$/);
  const r = accepted(await h.a.spawn({ name: "ovs-merge-1", task: { ticket: id } })) as Ok;
  assert.equal(r.model, OPUS);
  assert.equal(r.thinkingLevel, "high");
  assert.deepEqual(r.tools, h.router.settings.overseer.tools);
  assert.deepEqual(r.childTools?.map((t) => t.name), ["submit_verdict"]);
  assert.equal(r.childTools![0], submit);
  assert.equal(r.cwd, "/wt");
  for (const t of ["bash", "edit", "write", "send_message", "spawn_subagent"]) assert.equal(typeof await r.toolGuard!(t, {}), "string", t);
  for (const t of ["read", "submit_verdict"]) assert.equal(await r.toolGuard!(t, {}), undefined, t);
  assert.equal(r.toolGuard!("bash", {}), "overseer: bash is not available; report with submit_verdict");
  assert.deepEqual(r.meta, { taskId: "rv-0000abcd", role: "merge" });
  assert.equal(r.briefAppend, undefined);
  assert.equal(h.router.tickets.owner("ovs-merge-1")?.reviewId, "rv-0000abcd");
});

test("single use: the same ticket again → card routing (the result for a task without a card)", async () => {
  const h = harness({ settings: { mode: "local" }, apiExt: true });
  const id = h.router.tickets.issue(ticketOf(h));
  accepted(await h.a.spawn({ name: "ovs-merge-1", task: { ticket: id } }));
  const again = await h.a.spawn({ name: "ovs-merge-2", task: { ticket: id } });
  assert.deepEqual(again, await harness({ settings: { mode: "local" } }).a.spawn({ name: "ovs-merge-2", task: {} }));
  assert.ok("reject" in again);
});

test("AC-O6: a forged ticket is a card without its fields: the result equals the one without the ticket", async () => {
  const hf = harness({ settings: { mode: "local" }, apiExt: true });
  hf.router.tickets.issue(ticketOf(hf)); // an open ticket the forged id must not reach (plan §11)
  const forged = await hf.a.spawn({ name: "x", task: { ticket: "forged" } });
  assert.deepEqual(forged, await harness({ settings: { mode: "local" }, apiExt: true }).a.spawn({ name: "x", task: {} }));
  const withCard = await harness({ settings: { mode: "local" } }).a.spawn({ name: "c1", task: { ...card(), ticket: "0".repeat(32) } });
  const plain = await harness({ settings: { mode: "local" } }).a.spawn({ name: "c1", task: card() });
  assert.equal(JSON.stringify(withCard), JSON.stringify(plain));
  assert.ok(!("reject" in plain));
});

test("AC-F6: a settings force does not touch a ticket spawn (the ticket's model, nothing used); the next card spawn is forced", async () => {
  const h = harness({ settings: { mode: "local", force: { model: "sonnet", thinkingLevel: "" } }, apiExt: true });
  // The settings force resolves at session_start against the model registry (core/forceinstall.ts).
  h.f.fire("session_start", {}, { modelRegistry: { find: (p: string, id: string) => ({ provider: p, id }), getAvailable: () => [] } });
  const r = accepted(await h.a.spawn({ name: "ovs-merge-1", task: { ticket: h.router.tickets.issue(ticketOf(h)) } })) as Ok;
  assert.equal(r.model, OPUS);
  assert.deepEqual(h.lines().filter((l) => l.event === "force" && l.action === "used"), []);
  const c = accepted(await h.a.spawn({ name: "c1", task: card() })) as Ok;
  assert.equal(c.model, "anthropic/claude-sonnet-5-5");
});

test("routing off: the ticket is still honoured", async () => {
  const h = harness({ settings: { mode: "local", routing: false }, apiExt: true });
  const r = accepted(await h.a.spawn({ name: "ovs-merge-1", task: { ticket: h.router.tickets.issue(ticketOf(h)) } })) as Ok;
  assert.equal(r.model, OPUS);
  assert.equal(r.cwd, "/wt");
  assert.deepEqual(r.meta, { taskId: "rv-0000abcd", role: "merge" });
});

test("tickets: 32 hex from the source, single use, owner by name with the caller's session, forget", () => {
  let n = 0;
  const t = createTickets((bytes) => (n++).toString(16).padStart(bytes * 2, "0"));
  const tk = { role: "steer", reviewId: "rv-1", member: "opus", model: OPUS, effort: "high", cwd: "/w", childTools: [] } as Ticket;
  const id = t.issue(tk);
  assert.equal(id, "0".repeat(32));
  assert.equal(t.take(42, "a"), undefined);
  assert.equal(t.take("f".repeat(32), "a"), undefined);
  assert.equal(t.take(id, "ovs-steer-1", "s-main"), tk);
  assert.equal(t.take(id, "ovs-steer-2"), undefined);
  assert.deepEqual(t.owner("ovs-steer-1"), { ...tk, parentSession: "s-main" }); // the caller's session for the spawn line
  assert.equal(t.owner("ovs-steer-2"), undefined);
  t.forget("ovs-steer-1");
  assert.equal(t.owner("ovs-steer-1"), undefined);
});

test("the fake API's spawn (ext) runs the policy as `by`, records it, lists the child and emits spawn; kill removes it", async () => {
  const h = harness({ settings: { mode: "local" }, apiExt: true });
  const id = h.router.tickets.issue(ticketOf(h));
  const r = await h.a.api.spawn!({ name: "ovs-merge-1", systemPrompt: "s", message: "m", task: { ticket: id } }, { by: "main", quiet: true });
  assert.deepEqual(r, { ok: true, name: "ovs-merge-1", sessionId: "s-ovs-merge-1" });
  assert.equal(h.a.apiSpawns.length, 1);
  assert.equal(h.a.agents.find((a) => a.name === "ovs-merge-1")?.state, "idle");
  assert.deepEqual(await h.a.api.kill!(["ovs-merge-1", "nope"]), ["ovs-merge-1"]);
  assert.deepEqual(h.a.killed, ["ovs-merge-1"]);
  assert.equal(h.a.agents.length, 0);
  assert.equal(harness().a.api.spawn, undefined);
});

// ── The L4 open note, decided in L6 (orchestrator): ticket spawns (overseers, the merge review, the fixer) count toward
// `dailyCap` and respect member slots, like routed children. ──
const counterOf = (h: H) => createMemberCounter(join(h.agentDir, "task-router", "member-count.json"), () => new Date(h.clock.t));
const apiSpawn = (h: H, name: string, t: Ticket) =>
  h.a.api.spawn!({ name, systemPrompt: "s", message: "m", task: { ticket: h.router.tickets.issue(t) } }, { by: "main", quiet: true });

test("caps: a ticket spawn on a member at its dailyCap is refused, its ticket spent; under the cap it runs", async () => {
  const h = harness({ settings: { mode: "local", models: { opus: { dailyCap: 2 } } } as never, apiExt: true });
  counterOf(h).bump("opus");
  assert.equal((await apiSpawn(h, "ovs-merge-1", ticketOf(h))).ok, true, "1 of 2 used");
  counterOf(h).bump("opus");
  const r = await apiSpawn(h, "ovs-merge-2", ticketOf(h));
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /opus reached its dailyCap \(2\)/);
  assert.equal(h.router.tickets.owner("ovs-merge-2"), undefined, "a refused ticket child is no owner");
  assert.equal(h.a.agents.some((a) => a.name === "ovs-merge-2"), false);
});

test("caps: a ticket child's turns count toward its member's dailyCap; a forced ticket's do not (it runs on another model)", async () => {
  const h = harness({ settings: { mode: "local", models: { opus: { dailyCap: 9 }, sonnet: { dailyCap: 9 } } } as never, apiExt: true });
  assert.equal((await apiSpawn(h, "ovs-merge-1", ticketOf(h))).ok, true);
  h.a.emit({ type: "turn", name: "ovs-merge-1", ts: 0 });
  h.a.emit({ type: "turn", name: "ovs-merge-1", ts: 0 });
  assert.equal(counterOf(h).today("opus"), 2);
  const forced = ticketOf(h, { role: "fixer", member: "sonnet", model: OPUS, forced: { source: "command", routedModel: "anthropic/claude-sonnet-5-5", routedEffort: "high" } });
  assert.equal((await apiSpawn(h, "fixer-abcdef", forced)).ok, true);
  h.a.emit({ type: "turn", name: "fixer-abcdef", ts: 0 });
  assert.equal(counterOf(h).today("sonnet"), 0);
});

test("slots: a ticket child holds a slot of its member (pending or running); a ticket spawn on a full member is refused", async () => {
  const h = harness({ settings: { mode: "local", models: { opus: { slots: 1 } } } as never, apiExt: true });
  assert.equal((await apiSpawn(h, "ovs-merge-1", ticketOf(h))).ok, true);
  const full = await apiSpawn(h, "ovs-merge-2", ticketOf(h));
  assert.equal(full.ok, false, "the first child is pending (just spawned)");
  assert.match((full as { reason: string }).reason, /opus has no free slot \(1\)/);
  h.clock.t += PENDING_MS + 1;
  h.a.agents.find((a) => a.name === "ovs-merge-1")!.state = "running";
  assert.equal((await apiSpawn(h, "ovs-merge-3", ticketOf(h))).ok, false, "a running child holds its slot");
  h.a.agents.find((a) => a.name === "ovs-merge-1")!.state = "idle";
  assert.equal((await apiSpawn(h, "ovs-merge-4", ticketOf(h))).ok, true, "an idle one past its pending time does not");
});

test("slots: routed spawns count the ticket children on a member (memberState)", async () => {
  const h = harness({ settings: { mode: "local", models: { opus: { slots: 1 } } } as never, apiExt: true });
  const m = { ...h.router.settings.models.opus!, name: "opus" } as never;
  const tickets = createTickets(() => "0".repeat(32));
  const d = { blocks: new Map(), counter: { today: () => 0 }, children: new Map(), tickets } as never;
  assert.equal(memberState(d, m, new Map(), 1000).free, true);
  tickets.take(tickets.issue(ticketOf(h)), "ovs-merge-1", "s-main", 1000);
  assert.equal(memberState(d, m, new Map(), 1000).free, false, "a pending ticket child");
  assert.equal(memberState(d, m, new Map([["ovs-merge-1", "running"]]), 1000 + PENDING_MS + 1).free, false, "a running ticket child");
  assert.equal(memberState(d, m, new Map([["ovs-merge-1", "idle"]]), 1000 + PENDING_MS + 1).free, true);
  tickets.take(tickets.issue(ticketOf(h, { member: "sonnet" })), "fixer-1", "s-main", 1000);
  tickets.forget("ovs-merge-1");
  assert.equal(memberState(d, m, new Map(), 1000).free, true, "another member's ticket child");
});

// ── L8 (open from the L6 fixes): ticket spawns respect health and provider blocks like routed spawns. A member whose server is
// down or busy, or that a provider limit blocked, is unavailable: its ticket spawn is refused, so the overseer's fallback
// attempt or the fail-closed path applies. ──
test("health: a ticket spawn on a member whose server is down is refused; a busy server has no free slot; an up one runs", async () => {
  const h = harness({ settings: { mode: "local", models: { opus: { health: "http://localhost:11546" } } } as never, apiExt: true });
  h.health.health = 0;
  const down = await apiSpawn(h, "ovs-merge-1", ticketOf(h));
  assert.deepEqual(down, { ok: false, reason: "task-router: opus is down (its health check fails)" });
  assert.equal(h.router.tickets.owner("ovs-merge-1"), undefined, "a refused ticket child is no owner");
  h.health.health = 200; h.health.slots = 503; h.clock.t += 31_000; // past the probe's cache
  const busy = await apiSpawn(h, "ovs-merge-2", ticketOf(h));
  assert.deepEqual(busy, { ok: false, reason: "task-router: opus has no free slot (its server is busy)" });
  h.health.slots = 200; h.clock.t += 31_000;
  assert.equal((await apiSpawn(h, "ovs-merge-3", ticketOf(h))).ok, true);
});

test("blocks: a ticket spawn on a member a provider limit blocked is refused until the block ends", async () => {
  const h = harness({ base: "today", settings: { mode: "local" } as never, apiExt: true });
  accepted(await h.a.spawn({ name: "q1", task: card() })); // routed to the free cloud member
  h.a.emit({ type: "error", name: "q1", reason: "429: free-models-per-day", ts: 1 });
  await new Promise((r) => setImmediate(r));
  const cloud = { member: "qwen-cloud", model: h.router.settings.models["qwen-cloud"]!.model };
  const until = new Date(Date.UTC(2026, 9, 3)).toISOString(); // the harness clock's next midnight (UTC)
  const r = await apiSpawn(h, "ovs-merge-1", ticketOf(h, cloud));
  assert.deepEqual(r, { ok: false, reason: `task-router: qwen-cloud is blocked until ${until}` });
  h.clock.t = Date.UTC(2026, 9, 3) + 1;
  assert.equal((await apiSpawn(h, "ovs-merge-2", ticketOf(h, cloud))).ok, true);
});
