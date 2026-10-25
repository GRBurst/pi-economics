# pi-economics — design

Date: 2026-10-12 · Status: draft r5 (2026-10-17, amended for host `2d304eb` and review 5 minors),
after reviews 1–4 and the owner's decisions of 2026-10-17 · Owner: pallon

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

Revision 5 addresses review 4 (`~/.pi/agent/notes/2026-10-17-review-move-r4.md`,
accept-with-minors):

- The host's desktop rule, as the owner changed it (host commit `2d304eb`,
  `AGENTS.md:62`), does not block R or W: both are the owner's desktop
  changes. W must leave pluto's system as it is; each W step checks that
  (§8.2, §9).
- Layer B can run: a locked local input, the agents' gate without overrides,
  a scoped term scan, and the switch to the published input as an owner step
  after P (§8.2, §9.1).
- The two tests that assert the `earth` default stay unchanged until P
  (§8.3).
- M5 has a fifth precondition, evidence for each, and a definition of R
  (§6.1).
- The bench's `qwen` arm is retired before P, in a step of its own, Q (§7,
  §9).
- Minors: `null` and `false` on piSettings paths, and today's op order kept
  (§5.4); the bench's agent dir and work dir (§7); the probe's inline type
  (§8.1); a gate per W step, the location of W's plan, activation per step,
  the Haiku reminder values as a step of their own (W7), and more host sites
  (§9.1); line fixes.

Source snapshot: host dotfiles commit `f6a3c81` (2026-10-10). Before the
owner's history rewrite of 2026-10-17 its id was `cee41b5` (host
`docs/plans/2026-10-17-commit-id-rewrite.md`). The moved paths last changed in
`f689fcc` (2026-10-04) and are the same at `f6a3c81`. Everything below about
"today" refers to that snapshot. The task-router alone moves from a later host
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
- The host's desktop rule (host `AGENTS.md:62`, changed by the owner in host
  commit `2d304eb`): a change made for pluto must not change the desktops'
  derivations; the owner's own desktop changes are free. R and W are desktop
  changes. pi-economics is Home Manager only, and pluto has no Home Manager,
  so W must leave pluto's system unchanged (§8.2).
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
   judge `gpt` (§10), and through its `qwen` arm until step Q retires it
   (§7, §9).
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
  Qwen, is not part of the move. It is step Q, after W and before P (§7, §9).

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
  The host keeps a pointer page, as `docs/terminal-kit.md` does. It moves in
  the last of M0–M6 to land, once every component it describes is in the
  flake, and before W, whose docs step turns the host's copy into the
  pointer (M0 plan, Q5).
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
  Amendment (M2): the registry owns `childExtensions` in
  `actor-subagents/settings.json`; setting it in `actorSubagents.settings` is a
  `pi-economics:` assertion error, not a merge.

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
| `cacheLifecycle` *w* | `actorSubagents` | warming while waiting on children (`shell.ts:88` tolerates absence) |
| `experiments` *w* | `actorSubagents` | arm inheritance by children (`shell.ts:80-82`) |
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
Haiku 4.5. At W7 (§9.1) the host adds, next to the Opus and Sonnet entries:

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

`null` and `false` behave as in today's script, whose guards and updates use
jq's `//` (`pi-settings-migrate.nix:66-82`):

- `null`, on the way or at the leaf, counts as missing and is created, except
  for `removeWhere`, which skips the op (nothing to remove).
- `false` at the leaf of `ensureContains` counts as missing too: the leaf
  becomes a list with `value`.
- `false` on the way passes the guard and makes jq fail, which leaves the
  whole file untouched, as today. It is the one shape that aborts the program
  rather than skipping the op.

The three ported ops reuse today's jq expressions. The generic `set` with
arbitrary paths (`retry.settings`, order 500) is new, and so is its
`false`-on-the-way abort. M0 pins every case, old and new, with a fixture.

Rendering and execution:

