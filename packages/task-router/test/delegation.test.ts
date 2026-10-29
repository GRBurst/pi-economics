// T5.19 delegation nudge: pure counter (core/delegation.ts) and the thin turn_end hook (core/nudge.ts via shell).
import { test } from "node:test";
import assert from "node:assert/strict";
import { countCalls, nudgeText } from "../core/delegation.ts";
import { briefAppend } from "../core/brief.ts";
import { planFor as tierPlanFor } from "./tier-plan.ts";
import type { Plan } from "../core/types.ts";

// The fixtures are tier plans (test/tier-plan.ts); briefAppend reads only what both shapes share.
const planFor = (...a: Parameters<typeof tierPlanFor>): Plan => tierPlanFor(...a) as unknown as Plan;
import { defaults, loadSettings } from "../core/settings.ts";
import { accepted, card, harness } from "./harness.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const D = defaults().delegation;
const on = { ...D, nudge: "on", afterCalls: 6 };
const rep = (name: string, n: number) => Array.from({ length: n }, () => name);

test("defaults: nudge on after 6 inline mechanical calls (edit write bash grep find read)", () => {
  assert.deepEqual(D, { nudge: "on", afterCalls: 6, tools: ["edit", "write", "bash", "grep", "find", "read"], rule: "off" });
});

test("countCalls: fires when the count reaches afterCalls, then resets (once per run of calls)", () => {
  assert.deepEqual(countCalls(0, rep("bash", 5), on), { count: 5, due: false });
  assert.deepEqual(countCalls(0, rep("bash", 6), on), { count: 0, due: true });
  assert.deepEqual(countCalls(5, ["read"], on), { count: 0, due: true });
  assert.deepEqual(countCalls(0, rep("edit", 7), on), { count: 1, due: true }); // the 7th starts the next run
  assert.deepEqual(countCalls(0, rep("edit", 12), on), { count: 0, due: true }); // 12 calls: one nudge per turn, not two
});

test("countCalls: spawn_subagent resets; other tools neither count nor reset", () => {
  assert.deepEqual(countCalls(5, ["spawn_subagent"], on), { count: 0, due: false });
  assert.deepEqual(countCalls(0, [...rep("bash", 4), "spawn_subagent", "bash", "bash"], on), { count: 2, due: false });
  assert.deepEqual(countCalls(3, ["context_map", "task_verdict", "send_message", "list_subagents"], on), { count: 3, due: false });
  assert.deepEqual(countCalls(0, [...rep("bash", 3), "context_map", ...rep("bash", 3)], on), { count: 0, due: true });
});

test("countCalls: the mechanical set and the threshold are settings; nudge off never fires", () => {
  assert.deepEqual(countCalls(0, rep("web_search", 3), { ...on, afterCalls: 3, tools: ["web_search"] }), { count: 0, due: true });
  assert.deepEqual(countCalls(0, rep("bash", 3), { ...on, afterCalls: 3, tools: ["web_search"] }), { count: 0, due: false });
  assert.deepEqual(countCalls(0, rep("bash", 20), { ...on, nudge: "off" }), { count: 0, due: false });
});

test("nudge text: the reminder, with the card step only when routing is on", () => {
  assert.match(nudgeText(true), /This looks delegable: if the remaining work is a bounded task, fill a task card and spawn it\./);
  assert.match(nudgeText(false), /This looks delegable: if the remaining work is a bounded task, spawn it\./);
  assert.ok(!/task card/.test(nudgeText(false)));
});

test("settings: delegation merges over the defaults, wrong types ignored", () => {
  const f = join(mkdtempSync(join(tmpdir(), "task-router-")), "settings.json");
  writeFileSync(f, JSON.stringify({ delegation: { nudge: "off", afterCalls: "many", tools: ["bash"] } }));
  assert.deepEqual(loadSettings(f).delegation, { nudge: "off", afterCalls: 6, tools: ["bash"], rule: "off" });
});

// ---- shell hook ----
const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
const turn = (tools: string[], stopReason = "toolUse") => ({ message: { stopReason }, toolResults: tools.map((toolName) => ({ toolName })) });
const nudges = (h: ReturnType<typeof harness>) => h.f.sent.filter((s) => s.msg.customType === "task-router/delegation-nudge");

