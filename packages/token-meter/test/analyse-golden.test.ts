// Characterization goldens of the analyser (redesign M0.S, T0.3): every section of the report, rendered from one
// fixture, equals test/golden/<section>.txt byte for byte. They pin today's output so that the analyser can move into
// core/analyse/* (T0.4) and later milestones can change one section and one golden at a time (P4). The test never writes
// a golden (the build sandbox is read-only, P5): a mismatch fails with the actual text, JSON-encoded on one
// `GOLDEN-ACTUAL <section> <json>` line, which is what the new golden file is made from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leversLine, type LeverState } from "../core/levers.ts";
import { analyse, renderAnalysis, renderBudget, renderCache, renderCost, renderDelegation, renderExperiment, renderFolds, renderGuards, renderLevers, renderQuality, renderRandomized, renderSpotChecks, type Logs } from "../core/analyse.ts";
import { assignment, iso, MIN, T0, turn, turns, world } from "./world.ts";

const at = (minutes: number): number => T0 + minutes * MIN;

/**
 * world() plus what its six sessions and three tasks do not reach, so that no section renders "no data": a fold and a cold resume
 * (v2 and v4 sessions), a v3 session beside the v2 ones (the pooled-designs note), eight v4 sessions in four arms, an error line, an
 * out-of-period line, roots without an arm, randomized spawns with a router control, spot checks (agree, disagree, pending), an unresolved card, a
 * reroute, a corrective, a failed check, a runaway child, and joins that do not resolve (data quality).
 */
