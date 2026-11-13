// The markdown of the report, one render function per section.
import { MIN_HOURS } from "../arms.ts";
import { type LedgerSection } from "../ledger.ts";
import { type CI } from "../stats.ts";
import { sum } from "./logs.ts";
import { type CostSection } from "./cost.ts";
import { type CacheSection } from "./cache.ts";
import { type DesignResult, type StratumResult } from "./experiment.ts";
import { MIN_CI_N, type DelegationSection, type Randomized, type SpotChecks } from "./delegation.ts";
import { type GuardsSection } from "./guards.ts";
import { type QualitySection } from "./quality.ts";
import { type Analysis } from "./index.ts";

const f2 = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : "–");
const pc = (n: number): string => (Number.isFinite(n) ? `${Math.round(100 * n)}%` : "–");
const ci = (c: { lo: number; hi: number }) => (Number.isFinite(c.lo) ? `${f2(c.lo)} – ${f2(c.hi)}` : "–");
const table = (head: string[], rows: string[][]): string =>
  [`| ${head.join(" | ")} |`, "|" + " --- |".repeat(head.length), ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const NO_DATA = "_no data in the period_";

export function renderCost(c: CostSection): string {
  if (!c.requests && !c.warming) return NO_DATA;
  return [
    table(["metric", "value"], [
      ["total $", f2(c.totalUsd)], ["requests (warming)", `${c.requests} (${c.warming})`], ["errors", String(c.errors)], ["root sessions", String(c.units)], ["active hours", f2(c.activeHours)],
      ["$/active hour (95% CI)", `${f2(c.usdPerHour.mean)} (${ci(c.usdPerHour)})`], ["q5h %/active hour", f2(c.q5hPerHour)], ["q7d %/active hour", f2(c.q7dPerHour)],
      ["$/accepted task (accepted/judged)", `${f2(c.perAccepted.perAccepted)} (${c.perAccepted.accepted}/${c.perAccepted.judged})`],
    ]),
    "\n### By model\n", table(["model", "requests", "$", "share", "$/active h"], c.byModel.map((m) => [m.model, String(m.requests), f2(m.usd), pc(m.share), f2(m.perHour)])),
    "\n### Splits\n\nWarming = the cache-warming requests (kind warming). Folds and cold resumes are in the Cache section.\n",
    table(["split", "n", "$", "share", "$/active h"], c.splits.map((s) => [s.name, String(s.n), f2(s.usd), pc(s.share), f2(s.perHour)])),
    "\n### Token components (≈, by Anthropic price ratios)\n", table(["component", "$"], Object.entries(c.components).map(([k, v]) => [k, f2(v)])),
    renderCache(c.cache),
    renderFolds(c.folds),
  ].join("\n");
}

export function renderCache(c: CacheSection): string {
  if (!c.requests) return "\n### Cache\n\n_no Claude requests in the period_";
  return [
    "\n### Cache (Claude models)\n",
    "Per session branch (warming requests refresh the cache but are no row): a request's cache write is **new context** (growth: the context added since the previous request, written once whatever happens) plus a **rewrite**, the **miss**: tokens of the prefix the previous request left in the cache (cacheRead + cacheWrite) that this one did not read. Only a miss is avoidable. Cause of a miss, the first that holds: ttl (the gap outlived the TTL in force: 5 min, 1 h for a main session in a mainCacheTtl 1h arm or after a 1 h write), fold (the prompt fell below 80% of the previous request's), model (the model changed), other (a change of the prefix inside the TTL that the meter lines do not show: typically a system-prompt or tool-list change, a small fold or mask, an injected agent message; it is a real cost, not a bookkeeping residue, but its reason is not in the log). $ = API-eq at each line's input price p: a write is 1.25 p (2.0 p for a 1 h write), a read 0.1 p; a miss costs the premium of writing over reading.\n",
    table(["metric", "value"], [
      ["requests (branches)", `${c.requests} (${c.branches})`], ["new context", `${c.newContext.tokens} tokens, ${f2(c.newContext.usd)} $`],
      ["missed prefix", `${c.misses.reduce((s, m) => s + m.tokens, 0)} tokens, ${f2(c.misses.reduce((s, m) => s + m.usd, 0))} $ premium`], ["miss share (missed ÷ cache-write tokens)", pc(c.missShare)],
    ]),
    "\nMisses by cause:\n", table(["cause", "requests", "missed tokens", "premium API-eq $"], c.misses.map((m) => [m.cause, String(m.n), String(m.tokens), f2(m.usd)])),
    "\nFolds and cold resumes (a cold resume = a request after a gap beyond the TTL in force; a fold as in the cause table, unless the gap came first). Window = the event's request and the next two turn requests (cut short by the next event): premium = their misses × (write − read price). Baseline = what an ordinary request costs the same way (the mean premium of the requests outside every window, in the sessions that have such an event) once per event; net = premium − baseline.\n",
    table(["event", "n", "premium API-eq $", "baseline $", "net $"], ([["after folds", c.events.fold], ["after cold resumes", c.events.coldResume]] as const).map(([name, e]) => [name, String(e.events), f2(e.premiumUsd), f2(e.baselineUsd), f2(e.netUsd)])),
  ].join("\n");
}

const f4 = (n: number): string => (Number.isFinite(n) ? n.toFixed(4) : "–");

export function renderFolds(f: LedgerSection): string {
  if (!f.n) return "\n### Fold ledger\n\n_no folds in Claude sessions in the period_";
  const rows = (rs: LedgerSection["byDepth"]) => rs.map((r) => [r.name, String(r.n), f4(r.savingsUsd), f4(r.rewriteUsd), f4(r.netUsd), pc(r.negativeShare)]);
  const head = (first: string) => [first, "folds", "cache-read $ saved", "rewrite $ paid", "net $", "share net < 0"];
  return [
    "\n### Fold ledger (Claude models)\n",
    "Per detected fold (a non-warming request whose prompt, input + cacheRead + cacheWrite, fell below 80% of the previous one's): R = tokens removed; K ≈ the first request's cacheWrite minus the session's typical write (median of its non-first, non-fold, non-cold turns), 0 for a fold after a cold gap; n = requests after the fold until the session ends or the next cold gap (≥ 5 min, ≥ 60 min in a mainCacheTtl 1h arm; warming counts); r and w = the model's cache read and write price per token: 0.1 × the input price recovered from the lines' cost for a read, 1.25 × for a 5-minute write and 2.0 × for a 1 h write (a write is a 1 h one in a mainCacheTtl 1h arm's main session, or by the line's own cacheWrite1h). **Net = n·R·r − K·(w − r)** = cache-read $ saved − rewrite $ paid. Counterfactual only: it assumes the fold changed nothing else (output, later tool use, task path) and that an unfolded prompt would have kept being read at r; folds overlap in time but each is valued alone.\n",
    table(["metric", "value"], [["folds (after a cold gap)", `${f.n} (${f.cold})`], ["cache-read $ saved", f4(f.savingsUsd)], ["rewrite $ paid", f4(f.rewriteUsd)], ["net $", f4(f.netUsd)], ["share with net < 0", `${pc(f.negativeShare)} (${f.negative}/${f.n})`]]),
    "\nBy fold depth K/R (rewritten tokens per token removed; break-even ≈ n/11.5):\n", table(head("K/R"), rows(f.byDepth)),
    "\nBy design and foldHint level (v2 and v3 differ in what cache-aware means: never pooled):\n", table(head("group"), rows(f.byGroup)),
    "\nBy model:\n", table(head("model"), rows(f.byModel)),
  ].join("\n");
}

const pp = (n: number): string => (Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${(100 * n).toFixed(0)}%` : "–");

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
    table(["factor", "low → high", "n low", "n high", "ratio low", "ratio high", "effect", "95% CI", "MDE"], s.effects.map((e) => "notMeasurable" in e
      ? [e.factor, "–", "–", "–", "–", "–", e.notMeasurable, "–", "–"]
      : [e.factor, `${e.a} → ${e.b}`, String(e.nA), String(e.nB), f2(e.ratioA), f2(e.ratioB), pp(e.effect), Number.isFinite(e.ci[0]) ? `${pp(e.ci[0])} – ${pp(e.ci[1])}` : "–", e.mde === 0 ? "n/a (zero variance)" : Number.isFinite(e.mde) ? `±${pp(e.mde).replace("+", "")}` : "–"])),
    "\nBalance (units with ≥ " + MIN_HOURS + " active h; shorter ones are excluded from the estimate and counted here):\n",
    table(["arm", "units", "active h", "excluded (< " + MIN_HOURS + " h)", "no objective", ...(timed ? ["request lines timed / untimed"] : [])], s.balance.map((b) => [`\`${b.arm}\``, String(b.units), f2(b.hours), String(b.excluded), String(b.unmeasured), ...(timed ? [`${b.timedLines} / ${b.untimedLines}`] : [])])),
    ...(timed ? ["\nA line without `durationMs` (a compaction or nested request, a v1 line) adds no time to the objective: untimed lines make a unit's objective an undercount. " + (s.objective === "localCost" ? "The objective counts local-provider requests only; the unit's requests to other providers (cloud children) are left out (secondary column: M8)." : "The objective counts the main session's requests only; children are left out.")] : []),
    mdes.length ? `\nPower: at the current n the smallest detectable effect (α .05 two-sided, power .8) is ${pp(lo.mde).replace("+", "±")} (${lo.factor}), the largest ${pp(hi.mde).replace("+", "±")} (${hi.factor}); a smaller true effect is not distinguishable from noise.`
      : flat ? "\nPower: n/a (zero variance: every unit of a level has the same ratio)." : measurable.length ? "\nPower: not estimable (fewer than 2 units at a level of every factor)." : reasons.length ? `\nPower: not estimable (${reasons[0].replace(/^not measurable: /, "")}).` : "",
    dropped.length ? `\n${dropped.map((e) => `${e.factor} ${e.dropped}`).join(", ")} non-finite bootstrap draws dropped (of 2000; a resample with a zero low ratio or no hours).` : "",
  ].join("\n");
}

