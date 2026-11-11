# pi-economics

Home Manager components for the pi coding agent's token economics, under
`programs.piEconomics`. Import `homeModules.default`: it brings every
component and the shared options below. Comments in the source cite the
design record and milestone plans (`spec §n`, `D…`, `T…`); these are
provenance, kept with the author's system configuration, not required
reading. What the components log and measure, the experiment design and
how to run the reports and the bench: `docs/pi-token-economics.md`.

## Shared options (`modules/common.nix`)

### `agentDir`

pi's agent directory, relative to home; default `.pi/agent`. pi's
`PI_CODING_AGENT_DIR` is not modelled: a host that moves the agent directory
sets this option.

### `extensions` (the registry)

`extensions.<name> = { path; checkPath ? path; input ? null; forChildren; description; }`.

- Each entry is linked as `<agentDir>/extensions/<name>` → `path`. Home
  Manager rejects a second link of the same name.
- An assertion requires `checkPath` to exist. For a patched source, point it
  at the unpatched input's entry file (probing a build output would be
  import-from-derivation); its message names `input`.
- `forChildren` selects the extensions actor-subagents children load: their
  link paths `<home>/<agentDir>/extensions/<name>`, sorted by name, are
  `childExtensions` in `actor-subagents/settings.json` while `actorSubagents`
  is enabled.

### `piSettings`

Edits of pi's mutable `settings.json`, run by one activation entry,
`piSettingsMigrate`.

- `enable` (default `true`): while `false`, no entry is rendered.
- `file` (default `<agentDir>/settings.json`): absolute, or relative to home.
- `after`: entries to run after, besides `writeBoundary`.
- `ops.<contributor>`: a list of `{ op; path; value; order ? 1000; }`. Each
  component writes under its own name; a host uses a key of its own.
  `path` is a list of object keys, never a dotted string, never empty.

| `op` | Effect | Missing parents | Other shape on the path |
|---|---|---|---|
| `set` | the leaf becomes `value` | created | op skipped |
| `ensureContains` | appends `value` unless an equal element exists | created, then `[]` | op skipped |
| `removeWhere` | removes the elements equal to `value` | op skipped | op skipped |

- `null` on the way or at the leaf counts as missing, except for
  `removeWhere`, which skips the op. `false` at the leaf of `ensureContains`
  counts as missing too.
- `false` on the way aborts the whole program: the file stays untouched.
- Order: by `order`, then contributor key, then position in the list.
- The entry runs only when `enable` is `true` and at least one op exists. It
  does nothing on an absent file, never fails the activation, and rewrites
  the file only when its JSON changes.

## Components

### `bench` (`modules/bench.nix`)

pi-bench (`packages/bench`, its own `README.md`): `pi-bench` and
`bench-report` on `PATH`, configured through session variables. Every option
at its empty default exports nothing, and the bench keeps its own default.

| Option | Default | Exported as |
|---|---|---|
| `enable` | `false` | — |
| `package` | the flake's `packages/bench` | `home.packages` |
| `dataDir` | `<home>/<agentDir>/bench` | `PI_BENCH_DATA` |
| (agent source) | `<home>/<agentDir>`, not an option | `PI_BENCH_AGENT_SRC` |
| `workDir` | `null` (the bench: `$XDG_RUNTIME_DIR/pi/tmp/bench`) | `PI_BENCH_WORK` |
| `extensions` | the flake's packages the bench loads by name, one `mkDefault` each: `actor-subagents`, `infinite-context`, `pi-retry`, `task-router`, `token-meter` (see below) | `PI_BENCH_EXT_DIR`, a `linkFarm` of name → path |
| `baseExtensions` | `[]` | `PI_BENCH_BASE_EXTENSIONS`, the names comma-separated: every run loads them (see below) |
| `orchExtensions` | `[]` | `PI_BENCH_ORCH_EXTENSIONS`, the names comma-separated: the orchestrator factor arms and their children load them (see below) |
| `router` | `{}` (an arm's file: its own keys); while `taskRouter` is enabled, its model keys with `randomize` and `spotCheck` off, one `mkDefault` per leaf | `PI_BENCH_ROUTER`, a JSON file; an orch arm merges its `routing`, `delegation`, `t0Limits` over it as `lib.recursiveUpdate` does |
| `agentsBaseline` | `null` (the bench: `<agent source>/notes/…`) | `PI_BENCH_AGENTS_OFF` |

The bench's `extensions` default covers the flake's own packages. A
definition adds names (extensions of your own, not shipped here) or replaces one
by name; `lib.mkForce {}` exports nothing, and the bench then looks the names
up in `~/.pi/agent/extensions`. `cache-lifecycle` and `experiments` are not
loaded by the bench arms and are not in the default.

The arms, the orchestrator's and its children's lists and the judges name
only the flake's extensions. Two lists name those of your own. Every run
loads `baseExtensions`: every arm, the factor arms' children, every
judge. The children of the smoke arm `orch` run with the live
agent directory's settings instead, and are not given the list. Your provider login extension, if your pi needs one, belongs here.
The bench does not check for one: an arm without it runs as your pi does
without it. The orchestrator factor arms (`orch-<signs>`, any arm with
factors) and their children also load `orchExtensions`; the print arms, the
smoke arm `orch` and the judges never do. A search tool that only the
orchestrator's setup has belongs there. The order of a run is the base
names, then the arm's (or the children's) own list, then the orchestrator's
extras, each name once. Each name must be defined in `extensions` (an
assertion, `pi-economics: …bench.baseExtensions names …`, and the same for
`orchExtensions`), unless `extensions` is empty. An old arm of
`<data>/arms.json` that names one of your extensions still runs, and its
runs still report and judge, as long as `extensions` defines the name.

