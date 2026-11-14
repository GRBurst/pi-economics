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
| `experiments/assignments.jsonl` | experiments extension (main session) | root session's assignment (v2: eligible or not) | none |
| `experiments/blocks.json` | experiments extension | — (one JSON object: the explore queues) | rewritten atomically |
| `guards/events.jsonl` | experiments (correction, rating), cache-lifecycle (peek-after-mask) | guard event | none |
| `experiments/state.json` | `pi-analyse --apply`, `meter-report --arms --posterior` | — (one JSON object) | rewritten atomically |
| `reports/YYYY-MM-DD-HHMM-analysis.{md,json}` | `pi-analyse` | — | one pair per run (UTC; a rerun in the same minute replaces it) |

Settings read by the analysis: `token-meter/settings.json` (`dir`: meter directory,
relative to the agent dir unless absolute; default `meter`),
`experiments/settings.json` (`baseline` of the v1 engine's designs, `strata` objectives, `guards` thresholds),
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

assignments **v2** (redesign M5b.1): the experiments engine v2 — a stratum and design id per main session,
eligible or not; see *experiments/assignments.jsonl*. Readers keep reading v0 and v1 rows.

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
  and every descendant from the assignment's `ts` on (v2: only an eligible row has one). `meter.arm`, `outcomes.arm` (on
  spawn: the parent session's arm; routers before M5b.2 only, see *Join keys*) and `guards.arm` are copies of it at write time.
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
| `kind` | `turn` \| `warming` \| `nested` \| `compaction` | yes | an agent turn, a cache-warming request, a request made by an extension, pi's compaction summary (*Compaction lines*); a `levers` line is no request and has fields of its own (*Levers lines*) |
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
| `design` | string | when the experiments extension names the session's design | the experiment design of `arm`: the v2 engine's design id (a v1-engine arm names none) |
| `cacheWrite1h` | number | when the provider reports the split (Anthropic) | the part of `cacheWrite` written with the 1-hour TTL |
| `durationMs` | int (ms) | turn lines whose request the session sent | the session's last own provider request (a `before_provider_request` right after the agent loop's `context` event) to this `message_end`; a resend restarts it, a warm's or a compaction's send (no `context` event) does not |
| `ttftMs` | int (ms) | when a stream event followed that request | the request to its first `provider_stream_event` |
| `promptMs`, `genMs`, `cacheN`, `promptN` | int (ms, ms, tokens, tokens) | when the last stream event of the request that carries them has a llama.cpp `timings` object (an openai-completions stream: pi 1.4 passes each SDK chunk to `provider_stream_event` unchanged, and llama-server ends a stream with `timings`) | `timings.prompt_ms`, `timings.predicted_ms`, `timings.cache_n`, `timings.prompt_n`, each rounded and written iff it is a finite number ≥ 0; absent for any other provider (never 0) |
| `systemHash` | 16 hex digits | turn lines whose send ran pi's `context_with_system` (pi ≥ 1.4) | the first 16 hex digits of a sha256 over the system state the session sent: system prompt, prompt sections, tool list (name, description, parameters), replayed from that event's system messages as pi-ai does; a change between two requests of a branch is the cache-miss cause `prefix` (*Analysis: cache misses*). Neither the prompt nor the tools are written. Limits: it is the state as pi-ai folds the system messages; a model that takes system messages mid-conversation (the current Claude models on the `anthropic` provider) gets a later section or tool change appended after the cached prefix, which loses nothing, yet the hash changes; a prompt set by `forceSystemPrompt` (applied after `context_with_system`) is not seen |
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
{"v":2,"ts":"2026-11-03T10:00:04.200Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","input":12,"cacheRead":48000,"cacheWrite":1500,"cacheWrite1h":1500,"output":420,"costUsd":0.06,"status":200,"retries":0,"retryWaitMs":0,"durationMs":4200,"ttftMs":900,"systemHash":"3f9a0c2d71e4b856","q5h":12,"q5hReset":"2026-11-03T14:00:00.000Z","q7d":31,"q7dReset":"2026-11-07T00:00:00.000Z"}
{"v":2,"ts":"2026-11-03T10:01:00.300Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","status":"error","retries":0,"retryWaitMs":0,"errorClass":"429","errorKind":"rate_limit","durationMs":300}
{"v":2,"ts":"2026-11-03T10:01:07.400Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","input":30,"cacheRead":49500,"cacheWrite":800,"cacheWrite1h":800,"output":510,"costUsd":0.05,"status":200,"retries":1,"retryWaitMs":2000,"durationMs":5100,"ttftMs":1100,"systemHash":"3f9a0c2d71e4b856","q5h":13,"q5hReset":"2026-11-03T14:00:00.000Z","q7d":31,"q7dReset":"2026-11-07T00:00:00.000Z"}
{"v":2,"ts":"2026-11-03T10:55:37.000Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","kind":"warming","billing":"subscription","input":0,"cacheRead":50300,"cacheWrite":0,"output":1,"costUsd":0.03,"status":200}
{"v":2,"ts":"2026-11-03T11:02:00.800Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","status":"error","retries":0,"retryWaitMs":0,"errorClass":"400","errorKind":"context_overflow","durationMs":800}
{"v":2,"ts":"2026-11-03T11:10:21.000Z","sessionId":"s-child","parentSessionId":"s-main","arm":"-+-","provider":"llama","model":"qwen3.8","kind":"turn","billing":"local","input":2400,"cacheRead":0,"cacheWrite":0,"output":350,"costUsd":0,"status":200,"retries":0,"retryWaitMs":0,"durationMs":21000,"ttftMs":2600}
```

### Compaction lines

pi's own compaction (at the threshold, after a context overflow, `/compact`) asks the model for a summary outside the
agent loop: no `before_provider_request`, `after_provider_response` or `message_end` sees that request. Its
`session_compact` event carries the compaction entry with the request's `usage` (pi 1.4), and the meter writes one
`kind: "compaction"` line from it: `provider`/`model` = the session's model at that moment (`unknown` when an extension
made the summary, `fromExtension`; on a virtual model the virtual one, though pi summarizes with the model it resolves to), `status` 200, tokens and `costUsd` from the entry; no `durationMs`, `ttftMs`,
`retries` or quota fields (not observed). An entry without usage gets no line. With infinite-context loaded pi never
compacts (it cancels every `session_before_compact`), so these lines come from sessions without it. The analysis counts them
as requests (cost, *By model*, active hours, quota) but not as a step of the session's cached branch: the *Cache* branches take
turn and warming lines only, the fold ledger agent turns (and warms as readers of the prompt). Their `durationMs` is unknown, so
the experiment's timed objectives (`wallMs`, `localCost`) leave them out.

```jsonl
{"v":2,"ts":"2026-11-03T12:30:10.000Z","sessionId":"s-bench","provider":"anthropic","model":"claude-opus-5-5","kind":"compaction","billing":"subscription","input":152000,"cacheRead":0,"cacheWrite":0,"output":2100,"costUsd":0.81,"status":200}
```

### Levers lines

The value of each lever (a pi setting, an extension's or pi-economics' own control) a session ran with, who decided it
and whether it was read back (design §5.3). One line per session at its first `before_agent_start`, then a new line only
when a lever changed (the line without `ts` differs): a session's levers at any moment are those of its last levers line
before it. The last line decides: a lever read back `confirmed` at one prompt and changed by an
extension at a later one is `refused` from that line on, and an analysis that reads a session's last line (per-protocol) leaves
it out whatever the earlier prompts showed. Every request reader skips these lines (`pi-analyse`, `meter-report`, the request rules of `--check`).

| field | type | required | meaning |
| --- | --- | --- | --- |
| `v` | `2` | yes | schema version |
| `ts` | ISO time | yes | when the levers were read |
| `sessionId` | string | yes | pi session id |
| `parentSessionId` | string | children | as on request lines |
| `kind` | `levers` | yes | |
| `arm`, `design` | string | as on request lines | experiment arm and design |
| `eligible` | boolean | yes | the session is an experiment unit: a main session with an arm (a child is no unit of its own: `false`, even with its root's arm) |
| `stratum` | string | with an arm of the v2 engine | the experiment stratum of the session (a child: its root's) |
| `levers` | object | yes | lever id → state `{ v, s, a?, rb?, tier? }` |

A state: `v` = the effective value, a level name, a number or a boolean (never free text); `s` = its source, `pe`
(pi-economics assigned it), `ext` (an extension chose it: its default or its own experiment) or `fixed` (configuration or
pi's default); `a` = the value pi-economics assigned and `rb` = the read-back, both present exactly when it assigned one:
`confirmed` (`v` = `a`), `refused` (`v` ≠ `a`, `s` is `ext` or `fixed`) or `unverified` (no observer: `v` = `a` assumed);
`tier` = how the add-on applied it (`seed`, `control`, `replace`, `shadow`). The writer drops an engine state that breaks one of
these rules (one warning per lever id; the line is written without it) and refuses a line over 4 KiB or one whose own
observation breaks them (it then warns once and writes none).

Observed today, all `s: "fixed"`: pi's settings as pi 1.4 merges them (`<agentDir>/settings.json`, overridden key by key by
`<cwd>/.pi/settings.json` when the project is trusted, pi's defaults for unset keys; each file migrated first as pi does,
`websockets` → `transport`, `retry.maxDelayMs` → `retry.provider.maxRetryDelayMs`; `defaultTools` lists of `+name`/`-name` modify
the inherited selection): `pi.cacheWarming` (global only), `pi.promptCache` (`PI_CACHE_RETENTION`), `pi.compaction.{enabled,reserveTokens,keepRecentTokens}`
(per-model overrides of the session's model), `pi.branchSummary.{reserveTokens,skipPrompt}`, `pi.codemode.{mode,inlineBudget}`,
`pi.transport`, `pi.retry.{enabled,maxRetries,baseDelayMs,maxAgentDelayMs}`, `pi.retry.provider.{timeoutMs,maxRetries,maxRetryDelayMs}` (`timeoutMs` defaults to `httpIdleTimeoutMs`, parsed as pi does; `"disabled"` or
0 = 2147483647),
`pi.images.{autoResize,blockImages}`, `pi.thinkingBudgets.{minimal,low,medium,high}`, `pi.defaultThinkingLevel` (the configured default
for a new session: the session model's `modelThinkingLevels` entry, else `defaultThinkingLevel`, else `medium`; not the level the session
ran with, which a resumed session's recorded level, `/thinking`, a CLI option or clamping to the model can change: that one is `effort` on
the request lines; the effective level is the add-on lever `pi.thinkingLevel` below) and
`pi.defaultTools.<tool>` (a boolean per pi tool: read, bash, powershell, edit, write, grep, find, ls, codemode, tool_search). A value pi
would reject leaves its lever out (unknown); `cacheWarming` falls back to `streaming` as in pi. With infinite-context's settings entry on
the session branch `pi.compaction.enabled` is `{ "v": false, "s": "ext" }` (it cancels every native compaction); the other
`pi.compaction.*` levers are then inert and the analysis leaves them out. The entry stays on the branch: a session resumed in a pi
without infinite-context still reads `{ false, ext }`.

`pe`, `a`, `rb` and `tier` come from the experiments engine (redesign M5b.2): on the extensions' internal channel
`pi-economics:levers:v1` (each runtime's own `pi.events`) it publishes a session's assignment with the states of its
add-ons' levers, and the meter adds them to the line. Where the meter observed the same lever differently (a pi setting, an
extension's evidence), the observation wins: its value and source, the engine's assignment kept as `a` with `rb: "refused"`
(`confirmed` pe when the observation equals `a`). The add-ons today are the bench-only `pi.compaction.enabled`,
`pi.compaction.reserveTokens` and `pi.compaction.keepRecentTokens` (tier `seed`, read back from pi's effective settings:
the trusted project's over the global file, `compaction.modelOverrides` of the session's model, pi's default when unset; a
level the settings did not carry reads back `refused`; they are not in the catalogue of online levers) and cache-lifecycle's
`cache-lifecycle.warmPolicy`, `cache-lifecycle.mainCacheTtl` and `cache-lifecycle.maskOnCold` (tier `replace`:
cache-lifecycle applies the assigned level itself; a lever starts only once cache-lifecycle asked the channel in that
runtime). `mainCacheTtl` is read back from each assistant `message_end`'s usage (`cacheWrite1h` > 0: `1h`, other cache
writes: `5m`, no cache write: nothing seen); `warmPolicy` and `maskOnCold` have no observer and stay `unverified`. `mainCacheTtl`
is a main session's lever: cache-lifecycle writes 5 m in a child whatever the arm says, so a child's levers line carries
no entry for it.
The seed tier adds `infinite-context.nudgeAtTokens` (redesign M7a) in a session whose factor is on it: `v` and `a` are
tokens (the level is a fraction of the matched rule's range), `rb` is read from infinite-context's settings record on the branch
(`confirmed`; an extension that redrew: `refused`, `s: "ext"`, `v` = its draw), and a rule that is a fixed number gives `refused`,
`s: "fixed"`, `a` = the level (a fraction: there are no tokens to assign).
Two data-only kinds set pi itself (redesign M7b; tier `control`, read back at `before_agent_start`, a main session's levers: a
child's levers line omits both, its level and tools are the actor's): `pi.thinkingLevel` (levels `off`, `minimal`, `low`, `medium`,
`high`, `xhigh`; set with `setThinkingLevel` when the engine's session starts and read back with `getThinkingLevel`: the level the
session runs with, where `pi.defaultThinkingLevel` is the configured default) and `pi.activeTool(<name>)` (levels `false`, `true`:
whether `getActiveTools` lists the tool; a tool pi does not register is infeasible and reads back `fixed`: nobody chose that). A
value other than the assigned one is `refused`, with source `fixed` when it is what pi reported right after the engine set it
(pi clamped the level to the model's, or would not activate the tool) and `ext` otherwise (another extension, `/thinking` or pi's reset at a model switch changed it afterwards: the
source does not tell them apart). In a resumed or reloaded session pi restores the level before the engine starts, so
the engine does not set `pi.thinkingLevel` there (the active tools are still set): it reads back what the session runs with,
`refused` and `fixed` when that is not the assigned level (a change after the start: `ext`). The data-only seed kind `session-entry(<customType>,<field>)` (redesign M7c; tier `seed`,
read back at `before_agent_start`, also in a child, seeded with its root's level) appends the custom entry `{ <field>: <level> }`
to the session branch before an extension that adopts recorded values reads it, and reads back the latest entry of that type:
the seed when the target adopted it, the target's own record (`refused`, source `ext`) when it drew another value. A record whose field holds no level a levers line can carry (an object, `null`, a string that is no level
name) counts as another value, recorded as `invalid` (never the assigned level). The factor declares a `target` (a name pi
lists as a tool or a command): the seed is no evidence, a target pi lists is, so `confirmed` needs the target listed at the
read-back and the latest record to hold the level; without a `target`, or with the target not listed, the state stays
`unverified`. A record the target wrote that differs from the level is `refused` whether or not the target is listed. A
target that is listed but ignores the seed without recording anything still reads `confirmed`: the read-back sees what the
target records, never that it adopted.
When the branch already holds another record of the type at the seed (a target that runs before pi-economics recorded its own
value; extension order is the consumer's), the seed is appended all the same but the state stays `unverified` until a later
entry, the target's, shows what it used; the engine does not append the seed again when the latest record already holds
the level (a reload).
A level name may start with a digit (`5m`, `1h`) and holds lowercase letters, digits, `_` and `-` (at most 32 characters). A read-back that changes
a state writes a new levers line. A child runtime's experiments never draws: it derives its root's assignment (the
session file's directory `subagents/<root>/`, or for an in-memory child the actor's agent list) and serves it on the
child's own channel, so an in-memory child (no session file) takes its `parentSessionId` and the root's `arm`, `design`
and `stratum` from there. The actor binds children headless: an in-memory session with a UI is never a child. Residual
for in-memory sessions without a UI (print mode), in the short window while the actor creates a child: a new main can be
taken for the previous main's child, and a child created after the actor dropped its records for a main.

A main session's first line (complete), its line after the first read-backs (`mainCacheTtl`; `pi.thinkingLevel`, which pi clamped
to the model's highest) and a child line under infinite-context (both shortened: the writer always writes every lever; the
child's omits the main-only levers):

```jsonl
{"v":2,"ts":"2026-11-03T09:59:58.100Z","sessionId":"s-main","kind":"levers","arm":"010","design":"b4d458675108","eligible":true,"stratum":"api","levers":{"pi.cacheWarming":{"v":"streaming","s":"fixed"},"pi.promptCache":{"v":"short","s":"fixed"},"pi.compaction.enabled":{"v":true,"s":"fixed"},"pi.compaction.reserveTokens":{"v":16384,"s":"fixed"},"pi.compaction.keepRecentTokens":{"v":20000,"s":"fixed"},"pi.branchSummary.reserveTokens":{"v":16384,"s":"fixed"},"pi.branchSummary.skipPrompt":{"v":false,"s":"fixed"},"pi.codemode.mode":{"v":"on","s":"fixed"},"pi.codemode.inlineBudget":{"v":3000,"s":"fixed"},"pi.transport":{"v":"auto","s":"fixed"},"pi.retry.enabled":{"v":true,"s":"fixed"},"pi.retry.maxRetries":{"v":3,"s":"fixed"},"pi.retry.baseDelayMs":{"v":2000,"s":"fixed"},"pi.retry.maxAgentDelayMs":{"v":60000,"s":"fixed"},"pi.retry.provider.timeoutMs":{"v":300000,"s":"fixed"},"pi.retry.provider.maxRetries":{"v":0,"s":"fixed"},"pi.retry.provider.maxRetryDelayMs":{"v":60000,"s":"fixed"},"pi.images.autoResize":{"v":true,"s":"fixed"},"pi.images.blockImages":{"v":false,"s":"fixed"},"pi.thinkingBudgets.minimal":{"v":1024,"s":"fixed"},"pi.thinkingBudgets.low":{"v":2048,"s":"fixed"},"pi.thinkingBudgets.medium":{"v":8192,"s":"fixed"},"pi.thinkingBudgets.high":{"v":16384,"s":"fixed"},"pi.defaultThinkingLevel":{"v":"medium","s":"fixed"},"pi.defaultTools.read":{"v":true,"s":"fixed"},"pi.defaultTools.bash":{"v":true,"s":"fixed"},"pi.defaultTools.powershell":{"v":false,"s":"fixed"},"pi.defaultTools.edit":{"v":true,"s":"fixed"},"pi.defaultTools.write":{"v":true,"s":"fixed"},"pi.defaultTools.grep":{"v":false,"s":"fixed"},"pi.defaultTools.find":{"v":false,"s":"fixed"},"pi.defaultTools.ls":{"v":false,"s":"fixed"},"pi.defaultTools.codemode":{"v":false,"s":"fixed"},"pi.defaultTools.tool_search":{"v":false,"s":"fixed"},"cache-lifecycle.warmPolicy":{"v":"native","s":"pe","a":"native","rb":"unverified","tier":"replace"},"cache-lifecycle.mainCacheTtl":{"v":"1h","s":"pe","a":"1h","rb":"unverified","tier":"replace"},"cache-lifecycle.maskOnCold":{"v":"off","s":"pe","a":"off","rb":"unverified","tier":"replace"}}}
{"v":2,"ts":"2026-11-03T10:00:04.200Z","sessionId":"s-main","kind":"levers","arm":"010","design":"b4d458675108","eligible":true,"stratum":"api","levers":{"pi.cacheWarming":{"v":"streaming","s":"fixed"},"cache-lifecycle.warmPolicy":{"v":"native","s":"pe","a":"native","rb":"unverified","tier":"replace"},"cache-lifecycle.mainCacheTtl":{"v":"1h","s":"pe","a":"1h","rb":"confirmed","tier":"replace"},"cache-lifecycle.maskOnCold":{"v":"off","s":"pe","a":"off","rb":"unverified","tier":"replace"},"pi.thinkingLevel":{"v":"high","s":"fixed","a":"xhigh","rb":"refused","tier":"control"}}}
{"v":2,"ts":"2026-11-03T11:10:00.000Z","sessionId":"s-child","parentSessionId":"s-main","kind":"levers","arm":"010","design":"b4d458675108","eligible":false,"stratum":"api","levers":{"pi.compaction.enabled":{"v":false,"s":"ext"},"pi.compaction.reserveTokens":{"v":16384,"s":"fixed"},"pi.defaultThinkingLevel":{"v":"medium","s":"fixed"},"cache-lifecycle.warmPolicy":{"v":"native","s":"pe","a":"native","rb":"unverified","tier":"replace"},"cache-lifecycle.maskOnCold":{"v":"off","s":"pe","a":"off","rb":"unverified","tier":"replace"}}}
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
  `experiments/assignments.jsonl`, written by routers before pi-economics
  M5b.2 only: since M5b.2 no extension reads pi-economics, a spawn carries no
  `arm`, and the analyses (`pi-analyse`, `meter-report --arms`) join the arm
  of the spawner's root assignment (up the `parentSessionId` chain); a spawn
  without one stays a task with no arm. `pi-analyse --check` requires none.
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

