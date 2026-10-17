# pi-economics — design

Date: 2026-10-12 · Status: draft r4 (2026-10-17), after reviews 1–3 and the
owner's decisions of 2026-10-17 · Owner: pallon

Revision 2 addresses review 1 (2 blockers, 9 majors, the minor findings).
Revision 3 addresses review 2 (4 majors, minors, nits) and records the owner's
decisions on the H row, the H pin and the wiring gate.
Revision 4 follows the owner's decisions of 2026-10-17
(`~/.pi/agent/notes/2026-10-17-router-redesign-decisions.md`):

- The move is a pure, behaviour-preserving move. r3's Haiku tier `H`, its row
  and pin, the scout, fallback, escalation and Qwen-chain changes, the new log
  fields and the Haiku bench arms are gone (r3 §6, §7).
- The router is redesigned first, in the host, under its own spec. M5 moves
  the redesigned router (§1, §6, §9).
- The host is no longer frozen. Its flake files stay untouched until W
  (§1, §9.1).
- Review 3's remaining findings: the bench's router projection (§7), a
  `piSettings` switch and contributor-keyed ops (§5.4), the W3 re-pointing
  (§9.1), `lib.recursiveUpdate` for merges (§4), more interface comparisons
  (§8.1), RFC 1918 as full quads and a duplicate bullet (§8.3). Its facts on
  today's slot race and logs are handed to the redesign (§6.4). Its findings
  on the H row and pin are moot.
- The snapshot is cited by its id after the host's history rewrite, and the
  host's full check follows the host's current rules (§8.2).

Source snapshot: host dotfiles commit `f6a3c81` (2026-10-10), the last commit
that touched the moved paths. Before the owner's history rewrite of
2026-10-17 its id was `cee41b5` (host
`docs/plans/2026-10-17-commit-id-rewrite.md`). Everything below about "today"
refers to that snapshot. The task-router alone moves from a later host
commit, *R* (§6.1, §9).

Line numbers refer to `f6a3c81` for the host files unchanged since: all of
`modules/home-manager/features/ai/` and `pkgs/pi-bench/`, which are the same
at host commit `ed0d2df` (2026-10-17). For `flake.nix`,
`checks/eval-assertions.nix` and `homes/pallon/default.nix`, which changed
since, they refer to `ed0d2df`. Each plan re-locates its sites by content.

## 1. Intent

Move the pi token-economics stack out of the NixOS flake
`~/projects/nixos/new` (below: *the host repo*) into a standalone flake
`~/projects/nix/pi-economics`, component by component. Each component can be
switched on and configured on its own. A dependency that would otherwise make
a component fail silently is enforced by a module assertion.

The move is pure: no component changes what it does. Only the packaging
changes: one option namespace, a shared extension registry (§5.1), `piSettings`
ops in place of the host's migrate script (§5.4), and the bench's paths and
router base as options (§7). For today's configuration each of them gives
today's result, and the checks of §8 show it.

The router does change, but not in this spec. Claude Haiku 5.5 exists, and
the free OpenRouter Qwen is gone; Qwen runs locally for now. The owner's order
of work (2026-10-17):

1. This spec, as a pure move.
2. The router redesign (abilities and levels per model, Haiku as one of the
   models), in place in the host repo under
   `modules/home-manager/features/ai/extensions/task-router/`. It has its own
   spec, `~/projects/nixos/new/docs/specs/2026-10-17-task-router-abilities-design.md`,
   and its own TDD plan. Its tests run as the host check `pi-task-router`.
3. M5 moves the redesigned router: the task-router's source snapshot is
   re-pinned to the host commit that lands the redesign (*R*, §9).

M0–M4 and M6 do not wait for the redesign.

What the owner decided:

- Everything belonging to pi token economics moves, one component at a time.
  The flake is named *pi-economics*, with options
  `programs.piEconomics.<component>`.
- Each component has enable/disable plus configuration. Dependencies are
  covered by option checks.
