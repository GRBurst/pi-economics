// M4 (design §6.1, §9.2; T4.1, T4.2): quota windows from the meter lines: peak, lockout, time to cap, the window's API-eq $ by token
// component, 429 requests and retry wait (v1 pi-retry lines and v2 native ones). Hand-computed fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { windowsOf } from "../core/analyse/budget.ts";
import { parsePlans } from "../core/plans.ts";

const day = "2026-11-02T";
const at = (hm: string): string => `${day}${hm}:00.000Z`;
const R1 = at("15:00"), R2 = at("20:00"), R3 = "2026-11-03T01:00:00.000Z", D7 = "2026-11-07T00:00:00.000Z";
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-12 + 1e-9 * Math.abs(b), `${a} ≈ ${b}`);

// One request of 100 input, 10000 read, 2000 write, 200 output tokens at unit prices: $1e-4 + 1e-3 + 2.5e-3 + 1e-3 = $4.6e-3 (model "claude-x": the default ratios)
const TOK = { input: 100, cacheRead: 10_000, cacheWrite: 2000, output: 200, costUsd: 4.6e-3 };
const line = (hm: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ v: 1, ts: at(hm), sessionId: "s1", provider: "anthropic", model: "claude-x", kind: "turn", status: 200, ...TOK, retries: 0, retryWaitMs: 0, ...extra });
const q = (q5h: number, reset: string, extra: Record<string, unknown> = {}) => ({ q5h, q5hReset: reset, q7d: 31, q7dReset: D7, ...extra });

function meter(): Record<string, unknown>[] {
  return [
    { v: 1, ts: at("09:30"), sessionId: "l1", provider: "llama", model: "qwen3.8", kind: "turn", status: 200, input: 5, output: 5, costUsd: 0 }, // the log starts here; another provider
    // window 1 (reset 15:00, start 10:00): a main turn, a child turn, a warming line, a v1 429 (pi-retry's totals on the error line), a 99 reading, a v2 rate-limit error after it
    line("10:05", q(10, R1)),
    line("11:00", { sessionId: "s2", parentSessionId: "s1", ...q(25, R1) }),
    line("12:00", { kind: "warming", retries: undefined, retryWaitMs: undefined, ...q(30, R1) }),
    { v: 1, ts: at("13:00"), sessionId: "s1", provider: "anthropic", model: "claude-x", kind: "turn", status: "error", errorClass: "429", retries: 3, retryWaitMs: 4000 },
    line("13:30", q(99, R1)),
    { v: 2, ts: at("14:00"), sessionId: "s1", provider: "anthropic", model: "claude-x", kind: "turn", status: "error", errorClass: "429", errorKind: "rate_limit", retries: 0, retryWaitMs: 0, durationMs: 300 },
    // window 2 (reset 20:00, start 15:00): a v2 retry with its wait, a reading of 100 (the cap)
    line("15:30", { v: 2, ...q(40, R2), retries: 1, retryWaitMs: 2000 }),
    line("18:00", { v: 2, ...q(100, R2), retries: 0, retryWaitMs: 0 }),
    { v: 2, ts: at("19:00"), sessionId: "s1", provider: "anthropic", model: "claude-x", kind: "turn", status: "error", errorKind: "rate_limit", errorClass: "429", retries: 0, retryWaitMs: 0 },
    // window 3 (reset 01:00 next day): still running at the last line
    line("20:30", q(5, R3)),
    line("21:00", { provider: "openrouter", model: "qwen", costUsd: 0 }),
  ];
}