- **One jq program.** Each op is a separate jq function with its own shape
  guard (today's guard: `pi-settings-migrate.nix:71-77`). A shape error
  therefore skips only that op, as today's "odd-shapes" fixture requires
  (`checks/pi-settings-migrate/default.nix:84-92`). Only a `false` on the way
  aborts the program (above). If jq fails, for example on invalid JSON, the
  file is left untouched and the activation does not fail (as today).
- **Order:** the ops of all contributors are sorted by `(order, key, index)`:
  by `order`, then by contributor key, then by position in that contributor's
  list. Keying by contributor is what makes this order deterministic across
  modules. A plain `listOf` merged across modules carries no contributor
  name; its merge order follows the import order.
- **Today's sequence:** the defaults reproduce today's order of edits
  (`pi-settings-migrate.nix:82`: drop the stale packages, ensure the child
  rule, set `cacheWarming`). Removals and the child rule keep `order = 1000`,
  and `ops.cacheLifecycle`'s `set` has `order = 1500`. Sorting by key alone
  would put `cacheLifecycle` before `retry`. The output would then be
  JSON-equal to today's, but in a file that lacks both keys they would come in
  the other order. With 1500 the bytes are today's, and the ported fixtures
  keep comparing bytes (`cmp`).
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
- **`ops.cacheLifecycle`:** `set cacheWarming "idle"`, `order = 1500`. This
  replaces the positional `idle` argument.

The host adds its own ops under its own key, for example the removal of the
stale `git:github.com/fdietze/pi-claude-auth@main` entry. The script and its
fixture check (`checks/pi-settings-migrate`) are ported in M0, with the
fixtures rewritten as op cases.

## 6. Router (milestone M5)

### 6.1 What moves

M5 copies the task-router from *R*. **R** is the host commit that lands the
redesign (§1), as the redesign plan's `# Execution Record` names it. The
move changes no routing decision, no default and no log field. The host's
redesign spec owns all three.

M5 relies on five properties of R. Its plan checks each against R first, with
the evidence named below. If one does not hold, M5 stops and reports to the
owner; the move does not add it.

- **P1, configurable models:** models are configurable through the router's
  settings file, with their defaults in `core/settings.ts` (today `models`,
  `settings.ts:13-18`). Evidence: R's `core/settings.ts` and a test in R's
  suite that sets a model through the settings file.
- **P2, optional free-cloud slot:** the slot's code is there, and an empty slot
  is not taken into account: no cloud route, no cloud count, no wait for a
  cloud slot. Today the slot is not optional: `pickQwen` picks the free cloud
  first whenever no cloud child runs (`chain.ts:11-15`), and the default names
  the retired free model (`settings.ts:15`). Evidence: a test in R's suite.
  Failing that, M5 writes one in the moved suite and runs it against R's code
  first: with the slot empty, no spawn takes the cloud route, the cloud counter
  stays at 0, and no spawn waits for a cloud slot. A property over the golden
  file's empty-slot fixture (§6.3) checks the first of the three again: no
  decision names the cloud route.
- **P3, contracts:** the router registers through `registerSpawnPolicy` of
  `__subagentsApi_v1` (§4.1) and reads `__piExperimentsApi_v1` (§5.3).
  Evidence: R's `core/shell.ts` and the interface comparisons (§8.1).
- **P4, logs:** R's `LOGS.md` describes R's outcome events, so that the moved
  reports and the log contract (§8.1) read them. Evidence: R's host check
  `pi-log-contract` is green at R.
- **P5, free-form settings:** R's Home Manager module still takes free-form
  `settings` and writes them to `task-router/settings.json` when non-empty,
  which §6.2 assumes. Evidence: R's `nix/hm-module.nix`. If the redesign adds
  typed options, M5 stops and §6.2 is revised first.

Amendment (2026-10-25, order): the owner's decision of 2026-10-25 puts the
move first. Priority 1 is that everything lives in this flake and the host
consumes it through `git+file:` (W); finishing the redesign comes second;
publication (P) and the retirement of the `qwen` arm (Q) come third.

- **R becomes R'.** R' is the host commit after the redesign's Group 2
  (`f1b140e`, 2026-10-25) plus the fixes of its review, as the redesign
  plan's `# Execution Record` names it. Wherever this section, §6.3 and §9
  name R as the router's source, read R'.
- **P1–P5 are checked against R'.** A property that does not hold at R' is
  recorded in M5's Execution Record and handed to the redesign's remaining
  groups; M5 does not stop for it. This replaces "M5 stops and reports" above
  and P5's "M5 stops". P2's own test, where M5 writes one, still runs against
  the code at R' first.
- **The golden test (§6.3) records the decisions at R'.** The remaining groups
  change decisions on purpose; each re-records the golden file, and its diff
  is the evidence.
- **The redesign's Groups 3–7 move to this flake after W.** The redesign's
  spec (host `docs/specs/2026-10-17-task-router-abilities-design.md`) and plan
  (host `docs/plans/2026-10-17-task-router-abilities-plan.md`) stay in the
  host's docs as the record. Its oracle scripts live outside both
  repositories, under `~/.cache/pi/review-router` and `~/.cache/pi/router-r2`.

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

- **`dataDir`:** default `<home>/<agentDir>/bench`, exported as
  `PI_BENCH_DATA`. With the default `agentDir` this is today's default
  (`config.ts:39`).
- **Agent source:** not an option. The module exports
  `PI_BENCH_AGENT_SRC = <home>/<agentDir>`. The bench takes credentials, model
  definitions and the infinite-context settings from there, and its defaults
  for the two AGENTS.md variants lie under it (`config.ts:37,45-46`). Today
  the source is `~/.pi/agent`, whatever the agent dir is.
- **`workDir`:** `nullOr str`, default `null`, which exports nothing. The bench
  then keeps its own default: `$XDG_RUNTIME_DIR/pi/tmp/bench`, or
  `/tmp/pi/tmp/bench` without `XDG_RUNTIME_DIR` (`config.ts:40`). A literal
  default would give `/pi/tmp/bench` where `XDG_RUNTIME_DIR` is unset.
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
    exist and where to reach them. Today these are `models`,
    `localHealthUrl`, `queueMaxSec` and `cloudDailyCap`; M5's plan fixes the
    list from R's schema.
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
- **`agentsBaseline`:** the AGENTS.md variant of the arms without routing,
  `nullOr str`, default `null`. When set, it is exported as
  `PI_BENCH_AGENTS_OFF`. Otherwise the bench keeps its own default, the
  personal notes path under the agent source (`config.ts:46`).

Arms:

- During the move, arms and judge defaults stay as in the source. Extra arms
  are data: `<dataDir>/arms.json` overlays the defaults (`config.ts:30-33`),
  so a new measurement needs no code change.
- The `qwen` arm still names the retired free OpenRouter Qwen, and `judge` and
  `judge-all` take it as their default first arm (`cli.ts:99,105`). The move
  keeps both.
- **Step Q** retires them, after W and before P, under a TDD plan of its own:
  the arm goes, and the judge defaults move to `qwenl`. Existing `qwen` runs
  stay judgeable with explicit arguments. `report` uses arms only for
  factors (`report.ts:66`, `arms[r.arm]?.factors ?? {}`): old `qwen` runs
  then report empty factors. Q keeps a factors-only stub for `qwen`, so that
  old reports are unchanged. A published default that names a dead free model
  would only be noise. The host receives Q with W8 (§9.1).
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

  Some consumers type the key inline, in the cast itself: the bench probe
  (`probe/index.ts:18`), token-meter (`shell.ts:25`), cache-lifecycle
  (`shell.ts:39`) and the router (`shell.ts:61,63`). Each such inline type
  becomes a named type alias, a type-only edit, so that the comparison can
  name it. The infinite-context patch stays excluded: it is upstream code
  under a patch.
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

- **Input before P:** `git+file:///home/pallon/projects/nix/pi-economics`,
  locked in the host's `flake.lock`. W0 adds it, and each W step moves the
  lock to the flake commit it wires (`nix flake update pi-economics`). Why:
  - The gate then runs on the host's tree as it will be committed, with no
    `--override-input`. The agents' gate refuses that flag: `runner-gate.sh`
    passes on only `--jobs`, `--memfree`, `--min-mem-wait` and `--timeout`,
    and answers anything else with `OPTION REFUSED`, exit 3.
  - `git+file:` takes only tracked files, so the lock names one flake commit.
    A `path:` input would take untracked files too.
  - `flake.nix` keeps the later URL as a comment, as it does for `ai-usage`
    and `nix-terminal`.
- **Reachability:** every machine that evaluates a host configuration with the
  input must reach that path. The path exists on andromeda only. Owner
  decision (2026-10-17): earth is not rebuilt from the host flake between W0
  and W8; andromeda evaluates and gates both desktops. Before its commit,
  W0's plan shows that:
  - andromeda's and earth's configurations evaluate on andromeda;
  - pluto's nightly update (host
    `modules/nixos/services/guarded-upgrade/update.sh:7`,
    `nix flake update nixpkgs-stable`) still succeeds on a copy of pluto's
    sparse set, where the path does not exist.

  If one fails, W0 stops, and the owner chooses another URL, e.g. a private
  repository. The locked revisions of W0–W7 must stay fetchable until W8:
  P's squash (§8.3) keeps the pre-squash branch and its refs until then. An agent running a W step needs a sandbox read grant on
  `~/projects/nix/pi-economics`; without it, the owner runs the gate.
