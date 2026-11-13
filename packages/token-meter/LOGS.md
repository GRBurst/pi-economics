# pi's own logs (LOGS.md)

What pi writes about its own token usage, cost, quota, routing and experiments, where
it lives, what every field means and how the files join. Installed as
`~/.pi/agent/LOGS.md` by the token-meter Home Manager module; the source is
`packages/token-meter/LOGS.md` in the repo. The analysis of all of it is one command:

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
| assignments | design v1 rows (5-character arms, no `design`) | `v`, `design` (`"v2"`: 6 factors; `"v3"` since 2026-10-04; `"v4"`: 3 factors) |
| guards | lines before 2026-10-03 | `v` added (2026-10-03) |

## Join keys

- **Session tree.** `meter.sessionId` is the pi session id. A child (subagent) session
  has `meter.parentSessionId` = its spawner's session id. The **root** of a session is
  found by following `parentSessionId` up; the root session is the unit of the
  experiment (arm, active hours, $ per active hour).
  The analyser counts a `status: "error"` line apart: it is no request (request totals,
  runaway limit, folds, cold resumes) and no activity (active hours).
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
| `retries`, `retryWaitMs` | number | up to v1; v2: turn lines | v1: retries before this request and the time waited, counted by the pi-retry extension; v2: pi's native retry (*Meter line v2*) |
| `q5h`, `q7d` | number (%) | no | account utilisation of the 5-hour and 7-day windows, as read from the response headers of THIS request (parallel sessions log interleaved, slightly stale readings) |
| `q5hReset`, `q7dReset` | ISO time | no | window resets |
| `overage`, `claim`, `fallback` | string | no | raw Anthropic unified-ratelimit headers |
| `rawRatelimit` | object | no | all `anthropic-ratelimit-*` headers (dropped first when a line would exceed 4 KiB) |

**Warming lines.** A response no assistant `message_end` claims is a warm: it becomes a
`warming` line at the session's next request, `agent_settled` or shutdown, with the usage
of pi's `cache_warm` entry at or after the response, or without usage when pi recorded
none (the warm was aborted or failed after its headers). pi ≥ 1.4 may send a warm WHILE a
long turn streams (its timer runs from the turn's request start, 270 s for a 5-minute
TTL): a response between an assistant `message_start` and its `message_end` is always the
warm's, never the turn's, so the turn line keeps its own headers (`q5h`, `status`) and
the warm gets its own line. A warm aborted before its headers gets no line.

### Meter line v2

The writer emits `v: 2`: the v1 line plus the optional fields below. `v` was bumped because
`retries` and `retryWaitMs` changed source and meaning and are no longer on every line. A v2
field is present iff it was measured: **absent = unknown, never 0**. The readers (`pi-analyse`,
`meter-report`) take v0, v1 and v2 lines alike; a line stays below 4 KiB with every field at its
largest (`rawRatelimit` is dropped first).