export function renderExperiment(ds: DesignResult[]): string {
  if (!ds.length) return `${NO_DATA}: no meter line carries an arm`;
  const pooled = ds.some((d) => d.design === "v2") && ds.some((d) => d.design === "v3");
  return (pooled ? "Designs v2 and v3 have the same factors and arm ids, but foldHint = cache-aware means something else in v3 (a system-prompt paragraph): they are analysed in separate tables and never pooled; guard signals and the kill switch are per design too.\n\n" : "") + ds.map((d) => [
    `### Design ${d.design} (${d.factors.length} factors, baseline \`${d.baseline}\`, ${d.units} units with ≥ ${MIN_HOURS} active h)\n`,
    "Per stratum (the billing class of the provider of a root session's main; never pooled across strata). Effect = ratio(high level) ÷ ratio(low level) − 1 with ratio = Σ objective ÷ Σ active hours of the stratum's units at the level (ratio of sums); 95% CI from 2000 bootstrap resamples of the units of each level (seed 1); MDE = 2.80 × the bootstrap sd of the effect. Effects are marginal per factor (unadjusted: no interaction model, the other factors vary freely across the arms). A negative effect of a cost objective is cheaper.\n",
    ...(d.plansAbsent ? ["plans absent (token-meter's `plans` setting was not read): every unit is counted in stratum api.\n"] : []),
    d.strata.map(renderStratum).join("\n\n"),
    "\nPer arm (pooled over the design's strata: the arm statistics and posterior feed the kill switch and the arm posterior, not an effect estimate):\n",
    table(["arm", "units", "active h", "$/h", "95% CI", "posterior reward", "sd", "P(best)"], d.arms.map((s) => {
      const p = d.posterior.find((x) => x.arm === s.arm);
      return [`\`${s.arm}\``, String(s.units), f2(s.activeHours), f2(s.costPerHour), ci({ lo: s.ci[0], hi: s.ci[1] }), p ? f2(p.mean) : "–", p ? f2(p.sd) : "–", p ? pc(p.pBest) : "–"];
    })),
  ].join("\n")).join("\n\n");
}

