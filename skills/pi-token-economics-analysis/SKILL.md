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
   Without `pi-analyse` on `PATH` (the package installed without Nix), run every `pi-analyse` command in this
   skill (the decision menu's `pi-analyse --apply` too) as `node --experimental-strip-types --no-warnings ../../packages/token-meter/bin/pi-analyse.ts`,
   a path relative to this skill's directory.
3. **Run the analysis:**

       pi-analyse [--since D] [--until D]

   It prints the paths it wrote: `~/.pi/agent/reports/<YYYY-MM-DD>-<HHMM>-analysis.md`
   (read this; date and time are UTC, so runs of one day keep their reports) and `.json`
   (the same tables, for follow-up computations).
4. **Read `~/.pi/agent/LOGS.md`** for any field, join or version you are unsure about
   before you interpret a number. Without Nix it is `../../packages/token-meter/LOGS.md`, relative to this skill's directory. Never guess what a field means.
5. **Interpret**: Read the **Budget** first, then the other sections (below), all in the units of *Units*; then answer
   the user's question with the numbers, their uncertainty and the caveats that apply.
6. **Offer decisions** from the menu, each with its evidence and risk. Wait for approval.

## Units

State the unit with every number; the report labels them, keep the labels.

- **API-eq $**: the list price of the tokens (pi's `costUsd`); the comparison metric of cloud setups, deterministic per
  request and attributable under concurrent sessions and subagents.
- **cash $**: what is charged: the API-eq $ of `api` providers, 0 for subscription, free and local; "≤ X" while the billing
  class is guessed (a v1 line, no plan for its provider).
- **quota %** (`q5h`, `q7d`): the account's windows, shared by every client: the budget, not a per-session cost.
  **est. points** = the calibration's β × API-eq $ (it needs 8 complete windows).
- **local cost**: **machine hours** (the union of the requests' intervals; the server runs one request at a time) × the plan's
  hourly rate, in the rate's currency (EUR, say). An experiment charges **request hours** (the sum of the request times); the
  gap is the **queue share**, so a unit's local cost is not its share of machine time.
- Currencies: never add USD and EUR; a total exists only with one currency or with `currency.rates`.
- **not measurable**: the data to compute the figure is absent (no `durationMs`, no rate, no reviewer verdict, fewer than 8
  complete windows, a timed objective on untimed lines); **not observable**: the lines never carried the field. Report the
  reason; the figure is never 0 and never a guess.

## Reading the report

- **Budget** (first: the quota, not the dollar, binds a subscription): the quota windows of subscription providers (peak, lockouts, time to cap, 429 requests and retry wait; "not
  observable" when no line carries the field), the **calibration** (non-negative least-squares fit of the windows' peak on the API-eq $ of
  input, cacheRead, cacheWrite and output: β, R², $/point, and the flags r2, residual, drift, beta — a flag means the quota now weighs
  tokens differently from API prices, a reason to revisit the objective, never an automatic change; it needs 8 complete windows), the
  spend by billing class (API-eq $ vs cash $) and the local cost (machine hours × the plan's rate, with its currency and
  the queue share). "plans absent" means the report guessed every billing class. The quota is the budget, not the
  comparison metric of experiments.
- **Fleet**: total API-eq $ and cash $, active hours (gaps < 30 min), API-eq $/active hour with a bootstrap 95% CI,
  API-eq $/accepted task (over all routed tasks: what a task cost, judged or not, paid for by the accepted ones); splits by model and warming; token components (each model's own
  price ratios; a 1 h cache write weighs 2.0 × input, a 5-minute one 1.25). **Cache** (Claude models; premiums also in est. points once calibrated): new context (growth) apart from misses (the cached prefix a
  request had to write again) by cause (ttl, fold, model, prefix, other) — prefix: the system prompt, a prompt section or the
  tool list changed — and the premium of folds and cold resumes over a baseline
  (net of what an ordinary request misses).
- **Levers**: per lever (a pi setting, an extension's or pi-economics' control) the values the period's sessions ran with,
  their sources (pe = pi-economics assigned it, ext = an extension, fixed = configuration or pi default) and the refusal rate
  of assigned values (a factor refused in > 20% of its sessions points at a broken add-on). A read-back is `confirmed`
  (the effective value is the assigned one), `refused` (another value, with who decided) or `unverified` (nothing can tell:
  never read it as applied). Sessions from before levers lines existed count as without one.
- **Experiments** (per design, and per **stratum**: the setup a main belongs to, by billing class or model; each stratum has
  its own design and objective per active hour: `apiUsd` for cloud, `localCost` for local, `wallMs`, `cashUsd`, `points5h`,
  `points7d`; strata are never pooled, and the legacy designs v1 to v4 are analysed apart). The table to trust is the
  **Intention-to-treat** one: every unit by its assignment, the marginal per-factor effect ratio(high) ÷ ratio(low) − 1 (a
  ratio of sums) with a bootstrap CI, a minimum detectable effect, a balance table (units, hours, excluded) and a power
  line; no interaction model. **Per-protocol** keeps the units whose every factor was read back `confirmed` in the last levers
  line: a non-randomized comparison (the units that kept the assignment are self-selected), never the headline. **Refusal rate** per factor: above 20% the add-on is broken and the factor's effect is not to be trusted. **Sensitivity** repeats the
  effect over the requests of the root's first billing class (a model switch moves cost between classes); **context
  overflows** count failed turns per arm. A secondary column shows the requests in the other currency (an arm that moves
  work to another kind of provider looks cheaper in the objective alone). An ineligible session (`eligible: false`, with
  a reason: no matching stratum, mode off, a lever that cannot be set for its model) is no unit and in no refusal rate.
  An effect counts only when its CI excludes 0 *and* each level has several units.
- **Router**: share of tasks and $ in child sessions, Qwen share (of the
  planned tiers; the report states no target: the router's targets are the owner's), escalations,
  reroutes, runaway alerts. The **tier of a task is the model it ran on** (the router's own account,
  else the child's last request), not the tier the router planned; a planned → executed matrix shows
  the difference. *By tier*: tasks, acceptance, $ (every request of the tasks' child sessions, judged
  or not) and **$/accepted as lower – upper**: the two differ by the $ of unresolved cards (card
  files that did not resolve: their children cost real money, but nothing says their tasks were routed;
  a single number means there is none); the *all* row is the headline of the Fleet section. Per profile
  (card kind) × tier: tasks, accepted/partial/rejected/unjudged, $/accepted task (judged tasks only),
  escalations, check pass rate. *Randomized routing* ("randomized by the router (ext)": spawns the router
  sent to Qwen or drew to another tier): the pooled router-assigned row (every task the router did
  not randomize, whatever model ran it), the ITT row (every task it randomized), the pre-randomization
  runs, and the two groups by the model that ran them (descriptive: which member runs a task depends on a
  busy pool or an outage, not on a draw); **only ITT against the pooled router-assigned row is a
  randomized comparison**;
  "not measurable" without `assigned` in the log. *Router factors*: acceptance and $/accepted per level
  of the levers the router randomizes itself (when its spawn lines record them; else "not recorded").
  *Spot checks*: how often the reviewer's own verdict on a spot-checked task agrees with the original
  verdict, with how often the reviewer does not accept an accepted original (a high rate = the parent's acceptance is too lenient) and
  Cohen's κ ("not estimable" on a log whose spot checks are drawn from accepted tasks only: the original never varies); "not measurable" while
  the router logs no reviewer verdict (never read the parent's verdict of the review child as
  agreement: it is always `accepted`). Review children are counted but left out of every routing
  figure; unresolved cards are in the $ only.
- **Guards**: per arm peeks-after-mask, corrections, `/rate` mean, acceptance; the arms the
  kill switch would disable.
- **Data quality**: period covered, schema versions, sessions without arm, unjoinable lines,
  contract problems. (The old "pi's share of the account quota" row is gone: its denominator was only seen through pi's own requests.)

## Caveats (state the ones that apply)

- **Quota is account-wide and in 1% steps**: `q5h`/`q7d` include every other client on the
  account; short sessions move it by 0–1 step, and which parallel root gets a step is
  decided by cost within the interval (noisy per root, fair over many). Compare with API-eq $ or local cost,
  not with quota points.
- **Small samples**: the unit is a root session. With few units per arm, CIs are wide or
  degenerate (a CI of width 0 from one unit means "unknown", not "certain").
- **Task-mix variance**: sessions differ in what was asked; an arm can look cheap because it
  got easy sessions. Effects need balanced, repeated sessions.
- API-eq $ are pi's API-price estimates, not the subscription bill.
- **Quota waits are not measured yet**: the quota waiter (its own extension) and the meter's reading of its events ship after
  0.3.0; until then a wait shows only as `429` error lines and a gap, and the Budget says "not observable" where a wait
  would show.
- **The $/accepted headline was redefined** (Cost section, same function as the *all* row of the tier table): every routed task's
  $ over the accepted tasks, an unjudged task counting as zero yield, as a range excl. – incl. the unresolved cards' $. It is not
  comparable with reports written before: the old figure was about the judged-only one (author's log: old 4.13, judged-only 4.21, new
  6.87 – 11.72). Compare two reports only if both are of the new kind; for a judged-only figure use the *By profile and tier* cells.
- A resumed child session of a run before the v2 engine lacks its arm (known gap in LOGS.md); such lines are
  unattributed. Newer child runtimes derive their root's arm.
## Decision menu (propose; apply only after the user approves)

- **Disable arms** the kill switch lists: `pi-analyse --apply` writes them to
  `~/.pi/agent/experiments/state.json` (re-enable by editing that file).
- **Change a default in Nix** when a factor's effect is clear (CI excludes 0, enough units):
  the factor's setting in the repo's Home Manager config, then a rebuild by the user.
- **Explore → exploit**: switch `experiments` `mode` to `exploit` once the posterior separates
  arms; only strata whose objective is `apiUsd` have a posterior, the others keep drawing from blocks; keep
  `minExplore` > 0.
- **Router**: the router is its own repository's; propose changes to its settings (t0 limits, runaway limits) when
  acceptance per tier misses the owner's targets or runaways recur, and leave the edit to the user.
- **Fix the logging** when the contract check reports missing fields (a writer bug).

Never edit settings, state files or Nix code, and never run `--apply`, without an explicit
"yes" from the user for that specific change.