| field | type | present | meaning |
| --- | --- | --- | --- |
| `billing` | `subscription` \| `api` \| `free` \| `local` | every line (`pi-analyse --check` requires it from v2) | billing class of the provider, from `plans` in `token-meter/settings.json` (Home Manager: `tokenMeter.plans`); a provider without a plan is `api` |
| `design` | string | when the experiments extension names the session's design | the experiment design of `arm` (not written yet: the extension names none) |
| `cacheWrite1h` | number | when the provider reports the split (Anthropic) | the part of `cacheWrite` written with the 1-hour TTL |
| `durationMs` | int (ms) | turn lines whose request the session sent | the session's last own provider request (a `before_provider_request` right after the agent loop's `context` event) to this `message_end`; a resend restarts it, a warm's or a compaction's send (no `context` event) does not |
| `ttftMs` | int (ms) | when a stream event followed that request | the request to its first `provider_stream_event` |
| `errorKind` | `context_overflow` \| `rate_limit` \| `other` | `status: "error"` | class of the error message: `context_overflow` exactly when pi 1.4 takes it for one (pi-ai's overflow patterns, mirrored; throttling and rate-limit texts never are), then a leading 429, a throttling or a rate-limit text → `rate_limit`; else `other` (an overloaded server too). The message itself is never written |
| `retries`, `retryWaitMs` | int, int (ms) | turn lines | pi's native retry: `retries` = 1 when this request is pi's resend of the session's previous request that failed (an `error` line, not a context overflow, with no other message and no end of the run in between), else 0; `retryWaitMs` = that failure's `message_end` to this request. Absent on warming lines (pi never resends a warm) |

The count is per request: a failed attempt is an `error` line of its own, and each resend
carries `retries: 1`, so Σ `retries` over lines is the number of resends (three failures
before a success: four lines, `retries` 0, 1, 1, 1). pi does not retry a context overflow (it
compacts), so the next request after one is no retry. v1 lines counted the retries of the
pi-retry extension (its own backoff) and put an episode's total on its last line: Σ `retries`
(and Σ `retryWaitMs`) over a period compares across v1 and v2, a single line's value does not.
On v2 the final line of an episode that succeeds after retries carries 1, whatever the number
of attempts; take the retry rate from Σ `retries`, never from "lines with `retries` > 0".

`retries: 0` means no resend by pi's session (agent-level) retry was seen. Retries inside the
provider client (pi's `retry.provider.maxRetries`, default 0) send one request as far as the
meter sees and are not counted; with pi's `retry.enabled: false` every line has 0. One case is
miscounted: an extension that continues the run (`continue` from `agent_before_settle`) right
after a failed attempt that pi did not retry, with no message in between, makes that request
count as a retry. A warm's send never ends a retry wait.

`plans` (`token-meter/settings.json`) maps a provider name to `{ "billing", "windows", "rate" }`:
`windows` (`5h`, `7d`) are a subscription's quota windows, `rate` (`{ "amount", "currency",
"per": "hour" }`, only with `billing: "local"`) the price of a local provider's active time. The
meter writes only `billing`; the analysis reads the rest from the same file.

A subscription turn on a 1-hour cache, a rate-limited attempt and its retry, a warm, a
context overflow and a local child turn:

```jsonl
{"v":2,"ts":"2026-11-03T10:00:04.200Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","input":12,"cacheRead":48000,"cacheWrite":1500,"cacheWrite1h":1500,"output":420,"costUsd":0.06,"status":200,"retries":0,"retryWaitMs":0,"durationMs":4200,"ttftMs":900,"q5h":12,"q5hReset":"2026-11-03T14:00:00.000Z","q7d":31,"q7dReset":"2026-11-07T00:00:00.000Z"}
{"v":2,"ts":"2026-11-03T10:01:00.300Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","status":"error","retries":0,"retryWaitMs":0,"errorClass":"429","errorKind":"rate_limit","durationMs":300}
{"v":2,"ts":"2026-11-03T10:01:07.400Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","input":30,"cacheRead":49500,"cacheWrite":800,"cacheWrite1h":800,"output":510,"costUsd":0.05,"status":200,"retries":1,"retryWaitMs":2000,"durationMs":5100,"ttftMs":1100,"q5h":13,"q5hReset":"2026-11-03T14:00:00.000Z","q7d":31,"q7dReset":"2026-11-07T00:00:00.000Z"}
{"v":2,"ts":"2026-11-03T10:55:37.000Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","kind":"warming","billing":"subscription","input":0,"cacheRead":50300,"cacheWrite":0,"output":1,"costUsd":0.03,"status":200}
{"v":2,"ts":"2026-11-03T11:02:00.800Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","status":"error","retries":0,"retryWaitMs":0,"errorClass":"400","errorKind":"context_overflow","durationMs":800}
{"v":2,"ts":"2026-11-03T11:10:21.000Z","sessionId":"s-child","parentSessionId":"s-main","arm":"-+-","provider":"llama","model":"qwen3.8","kind":"turn","billing":"local","input":2400,"cacheRead":0,"cacheWrite":0,"output":350,"costUsd":0,"status":200,"retries":0,"retryWaitMs":0,"durationMs":21000,"ttftMs":2600}
```

## task-router/outcomes/YYYY-MM.jsonl

Written by the router, which is a package of its own
([pi-task-router](https://github.com/GRBurst/pi-task-router)); the router owns
the schema: every event and field, the join keys and the version rule are in
its `docs/outcome-log.md`. This file keeps what the readers here need.

- **Events**: `spawn`, `reroute`, `check`, `corrective`, `escalate`, `verdict`,
  `spotcheck` (task events, joined by `taskId` = the subagent's name), and the
  events local mode adds: `force`, `hint`, `review`, `merge`, `plan`,
  `gatebypass`.
- **Common**: `v` (int), `ts` (ISO), `event`, `taskId` (all required).
- **Join keys**: `spawn.sessionId` is the child's session id (the `sessionId`
  of the child's lines in `meter/`), `parentSessionId` the spawner's; `arm` on
  a spawn is a copy, at write time, of the parent session's arm in
  `experiments/assignments.jsonl`.
- **Contract copy**: `core/contract.ts` is this package's copy of the
  vocabulary and the required fields. The router's `docs/outcome-log.md`
  wins; the copy is proven against the router's real writer by the flake check
  `log-contract`, and `pi-analyse --check` reports a line that breaks it.

### Examples: task-router local mode

One line per event that local mode added (`test/logs-examples.test.ts` runs each through the contract): a
`/force` set by the command, a hint to the main session, a ticket `spawn` of a merge overseer and its `review`, the
rejected `request_merge`, a main branch moved outside the gate, and a plan approved by `plan_request`.

```jsonl
{"v":1,"ts":"2026-11-02T09:00:00.000Z","event":"force","taskId":"","action":"set","source":"command","model":"anthropic/claude-sonnet-5-5","effort":"high"}
{"v":1,"ts":"2026-11-02T09:01:00.000Z","event":"hint","taskId":"main","trip":"identical-call","stage":"hint","count":3,"sessionId":"s-main"}
{"v":1,"ts":"2026-11-02T09:02:00.000Z","event":"spawn","taskId":"ovs-merge-1","kind":"overseer","ticket":"merge","workerTier":"T2","workerEffort":"high","workerMember":"opus","workerModel":"anthropic/claude-opus-5-5","sessionId":"s-ovs-merge-1","parentSessionId":"s-main"}
{"v":1,"ts":"2026-11-02T09:05:00.000Z","event":"review","taskId":"rv-1a2b3c4d","role":"merge","member":"opus","model":"anthropic/claude-opus-5-5","outcome":"revise","attempt":1,"durationMs":180000,"findings":2,"blocking":1,"commit":"0123abc","branch":"lm/parser"}
{"v":1,"ts":"2026-11-02T09:05:01.000Z","event":"merge","taskId":"lm/parser","outcome":"revise","commit":"0123abc","nLines":42,"nFiles":2,"reviewId":"rv-1a2b3c4d"}
{"v":1,"ts":"2026-11-02T09:10:00.000Z","event":"gatebypass","taskId":"main","from":"0123abc","to":"4567def","repo":"app"}
{"v":1,"ts":"2026-11-02T09:20:00.000Z","event":"plan","taskId":"parser","action":"approve","nTasks":4,"reviewId":"rv-5e6f7a8b"}
```

### Older lines: the old → new mapping

Lines from before 2026-10-17 carry tiers and route labels only. Readers map them with `levelsOfLine`
(`core/levels.ts`), which returns a line with the fields of the router's outcome log as written. The tables below are
data, `core/legacy-routes.json` (`before`, `models`, `levels`, `chain`), read for a line whose `ts` is older than 2026-10-17
and for no other: a line from that day on yields the models and levels it carries (`workerModel`, `fromModel`, `toModel`,
`workerLevel`, `fromLevel`, `toLevel`), or none, and is never mapped from a label.

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
| `design` | `"v2"` \| `"v3"` \| `"v4"` | v ≥ 1 | design version; absent = v1 (5 factors) |
| `mode` | `off` \| `explore` \| `exploit` | yes | selection mode |
| `flags` | object | yes | factor → value of the arm |

Designs: **v1** — 5 factors `warmPolicy`, `mainCacheTtl`, `foldHint`, `maskOnCold`,
`freshOnCold` (2^(5-1), 16 arms, 5-character ids, baseline `-----`). **v2** — v1 plus
`delegationRule` (2^(6-2), 16 arms, 6-character ids, baseline `------`). A row without
`design` is v1 when its arm has 5 characters, v2 when 6. Resumed sessions keep their
first row (no second row).

**v3** (T8.10) — the same six factors, arms (6-character ids, baseline `------`) and
fraction as v2, but the meaning of `foldHint` = `cache-aware` changed: it then also added a
paragraph to the system prompt. A resumed v2 session keeps its v2 row, arm and flags. Arm ids
repeat across v2 and v3, so **a meter line's design is its root session's assignment row,
never its arm id**; `pi-analyse` therefore keeps v2 and v3 in separate experiment tables (and
separate guard/kill-switch figures) and never pools them.

**v4** — 3 factors `warmPolicy`, `mainCacheTtl`, `maskOnCold` (the full 2^3, 8 arms,
3-character ids, baseline `---`). `foldHint` went with infinite-context's fold hint;
`freshOnCold` and `delegationRule` are the task router's levers and no factors any more.
New assignments carry `design: "v4"`; resumed v1, v2 and v3 sessions keep their rows, arms
and flags, and the experiments extension balances arms over v4 rows only. A row without
`design` whose arm has 3 characters counts as v4.

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
- **Designs v2 and v3** are analysed alike (same factors) but as separate tables, v4 (its own
  three factors) in a third: a unit
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
    `p = Σ costUsd ÷ Σ (input + 0.1·cacheRead + 1.25·(cacheWrite − cw1h) + 2.0·cw1h + 5·output)` over the model's lines
    with a cost (the same Anthropic ratios the *Token components* table uses; `cw1h` = the line's 1 h writes, see *Analysis: cache misses*),
    `r = 0.1·p`, `w = 1.25·p` (5-minute write), `w1h = 2.0·p` (the fold request's 1 h share of its writes is paid at `w1h`).
    A model without a priced line contributes no folds.
  - **savings** = n·R·r (cache-read $ the shrunken prompt saved); **rewrite** = K·(w − r) (the K
    tokens are written at w where they would have been read at r);
    **net = savings − rewrite = n·R·r − K·(w − r)** exactly. Break-even depth K/R = n·r/(w − r) ≈ n/11.5.
  - The report gives count, Σ net, the share of folds with net < 0, and the same by K/R bucket
    (< 0.25, 0.25–0.5, 0.5–1, 1–2, ≥ 2), by design + `foldHint` level (v2 and v3 apart; v4 has none: `v4 –`) and by model.
  Counterfactual by construction: each fold is valued alone, as if nothing else changed
  (output, tool use and the task path stay the same; the unfolded prompt would have been read at r).
  Folds of one session overlap in `n`; the sums are therefore a per-fold ledger, not a total saving.
- **Delegation per profile × tier.** Profile = `spawn.kind`, tier = the model the task ran on (*Analysis: router observation*).
  Verdicts, checks and escalations join the spawn by `taskId` (an `escalate` event counts
  for the tier it escalated from and the kind of the spawn named by `attemptOf`); $ per
  accepted task = the child subtree's cost (`parentSessionId` chain) of the judged tasks ÷
  the accepted ones. Spawns with `unresolved: true` and spot-check review children
  (`reviewOf` on the spawn or its verdict) are counted but left out of every
  routing-quality figure.
- **Randomized comparison.** Spawns with `assigned: "random"` and `routeBase: "qwen"`, by the
  model they ran on, with bootstrap CIs from 5 judged tasks on; the reference row is the
  router's own qwen tasks (`assigned` `router` or absent) of the same kinds. Only the random
  rows are comparable causally.
- **Spot-check agreement.** For every review verdict (`reviewOf` = the original task) the
  original's verdict at the draw (last one at or before the `spotcheck` event) is compared
  with it: agree = both accept or both do not.

### Analysis: cache misses

The *Cache* section (Claude models only: Anthropic's explicit prompt caching; local and other providers cache differently and are not
modelled here) and `meter-report`'s "miss share" read the request lines of one session at a time. The **branch** of a session = its
`turn` and `warming` lines without `status: "error"` in `ts` order; every line is the "previous request" of the next, but a warming
request is no row of its own (it only refreshes the prefix).

- **Cached** after request *i*: `cacheRead + cacheWrite` (its `input` is the tail after the last cache breakpoint, never cached).
  **Prompt** = `input + cacheRead + cacheWrite`.
- **Growth** ("new context") = `min(cacheWrite_i, max(0, cached_i − cached_{i−1}))`: what the request wrote because the context grew; the
  first request's whole write. Not avoidable. `cacheWrite_i − growth_i` is the **rewrite**.
- **Miss** (prefix lost) = `max(0, min(cached_{i−1}, prompt_i) − cacheRead_i)` tokens: what the previous request left in the cache and this
  one did not read. Only a miss is avoidable. (The design's formula says `prompt_{i−1}`; that counts the previous input tail as lost every
  time: on the author's live log 79 808 of 79 846 steady-state steps would be "misses" of a few tokens.)
- **Cause** of a miss, the first that holds: `ttl` — the gap since the previous request (warming included) is longer than the TTL in force
  after it: 1 h if that line has `cacheWrite1h` > 0 or is a main session's in an arm with `mainCacheTtl` = `1h`, else 5 min; `fold` — the
  prompt fell below 80 % of the previous request's (the fold rule of the other tables; real fold and compaction entries live in session
  files, not in the meter log); `model` — the model changed (its own cache); `other` — a prefix change inside the TTL that the meter
  lines do not show: typically a system-prompt or tool-list change, a small fold or mask, an injected agent message. A real cost (the lost
  prefix is paid at the write price), not noise; the session files hold the reason, the meter line does not.
- **Fold and cold-resume events** (the rows *after folds* / *after cold resumes*): a **cold resume** is a turn request after a gap beyond
  the TTL in force (above); a **fold** is a turn request whose prompt fell below 80 % of the previous request's, unless the gap came
  first (a cold fold is a cold resume). An event's **window** is its request and the next two turn requests of the branch, cut short by
  the next event, so no request is paid twice. **Premium** of an event = the sum over its window of `miss × (write − read price)`
  (the extra cost over reading what the cache lost). **Baseline** = the mean premium of the turn requests outside every window
  (not the first one) in the sessions that have an event of that kind, once per event; **net** = premium − baseline. The old
  rows charged the whole cost of the next three requests, with no baseline (about 1.6–2× too much on the author's log).
- **$** at the line's input price *p* (`costUsd` ÷ its tokens weighted read 0.1, 5-minute write 1.25, 1 h write 2.0, output 5): a miss costs
  its tokens × (write − read) × *p*, new context its tokens × write × *p*. A 1 h write is a line's `cacheWrite1h` tokens (meter v2), or for a
  v1 line all of `cacheWrite` when the line is a Claude main session's (an Anthropic model or provider) in a `mainCacheTtl` 1h arm (an approximation: children and 5m arms write 5
  minutes).
- **1 h writes in `costUsd`.** pi 1.4 already charges 1 h cache writes at 2.0 × input in `costUsd`; the analyser's totals are the logged
  cost. Only the split of a cost by token component and the fold ledger's prices weigh 1 h writes 2.0 (they weighed every write 1.25).
- **miss share** (`meter-report`) = missed tokens ÷ `cacheWrite` tokens of the same requests; the old "rewrite share" counted every
  non-first write as a rewrite (94.7 % on the author's log, mostly ordinary growth).

### Analysis: experiments

How the Experiment section (and `meter-report --arms`) turns meter lines into effects.

- **Unit and stratum.** A unit is a root session (above) of an armed design. Its **stratum** is the billing class of the root's first main-session
  request: the line's own `billing` (meter v2) when it has one, else its provider's entry in `plans` (`token-meter/settings.json`: `subscription`,
  `api`, `free`, `local`; a provider without a plan is `api`). A child's provider does not decide. Without a usable `plans` entry the report says
  "plans absent": a v1 unit is then in `api`.
- **Objective** per stratum, per active hour: `apiUsd` for the cloud classes (Σ of the root's `costUsd`, children and warming included); `localCost`
  for `local` (Σ `durationMs` ÷ 3 600 000 × the provider's plan rate over the root's local-billed lines; requests to other providers, e.g. cloud children, are
  left out: a secondary column is M8), `wallMs` (Σ `durationMs` of the main's lines) when no local plan has a rate; `experiments/settings.json` `strata.<class>.objective` overrides it (`apiUsd`, `cashUsd`, `localCost`,
  `wallMs`, `points5h`, `points7d`; `cashUsd` is not computed yet and reads "not measurable"). Both timed objectives sum the lines that carry `durationMs`; a unit with none (a v1 line has no
  `durationMs`) has no objective, so a local stratum on v1 lines reads "not measurable". Lines without it (compactions, nested requests) add
  no time; the balance table shows the timed / untimed line counts.
- **Effect** of a factor in a stratum = ratio(high level) ÷ ratio(low level) − 1, ratio = Σ objective ÷ Σ active hours over the stratum's units at the
  level (a ratio of sums: a long unit weighs more than a short one, a $0 unit is not averaged in). Units under 0.05 active h (`MIN_HOURS`) are
  left out of the estimate; the balance table counts them. Strata are never pooled. The effects are marginal per factor and unadjusted: there is no interaction model (the earlier OLS table pooled the strata and was removed).
- **CI and power.** 2000 bootstrap draws, units resampled with replacement within each level, PRNG mulberry32 seed 1, percentiles 2.5/97.5. The
  minimum detectable effect is 2.80 × the sd of the bootstrap effects (α .05 two-sided, power .8). With fewer than 2 units at a level there is
  no CI and no MDE; an MDE of 0 (zero variance) reads "n/a"; bootstrap draws with a non-finite ratio are dropped and counted.
- **Balance table**: per stratum and arm, units over `MIN_HOURS`, their active hours, the units excluded, units without an objective.
- **Per arm** (kill switch, posterior; `meter-report --arms`): pooled over the design's strata, $ per active hour; its fold and cold-resume columns are
  the premium above (*Analysis: cache misses*), per event.

### Analysis: router observation

The *Delegation & routing* section reads the router's outcome log (a spawn, its reroutes, checks, verdicts) and the meter lines of the
child sessions. It observes the router and decides nothing; the vocabulary of the outcome log (`workerTier`, `assigned`, `routeBase`, …)
is the router's, `core/contract.ts` its copy. A field the router does not write yet is read untyped and guarded: its absence is reported
as "not measurable", never as a number.

- **Task rows.** One per spawn (the last spawn of a `taskId`). A spawn with `reviewOf` (or whose verdict has `reviewOf`) is a **spot-check
  review**, one with `unresolved: true` an **unresolved** card; the others are **routed tasks**. Cost of a task = the `apiUsd` of its child
  session and every session below it (`parentSessionId` chain), warming included; a task without a child session id has no cost.
- **Tier = the model the task ran on** (B6), not the tier the router planned (`workerTier`, which the router keeps for its planned leg). The
  model is the router's own account, `ranModel`: `workerModel` (the model the child started on), replaced by the last `reroute`'s
  `toModel` (`levelsOfLine`, *Older lines*); else the model of the child's last request in the meter (`provider/model`, warming and error
  lines aside); else `(unknown)`. The report orders the models by the planned tier most of their tasks had (qwen, haiku, T1, T2), then by name.
- **Planned → executed matrix**: the routed tasks counted by (`workerTier`, model it ran on); a planned qwen that ran on another model is
  visible there only.
- **Qwen share of tasks** is the share of routed tasks *planned* on `qwen`; the report states no target for it.

## Data contract (`pi-analyse --check`)

Required = the **required** column above, per event (the outcome log's: `docs/outcome-log.md` of the router); plus two relational rules the joins
need: a meter line of a session named as a child by a spawn event must carry
`parentSessionId`; a meter, spawn or guard line of a session whose root has an
assignment with `ts` ≤ the line's `ts` must carry `arm`. Lines of v0 are checked too
(legacy gaps show up as findings, not errors in the analysis). Optional fields (the †
ones of the outcome log: `assigned`, `routeBase`, `unresolved`, `cwd`, `reviewOf`, `requested`)
are never required, so lines written before they existed pass; when present their type is
checked (`assigned` `router` or `random`, `unresolved` boolean, `requested` `true`, the rest
non-empty strings), and `spotcheck` is a known event. The repo check
`log-contract` runs every writer's real code path and asserts `--check` passes and
every report section has data.

## Known gaps

- A **resumed** child session does not inherit its arm again (inheritance happens on the
  spawn event only), so its later meter lines miss `arm` (seen 2026-10-03).
- Quota readings of parallel sessions interleave and are slightly stale; per-root and per-arm
  quota is an attribution of the account's rise (see *Analysis*), approximate.
- Lines before 2026-10-03 have no `v` and partly no `arm`.
- Until 2026-10-27, a warm sent while a turn streamed (pi ≥ 1.4) left a `warming` line
  without usage carrying the TURN's headers and `ts`, and the turn line took the warm's
  headers or none (no `q5h`); the warm's own `cache_warm` usage got no line.
