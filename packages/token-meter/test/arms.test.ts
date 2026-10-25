// Per-arm analysis of the meter log: $ per active hour with bootstrap CI, per-event costs
// (next N requests after a cold resume, after a fold), posterior rewards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armStats, posterior, quotaAttribution, rootUnits } from "../core/arms.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 8, 0, 0);
/** One meter turn line `at` minutes after T0. `ctx` = input + cacheRead + cacheWrite tokens. */
const L = (arm: string | undefined, sessionId: string, at: number, costUsd: number, extra: Record<string, unknown> = {}) => ({
  ts: new Date(T0 + at * MIN).toISOString(), sessionId, ...(arm ? { arm } : {}), provider: "anthropic", model: "opus",
  kind: "turn", status: 200, retries: 0, retryWaitMs: 0, input: 1, cacheRead: 99_000, cacheWrite: 0, output: 5, costUsd, ...extra,
});
/** A session of `turns` turns, 10 min apart, $1 each → 10 min of activity per gap. */
const session = (arm: string, sid: string, turns: number, cost = 1, start = 0) =>
  Array.from({ length: turns }, (_, i) => L(arm, sid, start + i * 10, cost));
const byArm = (lines: any[], flags = {}) => Object.fromEntries(armStats(lines, { flags }).map((s) => [s.arm, s]));

test("$ per active hour: gaps below 30 min count, idle gaps do not; children and warming cost count; unlabelled lines are ignored", () => {
  const lines = [
    ...session("+", "m1", 4), // turns at 0, 10, 20, 30 min: $4
    L("+", "c1", 5, 2, { parentSessionId: "m1" }), // a child of m1 belongs to the same unit: +$2, activity at 5
    L("+", "m1", 91, 1), // 61 min after the last turn: idle, its cost counts, its gap does not
    L("+", "m1", 40, 0.5, { kind: "warming" }), // warming costs, is not activity
    ...session("-", "m2", 3, 2), // 20 min, $6
    ...session("", "m3", 3, 100), // no arm
  ];
  const s = byArm(lines);
  assert.deepEqual(Object.keys(s).sort(), ["+", "-"]);
  assert.equal(s["+"].units, 1);
  assert.ok(Math.abs(s["+"].costUsd - 7.5) < 1e-9);
  assert.ok(Math.abs(s["+"].activeHours - 0.5) < 1e-9);
  assert.ok(Math.abs(s["-"].costPerHour - 6 / (20 / 60)) < 1e-9);
});

test("bootstrap CI: deterministic, contains the estimate, collapses when every unit has the same rate", () => {
  const same = [...session("+", "a", 3), ...session("+", "b", 3), ...session("+", "c", 3)]; // $3/h... 20 min, $3 each → $9/h
  const s = byArm(same)["+"];
  assert.equal(s.units, 3);
  assert.ok(Math.abs(s.costPerHour - 9) < 1e-9);
  assert.deepEqual(s.ci.map((x) => +x.toFixed(9)), [9, 9]);
  const mixed = [...session("+", "a", 3, 1), ...session("+", "b", 3, 5), ...session("+", "c", 3, 2), ...session("+", "d", 3, 9)];
  const m = byArm(mixed)["+"];
  assert.ok(m.ci[0] < m.costPerHour && m.costPerHour < m.ci[1]);
  assert.deepEqual(byArm(mixed)["+"].ci, m.ci);
});

test("cold resume: cost of the next N=3 requests after a gap ≥ the TTL; a main session with mainCacheTtl 1h is not cold at 10 min", () => {
  const lines = [L("-", "s", 0, 0.1), L("-", "s", 1, 0.1), L("-", "s", 11, 5), L("-", "s", 12, 1), L("-", "s", 13, 1), L("-", "s", 14, 0.1)];
  const cold = byArm(lines)["-"].coldResume;
  assert.deepEqual([cold.n, cold.meanCost], [1, 7]);
  assert.equal(byArm(lines, { "-": { mainCacheTtl: "1h" } })["-"].coldResume.n, 0);
  // a child keeps the 5 min TTL whatever the arm says
  const child = lines.map((l) => ({ ...l, parentSessionId: "m" }));
  assert.equal(byArm(child, { "-": { mainCacheTtl: "1h" } })["-"].coldResume.n, 1);
  // an event too close to the end of the log has no full window
  assert.equal(byArm(lines.slice(0, 4))["-"].coldResume.n, 0);
});

