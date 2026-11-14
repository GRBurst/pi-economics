// Local serving (design §9.3): the cost of a local provider (its machine-busy time, the union of the serving intervals, × its hourly rate),
// the request time (Σ durations: what the experiments attribute), the queue share (one server slot: overlapping requests queue), per-model rows (throughput, cost per 1M output tokens: one
// rate per provider, its models run on one machine), prefix reuse, and currency conversion. Pure.
import { billingOfLine, type Plans, type Rate } from "../plans.ts";
import { isError, isLine } from "./logs.ts";

const MS_H = 3_600_000;
const dur = (l: any): number | undefined => (typeof l.durationMs === "number" && Number.isFinite(l.durationMs) && l.durationMs >= 0 ? l.durationMs : undefined);
const nonNeg = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const tokens = (v: unknown): number => nonNeg(v) ?? 0;

/** Per model of a local provider (the q5 and q4 llama profiles are two model ids of one provider). */
export type ModelRow = { model: string; requests: number; /** Σ durationMs of the model's timed requests, in hours. */ sumH: number; /** Output tokens of the requests the throughput covers. */ output: number;
  /** Output tokens per second over `basis`: the generation time `genMs` of the lines that carry it (llama.cpp timings), else the request time `durationMs`; absent without time or output. */
  tokPerS?: number; basis?: "genMs" | "durationMs";
  /** The provider's rate × the model's hours ÷ output tokens × 1e6, in the rate's currency; absent without a rate or output: never 0. */ costPerMOut?: number };
/** Share of the prompt served from the server's cache: Σ cacheN ÷ Σ (cacheN + promptN) when lines carry llama.cpp timings, else Σ cacheRead ÷ Σ (input + cacheRead). */
export type Prefix = { share: number; basis: "timings" | "usage"; requests: number };
export type LocalProvider = { provider: string; /** Successful requests. */ requests: number; /** Requests with / without `durationMs` (the untimed ones add no time). */ timed: number; untimed: number;
  /** Σ of the timed requests' durations, in hours: concurrent requests add up (what an experiment's unit is charged). */ sumH: number;
  /** Failed requests (error lines): they occupy the machine, so their time is in sumH and unionH, but they are no request. */ failed: number;
  /** Measure of the union of the requests' intervals [ts − durationMs, ts], in hours: the machine's serving time. */ unionH: number;
  /** 1 − unionH / sumH (0 when sumH is 0): with one server slot, above 0 means local requests overlapped and queued. */ queueShare: number;
  rate?: Rate; /** unionH × rate.amount in rate.currency (the machine's busy time: overlapping requests queue on one slot); absent without a rate or without a timed request: never 0. */ cost?: number; models: ModelRow[]; prefix?: Prefix };

