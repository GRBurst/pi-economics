---
name: pi-token-economics-analysis
description: Use when the user asks to analyse pi's own token usage, cost, quota, model routing, delegation or online-experiment results from the local meter logs (phrases like 'analyse meter', 'analyse token economics', 'how much did pi cost', 'which experiment arm is cheaper'). Not for analysing other applications' logs or API billing.
---

# Analysing pi's token economics

pi logs every provider request, every delegated task and every experiment assignment
under `~/.pi/agent`. One command turns all of it into a report; your job is to run it,
read it with the caveats below, and **propose** decisions. You never apply a decision
without the user's explicit approval.

## Steps

1. **Pick the period.** Use the user's period; otherwise everything (no flags). Dates are
   UTC days, inclusive: `--since YYYY-MM-DD --until YYYY-MM-DD`.
2. **Check the data contract first:**

       pi-analyse --check [--since D] [--until D]

   Exit 0 prints `contract ok`. Exit 1 lists per log the missing required fields, the
   count and one example. Missing fields are a finding to report, not a reason to stop
   (legacy `v` 0 lines before 2026-10-03 are expected to lack `v` and partly `arm`).
3. **Run the analysis:**

       pi-analyse [--since D] [--until D]

   It prints the paths it wrote: `~/.pi/agent/reports/<YYYY-MM-DD>-<HHMM>-analysis.md`
   (read this; date and time are UTC, so runs of one day keep their reports) and `.json`
   (the same tables, for follow-up computations).
4. **Read `~/.pi/agent/LOGS.md`** for any field, join or version you are unsure about
   before you interpret a number. Never guess what a field means.
5. **Interpret** section by section (below), then answer the user's question with the
   numbers, their uncertainty and the caveats that apply.
6. **Offer decisions** from the menu, each with its evidence and risk. Wait for approval.

## Reading the report

- **Cost**: total $, active hours (gaps < 30 min), $/active hour with a bootstrap 95% CI,
  quota %/active hour (the account's rise split between the roots active at the time, never
  double-counted across parallel sessions), $/accepted task; splits by model, cache rewrite, warming, after
  folds and after cold resumes. Splits overlap; they are not additive.
- **Experiment** (per design: v1 = 5 factors / 5-character arms, v2 = 6 factors incl.
  `delegationRule`): per-factor effect on $/active hour with a bootstrap CI, OLS with
  two-way interactions (aliased terms listed), per-arm $/h, posterior and P(best).
  An effect counts only when its CI excludes 0 *and* each level has several units.
- **Delegation & routing**: share of tasks and $ in child sessions, tier mix, Qwen share
  (target SC3: ≥ 30% of child tasks, acceptance not worse than Sonnet by > 10 points),
  acceptance per tier, escalations, reroutes, runaway alerts. Per profile (card kind) × tier:
  tasks, accepted/partial/rejected/unjudged, $/accepted task (child subtree), escalations,
  check pass rate. *Randomized routing* (spawns the router sent to Qwen, run on a random tier):
  acceptance and $/accepted by actual tier with bootstrap CIs when n allows; **only the
  comparison within the random subset is causal**, the router row is a same-profile
  reference. *Spot checks*: how often a review child re-judging an accepted task agrees with
  the original verdict (a low rate = the parent's acceptance is too lenient). Spawns whose
  card files did not resolve (`unresolved`) and review children are counted but left out of
  the routing-quality figures.
- **Guards**: per arm peeks-after-mask, corrections, `/rate` mean, acceptance; the arms the
  kill switch would disable.
- **Data quality**: period covered, schema versions, sessions without arm, unjoinable lines,
  pi's share of the account quota, contract problems.

## Caveats (state the ones that apply)

- **Quota is account-wide and in 1% steps**: `q5h`/`q7d` include every other client on the
  account; short sessions move it by 0–1 step, and which parallel root gets a step is
  decided by cost within the interval (noisy per root, fair over many). Prefer $ figures for
  comparisons.
- **Small samples**: the unit is a root session. With few units per arm, CIs are wide or
  degenerate (a CI of width 0 from one unit means "unknown", not "certain").
- **Task-mix variance**: sessions differ in what was asked; an arm can look cheap because it
  got easy sessions. Effects need balanced, repeated sessions.
- $ are pi's API-price estimates, not the subscription bill.
- Resumed child sessions lose their arm (known gap in LOGS.md); such lines are unattributed.

## Decision menu (propose; apply only after the user approves)

- **Disable arms** the kill switch lists: `pi-analyse --apply` writes them to
  `~/.pi/agent/experiments/state.json` (re-enable by editing that file).
- **Change a default in Nix** when a factor's effect is clear (CI excludes 0, enough units):
  the factor's setting in the repo's Home Manager config, then a rebuild by the user.
- **Explore → exploit**: switch `experiments` `mode` to `exploit` once the posterior separates
  arms; keep `minExplore` > 0.
- **Routing**: adjust the task-router's t0 limits / runaway limits when Qwen share or
  acceptance per tier misses SC3, or runaways recur.
- **Fix the logging** when the contract check reports missing fields (a writer bug).

Never edit settings, state files or Nix code, and never run `--apply`, without an explicit
"yes" from the user for that specific change.
