// Local mode L5.T11 (design §3.1.1, AC-H1; plan D41, S11): the active branch's check, run through bash, trips `check-failing`
// when it fails checkFailures times in a row; a passing run is progress. End to end through the shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HINT_TEXT, ESCALATION, block } from "../core/local/hints.ts";
import { defaults } from "../core/settings.ts";
import { harness } from "./harness.ts";

const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
const H = defaults().hints, P = defaults().plans;
type Out = { content: { type: string; text: string }[] } | undefined;

function rig(check: string | null = "npm test -- parse", settings: Record<string, unknown> = { mode: "local" }) {
  const h = harness({ settings: settings as never, extra: { hash: () => undefined } as never });
  const status: [string, string | undefined][] = [];
  const ctx = { ...MAIN, cwd: "/work", getContextUsage: () => ({ tokens: 1000, percent: 10 }), hasUI: true,
    ui: { setStatus: (k: string, v: string | undefined) => void status.push([k, v]), notify: () => undefined } };
  h.f.fire("session_start", {}, ctx);
  if (check !== null) h.router.branches.put({ repo: "/r/x", branch: "lm/a", worktree: "/wt", base: "b", state: "active", rejections: 0, fixerRuns: 0, goal: "g", check });
  let n = 0;
  /** A bash call and its result; each failure gets a text of its own, so `repeated-error` stays out of the way. */
  const bash = (command: string, o: { fail?: boolean; text?: string } = {}) => {
    const id = `b${++n}`;
    h.f.fire("tool_call", { toolName: "bash", toolCallId: id, input: { command } }, ctx);
    const text = o.text ?? `output ${"abcdefghij".repeat(3).slice(n % 7)}${"xyz".repeat(n)} ${n * 7919}`;
    const rs = h.f.fire("tool_result", { toolName: "bash", toolCallId: id, input: { command }, content: [{ type: "text", text }], isError: o.fail ?? false }, ctx);
    return (rs.filter((r) => r !== undefined) as Out[])[0];
  };
  const hints = () => h.lines().filter((l) => l.event === "hint").map((l) => [l.trip, l.stage, l.count]);
  return { h, bash, hints, status };
}
const texts = (o: Out) => (o?.content ?? []).slice(1).map((c) => c.text);
/** The check with another spacing each time: the same command, another call key. */
const CK = (i: number) => "npm" + " ".repeat(1 + (i % 3)) + "test -- parse" + (i > 2 ? "\n" : "");
const FAIL_TEXT = ["alpha beta gamma delta", "completely different words here and there"];

test("AC-H1: the second failing run of the check gets the check-failing hint; whitespace variants of the command count", () => {
  const { bash, hints } = rig();
  assert.equal(bash("npm test -- parse", { fail: true, text: FAIL_TEXT[0] }), undefined);
  const second = bash("  npm   test  --\tparse\n", { fail: true, text: FAIL_TEXT[1] });
  assert.deepEqual(texts(second), [block("check-failing", 1, HINT_TEXT["check-failing"](H, P))]);
  assert.deepEqual(hints(), [["check-failing", "hint", 1]]);
});

test("AC-H1: a passing run resets the count and is progress; other commands between do not reset", () => {
  const { bash, hints, status } = rig();
  bash(CK(0), { fail: true, text: FAIL_TEXT[0] });
  bash("ls", { text: "a b c" });
  bash("git status", { text: "clean" });
  assert.deepEqual(texts(bash(CK(1), { fail: true, text: FAIL_TEXT[1] })), [block("check-failing", 1, HINT_TEXT["check-failing"](H, P))]);
  assert.match(status.at(-1)![1]!, /hint check-failing/);
  bash(CK(2)); // passes
  assert.equal(status.at(-1)![1], "local", "progress clears the status suffix");
  assert.equal(bash(CK(3), { fail: true, text: FAIL_TEXT[0] }), undefined, "one failure after the pass");
  assert.deepEqual(hints(), [["check-failing", "hint", 1]]);
});

test("AC-H1: persistence — detections 2, 3, 4 (the 2nd, 3rd, 4th failing run) are hint, quiet (cooldown), escalation (no steer overseer here)", () => {
  const { bash, hints } = rig();
  bash(CK(0), { fail: true, text: FAIL_TEXT[0] });
  bash(CK(1), { fail: true, text: FAIL_TEXT[1] });
  assert.equal(bash(CK(2), { fail: true, text: "yet another message entirely 12" }), undefined);
  const fourth = bash(CK(3), { fail: true, text: "and a fourth one that shares nothing" });
  assert.deepEqual(texts(fourth), [block("check-failing", 3, ESCALATION)]);
  assert.deepEqual(hints().map((x) => x[1]), ["hint", "steer"]);
});

test("no check on the active branch, no active branch, another command, a command that contains the check: no check-failing", () => {
  const none = rig(null);
  none.bash("npm test -- parse", { fail: true, text: FAIL_TEXT[0] });
  assert.equal(none.bash("npm test -- parse", { fail: true, text: FAIL_TEXT[1] }), undefined);
  const other = rig();
  other.bash("npm test", { fail: true, text: FAIL_TEXT[0] });
  assert.equal(other.bash("npm test", { fail: true, text: FAIL_TEXT[1] }), undefined);
  other.bash("npm test -- parse && echo done", { fail: true, text: FAIL_TEXT[0] });
  assert.equal(other.bash("npm test -- parse && echo done", { fail: true, text: FAIL_TEXT[1] }), undefined);
  assert.deepEqual(other.hints(), []);
});

test("the check is the active branch's at the time of the call: a new check takes over, the old one is just a command", () => {
  const { h, bash, hints } = rig("make a");
  h.router.branches.put({ ...h.router.branches.active()!, check: "make b" });
  bash("make a", { fail: true, text: FAIL_TEXT[0] });
  assert.equal(bash("make a", { fail: true, text: FAIL_TEXT[1] }), undefined);
  bash("make b", { fail: true, text: FAIL_TEXT[0] });
  assert.deepEqual(texts(bash("make b", { fail: true, text: FAIL_TEXT[1] })), [block("check-failing", 1, HINT_TEXT["check-failing"](H, P))]);
  assert.deepEqual(hints(), [["check-failing", "hint", 1]]);
});

test("hints off: no trips at all, whatever the check", () => {
  const { bash, hints } = rig("make a", { mode: "local", hints: { enabled: "off" } });
  bash("make a", { fail: true, text: FAIL_TEXT[0] });
  assert.equal(bash("make a", { fail: true, text: FAIL_TEXT[1] }), undefined);
  assert.deepEqual(hints(), []);
});
