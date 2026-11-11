// Local mode L5.T12 (design §3.1.1, §3.1.4, AC-H1; plan D42): after a write in the active worktree the router reads the diff
// against the branch's base (a git process, off the event) and queues `over-size` for the next result. Fake git.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Git, Stat } from "../core/local/git.ts";
import { HINT_TEXT, block } from "../core/local/hints.ts";
import { defaults } from "../core/settings.ts";
import { harness } from "./harness.ts";
import { fakeGit } from "./fake-git.ts";

const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
const H = defaults().hints, P = defaults().plans;
type Out = { content: { type: string; text: string }[] } | undefined;
const lines = (n: number): Stat => [{ path: "a.ts", added: n, deleted: 0 }];

function rig(o: { git?: (g: Git) => Git; active?: boolean } = {}) {
  const fake = fakeGit({ repos: [{ root: "/r/x" }] });
  const h = harness({ settings: { mode: "local" } as never, extra: { git: o.git ? o.git(fake.git) : fake.git, hash: () => undefined } as never });
  const ctx = { ...MAIN, cwd: "/wt", getContextUsage: () => ({ tokens: 1000, percent: 10 }) };
  h.f.fire("session_start", {}, ctx);
  if (o.active !== false) h.router.branches.put({ repo: "/r/x", branch: "lm/a", worktree: "/wt", base: "B", state: "active", rejections: 0, fixerRuns: 0, goal: "g", check: "true" });
  let n = 0;
  const pair = (tool: string, input: unknown, e: { isError?: boolean } = {}) => {
    const id = `t${++n}`;
    h.f.fire("tool_call", { toolName: tool, toolCallId: id, input }, ctx);
    const rs = h.f.fire("tool_result", { toolName: tool, toolCallId: id, input, content: [{ type: "text", text: `r${n}` }], isError: e.isError ?? false }, ctx);
    return (rs.filter((r) => r !== undefined) as Out[])[0];
  };
  const diffs = () => fake.calls.filter((c) => c.startsWith("diffStat"));
  const hints = () => h.lines().filter((l) => l.event === "hint").map((l) => [l.taskId, l.trip, l.stage, l.count]);
  return { h, fake, pair, diffs, hints, settled: () => h.router.settled() };
}
const HINT = block("over-size", 1, HINT_TEXT["over-size"](H, P));

test("AC-H1: a write in the worktree that leaves the diff over splitLines → over-size on the next result; one hint line", async () => {
  const { fake, pair, diffs, hints, settled } = rig();
  fake.stats.set("/wt", lines(P.splitLines + 1));
  assert.equal(pair("edit", { path: "/wt/a.ts" }), undefined, "the write's own result is not annotated: git runs off the event");
  await settled();
  assert.deepEqual(diffs(), ["diffStat /wt B"]);
  const next = pair("read", { path: "/wt/a.ts" });
  assert.deepEqual(next!.content.slice(1), [{ type: "text", text: HINT }]);
  assert.deepEqual(hints(), [["main", "over-size", "hint", 1]]);
  assert.equal(pair("read", { path: "/wt/b.ts" }), undefined, "delivered once");
});

test("AC-H1: exactly splitLines changed lines or splitFiles files is not over; one more is", async () => {
  const at = rig();
  at.fake.stats.set("/wt", Array.from({ length: P.splitFiles }, (_, i) => ({ path: `f${i}`, added: Math.floor(P.splitLines / P.splitFiles), deleted: 0 })));
  at.pair("write", { path: "/wt/a.ts", content: "x" });
  await at.settled();
  assert.equal(at.pair("read", { path: "/wt/a.ts" }), undefined);
  const files = rig();
  files.fake.stats.set("/wt", Array.from({ length: P.splitFiles + 1 }, (_, i) => ({ path: `f${i}`, added: 0, deleted: 0 })));
  files.pair("write", { path: "/wt/a.ts", content: "x" });
  await files.settled();
  assert.match(files.pair("read", { path: "/wt/a.ts" })!.content[1]!.text, /^<router-hint trip="over-size"/);
});

test("no git read for: a write outside the worktree, a failed write, a read, bash, no active worktree", async () => {
  const { fake, pair, diffs, settled } = rig();
  fake.stats.set("/wt", lines(500));
  pair("edit", { path: "/elsewhere/a.ts" });
  pair("edit", { path: "/wt-other/a.ts" }); // a sibling that shares the prefix
  pair("edit", { path: "/wt/a.ts" }, { isError: true });
  pair("read", { path: "/wt/a.ts" });
  pair("bash", { command: "ls" });
  await settled();
  assert.deepEqual(diffs(), []);
  const none = rig({ active: false });
  none.fake.stats.set("/wt", lines(500));
  none.pair("edit", { path: "/wt/a.ts" });
  await none.settled();
  assert.deepEqual(none.diffs(), []);
});

test("a port that throws changes nothing: no exception, no hint, the next write is read again", async () => {
  const { fake, pair, diffs, hints, settled } = rig();
  fake.stats.set("/wt", new Error("boom"));
  pair("edit", { path: "/wt/a.ts" });
  await settled();
  assert.equal(pair("read", { path: "/wt/r1.ts" }), undefined);
  fake.stats.set("/wt", lines(500));
  pair("edit", { path: "/wt/b.ts" });
  await settled();
  assert.equal(diffs().length, 2);
  assert.match(pair("read", { path: "/wt/r2.ts" })!.content[1]!.text, /^<router-hint trip="over-size"/);
  assert.deepEqual(hints(), [["main", "over-size", "hint", 1]]);
});

test("one diff at a time: a write during a read leads to one more read afterwards, not a parallel one", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let running = 0, peak = 0;
  const { fake, pair, diffs, settled } = rig({ git: (g) => ({ ...g, async diffStat(d, b) { running++; peak = Math.max(peak, running); await gate; running--; return g.diffStat(d, b); } }) });
  fake.stats.set("/wt", lines(1));
  pair("edit", { path: "/wt/a.ts" });
  pair("edit", { path: "/wt/b.ts" });
  pair("edit", { path: "/wt/c.ts" });
  release();
  await settled();
  assert.equal(peak, 1);
  assert.equal(diffs().length, 2, "the first, and one more for the writes that came meanwhile");
});