test("fold: a warm turn whose context shrank below 80% of the previous one; cost of that request and the next two", () => {
  const small = { cacheRead: 30_000, cacheWrite: 10_000 };
  const lines = [L("+", "s", 0, 0.1), L("+", "s", 1, 0.1), L("+", "s", 2, 2, small), L("+", "s", 3, 0.5, small), L("+", "s", 4, 0.5, small)];
  const s = byArm(lines)["+"];
  assert.deepEqual([s.fold.n, s.fold.meanCost], [1, 3]);
  assert.equal(s.coldResume.n, 0);
});

test("posterior: reward = −$ per active hour, sd from the bootstrap; arms with fewer than 2 units are left out", () => {
  const lines = [...session("+", "a", 3, 1), ...session("+", "b", 3, 5), ...session("+", "c", 3, 2), ...session("-", "d", 3, 1)];
  const stats = armStats(lines);
  const p = posterior(stats);
  assert.deepEqual(Object.keys(p), ["+"]);
  assert.ok(p["+"].mean < 0 && p["+"].sd > 0);
  assert.ok(Math.abs(p["+"].mean + stats.find((s) => s.arm === "+")!.costPerHour) < 1e-9);
});

// --- bin/meter-report.ts --arms --posterior ---
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderArms } from "../core/arms.ts";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "meter-report.ts");
const jsonl = (dir: string, file: string, rows: unknown[]) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
};

function agentDirWith(opts: { guards?: unknown; disabled?: string[]; events?: unknown[] } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "token-meter-arms-"));
  // baseline "-": cheap and well accepted; "+": costly and rejected (5 sessions each)
  const lines = ["a", "b", "c", "d", "e"].flatMap((x, i) => [...session("-", `m-${x}`, 3, 1 + i / 10), ...session("+", `p-${x}`, 3, 3 + i / 10)]);
  jsonl(join(agentDir, "meter"), "2026-10.jsonl", lines);
  const tasks = (arm: string, ok: number, bad: number) =>
    Array.from({ length: ok + bad }, (_, i) => [{ event: "spawn", taskId: `${arm}${i}`, arm }, { event: "verdict", taskId: `${arm}${i}`, verdict: i < ok ? "accepted" : "rejected" }]).flat();
  jsonl(join(agentDir, "task-router", "outcomes"), "2026-10.jsonl", [...tasks("-", 9, 1), ...tasks("+", 3, 7)]);
  if (opts.events) jsonl(join(agentDir, "guards"), "events.jsonl", opts.events);
  mkdirSync(join(agentDir, "experiments"), { recursive: true });
  writeFileSync(join(agentDir, "experiments", "settings.json"), JSON.stringify({ baseline: "-", guards: opts.guards ?? { minSessions: 5, threshold: 0.2 } }));
  if (opts.disabled) writeFileSync(join(agentDir, "experiments", "state.json"), JSON.stringify({ disabled: opts.disabled, posterior: { old: { mean: 1, sd: 1 } }, counts: {} }));
  const run = (...args: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", bin, "--agent-dir", agentDir, ...args], { encoding: "utf8" });
  return { agentDir, run, state: () => JSON.parse(readFileSync(join(agentDir, "experiments", "state.json"), "utf8")) };
}

