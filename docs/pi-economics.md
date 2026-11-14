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

- Each entry is linked as `<agentDir>/pi-economics/extensions/<name>` →
  `path`, outside pi's auto-discovered `<agentDir>/extensions`: pi loads it
  from `settings.json`'s `extensions` (`loadOrder`). Home Manager rejects a
  second link of the same name.
- An assertion requires `checkPath` to exist. For a patched source, point it
  at the unpatched input's entry file (probing a build output would be
  import-from-derivation); its message names `input`.
- `forChildren` selects the extensions actor-subagents children load: their
  link paths `<home>/<agentDir>/pi-economics/extensions/<name>`, in load
  order (`loadOrder`), are the internal option `childExtensions`, which
  pi-setup's economics bridge hands to its `programs.pi.actorSubagents` for
  `actor-subagents/settings.json`.
- An entry named `actor-subagents` (pi-setup's patched actor, forwarded by
  the bridge) is how the components learn the actor is there: without it
  `cacheLifecycle` and `experiments` warn.

### `loadOrder` (read-only)

The registry's links relative to the agent directory, in load order:
`experiments`, `token-meter`, `cache-lifecycle`, `infinite-context`, then
the other entries by name. While the registry is not empty, `piSettings`
puts them at the front of `settings.json`'s `extensions` (contributor
`loadOrder`, op `ensurePrefix`, order 2000). While `piSettings.enable` is
`false`, nothing lists them and a warning says so.

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
| `ensurePrefix` | the list `value` (one value if not a list) leads, in its order; equal elements elsewhere are removed, the others keep their order | created, then `[]` | op skipped |

- `null` on the way or at the leaf counts as missing, except for
  `removeWhere`, which skips the op. `false` at the leaf of `ensureContains`
  and `ensurePrefix` counts as missing too.
- `false` on the way aborts the whole program: the file stays untouched.
- Order: by `order`, then contributor key, then position in the list.
- The entry runs only when `enable` is `true` and at least one op exists. It
  creates an absent file as `{}` (and its directory; its mode from the umask,
  as pi writes it) before the ops, since nothing else loads the registry; a
  dangling link stays as it is, with a notice. A link to a file: the target
  is edited in its own directory, the link stays. What it cannot create or
  write, and an op skipped for another type there or on the way (but
  `removeWhere` with nothing to remove), it names in a notice. It never fails
  the activation, and rewrites an existing file only when its JSON changes.

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
| `extensions` | the extensions the bench loads by name, one `mkDefault` each: the flake's `infinite-context`, `token-meter`, and `actor-subagents`, `task-router`, `experiments` at their `extensions.<name>.path` while the registry has them (see below) | `PI_BENCH_EXT_DIR`, a `linkFarm` of name → path |
| `baseExtensions` | `[]` | `PI_BENCH_BASE_EXTENSIONS`, the names comma-separated: every run loads them (see below) |
| `orchExtensions` | `[]` | `PI_BENCH_ORCH_EXTENSIONS`, the names comma-separated: the orchestrator factor arms and their children load them (see below) |
| `router` | `{}` (the bench: the run-time base alone, see below) | `PI_BENCH_ROUTER`, a JSON file merged over the run-time base; an orch arm merges its `routing`, `delegation`, `t0Limits` over both as `lib.recursiveUpdate` does |
| `agentsBaseline` | `null` (the bench: `<agent source>/notes/…`) | `PI_BENCH_AGENTS_OFF` |

The bench's `extensions` default covers the flake's own packages and the
registry's `actor-subagents`, `task-router` and `experiments` (whoever installs them). A
definition adds names (extensions of your own, not shipped here) or replaces one
by name; `lib.mkForce {}` exports nothing, and the bench then looks the names
up in the registry's links, `<agentDir>/pi-economics/extensions`.
`cache-lifecycle` is not loaded by the bench arms and is not in the default. `experiments` is loaded only by an
arm with a `pi.<lever>` factor (a process-scope lever such as `pi.compaction.reserveTokens`; such an arm also loads no
`infinite-context`, which cancels native compaction): the bench fails that arm before the run when the link is missing.
The bench writes the run's assignment as `experiments/assignment.json` (`packages/token-meter/LOGS.md`, "Bench assignment").

