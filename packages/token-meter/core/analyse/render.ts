// The markdown of the report, one render function per section.
import { MIN_HOURS } from "../arms.ts";
import { type LedgerSection } from "../ledger.ts";
import { type CI } from "../stats.ts";
import { sum } from "./logs.ts";
import { type CostSection } from "./cost.ts";
import { type CacheSection } from "./cache.ts";
import { REFUSAL_LIMIT, type DesignResult, type StratumResult } from "./experiment.ts";
import { MIN_CI_N, type CostPerAccepted, type DelegationSection, type Randomized, type Row, type RouterFactor, type SpotChecks } from "./delegation.ts";
import { type GuardsSection } from "./guards.ts";
import { type QualitySection } from "./quality.ts";
import { type LeversSection } from "./levers.ts";
import { type Analysis } from "./index.ts";
import { type BudgetSection, type Window } from "./budget.ts";
import { betaOf, estPoints, MATERIAL, type Beta } from "./calibration.ts";

const f2 = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : "–");
const pc = (n: number): string => (Number.isFinite(n) ? `${Math.round(100 * n)}%` : "–");
const ci = (c: { lo: number; hi: number }) => (Number.isFinite(c.lo) ? `${f2(c.lo)} – ${f2(c.hi)}` : "–");
const table = (head: string[], rows: string[][]): string =>
  [`| ${head.join(" | ")} |`, "|" + " --- |".repeat(head.length), ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const NO_DATA = "_no data in the period_";
/** $/accepted: one number, or excl. – incl. unresolved cards' $ (lower – upper) when unresolved cards leave the cost uncertain (B15). */
const bounds = (c: CostPerAccepted): string => (!Number.isFinite(c.upper) ? "–" : c.lower === c.upper ? f2(c.upper) : `${f2(c.lower)} – ${f2(c.upper)}`);
/** A cash $ cell: an upper bound, said in the cell, when the billing class of some of its lines was guessed. */
const cash = (usd: number, guessed: boolean): string => (guessed ? `≤ ${f2(usd)} (billing class guessed: no plan)` : f2(usd));
/** A span: minutes under an hour, else hours. */
const hours = (ms: number): string => (!Number.isFinite(ms) ? "–" : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const median = (xs: number[]): number => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
/** est. points of a premium split in write and read $, or "–" when no calibration is available. */
const pts = (parts: { write: number; read: number }, beta?: Beta): string => (beta ? f2(estPoints(parts, beta)) : "–");

/**
 * The Budget section (design §6.1, §9.2): the quota windows of subscription providers with their calibration, the spend by billing class and the
 * local cost. Quota is the budget, not the comparison metric of experiments (API-eq $ for cloud, local cost for local).
 */
export function renderBudget(b: BudgetSection): string {
  const out: string[] = [
    "The quota is the budget, not an experiment's comparison metric: it arrives in whole percent (about 460–560 requests per 1% step in 2026-11) and is shared by every session, subagent and other client of the account, so no session or arm is charged quota points. A window is one provider's `q5h` or `q7d` reset period; its peak is the highest reading, its lockout the time from the cap (a reading of 100, or a rate-limit error after a reading of 99) to the reset, its time to cap the time from the window's start to the cap. Complete = the window is over and the log reaches back to its start. Retry wait is the sum of the `retryWaitMs` of the window's lines (pi-retry's totals on v1 lines, pi's native retries on v2 lines), whatever failed.",
    ...(b.plansAbsent ? ["\nplans absent (token-meter's `plans` setting is missing or has no usable entry): windows come from the lines' own readings, and a v1 line's billing class is guessed (api for a provider without a plan), so cash $ is an upper bound."] : []),
    "\n### Quota windows\n",
  ];
  if (!b.groups.length) out.push("_no quota readings (`q5h`/`q7d`) in the period_");
  else {
    out.push(table(["provider", "window", "windows (complete)", "peak median / max", "capped", "lockout", "time to cap (median)", "429 requests", "retry wait"], b.groups.map((g) => {
      const ws = g.windows, capped = ws.filter((w) => w.timeToCapMs !== undefined), waits = ws.filter((w) => w.retryWaitMs !== undefined);
      return [g.provider, g.kind, `${ws.length} (${ws.filter((w) => w.complete).length})`, `${f2(median(ws.map((w) => w.peak)))} / ${ws.reduce((m, w) => Math.max(m, w.peak), 0)}`, String(capped.length), hours(ws.reduce((s, w) => s + w.lockoutMs, 0)),
        capped.length ? hours(median(capped.map((w) => w.timeToCapMs!))) : "–", String(ws.reduce((s, w) => s + w.r429, 0)), waits.length ? hours(waits.reduce((s, w) => s + w.retryWaitMs!, 0)) : "not observable"];
    })));
    const capped = b.groups.flatMap((g) => g.windows.filter((w) => w.timeToCapMs !== undefined)).sort((x, y) => Date.parse(y.reset) - Date.parse(x.reset)).slice(0, 10);
    if (capped.length) out.push("\nWindows that hit the cap (latest 10):\n", table(["provider", "window", "reset", "peak", "time to cap", "lockout", "429 requests", "retry wait"], capped.map((w: Window) =>
      [w.provider, w.kind, w.reset, String(w.peak), hours(w.timeToCapMs!), hours(w.lockoutMs), String(w.r429), w.retryWaitMs === undefined ? "not observable" : hours(w.retryWaitMs)])));
  }
  out.push("\n### Quota calibration\n", "Per complete window, peak quota ≈ Σ β_c × API-eq $ of component c (a non-negative least-squares fit; no intercept: a window starts at 0). β = quota points per API-eq $ of the component: 1 would mean the quota weighs a token as its list price does. A flag says the quota now weighs tokens differently from the API prices — the signal to revisit the objective, never an automatic change.");
  for (const g of b.groups) {
    out.push(`\n#### ${g.provider} ${g.kind}\n`);
    const f = g.fit;
    if ("notEnough" in f) { out.push(`not enough complete windows to fit: ${f.n} of 8 needed`); continue; }
    out.push(table(["component", "β (points per API-eq $)", "share of the windows' $"], (Object.keys(f.beta) as Array<keyof typeof f.beta>).map((c) => [c, f.share[c] >= MATERIAL ? f2(f.beta[c]) : `not identifiable (${f.beta[c] > 0 ? "fit " + f2(f.beta[c]) + ", " : ""}under ${pc(MATERIAL)} of the $)`, pc(f.share[c])])));
    const per = f.usdPerPoint.map((x) => x.value).filter(Number.isFinite);
    out.push(`\n${f.n} complete windows; R² ${f2(f.r2)}; σ ${f2(f.sigma)} points; API-eq $ per point: median ${f2(median(per))} (${f2(Math.min(...per))} – ${f2(Math.max(...per))}).\n`);
    out.push(f.flags.length ? f.flags.map((x) => `- ${x.kind}${x.component ? ` ${x.component}` : ""}${x.window ? ` (${x.window})` : ""}: ${x.detail}`).join("\n") : "- no divergence flag");
  }
  out.push("\n### Spend by billing class\n", "API-eq $ = the tokens at the provider's list price (what a pay-per-token account would be charged); cash $ = what is actually charged: the API-eq $ of billing class api, 0 for subscription, free and local.\n",
    b.spend.length ? table(["billing class", "requests", "API-eq $", "cash $"], b.spend.map((r) => [r.billing, String(r.requests), f2(r.apiUsd), cash(r.cashUsd, r.guessed)])) : "_no requests in the period_");
  out.push("\n### Local cost\n");
  out.push(b.local.length ? "Σ request time (`durationMs`, summed over requests: concurrent requests add up) × the provider's hourly rate in its currency. A request without `durationMs` adds no time: untimed requests make the cost an undercount. A provider without a rate has no cost.\n" : "_no local requests in the period_");
  if (b.local.length) out.push(table(["provider", "requests (timed / untimed)", "active hours", "rate", "cost"], b.local.map((l) => [l.provider, `${l.requests} (${l.timed} / ${l.untimed})`, f2(l.hours), l.rate ? `${l.rate.amount} ${l.rate.currency}/h` : "no rate", l.cost === undefined ? "–" : `${f2(l.cost)} ${l.rate!.currency}`])));
  return out.join("\n");
}

export function renderCost(c: CostSection): string {
  if (!c.requests && !c.warming) return NO_DATA;
  return [
    table(["metric", "value"], [
      ["total API-eq $", f2(c.totalUsd)], ["cash $", cash(c.cashUsd, c.cashGuessed)], ["requests (warming)", `${c.requests} (${c.warming})`], ["errors", String(c.errors)], ["root sessions", String(c.units)], ["active hours", f2(c.activeHours)],
      ["API-eq $/active hour (95% CI)", `${f2(c.usdPerHour.mean)} (${ci(c.usdPerHour)})`],
      ["API-eq $/accepted task, all routed tasks, excl. – incl. unresolved cards' $ (accepted/tasks)", `${bounds(c.perAccepted)} (${c.perAccepted.accepted}/${c.perAccepted.tasks})`],
    ]),
    "\n### By model\n", table(["model", "requests", "API-eq $", "share", "API-eq $/active h"], c.byModel.map((m) => [m.model, String(m.requests), f2(m.usd), pc(m.share), f2(m.perHour)])),
    "\n### Splits\n\nWarming = the cache-warming requests (kind warming). Folds and cold resumes are in the Cache section; list-price $ is API-eq $, money actually charged is cash $ (Budget).\n",
    table(["split", "n", "API-eq $", "share", "API-eq $/active h"], c.splits.map((s) => [s.name, String(s.n), f2(s.usd), pc(s.share), f2(s.perHour)])),
    "\n### Token components (≈, by each model's price ratios)\n", table(["component", "API-eq $"], Object.entries(c.components).map(([k, v]) => [k, f2(v)])),
  ].join("\n");
}

/** `beta` = a fit's points per API-eq $ (Budget): it prices the premiums in the est. points columns; without one they are "–". */
export function renderCache(c: CacheSection, beta?: Beta): string {
  if (!c.requests) return "\n### Cache\n\n_no Claude requests in the period_";
  return [
    "\n### Cache (Claude models)\n",
    "Per session branch (warming requests refresh the cache but are no row): a request's cache write is **new context** (growth: the context added since the previous request, written once whatever happens) plus a **rewrite**, the **miss**: tokens of the prefix the previous request left in the cache (cacheRead + cacheWrite) that this one did not read. Only a miss is avoidable. Cause of a miss, the first that holds: ttl (the gap outlived the TTL in force; a gap runs from the latest send before the request to its send, ts − durationMs: a long response does not age the prefix it read; TTL: 5 min, 1 h for a main session in a mainCacheTtl 1h arm or after a 1 h write), fold (the prompt fell below 80% of the previous request's), model (the model changed), prefix (the system prompt, a prompt section or the tool list changed: the line's systemHash differs from the last one before it in the branch), other (a change of the prefix inside the TTL that the meter lines do not show: a small fold or mask, an injected agent message, a system change on lines without a systemHash; it is a real cost, not a bookkeeping residue, but its reason is not in the log). $ = API-eq at each line's input price p: a write is 1.25 p (2.0 p for a 1 h write), a read the model's read ratio × p (0.1 by default, 0.05 for Opus 5.5 and Sonnet 5.5); a miss costs the premium of writing over reading. est. points = the calibrated quota weights (Budget) applied to the two prices a premium is the difference of: β(cacheWrite) × the $ of writing the missed tokens − β(cacheRead) × the $ of reading them; a dash without a calibration (it needs 8 complete 5-hour windows).\n",
    table(["metric", "value"], [
      ["requests (branches)", `${c.requests} (${c.branches})`], ["new context", `${c.newContext.tokens} tokens, ${f2(c.newContext.usd)} $`],
      ["missed prefix", `${c.misses.reduce((s, m) => s + m.tokens, 0)} tokens, ${f2(c.misses.reduce((s, m) => s + m.usd, 0))} $ premium`], ["miss share (missed ÷ cache-write tokens)", pc(c.missShare)],
    ]),
    "\nMisses by cause:\n", table(["cause", "requests", "missed tokens", "premium API-eq $", "est. points"], c.misses.map((m) => [m.cause, String(m.n), String(m.tokens), f2(m.usd), pts(m.parts, beta)])),
    "\nFolds and cold resumes (a cold resume = a request after a gap (as for ttl) beyond the TTL in force; a fold as in the cause table, unless the gap came first). Window = the event's request and the next two turn requests (cut short by the next event): premium = their misses × (write − read price). Baseline = what an ordinary request costs the same way (the mean premium of the requests outside every window, in the sessions that have such an event) once per event; net = premium − baseline.\n",
    table(["event", "n", "premium API-eq $", "baseline API-eq $", "net API-eq $", "net est. points"], ([["after folds", c.events.fold], ["after cold resumes", c.events.coldResume]] as const).map(([name, e]) => [name, String(e.events), f2(e.premiumUsd), f2(e.baselineUsd), f2(e.netUsd), beta ? f2(estPoints(e.premiumParts, beta) - estPoints(e.baselineParts, beta)) : "–"])),
  ].join("\n");
}

const f4 = (n: number): string => (Number.isFinite(n) ? n.toFixed(4) : "–");

export function renderFolds(f: LedgerSection, beta?: Beta): string {
  if (!f.n) return "\n### Fold ledger\n\n_no folds in Claude sessions in the period_";
  const net = (r: Pick<LedgerSection, "savingsUsd" | "rewriteParts">): string => (beta ? f2(beta.cacheRead * r.savingsUsd - estPoints(r.rewriteParts, beta)) : "–");
  const rows = (rs: LedgerSection["byDepth"]) => rs.map((r) => [r.name, String(r.n), f4(r.savingsUsd), f4(r.rewriteUsd), f4(r.netUsd), net(r), pc(r.negativeShare)]);
  const head = (first: string) => [first, "folds", "cache-read API-eq $ saved", "rewrite API-eq $ paid", "net API-eq $", "net est. points", "share net < 0"];
  return [
    "\n### Fold ledger (Claude models)\n",
    "Per detected fold (a non-warming request whose prompt, input + cacheRead + cacheWrite, fell below 80% of the previous one's): R = tokens removed; K ≈ the first request's cacheWrite minus the session's typical write (median of its non-first, non-fold, non-cold turns), 0 for a fold after a cold gap; n = requests after the fold until the session ends or the next cold gap (≥ 5 min, ≥ 60 min in a mainCacheTtl 1h arm; warming counts); r and w = the model's cache read and write price per token: the model's read ratio (0.1 by default, 0.05 for Opus 5.5 and Sonnet 5.5) × the input price recovered from the lines' cost for a read, 1.25 × for a 5-minute write and 2.0 × for a 1 h write (a write is a 1 h one in a mainCacheTtl 1h arm's main session, or by the line's own cacheWrite1h). **Net = n·R·r − K·(w − r)** = cache-read $ saved − rewrite $ paid. Counterfactual only: it assumes the fold changed nothing else (output, later tool use, task path) and that an unfolded prompt would have kept being read at r; folds overlap in time but each is valued alone.\n",
    table(["metric", "value"], [["folds (after a cold gap)", `${f.n} (${f.cold})`], ["cache-read API-eq $ saved", f4(f.savingsUsd)], ["rewrite API-eq $ paid", f4(f.rewriteUsd)], ["net API-eq $", f4(f.netUsd)], ["net est. points (β(cacheRead) × saved − the rewrite priced as in Cache)", net(f)], ["share with net < 0", `${pc(f.negativeShare)} (${f.negative}/${f.n})`]]),
    "\nBy fold depth K/R (rewritten tokens per token removed; break-even ≈ n/11.5):\n", table(head("K/R"), rows(f.byDepth)),
    "\nBy design and foldHint level (v2 and v3 differ in what cache-aware means: never pooled):\n", table(head("group"), rows(f.byGroup)),
    "\nBy model:\n", table(head("model"), rows(f.byModel)),
  ].join("\n");
}

const pp = (n: number): string => (Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${(100 * n).toFixed(0)}%` : "–");

const effectRows = (es: StratumResult["effects"]): string[][] => es.map((e) => "notMeasurable" in e
  ? [e.factor, "–", "–", "–", "–", "–", e.notMeasurable, "–"]
  : [e.factor, `${e.a} → ${e.b}`, String(e.nA), String(e.nB), f2(e.ratioA), f2(e.ratioB), pp(e.effect), Number.isFinite(e.ci[0]) ? `${pp(e.ci[0])} – ${pp(e.ci[1])}` : "–"]);
const EFFECT_HEAD = ["factor", "low → high", "n low", "n high", "ratio low", "ratio high", "effect", "95% CI"];

/** The v2 engine's extras of a stratum (M5c, §7.5): refusal rates, overflows, per-protocol and the model-switch sensitivity row. Nothing for a v1-engine stratum. */
function renderV2(s: StratumResult): string {
  if (!s.refusal && !s.perProtocol && !s.overflow && !s.sensitivity) return "";
  return [
    ...(s.refusal ? ["\nRefusal rate per factor (units whose lever was refused by its owner ÷ the units with a levers line that assigned it; above " + (REFUSAL_LIMIT * 100).toFixed(0) + "% the add-on is flagged in the last column):\n",
      table(["factor", "lever", "eligible (with levers line)", "refused", "rate", "flag", "without a levers line"], s.refusal.map((r) => [r.factor, `\`${r.lever}\``, String(r.eligible), String(r.refused), pc(r.rate), r.broken ? "broken add-on" : "ok", `${r.noLevers} without a levers line`]))] : []),
    ...(s.perProtocol ? [`\nPer-protocol (non-randomized comparison): the ${s.perProtocol.units} units whose every factor lever was read back \`confirmed\` (${s.perProtocol.excluded} unverified or refused units left out). Units that kept the assignment are not a random sample of the assigned ones: this row can be confounded and is no causal estimate; the intention-to-treat table is.\n`,
      table(EFFECT_HEAD, effectRows(s.perProtocol.effects))] : []),
    ...(s.sensitivity ? [`\nSensitivity (model switch): the objective over the requests billed as the unit's start class only (billing of its main's first request); ${s.sensitivity.switched} unit(s) used another billing class in a request. Same units and hours as the intention-to-treat table.\n`,
      table(EFFECT_HEAD, effectRows(s.sensitivity.effects))] : []),
    ...(s.overflow ? ["\nContext overflows (`errorKind = context_overflow`) per active hour and arm:\n",
      table(["arm", "units", "active h", "overflows", "per active h"], s.overflow.map((o) => [`\`${o.arm}\``, String(o.units), f2(o.hours), String(o.overflows), f2(o.perHour)]))] : []),
  ].join("\n");
}