test("--arms prints one row per arm: units, $/h with CI, event costs, acceptance; the usual report is not printed", () => {
  const out = agentDirWith().run("--arms");
  assert.match(out, /\| arm \| units \|/);
  assert.match(out, /\| - \| 5 \|/);
  assert.match(out, /\| \+ \| 5 \|.*\| 3\/10 \|/);
  assert.doesNotMatch(out, /## Per day/);
  assert.match(renderArms([], {}, {}), /\| arm \|/);
});

test("--posterior writes state.json atomically: posterior rewards (−$/h), the kill switch's disabled arm with its reason; existing disabled arms stay", () => {
  const a = agentDirWith({ disabled: ["old"] });
  a.run("--arms", "--posterior");
  const s = a.state();
  assert.deepEqual(Object.keys(s.posterior).sort(), ["+", "-"]);
  assert.ok(s.posterior["-"].mean < 0 && s.posterior["-"].mean > s.posterior["+"].mean, "cheaper arm has the higher reward");
  assert.deepEqual(s.disabled.sort(), ["+", "old"]);
  assert.match(s.reasons["+"], /acceptance 30% \(3\/10\) vs baseline 90% \(9\/10\)/);
  assert.deepEqual(readdirSync(join(a.agentDir, "experiments")).filter((n) => n.includes("tmp")), []);
});

test("--posterior with guards not met writes no disabled arm; without --arms it prints nothing but a summary line", () => {
  const a = agentDirWith({ guards: { minSessions: 6, threshold: 0.2 } });
  const out = a.run("--posterior");
  assert.deepEqual(a.state().disabled, []);
  assert.match(out, /^state\.json:/);
  assert.ok(existsSync(join(a.agentDir, "experiments", "state.json")));
});

test("T8.7: --posterior reads <agentDir>/guards/events.jsonl: corrections and peeks after masking can disable an arm on their own (acceptance threshold out of reach); --arms shows them", () => {
  const ev = (arm: string, event: string, sessionId: string) => ({ ts: "2026-10-05T08:00:00Z", sessionId, arm, event });
  const events = [...["a", "b", "c", "d", "e"].flatMap((x) => [ev("+", "correction", `p-${x}`), ev("+", "correction", `p-${x}`), ev("+", "peek-after-mask", `p-${x}`), ev("+", "peek-after-mask", `p-${x}`)]), ev("-", "peek-after-mask", "m-a")];
  const a = agentDirWith({ guards: { minSessions: 5, threshold: 0.99, correctionThreshold: 1.5 }, events });
  const out = a.run("--arms", "--posterior");
  const s = a.state();
  assert.deepEqual(s.disabled, ["+"]);
  assert.match(s.reasons["+"], /peeks after masking 2\.00\/session vs baseline 0\.20, more by more than 1[;,]/); // default peekThreshold
  assert.match(s.reasons["+"], /corrections 2\.00\/session vs baseline 0\.00, more by more than 1\.5/); // configured
  assert.match(out, /\| peeks\/s \| corr\/s \| rating \|/);
  assert.match(out, /\| \+ \| 5 \|.*\| 2\.00 \| 2\.00 \| – \|/);
});

test("T8.7 quota % per active hour: deltas of q5h/q7d between turns of a unit inside active gaps (idle gaps and window resets skipped); units without readings do not dilute", () => {
  const q = (at: number, q5h: number, q7d: number, reset = "r1") => L("+", "m1", at, 1, { q5h, q7d, q5hReset: reset, q7dReset: "w1" });
  const lines = [
    q(0, 10, 50), q(10, 10, 50), q(20, 11, 50), q(30, 12, 51), // active 30 min: +2 % of 5h, +1 % of 7d
    q(80, 20, 55), // 50 min idle: neither time nor quota
    q(90, 25, 55, "r2"), // window reset: skipped
    ...session("+", "nodata", 4, 1, 200), // 30 min of activity without readings, after every reading
    ...session("-", "m2", 4, 1, 200),
  ];
  const s = byArm(lines);
  assert.equal(s["+"].units, 2);
  assert.ok(Math.abs(s["+"].activeHours - (30 + 10 + 30) / 60) < 1e-9);
  assert.ok(Math.abs(s["+"].q5hPerHour - 2 / ((30 + 10) / 60)) < 1e-9, "only the unit with readings counts in the denominator");
  assert.ok(Math.abs(s["+"].q7dPerHour - 1 / ((30 + 10) / 60)) < 1e-9);
  assert.ok(Number.isNaN(s["-"].q5hPerHour));
});

test("T8.7: --arms reports $ per accepted task (join over the child's subtree) and quota % per active hour", () => {
  const a = agentDirWith();
  const ts = "2026-10-05T08:00:00Z";
  // two tasks of arm "+": c1 (with a grandchild) accepted, c2 rejected → ($1 + $0.5 + $2) / 1 accepted = $3.50; one of arm "-": $0.25
  jsonl(join(a.agentDir, "meter"), "2026-10-extra.jsonl", [
    { ts, sessionId: "c1", arm: "+", costUsd: 1 }, { ts, sessionId: "c1a", parentSessionId: "c1", arm: "+", costUsd: 0.5 },
    { ts, sessionId: "c2", arm: "+", costUsd: 2 }, { ts, sessionId: "c3", arm: "-", costUsd: 0.25 },
  ]);
  jsonl(join(a.agentDir, "task-router", "outcomes"), "2026-10-extra.jsonl", [
    { event: "spawn", taskId: "x1", arm: "+", sessionId: "c1" }, { event: "verdict", taskId: "x1", verdict: "accepted" },
    { event: "spawn", taskId: "x2", arm: "+", sessionId: "c2" }, { event: "verdict", taskId: "x2", verdict: "rejected" },
    { event: "spawn", taskId: "x3", arm: "-", sessionId: "c3" }, { event: "verdict", taskId: "x3", verdict: "accepted" },
  ]);
  const out = a.run("--arms");
  assert.match(out, /\| \$\/accepted task \| q5h %\/h \| q7d %\/h \|/);
  assert.match(out, /\| \+ \| 5 \|.*\| 3\.50 \| – \| – \|/);
  assert.match(out, /\| - \| 5 \|.*\| 0\.25 \| – \| – \|/);
});

// --- quota attribution: the quota is account-wide, so one global timeline is split between the roots that were active ---
const q5 = (arm: string, sid: string, at: number, q: number | undefined, cost = 1, extra: Record<string, unknown> = {}) =>
  L(arm, sid, at, cost, { ...(q === undefined ? {} : { q5h: q, q5hReset: "r1" }), ...extra });
const used = (lines: any[], key: "q5h" | "q7d" = "q5h") => Object.fromEntries(rootUnits(lines).map((u) => [u.root, u[key]]));
const close = (a: number | undefined, b: number, msg = "") => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${msg} ${a} ≠ ${b}`);

test("quota: a lone root gets the full rise of its readings", () => {
  close(used([q5("+", "a", 0, 10), q5("+", "a", 5, 11), q5("+", "a", 10, 13)]).a, 3);
});

test("quota: two identical roots running in parallel get half of the account's rise each (no double count)", () => {
  const both = (at: number, q: number) => [q5("+", "a", at, q), q5("+", "b", at, q)];
  const lines = [...both(0, 10), ...both(10, 11), ...both(20, 13)];
  const u = used(lines);
  close(u.a, 1.5);
  close(u.b, 1.5);
  const s = armStats(lines)[0];
  assert.equal(s.units, 2);
  close(s.q5hPerHour, 3 / (2 * (20 / 60)), "3 points over two roots of 20 min each, not 6 over 20 min");
});

test("quota: a rise goes to the roots with requests since the previous reading, proportional to their cost (equal split when all cost 0)", () => {
  const u = used([q5("+", "a", 0, 10, 1), q5("+", "b", 4, undefined, 1), q5("+", "a", 5, 12, 3)]);
  close(u.a, 2 * 0.75);
  close(u.b, 2 * 0.25);
  const f = used([q5("+", "a", 0, 10, 0), q5("+", "a", 5, 11, 0), q5("+", "b", 5, undefined, 0), q5("+", "c", 5, undefined, 0, { parentSessionId: "r" })]);
  close(f.a, 1 / 3);
  close(f.b, 1 / 3);
  close(f.r, 1 / 3); // a child belongs to its parent's root
});

test("quota: warming is not activity; idle gaps (≥ 30 min) and window resets are not attributed", () => {
  const u = used([
    q5("+", "a", 0, 10), q5("+", "a", 5, 11), // +1
    q5("+", "b", 6, 12, 5, { kind: "warming" }), // warming: ignored entirely
    q5("+", "a", 40, 15), // 35 min after the last reading: idle, not pi's
    q5("+", "a", 45, 3, 1, { q5hReset: "r2" }), q5("+", "a", 50, 4, 1, { q5hReset: "r2" }), // new window: +1
  ]);
  close(u.a, 2);
  assert.equal(u.b, undefined);
});

test("quota: readings of parallel sessions interleave and are slightly stale (4, 5, 4, 5, 6 is two points, not three)", () => {
  const u = used([4, 5, 4, 5, 6].map((q, i) => q5("+", i % 2 ? "b" : "a", i, q)));
  close((u.a ?? 0) + (u.b ?? 0), 2);
});

test("quota: a root without any reading stays undefined (it does not dilute quota per hour)", () => {
  const u = used([q5("+", "a", 0, 10), q5("+", "a", 10, 12), ...session("+", "free", 3, 1, 300)]);
  close(u.a, 2);
  assert.equal(u.free, undefined);
});

/** Seeded random world: parallel roots (some with children), a monotone global quota with a window reset and idle gaps, lines without readings or warming. */
function randomWorld(seed: number): any[] {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const roots = ["r0", "r1", "r2", "r3"].slice(0, 2 + Math.floor(rnd() * 3));
  const times = Array.from({ length: 60 }, () => Math.floor(rnd() * 240)).sort((x, y) => x - y);
  let q = 20;
  return times.map((t, i) => {
    const at = i > 40 ? t + 120 : t; // a long idle gap after the 41st line
    q += rnd() < 0.4 ? 1 : 0;
    if (i === 51) q = 1; // window reset
    const root = roots[Math.floor(rnd() * roots.length)];
    const child = rnd() < 0.3;
    return L("+", child ? `${root}-c` : root, at, rnd() < 0.2 ? 0 : Math.round(rnd() * 400) / 100, {
      ...(child ? { parentSessionId: root } : {}), ...(rnd() < 0.2 ? {} : { q5h: q, q5hReset: i > 50 ? "r2" : "r1" }), ...(rnd() < 0.1 ? { kind: "warming" } : {}),
    });
  });
}
/** Independent reference: the global rise between consecutive readings of non-warming requests (monotone readings, so no staleness). */
function globalRise(lines: any[]): number {
  const rs = lines.filter((l) => l.kind !== "warming" && typeof l.q5h === "number").sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts));
  return rs.reduce((s, l, i) => {
    const p = rs[i - 1];
    return p && p.q5hReset === l.q5hReset && Date.parse(l.ts) - Date.parse(p.ts) < 30 * 60_000 ? s + Math.max(0, l.q5h - p.q5h) : s;
  }, 0);
}

test("property: Σ over roots of the quota attributed = the global rise (50 seeded random worlds), and no root gets a negative share", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const lines = randomWorld(seed);
    const units = rootUnits(lines);
    const total = units.reduce((s, u) => s + (u.q5h ?? 0), 0);
    const want = globalRise(lines);
    assert.ok(want > 0, `seed ${seed}: the world has a rise`);
    assert.ok(Math.abs(total - want) < 1e-6, `seed ${seed}: Σ roots ${total} ≠ global rise ${want}`);
    assert.ok(units.every((u) => (u.q5h ?? 0) >= 0));
    assert.ok(Math.abs(quotaAttribution(lines).q5h.total - want) < 1e-6);
  }
});

test("property: the attribution does not depend on the order of the input lines", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const lines = randomWorld(seed).filter((l, i, all) => all.findIndex((x) => x.ts === l.ts) === i); // distinct instants: ties have no order
    const a = used(lines);
    const b = used([...lines].reverse());
    for (const k of Object.keys(a)) close(a[k], b[k] ?? NaN, `seed ${seed} ${k}`);
  }
});