test("windowsOf: one window per provider, kind and reset, ordered by reset; peak, start, requests and the window's $ by component (all sessions)", () => {
  const ws = windowsOf(meter(), {});
  const five = ws.filter((w) => w.kind === "5h");
  assert.deepEqual(five.map((w) => [w.provider, w.reset, w.start, w.peak, w.complete]), [
    ["anthropic", R1, at("10:00"), 99, true], ["anthropic", R2, at("15:00"), 100, true], ["anthropic", R3, at("20:00"), 5, false]]);
  const w1 = five[0];
  assert.equal(w1.requests, 3, "main + child + the 99 turn; the warming line and the error lines are no request");
  close(w1.usd.input, 4 * 1e-4); close(w1.usd.cacheRead, 4 * 1e-3); close(w1.usd.cacheWrite, 4 * 2.5e-3); close(w1.usd.output, 4 * 1e-3); // four priced lines incl. the warming one
  assert.equal(five[1].requests, 2);
  assert.deepEqual(Object.keys(w1.usd).sort(), ["cacheRead", "cacheWrite", "input", "output"]);
});

test("windowsOf: the 7-day window starts 7 days before its reset; it is incomplete when the log does not reach its start", () => {
  const seven = windowsOf(meter(), {}).filter((w) => w.kind === "7d");
  assert.equal(seven.length, 1);
  assert.equal(seven[0].start, "2026-10-31T00:00:00.000Z");
  assert.equal(seven[0].peak, 31);
  assert.equal(seven[0].complete, false, "the log starts on 11-02, the window on 10-31; and its reset is in the future");
  close(seven[0].usd.cacheRead, 7 * 1e-3); // seven priced Anthropic lines in the span: w1 four (incl. warming), w2 two, w3 one
});

test("T4.2 lockout and time to cap: a reading of 100 starts the lockout at that line, a 429 after a 99 reading starts it at the error; both last until the reset", () => {
  const [w1, w2, w3] = windowsOf(meter(), {}).filter((w) => w.kind === "5h");
  assert.equal(w2.timeToCapMs, 3 * 3_600_000, "first reading of 100 at 18:00, window start 15:00");
  assert.equal(w2.lockoutMs, 2 * 3_600_000);
  assert.equal(w1.timeToCapMs, 4 * 3_600_000, "99 at 13:30, then the rate-limit error at 14:00: capped from 14:00");
  assert.equal(w1.lockoutMs, 3_600_000);
  assert.equal(w3.timeToCapMs, undefined);
  assert.equal(w3.lockoutMs, 0);
});

test("T4.2 429 requests and retry wait: v1 errorClass 429 and v2 errorKind rate_limit count once each; the wait sums retryWaitMs of the window's lines", () => {
  const [w1, w2, w3] = windowsOf(meter(), {}).filter((w) => w.kind === "5h");
  assert.equal(w1.r429, 2, "one v1 line (errorClass 429), one v2 line (both fields: counted once)");
  assert.equal(w2.r429, 1);
  assert.equal(w3.r429, 0);
  assert.equal(w1.retryWaitMs, 4000); assert.equal(w1.retries, 3);
  assert.equal(w2.retryWaitMs, 2000); assert.equal(w2.retries, 1);
});

test("T4.2 a window none of whose lines carries retryWaitMs has none (not observable), never 0", () => {
  const ls = meter().map((l) => { const { retries, retryWaitMs, ...rest } = l; return rest; });
  for (const w of windowsOf(ls, {})) { assert.equal(w.retryWaitMs, undefined); assert.equal(w.retries, undefined); }
});

test("windowsOf: an error line of another kind (not 429) is no 429; a line without a reset or with a non-numeric reading is no window", () => {
  const ls = [...meter(), { ...line("16:00"), status: "error", errorClass: "529", errorKind: "other" }, line("16:10", { q5h: "7", q5hReset: R2 }), line("16:20", { q5h: 7 })];
  const w2 = windowsOf(ls, {}).filter((w) => w.kind === "5h")[1];
  assert.equal(w2.r429, 1);
  assert.equal(w2.peak, 100);
});

