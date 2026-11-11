// Local mode L3.T8 (design §3.1.3; plan S10 children, S13, D18, D19; AC-H6): a child's tripwires run on its calls alone, through
// the spawn policy's composed `toolGuard`; the child gets the hint as a message, its parent one notice; no call is blocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HINT_TEXT, block } from "../core/local/hints.ts";
import { callKey, childTrips } from "../core/local/tripwires.ts";
import { defaults } from "../core/settings.ts";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
const H = defaults().hints, P = defaults().plans;
type Guard = (tool: string, input: unknown) => string | undefined;
type Call = readonly [string, unknown];
const rec = ([tool, input]: Call) => ({ tool, key: callKey(tool, input), isWrite: tool === "edit" || tool === "write", turn: 0 });
const A: Call = ["read", { path: "a" }], B: Call = ["read", { path: "b" }], W: Call = ["edit", { path: "f", oldText: "x", newText: "y" }];
const NOTICE = "[router] c1 looks stuck (identical-call ×3); consider killing it and respawning with attemptOf";

async function child(settings: Record<string, unknown>, task = card()) {
  const h = harness({ settings: settings as never });
  h.f.fire("session_start", {}, MAIN);
  provideSkills(h, ["tdd-implementation-planner"]);
  const r = accepted(await h.a.spawn({ name: "c1", task })) as { toolGuard?: Guard };
  h.a.emit({ type: "spawn", name: "c1", by: "main", parent: "main", childSessionId: "s-c1", ts: 1 });
  const hints = () => h.lines().filter((l) => l.event === "hint").map((l) => [l.taskId, l.trip, l.stage, l.count]);
  return { h, g: r.toolGuard, hints };
}

test("childTrips: identical-call and alternation on calls alone; a write with another key is a change", () => {
  const t = (xs: Call[]) => childTrips(xs.map(rec), H);
  assert.deepEqual(t([A, A]), []);
  assert.deepEqual(t([A, A, A]), ["identical-call"]);
  assert.deepEqual(t([A, A, W, A]), []);
  assert.deepEqual(t([W, W, W]), ["identical-call"]); // the same write: its key is the last call's
  assert.deepEqual(t([A, B, A]), []);
  assert.deepEqual(t([A, B, A, B]), ["alternation"]);
  assert.deepEqual(t([W, B, W, B]), []);
  assert.deepEqual(t([]), []);
});

test("AC-H6: the third identical call sends the child a hint; two more notify its parent, once (D18)", async () => {
  const { h, g, hints } = await child({ mode: "local" });
  assert.equal(typeof g, "function");
  for (let i = 0; i < 3; i++) g!(...A);
  assert.deepEqual(h.a.sent, [{ to: "c1", text: block("identical-call", 1, HINT_TEXT["identical-call"](H, P)), from: "router" }]);
  assert.match(h.a.sent[0].text, /^<router-hint trip="identical-call"/);
  for (let i = 0; i < 2; i++) g!(...A);
  assert.deepEqual(h.a.sent.slice(1), [{ to: "main", text: NOTICE, from: "router" }]);
  assert.deepEqual(hints(), [["c1", "identical-call", "hint", 1], ["c1", "identical-call", "parent", 3]]);
  for (let i = 0; i < 12; i++) g!(...A);
  assert.equal(h.a.sent.filter((s) => s.to === "main").length, 1);
});

test("AC-H6: no child call is blocked by a hint", async () => {
  const { h, g } = await child({ mode: "local" });
  const out = [...Array(10)].flatMap(() => [g!(...A)]).concat([...Array(8)].flatMap((_, i) => [g!(...(i % 2 ? B : A))]));
  assert.ok(h.a.sent.length >= 2, "the hints were sent");
  assert.deepEqual(out, out.map(() => undefined));
});

test("composition (D19): a read-only+files child keeps its files block, and its blocked repeats still trip", async () => {
  const { h, g } = await child({ mode: "local" }, card({ kind: "plan", files: ["docs/plan.md"] }));
  assert.equal(g!("edit", { path: "docs/plan.md" }), undefined);
  const foreign = ["edit", { path: "src/a.ts", oldText: "x", newText: "y" }] as const;
  for (let i = 0; i < 3; i++) assert.match(g!(...foreign)!, /limited to the files of your task card/);
  assert.equal(h.a.sent.length, 1);
  assert.match(h.a.sent[0].text, /^<router-hint trip="identical-call" n="1">/);
});

test("default mode: an `all` child has no toolGuard (unchanged); hints off in local mode likewise", async () => {
  assert.equal((await child({})).g, undefined);
  assert.equal((await child({ hints: { enabled: "on" } })).g, undefined); // children: local mode only (plan L3.T8)
  assert.equal((await child({ mode: "local", hints: { enabled: "off" } })).g, undefined);
});

test("a kill event drops the child's state", async () => {
  const { h, g } = await child({ mode: "local" });
  g!(...A);
  g!(...A);
  h.a.emit({ type: "kill", name: "c1", ts: 2 });
  for (let i = 0; i < 3; i++) assert.equal(g!(...A), undefined);
  assert.deepEqual(h.a.sent, []);
});