### `actorSubagents` (`modules/actor-subagents.nix`)

pi-actor-subagents (upstream input `pi-actor-subagents`) with three patches
from `patches/pi-actor-subagents`: child prompt, spawn policy (the
`globalThis.__subagentsApi_v1` other extensions drive) and spawn API (local
mode L4: the API's optional `spawn(args, {by, quiet})` and `kill(names)` for
the router's own agents, where `quiet` sends no notice to the spawner and
keeps the child out of the persisted roster; a spawn policy may give a child
extra tools (`childTools`) and a working directory (`cwd`), and its tool
guard may answer with a Promise; the API's `version` stays 1).

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `actor-subagents` (link `<agentDir>/extensions/actor-subagents`, not loaded into children) and the settings file |
| `package` | the flake's `packages/actor-subagents` | the patched source; its `passthru` carries `spawnPolicyApi` = 2, the version of `__subagentsApi_v1` it provides (1: the spawn policy; 2: also `spawn`/`kill`, child tools and cwd) |
| `settings` | `{}` | merged into `<agentDir>/actor-subagents/settings.json` (`maxAgents`, `maxSpawnDepth`, `errorNoticeGraceMs`); `childExtensions` there is always the registry's, and setting it here is an assertion error |
| `src` (internal) | set by `homeModules.default` from the input | the unpatched source the existence assertion probes |

With `settings = {}` the file is `{"childExtensions":[…]}`, the children's
link paths, as the original system configuration wrote it.

### `tokenMeter` (`modules/token-meter.nix`)

The token meter (`packages/token-meter`): one JSON line per provider request
(tokens, cost, quota headers, retries; no prompt or response text) in
`<agentDir>/meter/YYYY-MM.jsonl`, in main sessions and children, and the
reports over every log pi writes about itself.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `token-meter` (`forChildren = true`); `meter-report` and `pi-analyse` on `PATH`; `<agentDir>/LOGS.md`, the manual of every log `pi-analyse` reads |
| `package` | the flake's `packages/token-meter` | the extension; `passthru.report` and `passthru.analyse` are the two commands |
| `settings` | `{}` | written to `<agentDir>/token-meter/settings.json` when non-empty (`enabled`, `dir`, `rawRatelimit`; each has a default in the package) |

Without `actorSubagents` there are no children to meter and no
`parentSessionId`; without `experiments` the lines carry no arm; without
`taskRouter` and `experiments` the reports lack their tier and arm sections.
None of these warns.

### `analysisSkill` (`modules/analysis-skill.nix`)

The agent skill `pi-token-economics-analysis`
(`skills/pi-token-economics-analysis`): it runs `pi-analyse`, reads
`LOGS.md` and proposes decisions. It writes no file.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | requires `tokenMeter` (an assertion) |
| `package` | the skill directory, `SKILL.md` at its root | every `~/.pi/agent` in the text replaced by `~/<agentDir>`; with the default `agentDir` the text is the source |
| `path` (read-only) | `null` while disabled | the directory to link as `<skills dir>/pi-token-economics-analysis` (the frontmatter `name`) |

### `cacheLifecycle` (`modules/cache-lifecycle.nix`)

The prompt-cache lifecycle (`packages/cache-lifecycle`): on the first request
after the prompt cache expired it elides stale tool results and thinking
outside a protected tail; it can request a 1 h cache TTL for the main
session; and it decides pi's idle cache warming (orchestrator-aware: a main
with running children, and a child awaiting a reply, stay warm). Main
sessions and children load it.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `cache-lifecycle` (`forChildren = true`); the piSettings op `ops.cacheLifecycle`: `set ["cacheWarming"] "idle"`, order 1500 |
| `package` | the flake's `packages/cache-lifecycle` | the extension |
| `settings` | `{}` | written to `<agentDir>/cache-lifecycle/settings.json` when non-empty (`warmPolicy`, `mainCacheTtl`, `maskOnCold`, `protectedTailTokens`, `identityShim`; each has a default in the package) |

pi asks for a warming decision only while its `settings.json` says
`cacheWarming` is `"idle"`, and pi's default is `streaming`. The op edits an
existing file only: standalone, pi keeps its default while there is no
`settings.json`, and while `piSettings.enable` is `false`. Without
`actorSubagents` it warns: no warming while a session waits on its children.
Without `infiniteContext` the `context_peek` guard has nothing to log; without
`experiments` its own settings decide every factor. Neither warns.

### `experiments` (`modules/experiments.nix`)