test("windowsOf: plans decide the providers and kinds — a subscription plan lists its windows; a provider billed otherwise has no quota window; no plan = whatever the lines carry", () => {
  const sub = parsePlans({ anthropic: { billing: "subscription", windows: ["5h"] } });
  assert.deepEqual([...new Set(windowsOf(meter(), sub).map((w) => w.kind))], ["5h"]);
  const both = parsePlans({ anthropic: { billing: "subscription", windows: ["5h", "7d"] } });
  assert.deepEqual([...new Set(windowsOf(meter(), both).map((w) => w.kind))].sort(), ["5h", "7d"]);
  const api = parsePlans({ anthropic: { billing: "api" } });
  assert.deepEqual(windowsOf(meter(), api), []);
  assert.deepEqual(windowsOf([], {}), []);
});

// ---- the Budget section's spend rows (design §6.2: cash $, explicit currencies, local cost = active time × rate) ----
import { budget } from "../core/analyse/budget.ts";

const plansOf = parsePlans({ anthropic: { billing: "subscription", windows: ["5h", "7d"] }, llama: { billing: "local", rate: { amount: 0.25, currency: "EUR" } }, openrouter: { billing: "api" } });
const spendLines = (): Record<string, unknown>[] => [
  { v: 2, ts: at("10:00"), sessionId: "a", provider: "anthropic", model: "claude-x", kind: "turn", status: 200, billing: "subscription", ...TOK },
  { v: 2, ts: at("10:01"), sessionId: "o", provider: "openrouter", model: "gpt", kind: "turn", status: 200, billing: "api", input: 1, output: 1, costUsd: 0.05 },
  { v: 2, ts: at("10:02"), sessionId: "l", provider: "llama", model: "qwen", kind: "turn", status: 200, billing: "local", input: 5, output: 5, costUsd: 0, durationMs: 3_600_000 },
  { v: 2, ts: at("10:03"), sessionId: "l", provider: "llama", model: "qwen", kind: "turn", status: 200, billing: "local", input: 5, output: 5, costUsd: 0, durationMs: 1_800_000 },
  { v: 2, ts: at("10:04"), sessionId: "l", provider: "llama", model: "qwen", kind: "turn", status: 200, billing: "local", input: 5, output: 5, costUsd: 0 }, // untimed
  { v: 1, ts: at("10:05"), sessionId: "p", provider: "other", model: "m", kind: "turn", status: 200, input: 1, output: 1, costUsd: 0.5 }, // no billing, no plan: api
];

test("budget: spend by billing class — API-eq $ for every class, cash $ only for api; a v2 line's own billing wins, a v1 line takes its provider's plan, else api", () => {
  const b = budget(spendLines(), plansOf);
  const row = (c: string) => b.spend.find((r) => r.billing === c)!;
  assert.deepEqual(b.spend.map((r) => r.billing), ["subscription", "api", "local"]);
  close(row("subscription").apiUsd, 4.6e-3); assert.equal(row("subscription").cashUsd, 0);
  close(row("api").apiUsd, 0.55); close(row("api").cashUsd, 0.55);
  assert.equal(row("local").requests, 3);
  assert.equal(b.plansAbsent, false);
});

test("budget: local cost = the union of the serving intervals × the plan's hourly rate, in the rate's currency, with the requests that had no duration counted apart", () => {
  const [l] = budget(spendLines(), plansOf).local;
  assert.equal(l.provider, "llama");
  assert.deepEqual([l.requests, l.timed, l.untimed], [3, 2, 1]);
  close(l.sumH, 1.5); close(l.unionH, 61 / 60); // the 10:03 request (0.5 h) starts inside the 10:02 one (1 h): 61 min of machine time
  assert.deepEqual(l.rate, { amount: 0.25, currency: "EUR", per: "hour" });
  close(l.cost!, (61 / 60) * 0.25);
  assert.deepEqual(budget(spendLines(), parsePlans({ llama: { billing: "local" } })).local.map((x) => x.cost), [undefined], "a local plan without a rate has no cost, never 0");
});

