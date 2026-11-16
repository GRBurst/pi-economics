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
import { assignment, iso, MIN, T0, turn, turns } from "./world.ts";
import { executedTier } from "../core/analyse/delegation.ts";

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

// ---- v3: the mark exists from schema v3 on; the history rule is for lines written before it ----------------------------------

test("history rule: a v3 line without the mark and without tokens is a request (a provider that reports no usage); v0-v2 ones are aborted", () => {
  const t = (extra: object) => turn("s", T0, { ...zero, ...extra });
  assert.equal(isAborted(t({ v: 3 })), false);
  assert.equal(isAborted(t({ v: 3, aborted: false })), false);
  assert.equal(isAborted(t({ v: 3, aborted: true })), true);
  assert.equal(isAborted(t({ v: 4 })), false, "a later schema writes its own mark");
  assert.equal(isAborted(t({ v: 2 })), true);
  assert.equal(isAborted(t({ v: 2, aborted: false })), true, "the history rule stays for v2");
  assert.equal(isAborted(t({ v: 1 })), true);
  const { v, ...v0 } = t({});
  assert.equal(isAborted(v0), true);
  const a = analyse(none([...turns("e", T0, 2, A, 10), turn("e", T0 + 11 * MIN, { ...A, ...zero, v: 3 })]));
  assert.deepEqual([a.cost.requests, a.cost.aborted], [3, 0]);
});

// ---- the same rule at every reader ---------------------------------------------------------------------------------------------

test("cache: an aborted request is never a request, with partial tokens too (cache.requests = cost.requests)", () => {
  const t = (at: number, extra: object) => turn("c", T0 + at * MIN, { ...A, v: 3, input: 0, output: 0, costUsd: 1, ...extra });
  const lines = [t(0, { cacheRead: 0, cacheWrite: 10_000 }), t(1, { aborted: true, input: 5, output: 2, cacheRead: 10_000, cacheWrite: 0 }), t(2, { cacheRead: 10_000, cacheWrite: 200 })];
  assert.equal(cacheSection(lines).requests, 2);
  assert.equal(analyse(none(lines)).cost.requests, 2);
});

const unitOf = (l: Logs, design: string, stratum: string) => analyse(l).experiment.designs.find((d) => d.design === design)!.strata.find((s) => s.stratum === stratum)!;
const RATE = { amount: 2, currency: "EUR", per: "hour" } as const;
const PLANS = { llama: { billing: "local" as const, windows: [] as ("5h" | "7d")[], rate: RATE } };
const NORATE = { llama: { billing: "local" as const, windows: [] as ("5h" | "7d")[] } };
/** Two local-main roots of 4 requests (v2, 15 min of request time each) in arms "---" and "+--"; `extra` lines are added to the first. */
const localRoots = (extra: Record<string, unknown>[] = []) => {
  const root = (id: string, arm: string) => turns(id, T0, 4, { v: 2, arm, provider: "llama", model: "qwen", costUsd: 0, durationMs: 15 * MIN, input: 1, output: 1 });
  return [...root("l1", "---"), ...extra, ...root("l2", "+--")];
};
const expLogs = (meter: Record<string, unknown>[], plans: Logs["plans"]): Logs =>
  ({ meter, outcomes: [], guards: [], plans, assignments: ["l1", "l2"].map((id, i) => assignment(id, i ? "+--" : "---", T0)) });
const hang = (extra: Record<string, unknown> = {}) => turn("l1", T0 + 5 * MIN, { v: 2, arm: "---", provider: "llama", model: "qwen", costUsd: 0, durationMs: 20 * 60 * MIN, ...extra });

test("experiment: an aborted turn adds no time to wallMs nor localCost (an Esc after a long hang), an ordinary slow request does", () => {
  for (const plans of [PLANS, NORATE]) { // localCost, wallMs
    const base = unitOf(expLogs(localRoots(), plans), "v4", "local");
    const withAbort = unitOf(expLogs(localRoots([hang({ ...zero, aborted: true })]), plans), "v4", "local");
    const slow = unitOf(expLogs(localRoots([hang({ input: 1, output: 1 })]), plans), "v4", "local");
    assert.deepEqual(withAbort.effects, base.effects);
    assert.deepEqual(withAbort.balance.map((b) => [b.arm, b.timedLines, b.untimedLines]), base.balance.map((b) => [b.arm, b.timedLines, b.untimedLines]));
    assert.notDeepEqual(slow.effects, base.effects, "the control moves the objective");
  }
});