Lines written before the router named its models and levels carry tiers and route labels only (the router's change is dated
2026-10-17; a log's first line with the new fields can be days later, and the lines between are label-only). Readers map them with
`levelsOfLine` (`core/levels.ts`), which returns a line with the fields of the router's outcome log as written. The tables below are
data, `core/legacy-routes.json` (`models`, `levels`, `chain`), read for a line **without those fields**, whatever its `ts`: a spawn
with neither `ability` nor `workerModel`, an escalate with none of `ability`, `fromModel`, `toModel`, a reroute for the model it
does not name (per field: `fromModel`/`toModel` as written, else the label mapped). A line that has them yields the models and levels
it carries (`workerModel`, `fromModel`, `toModel`, `workerLevel`, `fromLevel`, `toLevel`), or none, and is never mapped from a label.

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

Rows of the v1 engine (v0, v1):

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
The v1 engine's last assignments carried `design: "v4"`; resumed v1–v4 sessions keep their rows, arms
and flags (the v2 engine never counts them in its blocks). A row without
`design` whose arm has 3 characters counts as v4.

### Assignments v2

The experiments engine v2 (redesign M5b.1, §5.4, §7.3) writes one `v: 2` row per main
session at its first `session_start`, eligible or not; children get none (they inherit their
parent's assignment). A resumed or reloaded session reuses its row (the session's custom entry
`pi-economics:assignment`); a forked one is a new session with a row of its own. A model switch
later in the session changes nothing (intention to treat).

Children and `eligible`: the unit is the main session. On the extensions' internal channel
(`pi-economics:levers:v1`), a child's `Assigned.eligible` is its root unit's (with its `design`,
`stratum`, `arm`, `factors`): the child runs its root's arm. A child's levers line says whether
the session is a unit of its own, so it is `false` there.

| field | type | required | meaning |
| --- | --- | --- | --- |
| `v` | `2` | yes | schema version |
| `ts` | ISO time | yes | assignment time (session start) |
| `sessionId` | string | yes | main session |
| `design` | string | eligible; with `stratum` | the stratum's design id: 12 hex of the design's content (levers, levels, generators) |
| `mode` | `off` \| `explore` \| `exploit` | yes | selection mode |
| `eligible` | boolean | yes | the session takes part: a main whose model at session start matched a stratum, `mode` not `off`, an arm left enabled |
| `stratum` | string | eligible | the first stratum (setting `strata`, default: one per billing class) the model matched |
| `arm` | string | eligible only | one bit per factor in factor order, `1` = the high level (`""` for a stratum without factors) |
| `factors` | object | eligible only | factor name → `{ "lever": "<target>.<name>", "assigned": <level> }` |
| `parentSessionId` | string | no | not written by the engine (children have no row); only on the channel's `Assigned` of a child |

Every row with an `arm` names its `design`: a design id never looks like `"v4"`, so a
3-character arm is never taken for design v4. Explore draws permuted blocks per design and
stratum (`experiments/blocks.json`); exploit samples the design's posterior in its stratum.

```jsonl
{"v":2,"ts":"2026-11-13T09:00:00.000Z","sessionId":"s-main","design":"b4d458675108","mode":"explore","eligible":true,"stratum":"api","arm":"010","factors":{"warmPolicy":{"lever":"cache-lifecycle.warmPolicy","assigned":"native"},"mainCacheTtl":{"lever":"cache-lifecycle.mainCacheTtl","assigned":"1h"},"maskOnCold":{"lever":"cache-lifecycle.maskOnCold","assigned":"off"}}}
{"v":2,"ts":"2026-11-13T09:30:00.000Z","sessionId":"s-local","design":"0613569db02a","mode":"explore","eligible":true,"stratum":"local","arm":"","factors":{}}
{"v":2,"ts":"2026-11-13T10:00:00.000Z","sessionId":"s-off","design":"b4d458675108","mode":"off","eligible":false,"stratum":"api"}
{"v":2,"ts":"2026-11-13T11:00:00.000Z","sessionId":"s-other","mode":"explore","eligible":false}
```

### Bench assignment

The bench (redesign §10, M9) writes `<agentDir>/experiments/assignment.json` into a factor arm's per-run agent dir: the run's
arm, so the experiments engine adopts it at the main session's first `session_start` instead of drawing (whatever its mode).
The engine turns it into the usual v2 row, entry and channel state (`stratum` `bench`); a file that is not a v 1
assignment is ignored with a warning. Pi process levers named in `factors` are read back from the effective settings
(`pi.compaction.enabled`, `pi.compaction.reserveTokens`, `pi.compaction.keepRecentTokens`; tier `seed`).

| field | type | meaning |
| --- | --- | --- |
| `v` | `1` | schema version of this file |
| `design` | string | 12 hex: the content id of the arm's levers and their levels over every arm of the bench |
| `stratum` | `"bench"` | |
| `arm` | string | the bench arm's name (`orch-+-+`, an `arms.json` name) |
| `factors` | object | factor name → `{ "lever": "<target>.<name>", "assigned": <level> }` (router factors: `task-router.<name>`) |

```json
{"v":1,"design":"0123456789ab","stratum":"bench","arm":"orch-compact","factors":{"routing":{"lever":"task-router.routing","assigned":"on"},"pi.compaction.reserveTokens":{"lever":"pi.compaction.reserveTokens","assigned":8000}}}
```

## guards/events.jsonl

| field | type | required | meaning |
| --- | --- | --- | --- |
| `v` | int | yes (v ≥ 1) | schema version |
| `ts` | ISO time | yes | event time |
| `sessionId` | string | yes | session |
| `arm` | string | when the root has an assignment | the session's arm |
| `design` | string | with an arm of the v2 engine | the arm's design id (experiments' corrections and ratings) |
| `event` | `correction` \| `rating` \| `peek-after-mask` | yes | user correction right after an assistant turn (regex), `/rate N`, `context_peek` after cache-lifecycle masked tool output |
| `value` | int 1–5 | `rating` | the rating |