The online experiment (`packages/experiments`): one fractional-factorial arm
per main session, recorded in `<agentDir>/experiments/assignments.jsonl` and
published as `globalThis.__piExperimentsApi_v1`, whose factor flags
`cacheLifecycle`, `tokenMeter`, the task router and `infiniteContext` read.
Corrections and `/rate` ratings go to `<agentDir>/guards/events.jsonl`. There
is no timer: `meter-report --arms --posterior` updates the posterior on demand.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `experiments` (`forChildren = false`: children inherit their parent's arm) |
| `package` | the flake's `packages/experiments` | the extension |
| `settings` | `{}` | written to `<agentDir>/experiments/settings.json` as given, `{}` as `{"mode": "explore"}` (`mode`, `factors`, `maxArms`, `minExplore`, `baseline`, `guards`, `correctionRegex`); the file is the extension's opt-in: without it experiments is inert |

Without `actorSubagents` it warns: children do not inherit an arm.

### `infiniteContext` (`modules/infinite-context.nix`)

pi-infinite-context (upstream input `pi-infinite-context`) with two patches
from `patches/pi-infinite-context`: reminders (absolute fold-reminder
thresholds per provider or model) and cache (a cost-aware fold hint, a
`fold_timing` prompt section, a re-sync of a snapshot that no longer matches
the branch, a handoff notice instead of the raw transcript). It folds ranges
of the agent's own conversation by message id and unfolds them on demand.
Main sessions and children load it (`forChildren = true`).

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `infinite-context` (link `<agentDir>/extensions/infinite-context` → the package's `extensions/infinite-context`) and the settings file |
| `package` | the flake's `packages/infinite-context` | the patched source |
| `reminders.default`, `reminders.overrides` | `{}` | `{ startTokens; everyTokens; }` (both `null` or a positive integer): `default` for every model, `overrides` keyed by pi provider or exact `provider/modelId`. Each field resolves on its own: exact model, then provider, then `default`, then the extension's 75 % / 5 % of the model window. Nulls are left out of the file |
| `reminders.prices` | `{}` | `{ w; r; }` per provider or exact model: with a price the reminder says after how many turns a fold pays off |
| `reminders.cacheTtlMinutes`, `reminders.foldHint` | `null` | the cache TTL the hint uses (extension default 5 minutes); `"fixed"` or `"cache-aware"` (extension default) |
| `settings` | `{}` | merged into the file with `lib.recursiveUpdate`, on the right of what `reminders` renders (`nudgeAtTokens`, `nudgeAtPercent`, `reminders`, `prices`, `cacheTtlMinutes`, `foldHint`) |
| `src` (internal) | set by `homeModules.default` from the input | the unpatched source the existence assertion probes |

The file `<agentDir>/infinite-context/settings.json` is always written, as
literal text; with every option at its default it is
`{"reminders":{"default":{},"overrides":{}}}`. The extension's parser is
strict: an unknown key or an invalid value rejects the whole file with a
warning at session start, so a key typed wrongly in `settings` is not a Nix
error; the `home-files` check runs the package's own parser on the rendered
file. Changes apply to sessions and subagents started after the switch.

Soft dependencies, none of which warns: the `foldHint` flag of `experiments`
overrides the setting per session (through `__piExperimentsApi_v1`, which the
patch casts inline, so no check compares it); `cacheLifecycle`'s
`context_peek` guard reads infinite-context's tools.

### `retry` (`modules/retry.nix`)

pi-retry (upstream input `pi-retry`) with one patch from `patches/pi-retry`,
`free-cap`: a 429 for OpenRouter's daily free-tier cap is not retried. It
retries 400/413, credit and connection errors with backoff, inline for
children and for one-shot (print/json) hosts. Main sessions and children load
it. The package is the whole repository: pi finds `retry.ts` through
`package.json`.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `pi-retry` (link `<agentDir>/extensions/pi-retry` → the package) and `piSettings.ops.retry` |
| `package` | the flake's `packages/retry` | the patched repository |
| `settings` | `{}` | pi-retry's keys under `piRetry` in pi's `settings.json`, one `set` per leaf at order 500 (`baseDelayMs`, `maxDelayMs`, `multiplier`, `maxRetriesAtMaxDelay`, `messageFreeRetries`, `subagents.*`); a list is one leaf, replaced whole, and no whole object is set, so keys pi or the user wrote survive; an empty attribute set below a key is an assertion error (`pi-economics: retry.settings.<path> is an empty attribute set`), since it would set nothing |
| `src` (internal) | set by `homeModules.default` from the input | the unpatched source the existence assertion probes |

No file of its own. `piSettings.ops.retry`: remove the two stale package
entries (`https://github.com/monotykamary/pi-retry` and
`git:github.com/monotykamary/pi-retry`), then, only while `actorSubagents` is
enabled, `ensureContains` the child rule `^You were spawned by "` (flag `m`)
in `piRetry.subagents.match.systemPromptRegex`; `settings` leaves come at
order 500, so they run first. The ops run only while `piSettings.enable` is
`true`. Without `actorSubagents` there is no child rule and no warning.

### `taskRouter` (`modules/task-router.nix`)

The task-router, as it stands after the router redesign's Group 7 (close-out).
The new defaults are Group 5's (R5, after the RF1–RF5 follow-ups; this repository's pre-publication history);
Groups 1–2 came from the author's system configuration at commit `566fd0d`,
"R'"; Groups 3–7 were made in this repository. Group 6 (the scout gate) changed no default. It routes subagent spawns by task
card through actor-subagents' spawn policy: the card gives a required ability
and level (abilities and levels per member), the importance table gives the
legs (worker, and a review where the cell has one), and a leg runs on the
cheapest free member among its candidates (cost order, slots, health probes,
daily caps, a provider's block; a busy cheapest pool is waited for up to
`queueMaxSec`, then the next member). There is no Qwen chain: under the
defaults the local Qwen comes first and Haiku after it; the free-cloud slot
(`models.qwen-cloud`) is empty, and a settings file that names its model makes
it an ordinary member after local. A provider error moves a child to a free
member of its leg on another provider. The pick or the move reserves the slot
at once (60 s, and while pi lists the child running), so concurrent spawns and
moves never share one; an explicit `model` runs on its member alone (it waits
`queueMaxSec`, then the spawn is rejected) and fails over only at or above it.
A re-spawn (`attemptOf`) goes one level above the member the failed task ran
on. Spawns, moves, escalations and verdicts go to the outcome log
(`<agentDir>/task-router/outcomes/YYYY-MM.jsonl`); the router registers the
`task_verdict` tool. Main session only: children do not route.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `task-router` (link `<agentDir>/extensions/task-router` → the package; `forChildren = false`) |
| `package` | the flake's `packages/task-router` | the extension (`package.json`, `index.ts`, `core/`); its tests run when it builds |
| `settings` | `{}` | written to `<agentDir>/task-router/settings.json` when non-empty; free-form, the schema and defaults are `packages/task-router/core/settings.ts` (`models` and `importanceTable` merge over the defaults: `models.<member>` field by field, `model = ""` removes the member; a given table cell replaces the default cell); the rollback to the routing before the new defaults is `lib.importJSON` of `packages/task-router/test/fixtures/today-config.json` |
| `localMode.enable` | `false` | local mode (below): defines `settings.mode = lib.mkDefault "local"`, so the settings file is written even for `settings = {}`; asserts `taskRouter.enable` (`pi-economics: taskRouter.localMode.enable requires taskRouter.enable`) and that a given `settings.mode` is `"local"` (`pi-economics: taskRouter.localMode.enable needs taskRouter.settings.mode = "local" (found …)`) |

Models are configured through `settings.models`, as in the option's example:

```nix
programs.piEconomics.taskRouter.settings = {
  models = {
    qwen-local.health = "http://localhost:11545"; # where the local server answers
    haiku.model = ""; # no Haiku: write 0 falls back to Sonnet
  };
  queueMaxSec = 60;
};
```

`packages/task-router/test/fixtures/models-example.json` (every member written
out) is read by the package's settings test and by the `module-eval` case
`task-router-models`.

**Local mode (milestone L1).** For a main session driven by a local model
(Qwen). The settings key `mode` is `"default"` (the default) or `"local"`;
`localMode.enable` sets it. There is no auto-detection: a Claude main with
`mode = "local"` runs in local mode too. The settings declare the local
components `hints`, `worktrees`, `mergeGate` and `plans`, each with
`enabled = "auto" | "on" | "off"` (default `"auto"`: on in local mode, off in
default mode), the `overseer` that serves them (no switch of its own), and `force` (below); L1 validates them (a bad value is reported and its
default kept); `hints` works since L3 and the overseer since L4 (below), the others do nothing yet. The keys, their defaults and
the messages are in `packages/task-router/core/settings.ts` and
`packages/task-router/core/local/settings.ts`. In local mode:

- Importance: the main session's effort is no importance source (a main at
  `xhigh`, the local member's only effort, would make every child `high`); the
  card's `importance`, the parent's importance and `pathRules` still count. The
  routing table, the members and the selection are unchanged, so level-0 work
  goes to the local member at cost 0 and the rest to Claude.
- The prompt section `task_cards` of the main session is the shorter
  `## Local mode` section (`localSection`, `packages/task-router/core/prompt.ts`:
  do most of the work yourself, spawn only for more ability, end the turn after
  a spawn; the card schema and one example). The orchestrator rule is off, even
  when an experiments arm sets `delegationRule`. Children still get no section.
- The delegation nudge is off; hints (below) replace it.
- The status line `task-router` reads `local`, or `local (main: <model>)` when
  the main model is no local member's (set at `session_start` and on
  `model_select`), and adds `hint <trip>` after a hint until the next progress.

