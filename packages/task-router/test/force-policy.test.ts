// Local mode L2.T5 (design §3.6.3, LD4; AC-F1, AC-F2, AC-F4, AC-F5): the spawn policy's force branch. A forced spawn is
// routed as usual (the counterfactual is logged) and then runs on the forced model and effort, around acceptModel.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RouterSettings } from "../core/types.ts";
import { T0_ALL, accepted, card, harness } from "./harness.ts";

type H = ReturnType<typeof harness>;
const SONNET = "anthropic/claude-sonnet-5-5", HAIKU = "anthropic/claude-haiku-5-5", OPUS = "anthropic/claude-opus-5-5", QWEN = "llama/qwen3.8";
const KNOWN = [HAIKU, SONNET, OPUS, QWEN, "other/model"];
const FORCED_KEYS = ["forced", "forceSource", "routedModel", "routedEffort"];
function setup(s: Partial<RouterSettings> = {}, health?: { health: number; slots: number }) {
  const h = harness({ settings: s, health });
  const status: [string, string | undefined][] = [];
  const ctx = {
    hasUI: true,
    modelRegistry: { find: (p: string, id: string) => (KNOWN.includes(`${p}/${id}`) ? { provider: p, id } : undefined), getAvailable: () => [] },
    ui: { notify: () => undefined, setStatus: (k: string, v: string | undefined) => void status.push([k, v]) },
    sessionManager: { getSessionId: () => "s-main", getBranch: () => h.f.entries.map((e) => ({ type: "custom", customType: e.type, data: e.data })) },
  };
  h.f.fire("session_start", {}, ctx);
  const force = async (args: string): Promise<void> => { await h.f.commands.get("force")!.handler(args, ctx); };
  return { h, force, status };
}
/** Spawn a card, then the API's spawn event; the result and the spawn line. */
async function spawn(h: H, name: string, task = card(), extra: Record<string, unknown> = {}) {
  const r = accepted(await h.a.spawn({ name, task, ...extra })) as any;
  h.a.emit({ type: "spawn", name, by: "main", parent: "main", childSessionId: `s-${name}`, ts: 1 });
  return { r, line: h.lines().find((l) => l.event === "spawn" && l.taskId === name)! };
}
const forceLines = (h: H) => h.lines().filter((l) => l.event === "force").map((l) => [l.action, l.source]);
const forced = (l: Record<string, any>) => Object.fromEntries(FORCED_KEYS.filter((k) => k in l).map((k) => [k, l[k]]));
const settle = () => new Promise((r) => setImmediate(r));

test("AC-F1: /force sonnet high next:2 — two forced spawns on Sonnet at high, the third routed; set, used, used, expired", async () => {
  const { h, force, status } = setup();
  await force("sonnet high next:2");
  const a = await spawn(h, "c1"), b = await spawn(h, "c2"), c = await spawn(h, "c3");
  assert.deepEqual([a.r.model, b.r.model, c.r.model], [SONNET, SONNET, QWEN]);
  assert.deepEqual([a.r.thinkingLevel, b.r.thinkingLevel, c.r.thinkingLevel], ["high", "high", "xhigh"]);
  for (const x of [a, b]) {
    assert.deepEqual(forced(x.line), { forced: true, forceSource: "command", routedModel: QWEN, routedEffort: "xhigh" });
    assert.deepEqual([x.line.workerTier, x.line.workerEffort, x.line.workerMember, x.line.workerModel, x.line.startEffort], ["qwen", "xhigh", "sonnet", SONNET, "high"]);
    assert.ok(x.line.reasons.includes(`force: ${SONNET} high (command)`), JSON.stringify(x.line.reasons));
  }
  assert.deepEqual(forced(c.line), {});
  assert.deepEqual(forceLines(h), [["set", "command"], ["used", "command"], ["used", "command"], ["expired", "command"]]);
  assert.deepEqual(h.lines().filter((l) => l.event === "force" && l.action !== "set").map((l) => [l.model, l.effort]), [[SONNET, "high"], [SONNET, "high"], [SONNET, "high"]]);
  // the countdown is stored and shown: 2 left, 1 left, then cleared
  assert.deepEqual(h.f.entries.map((e) => e.data), [
    { model: SONNET, thinkingLevel: "high", scope: "next", remaining: 2, source: "command" },
    { model: SONNET, thinkingLevel: "high", scope: "next", remaining: 1, source: "command" },
    { cleared: true },
  ]);
  assert.deepEqual(status, [["task-router", `force ${SONNET} high (2 left)`], ["task-router", `force ${SONNET} high (1 left)`], ["task-router", undefined]]);
});