function renderStratum(s: StratumResult): string {
  const measurable = s.effects.flatMap((e) => ("notMeasurable" in e ? [] : [e]));
  const mdes = measurable.filter((e) => Number.isFinite(e.mde) && e.mde > 0);
  const flat = measurable.some((e) => e.mde === 0);
  const dropped = measurable.filter((e) => e.dropped > 0);
  const timed = s.objective === "wallMs" || s.objective === "localCost";
  const lo = mdes.reduce((m, e) => (e.mde < m.mde ? e : m), mdes[0]), hi = mdes.reduce((m, e) => (e.mde > m.mde ? e : m), mdes[0]);
  const reasons = [...new Set(s.effects.flatMap((e) => ("notMeasurable" in e ? [e.notMeasurable] : [])))];
  return [
    `#### stratum ${s.stratum} (objective ${s.objective} per active hour)\n`,
    ...(s.perProtocol ? ["Intention-to-treat (primary): every unit, by its assignment.\n"] : []),
    table(["factor", "low → high", "n low", "n high", "ratio low", "ratio high", "effect", "95% CI", "MDE"], s.effects.map((e) => "notMeasurable" in e
      ? [e.factor, "–", "–", "–", "–", "–", e.notMeasurable, "–", "–"]
      : [e.factor, `${e.a} → ${e.b}`, String(e.nA), String(e.nB), f2(e.ratioA), f2(e.ratioB), pp(e.effect), Number.isFinite(e.ci[0]) ? `${pp(e.ci[0])} – ${pp(e.ci[1])}` : "–", e.mde === 0 ? "n/a (zero variance)" : Number.isFinite(e.mde) ? `±${pp(e.mde).replace("+", "")}` : "–"])),
    "\nBalance (units with ≥ " + MIN_HOURS + " active h; shorter ones are excluded from the estimate and counted here):\n",
    table(["arm", "units", "active h", "excluded (< " + MIN_HOURS + " h)", "no objective", ...(timed ? ["request lines timed / untimed"] : [])], s.balance.map((b) => [`\`${b.arm}\``, String(b.units), f2(b.hours), String(b.excluded), String(b.unmeasured), ...(timed ? [`${b.timedLines} / ${b.untimedLines}`] : [])])),
    ...(timed ? ["\nA line without `durationMs` (a compaction or nested request, a v1 line) adds no time to the objective: untimed lines make a unit's objective an undercount. " + (s.objective === "localCost" ? "The objective counts local-provider requests only; the unit's requests to other providers (cloud children) are left out (secondary column: M8)." : "The objective counts the main session's requests only; children are left out.")] : []),
    mdes.length ? `\nPower: at the current n the smallest detectable effect (α .05 two-sided, power .8) is ${pp(lo.mde).replace("+", "±")} (${lo.factor}), the largest ${pp(hi.mde).replace("+", "±")} (${hi.factor}); a smaller true effect is not distinguishable from noise.`
      : flat ? "\nPower: n/a (zero variance: every unit of a level has the same ratio)." : measurable.length ? "\nPower: not estimable (fewer than 2 units at a level of every factor)." : reasons.length ? `\nPower: not estimable (${reasons[0].replace(/^not measurable: /, "")}).` : "",
    dropped.length ? `\n${dropped.map((e) => `${e.factor} ${e.dropped}`).join(", ")} non-finite bootstrap draws dropped (of 2000; a resample with a zero low ratio or no hours).` : "",
    ...(renderV2(s) ? [renderV2(s)] : []),
  ].join("\n");
}