With `mode = "default"` and every component `"auto"`, the router registers the
same tools and hooks as before plus the `/force` command, the section is
byte-identical, outcome lines carry no new key while no force is active, and
`router-golden` is unchanged (`test/local-default.test.ts` pins the inventory).

**Force override (milestone L2).** The user, never the main model, can fix the
model (and effort) of routed spawns, in either mode:

    /force <model> [effort] [next[:N] | session]
    /force off
    /force

`<model>` is a member name (its `model`) or `provider/id`, resolved through pi's
model registry, so models outside the table and effort `max` are accepted; an
unknown model is refused with the first ten available ones, and the previous
force stays. Without `effort` the routed effort is kept. The scope defaults to
`session`; `next` is one spawn, `next:N` N spawns, then the force expires.
`/force off` clears it, `/force` alone shows it. The command force is kept as a
session entry (`task-router/force`), so a resumed session or a reload finds it.
The settings key `force = { model; thinkingLevel; }` (`model = ""`, the
default, is no force) forces every session; it is resolved once at
`session_start`, and an unknown model is a reported problem with the force
inactive. A command force takes precedence over the settings force while it
lasts. While a force is active, every routed spawn (one with a task card) is
planned as usual, without the spawner's `model` and `thinkingLevel`, then runs
on the forced model: a member through its
slot, as an explicit `model` does, without failover to another member; a
non-member at once, with no slot accounting. Overseer reviews are not forced
(they use `overseer.*`), and with `routing = false` nothing is forced; `/force`
says both. The status line `task-router` shows `force <model> [effort]
[(<N> left)]`, after `local` in local mode. Logs: a `force` outcome line
(`taskId: ""`, `action` `set`, `clear`, `used`, `expired` or `rejected`,
`source` `command` or `settings`, optional `model`, `effort`, `reason`), and a
forced `spawn` carries `forced: true`, `forceSource` and the routed
counterfactual `routedModel`, `routedEffort` (`packages/token-meter/LOGS.md`).
The code: `packages/task-router/core/force.ts`, `core/forceinstall.ts` and the
force branch of `core/policy.ts`.

