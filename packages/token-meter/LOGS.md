# pi's own logs (LOGS.md)

What pi writes about its own token usage, cost, quota, routing and experiments, where
it lives, what every field means and how the files join. Installed as
`~/.pi/agent/LOGS.md` by the token-meter Home Manager module; the source is
`token-meter/LOGS.md` in the repo. The analysis of all of it is one command:

    pi-analyse [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--agent-dir P] [--out DIR] [--check] [--apply]

It writes `<out>/<YYYY-MM-DD>-<HHMM>-analysis.md` and `.json` (UTC date and time of
the run, so runs of one day keep their reports; default out:
`~/.pi/agent/reports`). `--check` only checks the data contract below for the period
and exits 1 when a required field is missing (it prints which, how often, and one
example). `--apply` also writes the kill-switch arms to `experiments/state.json`.
Nothing runs on a timer: the analysis runs when the user asks for it.

All paths are relative to the agent dir (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR`).
All files are append-only JSON Lines (one object per line, UTF-8, `\n`), no prompt or
message text, strings clipped to 256 characters. Timestamps are ISO-8601 UTC.

## Files

| file | writer | one line per | rotation |
| --- | --- | --- | --- |
| `meter/YYYY-MM.jsonl` | token-meter extension (every session, children too) | provider request | UTC month |
| `task-router/outcomes/YYYY-MM.jsonl` | task-router extension (main session) | routing event of a delegated task | UTC month |
| `experiments/assignments.jsonl` | experiments extension (main session) | root session's arm assignment | none |
| `guards/events.jsonl` | experiments (correction, rating), cache-lifecycle (peek-after-mask) | guard event | none |
| `experiments/state.json` | `pi-analyse --apply`, `meter-report --arms --posterior` | — (one JSON object) | rewritten atomically |
| `reports/YYYY-MM-DD-HHMM-analysis.{md,json}` | `pi-analyse` | — | one pair per run (UTC; a rerun in the same minute replaces it) |

Settings read by the analysis: `token-meter/settings.json` (`dir`: meter directory,
relative to the agent dir unless absolute; default `meter`),
`experiments/settings.json` (`baseline`, `factors`, `guards` thresholds),
`task-router/settings.json` (`runaway.requests`, `runaway.usd`; default 150 / $10).

## Schema versions

Every line carries `v` (integer). Readers treat an absent `v` as **0 (legacy)**; a
writer bumps `v` when it removes or changes the meaning of a field (adding an optional
field does not bump it). `pi-analyse` reports the versions per log under *Data quality*.

| log | v0 (absent `v`) | v1 |
| --- | --- | --- |
| meter | lines before 2026-10-03; early lines have no `arm` | `v` added (2026-10-03) |
| outcomes | lines before 2026-10-03 | `v` added (2026-10-03) |
| assignments | design v1 rows (5-character arms, no `design`) | `v`, `design` (`"v2"`: 6 factors; `"v3"` since 2026-10-04) |
| guards | lines before 2026-10-03 | `v` added (2026-10-03) |

## Join keys

- **Session tree.** `meter.sessionId` is the pi session id. A child (subagent) session
  has `meter.parentSessionId` = its spawner's session id. The **root** of a session is
  found by following `parentSessionId` up; the root session is the unit of the
  experiment (arm, active hours, $ per active hour).
- **Task ↔ child session.** `outcomes[event=spawn].sessionId` is the child's session id
  (`= meter.sessionId` of the child's lines), `parentSessionId` the spawner's. Every other
  outcome event joins the spawn by `taskId` (the subagent's name).
- **Arm.** `assignments.sessionId` is a root session; its `arm` holds for that session
  and every descendant from the assignment's `ts` on. `meter.arm`, `outcomes.arm` (on
  spawn: the parent session's arm) and `guards.arm` are copies of it at write time.
- **Quota.** `q5h`/`q7d` are the whole Anthropic account's utilisation (pi and every other
  client) in 1 % steps; pi's share = the rise seen in pi's own lines over the rise of the
  account in the same windows. The account's rise is attributed to roots once, from one
  global timeline (see *Analysis* below), never summed per session.

## meter/YYYY-MM.jsonl

| field | type | required | meaning |
| --- | --- | --- | --- |
| `v` | int | yes (v ≥ 1) | schema version |
| `ts` | ISO time | yes | request end (warming: the warm response's time) |
| `sessionId` | string | yes | pi session id |
| `parentSessionId` | string | children | spawner's session id (from the session file path `…/subagents/<parent>/…`) |
| `arm` | string | when the root has an assignment | experiment arm id (`+`/`-` per factor) |
| `provider`, `model` | string | yes | provider and model id |
| `effort` | string | no | thinking level |
| `kind` | `turn` \| `warming` \| `nested` | yes | an agent turn, a cache-warming request, a request made by an extension |
| `input`, `cacheRead`, `cacheWrite`, `output` | number | when `status` ≠ `error` | tokens |
| `reasoning` | number | no | reasoning tokens (subset of output) |
| `costUsd` | number | when `status` ≠ `error` | pi's API-price cost of the request |
| `status` | int \| `error` | yes | HTTP status, or `error` |
| `errorClass` | string | on error | leading HTTP code of the error message, else `error` |
| `retries`, `retryWaitMs` | number | yes | retries before this request and the time waited |
| `q5h`, `q7d` | number (%) | no | account utilisation of the 5-hour and 7-day windows, as read from the response headers of THIS request (parallel sessions log interleaved, slightly stale readings) |
| `q5hReset`, `q7dReset` | ISO time | no | window resets |
| `overage`, `claim`, `fallback` | string | no | raw Anthropic unified-ratelimit headers |
| `rawRatelimit` | object | no | all `anthropic-ratelimit-*` headers (dropped first when a line would exceed 4 KiB) |

## task-router/outcomes/YYYY-MM.jsonl

Common: `v` (int), `ts` (ISO), `event`, `taskId` (subagent name) — all required.

| event | fields (required **bold**) | meaning |
| --- | --- | --- |
| `spawn` | **`kind`**, **`workerTier`** (`qwen` \| `haiku` \| `T1` \| `T2` \| …), **`workerEffort`**, `reviewTier`, `reviewEffort`, `cardHash`, `base`, `importance`, `reasons` (string[]), `arm`*, **`sessionId`** (child), **`parentSessionId`**, `attemptOf`, `assigned`† (`router` \| `random`), `routeBase`† (tier), `unresolved`† (`true`), `reviewOf`†, `ability`†, `level`† (int ≥ 0), `draft`† (`true`), `workerLevel`†, `reviewLevel`† (int ≥ 0), `workerMember`†, `workerModel`†, `startEffort`†, `waitMs`† (≥ 0) | a routed (or unrouted) spawn |
| `reroute` | **`from`**, **`to`**, `reason`, `fromModel`†, `toModel`† | provider fallback (rate limit, outage) |
| `check` | **`exit`**, `durationMs` | the card's check ran after the child reported |
| `corrective` | — | one corrective message to the child |
| `escalate` | **`from`**, **`to`**, `attemptOf`, `fromModel`†, `toModel`†, `ability`†, `fromLevel`†, `toLevel`† (int ≥ 0) | re-spawn one tier up |
| `verdict` | **`verdict`** (`accepted` \| `partial` \| `rejected` \| `unjudged`), `note`, `reviewOf`† | the parent's judgement; `unjudged` when killed without one |
| `spotcheck` | `requested` (`true`) | an accepted verdict was drawn for a spot-check review (`spotCheck.share`); the parent was told to spawn a `review` card with `reviewOf` |

\* `arm` is required on a spawn whose parent session (or its root) has an assignment.

† Optional, added 2026-10-04 (no `v` bump). `assigned`/`routeBase` (T5.21): who chose the worker tier
(`random` = task-level randomization sent a Qwen route to T1) and the worker tier the router computed; absent on
unrouted spawns. `unresolved` (T5.20): a relative card file's directory was missing under the task's cwd (card `cwd`,
else the parent's), so `bounded` was lowered without evidence the task is unbounded — exclude these spawns from
t0-verification statistics. `reviewOf` (T5.22): on a spot-check review child's spawn and verdict, the reviewed
task's `taskId`; agreement = that task's `accepted` vs this verdict.

† Also optional, added 2026-10-17 with the router's members and levels (no `v` bump); absent on unrouted
spawns and on older lines. On `spawn`: `ability` and `level` are the card's requirement (after the floor or a
profile's pin), `draft` marks a draft requirement, `workerLevel`/`reviewLevel` are the plan's legs on that
ability's scale; `workerMember`, `workerModel` and `startEffort` are the member, model and effort the child
**started on** (an accepted explicit model or effort included), `waitMs` the time it waited for a slot.
`workerTier` and **`workerEffort` keep their meaning: the planned worker leg** (after randomization and
escalation); `startEffort` is the effort the child started at. They differ for a fallback member (a write-0 plan
whose Qwen is busy logs `workerTier: qwen`, `workerEffort: xhigh`, and e.g. `workerMember: sonnet`,
`startEffort: high`) and for an accepted explicit effort. The randomized comparison keeps reading `assigned`
(intention to treat); the model a task ran on is `workerModel`, updated by its last `reroute.toModel`. On
`reroute` and `escalate`: `fromModel`/`toModel`, the models on both routes; `escalate` adds the re-spawn's
`ability` and `fromLevel`/`toLevel`. `escalate.from` is the route the failed attempt ran on last (after its
reroutes). It is `"?"` on older lines, and on a re-spawn whose failed task the router does not know (its attempt state
is in memory: a restart, a hand-off, a mistyped `attemptOf`); such a line has no `fromModel` and no `fromLevel`.
`fromLevel` is the level the escalation starts from, the failed attempt's planned member's level on `ability`, not
necessarily the level of `from`/`fromModel` (a write-0 plan that fell back to Sonnet logs `from: "T1"`, `fromLevel: 0`).
`pi-analyse` counts an escalation in its failed task's row (card kind × `workerTier`).

### Older lines: the old → new mapping

Lines from before 2026-10-17 carry tiers and route labels only. Readers map them with `levelsOfLine`
(`core/levels.ts`), which returns a line with the fields above as written:

| old `spawn` | `ability` | `level` (from `base`) | `workerLevel` | `workerModel` |
| --- | --- | --- | --- | --- |
| kind `scout`/`review` | `read` | `qwen`/`qwen-draft` → 0, `T1` → 2, `T2` → 3 | same map on `workerTier` | below |
| any other routed kind | `write` | `qwen` → 0, `qwen-draft` → 0 + `draft`, `T1` → 1, `T2` → 2 | same map | below |
| `unrouted` | – | – | – | the reason `model …` |

`workerModel` of an old spawn: `T1`/`T2` → `anthropic/claude-sonnet-5-5`/`anthropic/claude-opus-5-5`; `qwen` →
by its chain reason: `qwen chain: local` → `llama/qwen3.8`, `qwen chain: cloud` →
`openrouter/qwen/qwen3.8-27b:free`, `qwen chain → Sonnet: …` → Sonnet; a v0 line without a chain reason →
unknown. `startEffort`: `workerEffort`, except `qwen chain → Sonnet: …` → `high`. `levelsOfLine` also returns
`ranModel`: the model after the task's last `reroute` (its `to` mapped as below), else `workerModel`.

| old line | `ability` | `fromLevel`, `toLevel` | `fromModel`, `toModel` |
| --- | --- | --- | --- |
| `escalate` | that of the spawn named by `attemptOf` | `local`/`cloud` → 0, `T1` → 1 (read 2), `T2` → 2 (read 3); `"?"` → the failed spawn's `workerTier` on the same map | `local` → `llama/qwen3.8`, `cloud` → the free model, `T1`/`T2` → Sonnet/Opus; `"?"` → unknown |
| `reroute` | – | – | same map |

## experiments/assignments.jsonl

| field | type | required | meaning |
| --- | --- | --- | --- |
| `v` | int | yes (v ≥ 1) | schema version |
| `ts` | ISO time | yes | assignment time (session start) |
| `sessionId` | string | yes | root session |
| `arm` | string | yes | arm id: one `+`/`-` per factor in `factors` order |
| `design` | `"v2"` \| `"v3"` | v ≥ 1 | design version; absent = v1 (5 factors) |
| `mode` | `off` \| `explore` \| `exploit` | yes | selection mode |
| `flags` | object | yes | factor → value of the arm |

Designs: **v1** — 5 factors `warmPolicy`, `mainCacheTtl`, `foldHint`, `maskOnCold`,
`freshOnCold` (2^(5-1), 16 arms, 5-character ids, baseline `-----`). **v2** — v1 plus
`delegationRule` (2^(6-2), 16 arms, 6-character ids, baseline `------`). A row without
`design` is v1 when its arm has 5 characters, v2 when 6. Resumed sessions keep their
first row (no second row).

**v3** (T8.10) — the same six factors, arms (6-character ids, baseline `------`) and
fraction as v2, but the meaning of `foldHint` = `cache-aware` changed: it now also adds a
paragraph to the system prompt. New assignments carry `design: "v3"`; a resumed v2 session
keeps its v2 row, arm and flags. Arm ids repeat across v2 and v3, so **a meter line's design
is its root session's assignment row, never its arm id**; `pi-analyse` therefore keeps v2 and v3
in separate experiment tables (and separate guard/kill-switch figures), never pools them, and
the experiments extension balances arms over v3 rows only.

## guards/events.jsonl

| field | type | required | meaning |
| --- | --- | --- | --- |
| `v` | int | yes (v ≥ 1) | schema version |
| `ts` | ISO time | yes | event time |
| `sessionId` | string | yes | session |
| `arm` | string | when the root has an assignment | the session's arm |
| `event` | `correction` \| `rating` \| `peek-after-mask` | yes | user correction right after an assistant turn (regex), `/rate N`, `context_peek` after cache-lifecycle masked tool output |
| `value` | int 1–5 | `rating` | the rating |

## experiments/state.json

`{ "disabled": string[], "posterior": { <arm>: { "mean": −$/active h, "sd": number } }, "reasons": { <arm>: string } }`.
Disabled arms stay disabled until the file is edited. The experiments extension reads
it at session start (exploit mode samples from `posterior`, never assigns `disabled`).

## Analysis (`pi-analyse`)

How the report derives its numbers from the logs above (the report itself says what each
table is; this is what a reader of the raw files needs to reproduce them).

- **Root session** = `parentSessionId ?? sessionId` of a meter line; the unit of the
  experiment. Active hours = gaps below 30 min between its non-warming requests.
- **Quota per root.** The account's quota is shared by every session, so a root's `q5h`/`q7d`
  use is attributed, not summed: all non-warming meter lines of all roots form one timeline;
  each rise between consecutive readings (same `<key>Reset` window, less than 30 min apart,
  measured against the window's running maximum so stale interleaved readings count once)
  is split between the roots that made requests in (previous reading, this reading],
  proportional to their `costUsd` there (equally when all cost 0). Σ over roots = the
  account's rise seen between pi requests ("pi share" in *Data quality*); a lone root gets
  the full rise, two identical parallel roots half each. A root without any reading has no
  quota figure. 1 % steps make per-root figures coarse; they are fair only over many steps.
- **Designs v2 and v3** are analysed alike (same factors) but as separate tables: a unit
  (root session) belongs to the design named by its root's first assignment row (arm length
  when there is none); guard events and verdicts are attributed the same way (spawn events by
  their `parentSessionId`) before they are keyed by arm. `--apply` writes one posterior per arm id,
  from the newest design.
- **Fold ledger** (*Cost*, Claude models only). A **fold** = a non-warming request whose prompt
  (`input + cacheRead + cacheWrite`) is below 80 % of the previous non-warming request's in the
  same session (the rule of the *after folds* split). For each fold:
  - **R** = prompt before − prompt after (tokens removed);
  - **K** = the fold request's `cacheWrite` − the session's *typical write*, floored at 0; typical write
    = median `cacheWrite` of the session's non-first turns that are neither folds nor after a cold
    gap (0 without such turns); **K = 0** when the fold request itself follows a cold gap (the
    cache had to be rewritten anyway: "cold fold, no extra cost");
  - **cold gap** = ≥ 5 min since the session's previous request (warming included), ≥ 60 min for a
    main session whose arm has `mainCacheTtl` = `1h`;
  - **n** = requests (warming included, they read the prompt too) after the fold until the session
    ends or the next cold gap;
  - **r, w** = the model's cache read and write price per token, derived from the lines: input price
    `p = Σ costUsd ÷ Σ (input + 0.1·cacheRead + 1.25·cacheWrite + 5·output)` over the model's lines
    with a cost (the same Anthropic ratios the *Token components* table uses), `r = 0.1·p`,
    `w = 1.25·p`. A model without a priced line contributes no folds.
  - **savings** = n·R·r (cache-read $ the shrunken prompt saved); **rewrite** = K·(w − r) (the K
    tokens are written at w where they would have been read at r);
    **net = savings − rewrite = n·R·r − K·(w − r)** exactly. Break-even depth K/R = n·r/(w − r) ≈ n/11.5.
  - The report gives count, Σ net, the share of folds with net < 0, and the same by K/R bucket
    (< 0.25, 0.25–0.5, 0.5–1, 1–2, ≥ 2), by design + `foldHint` level (v2 and v3 apart) and by model.
  Counterfactual by construction: each fold is valued alone, as if nothing else changed
  (output, tool use and the task path stay the same; the unfolded prompt would have been read at r).
  Folds of one session overlap in `n`; the sums are therefore a per-fold ledger, not a total saving.
- **Delegation per profile × tier.** Profile = `spawn.kind`, tier = `spawn.workerTier`.
  Verdicts, checks and escalations join the spawn by `taskId` (an `escalate` event counts
  for the tier it escalated from and the kind of the spawn named by `attemptOf`); $ per
  accepted task = the child subtree's cost (`parentSessionId` chain) of the judged tasks ÷
  the accepted ones. Spawns with `unresolved: true` and spot-check review children
  (`reviewOf` on the spawn or its verdict) are counted but left out of every
  routing-quality figure.
- **Randomized comparison.** Spawns with `assigned: "random"` and `routeBase: "qwen"`, by the
  tier they ran on, with bootstrap CIs from 5 judged tasks on; the reference row is the
  router's own qwen tasks (`assigned` `router` or absent) of the same kinds. Only the random
  rows are comparable causally.
- **Spot-check agreement.** For every review verdict (`reviewOf` = the original task) the
  original's verdict at the draw (last one at or before the `spotcheck` event) is compared
  with it: agree = both accept or both do not.

## Data contract (`pi-analyse --check`)

Required = the **required** column above, per event; plus two relational rules the joins
need: a meter line of a session named as a child by a spawn event must carry
`parentSessionId`; a meter, spawn or guard line of a session whose root has an
assignment with `ts` ≤ the line's `ts` must carry `arm`. Lines of v0 are checked too
(legacy gaps show up as findings, not errors in the analysis). Optional fields (the †
ones of the outcome log: `assigned`, `routeBase`, `unresolved`, `cwd`, `reviewOf`, `requested`)
are never required, so lines written before they existed pass; when present their type is
checked (`assigned` `router` or `random`, `unresolved` boolean, `requested` `true`, the rest
non-empty strings), and `spotcheck` is a known event. The repo check
`pi-log-contract` runs every writer's real code path and asserts `--check` passes and
every report section has data.

## Known gaps

- A **resumed** child session does not inherit its arm again (inheritance happens on the
  spawn event only), so its later meter lines miss `arm` (seen 2026-10-03).
- Quota readings of parallel sessions interleave and are slightly stale; per-root and per-arm
  quota is an attribution of the account's rise (see *Analysis*), approximate.
- Lines before 2026-10-03 have no `v` and partly no `arm`.