## experiments/state.json

`{ "disabled": string[], "posterior": { <arm>: { "mean": −$/active h, "sd": number } }, "reasons": { <arm>: string } }`.
Disabled arms stay disabled until the file is edited. These flat keys belong to the v1–v4
designs (arm ids like `-+-`). The v2 engine reads, and `meter-report --posterior` and
`pi-analyse --apply` write, `designs.<design id>.<stratum>`
= `{ "posterior": { <arm>: { "mean", "sd" } }, "disabled": [<arm>], "reasons": { <arm>: string } }`
(one entry per design and stratum, never pooled: the kill switch and the posterior use that stratum's
units alone; `disabled` only grows, `posterior` is rewritten, `reasons` is merged; other designs, strata
and keys stay). The engine reads it at session start (exploit samples from `posterior`; no arm in
`disabled` is assigned; with every arm disabled the session is ineligible). A v2 arm is never
written to the flat keys. The posterior is API-eq $ per active hour: a stratum whose objective is not `apiUsd` (`wallMs`, `localCost`, `points*`, `cashUsd`) has no estimator yet, so its `posterior` is `{}` and the engine draws from the blocks; the kill switch does not depend on the objective.

`experiments/blocks.json`: `{ "<design id>/<stratum>": { "queue": [<arm>] } }`, the arms
left in each explore block (refilled with a shuffle of the enabled arms when empty). A block whose `queue` is no list of
strings is rebuilt (the user is told once); each writer renames its own temporary file over it.

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
  account's rise seen between pi requests (the `q5h`/`q7d` %/active hour rows of *Fleet*; the report no longer shows it as a share of the account's quota: its denominator was only seen through pi's own requests); a lone root gets
  the full rise, two identical parallel roots half each. A root without any reading has no
  quota figure. 1 % steps make per-root figures coarse; they are fair only over many steps.