test("budget: plans absent is said; the fit is per provider and kind; now = the last line", () => {
  const b = budget(meter(), undefined);
  assert.equal(b.plansAbsent, true);
  assert.equal(b.now, at("21:00"));
  assert.deepEqual(b.groups.map((g) => [g.provider, g.kind, g.windows.length, "notEnough" in g.fit]), [["anthropic", "5h", 3, true], ["anthropic", "7d", 1, true]]);
});

test("windowsOf: a window of 150 000 readings neither overflows the stack nor takes long", () => {
  const T = Date.parse("2026-10-05T10:00:00Z");
  const ls = Array.from({ length: 150_000 }, (_, i) => ({ v: 1, ts: new Date(T + i * 100).toISOString(), sessionId: "big", provider: "anthropic", model: "claude-x", kind: "turn", status: 200, ...TOK, q5h: 10 + (i % 7), q5hReset: "2026-10-05T15:00:00.000Z" }));
  const t = Date.now();
  const [w] = windowsOf(ls, {});
  assert.equal(w.peak, 16);
  assert.equal(w.requests, 150_000);
  assert.ok(Date.now() - t < 5000, `${Date.now() - t} ms`);
});

// ---- review M1: linear time; MINOR: a 429 and a retry belong to the limit that was capped ----

test("windowsOf is linear: a 429 storm before the 99 reading of a long window (ISO resets) scales with the input, not its square", () => {
  const build = (n: number) => {
    const T = Date.parse("2026-10-05T10:00:00Z"), ls: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      const rate = i % 2 === 0 && i < n - 10; // half the window is a 429 storm; the reading of 99 comes last
      ls.push(rate ? { v: 2, ts: new Date(T + i * 100).toISOString(), sessionId: "big", provider: "anthropic", model: "claude-x", kind: "turn", status: "error", errorClass: "429", errorKind: "rate_limit", retries: 0, retryWaitMs: 0 }
        : { v: 1, ts: new Date(T + i * 100).toISOString(), sessionId: "big", provider: "anthropic", model: "claude-x", kind: "turn", status: 200, ...TOK, q5h: i < n - 10 ? 10 : 99, q5hReset: "2026-10-05T15:00:00.000Z", q7d: i < n - 10 ? 10 : 99, q7dReset: "2026-10-11T00:00:00.000Z" });
    }
    return ls;
  };
  const time = (n: number) => { const ls = build(n); let best = Infinity; for (let k = 0; k < 3; k++) { const t = process.hrtime.bigint(); windowsOf(ls, {}); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6); } return best; };
  const [small, large] = [time(10_000), time(40_000)];
  assert.ok(large < 8 * small + 20, `4× the lines took ${(large / small).toFixed(1)}× the time (${small.toFixed(0)} → ${large.toFixed(0)} ms): not linear`);
  const ws = windowsOf(build(1000), {});
  assert.equal(ws.length, 2);
  assert.ok(ws.every((w) => w.peak === 99) && ws.find((w) => w.kind === "5h")!.r429 > 0, "before any 99 reading the 429s are short-limit ones: 5h");
});

/** Lines of one provider with readings (q5h, q7d) and 429 error lines between them. */
const reading = (hm: string, q5h: number, q7d: number, extra: Record<string, unknown> = {}) => line(hm, { q5h, q5hReset: R2, q7d, q7dReset: D7, ...extra });
const err429 = (hm: string, extra: Record<string, unknown> = {}) => ({ v: 2, ts: at(hm), sessionId: "s1", provider: "anthropic", model: "claude-x", kind: "turn", status: "error", errorClass: "429", errorKind: "rate_limit", retries: 0, retryWaitMs: 0, ...extra });
const kindsOf = (ls: Record<string, unknown>[]) => { const ws = windowsOf(ls, {}); return { five: ws.find((w) => w.kind === "5h")!, seven: ws.find((w) => w.kind === "7d")! }; };

