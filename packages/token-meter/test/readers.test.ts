// M3a T3a.10: every reader of the meter log takes v1 and v2 lines alike (design §5.2: the v2 line only adds optional
// fields; no reader filters on `v`). The v1 corpus itself is pinned by the analyser goldens (analyse-golden.test.ts) and
// the LOGS.md examples (logs-examples.test.ts), so R6 holds when those stay unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse, type Logs } from "../core/analyse.ts";
import { armStats } from "../core/arms.ts";
import { aggregate, quotaRegression } from "../core/report.ts";
import { taskCosts } from "../core/tasks.ts";
import { isRequestLine } from "../core/analyse/logs.ts";
import { effectiveSettings } from "../core/effective-settings.ts";
import { leversLine } from "../core/levers.ts";
import { MIN, T0, turn, world } from "./world.ts";

/** The world plus one error line (v1: retries 0; v2: errorKind instead). */
function v1World(): Logs {
  const w = world();
  w.meter.push(turn("m5", T0 + 125 * MIN, { arm: "------", status: "error", costUsd: 0, output: 0 }));
  return w;
}

/**
 * A line as the v2 writer would have written it: `v: 2`, the v2 fields, retries absent (unknown) on warming lines. A measured
 * `cacheWrite1h` replaces the analyser's v1 inference (units.ts cacheWrite1hOf: a main line of a mainCacheTtl 1h arm wrote 1 h), so
 * only a child line, which v1 also prices as 5-minute writes, carries `cacheWrite1h: 0`; a main line leaves the split unmeasured.
 */
function toV2(l: any): any {
  const { v, retries, retryWaitMs, ...rest } = l;
  const v2: any = { ...rest, v: 2, billing: rest.provider === "openrouter" ? "subscription" : "api", durationMs: 1500, ttftMs: 300 };
  if (rest.parentSessionId !== undefined) v2.cacheWrite1h = 0;
  if (rest.kind !== "warming") Object.assign(v2, { retries, retryWaitMs });
  if (rest.status === "error") v2.errorKind = "rate_limit";
  return v2;
}

const variants = (): Record<string, Logs> => {
  const v1 = v1World();
  return {
    v2: { ...v1, meter: v1.meter.map(toV2) },
    mixed: { ...v1, meter: v1.meter.map((l, i) => (i % 2 ? toV2(l) : l)) },
  };
};

/** The analysis without the per-version line counts of the meter (the one table that must differ). */
const sansVersions = (a: ReturnType<typeof analyse>) =>
  ({ ...a, quality: { ...a.quality, logs: a.quality.logs.map((x) => (x.log === "meter" ? { ...x, versions: {} } : x)) } });

test("analyse: v2 and mixed v1/v2 meter lines give the analysis of the same lines in v1, but for the version counts", () => {
  const base = analyse(v1World());
  assert.equal(base.quality.problems.length, 0);
  for (const [name, logs] of Object.entries(variants())) {
    const a = analyse(logs);
    assert.deepEqual(sansVersions(a), sansVersions(base), name);
    const meter = a.quality.logs.find((x) => x.log === "meter")!;
    assert.equal((meter.versions["2"] ?? 0) + (meter.versions["1"] ?? 0) + (meter.versions["0"] ?? 0), logs.meter.length, name);
    assert.ok(meter.versions["2"] > 0, name);
  }
});

test("report, arms, quota regression and task costs: v2 and mixed v1/v2 lines read like v1", () => {
  const v1 = v1World();
  for (const [name, logs] of Object.entries(variants())) {
    assert.deepEqual(aggregate(logs.meter), aggregate(v1.meter), name);
    assert.deepEqual(quotaRegression(logs.meter), quotaRegression(v1.meter), name);
    assert.deepEqual(armStats(logs.meter), armStats(v1.meter), name);
    assert.deepEqual(taskCosts(logs.meter, logs.outcomes), taskCosts(v1.meter, v1.outcomes), name);
  }
});

