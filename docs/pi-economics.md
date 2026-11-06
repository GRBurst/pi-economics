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

pi-actor-subagents (upstream input `pi-actor-subagents`) with two patches
from `patches/pi-actor-subagents`: child prompt and spawn policy (the
`globalThis.__subagentsApi_v1` other extensions drive).

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `actor-subagents` (link `<agentDir>/extensions/actor-subagents`, not loaded into children) and the settings file |
| `package` | the flake's `packages/actor-subagents` | the patched source; its `passthru` carries `spawnPolicyApi` = 1, the version of `__subagentsApi_v1` it provides |
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
`iface-experiments-task-router`, `router-golden`, `log-contract`.

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
constant in `render/default.nix`; the tag is `v` + version.

**Runtime contract** (`packages/<c>/core/runtime-guard.ts`, four identical copies, `runtime-guard-copies`):

- `hasSubagentsApiV1`, checked at `session_start` (every factory has run by then, so the check does not depend on
  load order). `task-router` without the API warns once and is off (no `task_verdict`, no `task_cards`, no nudge);
  its effort guard and fresh-on-cold stay on. `cache-lifecycle` warns once and does not keep sessions waiting on
  their children warm. `experiments` warns once (only with its settings file) and children do not inherit an arm.
  The text is `actorMissing(...)`, printed through `warnOnce` (once per process; `ctx.ui.notify` with a UI,
  `console.warn` without).
- `guardSingleCopy`: each extension claims its component on `pi.events` at load; a second copy in the same runtime
  registers nothing and warns once at `session_start` (`loadedTwice`). The first loaded copy wins.
- `experiments` is opt-in on both routes: inert without `<agentDir>/experiments/settings.json` (no arm, no
  `assignments.jsonl`, no warning). The Nix module writes the file whenever `experiments.enable` is set
  (`{}` becomes `{"mode": "explore"}`, N4).
- Nix route deltas: N1 `task_verdict` is registered at `session_start`; N2 the actor-missing warnings are runtime
  warnings as well; N3 the single-copy guard; N4 the settings file; N5 the sources of the four packages.

Without the actor the package prints the warnings and keeps working; with the patched actor next to it none appears
(`pi-install-actor`). The package checks load pi 1.4 offline (`pi -p`); they find the loaded extensions by pi's
`PI_TIMING=1` factory lines, an undocumented output pinned to the locked `pkgs.pi-coding-agent`: a pi that no longer
prints the block fails them with one message ("pi printed no PI_TIMING block").

## Patched upstreams

A component built from an upstream repository takes it as a `flake = false`
input. Its patches live in `patches/<input>/` under the file names of the author's system configuration, so
the derivation is that configuration's, bar two one-line differences (see "Resync"); `homeModules.default` hands the input to the
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
| `task-router` | the router's own tests (`node --test`, 442), run when it builds; includes the redesign's golden grid against its frozen oracle, under the today fixture and under the defaults (the oracle with the default deltas) |
| `typecheck-task-router` | `tsc --strict` over `index.ts`, `core/` and `test/` |
| `iface-subagents-task-router`, `iface-experiments-task-router` | the router's copies of `__subagentsApi_v1` and `__piExperimentsApi_v1` (`ExperimentsApi` in `core/shell.ts`) are satisfied by the providers' types |
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
| `pi-install-duplicate` | the package next to the Nix links: one `loaded twice` per component, no tool conflict, pi's skill loader reports the collision (AC7) |
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