The orchestrator factor arms start their router settings from a base the bench
reads at run time from `<agent source>/task-router/settings.json`, the router's
live settings, whoever writes them: its keys that name the models and where to
reach them (`models`, `queueMaxSec`, `contextFit`, `localHealthUrl`,
`cloudDailyCap`, `contextWindow`), with `randomize.enabled` and
`spotCheck.enabled` set to `false`; without that file the base is `{}`.
`router` is merged over that base as `lib.recursiveUpdate` does: a definition
of one leaf (`bench.router.models.<m>.model`) replaces that leaf only.

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

### `actorSubagents` (moved)

The patched pi-actor-subagents (its three patches, the package
`pi-actor-subagents-patched` with `passthru.spawnPolicyApi = 2`, its suite and
its settings file `<agentDir>/actor-subagents/settings.json`) is pi-setup's
`programs.pi.actorSubagents` (router-extraction design §7.2). Here
`programs.piEconomics.actorSubagents` is a hidden stub (`modules/removed.nix`):
any definition fails the assertion

    pi-economics: programs.piEconomics.actorSubagents moved to pi-setup (programs.pi.actorSubagents)

and has no other effect; a definition under `lib.mkIf false` is none.

What still refers to the actor here: the registry entry `actor-subagents`
(above), which the components read for its presence and the bench links;
`childExtensions`, the list pi-setup's bridge hands back for the actor's
settings file; the copies of `__subagentsApi_v1` in cache-lifecycle,
experiments, the bench probe and the runtime guard, compared with pi-setup's
provider (`iface-subagents-*`); and the checks that load pi-setup's actor
(`pi-install-actor`, `home-files`, `nix-route-smoke`).

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
| `plans` | `{}` | per provider name: `billing` (`subscription`, `api`, `free`, `local`; a provider without a plan is `api`), `windows` (`5h`, `7d`), `rate` (`amount`, `currency`, `per = "hour"`; only with `billing = "local"`, else an assertion names every such provider: `pi-economics: tokenMeter.plans: a rate is set but billing is not "local" for <names>`); written to the key `plans` of the same file when non-empty (an unset `rate` is left out); the meter writes `billing` on every line (LOGS.md, *Meter line v2*) |
| `currencyRates` | `{}` | conversion rates, written to `currency.rates` of `token-meter/settings.json`: the key `"FROM/TO"` (three capitals each; 1 FROM = rate TO), a positive number; the inverse is used when only `"TO/FROM"` is set (both set: the direct one; a pair that disagrees by more than 1 % warns once on stderr). A key of any other shape is an assertion naming it: `pi-economics: tokenMeter.currencyRates key <k> is not "XXX/YYY"`. The Budget's costs by currency (API-eq cash $ in USD, each local rate's currency) are totalled only with one currency or a conversion; the experiment table converts its secondary-currency column the same way |

Without the actor (`extensions.actor-subagents`) there are no children to
meter and no `parentSessionId`; without `experiments` the lines carry no arm; without
the task router (pi-task-router) and `experiments` the reports lack their tier
and arm sections.
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
`cacheWarming` is `"idle"`, and pi's default is `streaming`. The op edits
that file (the entry creates it if absent); pi keeps its default while
`piSettings.enable` is `false`. Without
the actor in the registry (`extensions.actor-subagents`) it warns: no
warming while a session waits on its children.
Without `infiniteContext` the `context_peek` guard has nothing to log; without
`experiments` its own settings decide every factor. Neither warns.

### `experiments` (`modules/experiments.nix`)