**Hints (milestone L3).** With hints on (`hints.enabled = "auto"` in local
mode, or `"on"` in either mode) the router watches the main session's tool
calls (`tool_call`, `tool_result`, `turn_end`) and keeps a ring of the last
`4 × identicalCalls + 8` calls: the tool, a hash of its input, and for `edit` and
`write` the file's hash before and after. Pure detectors fire these trips (the
`hints` settings, defaults in brackets):

- `identical-call`: the same call `identicalCalls` (3) times with no tree change
  in between;
- `no-change-writes`: the last `noChangeWrites` (4) edits or writes left their
  file unchanged;
- `alternation`: two calls alternate `alternations` (2) times with no tree
  change;
- `repeated-error`: `repeatedErrors` (2) failures in a row of one tool whose
  error texts (lowercased, digits masked) have a character-trigram Jaccard
  similarity ≥ `errorSimilarity` (0.92);
- `churn`: one path written `churnEdits` (3) times within `churnTurns` (4) turns;
- `risky-path`: a write to a path that matches `riskGlobs` or a `critical`
  `pathRules` glob, once per path;
- `context-soft`: the context crosses `contextSoftTokens` (32000) tokens; it
  fires again only after the context has dropped below;
- `context-stall`: the context is at or above `contextPercent` (85) % for
  `stallTurns` (25) turns without a tree change.