function goldenLogs(): Logs {
  const w = world();
  const meter: Record<string, unknown>[] = [...w.meter];
  const outcomes: Record<string, unknown>[] = [...w.outcomes];
  const assignments: Record<string, unknown>[] = [...w.assignments];
  const guards: Record<string, unknown>[] = [...w.guards];

  // folds: a context of 20k that shrinks to 5k at the 7th request, then a 10-minute gap and a cold resume (a v2 session with foldHint
  // cache-aware, a v4 session without foldHint)
  const folding = (sessionId: string, arm: string, start: number): Record<string, unknown>[] => [
    ...turns(sessionId, start, 6, { arm, cacheRead: 20_000, cacheWrite: 200, costUsd: 0.5 }, 1),
    turn(sessionId, start + 6 * MIN, { arm, cacheRead: 2_000, cacheWrite: 3_000, costUsd: 0.8 }),
    ...turns(sessionId, start + 7 * MIN, 3, { arm, cacheRead: 5_000, cacheWrite: 100, costUsd: 0.2 }, 1),
    turn(sessionId, start + 20 * MIN, { arm, cacheRead: 0, cacheWrite: 5_100, costUsd: 0.9 }),
    ...turns(sessionId, start + 21 * MIN, 2, { arm, cacheRead: 5_100, cacheWrite: 100, costUsd: 0.2 }, 1),
  ];
  meter.push(...folding("f1", "++++++", at(200)), ...folding("f2", "---", at(200)));
  // a system-prompt change inside the TTL (meter v2 systemHash, M3b): f1's third request ran under another system state (cause prefix)
  const f1 = meter.filter((l) => l.sessionId === "f1");
  ["0123456789abcdef", "0123456789abcdef", "fedcba9876543210"].forEach((systemHash, i) => Object.assign(f1[i], { systemHash }));
  assignments.push(assignment("f1", "++++++", at(199)), assignment("f2", "---", at(199)));

  // a v3 session shares its arm id with the v2 sessions (analysed apart), v4 sessions fill four arms
  meter.push(...turns("m7", at(240), 4, { arm: "------", costUsd: 2 }));
  assignments.push({ ...assignment("m7", "------", at(239)), design: "v3" });
  const v4: Array<[string, string, number]> = [["n1", "---", 1], ["n2", "---", 1.5], ["n3", "+++", 3], ["n4", "+++", 2.5], ["n5", "+--", 2], ["n6", "+--", 2], ["n7", "-+-", 1], ["n8", "-+-", 1.2]];
  v4.forEach(([id, arm, usd], i) => {
    meter.push(...turns(id, at(260 + 70 * i), 4, { arm, costUsd: usd, q7d: 20 + i, q7dReset: "2026-10-12T00:00:00.000Z" }));
    assignments.push(assignment(id, arm, at(259 + 70 * i)));
  });

  // roots without an arm: one without an assignment, one whose assignment its lines do not carry
  meter.push(...turns("bare1", at(800), 3, { costUsd: 0.2 }), ...turns("bare2", at(820), 3, { costUsd: 0.4 }));
  assignments.push(assignment("bare2", "---", at(819)));

  // an error line (no usage), a line before the period, a line without a provider (contract), a child whose parent is unknown
  meter.push({ v: 1, ts: iso(at(45)), sessionId: "m3", provider: "anthropic", model: "claude-opus", kind: "turn", status: "error", retries: 1, retryWaitMs: 500, arm: "------" });
  meter.push(turn("old", at(-24 * 60), { arm: "-----", costUsd: 9 }));
  meter.push({ ...turn("m1", at(40)), provider: undefined });
  meter.push(...turns("orphan", at(80), 2, { arm: "------", parentSessionId: "gone", costUsd: 0.3 }, 1));

  // a local provider (meter v2, billing local, no plan rate: the Budget's local row says "no rate")
  meter.push(...turns("loc1", at(90), 2, { v: 2, provider: "llama", model: "qwen3.8", billing: "local", costUsd: 0, durationMs: 90_000, input: 100, cacheRead: 0, cacheWrite: 0, output: 50 }, 2));

  // delegation: spawns with a child session of one request each, under m3
  const spawn = (taskId: string, sessionId: string, workerTier: string, extra: Record<string, unknown> = {}, when = 100): Record<string, unknown> =>
    ({ v: 1, ts: iso(at(when)), event: "spawn", taskId, cardHash: "h", kind: "implement", workerTier, workerEffort: "high", base: workerTier, importance: "normal", reasons: [], arm: "------", sessionId, parentSessionId: "m3", ...extra });
  const verdict = (taskId: string, v: string, when: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ v: 1, ts: iso(at(when)), event: "verdict", taskId, verdict: v, note: "", ...extra });
  const child = (sessionId: string, usd: number, when: number): Record<string, unknown> =>
    turn(sessionId, at(when), { arm: "------", parentSessionId: "m3", costUsd: usd, provider: "openrouter", model: "qwen" });

  // router tasks on qwen (the control; c2 is rerouted below to another model: a fallback run; c6 and c7 are old lines) and random ones on qwen, haiku, T1: eight judged tasks each
  const verdicts = ["accepted", "accepted", "rejected", "accepted", "partial", "accepted", "rejected", "accepted"];
  verdicts.forEach((v, i) => {
    outcomes.push(spawn(`c${i}`, `kc${i}`, "qwen", i < 6 ? { assigned: "router", routeBase: "qwen", factors: { rule: "off" } } : {}), verdict(`c${i}`, v, 110 + i)); // c6, c7: from before the randomization (no assigned, no factors)
    meter.push(child(`kc${i}`, 0.1 + 0.05 * i, 101 + i));
    const tier = ["qwen", "haiku", "T1", "qwen"][i % 4];
    outcomes.push(spawn(`r${i}`, `kr${i}`, tier, { assigned: "random", routeBase: "qwen", factors: { rule: "on", cap: 2 + 2 * (i % 2) } }), verdict(`r${i}`, verdicts[(i + 3) % 8], 120 + i));
    meter.push(child(`kr${i}`, tier === "qwen" ? 0.1 : tier === "haiku" ? 0.3 : 0.9, 105 + i));
  });
  outcomes.push(spawn("rx", "krx", "T2", { assigned: "random", routeBase: "T1" }), verdict("rx", "accepted", 130));
  meter.push(child("krx", 1.5, 106));
  outcomes.push(spawn("u1", "ku1", "qwen", { unresolved: true }));

  // spot checks: c0 reviewed by r-c0 (agree), c1 by r-c1 (disagree), c3 requested but not reviewed (pending)
  const requested = (taskId: string, when: number): Record<string, unknown> => ({ v: 1, ts: iso(at(when)), event: "spotcheck", taskId });
  outcomes.push(requested("c0", 140), requested("c1", 140), requested("c3", 140));
  outcomes.push(spawn("r-c0", "krc0", "T1", { reviewOf: "c0" }, 141), verdict("r-c0", "accepted", 145, { reviewOf: "c0", reviewerVerdict: "accepted" }));
  outcomes.push(spawn("r-c1", "krc1", "T1", { reviewOf: "c1" }, 141), verdict("r-c1", "rejected", 145, { reviewOf: "c1", reviewerVerdict: "rejected" }));
  meter.push(child("krc0", 0.4, 142), child("krc1", 0.4, 143));

  // reroute, corrective, a failed check, an escalation whose spawn is unknown, a runaway child, task events without a spawn
  outcomes.push({ v: 1, ts: iso(at(150)), event: "reroute", taskId: "c2", from: "qwen", to: "T1", reason: "offline" });
  outcomes.push({ v: 1, ts: iso(at(151)), event: "corrective", taskId: "c2" });
  outcomes.push({ v: 1, ts: iso(at(152)), event: "check", taskId: "c2", exit: 1, durationMs: 9 });
  outcomes.push({ v: 1, ts: iso(at(153)), event: "escalate", taskId: "gone-task", from: "cloud", to: "T1", attemptOf: "gone-task" });
  outcomes.push({ v: 1, ts: iso(at(154)), event: "check", taskId: "nospawn", exit: 0, durationMs: 1 });
  meter.push(child("runaway", 11, 155));
  outcomes.push(spawn("t-run", "runaway", "T1", {}, 154));

  // levers lines (meter v2, M3b): f1 changed its levers before its first request (the earlier line is shadowed), infinite-context
  // there (compaction levers inert); f2 refused one assignment; the v4 sessions show five thinking levels; one child
  const lv = (sessionId: string, when: number, levers: Record<string, LeverState>, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    leversLine({ ts: iso(at(when)), sessionId, eligible: false, ...extra, levers }) as unknown as Record<string, unknown>;
  const compaction = (enabled: boolean, s: "ext" | "fixed"): Record<string, LeverState> =>
    ({ "pi.compaction.enabled": { v: enabled, s }, "pi.compaction.reserveTokens": { v: 16384, s: "fixed" } });
  meter.push(
    lv("f1", 199, { "pi.defaultThinkingLevel": { v: "medium", s: "fixed" } }, { arm: "++++++", eligible: true }),
    lv("f1", 200, { "pi.defaultThinkingLevel": { v: "high", s: "pe", a: "high", rb: "confirmed", tier: "control" }, ...compaction(false, "ext"),
      "pi.promptCache": { v: "long", s: "pe", a: "long", rb: "unverified", tier: "seed" } }, { arm: "++++++", eligible: true }),
    lv("f2", 200, { "pi.defaultThinkingLevel": { v: "medium", s: "ext", a: "low", rb: "refused", tier: "control" }, ...compaction(true, "fixed"),
      "pi.promptCache": { v: "short", s: "pe", a: "short", rb: "confirmed", tier: "seed" } }, { arm: "---", eligible: true }),
    ...v4.map(([id, arm], i) => lv(id, 260 + 70 * i, { "pi.defaultThinkingLevel": { v: ["minimal", "low", "medium", "high", "xhigh"][i % 5], s: "fixed" } }, { arm, eligible: true })),
    lv("kc0", 101, { "pi.defaultThinkingLevel": { v: "medium", s: "fixed" } }, { arm: "------", parentSessionId: "m3" }),
  );

  // guards and assignments of sessions without meter lines
  guards.push({ v: 1, ts: iso(at(60)), sessionId: "ghost", arm: "++++++", event: "correction" });
  assignments.push(assignment("ghost2", "---", at(61)));

  return {
    meter, outcomes, assignments, guards,
    files: [{ log: "meter", file: "meter/2026-10.jsonl", lines: meter.length, unparsable: 2 }, { log: "outcomes", file: "task-router/outcomes/2026-10.jsonl", lines: outcomes.length, unparsable: 0 }],
    expSettings: { baseline: "---", guards: { minSessions: 2, threshold: 0.2, peekThreshold: 0.5, correctionThreshold: 0.5, ratingThreshold: 0.5 } },
    routerSettings: { runaway: { requests: 150, usd: 10 } },
  };
}