The online experiment (`packages/experiments`): one fractional-factorial arm
per main session, recorded in `<agentDir>/experiments/assignments.jsonl` and
served with its levers' states on each runtime's internal channel
`pi-economics:levers:v1` (`pi.events`; the former global `__piExperimentsApi_v1` is removed).
A lever starts once its target extension asked the channel in that runtime; its
add-on (`packages/experiments/addons/`) reads it back. A child runtime never draws:
it derives its root's assignment and serves it on the child's own channel. Design v4's factors
(`warmPolicy`, `mainCacheTtl`, `maskOnCold`, the full 2³: 8 arms) are
`cacheLifecycle`'s; `tokenMeter` records the arm ids; the task router's levers
are no factors any more: its reads find its own settings.
A factor's `lever` is an add-on's id (`cache-lifecycle.*`) or a data-only kind that sets pi
itself, in the control tier (read back at `before_agent_start`; main sessions only): `pi.thinkingLevel` (levels from
`off`, `minimal`, `low`, `medium`, `high`, `xhigh`; read back is the session's effective level) and
`pi.activeTool(<name>)` (levels `false` and `true`: the tool in or out of the active set; a tool pi does not
register is refused up front). The module refuses levels pi does not accept
(`pi-economics: experiments factor <f> in stratum <s> has a level that <lever> does not accept`); the first level is the
baseline, so `[false, true]` for a tool that is off by default.
A third kind seeds any extension that adopts a value recorded on the session branch the way infinite-context does,
without the repository naming it: `session-entry(<customType>,<field>)` (seed tier). The engine appends the custom entry
`{ <field>: <level> }` at its own session start, before the target reads the branch (it does not append again when the
latest record already holds the level, a reload), and reads back the latest entry of that type at `before_agent_start`: the
target's own record (source `ext`, `refused`) when it drew another value. The seed is no evidence of anything, so the factor
names its `target` (`{ name, lever, levels, target }`: a name pi lists as a tool or a command, e.g. the extension's
command): `confirmed` needs the target listed at read-back and the latest record to hold the level, else the state stays
`unverified` (no target, target not listed, or a record of the type that predates the seed and differs: a target that
loads before pi-economics drew its own value, until a later entry shows the target's). A listed target that ignores the
seed without recording anything still reads `confirmed`: the read-back sees what the target records, never that it
adopted. Children are seeded with their root's level. The module refuses a session-entry factor without a target
(`pi-economics: experiments factor <f> in stratum <s> has a session-entry lever without a target`), a factor whose
`lever` is neither an id of `packages/experiments/addons/catalogue.json` nor one of the two kinds (`… has an unknown
lever <lever>`: it would randomize nothing) and a level that is not a level name (`a-z`, `0-9`, `_`, `-`, at most 32
characters), a number or a boolean (`… has a level that is not a level name, a number or a boolean`); the package's
`parseStrata` drops such a stratum with a warning.
Corrections and `/rate` ratings go to `<agentDir>/guards/events.jsonl`. There
is no timer: `meter-report --arms --posterior` updates the posterior on demand.

A stratum can put `infiniteContext`'s fold-reminder limit under test (the add-on
`addons/infinite-context.ts`, tier `seed`, lever `infinite-context.nudgeAtTokens`):

```json
{ "strata": { "local": { "match": { "billing": ["local"] }, "objective": "localCost",
  "factors": [{ "name": "nudge", "lever": "infinite-context.nudgeAtTokens", "levels": [0.25, 0.75] }] } } }
```

A level is a fraction `q` of the range of the rule that matches the session's model
(`infiniteContext.reminders`): the limit is `round(min + q·(max − min))` tokens. At
`session_start`, before infinite-context's own handler, and again at `model_select`
for a rule with another range, the engine appends infinite-context's settings record
(`{ nudgeAtTokens, nudgeAtTokensRange, rule }`, the rule being the override's key) so
that the extension keeps it; the record on the branch after the extension's handlers is
the read-back (`confirmed`; an extension that redrew it: `refused`, source `ext`, the
value it drew). The extension completes its record with `nudgeAtPercent`, the seed has
none: while the latest record lacks it the extension has not adopted anything, and the
state stays `unverified` (a tool of that name from another extension, a misordered load). A rule that is a fixed number draws nothing and ignores records: the
level is refused up front (`refused`, source `fixed`, `a` = the level, as there are no
tokens to assign; the state shows once the extension's record is read back, at the first prompt). The engine reads the rules from the
extension's settings file once per runtime, as the extension does: a file rewritten
mid-session is the next session's. The lever is live when pi lists infinite-context's `context_fold`
tool (the extension never asks the channel); a child seeds its own branch with its
root's level in its own model's range. The check `ic-seed-contract` runs the real
patched extension against the add-on.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `experiments` (`forChildren = true`: in a child it draws nothing and serves its root's arm and levers) |
| `package` | the flake's `packages/experiments` | the extension |
| `settings` | `{}` | written to `<agentDir>/experiments/settings.json` as given, `{}` as `{"mode": "explore"}` (`mode`, `minExplore`, `strata` (default: one per billing class of `tokenMeter.plans`, and `api`), `guards`, `correctionRegex`; the v1 engine's `factors`, `maxArms`, `baseline` are not applied and draw a warning; `baseline` still labels the analyses of v1–v4 designs); the file is the extension's opt-in: without it experiments is inert |

Without the actor in the registry (`extensions.actor-subagents`) it warns:
in-memory children are not recognised (it reads the actor's agent list; children
with a session file still run their root's arm).

### `infiniteContext` (`modules/infinite-context.nix`)

pi-infinite-context (upstream input `pi-infinite-context`) with one patch
from `patches/pi-infinite-context`, reminders: the settings file gains
`overrides`, fold-reminder rules per provider or model. It folds ranges of the
agent's own conversation by message id and unfolds them on demand. Main
sessions and children load it (`forChildren = true`).

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `infinite-context` (link `<agentDir>/pi-economics/extensions/infinite-context` → the package's `extensions/infinite-context`) and the settings file |
| `package` | the flake's `packages/infinite-context` | the patched source |
| `reminders.default`, `reminders.overrides` | `{}` | `{ nudgeAtTokens; nudgeAtPercent; }` (each `null` = inherit): `nudgeAtTokens` a positive integer or a range `[min, max]` with min < max, `nudgeAtPercent` a share of the model window in (0, 100]. `default` is the file's top level, `overrides` keyed by pi provider or exact `provider/modelId`. Each field resolves on its own: exact model, then provider, then `default`, then the extension's 150000 tokens / 75 %. Nulls and empty rules are left out of the file |
| `settings` | `{}` | merged into the file with `lib.recursiveUpdate`, on the right of what `reminders` renders (`nudgeAtTokens`, `nudgeAtPercent`, `overrides`) |
| `src` (internal) | set by `homeModules.default` from the input | the unpatched source the existence assertion probes |

The file `<agentDir>/infinite-context/settings.json` is always written, as
literal text; with every option at its default it is `{}`. The extension's
parser is fail-open like upstream's: it ignores an unknown key and drops an
invalid value, so the module asserts what its types let through (a range
whose min is not below its max, a share of 0) and the `home-files` check runs
the package's own parser on the rendered file. The session follows its
current model: a switch to a model whose rule has another range draws a new
limit and records it (`infinite-context:settings` with the rule's key in
`rule`, the rule that set `nudgeAtTokens` only). A record that an earlier
`model_select` handler appended is kept when it fits (that is how `experiments`
seeds the limit of an experiment's arm, without the extension knowing it; the check
`ic-seed-contract` holds that contract). Changes apply to sessions and subagents started after the switch.

Soft dependency, which does not warn: `cacheLifecycle`'s `context_peek` guard
reads infinite-context's tools.

### `retry` (removed)

The former `retry` component, a patched retry extension for OpenRouter's
daily free-tier cap, is gone with that free tier (redesign D19): pi's native
retry (its `retry.*` settings) handles transient errors.
`programs.piEconomics.retry` is a hidden stub (`modules/removed.nix`): any
definition fails the assertion

    pi-economics: programs.piEconomics.retry was removed; pi's native retry (settings retry.*) handles transient errors

and has no other effect; a definition under `lib.mkIf false` is none. The
keys the component once wrote into pi's mutable `settings.json` (its child
rule, the `settings` leaves) stay there; pi ignores them, remove them by hand.

### `taskRouter` (moved)

The task router is a flake of its own,
[pi-task-router](https://github.com/GRBurst/pi-task-router): its module
`programs.piTaskRouter`, its package, local mode, the golden grid, its checks
and its design record and research live there (router-extraction design §7.3).
Here `programs.piEconomics.taskRouter` is a hidden stub (`modules/removed.nix`):
any definition fails the assertion

    pi-economics: programs.piEconomics.taskRouter moved to the pi-task-router flake (programs.piTaskRouter)

and has no other effect; a definition under `lib.mkIf false` is none, so a
guarded leftover still evaluates.

What still refers to the router here, by its registry name `task-router` or its
input: the bench's `extensions` default and run-time base (above); the reports'
tier sections, which read its outcome log; its experiment factor; the checks
`log-contract` and `nix-route-smoke`, which read
the `pi-task-router` input; and the claim channel its runtime guard shares with
the three copies here (`runtime-guard-copies`).

## The pi package

The repository root is a pi package (`package.json`, rendered; spec decision D1): the three own extensions
(`packages/{cache-lifecycle,experiments,token-meter}/index.ts`), the analysis skill (`./skills`) and
the two CLIs (`bin`). A user without Nix installs it with `pi install git:github.com/GRBurst/pi-economics@v<version>`
(`README.md`, "Without Nix"); the Home Manager route is unchanged but for the deltas below.

**Render rule.** Only `nix run .#render` writes `package.json`. `render/default.nix` evaluates the module for one
fixture (every component on but `bench`), maps the registry's own names to `./packages/<n>/index.ts` (a name without a
package directory is a render error; the patched upstream `infinite-context` is skipped, the user
installs them; the actor, pi-setup's, is never in the fixture's registry) and adds `bin` when `tokenMeter` is on. `render-package` compares the committed file with it;
`pi-package-manifest` states the manifest's laws one by one (private, keyword, semver, peers = pi's five host
packages, imported-is-peer, no dependencies, paths, bin shebang and mode, skill fallback paths). The version is the
constant in `render/default.nix`; the tag is `v` + version. `render-package` also requires every `packages/<c>/package.json` to carry it (see AGENTS.md, "Versions").

**Runtime contract** (`packages/<c>/core/runtime-guard.ts`, three identical copies, `runtime-guard-copies`; the task
router keeps a copy of its own that claims on the same channel):

- `hasSubagentsApiV1`, checked at `session_start` (every factory has run by then, so the check does not depend on
  load order). `cache-lifecycle` warns once and does not keep sessions waiting on
  their children warm. `experiments` warns once (only with its settings file) and does not recognise in-memory children.
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
- Nix route deltas: N2 the actor-missing warnings are runtime warnings as well; N3 the single-copy guard; N4 the
  settings file; N5 the sources of the three packages (N1, `task_verdict` at `session_start`, left with the router).

Without the actor the package prints the warnings and keeps working; with pi-setup's patched actor next to it none appears
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
| `token-meter` | the token meter's own tests (`node --test`), run when it builds; they include the runtime guard's (token-meter's copy is the reference) and the claim protocol shared with the router |
| `typecheck-token-meter` | `tsc --strict` over the token meter |
| `home-files` | the rendered sources exist and are what pi and the harnesses read: the extension, `LOGS.md`, both commands on an empty agent dir, the skill directory, the cache-lifecycle and experiments directories, cacheLifecycle's op through the activation's script, infinite-context's rendered settings through the extension's own parser |
| `iface-harness` | the interface-comparison harness accepts a satisfied copy and rejects an unsatisfied one |
| `iface-subagents-bench-probe` | the bench probe's copy of `__subagentsApi_v1` is satisfied by the provider's `SubagentsApiV1` (here and below: the `pi-setup` input's patched actor-subagents) |
| `cache-lifecycle`, `experiments` | each package's own tests (`node --test`), run when it builds |
| `typecheck-cache-lifecycle`, `typecheck-experiments` | `tsc --strict` over each package |
| `iface-subagents-cache-lifecycle`, `iface-subagents-experiments` | their copies of `__subagentsApi_v1` are satisfied by the provider's `SubagentsApiV1` |
| `internal-channel` | the internal channel `pi-economics:levers:v1`: the experiments engine's payload (`Levers`), query and lever states against the copies token-meter (`core/channel.ts`) and cache-lifecycle (`core/api.ts`) keep, both ways (every key a copy reads is one the engine sends), and the event names |
| `infinite-context` | the patched pi-infinite-context's tests: upstream's suite without its three `fast-check` tests, with the patch's additions to `settings.test.ts` and `index.test.ts`, on the shared lock; `overlay-foreign.test.ts` and `integration.test.ts` (`index.ts` driven through its event handlers with stand-ins for pi's packages, reading the settings the module renders); the greps on `index.ts` (no fold hint, no `__piExperimentsApi_v1`) |
| `ic-seed-contract` | the seed contract of infinite-context's limit on the real code of the patched extension, the experiments engine with its add-on and token-meter's shell: the seed's record shape, adopted (confirmed in the levers line), a fixed-number rule (refused up front), a range the extension does not adopt (planted refusal: refused, source `ext`, in the levers line), a model switch (re-seeded in the new range), and the add-on's rule matcher equal to the extension's own over a generated table |
| `iface-infinite-context-seed` | the extension's `Settings` is assignable to the engine's copy of the seed record (`IcRecord`): a type-shape check only (an optional field dropped or renamed upstream is `ic-seed-contract`'s to see) |
| `typecheck-infinite-context` | `tsc --strict` over the patched `extensions/` without upstream's three `fast-check` tests (the shared lock does not hold `fast-check`) and without its `tsconfig.json` |
| `session-entry-contract` | the engine's real code and a fixture extension that adopts a recorded session entry the way infinite-context does (`checks/session-entry-contract/entry-ext`, a neutral stand-in) in one fake runtime: a level the target can adopt reads back `confirmed`, one it redraws `refused` with its own value; with no target the seed stands (the seed-tier limit) |
| `dependency-direction` | no file of `patches/`, the built patched infinite-context or the patched actor mentions a `pi-economics:` channel or the removed `__piExperimentsApi_v1`: extensions never depend on pi-economics (the router stays out: it shares the claim channel and still holds its dead read) |
| `state-contract` | `experiments/state.json` between the analyser and the engine: token-meter's writer (`nextState`) writes each v2 design's `disabled` and `posterior` under `designs.<id>.<stratum>`, and experiments' `designState` reads them back from that place (another stratum or design reads nothing; the flat keys are never read for a v2 design). Both sources side by side: packages import no other. |
| `log-contract` | every log writer through `pi-analyse --check` and a full report; the router's writer and vocabularies are the `pi-task-router` input's |
| `leak`, `leak-selftest` | no e-mail addresses, named home paths (`/home/<name>`), `git+ssh` URLs, private (RFC 1918) or Tailscale addresses, LAN host URLs (`http://<one-label host>`, not `localhost`) or names under `.local`, `.lan`, `.home.arpa`, `.ts.net` in tracked files (a worktree's `.git` file is skipped) |
| `license` | `LICENSE` is MIT, every package declares MIT, `NOTICE` has a section per patched upstream and none for another, and each licence text it names (`Licence text: <path>`, `checks/npm/LICENSE` among them) carries the MIT permission notice |
| `boundary`, `boundary-selftest` | no file's content (binary files too), file name or directory name names an extension this repository does not ship, in the spellings `x-y`, `x_y`, `xy` and `xY` (case ignored); `NOTICE`, `LICENSE`, the root `flake.lock` and `patches/<input>/LICENSE` are skipped, the patches themselves are scanned; the selftest has a hit and a near miss for each kind of place |
| `render-package` | the committed `package.json` is the render of the module (AC2) |
| `pi-package-manifest` | the manifest's laws, each reported under its own name (AC3) |
| `pi-install-smoke` | `pi install ./pkg` offline: settings entry, `pi list`, every manifest extension loads, cache-lifecycle warns once, no task router loads, experiments stays inert (AC1) |
| `pi-git-route` | the npm step of a git install (`--omit=dev --legacy-peer-deps`) is a no-op offline (AC10) |
| `pi-install-actor` | the package next to pi-setup's patched actor: the actor and every manifest extension load, no actor-missing warning (AC5) |
| `pi-install-duplicate` | the package next to the Nix links: one `loaded twice` per component, exactly one bound copy (cache-lifecycle's actor warning appears once), no tool conflict, pi's skill loader reports the collision (AC7) |
| `pi-install-scope-replaced`, `pi-install-scope-both` | the package in two scopes of a trusted project (user `pi install` plus `.pi/settings.json`): where the project entry replaces the user's package, no `loaded twice` and one bound copy; where a second copy joins it, one `loaded twice` per component and one bound copy (AC7, review M1) |
| `pi-install-subset` | the README's filter loads only the listed extensions (AC4) |
| `bins-smoke` | `npm install -g <dir>` offline, both CLIs run through an explicit node, the shipped shebang, the `node_modules` failure the README states (AC9) |
| `runtime-guard-copies`, `iface-subagents-runtime-guard` | the three `runtime-guard.ts` copies equal token-meter's (AC8), whose claim channel line stands verbatim in the `pi-task-router` input's copy too; `SubagentsApiV1` satisfies their `SubagentsApiShape` |
| `nix-route-smoke` | the Home Manager route's agent directory under real pi: every extension loads, no duplicate or missing-actor warning, `task_verdict` active (pi-setup's actor and the router as registry entries from the `pi-setup` and `pi-task-router` inputs' packages; the router's claim and the three copies' share one channel), experiments' settings file (AC15) |
| `identity-shim-probe` | the pinned pi still needs cache-lifecycle's `identityShim`: one offline session (pi-ai's faux provider) without the shim loses its warming run with "conversation context changed" once pi rebuilds a context that held a custom message, one with the shim keeps it; fails when a pi update fixes that (the shim may then go) |

How to run them: `AGENTS.md`, "Commands".

## Resync with the original system configuration (M6.0)

That configuration moved the shared upstreams and the npm lock after the first
milestones copied them, so M6 resynced them first: the lock nodes `nixpkgs`
and `home-manager`, the shared npm lock (`checks/npm`, now pi 1.3.0 with
vitest and TypeScript 6), `pi-actor-subagents`, its check and its patches (the
actor with all its patches has since moved to pi-setup). Three patches that earlier documents name no longer exist, because
the upstreams or pi absorbed them: actor-subagents' `first-turn` (pi 1.2.0
runs `before_agent_start` for extension-triggered runs), infinite-context's
`foreign-messages` (upstream matches the projection as an ordered
subsequence; `overlay-foreign.test.ts` pins that) and the retry component's
`print-mode` (upstream 0.11.0 retries print and json sessions inline; the
component itself has left since, see `retry` above). Where its patch could not be taken byte for byte,
the difference is one line: the fake `SessionLike` in the spawn-policy
patch's test carries a double cast (`tsc --strict` rejects it otherwise), and
the reminders patch's comment names no private path.