test("experiment: a local aborted request adds no machine time to a cloud unit's secondary column", () => {
  const cloud = (id: string, arm: string) => turns(id, T0, 7, { v: 2, arm, costUsd: 1 });
  const aborted = turn("a-c", T0 + 5 * MIN, { v: 2, parentSessionId: "a", arm: "---", provider: "llama", model: "qwen", ...zero, durationMs: 60 * MIN, aborted: true });
  const other = (ms: Record<string, unknown>[]) => unitOf({ meter: ms, outcomes: [], guards: [], plans: PLANS, assignments: [assignment("a", "---", T0), assignment("b", "+--", T0)] }, "v4", "api").balance.map((b) => [b.arm, b.other]);
  assert.deepEqual(other([...cloud("a", "---"), aborted, ...cloud("b", "+--")]), other([...cloud("a", "---"), ...cloud("b", "+--")]));
});

test("experiment: an aborted first request does not decide a root's stratum, nor does an aborted one count as a model switch", () => {
  // strataOf: the root's first main request is an aborted one of the local provider; the first real request is a cloud one
  const cloud = (id: string, arm: string) => turns(id, T0 + MIN, 7, { arm, costUsd: 1 });
  const abortedFirst = (id: string, arm: string) => turn(id, T0, { arm, provider: "llama", model: "qwen", ...zero }); // history form: v1, status 200, no tokens
  const l: Logs = { meter: [abortedFirst("a", "---"), ...cloud("a", "---"), abortedFirst("b", "+--"), ...cloud("b", "+--")], outcomes: [], guards: [], plans: PLANS,
    assignments: [assignment("a", "---", T0), assignment("b", "+--", T0)] };
  assert.deepEqual(analyse(l).experiment.designs.find((d) => d.design === "v4")!.strata.map((s) => s.stratum), ["api"]);
});

test("experiment: `switched` ignores an aborted request of another billing class", () => {
  const D = "a1b2c3d4e5f6";
  const row = (id: string, arm: string) => ({ v: 2, ts: iso(T0), sessionId: id, design: D, mode: "explore", eligible: true, stratum: "api", arm,
    factors: { warmPolicy: { lever: "cache-lifecycle.warmPolicy", assigned: ["native", "orchestrator-aware"][Number(arm[0])] } } });
  const cloud = (id: string, arm: string) => turns(id, T0 + MIN, 7, { v: 2, arm, design: D, costUsd: 1 });
  const stray = (id: string, arm: string) => turn(id, T0 + 3 * MIN, { v: 2, arm, design: D, provider: "llama", model: "qwen", ...zero, aborted: true });
  const l = (strayOn: string[]): Logs => ({ outcomes: [], guards: [], plans: NORATE, assignments: ["a", "b", "c", "d"].map((id, i) => row(id, i % 2 ? "1" : "0")),
    meter: ["a", "b", "c", "d"].flatMap((id, i) => [...cloud(id, i % 2 ? "1" : "0"), ...(strayOn.includes(id) ? [stray(id, i % 2 ? "1" : "0")] : [])]) });
  assert.equal(unitOf(l(["a", "b"]), D, "api").sensitivity!.switched, 0);
  const real = l([]); real.meter = real.meter.map((x, i) => (i === 3 ? { ...x, provider: "llama", model: "qwen" } : x));
  assert.equal(unitOf(real, D, "api").sensitivity!.switched, 1, "control: a real request of another class is a switch");
});

// ---- delegation --------------------------------------------------------------------------------------------------------------

test("delegation: an aborted child request is no request: not the executed tier, not a runaway request, not in the model rows nor the request share", () => {
  const child = (at: number, extra: Record<string, unknown> = {}) => turn("c1", T0 + at * MIN, { parentSessionId: "root", provider: "p", model: "m1", ...extra });
  const real = [child(0), child(1)];
  const aborts = [child(5, { ...zero, v: 3, aborted: true, model: "m-abort" }), child(6, { ...zero, v: 2, model: "m-hist" }), child(7, { ...zero, v: 3, aborted: true, status: "error" })];
  assert.equal(executedTier({}, [...real, ...aborts]), "p/m1");
  const root = turns("root", T0, 2, {}, 1);
  const d = (meter: Record<string, unknown>[]) => analyse({ meter, outcomes: [], assignments: [], guards: [], routerSettings: { runaway: { requests: 2, usd: 100 } } }).delegation;
  const a = d([...root, ...real, ...aborts]);
  assert.deepEqual(a.runaways, [], "2 requests are no runaway at a limit of 2, however many aborted lines");
  assert.deepEqual(a.childModels.map((m) => [m.model, m.requests]).sort(), [["m-abort", 0], ["m-hist", 0], ["m1", 2]]);
  assert.equal(a.childRequestShare, 0.5);
  assert.equal(d([...root, ...real, child(8)]).runaways.length, 1, "control: a third real request is");
});
