import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../core/shell.ts";
import { outcomeFile } from "../core/outcome.ts";
import { fakePi } from "./fake-pi.ts";
import type { Card, Plan } from "../core/types.ts";

const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const card: Card = { kind: "implement", files: [], acceptance: [], t0: { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true }, t2: [] };
const plan: Plan = { worker: { tier: "qwen", effort: "xhigh" }, base: "qwen", importance: "normal", reasons: [] };

function setup() {
  const agentDir = mkdtempSync(join(tmpdir(), "task-router-shell-"));
  const f = fakePi();
  const router = install(f.pi, { agentDir, now: () => NOW });
  const lines = () => (existsSync(outcomeFile(agentDir, NOW))
    ? readFileSync(outcomeFile(agentDir, NOW), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    : []);
  return { f, router, lines };
}

test("registers task_verdict with a JSON-schema (no typebox import needed)", () => {
  const { f } = setup();
  const t = f.tools.get("task_verdict");
  assert.ok(t);
  assert.equal(t.parameters.type, "object");
  assert.deepEqual(t.parameters.required, ["name", "verdict"]);
  assert.deepEqual(t.parameters.properties.verdict.enum, ["accepted", "partial", "rejected"]);
  assert.match(t.description, /before .*kill/i);
});

test("task_verdict writes a verdict line to the month file", async () => {
  const { f, router, lines } = setup();
  router.log.spawn({ taskId: "q1", card, plan });
  const r = await f.callTool("task_verdict", { name: "q1", verdict: "accepted", note: "good" });
  assert.ok(!r.isError);
  assert.equal(r.content[0].type, "text");
  const v = lines().filter((l) => l.event === "verdict");
  assert.equal(v.length, 1);
  assert.equal(v[0].taskId, "q1");
  assert.equal(v[0].verdict, "accepted");
  assert.equal(v[0].note, "good");
});

test("task_verdict for an unknown agent is an error result and writes nothing", async () => {
  const { f, lines } = setup();
  const r = await f.callTool("task_verdict", { name: "ghost", verdict: "rejected" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /ghost/);
  assert.deepEqual(lines(), []);
});

test("task_verdict rejects a verdict outside the enum (incl. unjudged: only the router writes that)", async () => {
  const { f, router } = setup();
  router.log.spawn({ taskId: "q1", card, plan });
  const r = await f.callTool("task_verdict", { name: "q1", verdict: "unjudged" });
  assert.equal(r.isError, true);
});

test("kill without verdict → unjudged line in the file", () => {
  const { router, lines } = setup();
  router.log.spawn({ taskId: "q1", card, plan });
  router.log.killed("q1");
  assert.deepEqual(lines().map((l) => [l.event, l.verdict]), [["spawn", undefined], ["verdict", "unjudged"]]);
});

// --- settings problems are reported once (spec §5.4) ---------------------------------------

function withWarnings<T>(fn: (warned: string[]) => T): T {
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.join(" "));
  try { return fn(warned); } finally { console.warn = orig; }
}
const installWith = (problems?: string[]) => {
  const f = fakePi();
  install(f.pi, { agentDir: mkdtempSync(join(tmpdir(), "task-router-shell-")), now: () => NOW, ...(problems ? { problems } : {}) });
  return f;
};

test("problems: one console.warn each at install, one notify at the first session_start, none at the second", () => {
  withWarnings((warned) => {
    const f = installWith(["a", "b"]);
    assert.deepEqual(warned, ["task-router: a", "task-router: b"]);
    const notes: [string, string][] = [];
    const ctx = { ui: { notify: (m: string, kind: string) => void notes.push([m, kind]) } };
    f.fire("session_start", {}, ctx);
    f.fire("session_start", {}, ctx);
    assert.deepEqual(notes, [["task-router settings: a; b", "warning"]]);
    assert.equal(warned.length, 2);
  });
});

test("problems: none → no warning and no notify; a session without ui does not throw", () => {
  withWarnings((warned) => {
    const f = installWith();
    const notes: string[] = [];
    f.fire("session_start", {}, { ui: { notify: (m: string) => void notes.push(m) } });
    assert.deepEqual([warned, notes], [[], []]);
    const g = installWith(["x"]);
    g.fire("session_start", {}, undefined);
    g.fire("session_start", {}, {});
  });
});