/**
 * Design v4 in three strata (redesign M2c): subscription (anthropic, 3 + 3 roots, 1 h each, one more under MIN_HOURS), api (a provider
 * without a plan: 1 + 1 roots, no CI), local (llama with a rate, meter v2 lines with durationMs, 2 + 2 roots of 0.5 h).
 */
function strataLogs(): Logs {
  const root = (id: string, arm: string, start: number, extra: Record<string, unknown>, n = 7, gap = 10) => turns(id, at(start), n, { arm, ...extra }, gap);
  const meter: Record<string, unknown>[] = [];
  const sub: Array<[string, string, number]> = [["s1", "---", 7], ["s2", "---", 8.4], ["s3", "---", 6.3], ["s4", "+--", 14], ["s5", "+--", 11.2], ["s6", "+--", 16.1]];
  sub.forEach(([id, arm, usd], i) => meter.push(...root(id, arm, 70 * i, { costUsd: usd / 7 })));
  meter.push(...root("s7", "---", 500, { costUsd: 50 }, 2, 0.6));
  meter.push(...root("a1", "---", 600, { provider: "openrouter", model: "glm", costUsd: 0.3 }), ...root("a2", "+--", 700, { provider: "openrouter", model: "glm", costUsd: 0.6 }));
  const loc: Array<[string, string, number]> = [["l1", "---", 800_000], ["l2", "---", 1_000_000], ["l3", "+--", 1_500_000], ["l4", "+--", 1_300_000]];
  loc.forEach(([id, arm, ms], i) => meter.push(...root(id, arm, 800 + 40 * i, { v: 2, provider: "llama", model: "qwen", costUsd: 0, durationMs: ms }, 4)));
  const plans = { anthropic: { billing: "subscription" as const, windows: ["5h" as const] }, llama: { billing: "local" as const, windows: [], rate: { amount: 2, currency: "EUR", per: "hour" as const } } };
  return { meter, outcomes: [], guards: [], plans, assignments: [...new Set(meter.map((l) => String(l.sessionId)))].map((id) => assignment(id, String(meter.find((l) => l.sessionId === id)!.arm), at(0))) };
}