export function renderExperiment(ds: DesignResult[]): string {
  if (!ds.length) return `${NO_DATA}: no meter line carries an arm`;
  const pooled = ds.some((d) => d.design === "v2") && ds.some((d) => d.design === "v3");
  return (pooled ? "Designs v2 and v3 have the same factors and arm ids, but foldHint = cache-aware means something else in v3 (a system-prompt paragraph): they are analysed in separate tables and never pooled; guard signals and the kill switch are per design too.\n\n" : "") + ds.map((d) => [
    `### Design ${d.design} (${d.factors.length} factors, baseline \`${d.baseline}\`, ${d.units} units with ≥ ${MIN_HOURS} active h)\n`,
    (d.strata.some((s) => s.arms) ? "Per stratum (the stratum named by each root's assignment row; never pooled across strata)." : "Per stratum (the billing class of the provider of a root session's main; never pooled across strata).") + " Effect = ratio(high level) ÷ ratio(low level) − 1 with ratio = Σ objective ÷ Σ active hours of the stratum's units at the level (ratio of sums); 95% CI from 2000 bootstrap resamples of the units of each level (seed 1); MDE = 2.80 × the bootstrap sd of the effect. Effects are marginal per factor (unadjusted: no interaction model, the other factors vary freely across the arms). A negative effect of a cost objective is cheaper.\n",
    ...(d.plansAbsent ? ["plans absent (token-meter's `plans` setting is missing or has no usable entry): every unit is counted in stratum api.\n"] : []),
    d.strata.map(renderStratum).join("\n\n"),
    d.strata.some((s) => s.arms) ? "\nPer arm (pooled over the design's strata, descriptive only: the kill switch and the posterior are per stratum, see Guards; not an effect estimate):\n" : "\nPer arm (pooled over the design's strata: the arm statistics and posterior feed the kill switch and the arm posterior, not an effect estimate):\n",
    table(["arm", "units", "active h", "$/h", "95% CI", "posterior reward", "sd", "P(best)"], d.arms.map((s) => {
      const p = d.posterior.find((x) => x.arm === s.arm);
      return [`\`${s.arm}\``, String(s.units), f2(s.activeHours), f2(s.costPerHour), ci({ lo: s.ci[0], hi: s.ci[1] }), p ? f2(p.mean) : "–", p ? f2(p.sd) : "–", p ? pc(p.pBest) : "–"];
    })),
  ].join("\n")).join("\n\n");
}

