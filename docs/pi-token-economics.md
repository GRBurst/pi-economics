# pi token economics

Subsystem that lowers the Claude quota and API-equivalent $ pi burns per unit of
completed work, and measures every lever on the user's own work. Comments in
the source cite the design record (`spec §n`), kept with the author's system
configuration; the options are in `docs/pi-economics.md`. Where this document and the code disagree, the code
wins.

## Components

Paths are relative to this repository's root, unless noted.

| Component | What it is | Loaded in |
|---|---|---|
| `packages/token-meter/` (`pi-token-meter`) | One JSONL line per provider request (tokens, cost, quota headers, retries) into `<agentDir>/meter/YYYY-MM.jsonl`; no prompt/response text. Also the `meter-report` and `pi-analyse` binaries and the log manual `LOGS.md` (linked to `~/.pi/agent/LOGS.md`). | main + children |
| [pi-task-router](https://github.com/GRBurst/pi-task-router) (its own flake, `programs.piTaskRouter`; not in this repository) | Routes `spawn_subagent` calls by task card, with its local mode; what it does is in its `docs/task-router.md`. pi-economics observes it through its outcome log; its levers are no experiment factors since design v4. | main only |
| `packages/cache-lifecycle/` (`pi-cache-lifecycle`) | Warming decision (main with running children, child awaiting a reply → warm; capped), elision of stale tool results/thinking after cache expiry, optional 1 h cache TTL for main, the pi-1.0.0 message-identity shim that keeps cache warming alive past custom messages, `peek-after-mask` guard log. | main + children |
| `packages/experiments/` (`pi-experiments`) | One fractional-factorial arm per main session (explore/exploit/off); children inherit; other extensions read factor flags through `__piExperimentsApi_v1.flag(name, default)`; correction guard log and `/rate 1-5`. | main only |
| `packages/actor-subagents/package.nix` + 3 patches in `patches/pi-actor-subagents/` of [pi-setup](https://github.com/GRBurst/pi-setup) (`programs.pi.actorSubagents`) | `child-prompt` (children keep preamble/tools/rules), `spawn-policy` (`__subagentsApi_v1`: `registerSpawnPolicy`, `subscribe`, `retune`, `send`, `list`, `task` param, neutral wording, richer `list_subagents`, transient-error notice gate, profile tool guard). The former `first-turn` patch was dropped: since pi 1.2.0 an extension-triggered run (`sendCustomMessage` with `triggerTurn`) runs `before_agent_start` and the loadout itself. | main + children |
| `packages/infinite-context/package.nix` + 1 patch in `patches/pi-infinite-context/` | Pinned input `inputs.pi-infinite-context` (rev `494df9d`) with `reminders`: upstream's `settings.json` gains `overrides`, rules keyed by provider or exact `provider/modelId` with upstream's `nudgeAtTokens` (a number or a range `[min, max]`) and `nudgeAtPercent`; each field resolves exact model, then provider, then the top level, then upstream's 150k / 75 %. The session follows its current model; a switch to a rule with another range draws and records a new limit. Upstream's step (15k, less near the window) and fail-open parsing stay. The former `cache` patch (cost-aware fold hint, `fold_timing`, re-sync, handoff) was dropped: upstream re-syncs a snapshot and stops once when folds cannot be applied, and declined the fold hint. The former `foreign-messages` patch was dropped: upstream e6ff6803 aligns the projection as an ordered subsequence (it drops every foreign message after a folded member, where the patch dropped only toolResults of folded calls). | main + children |
| `modules/common.nix` (`piSettings`) | Idempotent migration of the mutable `~/.pi/agent/settings.json`: sets `cacheWarming: "idle"` when `programs.piEconomics.cacheLifecycle` is enabled. | — |
| `packages/bench/` | Bench harness: replay of the user's own past tasks, single-agent and orchestrator (RPC) drivers, blind A/B and per-run judging, factor-effect report. Data and runs live in `<agentDir>/bench`, not in the repo. | tool |

Selection is single-sourced in the registry (`programs.piEconomics.extensions`,
`forChildren`): children get infinite-context,
token-meter, cache-lifecycle (a host adds its own, such as a provider login); task-router and experiments are main
only. `module-eval` pins the child-extension set and each package has its check


## Files under `~/.pi/agent` (`<agentDir>`)

Every field, type, join key and schema version: `~/.pi/agent/LOGS.md`
(shipped as `packages/token-meter/LOGS.md`). Every line written by the meter,
the outcome log, the guard writers and the assignments carries `v` (schema
version, integer, 1 since 2026-10-03; absent = 0, legacy).

| Path | Contents |
|---|---|
| `meter/YYYY-MM.jsonl` | Meter lines: `ts, sessionId, parentSessionId, arm, provider, model, effort, kind (turn\|warming), input, cacheRead, cacheWrite, output, reasoning, costUsd, status (code or "error"), retries, retryWaitMs, q5h, q5hReset, q7d, q7dReset, overage, claim, fallback, rawRatelimit?`. OpenRouter 429s surface only in `message_end`, so errors are logged there as `status:"error"` with `errorClass`. |
| `task-router/outcomes/YYYY-MM.jsonl`, `task-router/member-count.json` | The router's files, written by the [pi-task-router](https://github.com/GRBurst/pi-task-router) package; the outcome schema is its `docs/outcome-log.md`. The meter observes them: `packages/token-meter/LOGS.md` keeps the reader side. |
| `guards/events.jsonl` | Guard events, shared one-line format `{ts, sessionId, arm, event, value?}`: `peek-after-mask` (cache-lifecycle), `correction` and `rating` (experiments). Never prompt text, never tool arguments. |
| `experiments/assignments.jsonl` | One row per main session `{ts, sessionId, arm, design, mode, flags}`; `design` is `"v4"` (three factors, 3-char arm ids); earlier rows say `"v2"` or `"v3"` (six factors, 6-char ids) or nothing (v1: five factors, 5-char ids). Sticky (a session keeps its arm and design, a resumed older session too). |
| `experiments/state.json` | `posterior` (per-arm reward ± sd) and `disabled` arms with reasons; written atomically by `meter-report --posterior`, run by hand (no timer). |
| `reports/YYYY-MM-DD-HHMM-analysis.{md,json}` | Written by `pi-analyse` (on demand; UTC time of the run, so runs of one day keep their reports). |
| `LOGS.md` | Log manual (Home Manager link into the token-meter package). |
| `experiments/settings.json` | Written by Home Manager from `programs.piEconomics.experiments.settings` whenever experiments is enabled (`{"mode": "explore"}` for `{}`): the extension's opt-in; without the file experiments is inert (no arm, no assignments.jsonl). |
| `{token-meter,cache-lifecycle}/settings.json` | Same: written only when the corresponding `programs.piEconomics.<x>.settings` is non-empty (`task-router/settings.json`: pi-task-router's module). Every key has a code default, so a missing file means "defaults". |
| `bench/` | `tasks.json` + `tasks/<id>/` (meta.json, users.md, ref_answer.md, extra files), `refs/` (`pi-bench refs`), `runs/<id>.<arm>.<rep>/` (result.json, prompt.md, final.md, diff.patch, check.log, session/, events.jsonl, and `agent/` for factor arms), `judge/`, `reports/`, `pilot/`, `smoke/`, `src/` (task generator), `run-h6.sh`. |

## Settings and defaults

Nix options, per component: `programs.piEconomics.{tokenMeter,cacheLifecycle,experiments}.{enable, package, settings}` (cache-lifecycle's and experiments' `settings` and the others' are described in `docs/pi-economics.md`; the router's are pi-task-router's `programs.piTaskRouter`). The registry (`programs.piEconomics.extensions`) selects the packages and links them, so the link and the selection never disagree.

Code defaults (a settings file only overrides; unknown keys are ignored):

- **token-meter** — `enabled: true`, `dir: "meter"`, `rawRatelimit: true`.
- **task-router** — not this repository's: its code defaults, the legacy-key map
  and the routing limits are in pi-task-router's `docs/task-router.md`.
- **cache-lifecycle** — `warmPolicy: "orchestrator-aware"` (vs `native`),
  `mainCacheTtl: "5m"` (vs `"1h"`), `maskOnCold: "off"` (vs `"tools"`,
  `"tools+thinking"`), `protectedTailTokens: 20000`, `identityShim: true`.
- **experiments** — `mode: "explore"`; the three online factors below
  (values[0] = today's behaviour, so the all-low arm is the baseline);
  `maxArms: 16`; `minExplore: 0.1`; `baseline: "---"`;
  `guards {minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5}`;
  `correctionRegex \b(no|wrong|revert|undo|that's not)\b` (case-insensitive).
- **Migration** — `cacheWarming: "idle"` is ensured by
  `pi-settings-migrate` (its `idle` flag, the piSettings op `cacheLifecycle`) in
  an existing `settings.json` when cache-lifecycle is enabled —
  pi's default `"streaming"` never fires `cache_warming_decision`.
- **infinite-context** — `programs.piEconomics.infiniteContext.reminders`:
  `default` and `overrides` (per provider or model) with `nudgeAtTokens` (a
  number or a range) and `nudgeAtPercent`, e.g. 400k for the two 1M-window
  anthropic models.

## Experiment factors and modes

Online (spec §5.6), assigned per main session by the `experiments` extension:

| Factor | Values | Consumed by |
|---|---|---|
| `warmPolicy` | `native`, `orchestrator-aware` | cache-lifecycle |
| `mainCacheTtl` | `5m`, `1h` | cache-lifecycle |
| `maskOnCold` | `off`, `on` (= own level, or `tools+thinking` when own is off) | cache-lifecycle |

Design v4: 2³ ≤ `maxArms` 16 → the full factorial (8 arms, every main effect
and interaction estimable). Earlier designs had more factors: v1 five
(`warmPolicy`, `mainCacheTtl`, `foldHint`, `maskOnCold`, `freshOnCold`; the
2⁵⁻¹ half fraction, 5-char ids), v2 and v3 six (v1 plus `delegationRule`; the
2⁶⁻² fraction, 16 arms, resolution IV; v3 changed what `foldHint` =
`cache-aware` meant). `foldHint` went with infinite-context's fold hint;
`freshOnCold` and `delegationRule` are the task router's levers. Old
sessions keep their arms and are told apart by `design` in
`assignments.jsonl` (analysis never pools designs).
Arm ids are sign strings (`+` = values[1]); the meter and outcome lines carry
`arm`. Modes: `explore` (balanced over the min-count arms), `exploit` (Thompson
sampling on the posterior reward with a `minExplore` floor per arm), `off`
(baseline arm only). `meter-report --posterior` (on demand only; no timer, so
the kill switch acts only when it is run) writes per-arm
`posterior` = −$/active hour (a reward, higher is better) and
`disabled` arms into `experiments/state.json`; kill-switch guards: verdict
acceptance below baseline by more than `threshold`, plus peeks/corrections per
session above baseline by more than their thresholds and mean rating lower by
more than `ratingThreshold` (after ≥ `minSessions` units each). Disabled arms
are sticky.

Bench (quality side, spec §5.6.5): factors `routing`, `delegation`,
`t0Widened` as the 2³⁻¹ half fraction, arms `orch----`, `orch-+-+`,
`orch--++`, `orch-++-` — all `--mode rpc`, Opus 5.5 at `high`, with a
per-run agent dir (`runs/<run>/agent/`) so meter/outcome logs of the run are
kept and credentials are linked, never copied. See `packages/bench/README.md`.

## Running the reports and the bench

**pi-analyse** (installed by Home Manager from the token-meter package; spec
§5.7; the skill `pi-token-economics-analysis` runs it when the user asks to
"analyse meter"):

```sh
pi-analyse [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--agent-dir DIR] [--out DIR]
           # → <agentDir>/reports/<YYYY-MM-DD>-<HHMM>-analysis.md + .json (UTC): cost, experiment (v1/v2 apart), delegation & routing (per profile × tier, randomized comparison, spot checks), guards, data quality
pi-analyse --check   # data contract only: exit 1 and name every required field missing in the period's lines
pi-analyse --apply   # as the full run + write the kill switch's disabled arms to experiments/state.json (only after the user agreed)
```

**meter-report** (installed by Home Manager from the token-meter package):

```sh
meter-report [--from YYYY-MM-DD] [--to YYYY-MM-DD]   # spend per day/session/model, cache miss share, quota regression
meter-report --arms                                  # per-arm table: $/active hour (bootstrap CI), cold resumes, folds, acceptance, $/accepted task, q5h/q7d %/h, peeks/s, corr/s, rating, kill-switch reasons
meter-report --arms --posterior [--agent-dir DIR]    # as above + write experiments/state.json (posterior, disabled) atomically
```

It reads `<agentDir>/meter/*.jsonl`, `<agentDir>/task-router/outcomes/`,
`<agentDir>/experiments/{settings,assignments,state}.json` and
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
  raise them too, so read `q5h/q7d %/h` only as ratios of sums over many
  sessions, and no CI is computed for them.
- **Guard signals are coarse**: `peek-after-mask` counts any `context_peek` on a
  session that has masks (the peek target is a fold id that cannot be mapped to
  a mask id from a hook); the idle-gap outcome metric is not computed (it needs
  the user's return).
- **Experiments**: only main sessions get assignment rows; children inherit.
  `explore` balances over all-time counts; in `exploit` an arm with < 2 units
  is treated as mean 0 (optimistic, tried first). Children inherit only on the spawn event: a
  **resumed child** session has no arm (seen live 2026-10-03; `pi-analyse
  --check` names its lines).
- **Masking is request-local**: it rewrites the outgoing wire, not the stored
  transcript — `context_map` still lists originals and previews; recovery is
  `context_peek`.
- **Retries** are pi's native ones (`retry.*` in its settings); the former
  `retry` component (a patched retry extension for OpenRouter's free tier)
  left with that tier. The bench runs use pi's native retry (100 × 2 s) via a
  per-run `.pi/settings.json`.
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