- **Designs v2 and v3** are analysed alike (same factors) but as separate tables, v4 (its own
  three factors) in a third: a unit
  (root session) belongs to the design named by its root's first assignment row (arm length
  when there is none); guard events and verdicts are attributed the same way (spawn events by
  their `parentSessionId`) before they are keyed by arm. `--apply` writes one posterior per arm id,
  from the newest design.
- **Fold ledger** (*Cache*, Claude models only). A **fold** = a turn request whose prompt
  (`input + cacheRead + cacheWrite`) is below 80 % of the previous turn request's in the
  same session (compaction lines are no part of it, *Compaction lines*) (the rule of the *after folds* split). For each fold:
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
    `r` = the model's read ratio × `p` (0.1 by default, 0.05 for Opus 5.5 and Sonnet 5.5), `w = 1.25·p` (5-minute write), `w1h = 2.0·p` (the fold request's 1 h share of its writes is paid at `w1h`).
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
- **Randomized comparison.** See *Analysis: router observation*.
- **Spot-check agreement.** See *Analysis: router observation*.
- **Levers** (*Levers lines*). Units = the sessions with a line of the meter log in the period (a request or a levers line), each with its last levers line up to the
  period's end (one written before the period counts: levers lines are written on change only). Per lever: the sessions, the
  distribution of `v` (the four most frequent values), the sources and the read-backs; refusal rate = refused ÷ assigned (a factor
  refused in > 20 % of its sessions points at a broken add-on). In a session where infinite-context disables compaction
  (`pi.compaction.enabled` `false`, `ext`) the other `pi.compaction.*` levers are inert and left out.

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
- **Cause** of a miss, the first that holds: `ttl` — the gap is longer than the TTL in force after the previous request: it runs from
  the latest send before the request (warming included) to the request's own send, a send being `ts − durationMs` (meter v2; `ts` on
  lines without `durationMs`), so a long response does not age the prefix it read; the TTL is 1 h if that line has `cacheWrite1h` > 0
  or is a main session's in an arm with `mainCacheTtl` = `1h`, else 5 min; `fold` — the prompt fell below 80 % of the previous
  request's (the fold rule of the other tables; real fold and compaction entries live in session files, not in the meter log);
  `model` — the model changed (its own cache); `prefix` — the system state changed: the line's `systemHash` differs from the last
  one before it in the branch (system prompt, a prompt section or the tool list; v2 lines with `systemHash` only): the system state changed,
  which is no proof that the change cost the prefix (see the limits of `systemHash`); `other` — a prefix
  change inside the TTL that the meter lines do not show: a small fold or mask, an injected agent message, a system change on lines
  without a `systemHash`. A real cost (the lost prefix is paid at the write price), not noise; the session files hold the reason, the
  meter line does not.