/** The measure of the union of the intervals, in ms. */
function unionMs(iv: Array<[number, number]>): number {
  let total = 0, end = -Infinity;
  for (const [a, b] of [...iv].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

function modelRow(model: string, ls: any[], rate: Rate | undefined): ModelRow {
  const ok = ls.filter((l) => !isError(l)).length;
  const timed = ls.filter((l) => dur(l) !== undefined), gen = ls.filter((l) => nonNeg(l.genMs) !== undefined);
  const sumH = timed.reduce((s, l) => s + dur(l)! / MS_H, 0), all = timed.reduce((s, l) => s + tokens(l.output), 0);
  const basis = gen.length ? "genMs" : timed.length ? "durationMs" : undefined;
  const base = basis === "genMs" ? gen : timed;
  const output = base.reduce((s, l) => s + tokens(l.output), 0);
  const ms = base.reduce((s, l) => s + (basis === "genMs" ? l.genMs : dur(l)!), 0);
  return { model, requests: ok, sumH, output, ...(basis && ms > 0 && output > 0 ? { tokPerS: output / (ms / 1000), basis } : {}),
    ...(rate && all > 0 && sumH > 0 ? { costPerMOut: ((sumH * rate.amount) / all) * 1e6 } : {}) };
}

function prefixOf(ls: any[]): Prefix | undefined {
  const t = ls.filter((l) => nonNeg(l.cacheN) !== undefined && nonNeg(l.promptN) !== undefined);
  if (t.length) {
    const hit = t.reduce((s, l) => s + l.cacheN, 0), all = t.reduce((s, l) => s + l.cacheN + l.promptN, 0);
    return all > 0 ? { share: hit / all, basis: "timings", requests: t.length } : undefined;
  }
  const read = ls.reduce((s, l) => s + tokens(l.cacheRead), 0), all = ls.reduce((s, l) => s + tokens(l.input) + tokens(l.cacheRead), 0);
  return all > 0 && read > 0 ? { share: read / all, basis: "usage", requests: ls.length } : undefined;
}

/**
 * One row per local provider (a request line of billing class local: its own `billing`, else its provider's plan), in order of first appearance. A
 * warming request is none; a failed one is not a request but occupies the machine (its time counts); one without `durationMs` is counted untimed and adds no time.
 */
export function localRows(lines: readonly any[], plans: Plans): LocalProvider[] {
  const by = new Map<string, any[]>();
  for (const l of lines) {
    if (!isLine(l) || typeof l.provider !== "string" || l.kind === "warming" || billingOfLine(l, plans) !== "local") continue;
    const xs = by.get(l.provider); if (xs) xs.push(l); else by.set(l.provider, [l]);
  }
  return [...by].map(([provider, ls]) => {
    const rate = Object.hasOwn(plans, provider) ? plans[provider].rate : undefined;
    const timed = ls.filter((l) => dur(l) !== undefined);
    const sumH = timed.reduce((s, l) => s + dur(l)! / MS_H, 0);
    const unionH = unionMs(timed.map((l): [number, number] => { const end = Date.parse(l.ts); return [end - dur(l)!, end]; })) / MS_H;
    const models = [...new Set(ls.map((l) => String(l.model)))].sort().map((m) => modelRow(m, ls.filter((l) => String(l.model) === m), rate));
    const prefix = prefixOf(ls.filter((l) => !isError(l)));
    const failed = ls.filter(isError).length;
    return { provider, requests: ls.length - failed, failed, timed: timed.length, untimed: ls.length - timed.length, sumH, unionH, queueShare: sumH > 0 ? Math.max(0, 1 - unionH / sumH) : 0,
      ...(rate ? { rate, ...(timed.length ? { cost: unionH * rate.amount } : {}) } : {}), models, ...(prefix ? { prefix } : {}) };
  });
}

/** The local cost per provider: the union of the serving intervals / 3.6e6 × the plan's rate (sumH, unionH, cost), or not measurable (no rate, or no request with a `durationMs`) with the Σ request time. */
export function localCost(lines: readonly any[], plans: Plans): Record<string, { currency: string; rate: number; sumH: number; unionH: number; cost: number } | { notMeasurable: "no rate" | "no timed requests"; wallH: number }> {
  return Object.fromEntries(localRows(lines, plans).map((r) => [r.provider, r.rate && r.cost !== undefined
    ? { currency: r.rate.currency, rate: r.rate.amount, sumH: r.sumH, unionH: r.unionH, cost: r.cost }
    : { notMeasurable: (r.rate ? "no timed requests" : "no rate") as "no rate" | "no timed requests", wallH: r.sumH }]));
}

/**
 * `amount` of `from` in `to`: `rates["FROM/TO"]` (1 FROM = rate TO), else the inverse of `rates["TO/FROM"]`, else undefined (never chained
 * through a third currency; the report then keeps separate columns). A rate must be positive.
 */
export function convert(amount: number, from: string, to: string, rates: Readonly<Record<string, number>>): number | undefined {
  if (from === to) return amount;
  const direct = Object.hasOwn(rates, `${from}/${to}`) ? rates[`${from}/${to}`] : undefined, back = Object.hasOwn(rates, `${to}/${from}`) ? rates[`${to}/${from}`] : undefined;
  if (typeof direct === "number" && direct > 0) return amount * direct;
  if (typeof back === "number" && back > 0) return amount / back;
  return undefined;
}
