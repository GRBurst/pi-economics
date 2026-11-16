// An aborted assistant message (pi's stopReason "aborted") is no request: the writer marks it `aborted: true` (meter line v2), and the
// readers count it apart. History: a v1/v2 turn line with a numeric status and no tokens at all was written for an abort before the mark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, renderAnalysis, type Logs } from "../core/analyse.ts";
import { hasUsage, isAborted, isError } from "../core/analyse/logs.ts";
import { cacheSection } from "../core/analyse/cache.ts";
import { localRows } from "../core/analyse/local.ts";
import { aggregate, render } from "../core/report.ts";
import { parsePlans } from "../core/plans.ts";
import { MIN, T0, turn, turns } from "./world.ts";

const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0 };
const none = (meter: any[], extra: Partial<Logs> = {}): Logs => ({ meter, outcomes: [], assignments: [], guards: [], ...extra });
const A = { arm: "-----" };

test("isAborted: the mark, or (history) a v0-v2 turn line with a numeric status and no tokens; missing token fields are 0", () => {
  const t = (extra: object) => turn("s", T0, { ...zero, ...extra });
  assert.equal(isAborted(t({ v: 2, aborted: true })), true);
  assert.equal(isAborted(t({ v: 2, status: "error", aborted: true })), true);
  assert.equal(isAborted(t({ v: 2, aborted: true, output: 2 })), true, "an abort that streamed is still an abort");
  assert.equal(isAborted(t({})), true, "v1, status 200, all 0");
  assert.equal(isAborted(t({ v: 2, status: 429 })), true);
  const { input, cacheRead, cacheWrite, output, ...bare } = t({});
  assert.equal(isAborted(bare), true, "no token field = 0");
  assert.equal(isAborted(t({ output: 1 })), false);
  assert.equal(isAborted(t({ cacheRead: 1 })), false);
  assert.equal(isAborted(t({ status: "error" })), false, "an error line without the mark is an error");
  assert.equal(isAborted(t({ kind: "warming" })), false);
  assert.equal(isAborted(t({ kind: "compaction" })), false);
  assert.equal(isAborted(t({ aborted: false })), true, "the history rule stays");
  assert.equal(isAborted(t({ output: 1, aborted: false })), false);
  assert.equal(isError(t({ v: 2, status: "error", aborted: true })), false, "aborted wins over error");
  assert.equal(isError(t({ status: "error" })), true);
  assert.equal(hasUsage(t({})), false);
  assert.equal(hasUsage(t({ output: 1 })), true);
});

const mixed = [
  turn("s", T0, { arm: "-----" }), turn("s", T0 + MIN, { arm: "-----" }),
  turn("s", T0 + 2 * MIN, { ...zero, v: 2, status: "error", aborted: true, errorClass: "error", errorKind: "other" }),
  turn("s", T0 + 3 * MIN, { ...zero, v: 2, aborted: true }),
  turn("s", T0 + 4 * MIN, { ...zero, input: 7, output: 2, v: 2, aborted: true, costUsd: 0.5 }),
  turn("s", T0 + 5 * MIN, { ...zero }), // history: v1, status 200, no tokens
  turn("s", T0 + 6 * MIN, { ...zero, status: "error", errorClass: "500" }), // an ordinary error
  turn("s", T0 + 7 * MIN, { ...zero, output: 1 }),
  turn("s", T0 + 8 * MIN, { ...zero, kind: "warming", cacheRead: 1000 }),
];

test("meter-report: aborted lines are no requests nor errors, counted in an `aborted` column shown only when some line is aborted", () => {
  const a = aggregate(mixed.map((l) => ({ ...l, ts: l.ts })));
  assert.deepEqual([a.total.requests, a.total.errors, a.total.aborted, a.total.warming], [3, 1, 4, 1]);
  assert.equal(a.byModel[0].aborted, 4);
  assert.equal(a.total.input, 27, "their tokens still add up (the partial usage)");
  const text = render(a);
  assert.equal(text.includes("| aborted |"), true);
  assert.equal(render(aggregate(mixed.slice(0, 2))).includes("aborted"), false);
});

test("analyse cost: aborted lines are no requests, errors nor activity; counted apart; shown only when > 0", () => {
  const base = [...turns("e", T0, 2, A, 10)];
  const meter = [...base,
    turn("e", T0 + 11 * MIN, { ...A, ...zero, v: 2, status: "error", aborted: true }),
    turn("e", T0 + 12 * MIN, { ...A, ...zero }),
    turn("e", T0 + 200 * MIN, { ...A, ...zero, v: 2, aborted: true })]; // hours later: no activity
  const a = analyse(none(meter));
  const b = analyse(none(base));
  assert.deepEqual([a.cost.requests, a.cost.errors, a.cost.aborted], [2, 0, 3]);
  assert.equal(a.cost.byModel[0].requests, 2);
  assert.equal(a.cost.activeHours, b.cost.activeHours);
  assert.equal(renderAnalysis(a).includes("| aborted | 3 |"), true);
  assert.equal(b.cost.aborted, 0);
  assert.equal(renderAnalysis(b).includes("| aborted |"), false);
});

test("analyse budget: spend rows count no aborted request; a window's requests neither", () => {
  const meter = [...turns("e", T0, 2, A, 10), turn("e", T0 + 30 * MIN, { ...A, ...zero }), turn("e", T0 + 31 * MIN, { ...A, ...zero, v: 2, aborted: true, status: "error" })];
  assert.equal(analyse(none(meter)).budget.spend.reduce((s, r) => s + r.requests, 0), 2);
});

test("local: an aborted request is neither a request, a failure nor machine time", () => {
  const plans = parsePlans({ llama: { billing: "local", windows: [], rate: { amount: 2, currency: "EUR", per: "hour" } } });
  const req = (min: number, extra: object = {}) => ({ v: 2, ts: new Date(T0 + min * MIN).toISOString(), sessionId: "s", provider: "llama", model: "q", kind: "turn", billing: "local", status: 200,
    input: 1, cacheRead: 0, cacheWrite: 0, output: 1, costUsd: 0, durationMs: 30 * MIN, ...extra });
  const [r] = localRows([req(30), req(100, { ...zero, aborted: true }), req(200, { aborted: true, status: "error", ...zero })], plans);
  assert.deepEqual([r.requests, r.failed, r.timed, r.untimed, r.sumH], [1, 0, 1, 0, 0.5]);
});

test("cache: an aborted request without tokens is no step: it neither is a request nor looks like a fold", () => {
  const t = (at: number, extra: object) => turn("c", T0 + at * MIN, { ...A, input: 0, output: 0, costUsd: 1, ...extra });
  const lines = [t(0, { cacheRead: 0, cacheWrite: 10_000 }), t(1, { ...zero, v: 2, aborted: true }), t(2, { cacheRead: 10_000, cacheWrite: 200 }), t(3, { cacheRead: 10_200, cacheWrite: 100 })];
  const c = cacheSection(lines);
  assert.equal(c.requests, 3);
  assert.equal(c.events.fold.events, 0);
  assert.equal(c.misses.reduce((s, m) => s + m.n, 0), 0);
});