/**
 * The Budget section (redesign M4): fourteen complete 5-hour windows of an Anthropic subscription (Opus 5.5 lines, v2), seven in the last 28
 * days that took 30% more quota points per API-eq $ than the seven 30–36 days before (the drift flag), one window that hit its cap (a reading of
 * 100, then a 429), v1 pi-retry and v2 native retry fields, a 7-day window still running, an api provider (cash $) and a local one with a rate.
 */
function budgetLogs(): Logs {
  const P = 1e-6, DAYMS = 86_400_000, end = Date.parse("2026-11-12T15:00:00Z");
  const meter: Record<string, unknown>[] = [];
  const BETA = { input: 1, cacheRead: 0.6, cacheWrite: 1.4, output: 1.3 };
  for (let i = 0; i < 14; i++) {
    const reset = end - (i < 7 ? 6 - i : 36 - (i - 7)) * DAYMS; // i < 7: 6..0 days before; i ≥ 7: 36..30 days before, in time order below
    const tok = { input: 50_000, cacheRead: 3_000_000 * (1 + (i % 3)), cacheWrite: 1_000_000 * (1 + ((i * 2) % 4)), output: 100_000 * (1 + ((i * 5) % 3)), cacheWrite1h: 0 };
    const usd = { input: 4 * P * tok.input, cacheRead: 0.2 * P * tok.cacheRead, cacheWrite: 5 * P * tok.cacheWrite, output: 20 * P * tok.output };
    const points = (BETA.input * usd.input + BETA.cacheRead * usd.cacheRead + BETA.cacheWrite * usd.cacheWrite + BETA.output * usd.output) * (i < 7 ? 1.3 : 1);
    const peak = Math.min(100, Math.round(points * 2)); // two identical lines per window
    for (let j = 0; j < 2; j++) {
      meter.push({ v: 2, ts: iso(reset - (j ? 3 : 4) * 3_600_000), sessionId: `w${i}`, provider: "anthropic", model: "claude-opus-5-5", kind: "turn", billing: "subscription", status: 200, ...tok,
        costUsd: usd.input + usd.cacheRead + usd.cacheWrite + usd.output, retries: i === 3 && j ? 1 : 0, retryWaitMs: i === 3 && j ? 2_000 : 0, durationMs: 4_000,
        q5h: j ? peak : Math.round(peak / 2), q5hReset: iso(reset), q7d: 20, q7dReset: "2026-11-19T00:00:00.000Z" });
    }
    if (i === 6) { // the running window hits its cap: a reading of 100, then a 429
      meter.push({ v: 2, ts: iso(reset - 2 * 3_600_000), sessionId: "w6", provider: "anthropic", model: "claude-opus-5-5", kind: "turn", billing: "subscription", status: "error", errorClass: "429", errorKind: "rate_limit", retries: 0, retryWaitMs: 0, durationMs: 300 });
      meter.find((l) => l.sessionId === "w6" && l.q5h === peak)!.q5h = 100;
    }
  }
  meter.push({ v: 1, ts: "2026-11-12T11:00:00.000Z", sessionId: "old", provider: "anthropic", model: "claude-opus-5-5", kind: "turn", status: "error", errorClass: "429", retries: 4, retryWaitMs: 30_000 }); // v1: pi-retry's totals
  meter.push({ v: 2, ts: "2026-11-12T12:00:00.000Z", sessionId: "or", provider: "openrouter", model: "gpt-6-luna", kind: "turn", billing: "api", status: 200, input: 1000, output: 1000, costUsd: 0.05, durationMs: 2_000 });
  for (const [k, ms] of [[0, 600_000], [1, 1_200_000], [2, undefined]] as const) meter.push({ v: 2, ts: iso(end - 3_600_000 + k * 60_000), sessionId: "ll", provider: "llama", model: "qwen3.8", kind: "turn", billing: "local", status: 200, input: 5000, output: 500, costUsd: 0, ...(k === 0 ? { genMs: 8_000, cacheN: 4_000, promptN: 1_000 } : {}), ...(ms ? { durationMs: ms } : {}) });
  // M8: a second model id of the same provider (the q4 profile), well after the others: no overlap, the same rate
  meter.push({ v: 2, ts: iso(end - 1_800_000), sessionId: "ll", provider: "llama", model: "qwen3.8-q4", kind: "turn", billing: "local", status: 200, input: 2000, output: 900, costUsd: 0, durationMs: 900_000, genMs: 18_000, cacheN: 500, promptN: 1_500 });
  const plans = { anthropic: { billing: "subscription" as const, windows: ["5h" as const, "7d" as const] }, llama: { billing: "local" as const, windows: [], rate: { amount: 0.25, currency: "EUR", per: "hour" as const } }, openrouter: { billing: "api" as const, windows: [] } };
  return { meter, outcomes: [], assignments: [], guards: [], plans, currencyRates: { "USD/EUR": 0.9 } };
}