- The move preserves behaviour (2026-10-17). The router moves as the host has
  it at R:
  - models are configurable, as today (the router's `models` setting);
  - the free-cloud slot's code stays. While the slot is empty, it is not taken
    into account.
- The router redesign belongs to the host spec (2026-10-17). It supersedes
  r3's Haiku tier `H`, its row and pin, the Haiku placement and the named-tier
  configuration.
- The Haiku context-reminder values (§5.2) stay as host wiring values. They
  are not routing.
- The host repo is no longer frozen: pluto's critical part is done
  (2026-10-17). The host's flake files (`flake.nix`, `flake.lock`) stay
  untouched until W. Until W, only tests inside this flake. Integration tests
  on the real system come afterwards, and activation is an owner step.
- One overall spec, reviewed at least once. One TDD plan per milestone.
- The repository becomes public when finished. The bench keeps one paid
  OpenRouter judge.

Assumption: the git history of the moved code is not imported. It is private,
and it is mixed with unrelated dotfiles.

### Success criteria

1. `nix flake check` on this flake passes. That covers every component's
   tests, the type check, the module evaluation cases, the negative case of
   every assertion, and the leak check.
2. Behaviour is preserved. Each package's own tests pass as copied, changed
   only for neutral fixture names (§8.3), and the router's golden test against
   R passes (§6.3).
3. After wiring (§9.1), the host enables each component through
   `programs.piEconomics.*` and keeps no in-tree copy of it. The host's checks
   and the owner's `nixos-rebuild test` pass.
4. The reports still read the existing logs under `~/.pi/agent`.
5. The move adds no OpenRouter use. The router reaches OpenRouter only through
   the optional free-cloud slot (§6.1). The bench reaches it through its paid
   judge `gpt` (§10) and through its `qwen` arm, as long as that arm exists
   (§7).
6. The repository is fit for publication (§8.3).

### Non-goals

- `pi-claude-auth` stays in the host. It handles auth and billing headers and
  is coupled to the host's `~/.pi/claude` sandbox layout.
- `pi-question`, `pi-session-name`, `web-search`, `prompt-log` and
  `static-working-indicator` stay in the host. They join the shared registry
  (§5.1) as host entries.
- No behaviour change in any component (§1). In particular no routing change:
  abilities, levels, Haiku's place, the selection order, escalation and any new
  log field belong to the host's redesign.
- No new experiments.
- Retiring the bench's `qwen` arm, which names the retired free OpenRouter
  Qwen, is a change of its own, outside the move (§7).

## 2. Components

| Option `programs.piEconomics.…` | Source (host repo, `ai/` = `modules/home-manager/features/ai`) |
|---|---|
| `bench` | `pkgs/pi-bench/` |
| `actorSubagents` | `ai/pi-actor-subagents.nix` + child-prompt, spawn-policy and first-turn patches |
| `tokenMeter` | `ai/extensions/token-meter/` (+ `meter-report`, `pi-analyse`, `LOGS.md`) |
| `cacheLifecycle` | `ai/extensions/cache-lifecycle/` |
| `experiments` | `ai/extensions/experiments/` |
| `taskRouter` | `ai/extensions/task-router/`, from R (§6.1) |
| `infiniteContext` | `ai/pi-infinite-context.nix` + reminders and cache patches; `piContextReminders` options and render from `ai/pi-extensions.nix` |
| `retry` | `ai/pi-retry.nix` + print-mode and free-cap patches; `checks/pi-retry` with its `package.json`/lock |
| `analysisSkill` | `ai/skills/pi-token-economics-analysis/` |
| (shared) | `ai/pi-settings-migrate.nix` and `checks/pi-settings-migrate`, split per §5.4 |

Documentation:

- `docs/pi-token-economics.md` moves to this flake's `docs/`, scrubbed (§8.3).
  The host keeps a pointer page, as `docs/terminal-kit.md` does.
- The 2026-10-02 spec and plan stay in the host as history. Code comments that
  cite them ("spec §5.2.5", "T5.21") are re-pointed to this spec or the moved
  doc.

## 3. Flake layout

```
flake.nix                 inputs, packages.<c>, homeModules.default, checks, formatter
modules/default.nix       imports common.nix and every component module
modules/common.nix        agentDir, extension registry (§5.1), piSettings (§5.4)
modules/<c>.nix           one HM module per component
packages/<c>/             TypeScript packages
patches/<upstream>/*.patch
checks/                   module-eval cases, assertion negatives, log contract, leak check, type check, router golden test
skills/pi-token-economics-analysis/
docs/                     specs/, plans/ (one plan per milestone), pi-economics.md
```

**Exports.** Only `homeModules.default` is exported. Per-component module
exports were dropped (review M4): with every module imported, every option a
cross-component assertion reads always exists.

**Inputs.**

- `nixpkgs`, and `home-manager` (checks only).
- The `flake = false` sources `pi-actor-subagents`, `pi-infinite-context` and
  `pi-retry`.
- The host makes all of them `follows` its own inputs, as it does for
  `nix-terminal`.

**npm dependencies.** These come from one lock file, the moved
`checks/pi-retry` `package.json`/`package-lock.json` (fixed `npmDepsHash`). It
already pins `typescript` 6.0.3 and `@types/node` 25.9.1, which the type check
reuses (§8.1). Formatter: Alejandra.

## 4. Module contract

`programs.piEconomics.agentDir` defaults to `".pi/agent"`, relative to home.
pi's `PI_CODING_AGENT_DIR` is not modelled. A host that moves the agent dir sets
this option.

Every component has `enable` and `package`. What a component writes:

| Component | Files written (under agentDir unless noted) | `settings` → |
|---|---|---|
| `bench` | none; `home.packages` + session variables | — (typed options §7) |
| `actorSubagents` | `extensions/actor-subagents` link via the registry; `actor-subagents/settings.json` = `lib.recursiveUpdate settings { childExtensions = …; }` (one writer, §5.1) | `actor-subagents/settings.json` |
| `tokenMeter` | `token-meter/settings.json` if non-empty; `LOGS.md`; `home.packages` = report, analyse | `token-meter/settings.json` |
| `cacheLifecycle` | `cache-lifecycle/settings.json` if non-empty; piSettings op `cacheWarming = "idle"` (§5.4) | `cache-lifecycle/settings.json` |
| `experiments` | `experiments/settings.json` if non-empty | `experiments/settings.json` |
| `taskRouter` | `task-router/settings.json` = `settings`, written when non-empty, as today (§6.2) | `task-router/settings.json` |
| `infiniteContext` | `infinite-context/settings.json` from the reminder options, always written (as today) | merged into it |
| `retry` | piSettings ops (§5.4); no file of its own | piSettings `piRetry` keys |
| `analysisSkill` | none; exports `path` for the host's skill wiring | — |

With every `settings` at its default `{}`, each file equals today's.

Rules:

- Directory names are kebab-case; option names are camelCase.
- Settings files are literal text (`builtins.toJSON`), so checks can read them
  with `fromJSON` without import-from-derivation.
- **Merges:** where two attrsets render into one file, they merge with
  `lib.recursiveUpdate`, with the user's `settings` on the right. A nested key
  in `settings` then replaces only its own leaf, and the siblings from the
  other side survive; `//` would drop them. Lists are replaced whole.

### 4.1 Dependencies

**Rule.** A dependency is *hard*, and becomes an assertion, only when its
absence makes the dependent component silently useless. A *soft* dependency
loses one feature that each side tolerates at runtime. When the dependency is
missing, the module emits an HM warning.

Hard dependencies:

| Component | Requires | Why |
|---|---|---|
| `taskRouter` | `actorSubagents.enable`, and `actorSubagents.package.passthru.spawnPolicyApi >= 1` | `shell.ts:120` swallows a missing `registerSpawnPolicy`; without the patched build the router does nothing |
| `analysisSkill` | `tokenMeter.enable` | the skill drives `pi-analyse` and reads `LOGS.md` |

The patched `actorSubagents` package sets `passthru.spawnPolicyApi = 1`
through `overrideAttrs`, because nixpkgs' `applyPatches` refuses a `passthru`
argument. The assertion reads `package.passthru.spawnPolicyApi or 0`.
Assertion message: `pi-economics: <c> requires <d> (<reason>)`. Every
assertion has a negative case in `checks/`.

Standalone notes:

- `analysisSkill` only exports a path; the consumer links it into a skills
  directory. The skill's text names `<agentDir>/LOGS.md`, substituted at build
  time instead of the hard-coded `~/.pi/agent/LOGS.md`.
- A standalone `cacheLifecycle` keeps pi's default `cacheWarming` while there
  is no pi `settings.json`, because the piSettings activation does nothing on
  an absent file, and while `piSettings.enable` is `false` (§5.4). The module's
  description says so.

Soft dependencies (documented, plus warnings for the ones marked *w*):

| Consumer | Provider | Lost without it |
|---|---|---|
| `cacheLifecycle` *w* | `actorSubagents` | warming while waiting on children (`shell.ts:83` tolerates absence) |
| `experiments` *w* | `actorSubagents` | arm inheritance by children (`shell.ts:77-79`) |
| `cacheLifecycle` | `infiniteContext` | the `context_peek` guard (`shell.ts:124`) |
| `taskRouter`, `cacheLifecycle`, `tokenMeter`, `infiniteContext` | `experiments` | flags and arm ids (`__piExperimentsApi_v1`) |
| `tokenMeter` | `actorSubagents` | `parentSessionId`, via the child session path layout |
| `tokenMeter` reports | `taskRouter`, `experiments` | tier and arm sections |
| `retry` | `actorSubagents` | child detection; the regex op (§5.4) is added only when `actorSubagents` is enabled |

## 5. Shared mechanisms

### 5.1 Extension registry

`programs.piEconomics.extensions.<name>` is an attrset of submodules
`{ path; checkPath ? path; input ? null; forChildren; description; }`. Each
enabled extension component adds itself. The host adds its own extensions
(claude-auth, question, …).

`common.nix` renders the registry:

- **Links:** `<agentDir>/extensions/<name>` → `path`. Home Manager's
  file-conflict check rejects two definitions of one link.
- **Children:** `childExtensions`, the **link path**
  `<home>/<agentDir>/extensions/<name>` of every entry with
  `forChildren = true`, sorted by name. These are link paths, not store paths,
  as today (`pi-extensions.nix:236-238`). The host check that takes names from
  the last path component (`eval-assertions.nix:9354`) keeps working. It goes
  into `actor-subagents/settings.json` together with `actorSubagents.settings`.
  That file has one writer: the registry renders the file only when
  `actorSubagents` is enabled.
- **Existence:** an assertion `builtins.pathExists checkPath` per entry,
  carried over from `pi-extensions.nix:71-79,366`. For a patched source,
  `checkPath` names the unpatched input file, which avoids
  import-from-derivation. A patch that no longer applies fails the package
  build. The assertion message names `input`.

The registry replaces the `linkExtension` options and the double-link
assertion.

### 5.2 Context reminders

The `piContextReminders` options (`prices`, `cacheTtlMinutes`, `foldHint`,
`default`, `overrides`) move to `programs.piEconomics.infiniteContext.reminders`.

The values below are host wiring, not routing (owner, 2026-10-17). Haiku 5.5
has a 1M-token window, per Anthropic's model page (2026-10). The "haiku (200k
window)" comment in `homes/pallon/default.nix:29-31` predates it and refers to
Haiku 4.5. At W the host adds, next to the Opus and Sonnet entries:

- `overrides."anthropic/claude-haiku-5-5" = { startTokens = 100000;
  everyTokens = 50000; }`. Earlier than Opus and Sonnet (400k / 100k): a
  small model degrades sooner on long contexts, and 100k is where Haiku's API
  price steps up 5×.
- `prices."anthropic/claude-haiku-5-5" = { w = 0.125; r = 0.01; }`. These are
  the cache write (5 min) and cache read prices per MTok for prompts up to
  100k; only the ratio w/r is used (`pi-extensions.nix:269-295`).

### 5.3 Cross-extension contracts

The versioned `globalThis` keys `__subagentsApi_v1` and
`__piExperimentsApi_v1` are unchanged.

| API | Provider | Consumers |
|---|---|---|
| `__subagentsApi_v1` | the spawn-policy patch, which adds `actor-subagents/api.ts` | task-router, cache-lifecycle, experiments, and pi-bench's `probe/index.ts` |
| `__piExperimentsApi_v1` | experiments | task-router, cache-lifecycle, token-meter, and the infinite-context cache patch |

Consumers keep their own copies of the interface types. The type check (§8.1)
compares each copy with the provider's definition. For `__subagentsApi_v1`,
that definition is read from the `applyPatches` output. The infinite-context
patch casts inline (`cache.patch:102`) and is excluded from the comparison.