const withCI = (c: CI, fmt: (n: number) => string): string => (Number.isFinite(c.mean) ? `${fmt(c.mean)}${Number.isFinite(c.lo) ? ` (${fmt(c.lo)} – ${fmt(c.hi)})` : ""}` : "–");

export function renderRandomized(r: Randomized): string {
  if (!r.rows.length) return '\n### Randomized routing\n\n_no randomized spawns in the period_ (`assigned: "random"` on the spawn events)' + (r.ittNote ? `; ITT: not measurable: ${r.ittNote}` : "");
  const c = r.control;
  const row = (group: string, x: Row): string[] => [group, String(x.tasks), `${x.accepted}/${x.judged}`, withCI(x.acceptance, pc), withCI(x.perAccepted, f2)];
  return [
    "\n### Randomized routing (randomized by the router (ext); spawns it sent to qwen)\n",
    `Spawns whose router base was qwen, in the profiles the router randomized (${r.kinds.join(", ")}); 95% bootstrap CIs from ${MIN_CI_N} judged tasks on. The router draws a share of them to another tier (\`assigned: "random"\`); the rest, every task it assigned itself (\`assigned: "router"\`), whatever model ran it, is its **control**. **Causal only for the intention-to-treat comparison**: the ITT row (every task the router randomized, by assignment, whatever ran) against the pooled router-assigned row. The rows by the model that ran a task split their group after the fact (which model runs a task depends on the pool being busy or down, not on a draw): descriptive, no comparison. The pre-randomization row was chosen, not randomized, so it can differ in task difficulty.\n`,
    table(["group", "tasks", "accepted/judged", "acceptance (95% CI)", "$/accepted (95% CI)"], [
      row("router-assigned, ITT comparator (every task the router did not randomize)", c.routerAssigned),
      ...(c.itt ? [row("randomized by the router (ext), ITT: every randomized task", c.itt)] : []),
      ...r.rows.map((x) => row(`randomized by the router (ext), ran on ${x.tier}`, x)),
      ...c.routerAssignedBy.map((x) => row(`router-assigned, ran on ${x.tier}`, x)),
      row("not randomized: pre-randomization (no `assigned`, before the router randomized)", c.preRandomization),
    ]),
    r.otherBase ? `\n${r.otherBase} randomized spawn(s) with another router base are not compared.` : "",
  ].join("\n");
}