- **After P:** step W8 (§9.1) switches the input to
  `github:GRBurst/pi-economics`, as an owner step. P itself changes no host
  file.
- **Gate:** the host's full check, as the host's `AGENTS.md` prescribes it,
  on the host's tree. For agents this is the runner gate,
  `runner-gate.sh <host dir> <out file>`: it runs `nix-check-runner` and
  evaluates every `nixosConfigurations.<host>` toplevel, the formatter, the
  packages, dev shells and apps. Humans run the same through the commands in
  the host's `AGENTS.md`, or its per-check fallback loop. Never
  `nix flake check`: the host forbids it, because it ran the machine out of
  memory.
- **Host checks:** the host's renamed eval assertions and a thin check for its
  own registry entries.
- **pluto unchanged:** pi-economics is Home Manager only, and pluto has no
  Home Manager, so no W step may change pluto's system (§9). Each W step,
  and W8, evaluates pluto's toplevel on the base tree and on the patched
  tree, as the host's desktop rule does for the desktops (never against a
  recorded value):
  `(ulimit -v $((20*1024*1024)) && exec timeout -s KILL 900 nix eval --raw path:<tree>#nixosConfigurations.pluto.config.system.build.toplevel.drvPath --option eval-cache false)`.
  - Where a step leaves the host's `flake.nix` and `flake.lock` as they are
    (W7), the two drvPaths are equal.
  - Where it edits one of them, the drvPath changes anyway, and only because
    of that edit: pluto's toplevel holds a filtered copy of the host flake,
    its snapshot (`<top>/flake`, host
    `modules/nixos/services/deploy-target.nix:98-102,335`), and the copy keeps
    `flake.nix` and `flake.lock` (host `hosts/pluto/deploy-target.nix:18-26`).
    W0–W6 and W8 edit them (the input, its lock, the moved packages and
    checks). The snapshot is a source path (`inputSrcs`) and a line of the
    toplevel's `buildCommand`, not an input derivation. For these steps the
    check is:
    - `nix-diff` (not on PATH; built from nixpkgs as host
      `scripts/pluto-port-diff.sh:70` does) of the two toplevel derivations:
      `inputDrvs` equal, and the only differences are the snapshot's source
      path and the `ln -s …/flake` line;
    - `diff -r` of the two snapshots (`config.system.build.flakeSnapshot`)
      lists only `flake.nix` and `flake.lock`;
    - a `jq` comparison of the two locks' `.nodes` shows only `pi-economics`
      nodes (and the root's input entry) added or changed, so a stray move of
      an input pluto reads (`nixpkgs-stable`, `flake-parts`) is named.
  - The check fails a step that reaches pluto's evaluation in any other way.
    Whether the snapshot's new lock entry still evaluates on pluto is the
    reachability check above.
- **Home files:** each W step compares pallon's built home files before and
  after the step, following the links into the packages (`diff -r`), and its
  plan lists every difference. W5 shows `infinite-context/settings.json`
  unchanged; W7 shows only the Haiku entries.
- **Term scan:** a host check modelled on `checks/terminal-kit-leaks.nix`. It
  derives its terms from the host's own configurations (host and user names,
  the git identity, the location) and scans the locked source of
  `inputs.pi-economics`.
  - Until P it skips what the in-flake check skips: the flake's `docs/specs/`
    and `docs/plans/`.
  - Until P it expects a listed set of hits and compares as a set: a hit
    outside the set fails, and so does a listed hit that is gone. Today the set
    is `earth` in the router's `core/settings.ts` (the default URL) and in the
    two tests that assert it (§8.3). Each W step's plan lists the set for the
    flake commit it locks. A new entry needs a reason: a default, or a test of
    one, that the move keeps until P.
  - At W8, which locks P's commit, the set becomes empty and the skip goes.
  - It runs during W, not only at P, so that a new leak shows in the step
    that brings it.