const PERIOD = { since: "2026-10-05", until: "2026-10-05" };
const GENERATED = new Date("2026-10-06T08:30:00Z");
const a = analyse(goldenLogs(), PERIOD);
/** A calibrated β (points per API-eq $) for the est. points columns of Cache and the fold ledger. */
const BETA = { input: 1, cacheRead: 0.6, cacheWrite: 1.4, output: 1.3 };

const sections: Record<string, () => string> = {
  cost: () => renderCost(a.cost),
  budget: () => renderBudget(analyse(budgetLogs()).budget),
  cache: () => renderCache(a.cost.cache, BETA),
  levers: () => renderLevers(a.levers),
  folds: () => renderFolds(a.cost.folds, BETA),
  experiment: () => renderExperiment(a.experiment.designs),
  "experiment-strata": () => renderExperiment(analyse(strataLogs()).experiment.designs),
  randomized: () => renderRandomized(a.delegation.randomized),
  spotchecks: () => renderSpotChecks(a.delegation.spotChecks),
  delegation: () => renderDelegation(a.delegation),
  guards: () => renderGuards(a.guards),
  quality: () => renderQuality(a.quality),
  analysis: () => renderAnalysis(a, GENERATED),
};

for (const [name, render] of Object.entries(sections)) {
  test(`golden ${name}: the rendered section equals test/golden/${name}.txt`, () => {
    const actual = render();
    const expected = readFileSync(new URL(`./golden/${name}.txt`, import.meta.url), "utf8");
    if (actual === expected) return;
    const [x, y] = [expected.split("\n"), actual.split("\n")];
    const line = x.findIndex((l, i) => l !== y[i]);
    const first = line === -1 ? Math.min(x.length, y.length) : line;
    assert.fail(`golden ${name} differs at line ${first + 1}:\n  expected: ${JSON.stringify(x[first])}\n  actual:   ${JSON.stringify(y[first])}\nGOLDEN-ACTUAL ${name} ${JSON.stringify(actual)}`);
  });
}

