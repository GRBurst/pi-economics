# pi-economics

Home Manager components for the pi coding agent's token economics, under
`programs.piEconomics`. Import `homeModules.default`: it brings every
component and the shared options below. Design and milestones:
`docs/specs/2026-10-12-pi-economics-design.md`; one plan per milestone in
`docs/plans/`.

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
| `extensions` | the flake's packages the bench loads by name, one `mkDefault` each: `actor-subagents`, `infinite-context`, `pi-retry`, `token-meter` (see below) | `PI_BENCH_EXT_DIR`, a `linkFarm` of name → path |
| `router` | `{}` (an arm's file: its own keys) | `PI_BENCH_ROUTER`, a JSON file; an orch arm merges its `routing`, `delegation`, `t0Limits` over it as `lib.recursiveUpdate` does |
| `agentsBaseline` | `null` (the bench: `<agent source>/notes/…`) | `PI_BENCH_AGENTS_OFF` |

The bench's `extensions` default covers the flake's own packages. A
definition adds names (`claude-auth`, `web-search` at a host) or replaces one
by name; `lib.mkForce {}` exports nothing, and the bench then looks the names
up in `~/.pi/agent/extensions`. `cache-lifecycle` and `experiments` are not
loaded by the bench arms and are not in the default.

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
link paths, as the host wrote it.

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
| `settings` | `{}` | written to `<agentDir>/experiments/settings.json` when non-empty (`mode`, `factors`, `maxArms`, `minExplore`, `baseline`, `guards`, `correctionRegex`) |

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
| `settings` | `{}` | pi-retry's keys under `piRetry` in pi's `settings.json`, one `set` per leaf at order 500 (`baseDelayMs`, `maxDelayMs`, `multiplier`, `maxRetriesAtMaxDelay`, `messageFreeRetries`, `subagents.*`); a list is one leaf, replaced whole, and no whole object is set, so keys pi or the user wrote survive |
| `src` (internal) | set by `homeModules.default` from the input | the unpatched source the existence assertion probes |

No file of its own. `piSettings.ops.retry`: remove the two stale package
entries (`https://github.com/monotykamary/pi-retry` and
`git:github.com/monotykamary/pi-retry`), then, only while `actorSubagents` is
enabled, `ensureContains` the child rule `^You were spawned by "` (flag `m`)
in `piRetry.subagents.match.systemPromptRegex`; `settings` leaves come at
order 500, so they run first. The ops run only while `piSettings.enable` is
`true`. Without `actorSubagents` there is no child rule and no warning.

## Patched upstreams

A component built from an upstream repository takes it as a `flake = false`
input. Its patches live in `patches/<input>/` under the host's file names, so
the derivation is the host's, bar two one-line differences (see "Resync"); `homeModules.default` hands the input to the
component as its internal option `src`, and the registry entry's `checkPath`
points into `src`.

## Checks

| Check | Covers |
|---|---|
| `module-eval` | Home Manager evaluations: exports, options, registry, piSettings rendering, assertions with their negative cases, the skill text, the skill↔meter contract, soft-dependency warnings, the host's combination |
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
| `leak`, `leak-selftest` | no e-mail addresses, named home paths, `git+ssh` URLs or private addresses in tracked files |

How to run them: `AGENTS.md`, "Commands".

## Resync with the host (M6.0)

The host moved the shared upstreams and the npm lock after the first
milestones copied them, so M6 resynced them first: the lock nodes `nixpkgs`
and `home-manager`, the shared npm lock (`checks/npm`, now pi 1.3.0 with
vitest and TypeScript 6), `pi-actor-subagents`, its check and its two
patches. Three patches that earlier documents name no longer exist, because
the upstreams or pi absorbed them: actor-subagents' `first-turn` (pi 1.2.0
runs `before_agent_start` for extension-triggered runs), infinite-context's
`foreign-messages` (upstream matches the projection as an ordered
subsequence; `overlay-foreign.test.ts` pins that) and pi-retry's `print-mode`
(upstream 0.11.0 retries print and json sessions inline; the `retry` check
pins that route). Where the host's patch could not be taken byte for byte,
the difference is one line: the fake `SessionLike` in the spawn-policy
patch's test carries a double cast (`tsc --strict` rejects it otherwise), and
the reminders patch's comment names no host path.
