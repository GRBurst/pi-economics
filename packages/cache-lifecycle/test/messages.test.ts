import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMasks, entriesOf } from "../core/messages.ts";
import { planMasks } from "../core/mask.ts";
import { stub } from "../core/mask.ts";
import { asst, tool, user } from "./msgs.ts";

const convo = () => [
  user("do it"),
  asst("r1", [{ type: "thinking", thinking: "t".repeat(400), thinkingSignature: "sig" }, { type: "toolCall", id: "c1", name: "bash", arguments: { cmd: "ls" } }]),
  tool("c1", "bash", "x".repeat(4000)),
  asst("r2", [{ type: "thinking", thinking: "u".repeat(400) }]),
  asst("r3", [{ type: "text", text: "done" }]),
];

test("entriesOf: stable ids (tool:<toolCallId>, think:<responseId>:<blockIndex>) and token estimates", () => {
  const es = entriesOf(convo() as never);
  assert.deepEqual(es.map((e) => [e.id, e.kind]), [
    ["msg:0", "other"], ["think:r1:0", "thinking"], ["msg:1", "other"], ["tool:c1", "toolResult"], ["msg:3", "other"], ["msg:4", "other"],
  ]);
  assert.equal(es.find((e) => e.id === "tool:c1")?.tokens, 1000);
  assert.equal(es.find((e) => e.id === "think:r1:0")?.tokens, 100);
});

test("entriesOf: a thinking-only message is not eligible (dropping its block would leave it empty)", () => {
  assert.ok(!entriesOf(convo() as never).some((e) => e.id.startsWith("think:r2")));
});

test("applyMasks: tool result becomes a stub, thinking block is dropped whole, everything else is the same object", () => {
  const m = convo();
  const out = applyMasks(m as never, new Set(["tool:c1", "think:r1:0"])) as any[];
  assert.deepEqual(out[2], { ...m[2], content: [{ type: "text", text: stub("tool:c1", 1000, "bash") }] });
  assert.deepEqual(out[1].content, [m[1].content[1]]);
  assert.equal(out[0], m[0]);
  assert.equal(out[4], m[4]);
});

test("applyMasks is idempotent and leaves the input untouched", () => {
  const m = convo();
  const before = JSON.stringify(m);
  const masks = planMasks(entriesOf(m as never), new Set(), 0, ["tools", "thinking"]);
  const once = applyMasks(m as never, masks);
  assert.equal(JSON.stringify(m), before);
  assert.equal(JSON.stringify(applyMasks(once, masks)), JSON.stringify(once));
});
