import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, quotaRegression, render } from "../core/report.ts";

const L = (ts: string, sessionId: string, model: string, t: number[], extra: object = {}) => ({
  ts, sessionId, provider: "anthropic", model, kind: "turn", status: 200, retries: 0, retryWaitMs: 0,
  input: t[0], cacheRead: t[1], cacheWrite: t[2], output: t[3], costUsd: t[4], ...extra,
});

// 10 lines: s1 (opus) 4 turns over 2 days, s2 (sonnet) 3 turns + 1 error, 2 warming lines.
const fixture = [
  L("2026-10-01T10:00:00Z", "s1", "opus", [1, 10, 100, 5, 1.0]),
  L("2026-10-01T10:05:00Z", "s1", "opus", [1, 20, 10, 5, 0.5]),
  L("2026-10-01T10:10:00Z", "s2", "sonnet", [2, 30, 50, 6, 0.2]),
  L("2026-10-01T10:15:00Z", "s2", "sonnet", [2, 40, 20, 6, 0.1]),
  L("2026-10-02T09:00:00Z", "s1", "opus", [1, 50, 30, 5, 0.7]),
  L("2026-10-02T09:05:00Z", "s2", "sonnet", [2, 60, 0, 6, 0.1], { status: "error", errorClass: "429" }),
  L("2026-10-02T09:10:00Z", "s1", "opus", [1, 70, 40, 5, 0.9]),
  L("2026-10-02T09:15:00Z", "s2", "sonnet", [2, 80, 0, 6, 0.1]),
  L("2026-10-02T09:20:00Z", "s1", "opus", [0, 1000, 0, 0, 0.05], { kind: "warming" }),
  L("2026-10-02T09:25:00Z", "s2", "sonnet", [0, 1000, 0, 0, 0.02], { kind: "warming" }),
];

test("aggregate: totals per day, session and model; warming kept apart", () => {
  const a = aggregate(fixture);
  const d1 = a.byDay.find((r) => r.key === "2026-10-01")!;
  assert.deepEqual([d1.requests, d1.input, d1.cacheRead, d1.cacheWrite, d1.output, d1.errors, d1.warming], [4, 6, 100, 180, 22, 0, 0]);
  assert.ok(Math.abs(d1.costUsd - 1.8) < 1e-9);
  const d2 = a.byDay.find((r) => r.key === "2026-10-02")!;
  assert.equal(d2.requests, 3); assert.equal(d2.errors, 1); assert.equal(d2.warming, 2);
  assert.ok(Math.abs(d2.warmingCostUsd - 0.07) < 1e-9);
  assert.equal(d2.cacheRead, 260); // warming reads not mixed into turns
  const s1 = a.bySession.find((r) => r.key === "s1")!;
  assert.deepEqual([s1.requests, s1.cacheWrite, s1.warming], [4, 180, 1]);
  const m = a.byModel.find((r) => r.key === "sonnet")!;
  assert.deepEqual([m.requests, m.errors, m.warming, m.cacheWrite], [3, 1, 1, 70]);
  assert.equal(a.byModel.length, 2); assert.equal(a.bySession.length, 2);
  assert.equal(a.total.requests, 7); assert.equal(a.total.errors, 1);
});

test("aggregate: miss share = tokens a request had to process again because the cache lost the prefix / all cacheWrite (B3)", () => {
  // opus: write 1000 (a start), +100 growth, then 10 min later a cold cache rewrites all 1100; sonnet: only growth. 1100 missed of 2200 + 150 written
  const c = (ts: string, sid: string, model: string, read: number, write: number) => L(ts, sid, model, [0, read, write, 1, 0.1]);
  const lines = [
    c("2026-10-01T10:00:00Z", "s1", "opus", 0, 1000), c("2026-10-01T10:01:00Z", "s1", "opus", 1000, 100), c("2026-10-01T10:11:00Z", "s1", "opus", 0, 1100),
    c("2026-10-01T10:00:00Z", "s2", "sonnet", 0, 100), c("2026-10-01T10:01:00Z", "s2", "sonnet", 100, 50),
  ];
  assert.ok(Math.abs(aggregate(lines).missShare - 1100 / 2350) < 1e-9);
  assert.equal(aggregate([]).missShare, 0);
  // every non-first write counted as a rewrite is the old figure of 4 of 5 requests; only the lost prefix is a miss now
  assert.ok(aggregate(lines).missShare < 0.5);
});

