// Local mode L4.T7 (design §3.2.2 step 3, plan S19, D25; AC-O1 policy, AC-O6, AC-F6): the router's own spawns carry a
// ticket; its spawn policy answers a known ticket first (single use) with the overseer's fields and no card parsing.
// An unknown ticket falls through to card routing.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChildTool, PolicyResult } from "../core/api.ts";
import { createTickets, overseerGuard, type Ticket } from "../core/local/overseer.ts";
import { accepted, card, harness } from "./harness.ts";

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
  const forged = await harness({ settings: { mode: "local" }, apiExt: true }).a.spawn({ name: "x", task: { ticket: "forged" } });
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