- **Fold and cold-resume events** (the rows *after folds* / *after cold resumes*): a **cold resume** is a turn request after a gap beyond
  the TTL in force (above); a **fold** is a turn request whose prompt fell below 80 % of the previous request's, unless the gap came
  first (a cold fold is a cold resume). An event's **window** is its request and the next two turn requests of the branch, cut short by
  the next event, so no request is paid twice. **Premium** of an event = the sum over its window of `miss × (write − read price)`
  (the extra cost over reading what the cache lost). **Baseline** = the mean premium of the turn requests outside every window
  (not the first one) in the sessions that have an event of that kind, once per event; **net** = premium − baseline. The old
  rows charged the whole cost of the next three requests, with no baseline (about 1.6–2× too much on the author's log).
- **$** at the line's input price *p* (`costUsd` ÷ its tokens weighted by the model's ratios: read 0.1 (0.05 for Opus 5.5 and Sonnet 5.5), 5-minute write 1.25, 1 h write 2.0, output 5): a miss costs
  its tokens × (write − read) × *p*, new context its tokens × write × *p*. A 1 h write is a line's `cacheWrite1h` tokens (meter v2), or for a
  v1 line all of `cacheWrite` when the line is a Claude main session's (an Anthropic model or provider) in a `mainCacheTtl` 1h arm (an approximation: children and 5m arms write 5
  minutes).