### 5.4 Mutable pi settings

pi's `settings.json` is mutable. `programs.piEconomics.piSettings` provides:

- **`enable`:** default `true`. While `false`, no activation entry is
  rendered, whatever ops the components contribute. The host sets it to
  `false` from W0, when it first imports the module, until W6. Until then its
  own `piSettingsMigrate` script runs, and two entries of that name would
  conflict (§9.1).
- **`file`:** a string, either absolute or relative to home. Default
  `<agentDir>/settings.json`. The host sets `.local/state/pi/settings.json`.
- **`after`:** a list of activation entry names to run after, in addition to
  `writeBoundary`. The host names its seed and reclaim steps.
- **`ops`:** `attrsOf (listOf op)`, keyed by contributor. Each component
  writes `ops.<component>`, and the host writes under a key of its own, e.g.
  `ops.host`. An op is `{ op; path; value; order ? 1000; }`. `path` is a list
  of object keys, e.g. `["piRetry" "subagents" "match" "systemPromptRegex"]`,
  never a dotted string.

| `op` | Effect | Missing parents | Wrong shape on the path |
|---|---|---|---|
| `set` | sets the leaf to `value`, only if it differs | created as objects | op skipped |
| `ensureContains` | appends `value` to the list at `path` if no equal element exists | created (objects, then `[]`) | op skipped |
| `removeWhere` | removes the list elements equal to `value` | op skipped | op skipped |

"Wrong shape" means a non-object on the way, or a non-list leaf for the list
ops.

Rendering and execution:

- **One jq program.** Each op is a separate jq function with its own shape
  guard. A shape error therefore skips only that op, as today's "odd-shapes"
  fixture requires (`pi-settings-migrate.nix:71-77`), and never aborts the
  program. If jq fails anyway, for example on invalid JSON, the file is left
  untouched and the activation does not fail (as today).
- **Order:** the ops of all contributors are sorted by `(order, key, index)`:
  by `order`, then by contributor key, then by position in that contributor's
  list. Keying by contributor is what makes this order deterministic across
  modules. A plain `listOf` merged across modules carries no contributor
  name; its merge order follows the import order.
- **No whole-object `set`:** there is no `set` of a whole object. Components
  set leaves, so runtime keys written by pi or by the user survive.
  `retry.settings` is turned into one `set` per leaf under `piRetry`, with
  `order = 500`, so that it runs before the `ensureContains` of the child regex
  (`order = 1000`).