- **Activation:** `nixos-rebuild test` once per W step, before the step's
  commit, as an owner step. It swaps the extensions of running pi sessions.
  One step is one activation and one revert point.

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
  - A fixture that only feeds a test and names a real host or person is
    rewritten with a neutral name when moved. The coordinates of a public
    upstream package (e.g. `fdietze/pi-claude-auth` in the piSettings
    fixtures) are not a person's name in this sense: they stay, and so does
    the byte check against the old script (M0 plan, Q3).
  - Two tests assert the default itself and stay unchanged during the move:
    `task-router/test/settings.test.ts:26` and `policy.test.ts:82` (the
    harness starts from `defaults()`, `harness.ts:35`). Rewritten alone, they
    would turn the suite red; changing the default with them would break the
    pure move (§1). They change at P, together with the default and the
    golden file. The generic leak patterns do not match `earth`, so the
    in-flake check passes meanwhile; the host's term scan lists them (§8.2).
  - Defaults that name the owner's hosts (today the router's
    `localHealthUrl = "http://earth:11545"`, `settings.ts:19`) become neutral
    at P, not during the move. From W4 on the host sets these values itself
    (§9.1), so taking P's commit (W8) does not change the host's behaviour.
    P updates the golden file (§6.3) and the two tests for that change, as
    listed differences.
