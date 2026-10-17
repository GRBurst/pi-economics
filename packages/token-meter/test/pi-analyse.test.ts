import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { world } from "./world.ts";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "pi-analyse.ts");
const run = (args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", BIN, ...args], { encoding: "utf8" });
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

/** The world's four logs at their real paths under a fresh agent dir (one torn meter line). */
function agentDir(edit: (w: ReturnType<typeof world>) => void = () => {}): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-analyse-"));
  const w = world();
  edit(w);
  const put = (rel: string, body: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
  put("meter/2026-10.jsonl", jsonl(w.meter) + '{"ts":"2026-10-05T1\n');
  put("task-router/outcomes/2026-10.jsonl", jsonl(w.outcomes));
  put("experiments/assignments.jsonl", jsonl(w.assignments));
  put("guards/events.jsonl", jsonl(w.guards));
  put("experiments/settings.json", JSON.stringify({ guards: { minSessions: 2, threshold: 0.2, peekThreshold: 5, correctionThreshold: 5, ratingThreshold: 5 } }));
  return dir;
}

test("pi-analyse writes <out>/<date>-<HHMM>-analysis.md and .json (UTC time of the run) with all five sections", () => {
  const dir = agentDir();
  const out = join(dir, "reports");
  const before = new Date().toISOString().slice(0, 16);
  const r = run(["--agent-dir", dir, "--out", out, "--since", "2026-10-01", "--until", "2026-10-31"]);
  const after = new Date().toISOString().slice(0, 16);
  assert.equal(r.status, 0, r.stderr);
  const files = readdirSync(out).sort();
  assert.equal(files.length, 2);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}-\d{4}-analysis\.json$/);
  assert.match(files[1], /^\d{4}-\d{2}-\d{2}-\d{4}-analysis\.md$/);
  const stamp = (f: string) => f.slice(0, 15).replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/, "$1T$2:$3");
  assert.ok(stamp(files[1]) >= before && stamp(files[1]) <= after, `${files[1]} is not the UTC minute of the run (${before} – ${after})`);
  const md = readFileSync(join(out, files[1]), "utf8");
  for (const h of ["## Cost", "## Experiment", "## Delegation & routing", "## Guards", "## Data quality"]) assert.ok(md.includes(h), h);
  assert.match(md, /2026-10\.jsonl 1/); // the torn line is reported
  const tables = JSON.parse(readFileSync(join(out, files[0]), "utf8"));
  assert.ok(Math.abs(tables.cost.totalUsd - 47.7) < 1e-9);
  assert.deepEqual(tables.experiment.designs.map((d: any) => d.design), ["v1", "v2"]);
  assert.match(r.stdout, /analysis\.md/);
  // without --apply the kill switch only reports
  assert.equal(existsSync(join(dir, "experiments", "state.json")), false);
});

test("the default report dir is <agentDir>/reports", () => {
  const dir = agentDir();
  assert.equal(run(["--agent-dir", dir]).status, 0);
  assert.equal(readdirSync(join(dir, "reports")).length, 2);
});

test("--apply writes the kill-switch arms and the posterior to experiments/state.json", () => {
  const dir = agentDir();
  const r = run(["--agent-dir", dir, "--out", join(dir, "r"), "--apply"]);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(readFileSync(join(dir, "experiments", "state.json"), "utf8"));
  assert.deepEqual(s.disabled, ["++++++"]);
  assert.ok(s.posterior["------"]);
  assert.match(r.stdout, /disabled: \+\+\+\+\+\+/);
});

test("--check exits 0 on complete logs and writes no report", () => {
  const dir = agentDir();
  const r = run(["--agent-dir", dir, "--check"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /contract ok/);
  assert.equal(existsSync(join(dir, "reports")), false);
});

test("--check exits 1 and names the missing field; only lines of the period count", () => {
  const dir = agentDir((w) => { w.meter = w.meter.map((l) => (l.sessionId === "c2" ? (({ parentSessionId, ...r }) => r)(l) : l)); });
  const r = run(["--agent-dir", dir, "--check"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /meter: 2 line\(s\) miss parentSessionId/);
  assert.equal(run(["--agent-dir", dir, "--check", "--until", "2026-10-04"]).status, 0);
});

test("bad arguments exit 2 with usage", () => {
  const r = run(["--since", "yesterday"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: pi-analyse/);
});