test("the goldens cover real data: no section is the empty-state line", () => {
  for (const [name, render] of Object.entries(sections)) {
    const text = render();
    assert.ok(text.length > 0, `${name} renders nothing`);
    assert.ok(!text.startsWith("_no data in the period_") && !text.includes("\n_no "), `${name} renders an empty state: ${text.slice(0, 80)}`);
  }
});

test("M4 (B11): the report no longer claims a pi share of the account quota; its sections run Budget, Fleet, Cache, Levers, Experiments, Router, Guards, Data quality", () => {
  for (const text of [renderAnalysis(a, GENERATED), renderQuality(a.quality)]) {
    assert.ok(!/share of the account quota/i.test(text) && !/pi share/i.test(text), "a tautological share row is back");
    assert.ok(!/%\/active hour/.test(text), "a per-session quota row is back (quota is the budget, never charged to a session: Q2)");
  }
  assert.ok(!("q5hPerHour" in a.cost) && !("q7dPerHour" in a.cost));
  const heads = renderAnalysis(a, GENERATED).split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(heads, ["## Budget", "## Fleet", "## Cache", "## Levers", "## Experiments", "## Router", "## Guards", "## Data quality"]);
});

test("M4: money carries its label — API-eq $ for list prices, cash $ for what is charged, est. points for the calibrated quota", () => {
  const text = renderAnalysis(a, GENERATED);
  assert.ok(text.includes("API-eq $") && text.includes("cash $") && text.includes("est. points"));
  const budgetText = renderBudget(analyse(budgetLogs()).budget);
  assert.ok(budgetText.includes("EUR"), "a local cost names its currency");
  assert.ok(budgetText.includes("not observable") === false, "the fixture observes its retry waits");
});

test("M4: a component under 1 % of the windows' $ is shown as not identifiable, not with its noisy β", () => {
  const b = analyse(budgetLogs()).budget;
  const g = b.groups.find((x) => x.kind === "5h")!;
  assert.ok(!("notEnough" in g.fit));
  if ("notEnough" in g.fit) return;
  g.fit.share.input = 0.0001; g.fit.beta.input = 550;
  const text = renderBudget(b);
  assert.ok(text.includes("| input | not identifiable (fit 550.00, under 1% of the $) | 0% |"), text.slice(text.indexOf("#### anthropic 5h"), 1200 + text.indexOf("#### anthropic 5h")));
});

/** Review M8 #1: a rated local provider whose lines are all meter v1 (no `durationMs`): the Budget says not measurable, never 0.00 EUR or a total. */
test("golden budget-untimed: untimed v1 local lines have no cost, no currency row and no total", () => {
  const meter = [0, 1, 2].map((k) => ({ v: 1, ts: iso(Date.parse("2026-11-12T10:00:00Z") + k * 60_000), sessionId: "ll", provider: "llama", model: "qwen3.8", kind: "turn", status: 200, input: 5000, output: 500, costUsd: 0, retries: 0, retryWaitMs: 0 }));
  const plans = { llama: { billing: "local" as const, windows: [], rate: { amount: 0.25, currency: "EUR", per: "hour" as const } } };
  const actual = renderBudget(analyse({ meter, outcomes: [], assignments: [], guards: [], plans }).budget);
  const expected = readFileSync(new URL("./golden/budget-untimed.txt", import.meta.url), "utf8");
  if (actual !== expected) assert.fail(`golden budget-untimed differs\nGOLDEN-ACTUAL budget-untimed ${JSON.stringify(actual)}`);
});
