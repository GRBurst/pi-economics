# pi token economics

Subsystem that lowers the Claude quota and API-equivalent $ pi burns per unit of
completed work, and measures every lever on the user's own work. Design: this
repository's `docs/specs/2026-10-12-pi-economics-design.md`; the options are in
`docs/pi-economics.md`. Where this document and the code disagree, the code
wins.

## Components

Paths are relative to this repository's root, unless noted.

| Component | What it is | Loaded in |
|---|---|---|
| `packages/token-meter/` (`pi-token-meter`) | One JSONL line per provider request (tokens, cost, quota headers, retries) into `<agentDir>/meter/YYYY-MM.jsonl`; no prompt/response text. Also the `meter-report` and `pi-analyse` binaries and the log manual `LOGS.md` (linked to `~/.pi/agent/LOGS.md`). | main + children |
| `packages/task-router/` (`pi-task-router`) | Routes `spawn_subagent` calls by task card: a required ability and level by rule, legs from the importance tables, the cheapest free member that meets a leg (cost order, slots, health probes, daily caps, a queue wait), failover of an erroring child to another provider, attempts (a re-spawn goes one level above the member the failed task ran on), verify gate, runaway/context/effort guards, delegation nudge, fresh-on-cold, outcome log, `task_verdict` tool, system-prompt card section. | main only |
| `packages/cache-lifecycle/` (`pi-cache-lifecycle`) | Warming decision (main with running children, child awaiting a reply → warm; capped), elision of stale tool results/thinking after cache expiry, optional 1 h cache TTL for main, the pi-1.0.0 message-identity shim that keeps cache warming alive past custom messages, `peek-after-mask` guard log. | main + children |
| `packages/experiments/` (`pi-experiments`) | One fractional-factorial arm per main session (explore/exploit/off); children inherit; other extensions read factor flags through `__piExperimentsApi_v1.flag(name, default)`; correction guard log and `/rate 1-5`. | main only |
| `packages/retry/package.nix` + `patches/pi-retry/pi-retry-free-cap.patch` | Pinned input `inputs.pi-retry` (rev `60a3b08`, 0.11.3) with a local patch: the OpenRouter free-tier daily cap is not retried (it lasts until 00:00 UTC). Print/json mode retries inline upstream since 0.11.0 (it was the local `pi-retry-print-mode.patch` until the 2026-10-25 lock update), so `pi -p` retries 429s. Upstream vitest suite on the patched source = flake check `pi-retry`. | main + children (linked child extension) |
| `packages/actor-subagents/package.nix` + 2 patches in `patches/pi-actor-subagents/` | `child-prompt` (children keep preamble/tools/rules), `spawn-policy` (`__subagentsApi_v1`: `registerSpawnPolicy`, `subscribe`, `retune`, `send`, `list`, `task` param, neutral wording, richer `list_subagents`, transient-error notice gate, profile tool guard). The former `first-turn` patch was dropped: since pi 1.2.0 an extension-triggered run (`sendCustomMessage` with `triggerTurn`) runs `before_agent_start` and the loadout itself. | main + children |
| `packages/infinite-context/package.nix` + 2 patches in `patches/pi-infinite-context/` | `reminders` (absolute fold-reminder thresholds), `cache` (cost-aware fold hint — "pays off after ≈ N more turns", "cache is cold: folding is free now" — plus re-sync on unknown entries and abort-with-handoff instead of sending a raw transcript when folds cannot be applied). Both extend upstream's `settings.ts`/`nudge.ts` (same `settings.json`; upstream's 150k/15k nudge defaults removed so the schedule stays as before). The former `foreign-messages` patch was dropped: upstream e6ff6803 aligns the projection as an ordered subsequence (it drops every foreign message after a folded member, where the patch dropped only toolResults of folded calls). | main + children |
| `modules/common.nix` (`piSettings`) | Idempotent migration of the mutable `~/.pi/agent/settings.json`: removes the pi-retry runtime package entry, ensures the child retry regex, sets `cacheWarming: "idle"` when `programs.piEconomics.cacheLifecycle` is enabled. | — |
| `packages/bench/` | Bench harness: replay of the user's own past tasks, single-agent and orchestrator (RPC) drivers, blind A/B and per-run judging, factor-effect report. Data and runs live in `<agentDir>/bench`, not in the repo. | tool |

Selection is single-sourced in the registry (`programs.piEconomics.extensions`,
`forChildren`): children get infinite-context, pi-retry,
token-meter, cache-lifecycle (a host adds claude-auth, web-search); task-router and experiments are main
only. `module-eval` pins the child-extension set and each package has its check


