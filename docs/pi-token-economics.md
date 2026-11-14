# pi token economics

Subsystem that measures what running pi costs, in the unit that binds the setup, and which of pi's
knobs move that cost without hurting the work: every provider request is metered once with its
tokens, its billing class and the value and source of every lever in force; per-session randomized
experiments change levers and read them back; a bench varies the levers that cannot change per
session. It lowers nothing by itself beyond the opt-in interventions it ships (cache lifecycle,
fold-reminder limits), and it does not route, gate, review or drive work (`docs/scope.md`).
Comments in the source cite the design record (`spec §n`), kept with the author's system
configuration; the options are in `docs/pi-economics.md`. Where this document and the code disagree,
the code wins.

## Components

Paths are relative to this repository's root, unless noted.

| Component | What it is | Loaded in |
|---|---|---|
| `packages/token-meter/` (`pi-token-meter`) | One JSONL line per provider request (tokens, cost, billing class, timing, quota headers, retries; pi's compaction summaries included) and a `levers` line per session (every lever's value, source and read-back, on change) into `<agentDir>/meter/YYYY-MM.jsonl`; no prompt/response text. Also the `meter-report` and `pi-analyse` binaries and the log manual `LOGS.md` (linked to `~/.pi/agent/LOGS.md`). | main + children |
| `packages/cache-lifecycle/` (`pi-cache-lifecycle`) | Warming decision (main with running children, child awaiting a reply → warm; capped), elision of stale tool results/thinking after cache expiry, optional 1 h cache TTL for main, the pi-1.0.0 message-identity shim that keeps cache warming alive past custom messages, `peek-after-mask` guard log. Its three settings are levers the experiments engine can assign. | main + children |
| `packages/experiments/` (`pi-experiments`) | The online experiment: one arm per main session, drawn per stratum from that stratum's design (explore/exploit/off); a child runtime never draws, it serves its root's arm; the engine pushes each session's levers to the extensions that ask on the internal channel `pi-economics:levers:v1` (the former global `__piExperimentsApi_v1` is removed); lever add-ons (`addons/`) apply a level and read it back; correction guard log and `/rate 1-5`. | main + children |
| `packages/infinite-context/package.nix` + 1 patch in `patches/pi-infinite-context/` | Pinned input `inputs.pi-infinite-context` (rev `494df9d`) with `reminders`: upstream's `settings.json` gains `overrides`, rules keyed by provider or exact `provider/modelId` with upstream's `nudgeAtTokens` (a number or a range `[min, max]`) and `nudgeAtPercent`; each field resolves exact model, then provider, then the top level, then upstream's 150k / 75 %. The session follows its current model; a switch to a rule with another range draws and records a new limit. Upstream's step (15k, less near the window) and fail-open parsing stay. The former `cache` patch (cost-aware fold hint, `fold_timing`, re-sync, handoff) was dropped: upstream re-syncs a snapshot and stops once when folds cannot be applied, and declined the fold hint. The former `foreign-messages` patch was dropped: upstream aligns the projection as an ordered subsequence. | main + children |
| `modules/common.nix` (`piSettings`) | Idempotent migration of the mutable `~/.pi/agent/settings.json`: puts the registry's links first in `extensions` (`loadOrder`, op `ensurePrefix`) and sets `cacheWarming: "idle"` when `programs.piEconomics.cacheLifecycle` is enabled. | — |
| `packages/bench/` | Bench harness: replay of the user's own past tasks, single-agent and orchestrator (RPC) drivers, blind A/B and per-run judging, factor-effect report, process-scope pi levers. Data and runs live in `<agentDir>/bench`, not in the repo. | tool |