A tree change (an `edit` or `write` that changed its file's hash) is progress;
a file that cannot be hashed does not count. `check-failing` (`checkFailures`)
and `over-size` arrive with worktrees and plans (L5). The tool result of the
call that tripped gets one more text block,
`<router-hint trip="<trip>" n="<count>"><fixed text></router-hint>`; a trip found
at `turn_end` goes into the next result. The same trip then stays quiet for
`cooldownCalls` (5) calls, but every detection counts: the `1 + persistTrips`-th
(third) one without progress carries a fixed escalation instead ("Spawn a
debug-design card for it; the router will route it to Sonnet or above."),
unless the steer overseer (below) takes it.
Children (local mode only): the router sees a routed child's calls, without
results, through the spawn policy's `toolGuard`, composed in front of a
profile's file guard, and checks `identical-call` and `alternation`. The child
gets the hint as a message from `router`; when the trip persists, its parent
gets one notice per trip (`[router] <child> looks stuck (<trip> ×<n>); consider
killing it and respawning with attemptOf`). A hint never blocks a call; a hook
that fails is reported once (`task-router: hint engine: …`) and leaves the
result unchanged. Logs: a `hint` outcome line (`taskId` `"main"` or the child's
name, `trip`, `stage` `hint`, `steer` or `parent`, optional `count` and
`sessionId`; no text). The code: `packages/task-router/core/local/tripwires.ts`
(detectors), `core/local/hints.ts` (texts, cooldown, persistence),
`core/local/install.ts` (the main session), `core/local/childtrips.ts` and
`composeGuards` in `core/toolguard.ts` (children). In the main session, calls
that an extension makes from inside a tool (`ctx.executeTool`, events with `parentToolCallId`)
are not the model's and are skipped.

**Overseer (milestone L4).** The router spawns its own review agents through
the actor's spawn API (`spawnPolicyApi` 2): quiet, spawned by `main`, named
`ovs-<role>-<n>`, with a one-use ticket in the task card instead of a card.
The spawn policy takes the ticket before anything else: the agent runs on
`overseer.member` at `overseer.effort` (`opus`, `high`) with the read-only
`overseer.tools` (`read`, `grep`, `find`, `ls`; `bash`, `edit` or `write` there is
reported, `overseer.tools: <tool> can write; default kept`) plus one submit
tool, and a guard refuses every other tool. Ticket spawns are not forced and
not routed. The agent reports through the submit tool only: a verdict
(`summary`, `verdict`, `findings` with id, category, target, criterion,
blocking) checked against its JSON schema and the rules (no code fence, unique
ids, every target in the diff or plan under review); an invalid one goes back with the
reasons, at most `resubmits` (2) times. An agent that goes idle without
submitting is reminded once, then the attempt fails; `timeoutSec` (900) bounds
an attempt; a failed attempt (timeout, error, invalid) is retried once on
`fallbackMember` at `fallbackEffort` (`sonnet`, `xhigh`), except a steer
review. The agent is killed after each attempt; a submitted verdict is kept as a session entry
(`task-router/review`). Budget (per session branch, session entries
`task-router/budget`): each spawn on `overseer.member` counts against `budget`
(15), a steer review also against `steerBudget` (3); with the budget spent a
review runs on the fallback member and a steer review is skipped. The status
line adds `opus <n> left` once three or fewer are left. Steer (`hints.steer = "on"`):
when a trip persists (above), the router spawns a steer review instead of the
escalation, with the trip and the last 12 calls (tool, target, result; no file
contents), one at a time, and sends its summary and findings to the main
session as a steer message (`task-router/steer`); without the spawn API, with
the steer budget spent or when the review fails, the escalation goes into the
result as before. In local mode without the spawn API the router warns once at
`session_start`: "task-router: local mode needs actor-subagents with
spawnPolicyApi ≥ 2; merges are refused and plans are unavailable". Logs: one
`review` outcome line per attempt (`taskId` the review id, `role`, `member`,
`model`, `outcome` `approve`, `revise`, `invalid`, `timeout` or `error`,
`attempt`, `durationMs`, optional `fallback`, `findings`, `blocking`,
`inconsistent`, `commit`, `branch`; no verdict text), and the agent's `spawn`
line carries `ticket` and opens no verdict slot (`packages/token-meter/LOGS.md`).
The code: `packages/task-router/core/local/overseer.ts` (tickets, the run,
the prompts), `core/local/schema.ts`, `core/local/verdict.ts`,
`core/local/steer.ts`.

**Scout gate (Group 6, 2026-10-28).** Haiku at medium scored 0.646 against
Sonnet high's 0.917 (threshold 0.825, H6.4; two runs per task and arm), so
`lookup` keeps its floor: `profiles.lookup.minLevel` stays 2
(`packages/task-router/core/settings.ts`), and `scout` and `review` stay at read 2.
The Qwen arm did not run, which cannot change the outcome. Beyond the gate,
Haiku at xhigh scored 0.917 (about 0.3x Sonnet high's list cost, 3.4x its wall
time); using it needs a member of its own and is a host decision. Caveats: six
tasks, two judges with κ 0.29. Scores and the record: the router plan
`router-g3-g7`, Execution Record, Group 6 (kept with the author's system
configuration).

Hard dependency: `taskRouter` needs `actorSubagents` with `passthru.spawnPolicyApi >= 1`
(the router registers through `registerSpawnPolicy`, and its shell swallows the
absence of the API, so without the patched build it would do nothing); an
assertion says so (`pi-economics: taskRouter requires actorSubagents …`).
Local mode needs `spawnPolicyApi >= 2` (the overseer spawns through the API's
`spawn` and `childTools`): with `localMode.enable` a third assertion says so
(`pi-economics: taskRouter.localMode requires actorSubagents with
passthru.spawnPolicyApi >= 2 …`).

With `bench.enable`, the bench's `router` base is defined while `taskRouter`
is enabled, one `mkDefault` per leaf (a list is a leaf): the keys of
`taskRouter.settings` that name the models and where to reach them (`models`,
`queueMaxSec`, `contextFit`, `localHealthUrl`, `cloudDailyCap`,
`contextWindow`), with `randomize.enabled` and `spotCheck.enabled` set to
`false`. A definition of one leaf (`bench.router.models.<m>.model`) replaces
that leaf only; the member's other keys and the other members stay. The
bench's `extensions` default holds `task-router` too. A definition of one name
replaces that name only. Your own extensions that the runs and the judges
need (`judge --all` loads the base extensions only) go into `extensions`,
`baseExtensions` and `orchExtensions` (the `bench` section).

**Golden test.** `checks/router-golden/golden.txt` records every decision of
`planSpawn` over the router's own golden grid (`test/golden/grid.ts`: 146,880
plan cases, 470,016 explicit-model cases) and of `resolveLeg` over the
selection's 96 states (`select` lines, picks named by member), under three
settings: the defaults (`defaults`), a fixture with every member's model set
and the free-cloud slot empty (`empty-slot`), and the rollback fixture
`test/fixtures/today-config.json` (`today`, the routing before the new
defaults, with the free cloud configured: the only recorded witness of that
code). `generate.ts <router dir>` prints it; the check `router-golden`
runs it on `packages/task-router`, diffs against the file (comment lines aside)
and asserts P2 as an invariance over the `empty-slot` and `defaults` lines:
with the free-cloud slot empty, no selection picks it and the cloud's state
(its running count, open, capped or blocked) changes no decision; a wait for
the local slot is allowed. After a deliberate
change of a decision, a group of the redesign re-records the file by hand
(`node --experimental-strip-types checks/router-golden/generate.ts packages/task-router`,
header `# R' = <source>, <date>`) and puts the diff of old and new file in its
record. The redesign's Groups 3–7 are closed; Group 6 re-recorded nothing.

**Log contract.** `log-contract` runs the real code path of every log writer
(token-meter, task-router, cache-lifecycle, experiments) into one agent dir and
requires `pi-analyse --check` to pass and every report section to have data.

Checks: `task-router`, `typecheck-task-router`, `iface-subagents-task-router`,
`iface-experiments-task-router`, `iface-policy-task-router`, `router-golden`,
`log-contract`, `pi-install-local`.

## The pi package

The repository root is a pi package (`package.json`, rendered; spec decision D1): the four own extensions
(`packages/{cache-lifecycle,experiments,task-router,token-meter}/index.ts`), the analysis skill (`./skills`) and
the two CLIs (`bin`). A user without Nix installs it with `pi install git:github.com/GRBurst/pi-economics@v<version>`
(`README.md`, "Without Nix"); the Home Manager route is unchanged but for the deltas below.

**Render rule.** Only `nix run .#render` writes `package.json`. `render/default.nix` evaluates the module for one
fixture (every component on but `bench`), maps the registry's own names to `./packages/<n>/index.ts` (a name without a
package directory is a render error; the prerequisites `actor-subagents`, `infinite-context`, `pi-retry` are skipped,
the user installs them) and adds `bin` when `tokenMeter` is on. `render-package` compares the committed file with it;
`pi-package-manifest` states the manifest's laws one by one (private, keyword, semver, peers = pi's five host
packages, imported-is-peer, no dependencies, paths, bin shebang and mode, skill fallback paths). The version is the
constant in `render/default.nix`; the tag is `v` + version. `render-package` also requires every `packages/<c>/package.json` to carry it (see AGENTS.md, "Versions").

**Runtime contract** (`packages/<c>/core/runtime-guard.ts`, four identical copies, `runtime-guard-copies`):

