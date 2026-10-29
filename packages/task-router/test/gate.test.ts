import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runCheck } from "../core/gate.ts";
import { accepted, card, harness } from "./harness.ts";

type Run = { cmd: string; cwd: string; timeoutMs: number };
function rig(settings = {}, result = { exit: 0, output: "ok\n", timedOut: false }) {
  const runs: Run[] = [];
  const h = harness({ settings, extra: { run: async (cmd: string, cwd: string, timeoutMs: number) => { runs.push({ cmd, cwd, timeoutMs }); return result; } } as any });
  const child = (name: string, state: "running" | "idle") => { h.a.agents.splice(0, h.a.agents.length, { name, parent: "main", sessionId: name, model: "x", thinkingLevel: "xhigh", state }); };
  const reports = (name: string, to = "main") => h.a.emit({ type: "route", from: name, to, preview: "done", buffered: false, ts: 1 });
  const settle = () => new Promise((r) => setImmediate(r));
  return { h, runs, child, reports, settle };
}

test("child with a check reports to its parent and is idle → check runs in cwd with timeout; parent gets exit + output", async () => {
  const { h, runs, child, reports, settle } = rig({}, { exit: 1, output: "boom\n", timedOut: false });
  accepted(await h.a.spawn({ name: "q1", task: card({ check: "npm test" }) }));
  child("q1", "idle");
  reports("q1");
  await settle(); await settle();
  assert.deepEqual(runs, [{ cmd: "npm test", cwd: "/work", timeoutMs: 900_000 }]);
  assert.equal(h.a.sent.length, 1);
  assert.equal(h.a.sent[0].to, "main");
  assert.equal(h.a.sent[0].from, "router");
  assert.match(h.a.sent[0].text, /^\[verify\] q1: `npm test` exit 1\nboom/);
  const [chk] = h.lines().filter((l) => l.event === "check");
  assert.deepEqual([chk.taskId, chk.exit], ["q1", 1]);
});

test("waits until the child is idle before running", async () => {
  const { h, runs, child, reports, settle } = rig();
  accepted(await h.a.spawn({ name: "q1", task: card() }));
  child("q1", "running");
  h.hooks.onSleep = () => { if (h.sleeps.length === 2) child("q1", "idle"); };
  reports("q1");
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(h.sleeps.length, 2);
  assert.equal(runs.length, 1);
});

test("output is cut to the last 40 lines; a timeout says so", async () => {
  const out = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
  const { h, child, reports, settle } = rig({}, { exit: 1, output: out, timedOut: false });
  accepted(await h.a.spawn({ name: "q1", task: card() }));
  child("q1", "idle");
  reports("q1");
  await settle(); await settle();
  const lines = h.a.sent[0].text.split("\n");
  assert.equal(lines.length, 41);
  assert.equal(lines.at(-1), "line 100");
  assert.equal(lines[1], "line 61");
  const t = rig({}, { exit: 124, output: "", timedOut: true });
  accepted(await t.h.a.spawn({ name: "q1", task: card() }));
  t.child("q1", "idle");
  t.reports("q1");
  await t.settle(); await t.settle();
  assert.match(t.h.a.sent[0].text, /timed out after 900 s/);
});

test("verifyGate=false, no check, report to somebody else, or unknown child → nothing", async () => {
  const off = rig({ verifyGate: false });
  accepted(await off.h.a.spawn({ name: "q1", task: card() }));
  off.child("q1", "idle"); off.reports("q1"); await off.settle();
  const nocheck = rig();
  accepted(await nocheck.h.a.spawn({ name: "q1", task: card({ check: undefined }) }));
  nocheck.child("q1", "idle"); nocheck.reports("q1"); await nocheck.settle();
  const peer = rig();
  accepted(await peer.h.a.spawn({ name: "q1", task: card() }));
  peer.child("q1", "idle"); peer.reports("q1", "q2"); peer.reports("ghost"); await peer.settle();
  assert.deepEqual([off.runs, nocheck.runs, peer.runs], [[], [], []]);
});

test("a second report while the check runs does not start a second check", async () => {
  const { h, runs, child, reports, settle } = rig();
  accepted(await h.a.spawn({ name: "q1", task: card() }));
  child("q1", "idle");
  reports("q1"); reports("q1");
  await settle(); await settle();
  assert.equal(runs.length, 1);
});

test("runCheck (real bash -lc): exit code, combined output, timeout kills", async () => {
  const ok = await runCheck("echo out; echo err >&2; exit 3", tmpdir(), 10_000);
  assert.equal(ok.exit, 3);
  assert.match(ok.output, /out/);
  assert.match(ok.output, /err/);
  const slow = await runCheck("sleep 5", tmpdir(), 200);
  assert.equal(slow.timedOut, true);
});