- **History:** published as a squashed history. The pre-squash branch and
  its refs stay until W8, because the host's lock names W0–W7's revisions
  (§8.2).
- **Licensing:** the upstream licenses of `pi-actor-subagents`,
  `pi-infinite-context` and `pi-retry` are checked. The flake's license must
  allow distributing patches against them.

## 9. Milestones

Each milestone gets its own TDD plan, written right before it starts, at
`docs/plans/YYYY-MM-DD-<topic>-plan.md`. Each plan ends with an
`# Execution Record`. W's plan is the exception: W edits the host, so its plan
and Execution Record live in the host's `docs/plans/` (host `AGENTS.md`).

**Host rules.** The host's desktop rule (host `AGENTS.md:62`, changed by the
owner in host commit `2d304eb`, 2026-10-17) has no fixed baseline any more.
A change made for pluto must not change the desktops' derivations, compared
base tree against patched tree. The owner's own desktop changes are free and
move the desktops' drvPaths on purpose.

- The redesign (R) and every W step are such desktop changes. The rule does
  not block them.
- The converse holds for this work: pi-economics is Home Manager only, and
  pluto has no Home Manager. No W step may change pluto's system. Each W step
  checks that, base tree against patched tree (§8.2).

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
| W | Wiring in the host, W0–W7 (§9.1), under one plan in the host |
| Q | Retire the bench's `qwen` arm; the judge defaults move to `qwenl` (§7) |
| P | Publication (§8.3) |
| W8 | After P: the host's input switches to `github:GRBurst/pi-economics`, an owner step (§9.1) |

Every milestone builds and tests on its own:

- The bench takes its extensions as data, so it does not wait for M2–M6.
- M5 waits for R. M6 does not depend on M5 and may land first; the bench's
  `extensions` default then gains the task-router in M5.
- The log contract lands only once all four packages are present (M5).
- Q comes after W, so that W wires a pure move, and before P, so that nothing
  published names the dead free model.

Amendment (2026-10-25, order): the owner's order is W first, then the
redesign's remaining groups, then Q and P (§6.1 amendment).

- M5 copies the task-router from R' (§6.1 amendment), not from the end of the
  redesign. It no longer waits for R. It starts after M6, which is being
  implemented, and once R' is named.
- The drift port of M5 runs against R'.
- M6's movable task M6.D, the doc move of `docs/pi-token-economics.md`, goes
  into M5 if M5 lands after M6 (M6 plan, D17). It stays the last task before
  M5's close-out and before W0.
- After W, the redesign's Groups 3–7 continue in this flake. Q and P follow
  them.

### 9.1 Wiring (W)

**Gate** (owner's decision, 2026-10-17): W starts when the owner says so.
r3's gate, the end of the pluto plan, is superseded: pluto's critical part is
done, and the host is no longer frozen.

- Each step starts after the step before it and after the milestone that
  brings its component: W0 after M2, W1 after M1, W2 after M3, W3 after M4,
  W4 after M5 (the redesigned router), W5 and W6 after M6, W7 after W5.

Amendment (2026-10-25, order):

- **The gate is open.** The owner opened it on 2026-10-25.
- **W4 wires the router as M5 moved it**, at R' (§6.1 amendment), not the
  redesigned router. The redesign's Groups 3–7 then land in this flake. The
  host receives each of them only when its `pi-economics` lock moves.
- W0 is the first step that touches the host's flake files (`flake.nix`,
  `flake.lock`). Until then they stay as they are.
- Each step passes Layer B (§8.2): the gate, the pluto comparison, the
  home-file comparison and the term scan. Then the owner activates it with
  `nixos-rebuild test`, and it is committed.
- The host's rules (its `AGENTS.md`) apply to W as to any host change. Under
  the desktop rule, W is the owner's desktop change (§9).

**W0, all at once:** `actorSubagents` and the host's whole extension selection
move onto the registry. Today `pi-extensions.nix:389-390` writes
`actor-subagents/settings.json` unconditionally, so no single component can
switch before this step. After W0:

- the host has the input `pi-economics`, locked to the flake's commit (§8.2),
  and its term scan;
- the host's fixed extensions are registry entries;
- the in-tree packages are still the in-tree ones, registered through the
  registry;
- the host sets `programs.piEconomics.piSettings.enable = false` (§5.4);
- the double-link assertions (`pi-extensions.nix:346-361`) are gone: the
  registry's file-conflict check replaces them (§5.1). The
  `linkExtension = lib.mkDefault false` lines (`:337-340`) stay until their
  in-tree module is deleted (W2–W4).

**W1–W6, one component per step:** replace the in-tree package with the
flake's component, move its settings from `homes/pallon`, and delete the
in-tree copy and its checks. In the step that deletes an in-tree module, every
host reader of its `programs.pi.<c>` options moves to
`programs.piEconomics.<c>`.

The order follows the hard assertions (§4.1):

1. `bench`.
2. `tokenMeter`, then `analysisSkill`. The host's log-contract check reads
   `programs.pi.tokenMeter` (`checks/pi-log-contract/default.nix:39,43`). W2
   re-points it to `programs.piEconomics.tokenMeter`. It goes in W6, if the
   flake's log contract (M5) covers what it checks; W6's plan shows that.