test("a 429 after a 7d reading of 99 (5h far below) is a 7d rate limit: it counts in the 7d window and caps it, not the 5h one", () => {
  const { five, seven } = kindsOf([reading("16:00", 20, 99), err429("16:30", { retries: 2, retryWaitMs: 5000 })]);
  assert.equal(seven.r429, 1);
  assert.equal(five.r429, 0);
  assert.equal(seven.timeToCapMs, Date.parse(at("16:30")) - Date.parse(seven.start));
  assert.equal(five.timeToCapMs, undefined);
  assert.equal(five.lockoutMs, 0);
  assert.deepEqual([seven.retries, seven.retryWaitMs, five.retryWaitMs], [2, 5000, 0]);
});

test("a 429 after readings of 99 on both limits counts in both windows; a 429 with no reading at 99 (or only an expired one) is a short-limit one: 5h only, no cap", () => {
  const both = kindsOf([reading("16:00", 99, 99), err429("16:30")]);
  assert.deepEqual([both.five.r429, both.seven.r429], [1, 1]);
  const none = kindsOf([reading("16:00", 50, 60), err429("16:30")]);
  assert.deepEqual([none.five.r429, none.seven.r429], [1, 0]);
  assert.equal(none.five.timeToCapMs, undefined, "no reading near the cap: a transient 429 is no cap");
  // a reading of 99 of the window that reset at 16:10 does not make the 429 at 17:00 (before the next window's first reading) a cap
  const old = windowsOf([reading("16:00", 99, 40, { q5hReset: at("16:10") }), err429("17:00"), reading("18:00", 10, 40)], {}).filter((w) => w.kind === "5h");
  assert.deepEqual(old.map((w) => [w.reset, w.r429, w.timeToCapMs === undefined]), [[at("16:10"), 0, true], [R2, 1, true]], "the 99 belonged to a window that had reset by the error");
});

// ---- review M3: the cash $ of a guessed billing class is an upper bound ----

test("budget: plans absent means no usable entry ({} too); an api row whose class was guessed (no own billing, no plan) is marked, one that was told is not", () => {
  const guessedLines = spendLines().filter((l) => l.provider === "other");
  for (const plans of [undefined, {}, parsePlans({ x: { windows: [] } })]) {
    const b = budget(guessedLines, plans);
    assert.equal(b.plansAbsent, true);
    assert.deepEqual(b.spend.map((r) => [r.billing, r.guessed]), [["api", true]]);
  }
  const told = budget(guessedLines, parsePlans({ other: { billing: "api" } }));
  assert.equal(told.plansAbsent, false);
  assert.equal(told.spend[0].guessed, false, "the provider has a plan");
  assert.equal(budget(spendLines().filter((l) => l.provider === "openrouter"), {}).spend[0].guessed, false, "a v2 line names its own billing");
  assert.equal(budget(spendLines().filter((l) => l.provider === "anthropic"), {}).spend[0].guessed, false);
});

test("a stale lower reading of a parallel session does not undo a capped limit (the window's quota is monotone: its running maximum counts)", () => {
  const { five, seven } = kindsOf([reading("16:00", 20, 99), reading("16:10", 20, 97), err429("16:30")]);
  assert.deepEqual([seven.r429, five.r429], [1, 0]);
  assert.equal(seven.timeToCapMs, Date.parse(at("16:30")) - Date.parse(seven.start));
});

// M8 T8.3/T8.6/T8.8: the Budget's local rows come from core/analyse/local.ts; costs are per currency, summed only with a configured conversion
test("M8 budget: a local row carries the union of the serving intervals, the queue share, per-model rows and prefix reuse; cost = unionH × rate", () => {
  const T = Date.parse("2026-11-02T10:00:00Z"), at = (m: number) => new Date(T + m * 60_000).toISOString();
  const ll = (m: number, minutes: number, model: string, extra = {}) => ({ v: 2, ts: at(m), sessionId: "s", provider: "llama", model, kind: "turn", billing: "local", status: 200, input: 10, output: 100, costUsd: 0, durationMs: minutes * 60_000, ...extra });
  const [l] = budget([ll(0, 30, "q5"), ll(15, 30, "q5"), ll(120, 30, "q4", { cacheN: 50, promptN: 50 })], parsePlans({ llama: { billing: "local", windows: [], rate: { amount: 2, currency: "EUR", per: "hour" } } })).local;
  close(l.sumH, 1.5); close(l.unionH, 1.25); close(l.queueShare, 1 / 6);
  assert.deepEqual(l.models.map((m) => m.model), ["q4", "q5"]);
  assert.deepEqual(l.prefix, { share: 0.5, basis: "timings", requests: 1 });
  close(l.cost!, 1.25 * 2);
});