test("aggregate: from/to filter by UTC day (inclusive)", () => {
  const a = aggregate(fixture, { from: "2026-10-02", to: "2026-10-02" });
  assert.deepEqual(a.byDay.map((r) => r.key), ["2026-10-02"]);
});

test("quota regression: insufficient data below 24 usable hours", () => {
  const r = quotaRegression(fixture);
  assert.equal(r.ok, false);
  assert.match(render(aggregate(fixture)), /quota regression: insufficient data \(\d+ h\)/);
});

function synthetic(hours: number) {
  const out: object[] = [];
  const [a, b, c] = [1e-5, 4e-5, 2e-4]; // % per token
  let q = 0;
  for (let h = 0; h < hours; h++) {
    const read = 1000 * (1 + ((h * 7) % 11)), write = 500 * (1 + ((h * 5) % 7)), output = 100 * (1 + ((h * 3) % 5));
    const hh = new Date(Date.UTC(2026, 9, 1, h)).toISOString().slice(0, 13);
    const reset = "2026-12-01T00:00:00.000Z";
    out.push(L(`${hh}:00:00Z`, "s", "m", [0, 0, 0, 0, 0], { q5h: q, q5hReset: reset }));
    q += a * read + b * write + c * output;
    out.push(L(`${hh}:30:00Z`, "s", "m", [0, read, write, output, 0], { q5h: q, q5hReset: reset }));
  }
  return out;
}

test("quota regression recovers coefficients of a synthetic linear fixture", () => {
  const r = quotaRegression(synthetic(30));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.hours, 30);
  assert.ok(Math.abs(r.read - 1e-5) < 1e-9, String(r.read));
  assert.ok(Math.abs(r.write - 4e-5) < 1e-9, String(r.write));
  assert.ok(Math.abs(r.output - 2e-4) < 1e-9, String(r.output));
  assert.match(render(aggregate(synthetic(30))), /quota regression: 30 h/);
});

test("quota regression: hours whose window reset changed are not usable", () => {
  const ls = synthetic(30) as any[];
  for (const l of ls.slice(0, 20)) if (l.ts.endsWith("30:00Z")) l.q5hReset = "2026-12-02T00:00:00.000Z";
  assert.equal(quotaRegression(ls).ok, false);
});

test("render: markdown tables", () => {
  const md = render(aggregate(fixture));
  assert.match(md, /\| day \| requests \|/);
  assert.match(md, /\| 2026-10-01 \| 4 \|/);
  assert.match(md, /miss share: \d+\.\d%/);
  assert.doesNotMatch(md, /rewrite share/);
});

test("bin/meter-report.ts prints the report for a directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "token-meter-report-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "2026-10.jsonl"), fixture.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");
  const bin = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "meter-report.ts");
  const out = execFileSync(process.execPath, ["--experimental-strip-types", bin, "--dir", dir, "--from", "2026-10-02"], { encoding: "utf8" });
  assert.match(out, /\| 2026-10-02 \| 3 \|/);
  assert.doesNotMatch(out, /2026-10-01/);
});

test("aggregate: a long log is grouped in linear time", () => {
  const n = 100_000;
  const lines = Array.from({ length: n }, (_, i) => L(new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), "s", "opus", [1, 2, 3, 4, 0.1], { q5h: 10 + (i % 5), q5hReset: 1 }));
  const t = Date.now();
  assert.equal(aggregate(lines).total.requests, n);
  assert.ok(Date.now() - t < 5_000, `${Date.now() - t} ms`);
});