// --- the bins read the files themselves ---
const here = dirname(fileURLToPath(import.meta.url));
const node = (bin: string, args: string[]) =>
  spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", resolve(here, "..", "bin", bin), ...args], { encoding: "utf8" });
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function agentDir(logs: Logs): string {
  const dir = mkdtempSync(join(tmpdir(), "token-meter-readers-"));
  const put = (rel: string, body: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
  put("meter/2026-10.jsonl", jsonl(logs.meter));
  put("task-router/outcomes/2026-10.jsonl", jsonl(logs.outcomes));
  put("experiments/assignments.jsonl", jsonl(logs.assignments));
  put("guards/events.jsonl", jsonl(logs.guards));
  return dir;
}

test("meter-report (report and --arms) and pi-analyse (tables, --check) read v2 files like v1 files", () => {
  const ok = (r: ReturnType<typeof node>) => (assert.equal(r.status, 0, r.stdout + r.stderr), r.stdout);
  const report = (dir: string, args: string[]) => ok(node("meter-report.ts", ["--agent-dir", dir, "--dir", join(dir, "meter"), ...args]));
  const tables = (dir: string) => {
    ok(node("pi-analyse.ts", ["--agent-dir", dir, "--out", join(dir, "r")]));
    const { cost, experiment, delegation, guards } = JSON.parse(readFileSync(join(dir, "r", readdirSync(join(dir, "r")).find((f) => f.endsWith(".json"))!), "utf8"));
    return { cost, experiment, delegation, guards };
  };
  const v1 = agentDir(v1World());
  const [text, arms, t] = [report(v1, []), report(v1, ["--arms"]), tables(v1)];
  assert.ok(t.cost.totalUsd > 0);
  for (const [name, logs] of Object.entries(variants())) {
    const dir = agentDir(logs);
    assert.equal(report(dir, []), text, name);
    assert.equal(report(dir, ["--arms"]), arms, name);
    assert.deepEqual(tables(dir), t, name);
    ok(node("pi-analyse.ts", ["--agent-dir", dir, "--check"]));
  }
});

// M3b T3b.4: levers lines (design §5.3) share the meter log but are no request: every reader skips them
// (core/analyse/logs.ts isRequestLine); only the meter log's line counts in the data-quality section see them.
/** The v1 world plus, per session, the levers line the shell writes before its first request (same ts: spans unchanged). */
function withLevers(): Logs {
  const w = v1World();
  const first = new Map<string, any>();
  for (const l of [...w.meter].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))) if (!first.has(l.sessionId)) first.set(l.sessionId, l);
  const levers = [...first.values()].map((l) => leversLine({ ts: l.ts, sessionId: l.sessionId, parentSessionId: l.parentSessionId,
    arm: l.arm, eligible: typeof l.arm === "string" && l.parentSessionId === undefined, levers: effectiveSettings({}, {}) }));
  return { ...w, meter: [...levers, ...w.meter] };
}
/** The analysis without the meter log's line and version counts and without the Levers section (the one reader of levers lines). */
const sansMeterCounts = (a: ReturnType<typeof analyse>) =>
  ({ ...a, levers: undefined, quality: { ...a.quality, logs: a.quality.logs.map((x) => (x.log === "meter" ? { ...x, lines: 0, versions: {} } : x)) } });

test("levers lines: analyse, report, arms, quota regression and task costs read the meter log as without them", () => {
  const v1 = v1World(), lv = withLevers();
  const n = lv.meter.length - v1.meter.length;
  assert.ok(n >= 6);
  const a = analyse(lv);
  assert.deepEqual(a.quality.problems, []);
  assert.deepEqual(sansMeterCounts(a), sansMeterCounts(analyse(v1)));
  const meter = a.quality.logs.find((x) => x.log === "meter")!;
  assert.deepEqual([meter.lines, meter.versions["2"]], [lv.meter.length, n]);
  assert.equal(a.levers.withLevers, n);
  const req = lv.meter.filter(isRequestLine);
  assert.deepEqual(req, v1.meter);
  assert.deepEqual(aggregate(lv.meter), aggregate(v1.meter));
});

test("levers lines: meter-report (report, --arms) and pi-analyse (tables, --check) skip them", () => {
  const ok = (r: ReturnType<typeof node>) => (assert.equal(r.status, 0, r.stdout + r.stderr), r.stdout);
  const both = [agentDir(v1World()), agentDir(withLevers())];
  const [report, arms] = [[], ["--arms"]].map((args) => both.map((dir) => ok(node("meter-report.ts", ["--agent-dir", dir, "--dir", join(dir, "meter"), ...args]))));
  assert.equal(report[1], report[0]);
  assert.equal(arms[1], arms[0]);
  ok(node("pi-analyse.ts", ["--agent-dir", both[1], "--check"]));
});
