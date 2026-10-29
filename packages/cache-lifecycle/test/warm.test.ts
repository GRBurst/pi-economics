import { test } from "node:test";
import assert from "node:assert/strict";
import { decideWarm, type WarmInput } from "../core/warm.ts";

const MIN = 60_000;
const base: WarmInput = { role: "main", runningChildren: 0, awaitingReply: false, finished: false, idleMs: 0, capMs: 60 * MIN };

// [label, overrides, expected]; undefined = defer to pi's native rule
const table: Array<[string, Partial<WarmInput>, "warm" | "stop" | undefined]> = [
  ["main, no children: native", {}, undefined],
  ["main, children running: warm", { runningChildren: 2 }, "warm"],
  ["main, awaitingReply alone is not a reason", { awaitingReply: true }, undefined],
  ["child, not awaiting: native", { role: "child" }, undefined],
  ["child, awaiting a reply: warm", { role: "child", awaitingReply: true }, "warm"],
  ["child, runningChildren alone is not a reason", { role: "child", runningChildren: 3 }, undefined],
  ["finished main: stop", { finished: true }, "stop"],
  ["finished beats running children", { finished: true, runningChildren: 1 }, "stop"],
  ["finished child beats awaiting", { role: "child", awaitingReply: true, finished: true }, "stop"],
  ["one minute under the cap: warm", { runningChildren: 1, idleMs: 59 * MIN }, "warm"],
  ["at the cap: stop", { runningChildren: 1, idleMs: 60 * MIN }, "stop"],
  ["cap applies to children", { role: "child", awaitingReply: true, idleMs: 61 * MIN }, "stop"],
  ["cap also stops when there is nothing to warm for", { idleMs: 90 * MIN }, "stop"],
];

for (const [label, over, want] of table) test(`decideWarm: ${label}`, () => assert.equal(decideWarm({ ...base, ...over }), want));