Observed or used, not shipped here: [pi-task-router](https://github.com/GRBurst/pi-task-router)
(its own flake, `programs.piTaskRouter`: routes `spawn_subagent` calls by task card; what it does is
in its `docs/task-router.md`; pi-economics reads its outcome log, and the levers it randomizes
itself are recorded as extension-owned, never as pi-economics factors), the patched actor-subagents
of [pi-setup](https://github.com/GRBurst/pi-setup) (`programs.pi.actorSubagents`: the children's
runtime and the spawn-policy API `__subagentsApi_v1` that cache-lifecycle and experiments use), and
the quota waiter (see "Quota waits").

Selection is single-sourced in the registry (`programs.piEconomics.extensions`, `forChildren`):
children get infinite-context, token-meter, cache-lifecycle and experiments (a host adds its own,
such as a provider login); in a child, experiments draws nothing and serves its root's arm and levers.
`module-eval` pins the child-extension set and each package has its check.

## Units and money

Every figure in a report carries its unit; none is added to another without a stated conversion.

| Unit | What it is | Where it is used |
|---|---|---|
| API-eq $ | the list price of the tokens: pi's `costUsd` (1 h cache writes at 2.0 × input, 5-minute at 1.25, reads per model: 0.1, Opus 5.5 and Sonnet 5.5 0.05) | the comparison metric of cloud strata (`apiUsd`); Fleet; the Budget's spend |
| cash $ | what is charged: the API-eq $ of billing class `api`, else 0; a v1 line with no plan is guessed `api`, so its cash $ reads "≤ X" | the Budget's spend by class |
| quota % (`q5h`, `q7d`) | the account's utilisation of a subscription's windows, in whole percent, shared by every session and client | the Budget: windows, peak, lockouts; never charged to a session or an arm |
| est. points | quota points estimated from API-eq $ by the calibration (a non-negative fit per token component); the cache premiums and the `points5h` / `points7d` objectives | where the fit has at least 8 complete windows; else "not measurable" |
| local cost | machine hours × the plan's hourly rate, in the rate's currency | the Budget; the `localCost` objective |
| wall time | Σ `durationMs` of the main's requests | the objective `wallMs`, the fallback of a local stratum without a rate |

A provider's **billing class** (`subscription`, `api`, `free`, `local`) comes from `plans` in
`token-meter/settings.json` (Home Manager: `tokenMeter.plans`); the meter writes it on every line,
and a provider without a plan is `api`. **Not measurable** means the data to compute the figure is
absent (no `durationMs` on a v1 line, no rate, no reviewer verdict, fewer than 8 complete windows,
a timed objective on untimed lines): the report says so and why; it never prints 0. The
**Budget** comes first in the report because the quota, not the dollar, is what binds a
subscription: its windows, the calibration (is the quota still weighing tokens as the API prices
do: R², β per component, flags, never an automatic change) and the spend by billing class; the
experiments compare API-eq $ and local cost instead, which are deterministic per request and
attributable under concurrent sessions and subagents.

### Local cost and currencies

A local provider's plan holds a `rate` (`{ amount, currency, per = "hour" }`); its cost is its **machine
hours** times the rate. Machine hours are the measure of the union of the requests' intervals
(`ts − durationMs … ts`), because a local server runs one request at a time and overlapping
requests queue: the machine is busy once. **Request hours** (Σ `durationMs`) are what an experiment
charges a unit, since the unit's own requests are what it caused; their ratio to machine hours is
the **queue share**. A failed request occupies the machine and counts in both hours but is no
request; a request without `durationMs` adds no time, and a provider with a rate but no timed
request has no cost (not measurable, never 0). The report adds per model: requests, request hours,
output tokens per second (`genMs` of the lines that carry llama.cpp's `timings`, else `durationMs`),
the cost per million output tokens, and the **prefix reuse** (`cacheN` ÷ `cacheN + promptN`, else
`cacheRead` ÷ `input + cacheRead`).

Currencies are explicit: API-eq $ and cash $ are USD, a local rate has its own currency (EUR, say).
The Budget's **costs by currency** show one row each; a total appears only with one currency or when
`currencyRates` (`tokenMeter.currencyRates`, `"FROM/TO"` keys) convert every currency (the direct
rate, else the inverse; never chained through a third currency). The experiment tables' secondary
column (a unit's requests in the other currency) converts the same way, or stays apart.

## Files under `~/.pi/agent` (`<agentDir>`)

Every field, type, join key and schema version: `~/.pi/agent/LOGS.md`
(shipped as `packages/token-meter/LOGS.md`). Every line written by the meter,
the outcome log, the guard writers and the assignments carries `v` (schema
version, integer; absent = 0, legacy).

| Path | Contents |
|---|---|
| `meter/YYYY-MM.jsonl` | Meter lines (`v: 2`): `ts, sessionId, parentSessionId, arm, design, provider, model, effort, kind (turn\|warming\|nested\|compaction), billing, input, cacheRead, cacheWrite, cacheWrite1h, output, reasoning, costUsd, status (code or "error"), errorClass, errorKind, retries, retryWaitMs, durationMs, ttftMs, promptMs, genMs, cacheN, promptN, systemHash, q5h, q5hReset, q7d, q7dReset, overage, claim, fallback, rawRatelimit?`; a field is present iff it was measured (absent = unknown, never 0). `kind: "levers"` lines (the session's lever states: value, source, assigned level, read-back) have fields of their own. Errors are logged at `message_end` as `status:"error"` with `errorClass` and `errorKind` (`context_overflow`, `rate_limit`, `other`). `packages/token-meter/LOGS.md` has every field. |
| `task-router/outcomes/YYYY-MM.jsonl`, `task-router/member-count.json` | The router's files, written by the [pi-task-router](https://github.com/GRBurst/pi-task-router) package; the outcome schema is its `docs/outcome-log.md`. The meter observes them: `packages/token-meter/LOGS.md` keeps the reader side. |
| `guards/events.jsonl` | Guard events, shared one-line format `{ts, sessionId, arm, design?, event, value?}`: `peek-after-mask` (cache-lifecycle), `correction` and `rating` (experiments). Never prompt text, never tool arguments. |
| `experiments/assignments.jsonl` | One row per main session: v2 rows `{v: 2, ts, sessionId, design, mode, eligible, stratum, arm, factors, reason?}` (every main session, eligible or not; `design` is the 12-hex content id of the stratum's design); older rows (v0, v1) are the v1 engine's: `design` `"v4"` (three factors, 3-char arm ids), `"v2"`/`"v3"` (six factors) or nothing (five factors). Sticky: a session keeps its row, a resumed one too. |
| `experiments/blocks.json` | The explore queues, per `<design id>/<stratum>`: the arms left in the current permuted block. |
| `experiments/state.json` | The kill switch and the posterior: `designs.<id>.<stratum>` = `{ disabled, posterior, reasons }` for the v2 engine (the posterior is non-empty only for strata whose objective is `apiUsd`), flat keys for designs v1–v4; written atomically by `pi-analyse --apply` and `meter-report --arms --posterior`, run by hand (no timer). |
| `experiments/assignment.json` | Bench runs only: the arm the bench fixed for the run's agent dir, adopted by the engine instead of a draw (LOGS.md, "Bench assignment"). |
| `reports/YYYY-MM-DD-HHMM-analysis.{md,json}` | Written by `pi-analyse` (on demand; UTC time of the run, so runs of one day keep their reports). |
| `LOGS.md` | Log manual (Home Manager link into the token-meter package). |
| `experiments/settings.json` | Written by Home Manager from `programs.piEconomics.experiments.settings` whenever experiments is enabled (`{"mode": "explore"}` for `{}`): the extension's opt-in; without the file experiments is inert (no arm, no assignments.jsonl). |
| `{token-meter,cache-lifecycle}/settings.json` | Same: written only when the corresponding `programs.piEconomics.<x>.settings` is non-empty (`task-router/settings.json`: pi-task-router's module). Every key has a code default, so a missing file means "defaults". `token-meter/settings.json` also holds `plans` and `currency.rates`. |
| `infinite-context/settings.json` | Always written by `programs.piEconomics.infiniteContext` (`{}` at its defaults): upstream's settings plus the reminder rules. |
| `bench/` | `tasks.json` + `tasks/<id>/` (meta.json, users.md, ref_answer.md, extra files), `refs/` (`pi-bench refs`), `runs/<id>.<arm>.<rep>/` (result.json, prompt.md, final.md, diff.patch, check.log, session/, events.jsonl, and `agent/` for factor arms), `judge/`, `reports/`, `pilot/`, `smoke/`, `src/` (task generator), `run-h6.sh`. |

## Settings and defaults

Nix options, per component: `programs.piEconomics.{tokenMeter,cacheLifecycle,experiments,infiniteContext}.{enable, package, settings}` (the options, their defaults and effects are in `docs/pi-economics.md`; the router's are pi-task-router's `programs.piTaskRouter`). The registry (`programs.piEconomics.extensions`) selects the packages and links them, so the link and the selection never disagree.

Code defaults (a settings file only overrides; unknown keys are ignored):

- **token-meter** — `enabled: true`, `dir: "meter"`, `rawRatelimit: true`; no `plans` (every provider counts as `api`; the report says "plans absent") and no currency rates.
- **task-router** — not this repository's: its code defaults, the legacy-key map
  and the routing limits are in pi-task-router's `docs/task-router.md`.
- **cache-lifecycle** — `warmPolicy: "orchestrator-aware"` (vs `native`),
  `mainCacheTtl: "5m"` (vs `"1h"`), `maskOnCold: "off"` (vs `"tools"`,
  `"tools+thinking"`), `protectedTailTokens: 20000`, `identityShim: true`.
- **experiments** — `mode: "explore"`; `minExplore: 0.1`; the strata (below);
  `guards {minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5}`;
  `correctionRegex \b(no|wrong|revert|undo|that's not)\b` (case-insensitive). The v1 engine's
  `factors`, `maxArms` and `baseline` are not applied (a warning names them).
- **Migration** — `cacheWarming: "idle"` is ensured by
  `pi-settings-migrate` (its `idle` flag, the piSettings op `cacheLifecycle`) in
  an existing `settings.json` when cache-lifecycle is enabled —
  pi's default `"streaming"` never fires `cache_warming_decision`.
- **infinite-context** — `programs.piEconomics.infiniteContext.reminders`:
  `default` and `overrides` (per provider or model) with `nudgeAtTokens` (a
  number or a range) and `nudgeAtPercent`, e.g. 400k for the two 1M-window
  anthropic models; a range is what lets the experiment draw the limit.

## Strata, designs and objectives

The unit of the online experiment is the **main session** (a child runs its root's arm). A
**stratum** is a setup whose sessions share one design and one objective: it matches a main by
billing class (from `plans`) and/or by `<provider>/<id>` globs, the first stratum that matches wins,
and strata are never pooled (cloud and local costs are different currencies and different regimes).
Without a `strata` setting there is one stratum per billing class of `plans` plus `api`, each named
after its class:

| Stratum | Factors (a level pair each) | Objective |
|---|---|---|
| a cloud class (`subscription`, `api`, `free`) | `warmPolicy` (`native`, `orchestrator-aware`), `mainCacheTtl` (`5m`, `1h`), `maskOnCold` (`off`, `on`): the full 2³, 8 arms | `apiUsd` |
| `local` | `nudge` = `infinite-context.nudgeAtTokens`, at 0.25 and 0.75 of the range of the session's matched fold-reminder rule | `localCost` |

An explicit stratum states `match`, `objective` and `factors` (`name`, `lever`, two `levels`, and a
`target` for a `session-entry` lever); a malformed stratum is dropped whole with a warning, never
repaired. The first level of a factor is its baseline. A factor's `lever` is an add-on's id or a
data-only kind (below); the design id is the content hash of the levers, levels and generators, so
a changed design is a new design and analyses never pool two.

**Objective** per stratum, per active hour: `apiUsd` (cloud classes, children and warming
included), `localCost` (request hours × rate; cloud children are a secondary column), `wallMs`,
`cashUsd` (not computed yet: not measurable), `points5h` and `points7d` (the calibrated quota
points; not measurable until the calibration has a fit). The default is `apiUsd`, or `localCost`
for a stratum that matches only `local`; the quota is the budget, so it is an objective only by an
explicit setting. A local stratum without a rate falls back to `wallMs`, without timed requests it
is not measurable.

**Eligibility.** A main is eligible when its model matches a stratum, `mode` is not `off`, an arm is
left enabled and every **gating** lever of the stratum's design (the fold-reminder limit) is
loaded and settable for the session's model (its matched rule has a range). The gate is
all-or-nothing per session: a design with a partly settable lever would break the factorial. An
ineligible session's row says why (`eligible: false`, `reason`), has no arm, consumes no block and
is in no refusal rate.

**Modes.** `explore` draws permuted blocks per design and stratum (`experiments/blocks.json`);
`exploit` samples the posterior reward of a stratum whose objective has an estimator (`apiUsd`) with
a `minExplore` floor per arm, and the blocks otherwise; `off` assigns nothing, so every lever keeps
its extension's own setting. `meter-report --arms --posterior` (on demand only; no timer, so the
kill switch acts only when it is run) writes the posterior = −API-eq $/active hour per arm and the
`disabled` arms into `experiments/state.json`, per design and stratum; guards: verdict acceptance
below baseline by more than `threshold` (only where the router's outcome log carries verdicts), plus
peeks/corrections per session above baseline and a mean rating lower by more than
`ratingThreshold` (after ≥ `minSessions` units each). Disabled arms are sticky.

**Reading an experiment.** The primary table is the **intention to treat**: the assigned level
decides the arm whatever the session did (a model switch, a refused level), effect = ratio of sums
(high ÷ low − 1) per stratum with a bootstrap CI and a minimum detectable effect; no interaction
model, effects are marginal and unadjusted. The **per-protocol** table keeps the units whose every
factor lever was read back `confirmed` in the session's last levers line: a non-randomized
comparison, labelled as such. The **refusal rate** per factor is the share of units whose lever was
`refused`; above 0.20 the factor's add-on is flagged as broken. A **sensitivity** row repeats the
effect over the requests of the root's first billing class (model-switch contamination), and
context overflows per active hour are counted per arm. Earlier designs (v1–v4: five or six factors,
three since the fold hint and the router's levers left) keep their rows and are analysed apart
(`design` in `assignments.jsonl`, never pooled).

## Levers, add-ons and read-back

A **lever** is a value that changes what a session costs: a pi setting (`pi.cacheWarming`,
`pi.compaction.*`, `pi.retry.*`, `pi.codemode.*`, `pi.transport`, `pi.thinkingBudgets.*`,
`pi.defaultTools.<tool>`, …), an extension's control (`cache-lifecycle.mainCacheTtl`,
`infinite-context.nudgeAtTokens`) or pi-economics' own. The meter writes one `levers` line per
session at its first prompt (and a new one when a state changes): per lever the effective value
`v`, its **source** `s` (`pe`: pi-economics assigned it; `ext`: an extension chose it, its default or
its own experiment; `fixed`: configuration or pi's default), and, where pi-economics assigned a
level, `a` (the assigned level), `rb` (the read-back) and `tier`. The levers table of the report
shows per lever the values the period ran with, the sources and the refusal rate. A lever pi-economics
cannot observe is listed as not observable with the reason, not left out.

An **add-on** (`packages/experiments/addons/<target>.ts`) is the only code that knows how to set a
lever and how to see it set. It applies a level before the target reads it, then reads back what the
session ended up with, at the first prompt: `confirmed` (the effective value is the assigned one),
`refused` (it is another: pi clamped it, an extension redrew it, a project setting overrode it; the
source says who) or `unverified` (nothing can tell: the state is the assignment, assumed). pi-economics'
assignment wins over an extension's own experiment, but a refusal is recorded, never counted as applied.
The tiers, in order of preference:

| Tier | How the level gets in | Read-back |
|---|---|---|
| `seed` | the add-on writes the target's own durable input before the target reads it (infinite-context's settings record on the session branch; any extension's recorded custom entry through `session-entry(<customType>,<field>)`) | the target's own record afterwards; a seed is no evidence, so the factor names a `target` (a tool or command pi lists) and `confirmed` needs the target loaded and its latest record holding the level, else `unverified` |
| `control` | pi's session API: `pi.thinkingLevel` (`off` … `xhigh`), `pi.activeTool(<name>)` (`false`, `true`); main sessions only (a child's level and tools are the actor's) | the matching getter at the first prompt; on a resumed session pi restores the level first, so the engine only reads it back |
| `replace` | cache-lifecycle applies the level itself (`warmPolicy`, `mainCacheTtl`, `maskOnCold`); a lever starts once cache-lifecycle asked the channel | `mainCacheTtl` from the usage's `cacheWrite1h`; the other two have no observer (`unverified`) |
| `shadow` | wrapping a target's own hook: none ships | — |

The online catalogue is `packages/experiments/addons/catalogue.json`: the cache-lifecycle levers,
`pi.thinkingLevel`, `infinite-context.nudgeAtTokens` and the two data-only kinds `pi.activeTool(<name>)`
and `session-entry(<customType>,<field>)`; the module refuses a factor on anything else, so a
factor never randomizes nothing. `infinite-context.nudgeAtTokens` without a factor on it is still
recorded: `ext` when the extension drew the limit from its rule's range (its own experiment),
`fixed` for a number the configuration set.

### Bench factors

The bench is the offline arm of the experiments, for what a live session cannot vary (spec §5.6.5):
the orchestrator factors `routing`, `delegation`, `t0Widened` as the 2³⁻¹ half fraction, arms
`orch----`, `orch-+-+`, `orch--++`, `orch-++-` — all `--mode rpc`, Opus 5.5 at `high`, with a
per-run agent dir (`runs/<run>/agent/`) so meter/outcome logs of the run are kept and credentials
are linked, never copied. See `packages/bench/README.md`.

### Bench process levers

A few pi settings cannot change per session in a live pi (compaction runs on the process's settings),
so only the bench varies them: a factor named `pi.compaction.enabled`, `pi.compaction.reserveTokens`
or `pi.compaction.keepRecentTokens` in a bench arm's `factors` is written into the run's agent dir
`settings.json`. Infinite-context cancels every native compaction, so such an arm loads none (and
`experiments`, which adopts the bench's `experiments/assignment.json` instead of drawing). The levers
line of the run then reads `pe`/`confirmed` once pi's effective settings (a trusted project's over the
global file, `compaction.modelOverrides`, pi's default when unset) show the level, `refused` when they do
not. `bench-report` shows compactions, context overflows, active minutes, meter cost and the levers
per arm; see `packages/bench/README.md`. These three are not in the online catalogue.

## Load order

pi-economics' components must start before every other extension that is not built in, in a main
session and in a child: the experiments engine seeds levers before their targets read them. The Nix
route links each component outside pi's auto-discovered directory (`<agentDir>/pi-economics/extensions`)
and `piSettings` puts the links at the front of `settings.json`'s `extensions` (op `ensurePrefix`):
`experiments`, `token-meter`, `cache-lifecycle`, `infinite-context`, then the registry's other
entries by name; the children get the same order. A trusted project's extensions and `pi -e` still
start first. With `piSettings.enable = false` nothing lists them: put
`programs.piEconomics.loadOrder` at the front of `extensions` yourself (a warning says so). The
package route (`pi install`) cannot reorder: move its entry first in `packages`. The check `load-order`
runs real pi 1.4 offline over the home-file layout, two installed packages and a listed entry, a child
and a model switch.

## Quota waits

A wait for a quota reset (a session that pauses until the window opens and resumes) is not pi-economics'
to do: it is the quota waiter's, its own extension in its own repository, provided through pi-setup.
Metering the waiter's events (wait time as a Budget row, `kind: "quota-wait"` lines) is a later
addition that ships after 0.3.0; until then a wait shows only as `429` error lines and the gap between
requests. The Budget reads the 429 requests and retry waits it can see.

## Running the reports and the bench

**pi-analyse** (installed by Home Manager from the token-meter package; spec
§5.7; the skill `pi-token-economics-analysis` runs it when the user asks to
"analyse meter"):

```sh
pi-analyse [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--agent-dir DIR] [--out DIR]
           # → <agentDir>/reports/<YYYY-MM-DD>-<HHMM>-analysis.md + .json (UTC): Budget (quota windows, calibration, spend by billing class, local cost), Fleet, Cache, Levers (value, source and refusal rate per lever), Experiments (per stratum: intention to treat, per-protocol, refusal rate; v1–v4 apart), Router (observed: per profile × tier, randomized comparison, spot checks), Guards, Data quality
pi-analyse --check   # data contract only: exit 1 and name every required field missing in the period's lines
pi-analyse --apply   # as the full run + write the kill switch's disabled arms to experiments/state.json (only after the user agreed)
```

**meter-report** (installed by Home Manager from the token-meter package):

```sh
meter-report [--from YYYY-MM-DD] [--to YYYY-MM-DD]   # spend per day/session/model, cache miss share, quota regression
meter-report --arms                                  # per-arm table (per design and stratum): objective per active hour (bootstrap CI), cold resumes, folds, acceptance, peeks/s, corr/s, rating, kill-switch reasons
meter-report --arms --posterior [--agent-dir DIR]    # as above + write experiments/state.json (posterior, disabled) atomically
```

It reads `<agentDir>/meter/*.jsonl`, `<agentDir>/task-router/outcomes/`,
`<agentDir>/experiments/{settings,assignments,state}.json`,
`<agentDir>/token-meter/settings.json` (plans, currency rates) and
`<agentDir>/guards/events.jsonl`. Run it by hand (no timer, user decision
2026-10-03); the exploit mode and kill switch read what it writes.

**pi-bench** (`packages/bench`, data dir `~/.pi/agent/bench` = `PI_BENCH_DATA`,
work dir `$XDG_RUNTIME_DIR/pi/tmp/bench` = `PI_BENCH_WORK`, tmpfs):

```sh
pi-bench run TASK ARM [REP]            # checkout baseline → agent → harness check → runs/TASK.ARM.REP/
pi-bench sched ARM N TASK…             # each task once, N in parallel
pi-bench refs                          # refs/<id>.patch (accepted solution) / .md (scout reference answers)
pi-bench judge --all [--judges opus,gpt] [--arms a,b] [--parallel N] [--min-runs M]
                                       # multi-arm: blind absolute rubric verdict per run of each task with ≥ 2 runs; idempotent; failing check caps pass at partial
pi-bench judge TASK opus|gpt [X Y]     # pairwise blind A/B of two runs (2-arm comparisons)
pi-bench metrics                       # per-run session metrics (requests, retried 429s, cost, peak context, folds, children)
bench-report [--factors arm,kind]      # per-factor bootstrap CI (10 000 resamples), OLS with two-way interactions, judge κ → reports/*.md
```

**Full factor run** (the author's wrapper script is not shipped): all four
factor arms × all tasks × 1 rep with `pi-bench sched ARM PARALLEL TASK…`, one
arm after the other, watching the quota readings
of the meter yourself. Afterwards: `pi-bench judge --all`, then
`bench-report --factors routing,delegation,t0Widened`.

## Known limits

- **Quota readings are account-wide** and in 1 % steps; other clients and tools
  raise them too, so no session or arm is charged quota points, and the per-active-hour
  quota rows are attributions over many sessions, with no CI. The calibration
  needs 8 complete windows and its flags are for the owner to read.
- **Guard signals are coarse**: `peek-after-mask` counts any `context_peek` on a
  session that has masks (the peek target is a fold id that cannot be mapped to
  a mask id from a hook); the idle-gap outcome metric is not computed (it needs
  the user's return).
- **Experiments**: only main sessions get assignment rows; a child's runtime
  derives its root's arm (the session file's `subagents/<root>/` directory, or
  the actor's agent list for an in-memory child), so a **resumed child** runs
  it too. A model switch inside a session changes nothing (intention to treat; the
  sensitivity row counts it). `explore` balances over the stratum's permuted blocks; in
  `exploit` an arm with < 2 units is treated as mean 0 (optimistic, tried first). The
  per-protocol table is self-selected and descriptive.
- **Local timing**: `durationMs` includes server-side queueing whenever local requests
  overlap (the Budget's machine hours are the union, the experiment's per-unit cost the
  sum, the queue share shows the gap); a provider that does not send llama.cpp's
  `timings` has no tokens-per-second or prefix-reuse figure from the server.
- **Masking is request-local**: it rewrites the outgoing wire, not the stored
  transcript — `context_map` still lists originals and previews; recovery is
  `context_peek`.
- **Retries** are pi's native ones (`retry.*` in its settings; the meter counts the
  resends per request); the former `retry` component (a patched retry extension for
  OpenRouter's free tier) left with that tier. The bench runs use pi's native retry
  (100 × 2 s) via a per-run `.pi/settings.json`.
- **Patches are local and version-locked**: all third-party changes ride on the
  pinned input revs; an input bump re-applies the patches and the patch
  checks fail loudly on drift. Two upstream issue drafts are written, not
  filed: pi 1.0.0's `CacheWarmer` identity check dies on custom messages (still
  so in pi 1.4.0, check `identity-shim-probe`), and
  `sendCustomMessage(triggerTurn)` skips the prompt/loadout path.
- **Bench**: quality evidence comes from two blind judges (Opus 5.5 high,
  GPT-5.6-sol high) against a reference diff, plus the user calibration set;
  the orchestrator is Opus-only, and the per-run agent dirs do not share
  a lock that a login extension keeps in the agent dir, so start a batch
  with a fresh login and keep parallelism small.