- **1 h writes in `costUsd`.** pi 1.4 already charges 1 h cache writes at 2.0 × input in `costUsd`; the analyser's totals are the logged
  cost. Only the split of a cost by token component and the fold ledger's prices weigh 1 h writes 2.0 (they weighed every write 1.25).
- **miss share** (`meter-report`) = missed tokens ÷ `cacheWrite` tokens of the same requests; the old "rewrite share" counted every
  non-first write as a rewrite (94.7 % on the author's log, mostly ordinary growth).

### Analysis: budget

The *Budget* section comes first in the report: the quota is the budget, not the comparison metric of experiments (those compare API-eq $
for cloud setups and the local cost for local ones). Quota arrives **in whole percent** (`q5h`, `q7d`; about 460–560 requests per 1 % step
in 2026-11) and is shared by every session, subagent and other client of the account, so no session or arm is charged quota points.

- **Window** = one provider's `q5h`/`q7d` reset period, identified by (provider, kind, `<key>Reset`); it starts 5 h or 7 d before its
  reset. Lines carry the readings; only a subscription provider has windows (`plans.<provider>.windows` names the kinds; without a plan
  whatever the lines carry). **Peak** = the highest reading. The **cap** was hit at the first reading of 100, else at the first
  rate-limit error after a reading of 99; **time to cap** = cap − window start, **lockout** = reset − cap (the quota stays at the cap
  until the reset). **Complete** = the window is over (a later line exists) and the log reaches back to its start.
- **$ of a window** = the API-eq $ of every line of the provider with `ts` in [start, reset) (all sessions, children and warming
  lines), split by token component (`input`, `cacheRead`, `cacheWrite` = 5-minute and 1 h writes together, `output`) with the model's
  price ratios (`core/analyse/prices.ts`: pi 1.4's registry, the `anthropic` provider's entries, the registry's price depends on the provider: Opus 5.5 and Sonnet 5.5 read at 0.05 × input; another provider's line, or a model without an
  entry uses read 0.1, write 1.25, 1 h write 2.0, output 5). **API-eq $** is the list price of the tokens, **cash $** what is charged
  (the API-eq $ of billing class `api`, else 0), **est. points** a calibrated β applied to a premium (*Analysis: cache misses*).
- **429 requests** = error lines that are rate limits (v1 `errorClass` `429`, v2 `errorKind` `rate_limit`); **retry wait** = Σ
  `retryWaitMs` of the window's lines (v1: pi-retry's totals, v2: pi's native retries), whatever failed. Both belong to the limit that was capped: the one whose highest reading of the current window (not yet reset) is at 99 or more at that line (both when both are; the 5-hour one when neither is: a short limit that is no cap), so a 7-day lockout is not counted in 5-hour windows. A window none of whose lines
  carries `retryWaitMs` shows **not observable**, never 0.
- **Calibration** (per provider and kind, complete windows only, at least 8): peak ≈ Σ β_c × $_c, a non-negative least-squares fit
  (NNLS, Lawson–Hanson; no intercept). Reported: β (points per API-eq $ of the component; 1 = the quota weighs a token as its list price
  does), centred R², σ, and **$/point** per window (window $ ÷ peak). Flags, never an automatic change: `r2` (R² < 0.8), `residual`
  (a window's residual > 3σ, σ = √(SSE ÷ (n − 4)); a single outlier can reach 3σ only from 14 windows on), `drift` (Σ$ ÷ Σpoints over the
  windows ending in the last 28 days against the 28 before differs by more than 15 %), `beta` (a component with ≥ 1 % of the $ whose β
  is outside [0.5, 2] × the $-weighted mean β). Below 8 complete windows the report says how many it has.
- **Spend** by billing class (a line's own `billing`, else its provider's plan, else `api`) and **local cost**. A request's interval is
  [`ts` − `durationMs`, `ts`]. **Request hours** = Σ `durationMs` of a provider's local requests (concurrent ones add up; what an experiment charges
  a unit); **machine hours** = the measure of the union of the intervals. **Local cost** = machine hours × the plan's hourly rate, in the
  rate's currency: the server runs one request at a time, so overlapping requests queue and the machine is busy once. A failed request (an
  `error` line with `durationMs`) occupies the machine and counts in both hours, but is no request; a warming line is none. Requests without
  `durationMs` are counted apart and add no time; a provider with a rate but no timed request, or without a rate, has **no cost** (the
  report says why, and shows the summed request time): never 0. **Queue share** = 1 − machine ÷ request hours (0 without time):
  above 0, local requests overlapped and queued, so an experiment's per-unit cost exceeds the share of machine time. **Per-model rows** (the
  q5 and q4 llama profiles are two model ids of one provider, so one rate): requests, request hours, output tokens, tokens per second
  (output ÷ `genMs` over the lines that carry it, else ÷ `durationMs`; the basis is shown) and the cost per 1M output tokens = the provider's
  rate × the model's request hours ÷ the output tokens of all its timed requests. **Prefix reuse** = Σ `cacheN` ÷ Σ (`cacheN` + `promptN`) over lines that
  carry both, else Σ `cacheRead` ÷ Σ (`input` + `cacheRead`). **Costs by currency**: the cash $ of the `api` class (USD) and each rate's currency, one row per
  currency; a **total** only when there is one currency, or every currency converts to USD with `currency.rates` (`"FROM/TO"`: 1 FROM = rate TO;
  the inverse of `"TO/FROM"` when only that is set; when both are set the direct one is used; never chained through a third currency); otherwise
  the currencies stay apart. A guessed class (a v1 line, no plan for its provider: counted as `api`) makes its **cash $** cell an
  upper bound (`≤ …`), and without any usable plan entry the report says *plans absent*.

