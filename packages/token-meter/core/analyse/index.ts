// On-demand analysis of pi's own logs: cost, levers, experiment, delegation & routing, guards, data quality.
// Pure; bin/pi-analyse.ts does the I/O. Reads the meter log, the task-router outcome log, experiments/assignments.jsonl
// and guards/events.jsonl as plain JSON (packages do not import each other; <agentDir>/LOGS.md is the contract).
import { nextState } from "../arms.ts";
import { withSpawnArms } from "../guards.ts";
import { inPeriod, isRequestLine, type Logs, type Period } from "./logs.ts";
import { armInfo, rowsBySession } from "./designs.ts";
import { cost, type CostSection } from "./cost.ts";
import { experiment, fitKey, type DesignResult, type Fits } from "./experiment.ts";
import { delegation, type DelegationSection } from "./delegation.ts";
import { guards, type GuardsSection } from "./guards.ts";
import { quality, type QualitySection } from "./quality.ts";
import { leverStates, levers, type LeversSection } from "./levers.ts";
import { budget, type BudgetSection } from "./budget.ts";

export { LOGS, inPeriod, versionOf, type FileInfo, type LogName, type Logs, type Period } from "./logs.ts";
export { DESIGNS, designOf } from "./designs.ts";
export { type CostSection, type Split } from "./cost.ts";
export { type CacheSection, type CauseRow, type MissCause } from "./cache.ts";
export { type BalanceRow, type DesignResult, type Effect, type Objective, type OverflowRow, type PerProtocol, type RefusalRow, type Sensitivity, type StratumResult, type Unit } from "./experiment.ts";
export { type Agreement, type DelegationSection, type MatrixCell, type ProfileTier, type ControlRows, type RandomRow, type Randomized, type Row, type RouterFactor, type Runaway, type SpotChecks } from "./delegation.ts";
export { type GuardsSection, type StratumGuard } from "./guards.ts";
export { type QualitySection } from "./quality.ts";
export { type LeverRow, type LeversSection } from "./levers.ts";
export { budget, windowsOf, type BudgetSection, type LocalRow, type SpendRow, type Window } from "./budget.ts";
export { betaOf, calibrate, estPoints, nnls, type Beta, type Fit, type Flag } from "./calibration.ts";
export { renderAnalysis, renderBudget, renderCache, renderCost, renderDelegation, renderExperiment, renderFolds, renderGuards, renderLevers, renderQuality, renderRandomized, renderRouterFactors, renderSpotChecks, reportName } from "./render.ts";

export type Analysis = { period: Period; budget: BudgetSection; cost: CostSection; levers: LeversSection; experiment: { designs: DesignResult[] }; delegation: DelegationSection; guards: GuardsSection; quality: QualitySection };

export function analyse(all: Logs, period: Period = {}): Analysis {
  const logs = inPeriod(all, period);
  const meter = logs.meter.filter(isRequestLine); // levers lines record settings, no request (quality counts them as log lines)
  const bud = budget(meter, all.plans, all.currencyRates);
  const fits: Fits = new Map(bud.groups.map((g) => [fitKey(g.provider, g.kind), g.fit]));
  const designs = experiment(meter, all.assignments, all.expSettings, all.plans, leverStates(all.meter, period), fits, all.currencyRates);
  const flags = Object.fromEntries([...armInfo([...new Set(meter.filter((l) => typeof l?.arm === "string").map((l) => l.arm))], all.assignments)].map(([a, i]) => [a, i.flags]));
  return {
    period,
    budget: bud,
    cost: cost(meter, logs.outcomes, flags, rowsBySession(all.assignments), all.plans),
    levers: levers(all.meter, logs.meter, period),
    experiment: { designs },
    delegation: delegation(meter, logs.outcomes, all.routerSettings),
    guards: guards(designs, withSpawnArms(logs.outcomes, all.meter, all.assignments), logs.guards, all.expSettings, rowsBySession(all.assignments)),
    quality: quality(all, logs, period),
  };
}

/** experiments/state.json after `--apply`: the kill-switch arms added to the disabled ones, a fresh posterior over every design's arms. */
// Arm ids repeat across designs (v2, v3): the newest design's stats shadow an older one's, so the posterior is the current experiment's.
// The v2 engine's designs are written per (design, stratum) under `designs` (T5c.9), never flat.
export const applyKill = (old: any, a: Analysis) => {
  const v2 = new Set(a.guards.perStratum.map((s) => s.design));
  const flat = [...new Map(a.experiment.designs.filter((d) => !v2.has(d.design)).flatMap((d) => d.arms).map((s) => [s.arm, s])).values()];
  return nextState(old, flat, a.guards.kill, a.guards.perStratum);
};