const withCI = (c: CI, fmt: (n: number) => string): string => (Number.isFinite(c.mean) ? `${fmt(c.mean)}${Number.isFinite(c.lo) ? ` (${fmt(c.lo)} – ${fmt(c.hi)})` : ""}` : "–");

export function renderRandomized(r: Randomized): string {
  if (!r.rows.length) return "\n### Randomized routing\n\n_no randomized spawns in the period_ (`assigned: \"random\"` on the spawn events)";
  return [
    `\n### Randomized routing (spawns the router sent to qwen)\n`,
    `Spawns whose router base was qwen, by the tier they actually ran on (${r.kinds.join(", ")}); 95% bootstrap CIs from ${MIN_CI_N} judged tasks on. **Causal only for the random subset**: comparing random tiers with one another is a randomized comparison; the router row (the router's own qwen tasks of the same profiles: assigned = router, or absent in old lines) was chosen, not randomized, so it can differ in task difficulty.\n`,
    table(["assigned", "actual tier", "tasks", "accepted/judged", "acceptance (95% CI)", "$/accepted (95% CI)"],
      r.rows.map((x) => [x.assigned, x.tier, String(x.tasks), `${x.accepted}/${x.judged}`, withCI(x.acceptance, pc), withCI(x.perAccepted, f2)])),
    r.otherBase ? `\n${r.otherBase} randomized spawn(s) with another router base are not compared.` : "",
  ].join("\n");
}