A capped window as lines (the 5-hour window of reset 14:00 reached 97 %, then 100 % at 12:30; a request at 12:40 was rate-limited):

```jsonl
{"v":2,"ts":"2026-11-03T12:00:04.200Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","input":12,"cacheRead":48000,"cacheWrite":1500,"cacheWrite1h":1500,"output":420,"costUsd":0.06,"status":200,"retries":0,"retryWaitMs":0,"durationMs":4200,"ttftMs":900,"q5h":97,"q5hReset":"2026-11-03T14:00:00.000Z","q7d":31,"q7dReset":"2026-11-07T00:00:00.000Z"}
{"v":2,"ts":"2026-11-03T12:30:00.000Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","input":30,"cacheRead":49500,"cacheWrite":800,"cacheWrite1h":800,"output":510,"costUsd":0.05,"status":200,"retries":0,"retryWaitMs":0,"durationMs":5100,"ttftMs":1100,"q5h":100,"q5hReset":"2026-11-03T14:00:00.000Z","q7d":31,"q7dReset":"2026-11-07T00:00:00.000Z"}
{"v":2,"ts":"2026-11-03T12:40:00.800Z","sessionId":"s-main","arm":"-+-","provider":"anthropic","model":"claude-opus-5-5","effort":"high","kind":"turn","billing":"subscription","status":"error","retries":0,"retryWaitMs":0,"errorClass":"429","errorKind":"rate_limit","durationMs":300}
```

Window start 09:00, cap at 12:30: time to cap 3.5 h, lockout 1.5 h, peak 100, one 429 request, two requests.

### Analysis: experiments

How the Experiment section (and `meter-report --arms`) turns meter lines into effects.

- **Unit and stratum.** A unit is a root session (above) of an armed design. Its **stratum** is the billing class of the root's first main-session
  request: the line's own `billing` (meter v2) when it has one, else its provider's entry in `plans` (`token-meter/settings.json`: `subscription`,
  `api`, `free`, `local`; a provider without a plan is `api`). A child's provider does not decide. Without a usable `plans` entry the report says
  "plans absent": a v1 unit is then in `api`.
- **Objective** per stratum, per active hour: `apiUsd` for the cloud classes (Σ of the root's `costUsd`, children and warming included); `localCost`
  for `local` (Σ `durationMs` ÷ 3 600 000 × the provider's plan rate over the root's local-billed lines, request hours: the Budget's machine hours are lower by the
  queue share; requests to other providers, e.g. cloud children, are not in it), `wallMs` (Σ `durationMs` of the main's lines) when no local plan has a rate; `experiments/settings.json` `strata.<class>.objective` overrides it (`apiUsd`, `cashUsd`, `localCost`,
  `wallMs`, `points5h`, `points7d`; `cashUsd` is not computed yet and reads "not measurable"). `points5h` / `points7d` = Σ over the root's requests of Σ_c β_c × the API-eq $ of
  component c, with the Budget's calibration of the request's provider and window kind (components under 1 % of the windows' $ are not identifiable and add nothing; no
  fit with at least 8 complete windows: not measurable). **Secondary column**: a unit's requests in another currency than its objective (a cloud-objective unit's local requests
  in the rate's currency; a `localCost` unit's cloud children in API-eq $) are shown per active hour by arm, converted into the objective's currency only with `currency.rates`.. Both timed objectives sum the lines that carry `durationMs`; a unit with none (a v1 line has no
  `durationMs`) has no objective, so a local stratum on v1 lines reads "not measurable". Lines without it (compactions, nested requests) add
  no time; the balance table shows the timed / untimed line counts.
- **Effect** of a factor in a stratum = ratio(high level) ÷ ratio(low level) − 1, ratio = Σ objective ÷ Σ active hours over the stratum's units at the
  level (a ratio of sums: a long unit weighs more than a short one, a $0 unit is not averaged in). Units under 0.05 active h (`MIN_HOURS`) are
  left out of the estimate; the balance table counts them. Strata are never pooled. The effects are marginal per factor and unadjusted: there is no interaction model (the earlier OLS table pooled the strata and was removed).
- **CI and power.** 2000 bootstrap draws, units resampled with replacement within each level, PRNG mulberry32 seed 1, percentiles 2.5/97.5. The
  minimum detectable effect is 2.80 × the sd of the bootstrap effects (α .05 two-sided, power .8). With fewer than 2 units at a level there is
  no CI and no MDE; an MDE of 0 (zero variance) reads "n/a"; bootstrap draws with a non-finite ratio are dropped and counted.
- **Balance table**: per stratum and arm, units over `MIN_HOURS`, their active hours, the units excluded, units without an objective.
- **Per-protocol** (v2 engine's strata): the units whose every factor lever has `rb = "confirmed"` in the root main's last
  levers line up to the period's end (its last: a lever refused after a model switch leaves the row; units without a levers line are left out), labelled a non-randomized comparison (units that kept the assignment are self-selected). **Refusal rate** per factor =
  units whose lever state is `refused` ÷ the stratum's units; above 0.20 the factor's add-on is flagged "broken add-on".
  **Context overflows** = count of lines with `errorKind = "context_overflow"` of the root ÷ its active hours, per arm.
  **Sensitivity (model switch)**: the effect again with each unit's objective over the requests whose billing class equals the class of
  the root's first main request; the report counts the units that used another class; for a `points5h`/`points7d` objective it reads "not measurable" (the account's quota is not split by billing class). A v1-engine design gets none of these.