3. `cacheLifecycle` and `experiments`. The host's `programs.pi.cacheLifecycle`
   goes away here, but some of its readers must stay until W6. In this step
   they are re-pointed to `programs.piEconomics.cacheLifecycle.enable`
   (review 3): `ai/default.nix:982` (the seed's `cacheWarming`) and `:1114`
   (the migrate `idle` flag), and `checks/eval-assertions.nix:9359` (the child
   set), `:9387` (the seed) and `:9397` (the migrate flag).
4. `taskRouter`, whose `actorSubagents` arrived in W0. The host sets the model
   and health-URL values it relies on explicitly (below).
5. `infiniteContext`. The home-file comparison shows
   `infinite-context/settings.json` unchanged.
6. `retry`, together with the retirement of the host's `piSettingsMigrate`
   script (`ai/default.nix:1111-1114`). From this step on, the flake's
   `piSettingsMigrate` activation entry (§5.4) replaces it, carrying the
   host's own ops; the host drops its `piSettings.enable = false`. Until then
   the host script stays and the flake's entry is not rendered, so there is
   never more than one entry with that name. The seed's `cacheWarming`
   (`ai/default.nix:982`) can go too, because the op runs after the seed.

**W7, after W5:** the Haiku context-reminder override and prices (§5.2), a
change of `homes/pallon` only. It is a step of its own, so that W5 shows the
reminder file unchanged and W7 shows only the Haiku entries added (§8.2).

**W8, after P (owner step):** the host's `pi-economics` input switches from
`git+file:` to `github:GRBurst/pi-economics`, with the `git+file:` line kept
as a comment, and the lock moves to P's commit. The host thereby receives Q
and P's neutral defaults. Its explicit settings from W4 keep its behaviour;
the home-file comparison and the gate show it.

Host sites that change during W:

- **`flake.nix`:**
  - the new input `pi-economics` (W0, §8.2);
  - the inputs `pi-infinite-context`, `pi-actor-subagents` and `pi-retry`
    become `follows` targets of `pi-economics`. They lie within `:105-139`,
    where `pi-question`, `pi-session-name` and `pi-claude-auth` stay;
  - `packages.pi-bench` (`:222`);
  - the `pi-*` checks of the moved components, removed step by step with
    their components. They lie within `:269-324`, where checks that stay
    (`nix-check-runner`, `terminal-kit-leaks`, `local-skills-migration`) also
    lie.
- **`ai/pi-extensions.nix`:** the double-link assertions `:346-361` (W0) and
  the `linkExtension` defaults `:337-340` (W2–W4).
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
- **`checks/pi-log-contract/default.nix`:** `:39,43` (W2, W6).
- **`checks/pi-token-economics-checks.nix`:** the required-checks list.
- **`checks/pi-extensions.nix`:** split; the host part stays.
- **The term scan** (new, W0; §8.2).
- **`homes/pallon`:**
  - `taskRouter.settings` (W4): today's randomize and spotCheck
    (`homes/pallon/default.nix:197-209`), plus the model and health-URL values
    the host relies on, set explicitly so that W8 (P's defaults) does not
    change the host;
  - the Haiku reminder override and prices (W7, §5.2);
  - the bench `extensions` and `agentsBaseline` (W1).
- **Docs:** the `AGENTS.md` routing bullet; `docs/pi-token-economics.md`
  becomes a pointer; `docs/README.md`, which also indexes W's plan.

**Drift:** before W0 and before each W step, as in §9.

## 10. Decisions on former open questions

1. **Bench judge:** pi-bench keeps one paid, non-Claude judge on OpenRouter
   (`gpt`). It counters self-preference when Claude judges Claude arms. Apart
   from the optional free-cloud slot and the `qwen` arm until step Q (§7), it
   is the only OpenRouter use.
2. **Publication:** the flake becomes public (`github:GRBurst/pi-economics`)
   when finished, under the conditions in §8.3.

## 11. Risks

- **pluto:** W edits the host flake that pluto is built from. A W step that
  reached pluto's evaluation would change a server that is reached only over
  SSH. The pluto comparison (§8.2) fails such a step before its commit.
- **Input reachability:** the local input of W (§8.2) may not be reachable
  everywhere the host flake is evaluated, e.g. by pluto's nightly update.
  W0 checks it before its commit, and the owner picks another URL if it
  fails.
- **Redesign timing:** M5 and W4 onwards wait for R. M0–M4, M6 and W0–W3 do
  not, so a late redesign delays only the router and the rest of the wiring.
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