export function renderSpotChecks(s: SpotChecks): string {
  if (!s.requested && !s.reviewed) return "\n### Spot checks\n\n_no spot checks in the period_ (`spotcheck` events, `reviewOf` on spawn and verdict lines)";
  return [
    "\n### Spot checks\n\nAn accepted task re-judged by a review child: agreement = the original verdict (at the draw) and the review verdict both accept or both do not.\n",
    table(["requested", "reviewed (judged)", "agree", "agreement", "pending"], [[String(s.requested), String(s.reviewed), String(s.agree), pc(s.rate), String(s.pending)]]),
  ].join("\n");
}

export function renderDelegation(d: DelegationSection): string {
  if (!d.spawns && Number.isNaN(d.childUsdShare)) return NO_DATA;
  return [
    table(["metric", "value"], [
      ["spawned tasks (spot-check reviews; unresolved cards)", `${d.spawns} (${d.reviewSpawns}; ${d.unresolved})`], ["child sessions' share of $", pc(d.childUsdShare)], ["child sessions' share of requests", pc(d.childRequestShare)],
      ["Qwen share of tasks (planned)", pc(d.qwenShare)], ["escalations", String(sum(d.escalations.map((e) => e.n)))], ["correctives", String(d.correctives)],
      ["checks (failed)", `${d.checks.n} (${d.checks.failed})`], ["reroutes", String(sum(d.reroutes.map((r) => r.n)))],
      ["kinds", Object.entries(d.byKind).map(([k, n]) => `${k} ${n}`).join(", ") || "–"],
    ]),
    "\n### By tier\n\nTier = the model the task ran on (the router's `workerModel`, after its last reroute; else the model of the child's last request), not the tier the router planned. Spot-check reviews and spawns whose card files did not resolve (`unresolved`) are left out of every table below: they say nothing about routing quality.\n",
    table(["tier", "tasks", "share", "accepted/judged", "acceptance", "$", "$/accepted"], d.byTier.map((t) => [t.tier, String(t.spawns), pc(t.share), `${t.accepted}/${t.judged}`, pc(t.acceptance), f2(t.usd), f2(t.perAccepted)])),
    "\n### Planned → executed tier\n\nThe tier the router planned (`workerTier`) against the model the task ran on: a task counts under the model in every table here, so a planned qwen that ran another model is visible only in this matrix.\n",
    table(["planned", "ran on", "tasks"], d.matrix.map((c) => [c.planned, c.executed, String(c.n)])),
    "\n### By profile and tier\n\nProfile = the card kind; acceptance = accepted ÷ judged; $/accepted = subtree cost of the judged tasks ÷ accepted ones; escalations = re-spawns one level up (D7) from this cell's failed tasks; checks = the card's check ran after the child reported.\n",
    table(["profile", "tier", "tasks", "accepted", "partial", "rejected", "unjudged", "acceptance", "$/accepted", "escalations", "checks passed"],
      d.profileTiers.map((c) => [c.kind, c.tier, String(c.tasks), String(c.accepted), String(c.partial), String(c.rejected), String(c.unjudged), pc(c.acceptance), f2(c.perAccepted), String(c.escalations), c.checks.n ? `${c.checks.passed}/${c.checks.n} (${pc(c.passRate)})` : "–"])),
    renderRandomized(d.randomized), renderSpotChecks(d.spotChecks),
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
    `\nKill switch (baseline per design: ${Object.entries(g.baselines).map(([d, b]) => `${d} \`${b}\``).join(", ")}; ≥ ${l.minSessions} units; acceptance worse by > ${pc(l.threshold)}, peeks/corrections more by > ${l.peekThreshold}/${l.correctionThreshold} per unit, rating lower by > ${l.ratingThreshold}). Written to experiments/state.json only with \`pi-analyse --apply\`.\n`,
    Object.keys(g.kill).length ? Object.entries(g.kill).map(([a, r]) => `- disable \`${a}\`: ${r}`).join("\n") : "- no arm would be disabled",
  ].join("\n");
}