- **Per arm** (`meter-report --arms`): for the v1–v4 designs pooled over the design's strata and the input of the flat kill switch and posterior; for a v2 design the pooled table is descriptive, the kill switch and posterior are per stratum (one table per design and stratum in `meter-report --arms`); $ per active hour; its fold and cold-resume columns are
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
- **$ per accepted task** (B5), one function for the headline in *Cost* and every row of the tier table: the numerator is what the tasks of
  a population cost (the subtree of each, all its requests), whatever came of them; the denominator is the accepted tasks of the same
  population. Populations: **all** = every routed task, judged or not (the report's headline and the *all* row of the tier table; a task
  killed without a verdict is paid for by the accepted ones); **judged** = the routed tasks with a judged verdict (the cells of *By
  profile and tier*); **spot-check reviews** = the review children, a population of their own, never in the headline. A task without a child
  session has no cost and is in neither numerator nor denominator.
  **The headline was redefined; it is not comparable with the reports written before.** The old headline took the judged tasks' $ over
  the accepted ones, with spot-check reviews and unresolved cards in the population, so it read about the judged-only figure; a task
  killed or never judged (28% of the routed tasks on the author's log) cost money and counted for nothing. On that log the old headline
  read 4.13, the judged-only routed tasks give 4.21, and the new one reads 6.87 – 11.72 (357 accepted of 521 routed tasks): every routed
  task is paid for by the accepted ones, unjudged tasks count as zero yield, and the range is the unresolved cards' $ (excl. – incl.).
- **Unresolved cards** (B15): a spawn with `unresolved: true` (its card files did not resolve) says nothing about routing quality, so it is in
  no acceptance, profile or randomized figure and is never counted as accepted; but its child session cost real money. Its $ is in the
  **all** population's $ (the tier table, the headline) and shown in its own column, and `$/accepted` is a bound pair over the same
  accepted tasks: **lower** leaves the unresolved $ out, **upper** counts it. One number means no unresolved $.
- **Randomized comparison** (B14; "randomized by the router (ext)", the router's own experiment). The router sends a share of the spawns it
  would put on qwen to another tier: `assigned: "random"` with `routeBase` = the tier it computed. The pool is the profiles (`kind`) that
  have such a spawn, with `routeBase` qwen. Rows: the pool's **router-assigned** tasks (`assigned: "router"`), every one, whatever model
  ran it: the comparator of the ITT contrast; **ITT** = every task the router randomized, by assignment, whatever ran on; **pre-randomization**
  = the pool's planned-qwen tasks without `assigned` (lines from before 2026-10-04); and, descriptive only, the router-assigned and the
  randomized tasks by the model that ran them. Only ITT against the pooled router-assigned row is a randomized comparison; the other rows were
  chosen. The report names no model the reference or a fallback: which member runs a task (the first member when its slot is free,
  the next one after `waitMs`, an outage) depends on the pool, not on the draw, so splitting the control by it would compare
  unlike periods (on the author's log the fallback member, waiting ≈ 5 s, ran about half of them). A task that fell
  back is told by `workerMember`/`waitMs` on its spawn line, not by the model alone. The control
  still holds the tasks the router never drew (a pinned profile, a re-spawn): a marker on the spawn line that a task was in the draw (a router
  backlog item) would let the analyser drop them. A log in which no spawn carries `assigned` reads "ITT: not measurable". Acceptance
  and $/accepted of a row are over its judged tasks (bootstrap CI from 5 judged tasks on); unresolved cards and spot-check reviews are in no row.
- **Router factors** (Q4). The router randomizes some levers itself (local-first settings, delegation rules). When its spawn lines carry the level
  each task got, `factors` (the levers the router randomizes, nothing it pins): an object factor → level (a string, a finite number or a boolean; anything else is ignored), the report has one
  row per factor and level over the routed tasks that carry it: acceptance and $/accepted by assignment (intention to treat), labelled
  "randomized by the router (ext)". Nothing of it enters pi-economics' own experiment design. Without such lines the report says "router factors:
  not recorded". The router does not write `factors` yet (a router backlog item; the name is this reader's proposal).
- **Spot-check agreement** (B7). `requested` = tasks with a `spotcheck` event; `reviewed` = those whose review child the parent judged
  (the verdict event of the review task, with `reviewOf` = the original task) while the original's verdict at the draw (the last one at or
  before the `spotcheck` event) is judged, of which **drawn** = those that review a task with a `spotcheck` event (the others were not
  drawn: the parent asked for them); `pending` = requested without a review. The **agreement** compares the original's verdict at the draw
  with the **reviewer's own verdict on it**, the field `reviewerVerdict` (`accepted`, `partial`, `rejected`) of the review's verdict event (the spot-check reviewer's verdict on the child's diff; `verdict` on the same event stays the parent's verdict of the review child):
  agree = both accept or both do not, with Cohen's κ over the same two classes, which is **not estimable** when one rater never varies:
  a spot check is drawn from accepted tasks only, so the original is accepted at every draw and κ has no value on such a log (the report
  says "not estimable: spot checks are drawn from accepted tasks only"). The figure that remains is how often the reviewer does not accept
  an accepted original, shown beside the agreement. The parent's verdict of the review child is no part of it (it is `accepted` for 55 of 55 reviews on the
  author's log). The router does not write `reviewerVerdict` yet (a router backlog item; the name is this reader's proposal and changes here
  if the router names it differently): until it does the report says "agreement: not measurable", never a rate.
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

- **Branch summaries** (`/tree` with a summary) are summary requests outside the agent loop like compactions; pi 1.4 keeps
  their usage on the branch-summary entry, which the meter does not read yet: they are not metered.
- A **resumed** child session does not inherit its arm again (inheritance happens on the
  spawn event only), so its later meter lines miss `arm` (seen 2026-10-03).
- Quota readings of parallel sessions interleave and are slightly stale; per-root and per-arm
  quota is an attribution of the account's rise (see *Analysis*), approximate.
- Lines before 2026-10-03 have no `v` and partly no `arm`.
- Until 2026-10-27, a warm sent while a turn streamed (pi ≥ 1.4) left a `warming` line
  without usage carrying the TURN's headers and `ts`, and the turn line took the warm's
  headers or none (no `q5h`); the warm's own `cache_warm` usage got no line.