export function renderRouterFactors(f: RouterFactor[]): string {
  if (!f.length) return "\nrouter factors: not recorded (no spawn line carries `factors`)";
  return [
    "\n### Router factors (randomized by the router (ext))\n",
    "The router randomizes these levers itself and records each task's levels on its spawn line (`factors`); one row per factor and level, by assignment (intention to treat), over the routed tasks that carry it. Not an experiment of pi-economics: nothing here enters its design. 95% bootstrap CIs from " + MIN_CI_N + " judged tasks on.\n",
    table(["factor", "level", "tasks", "accepted/judged", "acceptance (95% CI)", "$/accepted (95% CI)"],
      f.map((x) => [x.factor, x.level, String(x.row.tasks), `${x.row.accepted}/${x.row.judged}`, withCI(x.row.acceptance, pc), withCI(x.row.perAccepted, f2)])),
  ].join("\n");
}

/** κ, or why there is none: a rater that never varies (the originals: spot checks are drawn from accepted tasks only; else the reviewer). */
const kappaText = (a: { n: number; kappa: number; accepted: { n: number } }): string =>
  Number.isFinite(a.kappa) ? f2(a.kappa) : a.accepted.n === a.n ? "not estimable: spot checks are drawn from accepted tasks only" : "not estimable: the reviewer's verdict never varies";