- **Activation:** one entry, named `piSettingsMigrate` (the name the host's
  checks read, `eval-assertions.nix:9395,9530`). It is rendered when `enable`
  is `true` and at least one op exists. It runs
  `entryAfter (["writeBoundary"] ++ after)`. It is idempotent, rewrites only on
  change, and does nothing when the file is absent (as today). A new install
  gets its first file from the host's seed.

Component contributions:

- **`ops.retry`:**
  - removes the stale package entries of earlier pi-retry spellings
    (`pi-settings-migrate.nix:36-40`);
  - when `actorSubagents` is enabled, `ensureContains` on
    `piRetry.subagents.match.systemPromptRegex`.
- **`ops.cacheLifecycle`:** `set cacheWarming "idle"`. This replaces the
  positional `idle` argument.

The host adds its own ops under its own key, for example the removal of the
stale `git:github.com/fdietze/pi-claude-auth@main` entry. The script and its
fixture check (`checks/pi-settings-migrate`) are ported in M0, with the
fixtures rewritten as op cases.

## 6. Router (milestone M5)

### 6.1 What moves

M5 copies the task-router from *R*, the host commit that lands the redesign
(§1). The move changes no routing decision, no default and no log field. The
host's redesign spec owns all three.

M5 relies on four properties of R. Its plan checks each against R first. If
one does not hold, M5 stops and reports to the owner; the move does not add
it.

- Models are configurable through the router's settings file, with their
  defaults in `core/settings.ts` (today `models`, `settings.ts:13-18`).
- The free-cloud slot's code is there, and an empty slot is not taken into
  account: no route, cap, count or wait. Today the slot is not optional:
  `pickQwen` picks the free cloud first whenever no cloud child runs
  (`chain.ts:15`), and the default names the retired free model
  (`settings.ts:15`).
- The router registers through `registerSpawnPolicy` of `__subagentsApi_v1`
  (§4.1) and reads `__piExperimentsApi_v1` (§5.3).
- Its outcome events follow `LOGS.md`, so that the moved reports and the log
  contract (§8.1) read them.

### 6.2 Module

`taskRouter.settings` is free-form JSON. It is written to
`task-router/settings.json` when non-empty, as today (`hm-module.nix:59-60`).
There are no typed options: the redesign owns the settings schema, and
`core/settings.ts` stays the one owner of defaults (host `AGENTS.md`).

### 6.3 Tests

- **The router's own suite,** as copied from R, changed only for neutral
  fixture names (§8.3).
- **Golden test:** R's routing decisions, recorded once as a golden file.
  - A generator in `checks/` runs R's code from a host checkout at R over
    every input of the routing table and writes the decisions, together with
    R's commit id. The generator runs once, by hand, in M5; the check only
    reads its output.
  - The check runs the moved package over the same inputs and compares. Any
    difference fails it.
  - The input space is fixed in M5's plan from R's types. For today's code it
    would be base × importance × kind × profile pin, explicit model × effort,
    and every chain state of `pickQwen`.
  - Two settings: R's defaults, and a fixture that sets every model key and
    leaves the free-cloud slot empty.
  - An edit that `tsc --strict` forces (§8.1) is covered by this test.
- The redesign's own characterization test, a replay of the host's October
  outcome log, stays in the host. That log is private data.

### 6.4 Handed over to the redesign

Review 3 recorded two facts about today's router. The move keeps both as they
are (§1). They are listed here for the host spec.

- **Slot race:** two concurrent spawns can both pick the local slot, because
  `d.children.set` runs only after `await resolveLeg` (`policy.ts:87-92`).
  Review 3's fix: `resolveLeg` writes the child's `children` entry when it
  picks a route, before any further `await`. `PENDING_MS` (`policy.ts:34,45`)
  already counts an entry that the API does not list yet as holding its slot.
  The failover's `resolveLeg` calls (`failover.ts:28,41`) need the same.
- **Logs:** a randomized pick is already data, because the `spawn` event
  carries `assigned` and `routeBase` (`outcome.ts:46`). `workerTier` is the
  worker after randomization and escalation. A queue fallback is visible only
  in `reasons` (`policy.ts:56,88`). A field for the tier a child actually ran
  on gives a per-protocol view; the randomized comparison reads `assigned`
  (intention to treat).

## 7. Bench (milestone M1)

Bench options:

- **`dataDir`:** default `<agentDir>/bench`, exported as `PI_BENCH_DATA`.
- **`workDir`:** default `$XDG_RUNTIME_DIR/pi/tmp/bench`.
- **`extensions`:** an attrset of name → path, the extensions a bench arm
  loads.
  - It is data, not derived from the registry: today's `CHILD_EXTENSIONS`
    (`orch.ts:18-20`) deliberately excludes cache-lifecycle, and the arms need
    the host's claude-auth and web-search.
  - It reaches the bench as a `linkFarm` (one link per name) exported as
    `PI_BENCH_EXT_DIR`. Today the bench looks extensions up by name in a
    directory (`config.ts:41`, `orch.ts:69`), so only the directory changes.
  - The host sets it at W. After M6 its default covers the flake's own
    packages.