export function renderQuality(q: QualitySection): string {
  const share = (x: { pi: number; total: number; share: number }) => [String(x.pi), String(x.total), pc(x.share)];
  return [
    `Period: ${q.period.since ?? "start"} – ${q.period.until ?? "now"}; lines from ${q.period.first ?? "–"} to ${q.period.last ?? "–"}.\n`,
    table(["log", "lines", "first", "last", "schema versions (v: lines)"], q.logs.map((l) => [l.log, String(l.lines), l.first ?? "–", l.last ?? "–", Object.entries(l.versions).map(([v, n]) => `v${v}: ${n}`).join(", ") || "–"])),
    q.files.some((f) => f.unparsable) ? "\nUnparsable lines: " + q.files.filter((f) => f.unparsable).map((f) => `${f.file} ${f.unparsable}`).join(", ") : "",
    `\nRoot sessions without an arm: ${q.withoutArm.roots} (${f2(q.withoutArm.usd)} $, ${pc(q.withoutArm.share)} of cost; ${q.withoutArm.assigned} of them have an assignment row)${q.withoutArm.examples.length ? `, e.g. ${q.withoutArm.examples.join(", ")}` : ""}.\n`,
    table(["unjoinable", "n", "examples"], q.unjoinable.map((u) => [u.what, String(u.n), u.examples.join(", ") || "–"])),
    "\nPi share of the account quota (rises between pi requests < 30 min apart ÷ all rises seen per window; other use during pi activity counts as pi):\n",
    table(["window", "pi points", "account points", "pi share"], [["5 h", ...share(q.piQuota.q5h)], ["7 d", ...share(q.piQuota.q7d)]]),
    `\nContract (\`pi-analyse --check\`): ${q.problems.length ? "\n\n" + q.problems.map((p) => `- ${p.log}: ${p.count} line(s) miss \`${p.field}\` (${p.why}; e.g. ${p.example})`).join("\n") : "every required field present"}`,
  ].join("\n");
}

/** Report file stem: `<YYYY-MM-DD>-<HHMM>-analysis` in UTC, so runs of one day (even of the same hour) keep their reports; a rerun within the same minute replaces it. */
export const reportName = (now: Date): string => `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 16).replace(":", "")}-analysis`;

export function renderAnalysis(a: Analysis, generated = new Date()): string {
  return [
    `# pi analysis — ${a.period.since ?? "start"} to ${a.period.until ?? "now"}`,
    `\nGenerated ${generated.toISOString()} by pi-analyse; field meanings in <agentDir>/LOGS.md. Caveats: quota is the whole account's, in 1% steps; units are root sessions (small samples, task mix varies between them); $ per active hour counts gaps < 30 min as active.`,
    "\n## Cost\n", renderCost(a.cost),
    "\n## Experiment\n", renderExperiment(a.experiment.designs),
    "\n## Delegation & routing\n", renderDelegation(a.delegation),
    "\n## Guards\n", renderGuards(a.guards),
    "\n## Data quality\n", renderQuality(a.quality),
  ].join("\n") + "\n";
}