export function renderSpotChecks(s: SpotChecks): string {
  if (!s.requested && !s.reviewed) return "\n### Spot checks\n\n_no spot checks in the period_ (`spotcheck` events, `reviewOf` on spawn and verdict lines)";
  const a = s.agreement;
  return [
    "\n### Spot checks\n\nAn accepted task re-judged by a review child. Agreement = the reviewer's own verdict (`reviewerVerdict`) and the original verdict at the draw both accept or both do not; κ = Cohen's κ over the same two classes, not estimable when one of the two never varies: spot checks are drawn from accepted tasks only, so every drawn review has an accepted original, and what remains is how often the reviewer does not accept an accepted original. The parent's verdict of the review child is no part of it. Reviewed (judged) counts every review child the parent judged; drawn = those that review a task with a `spotcheck` event, the others were not drawn.\n",
    table(["requested", "reviewed (judged)", "of which drawn", "pending"], [[String(s.requested), String(s.reviewed), String(s.drawn), String(s.pending)]]),
    a.measurable
      ? "\n" + table(["compared (with reviewer verdict)", "agreement", "reviewer does not accept an accepted original", "κ"], [[String(a.n), `${pc(a.agree / a.n)} (${a.agree}/${a.n})`, `${a.accepted.notAccepted}/${a.accepted.n}`, kappaText(a)]])
      : `\nagreement: not measurable — ${a.reason}`,
  ].join("\n");
}