- **`router`:** the base of the `task-router/settings.json` that an orch arm
  writes.
  - Today an arm writes only `routing`, `delegation` and `t0Limits`
    (`orch.ts:64-68`). Everything else, the models and the health URL
    included, comes from the router's TypeScript defaults, and an arm never
    randomizes or spot-checks.
  - Default in M1: `{}`. An arm's file is then today's, byte for byte.
  - Default from M5, when `taskRouter` is enabled (else still `{}`): a
    projection of `taskRouter.settings` onto the keys that say which models
    exist and where to reach them. Today these are `models`, `localHealthUrl`, `queueMaxSec`
    and `cloudDailyCap`; M5's plan fixes the list from R's schema.
    `randomize.enabled` and `spotCheck.enabled` are forced to `false`. Without
    the projection, the host's randomization and spot checks would reach every
    arm (review 3).
  - Reason: the arms must run on the models the host configures. Once the
    host sets them in `taskRouter.settings` (W4, §9.1), or P makes the
    defaults neutral (§8.3), the defaults alone no longer name them.
  - The arm's own keys are merged over `router` deeply, as
    `lib.recursiveUpdate` does.
  - It reaches the bench as a JSON file exported as `PI_BENCH_ROUTER`. Unset,
    the bench behaves as today.
  - Tests: with `router = {}`, an arm's file equals today's. With a
    `taskRouter.settings` that enables `randomize` and `spotCheck`, an arm's
    file carries the projected keys and both switches off.
- **`agentsBaseline`:** the AGENTS.md variant a bench arm uses. Today it is the
  personal notes path read at `config.ts:46`.

Arms:

- Arms and judge defaults stay as in the source. Extra arms are data:
  `<dataDir>/arms.json` overlays the defaults (`config.ts:30-33`), so a new
  measurement needs no code change.
- The `qwen` arm still names the retired free OpenRouter Qwen, and `judge` and
  `judge-all` default to it (`cli.ts:99,105`). Retiring it is a change of its
  own, outside the move (§1).
- The paid OpenRouter judge `gpt` stays (§10).
- The host's in-tree bench stays until W1. Bench changes made there
  meanwhile, for example for the redesign's measurements, are drift (§9).

## 8. Testing

### 8.1 Layer A, inside the flake (every milestone)

- **Package tests:** each package's
  `node --test --experimental-strip-types test/*.test.ts`. For the patched
  upstreams, their own suites, as in today's `checks/pi-*`; pi-retry uses
  vitest.
- **Type check:** `tsc --noEmit --strict --allowImportingTsExtensions` per
  package. `typescript`, `@types/node` and pi's own types
  (`@earendil-works/pi-coding-agent` 1.0.0, already a dev dependency in the
  pi-retry lock) come from the shared lock (§3). No declaration stub is
  needed.
  - No package has ever gone through `tsc`, so `--strict` may force code
    edits. Each milestone's scope includes making its own packages pass.
  - Such an edit must not change behaviour. The package's own tests and, for
    the router, the golden test (§6.3) show that it does not.
- **Interface comparisons (§5.3)** run here. Each one checks that the
  provider's type is assignable to the consumer's copy. It starts in the later
  of the two milestones that bring the provider and the consumer:
  - against `__subagentsApi_v1` (provider: M2): the bench probe (M1) from M2;
    cache-lifecycle and experiments in M4; the router in M5;
  - against `__piExperimentsApi_v1` (provider: M4): token-meter (M3) from M4;
    cache-lifecycle in M4; the router in M5.

  Some consumers type the key inline, in the cast itself: token-meter
  (`shell.ts:25`), cache-lifecycle (`shell.ts:39`) and the router
  (`shell.ts:61,63`). Each such inline type becomes a named type alias, a
  type-only edit, so that the comparison can name it. The infinite-context
  patch stays excluded: it is upstream code under a patch.
- **Module evaluation:** `homeManagerConfiguration` cases for:
  - each component alone, every component together, and the host-like
    combination;
  - one negative case per assertion;
  - one case per warning;
  - `piSettings`: `enable = false` with ops from two components (no entry);
    two contributors with the same `order` (sorted by key);
  - the bench's `router` default with and without `taskRouter` (§7).

  The cases assert the rendered files (settings, links, `childExtensions`,
  the piSettings program) with `lib.hasInfix` or line splits, never
  `builtins.match`.
- **piSettings:** the ported fixtures (M0).
- **Router golden test:** §6.3 (M5).
- **Log contract:** the check moves here, re-pointed at `packages/`. It needs
  all four extension packages, so it lands in M5 (§9).
- **Leak check:** see §8.3.

### 8.2 Layer B, in the host (during W only)