test("main session: 6 mechanical calls → one steering custom message, then the count restarts", () => {
  const h = harness();
  h.f.fire("turn_end", turn(rep("bash", 3)), MAIN);
  assert.equal(nudges(h).length, 0);
  h.f.fire("turn_end", turn(rep("edit", 3)), MAIN);
  assert.equal(nudges(h).length, 1);
  const m = nudges(h)[0];
  assert.deepEqual(m.opts, { deliverAs: "steer" });
  assert.equal(m.msg.display, true);
  assert.match(m.msg.content, /fill a task card and spawn it/);
  h.f.fire("turn_end", turn(rep("read", 5)), MAIN);
  assert.equal(nudges(h).length, 1, "reset after the nudge: 5 more calls are not enough");
  h.f.fire("turn_end", turn(["read"]), MAIN);
  assert.equal(nudges(h).length, 2);
});

test("spawn_subagent and user input reset the count; extension-sourced input does not", () => {
  const h = harness();
  h.f.fire("turn_end", turn(rep("bash", 5)), MAIN);
  h.f.fire("turn_end", turn(["spawn_subagent"]), MAIN);
  h.f.fire("turn_end", turn(rep("bash", 5)), MAIN);
  assert.equal(nudges(h).length, 0, "spawn reset the first five");
  h.f.fire("input", { text: "go on", source: "interactive" }, MAIN);
  h.f.fire("turn_end", turn(rep("bash", 5)), MAIN);
  assert.equal(nudges(h).length, 0, "user input reset the second five");
  h.f.fire("input", { text: "[child report]", source: "extension" }, MAIN);
  h.f.fire("turn_end", turn(["bash"]), MAIN);
  assert.equal(nudges(h).length, 1, "an extension message (a child's reply) is not user input");
});

test("delegation.nudge off: no message", () => {
  const h = harness({ settings: { delegation: { ...D, nudge: "off" } } });
  h.f.fire("turn_end", turn(rep("bash", 30)), MAIN);
  assert.equal(nudges(h).length, 0);
});

test("never in a child session (api.list knows the session as a child)", () => {
  const h = harness();
  h.a.agents.push(
    { name: "main", parent: "main", sessionId: "s-main", model: "m", thinkingLevel: "high", state: "running" },
    { name: "kid", parent: "main", sessionId: "s-kid", model: "m", thinkingLevel: "high", state: "running" },
  );
  h.f.fire("turn_end", turn(rep("bash", 12)), { sessionManager: { getSessionId: () => "s-kid" } });
  assert.equal(nudges(h).length, 0);
  h.f.fire("turn_end", turn(rep("bash", 6)), MAIN);
  assert.equal(nudges(h).length, 1);
});

test("a turn without tool results does not nudge; routing off drops the card step from the text", () => {
  const h = harness({ settings: { routing: false } });
  h.f.fire("turn_end", turn([], "stop"), MAIN);
  h.f.fire("turn_end", turn(rep("bash", 6)), MAIN);
  assert.equal(nudges(h).length, 1);
  assert.ok(!/task card/.test(nudges(h)[0].msg.content));
});

// ---- the handoff lever ----
const HANDSHAKE = "Start immediately; no understanding/questions reply.";

test("brief: handoff=false drops the no-handshake line, the rest stays", () => {
  const s = defaults();
  const c = card();
  const p = planFor("qwen", "normal", "implement");
  const prof: import("../core/types.ts").Profile = { tools: "all", skills: [], report: "default" };
  assert.ok(briefAppend(c, p, true, prof, "", true).includes(HANDSHAKE));
  const b = briefAppend(c, p, true, prof, "", false);
  assert.ok(!b.includes("Start immediately"));
  assert.ok(b.includes("Report in ≤ 300 words"));
  assert.ok(s.delegation.nudge === "on");
});

test("policy: delegation off → the child brief has no no-handshake line; on → it has", async () => {
  const offH = harness({ settings: { delegation: { ...D, nudge: "off" } } });
  const off = accepted(await offH.a.spawn({ name: "k1", task: card() })) as { briefAppend: string };
  assert.ok(!off.briefAppend.includes(HANDSHAKE));
  const onH = harness();
  const onR = accepted(await onH.a.spawn({ name: "k1", task: card() })) as { briefAppend: string };
  assert.ok(onR.briefAppend.includes(HANDSHAKE));
});

test("countCalls: a spawn later in the same turn cancels a nudge that was due", () => {
  assert.deepEqual(countCalls(0, [...rep("bash", 6), "spawn_subagent"], on), { count: 0, due: false });
});