export function renderDelegation(d: DelegationSection): string {
  if (!d.spawns && Number.isNaN(d.childUsdShare)) return NO_DATA;
  return [
    table(["metric", "value"], [
      ["spawned tasks (spot-check reviews; unresolved cards)", `${d.spawns} (${d.reviewSpawns}; ${d.unresolved})`],
      ["$ of spot-check reviews; of unresolved cards", `${f2(d.spotCheckReviews.usd)}; ${f2(d.all.cost.unresolvedUsd)}`], ["child sessions' share of $", pc(d.childUsdShare)], ["child sessions' share of requests", pc(d.childRequestShare)],
      ["Qwen share of tasks (planned)", pc(d.qwenShare)], ["escalations", String(sum(d.escalations.map((e) => e.n)))], ["correctives", String(d.correctives)],
      ["checks (failed)", `${d.checks.n} (${d.checks.failed})`], ["reroutes", String(sum(d.reroutes.map((r) => r.n)))],
      ["kinds", Object.entries(d.byKind).map(([k, n]) => `${k} ${n}`).join(", ") || "–"],
    ]),
    "\n### By tier\n\nTier = the model the task ran on (the router's `workerModel`, after its last reroute; else the model of the child's last request), not the tier the router planned. Spot-check reviews are left out of every table below, and so are spawns whose card files did not resolve (`unresolved`), except for their $ (tier table and the first table): they say nothing about routing quality.\n",
    table(["tier", "tasks", "share", "accepted/judged", "acceptance", "$", "of which unresolved $", "$/accepted (excl. – incl. unresolved $)"], [
      ...d.byTier.map((t) => [t.tier, String(t.spawns), pc(t.share), `${t.accepted}/${t.judged}`, pc(t.acceptance), f2(t.cost.usd), f2(t.cost.unresolvedUsd), bounds(t.cost)]),
      ["all", String(d.all.tasks), pc(d.all.tasks ? 1 : NaN), `${d.all.accepted}/${d.all.judged}`, pc(d.all.acceptance), f2(d.all.cost.usd), f2(d.all.cost.unresolvedUsd), bounds(d.all.cost)],
    ]),
    "\n$ = what the tier's tasks cost (every request of their child sessions), judged or not; $/accepted = that ÷ the accepted tasks; a task nobody judged is cost with no yield (zero yield): in the $, never accepted, in both numbers. The cost of an unresolved card's child is in the $ column and in its own: the first number leaves it out (excl.), the second counts it (incl.), over the same accepted tasks, so a single number means there is none.\n",
    "\n### Planned → executed tier\n\nThe tier the router planned (`workerTier`) against the model the task ran on: a task counts under the model in every table here, so a planned qwen that ran another model is visible only in this matrix.\n",
    table(["planned", "ran on", "tasks"], d.matrix.map((c) => [c.planned, c.executed, String(c.n)])),
    "\n### By profile and tier\n\nProfile = the card kind; acceptance = accepted ÷ judged; $/accepted = subtree cost of the judged tasks ÷ accepted ones; escalations = re-spawns one level up (D7) from this cell's failed tasks; checks = the card's check ran after the child reported.\n",
    table(["profile", "tier", "tasks", "accepted", "partial", "rejected", "unjudged", "acceptance", "$/accepted", "escalations", "checks passed"],
      d.profileTiers.map((c) => [c.kind, c.tier, String(c.tasks), String(c.accepted), String(c.partial), String(c.rejected), String(c.unjudged), pc(c.acceptance), f2(c.perAccepted), String(c.escalations), c.checks.n ? `${c.checks.passed}/${c.checks.n} (${pc(c.passRate)})` : "–"])),
    renderRandomized(d.randomized), renderRouterFactors(d.routerFactors), renderSpotChecks(d.spotChecks),
    "\n### Child models\n", table(["model", "requests", "$"], d.childModels.map((m) => [m.model, String(m.requests), f2(m.usd)])),
    d.escalations.length ? "\n### Escalations\n\n" + table(["from", "to", "n"], d.escalations.map((e) => [e.from, e.to, String(e.n)])) : "",
    d.reroutes.length ? "\n### Reroutes\n\n" + table(["from", "to", "reason", "n"], d.reroutes.map((r) => [r.from, r.to, r.reason, String(r.n)])) : "",
    `\n### Runaway alerts (limits: ${d.limits.requests} requests, $${d.limits.usd} per child session)\n`,
    d.runaways.length ? table(["session", "task", "requests", "$", "why"], d.runaways.map((r) => [r.sessionId, r.taskId ?? "–", String(r.requests), f2(r.usd), r.reason])) : "none",
  ].join("\n");
}

export function renderGuards(g: GuardsSection): string {
  if (!g.perArm.length) return NO_DATA;
  const per = (n: number, u: number) => (u ? f2(n / u) : "–");
  const rating = (r: number[]) => (r.length ? `${(sum(r) / r.length).toFixed(1)} (${r.length})` : "–");
  const l = g.limits;
  return [
    table(["design", "arm", "units", "peeks after mask /unit", "corrections /unit", "rating (n)", "accepted/judged"], g.perArm.map((a) => [a.design, `\`${a.arm}\``, String(a.units), per(a.peeks, a.units), per(a.corrections, a.units), rating(a.ratings), `${a.accepted}/${a.judged}`])),
    ...(g.perStratum.length ? ["\nThe per-arm rows of a v2 design are pooled across its strata; its kill switch below is per stratum."] : []),
    `\nKill switch (baseline per design: ${Object.entries(g.baselines).map(([d, b]) => `${d} \`${b}\``).join(", ")}; ≥ ${l.minSessions} units; acceptance worse by > ${pc(l.threshold)}, peeks/corrections more by > ${l.peekThreshold}/${l.correctionThreshold} per unit, rating lower by > ${l.ratingThreshold}). Written to experiments/state.json only with \`pi-analyse --apply\`.\n`,
    Object.keys(g.kill).length || !g.perStratum.length ? (Object.keys(g.kill).length ? Object.entries(g.kill).map(([a, r]) => `- disable \`${a}\`: ${r}`).join("\n") : "- no arm would be disabled") : "",
    ...g.perStratum.map((x) => Object.keys(x.kill).length ? Object.entries(x.kill).map(([a, r]) => `- design ${x.design} stratum ${x.stratum}: disable \`${a}\`: ${r}`).join("\n") : `- design ${x.design} stratum ${x.stratum}: no arm would be disabled`),
  ].join("\n");
}