- `--override-input pi-economics path:/home/pallon/projects/nix/pi-economics`.
- The host's renamed eval assertions and a thin check for its own registry
  entries.
- The host's full check, as the host's `AGENTS.md` prescribes it: one
  `nix-check-runner` run (for agents, the runner gate), plus the evaluation of
  every `nixosConfigurations.<host>` toplevel. Never `nix flake check`: the
  host forbids it, because it ran the machine out of memory.
- A host-side term scan of `inputs.pi-economics`, modelled on
  `checks/terminal-kit-leaks.nix`, which derives its terms from the host's own
  configurations.
- `nixos-rebuild test` is an owner step. It swaps the extensions of running pi
  sessions.

### 8.3 Publication

- **In-flake leak check:** generic patterns only, because a literal term list
  in a public repository would itself be the leak. Matched with `grep -E` over
  every tracked file, except `docs/specs/` and `docs/plans/` until P:
  - e-mail addresses: `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}`;
  - home paths `/home/<name>/`, where `<name>` is longer than one character,
    so neutral fixtures like `/home/u/` (`task-router/test/cwd.test.ts:15`)
    pass;
  - `git+ssh://` URLs;
  - RFC 1918 addresses, as full dotted quads, so that a version string such as
    `10.2` does not match: `\b10(\.[0-9]{1,3}){3}\b`,
    `\b172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}\b` and
    `\b192\.168(\.[0-9]{1,3}){2}\b`. Loopback (`127.0.0.1`) is not a private
    network and is allowed.
- **The excluded directories:** this spec and the plans name the owner's hosts
  and home (e.g. §8.2). At P they are scrubbed or moved out of the
  repository, and then the leak check's exclusion is removed.
- **Fixtures and defaults:**
  - Test fixtures use neutral names. Today they use real ones, for example
    `task-router/test/settings.test.ts:26` and `policy.test.ts:82`; those are
    rewritten when moved.
  - Defaults that name the owner's hosts (today the router's
    `localHealthUrl = "http://earth:11545"`, `settings.ts:19`) become neutral
    at P, not during the move. From W4 on the host sets these values itself
    (§9.1), so P does not change the host. P updates the golden file (§6.3)
    for that change, as a listed difference.
- **History:** published as a squashed history.
- **Licensing:** the upstream licenses of `pi-actor-subagents`,
  `pi-infinite-context` and `pi-retry` are checked. The flake's license must
  allow distributing patches against them.

## 9. Milestones

Each milestone gets its own TDD plan, written right before it starts, at
`docs/plans/YYYY-MM-DD-<topic>-plan.md`. Each plan ends with an
`# Execution Record`.

**Source commits.** Each plan names the host commit it copies from:

- M0–M4 and M6: `f6a3c81`, or a later host commit if the moved paths changed
  meanwhile (drift, below);
- M5: R, for the task-router.

**Drift.** The host is no longer frozen (§1), so moved paths can change there,
and the redesign will change some. At the start of each milestone, before W0
and before each W step, the paths moved so far are diffed against the host's
current commit. The changes are ported into the flake first, each with its
test. M5 in particular ports what R changed in paths that earlier milestones
moved, for example token-meter's reports, `LOGS.md` or the bench.

| # | Content |
|---|---|
| M0 | Flake skeleton, `common.nix` (agentDir, registry, piSettings with `enable`, contributor-keyed ops and the ported fixtures), shared npm lock, type-check harness, module-eval harness, leak check |
| M1 | `bench` (§7), with `router` defaulting to `{}` |
| M2 | `actorSubagents` (3 patches, `spawnPolicyApi` passthru), `childExtensions` rendering |
| M3 | `tokenMeter` (reports, `LOGS.md`), `analysisSkill` |
| M4 | `cacheLifecycle`, `experiments` |
| M5 | `taskRouter` from R (§6) with its golden test; drift from R; the bench's `router` default from `taskRouter` (§7); log-contract check (all four packages present) |
| M6 | `infiniteContext` (reminder options), `retry` (print-mode and free-cap patches, piSettings ops); bench `extensions` default from the packages |
| W | Wiring in the host (§9.1) |
| P | Publication (§8.3) |

Every milestone builds and tests on its own:

- The bench takes its extensions as data, so it does not wait for M2–M6.
- M5 waits for R. M6 does not depend on M5 and may land first; the bench's
  `extensions` default then gains the task-router in M5.
- The log contract lands only once all four packages are present (M5).

### 9.1 Wiring (W)