test("M8 budget: costs per currency (API-eq cash $ of the api class in USD, local cost in the rate's currency); a total only when every currency converts with `currency.rates`", () => {
  const plans = parsePlans({ llama: { billing: "local", windows: [], rate: { amount: 2, currency: "EUR", per: "hour" } } });
  const none = budget(spendLines(), plansOf);
  assert.deepEqual(none.costs.map((c) => [c.currency, c.amount, c.converted]), [["EUR", (61 / 60) * 0.25, undefined], ["USD", 0.55, 0.55]]);
  assert.equal(none.total, undefined, "pi-economics: no total without a rate between EUR and USD");
  const some = budget(spendLines(), plansOf, { "USD/EUR": 0.5 });
  assert.equal(some.total?.currency, "USD");
  close(some.total!.amount, 0.55 + ((61 / 60) * 0.25) / 0.5);
  assert.deepEqual(budget(spendLines().filter((l) => l.provider !== "llama"), plans, {}).costs.map((c) => c.currency), ["USD"], "one currency: nothing to convert, its own total");
  assert.deepEqual(budget(spendLines(), plansOf, { "EUR/GBP": 1 }).total, undefined);
});

test("review M8 #1: a rated local provider whose requests are all untimed adds no currency row and no total (never a 0 EUR)", () => {
  const untimed = spendLines().filter((l) => l.provider === "llama").map((l) => ({ ...l, durationMs: undefined }));
  const b = budget(untimed, plansOf);
  assert.deepEqual(b.costs, [], "pi-economics: no EUR row from zero timed requests");
  assert.equal(b.total, undefined);
  assert.equal(b.local[0].cost, undefined);
});

test("review M8 #5: a single currency needs no conversion: its own total (a local-only user without USD/EUR still gets an EUR total)", () => {
  const b = budget(spendLines().filter((l) => l.provider === "llama"), plansOf);
  assert.deepEqual(b.costs.map((c) => c.currency), ["EUR"]);
  assert.equal(b.total?.currency, "EUR"); close(b.total!.amount, (61 / 60) * 0.25);
  assert.equal(budget(spendLines(), plansOf).total, undefined, "two currencies without a rate stay apart");
});

test("review M8 #5: the total is marked when its USD part is cash $ of requests whose billing class was guessed (an upper bound)", () => {
  const guessed = budget([{ v: 1, ts: at("10:05"), sessionId: "p", provider: "other", model: "m", kind: "turn", status: 200, input: 1, output: 1, costUsd: 0.5 }], undefined);
  assert.equal(guessed.total?.guessed, true);
  assert.equal(budget(spendLines().filter((l) => l.provider === "openrouter"), plansOf).total?.guessed, false);
});

import { fitsOf } from "../core/analyse/index.ts";
test("review M8 #10: fitsOf keys the Budget's calibrations by provider and window kind (what the experiment table's points objectives and meter-report --arms read)", () => {
  const f = fitsOf(meter(), parsePlans({ anthropic: { billing: "subscription", windows: ["5h", "7d"] } }));
  assert.deepEqual([...f.keys()].sort(), ["anthropic\u00005h", "anthropic\u00007d"]);
  assert.ok("notEnough" in f.get("anthropic\u00005h")!, "three complete windows: not enough");
});