test("AC-F2: /force haiku max on a card routed to Sonnet — exactly Haiku at max, no rejection; the explicit model is rejected", async () => {
  const task = card({ t0: { ...T0_ALL, specified: false } });
  const plain = harness();
  const r0 = await plain.a.spawn({ name: "c0", task, model: HAIKU });
  assert.ok("reject" in r0 && r0.reject.includes("below the routed level"), JSON.stringify(r0)); // acceptModel's rule, without a force
  const { h, force } = setup();
  await force("haiku max");
  const { r, line } = await spawn(h, "c1", task, { model: OPUS, thinkingLevel: "low" }); // the explicit arguments yield to the force
  assert.deepEqual([r.model, r.thinkingLevel], [HAIKU, "max"]);
  assert.deepEqual(forced(line), { forced: true, forceSource: "command", routedModel: SONNET, routedEffort: "high" });
});

test("AC-F4 precedence: a resolvable settings force applies to every spawn; a command force overrides it; /force off returns to it", async () => {
  const { h, force } = setup({ force: { model: "sonnet", thinkingLevel: "" } });
  const a = await spawn(h, "c1"), b = await spawn(h, "c2");
  for (const x of [a, b]) {
    assert.deepEqual([x.r.model, x.r.thinkingLevel], [SONNET, "xhigh"]); // no effort: the routed effort, literally (plan D11)
    assert.equal(x.line.forceSource, "settings");
  }
  await force("opus");
  const c = await spawn(h, "c3");
  assert.deepEqual([c.r.model, c.line.forceSource], [OPUS, "command"]);
  await force("off");
  const d = await spawn(h, "c4");
  assert.deepEqual([d.r.model, d.line.forceSource], [SONNET, "settings"]);
  assert.deepEqual(forceLines(h), [["used", "settings"], ["used", "settings"], ["set", "command"], ["used", "command"], ["clear", "command"], ["used", "settings"]]);
});

test("AC-F5: a forced spawn's provider error is not rerouted (an unforced one is)", async () => {
  const { h, force } = setup();
  await spawn(h, "u1"); // unforced, on Qwen: an error moves it (the contrast)
  h.a.emit({ type: "error", name: "u1", reason: "500 upstream", ts: 2 });
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(h.lines().filter((l) => l.event === "reroute").length, 1);
  await force("sonnet");
  await spawn(h, "f1");
  const retunes = h.a.retunes.length;
  h.a.emit({ type: "error", name: "f1", reason: "500 upstream", ts: 3 });
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(h.a.retunes.length, retunes);
  assert.deepEqual(h.lines().filter((l) => l.event === "reroute").map((l) => l.taskId), ["u1"]);
});

test("non-member: /force other/model starts at once on that model, no workerMember, and its turn events do not throw", async () => {
  const { h, force } = setup();
  await force("other/model max");
  const { r, line } = await spawn(h, "n1");
  assert.deepEqual([r.model, r.thinkingLevel], ["other/model", "max"]);
  assert.deepEqual(h.sleeps, []);
  assert.ok(!("workerMember" in line), JSON.stringify(line));
  assert.deepEqual([line.workerModel, line.startEffort, line.waitMs, line.forced], ["other/model", "max", 0, true]);
  h.a.agents.push({ name: "n1", parent: "main", sessionId: "s-n1", model: "other/model", thinkingLevel: "max", state: "running", contextTokens: 900_000 });
  for (let i = 0; i < 3; i++) h.a.emit({ type: "turn", name: "n1", ts: 4 }); // X6: no member, no window, no context note
  h.a.emit({ type: "error", name: "n1", reason: "500 upstream", ts: 5 });
  for (let i = 0; i < 4; i++) await settle();
  assert.deepEqual(h.a.sent.filter((m) => m.text.includes("context")), []);
  assert.equal(h.lines().filter((l) => l.event === "reroute").length, 0);
  // the next routed spawn is not held by it
  await force("off");
  assert.equal((await spawn(h, "q1")).r.model, QWEN);
});