**Gate** (owner's decision, 2026-10-17): W starts when the owner says so, and
not before M5, because it wires the redesigned router. r3's gate, the end of
the pluto plan, is superseded: pluto's critical part is done, and the host is
no longer frozen. W is the first step that touches the host's flake files
(`flake.nix`, `flake.lock`); until then they stay as they are. The host's own
rules (its `AGENTS.md`) apply to W as to any host change; this spec relaxes
none of them.

**W0, all at once:** `actorSubagents` and the host's whole extension selection
move onto the registry. Today `pi-extensions.nix:389-390` writes
`actor-subagents/settings.json` unconditionally, so no single component can
switch before this step. After W0:

- the host's fixed extensions are registry entries;
- the in-tree packages are still the in-tree ones, registered through the
  registry;
- the host sets `programs.piEconomics.piSettings.enable = false` (§5.4).

**W1–Wn, one component per step:** replace the in-tree package with the flake's
component, move its settings from `homes/pallon`, and delete the in-tree copy
and its checks. In the step that deletes an in-tree module, every host reader
of its `programs.pi.<c>` options moves to `programs.piEconomics.<c>`.

The order follows the hard assertions (§4.1):

1. `bench`.
2. `tokenMeter`, then `analysisSkill`.
3. `cacheLifecycle` and `experiments`. The host's `programs.pi.cacheLifecycle`
   goes away here, but some of its readers must stay until W6. In this step
   they are re-pointed to `programs.piEconomics.cacheLifecycle.enable`
   (review 3): `ai/default.nix:982` (the seed's `cacheWarming`) and `:1114`
   (the migrate `idle` flag), and `checks/eval-assertions.nix:9359` (the child
   set), `:9387` (the seed) and `:9397` (the migrate flag).
4. `taskRouter`, whose `actorSubagents` arrived in W0.
5. `infiniteContext`.
6. `retry`, together with the retirement of the host's `piSettingsMigrate`
   script (`ai/default.nix:1111-1114`). From this step on, the flake's
   `piSettingsMigrate` activation entry (§5.4) replaces it, carrying the
   host's own ops; the host drops its `piSettings.enable = false`. Until then
   the host script stays and the flake's entry is not rendered, so there is
   never more than one entry with that name. The seed's `cacheWarming`
   (`ai/default.nix:982`) can go too, because the op runs after the seed.

Host sites that change during W:

- **`flake.nix`:**
  - the inputs `pi-infinite-context`, `pi-actor-subagents` and `pi-retry`
    (`:105-139`) become `follows` targets of the new `pi-economics` input;
  - `packages.pi-bench` (`:222`);
  - the `pi-*` checks of the moved components (`:269-324`) are removed, step
    by step with their components.
- **`ai/default.nix`:**
  - `:982` and `:1114` read `programs.pi.cacheLifecycle.enable` (the settings
    seed and the migrate `idle` flag). W3 re-points them; W6 replaces them by
    the piSettings op.
  - `localSkillNames` (`:39`) loses the skill. The host wires
    `analysisSkill.path` instead.
- **`checks/eval-assertions.nix`:**
  - `:9347-9538`: the child set, the settings-seed and migrate assertions, the
    activation DAG order and the command line.
  - `:1175`: the local-skill list, and the comments that count 15 local skills
    (`:1183`, `:9009`).
- **`checks/pi-token-economics-checks.nix`:** the required-checks list.
- **`checks/pi-extensions.nix`:** split; the host part stays.
- **`homes/pallon`:**
  - `taskRouter.settings`: today's randomize and spotCheck
    (`homes/pallon/default.nix:197-209`), plus the model and health-URL values
    the host relies on, set explicitly so that P (§8.3) does not change the
    host;
  - the Haiku reminder override and prices (§5.2);
  - the bench `extensions` and `agentsBaseline`.
- **Docs:** the `AGENTS.md` routing bullet; `docs/pi-token-economics.md`
  becomes a pointer; `docs/README.md`.

**Drift:** before W0 and before each W step, as in §9.

## 10. Decisions on former open questions

1. **Bench judge:** pi-bench keeps one paid, non-Claude judge on OpenRouter
   (`gpt`). It counters self-preference when Claude judges Claude arms. Apart
   from the optional free-cloud slot and the `qwen` arm (§7), it is the only
   OpenRouter use.
2. **Publication:** the flake becomes public (`github:GRBurst/pi-economics`)
   when finished, under the conditions in §8.3.

## 11. Risks

- **Redesign timing:** M5 and W wait for R. M0–M4 and M6 do not, so a late
  redesign delays only the router and the wiring.
- **Drift:** the host is no longer frozen, and the redesign changes moved
  paths while the move runs. The drift diff at the start of every milestone
  and W step (§9) ports those changes before they can be lost.
- **Strict typing:** an edit forced by `tsc --strict` could change behaviour
  unnoticed. The unchanged package tests and the router's golden test (§6.3)
  guard against it.
- **Upstream patches:** patches against upstream sources can stop applying on
  an input bump. The patched-package builds keep that a build failure, never a
  silent skip.
- **Tokenizer:** the newer tokenizer counts about 30% more tokens. Fold
  thresholds for Haiku are set in tokens (§5.2).