- `hasSubagentsApiV1`, checked at `session_start` (every factory has run by then, so the check does not depend on
  load order). `task-router` without the API warns once and is off (no `task_verdict`, no `task_cards`, no nudge);
  its effort guard and fresh-on-cold stay on. `cache-lifecycle` warns once and does not keep sessions waiting on
  their children warm. `experiments` warns once (only with its settings file) and children do not inherit an arm.
  The text is `actorMissing(...)`, printed through `warnOnce` (once per process; `ctx.ui.notify` with a UI,
  `console.warn` without).
- `guardSingleCopy`: each extension claims its component on `pi.events` at `session_start` and installs then, not at
  load. pi may load a copy and then leave it out of the final extension set: in a project with its own settings it
  loads the user-scope extensions first, before the project is trusted, and drops those that a project entry
  replaces, without unsubscribing them. Only a copy in the final set gets `session_start`, so a claim made at load
  would let a copy that never starts silence the one that does. The first copy to start wins (pi's order: an
  extension in a directory, such as the Nix route's links, before the packages, and among packages a project one
  before a user one). A later copy in the same runtime registers nothing and warns once (`loadedTwice`). The
  install's own `session_start` handlers are run by the guard right after it, because pi snapshots its handlers for
  each emit.
  Limits: an install must not register flags or providers (pi reads both before any `session_start`, and resolves
  `--model` then), and a host that never binds the extensions (no `session_start`, as an SDK host that skips the bind)
  installs nothing. An install that throws keeps its claim and stays inert for the session: its own handlers and bus
  listeners are silenced, a later copy warns instead of installing a second (partial or full) set, what pi cannot take
  back (a command, a tool) stays registered, and the error reaches pi as an extension error. Several failing held
  `session_start` handlers reach pi as one `AggregateError` naming all.
- `experiments` is opt-in on both routes: inert without `<agentDir>/experiments/settings.json` (no arm, no
  `assignments.jsonl`, no warning). The Nix module writes the file whenever `experiments.enable` is set
  (`{}` becomes `{"mode": "explore"}`, N4).
- Nix route deltas: N1 `task_verdict` is registered at `session_start`; N2 the actor-missing warnings are runtime
  warnings as well; N3 the single-copy guard; N4 the settings file; N5 the sources of the four packages.

Without the actor the package prints the warnings and keeps working; with the patched actor next to it none appears
(`pi-install-actor`), in local mode too (`pi-install-local`). The package checks load pi 1.4 offline (`pi -p`); they find the loaded extensions by pi's
`PI_TIMING=1` factory lines, an undocumented output pinned to the locked `pkgs.pi-coding-agent`: a pi that no longer
prints the block fails them with one message ("pi printed no PI_TIMING block").

## Patched upstreams

A component built from an upstream repository takes it as a `flake = false`
input. Its patches live in `patches/<input>/` under the file names of the author's system configuration, so
the derivation is that configuration's, bar two one-line differences (see "Resync") and the actor's third
patch (`pi-actor-subagents-spawn-api.patch`, local mode L4), which was written in this repository; `homeModules.default` hands the input to the
component as its internal option `src`, and the registry entry's `checkPath`
points into `src`.

## Checks