test("a forced member with no free slot is rejected, and the force is not used", async () => {
  const { h, force } = setup({ queueMaxSec: 0 });
  await force("qwen-local next");
  await spawn(h, "c1"); // routed to qwen-local by itself: the countdown spends it
  const before = h.f.entries.length;
  await force("qwen-local next");
  h.a.agents.push({ name: "c1", parent: "main", sessionId: "s-c1", model: QWEN, thinkingLevel: "xhigh", state: "running" });
  const r = await h.a.spawn({ name: "c2", task: card() });
  assert.ok("reject" in r && r.reject.startsWith(`force ${QWEN} (/force): `), JSON.stringify(r));
  assert.equal(h.f.entries.length, before + 1); // only the set: no countdown
  assert.deepEqual(forceLines(h).slice(-1), [["set", "command"]]);
});

// L8 (the L2 wart): a rejected forced spawn names its force and how to end it; "leave `model` unset" would not help.
test("a rejected forced spawn names the force (/force or the settings) and how to clear it", async () => {
  const full = async (s: Partial<RouterSettings>, set?: string) => {
    const { h, force } = setup({ queueMaxSec: 0, ...s });
    await spawn(h, "c1"); // on qwen-local, routed or forced: its only slot
    h.a.agents.push({ name: "c1", parent: "main", sessionId: "s-c1", model: QWEN, thinkingLevel: "xhigh", state: "running" });
    if (set) await force(set);
    const r = await h.a.spawn({ name: "c2", task: card() });
    return "reject" in r ? r.reject : JSON.stringify(r);
  };
  assert.equal(await full({}, "qwen-local"), `force ${QWEN} (/force): no free slot after 0 s; \`/force off\` clears it`);
  assert.equal(await full({ force: { model: "qwen-local", thinkingLevel: "" } }),
    `force ${QWEN} (settings \`force.model\`): no free slot after 0 s; an empty \`force.model\` in the task-router settings clears it, \`/force <model>\` overrides it for this session`);
});

// spot-check F9: the other cause, and a command force over a settings force
test("a forced member whose server is down is rejected with the force named", async () => {
  const down = async (s: Partial<RouterSettings>, set?: string) => {
    const { h, force } = setup(s, { health: 0, slots: 0 });
    if (set) await force(set);
    const r = await h.a.spawn({ name: "c1", task: card() });
    return "reject" in r ? r.reject : JSON.stringify(r);
  };
  assert.equal(await down({}, "qwen-local"), `force ${QWEN} (/force): down; \`/force off\` clears it`);
  assert.equal(await down({ force: { model: "qwen-local", thinkingLevel: "" } }),
    `force ${QWEN} (settings \`force.model\`): down; an empty \`force.model\` in the task-router settings clears it, \`/force <model>\` overrides it for this session`);
});

test("spot-check F9: a command force over a settings force says that /force off hands the spawn back to the settings force", async () => {
  const { h, force } = setup({ queueMaxSec: 0, force: { model: "sonnet", thinkingLevel: "" } });
  await force("qwen-local");
  await spawn(h, "c0"); // takes the one slot
  h.a.agents.push({ name: "c0", parent: "main", sessionId: "s-c0", model: QWEN, thinkingLevel: "xhigh", state: "running" });
  const r = await h.a.spawn({ name: "c1", task: card() });
  assert.ok("reject" in r, JSON.stringify(r));
  assert.equal(r.reject, `force ${QWEN} (/force): no free slot after 0 s; \`/force off\` clears it, and the settings force ${SONNET} (settings \`force.model\`) then applies`);
});

test("routing off (plan D12): the force is not applied", async () => {
  const { h, force } = setup({ routing: false });
  await force("sonnet high");
  const r = await h.a.spawn({ name: "c1", task: card() }) as any;
  assert.deepEqual([r.model, r.thinkingLevel], [OPUS, "high"]); // the caller's model and effort, as without a force
  assert.deepEqual(forceLines(h), [["set", "command"]]);
});