## Files under `~/.pi/agent` (`<agentDir>`)

Every field, type, join key and schema version: `~/.pi/agent/LOGS.md`
(shipped as `packages/token-meter/LOGS.md`). Every line written by the meter,
the outcome log, the guard writers and the assignments carries `v` (schema
version, integer, 1 since 2026-10-03; absent = 0, legacy).

| Path | Contents |
|---|---|
| `meter/YYYY-MM.jsonl` | Meter lines: `ts, sessionId, parentSessionId, arm, provider, model, effort, kind (turn\|warming), input, cacheRead, cacheWrite, output, reasoning, costUsd, status (code or "error"), retries, retryWaitMs, q5h, q5hReset, q7d, q7dReset, overage, claim, fallback, rawRatelimit?`. OpenRouter 429s surface only in `message_end`, so errors are logged there as `status:"error"` with `errorClass`. |
| `task-router/outcomes/YYYY-MM.jsonl` | `spawn` (taskId, card hash, route + reasons, the plan's ability, level and legs, the member and model it started on with its effort and wait, importance, arm, child sessionId), `reroute` (with both models), `check` (exit, duration), `corrective`, `escalate` (from the member the failed task ran on, with models and levels), `verdict`; kill without verdict → `unjudged`. Unrouted spawns (routing off) are logged too. |
| `task-router/member-count.json` | Requests per UTC day of each member with a `dailyCap` (`{"<day>": {"<member>": n}}`; an account cap is shared with the user's own sessions, so this is a lower bound; the provider's cap error is authoritative). |
| `guards/events.jsonl` | Guard events, shared one-line format `{ts, sessionId, arm, event, value?}`: `peek-after-mask` (cache-lifecycle), `correction` and `rating` (experiments). Never prompt text, never tool arguments. |
| `experiments/assignments.jsonl` | One row per main session `{ts, sessionId, arm, design, mode, flags}`; `design` is `"v2"` (six factors, 6-char arm ids); a line without it is v1 (five factors, 5-char ids). Sticky (a session keeps its arm, a resumed v1 session too). |
| `experiments/state.json` | `posterior` (per-arm reward ± sd) and `disabled` arms with reasons; written atomically by `meter-report --posterior`, run by hand (no timer). |
| `reports/YYYY-MM-DD-HHMM-analysis.{md,json}` | Written by `pi-analyse` (on demand; UTC time of the run, so runs of one day keep their reports). |
| `LOGS.md` | Log manual (Home Manager link into the token-meter package). |
| `experiments/settings.json` | Written by Home Manager from `programs.piEconomics.experiments.settings` when non-empty. |
| `{token-meter,task-router,cache-lifecycle}/settings.json` | Same: written only when the corresponding `programs.piEconomics.<x>.settings` is non-empty. Every key has a code default, so a missing file means "defaults". |
| `bench/` | `tasks.json` + `tasks/<id>/` (meta.json, users.md, ref_answer.md, extra files), `refs/` (`pi-bench refs`), `runs/<id>.<arm>.<rep>/` (result.json, prompt.md, final.md, diff.patch, check.log, session/, events.jsonl, and `agent/` for factor arms), `judge/`, `reports/`, `pilot/`, `smoke/`, `src/` (task generator), `run-h6.sh`. |

## Settings and defaults

Nix options, per component: `programs.piEconomics.{tokenMeter,taskRouter,cacheLifecycle,experiments}.{enable, package, settings}` (the router's, cache-lifecycle's and experiments' `settings` and the others' are described in `docs/pi-economics.md`). The registry (`programs.piEconomics.extensions`) selects the packages and links them, so the link and the selection never disagree.

Code defaults (a settings file only overrides; unknown keys are ignored):

- **token-meter** — `enabled: true`, `dir: "meter"`, `rawRatelimit: true`.
- **task-router** — `t0Limits {files: 10, tokens: 150000}` (pilot-derived);
  `models`, five members, each with its model, a tier label, a route, its
  `abilities` (a level per ability, `write` and `read`), an effort ladder, a
  context window, a cost and an order (cheapest first, then order), and
  `slots`, `health` and `dailyCap` where they apply: `qwen-local`
  (`llama/qwen3.8`, write 0, read 0, `xhigh`, 262144 tokens, cost 0, 1 slot,
  health `http://<host>:11545`), `qwen-cloud` (the free cloud slot, empty: a
  file that sets its model makes it an ordinary member after local, `order: 1`,
  2 slots, `dailyCap: 950`), `haiku` (Haiku 5.5, write 0, read 1,
  `medium`/`high`, 1M, cost 1), `sonnet` (Sonnet 5.5, write 1, read 2,
  `high`/`xhigh`, 1M, cost 3), `opus` (Opus 5.5, write 2, read 3,
  `high`/`xhigh`, 1M, cost 5); `models.<member>` merges field by field over
  the default member, `model: ""` removes it;
  `importanceTable {write, read, review}`: per level of the ability a cell per
  importance (normal, high, critical), a worker leg (level, effort step) and
  an optional review leg; read row 2 at critical is Sonnet xhigh without a
  review (`scout`, `lookup`), the `review` table keeps Opus xhigh there; a
  cell that is given replaces the default cell;
  `readOnlyReview: "effort-step"` (a read-only profile at critical raises its
  worker one effort step on the same model, else to the next member up,
  instead of a review leg; where nothing can rise the review stays;
  `"review"` keeps the review leg); `contextFit: 1` (a member whose window
  cannot hold the card's files is no candidate; when no member that meets the
  level holds them, the largest windows, with a context reason; never a
  rejection; `0` turns the filter off); `queueMaxSec: 120` (a busy cheapest
  pool is waited for this long before the next member; an explicit model
  waits for its own member, then the spawn is rejected);
  `checkTimeoutSec: 900`; `runaway {requests: 150, usd: 10}`; `contextGuard: 0.5`;
  `freshOnCold {mode: "advise", minTokens: 150000}`; `maxBurstTurns: 1`;
  risk globs/keywords and per-category `t2Keywords` (defaults conservative);
  `profiles {}` over the built-ins (scout read 2, read-only, answer; lookup,
  the narrow scout, read 2 like scout until the scout gate sets its level;
  mechanical/implement all-tools; debug-design `minLevel 1` +
  systematic-debugging; review read 2 on the `review` table, read-only +
  code-reviewer; plan the top level, read-only+files +
  tdd-implementation-planner); `randomize` and `spotCheck`
  `enabled: false`;
  `delegation {nudge: "on", afterCalls: 6, tools: [edit, write, bash, grep, find, read], rule: "off"}`
  (`rule: "on"` opens the main session's Task cards section with the orchestrator rule; flag `delegationRule`);
  flags `routing / verifyGate / autoEscalate: true`.
  **Rollback:** `packages/task-router/test/fixtures/today-config.json` as the
  settings restores the routing before these defaults (the free cloud model
  at `order: -1`, Haiku removed, read row 2 critical on Opus,
  `readOnlyReview: "review"`, `contextFit: 0`); `router-golden` records its
  decisions as the fixture `today`. **Legacy keys** are mapped, each with a
  problem: `models.{qwenLocal,qwenCloud,T1,T2}` to `models.<member>.model`,
  `localHealthUrl` to `models.qwen-local.health`, `cloudDailyCap` to
  `models.qwen-cloud.dailyCap`, `contextWindow.{qwen,T1,T2}` to the members'
  `contextWindow`, a profile's `tier`/`minTier` to `level`/`minLevel` (the
  lowest level of the members with that tier label; dropped when no enabled
  member has it). Where the new key is set too it wins (`legacy key …
  ignored: … is set`). Settings problems (legacy keys, invalid members,
  tables or profiles, each falling back to its default or dropped) go to the
  console and, once per process, to a `ui.notify` (`task-router settings: …`)
  in the main session.
- **cache-lifecycle** — `warmPolicy: "orchestrator-aware"` (vs `native`),
  `mainCacheTtl: "5m"` (vs `"1h"`), `maskOnCold: "off"` (vs `"tools"`,
  `"tools+thinking"`), `protectedTailTokens: 20000`, `identityShim: true`.
- **experiments** — `mode: "explore"`; the six online factors below
  (values[0] = today's behaviour, so the all-low arm is the baseline);
  `maxArms: 16`; `minExplore: 0.1`; `baseline: "------"`;
  `guards {minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5}`;
  `correctionRegex \b(no|wrong|revert|undo|that's not)\b` (case-insensitive).
- **Seed/migration** — `defaultThinkingLevel: "high"` in the settings seed
  (`piSettings`); `cacheWarming: "idle"` in the seed and ensured by
  `pi-settings-migrate` (its `idle` flag) when cache-lifecycle is enabled —
  pi's default `"streaming"` never fires `cache_warming_decision`;
  the pi-retry runtime package entry is removed and the rule
  `{"pattern": "^You were spawned by \"", "flags": "m"}` is ensured exactly once
  in `piRetry.subagents.match.systemPromptRegex`.
- **infinite-context** — `programs.piEconomics.infiniteContext.reminders`: absolute
  reminder overrides (400k start / 100k every for the two 1M-window anthropic
  models), `prices` ($/MTok write/read, per model) for the fold hint,
  `cacheTtlMinutes` (60 when main uses the 1 h TTL).

## Experiment factors and modes

Online (spec §5.6), assigned per main session by the `experiments` extension:

| Factor | Values | Consumed by |
|---|---|---|
| `warmPolicy` | `native`, `orchestrator-aware` | cache-lifecycle |
| `mainCacheTtl` | `5m`, `1h` | cache-lifecycle |
| `foldHint` | `fixed`, `cache-aware` | infinite-context (cache patch) |
| `maskOnCold` | `off`, `on` (= own level, or `tools+thinking` when own is off) | cache-lifecycle |
| `freshOnCold` | `off`, `advise` | task-router |
| `delegationRule` | `off`, `on` (orchestrator rule in the main card section; never in children) | task-router |

Design v2: 2⁶ > `maxArms` 16 → the 2⁶⁻² fraction (16 arms, resolution IV,
generators E = ABC, F = BCD: main effects are clear of each other and of all
two-factor interactions, which are aliased in groups; the all-low arm is in the
design). v1 (before `delegationRule`) was the 2⁵⁻¹ half fraction with 5-char
ids; its sessions keep their arms and are told apart by `design` in
`assignments.jsonl` (analysis must not pool the two).
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
meter-report [--from YYYY-MM-DD] [--to YYYY-MM-DD]   # spend per day/session/model, cache-rewrite share, quota regression
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

**H6 full run**: `~/.pi/agent/bench/run-h6.sh` — all four factor arms × all
tasks × 1 rep, blocked by task, `H6_PAR` parallelism (default 2), quota-guarded
by the live meter (`H6_STOP_Q7D`, default 98), resumable (finished runs are
skipped). Afterwards: `pi-bench judge --all`, then
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
  is treated as mean 0 (optimistic, tried first). The router's daily-cap
  counter (`member-count.json`) is a lower bound and a provider's block is in
  memory only (re-learned from the next cap error after a restart). Children inherit only on the spawn event: a
  **resumed child** session has no arm (seen live 2026-10-03; `pi-analyse
  --check` names its lines).
- **Router defaults rest on hypotheses**: Haiku's abilities (write 0, read 1)
  are unmeasured until the scout gate (the bench's Haiku arm against local
  Qwen and Sonnet); until then `lookup` routes like `scout` (read 2).
- **The context estimate counts whole files**: the card's `files`, their
  bytes / 3.6 per token, a new file 0; a task that reads a part of a large
  file is over-estimated (the context reason says to list only the files the
  task reads, or to split it), and files it reads without listing them are
  not counted.
- **Slots are per process**: reservations, waits and the attempt state live in
  the main session's memory. Another pi session or client on the same server
  is seen only through the member's health and `/slots` probe, two sessions
  can each pick a member's last free slot, and a re-spawn after a restart
  escalates from the new plan's member (`escalate.from` `"?"`).
- **Masking is request-local**: it rewrites the outgoing wire, not the stored
  transcript — `context_map` still lists originals and previews; recovery is
  `context_peek`.
- **pi-retry**: print/json retry works only through the local patch; the free
  daily cap is not retried at all (until 00:00 UTC). The bench print driver
  therefore uses pi's native retry (100 × 2 s) via a per-run `.pi/settings.json`.
- **Patches are local and version-locked**: all third-party changes ride on the
  pinned input revs; `pi update` no longer affects pi-retry, but an input bump
  re-applies the patches and the patch checks fail loudly on drift. Two
  upstream issue drafts are written, not filed: pi 1.0.0's `CacheWarmer`
  identity check dies on custom messages, and `sendCustomMessage(triggerTurn)`
  skips the prompt/loadout path.
- **Bench**: quality evidence comes from two blind judges (Opus 5.5 high,
  GPT-5.6-sol high) against a reference diff, plus the user calibration set;
  the orchestrator is Opus-only, and the per-run agent dirs do not share
  claude-auth's refresh lock, so start a batch with a fresh login and keep
  parallelism small.
- **Live verification**: L4 (meter retry accounting) and L6 (orchestrator
  warming) failed as installed on 2026-10-03; the fixes (D1, D2, D4, D5, plus
  T4.7/T7.9) are in the tree but not re-verified live until the next
  `home-manager switch`.