| Check | Covers |
|---|---|
| `module-eval` | Home Manager evaluations: exports, options, registry, piSettings rendering, assertions with their negative cases, the skill text, the skill↔meter contract, soft-dependency warnings, a typical combination, the README's example (`checks/module-eval/fixtures/readme-example.nix`) |
| `pi-settings-migrate` | the piSettings script: the ported cases, bytes equal to the former script, the op table |
| `npm-deps` | the shared npm lock (`checks/npm`) installs the declared toolchain |
| `typecheck-harness` | the `tsc` runner accepts and rejects what it must |
| `bench` | the bench's own tests (`node --test`), run when its code builds |
| `typecheck-bench` | `tsc --strict` over the bench |
| `actor-subagents` | the patched pi-actor-subagents' own suite and the host's checks of each patch's wiring |
| `typecheck-actor-subagents` | `tsc --strict` over the patched pi-actor-subagents |
| `token-meter` | the token meter's own tests (`node --test`), run when it builds |
| `typecheck-token-meter` | `tsc --strict` over the token meter |
| `home-files` | the rendered sources exist and are what pi and the harnesses read: the extension, `LOGS.md`, both commands on an empty agent dir, the skill directory, the cache-lifecycle and experiments directories, cacheLifecycle's op through the activation's script, infinite-context's rendered settings through the extension's own parser, pi-retry's entry point, `ops.retry` through the script |
| `iface-harness` | the interface-comparison harness accepts a satisfied copy and rejects an unsatisfied one |
| `iface-subagents-bench-probe` | the bench probe's copy of `__subagentsApi_v1` is satisfied by the provider's `SubagentsApiV1` |
| `cache-lifecycle`, `experiments` | each package's own tests (`node --test`), run when it builds |
| `typecheck-cache-lifecycle`, `typecheck-experiments` | `tsc --strict` over each package |
| `iface-subagents-cache-lifecycle`, `iface-subagents-experiments` | their copies of `__subagentsApi_v1` are satisfied by the provider's `SubagentsApiV1` |
| `iface-experiments-token-meter`, `iface-experiments-cache-lifecycle` | their copies of `__piExperimentsApi_v1` are satisfied by the provider's `ExperimentsApiV1` |
| `infinite-context` | the patched pi-infinite-context's tests: upstream's `settings.test.ts`, the patches' own, `overlay-foreign.test.ts` and `integration.test.ts` (`index.ts` driven through its event handlers with stand-ins for pi's packages), and the greps on `index.ts` |
| `typecheck-infinite-context` | `tsc --strict` over the patched `extensions/` without upstream's two `fast-check` tests (the shared lock does not hold `fast-check`) and without its `tsconfig.json` |
| `retry` | the patched pi-retry's vitest suite (300 tests) on the shared npm lock, and the greps that pin the free-cap patch and the inline print/json route |
| `typecheck-retry` | `tsc --strict` over `retry.ts` and `src/`; the tests stay out (one upstream test and the free-cap patch's own test do not type-check; vitest runs them) |
| `task-router` | the router's own tests (`node --test`, 621), run when it builds; includes the redesign's golden grid against its frozen oracle, under the today fixture and under the defaults (the oracle with the default deltas) |
| `typecheck-task-router` | `tsc --strict` over `index.ts`, `core/` and `test/` |
| `iface-subagents-task-router`, `iface-experiments-task-router` | the router's copies of `__subagentsApi_v1` and `__piExperimentsApi_v1` (`ExperimentsApi` in `core/shell.ts`) are satisfied by the providers' types |
| `iface-policy-task-router` | the router's copy of the spawn policy's result (`PolicyResult` in `core/api.ts`: tool guard, `childTools`, `cwd`) is satisfied by the actor's type |
| `router-golden` | every decision of the router on the golden grid and the selection, equal to the recorded ones; P2 (the invariance) over the empty-slot `select` lines |
| `log-contract` | every log writer through `pi-analyse --check` and a full report |
| `leak`, `leak-selftest` | no e-mail addresses, named home paths (`/home/<name>`), `git+ssh` URLs, private (RFC 1918) or Tailscale addresses, LAN host URLs (`http://<one-label host>`, not `localhost`) or names under `.local`, `.lan`, `.home.arpa`, `.ts.net` in tracked files (a worktree's `.git` file is skipped) |
| `license` | `LICENSE` is MIT, every package declares MIT, `NOTICE` has a section per patched upstream |
| `boundary`, `boundary-selftest` | no file's content (binary files too), file name or directory name names an extension this repository does not ship, in the spellings `x-y`, `x_y`, `xy` and `xY` (case ignored); `NOTICE`, `LICENSE` and `patches/<input>/LICENSE` are skipped, the patches themselves are scanned; the selftest has a hit and a near miss for each kind of place |
| `render-package` | the committed `package.json` is the render of the module (AC2) |
| `pi-package-manifest` | the manifest's laws, each reported under its own name (AC3) |
| `pi-install-smoke` | `pi install ./pkg` offline: settings entry, `pi list`, every manifest extension loads, the router warns once, experiments stays inert (AC1) |
| `pi-git-route` | the npm step of a git install (`--omit=dev --legacy-peer-deps`) is a no-op offline (AC10) |
| `pi-install-actor` | the package next to the patched actor: no warning, `task_verdict` registered and active (AC5) |
| `pi-install-local` | the same with the router's settings `{"mode": "local"}`: the router finds the spawn API (no warning), `task_verdict` registered; a control run without the actor prints the spawn-API warning (local mode L4) |
| `pi-install-duplicate` | the package next to the Nix links: one `loaded twice` per component, exactly one bound copy (the actor warnings of task-router and cache-lifecycle appear once), no tool conflict, pi's skill loader reports the collision (AC7) |
| `pi-install-scope-replaced`, `pi-install-scope-both` | the package in two scopes of a trusted project (user `pi install` plus `.pi/settings.json`): where the project entry replaces the user's package, no `loaded twice` and one bound copy; where a second copy joins it, one `loaded twice` per component and one bound copy (AC7, review M1) |
| `pi-install-subset` | the README's filter loads only the listed extensions (AC4) |
| `bins-smoke` | `npm install -g <dir>` offline, both CLIs run through an explicit node, the shipped shebang, the `node_modules` failure the README states (AC9) |
| `runtime-guard-copies`, `iface-subagents-runtime-guard` | the four `runtime-guard.ts` copies are identical (AC8); `SubagentsApiV1` satisfies their `SubagentsApiShape` |
| `nix-route-smoke` | the Home Manager route's agent directory under real pi: every extension loads, no duplicate or missing-actor warning, `task_verdict` active, experiments' settings file (AC15) |

How to run them: `AGENTS.md`, "Commands".

## Resync with the original system configuration (M6.0)

That configuration moved the shared upstreams and the npm lock after the first
milestones copied them, so M6 resynced them first: the lock nodes `nixpkgs`
and `home-manager`, the shared npm lock (`checks/npm`, now pi 1.3.0 with
vitest and TypeScript 6), `pi-actor-subagents`, its check and its two
patches. Three patches that earlier documents name no longer exist, because
the upstreams or pi absorbed them: actor-subagents' `first-turn` (pi 1.2.0
runs `before_agent_start` for extension-triggered runs), infinite-context's
`foreign-messages` (upstream matches the projection as an ordered
subsequence; `overlay-foreign.test.ts` pins that) and pi-retry's `print-mode`
(upstream 0.11.0 retries print and json sessions inline; the `retry` check
pins that route). Where its patch could not be taken byte for byte,
the difference is one line: the fake `SessionLike` in the spawn-policy
patch's test carries a double cast (`tsc --strict` rejects it otherwise), and
the reminders patch's comment names no private path.
