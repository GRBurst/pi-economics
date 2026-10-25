// Not an upstream test: pins what this repository relies on of upstream's overlay, because
// every upstream test needs pi's packages (the check supplies a stub for the one import).
//
// The shape of session 01a10db4…: assistant 0eb69ac1 asked a question whose result was never
// persisted (pi restarted). On restart the question extension recorded the answer and, in its
// `context` handler, which runs before infinite-context's, inserts a synthetic toolResult after
// the assistant. The request then no longer starts with the session projection.
import assert from "node:assert/strict";
import { test } from "node:test";
import { messageItem, wrapRootRanges } from "./forest.ts";
import { ProjectionMismatchError, buildOverlay } from "./overlay.ts";

type Msg = { role: string; content?: unknown; toolCallId?: string; timestamp?: number };
const user = (text: string): Msg => ({ role: "user", content: text, timestamp: 1 });
const call = (callId: string): Msg => ({
  role: "assistant",
  content: [{ type: "toolCall", id: callId, name: "question" }],
  timestamp: 1,
});
const result = (callId: string, text: string): Msg => ({
  role: "toolResult",
  toolCallId: callId,
  content: [{ type: "text", text }],
  timestamp: 1,
});

const projected = [
  { id: "u1", message: user("task") },
  { id: "a1", message: call("c1") },
  { id: "r1", message: result("c1", "out") },
  { id: "0eb69ac1", message: call("Q") },
  { id: "recovered", message: user("Recovered question response: yes") },
];
const originals = projected.map((p) => ({ ...p, live: p.message }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const overlay = (request: Msg[], roots: ReturnType<typeof wrapRootRanges>): any[] =>
  buildOverlay(request as never, projected as never, originals as never, roots);
const unfolded = projected.map((p) => messageItem(p.id));
const folded = (first: number, last: number, summary: string) =>
  wrapRootRanges(unfolded, [{ first, last, id: "fold-1", summary }]);

/** The request after the question extension's repair: structured clones plus one foreign toolResult. */
const synthetic = result("Q", "yes");
const request = (): Msg[] => {
  const clones = projected.map((p) => structuredClone(p.message));
  return [...clones.slice(0, 4), synthetic, clones[4], user("unpersisted")];
};

test("a message inserted by an earlier context handler is foreign: it passes through in place", () => {
  const input = request();
  const output = overlay(input, unfolded);
  assert.deepEqual(output, input);
  assert.equal(output[4], synthetic);
});

test("a fold keeps the foreign messages of calls outside it", () => {
  const output = overlay(request(), folded(0, 2, "early work"));
  assert.deepEqual(output.map((m) => m.role === "user" && m.content), [
    "[#fold-1] archived fold summary:\nearly work",
    false,
    false,
    "Recovered question response: yes",
    "unpersisted",
  ]);
  assert.equal(output[1].content[0].id, "Q");
  assert.equal(output[2], synthetic);
});

test("a foreign toolResult of a folded call is dropped with its assistant", () => {
  const output = overlay(request(), folded(1, 3, "asked"));
  assert.deepEqual(output.map((m) => m.content), [
    "task",
    "[#fold-1] archived fold summary:\nasked",
    "Recovered question response: yes",
    "unpersisted",
  ]);
  assert.ok(!output.some((m) => m.role === "toolResult"));
});

test("a missing or changed projected message still refuses the request", () => {
  const missing = request().filter((m) => m.content !== "Recovered question response: yes");
  assert.throws(() => overlay(missing, unfolded), ProjectionMismatchError);
  const changed = request();
  changed[1] = call("other");
  assert.throws(() => overlay(changed, unfolded), ProjectionMismatchError);
  assert.throws(() => overlay(request().slice(0, 3), unfolded), ProjectionMismatchError);
});

test("the projection must stay in order", () => {
  const swapped = request();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.throws(() => overlay(swapped, unfolded), ProjectionMismatchError);
});