export function renderLevers(s: LeversSection): string {
  if (!s.withLevers) return `${NO_DATA} (no \`levers\` lines: meter before M3b)`;
  const TOP = 4;
  const values = (m: Record<string, number>): string => {
    const xs = Object.entries(m).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
    return xs.slice(0, TOP).map(([k, n]) => `\`${k}\` ${n}`).join(", ") + (xs.length > TOP ? `, +${xs.length - TOP} more` : "");
  };
  return [
    `${s.sessions} sessions in the period, ${s.withLevers} with a levers line (eligible ${s.eligible}, children ${s.children}), ${s.sessions - s.withLevers} without one; per session its last levers line up to the period's end. Sources: pe = pi-economics assigned it, ext = an extension chose it, fixed = configuration or pi default.${s.inert ? ` Infinite-context disables compaction (\`pi.compaction.enabled\` false, ext) in ${s.inert} of them: their other \`pi.compaction.*\` levers are inert, left out.` : ""}\n`,
    table(["lever", "sessions", "values (sessions)", "sources", "assigned", "refused", "unverified", "refusal rate"], s.levers.map((r) =>
      [`\`${r.lever}\``, String(r.sessions), values(r.values), Object.entries(r.sources).map(([k, n]) => `${k} ${n}`).join(", "), String(r.assigned), String(r.refused), String(r.unverified), pc(r.refusalRate)])),
    "\nRefusal rate = refused ÷ assigned (read-back, design §7.4); a factor refused in > 20% of its sessions points at a broken add-on.",
  ].join("\n");
}

export function renderQuality(q: QualitySection): string {
  return [
    `Period: ${q.period.since ?? "start"} – ${q.period.until ?? "now"}; lines from ${q.period.first ?? "–"} to ${q.period.last ?? "–"}.\n`,
    table(["log", "lines", "first", "last", "schema versions (v: lines)"], q.logs.map((l) => [l.log, String(l.lines), l.first ?? "–", l.last ?? "–", Object.entries(l.versions).map(([v, n]) => `v${v}: ${n}`).join(", ") || "–"])),
    q.files.some((f) => f.unparsable) ? "\nUnparsable lines: " + q.files.filter((f) => f.unparsable).map((f) => `${f.file} ${f.unparsable}`).join(", ") : "",
    `\nRoot sessions without an arm: ${q.withoutArm.roots} (${f2(q.withoutArm.usd)} $, ${pc(q.withoutArm.share)} of cost; ${q.withoutArm.assigned} of them have an assignment row)${q.withoutArm.examples.length ? `, e.g. ${q.withoutArm.examples.join(", ")}` : ""}.\n`,
    table(["unjoinable", "n", "examples"], q.unjoinable.map((u) => [u.what, String(u.n), u.examples.join(", ") || "–"])),
    `\nContract (\`pi-analyse --check\`): ${q.problems.length ? "\n\n" + q.problems.map((p) => `- ${p.log}: ${p.count} line(s) miss \`${p.field}\` (${p.why}; e.g. ${p.example})`).join("\n") : "every required field present"}`,
  ].join("\n");
}

/** Report file stem: `<YYYY-MM-DD>-<HHMM>-analysis` in UTC, so runs of one day (even of the same hour) keep their reports; a rerun within the same minute replaces it. */
export const reportName = (now: Date): string => `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 16).replace(":", "")}-analysis`;

export function renderAnalysis(a: Analysis, generated = new Date()): string {
  return [
    `# pi analysis — ${a.period.since ?? "start"} to ${a.period.until ?? "now"}`,
    `\nGenerated ${generated.toISOString()} by pi-analyse; field meanings in <agentDir>/LOGS.md. Caveats: quota is the whole account's, in 1% steps; units are root sessions (small samples, task mix varies between them); $ per active hour counts gaps < 30 min as active.`,
    "\n## Budget\n", renderBudget(a.budget),
    "\n## Fleet\n", renderCost(a.cost),
    "\n## Cache\n", renderCache(a.cost.cache, betaOf(a.budget.groups)), renderFolds(a.cost.folds, betaOf(a.budget.groups)),
    "\n## Levers\n", renderLevers(a.levers),
    "\n## Experiments\n", renderExperiment(a.experiment.designs),
    "\n## Router\n", renderDelegation(a.delegation),
    "\n## Guards\n", renderGuards(a.guards),
    "\n## Data quality\n", renderQuality(a.quality),
  ].join("\n") + "\n";
}
