# pi-economics — design

Date: 2026-10-12 · Status: draft r2, after review 1 · Owner: pallon

Revision 2 addresses review 1: 2 blockers, 9 majors, and the minor findings.
Source snapshot: host dotfiles commit `cee41b5` (2026-10-10), the last commit
that touched the moved paths. Everything below about "today" refers to that
snapshot.

## 1. Intent

Move the pi token-economics stack out of the NixOS flake
`~/projects/nixos/new` (below: *the host repo*) into a standalone flake
`~/projects/nix/pi-economics`, component by component. Each component can be
switched on and configured on its own. A dependency that would otherwise make
a component fail silently is enforced by a module assertion.

While moving, the model router is reworked for October 2026:

- Claude Haiku 5.5 exists.
- The free OpenRouter Qwen is gone. Qwen runs locally for now.
- The free-cloud slot stays in the code and is empty by default, so a good
  free model can be configured again later.

What the owner decided:

- Everything belonging to pi token economics moves, one component at a time.
  The flake is named *pi-economics*, with options
  `programs.piEconomics.<component>`.
- Each component has enable/disable plus configuration. Dependencies are
  covered by option checks.
- Router: local Qwen; Haiku, Sonnet and Opus only from the Anthropic
  subscription; models are configurable.
  - When local Qwen is busy, wait up to `queueMaxSec`, then use Haiku.
  - The free-cloud slot's code stays. While the slot is empty it is not taken
    into account.
- A Haiku tier `H`. `scout` and the Qwen fallback use it; bench results decide
  the rest.
- Named tiers with configurable `{model, effort}`, no free-form ladder.
- The host repo stays untouched until the pluto deployment running there is
  finished. Until then, only tests inside this flake. Integration tests on the
  real system come afterwards, and activation is an owner step.
- One overall spec, reviewed at least once. One TDD plan per milestone.
- The repository becomes public when finished. The bench keeps one paid
  OpenRouter judge.

Assumption: the git history of the moved code is not imported. It is private,
and it is mixed with unrelated dotfiles.

### Success criteria

1. `nix flake check` on this flake passes. That covers every component's
   tests, the type check, the module evaluation cases, the negative case of
   every assertion, and the leak check.
2. After wiring (§9), the host enables each component through
   `programs.piEconomics.*` and keeps no in-tree copy of it. The host's checks
   and the owner's `nixos-rebuild test` pass.
3. The reports still read the existing logs under `~/.pi/agent`.
4. The router uses OpenRouter only through the optional free-cloud slot, and
   that slot is empty by default. The only other OpenRouter use is the bench
   judge (§10).
5. The repository is fit for publication (§8.3).

### Non-goals

- `pi-claude-auth` stays in the host. It handles auth and billing headers and
  is coupled to the host's `~/.pi/claude` sandbox layout.
- `pi-question`, `pi-session-name`, `web-search`, `prompt-log` and
  `static-working-indicator` stay in the host. They join the shared registry
  (§5.1) as host entries.
- No new experiments beyond the router's tier comparison.

## 2. Components

| Option `programs.piEconomics.…` | Source today (host repo, `ai/` = `modules/home-manager/features/ai`) |
|---|---|
| `bench` | `pkgs/pi-bench/` |
| `actorSubagents` | `ai/pi-actor-subagents.nix` + child-prompt, spawn-policy and first-turn patches |
| `tokenMeter` | `ai/extensions/token-meter/` (+ `meter-report`, `pi-analyse`, `LOGS.md`) |
| `cacheLifecycle` | `ai/extensions/cache-lifecycle/` |
| `experiments` | `ai/extensions/experiments/` |
| `taskRouter` | `ai/extensions/task-router/` |
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
checks/                   module-eval cases, assertion negatives, log contract, leak check, type check
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
| `actorSubagents` | `extensions/actor-subagents` link via the registry; `actor-subagents/settings.json` = `settings // { childExtensions }` (one writer, §5.1) | `actor-subagents/settings.json` |
| `tokenMeter` | `token-meter/settings.json` if non-empty; `LOGS.md`; `home.packages` = report, analyse | `token-meter/settings.json` |
| `cacheLifecycle` | `cache-lifecycle/settings.json` if non-empty; piSettings op `cacheWarming = "idle"` | `cache-lifecycle/settings.json` |
| `experiments` | `experiments/settings.json` if non-empty | `experiments/settings.json` |
| `taskRouter` | `task-router/settings.json` = typed options (§6) merged with `settings`, always written | `task-router/settings.json` |
| `infiniteContext` | `infinite-context/settings.json` from the reminder options, always written (as today) | merged into it |
| `retry` | piSettings ops (§5.4); no file of its own | piSettings `piRetry` keys |
| `analysisSkill` | none; exports `path` for the host's skill wiring | — |

Rules:

- Directory names are kebab-case; option names are camelCase.
- Settings files are literal text (`builtins.toJSON`), so checks can read them
  with `fromJSON` without import-from-derivation.

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

The patched `actorSubagents` package sets `passthru.spawnPolicyApi = 1`.
Assertion message: `pi-economics: <c> requires <d> (<reason>)`. Every
assertion has a negative case in `checks/`.

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
- **Children:** `childExtensions`, the `path` of every entry with
  `forChildren = true`, sorted. It goes into `actor-subagents/settings.json`
  together with `actorSubagents.settings`. That file has one writer: the
  registry renders the file only when `actorSubagents` is enabled.
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

Haiku 5.5 has a 1M-token window, per Anthropic's model page (2026-10). The
"haiku (200k window)" comment in `homes/pallon/default.nix:29-31` predates it
and refers to Haiku 4.5. At W the host adds:

- an override for `anthropic/claude-haiku-5-5`: fold thresholds in tokens; on
  the subscription the 100k price step does not matter;
- its prices: $0.10 in / $0.50 out per MTok for prompts up to 100k.

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

- **`file`:** default `<agentDir>/settings.json`. The host sets
  `~/.local/state/pi/settings.json`.
- **`after`:** a list of activation entries to run after. The host names its
  seed and reclaim steps.
- **`ops`:** a list of operations:
  - `{ op = "set"; path; value; }`
  - `{ op = "ensureContains"; path; value; }` appends `value` to the list at
    `path` if no equal element exists.
  - `{ op = "removeWhere"; path; equals; }` removes the elements equal to
    `equals`.

  They are rendered to one jq program and applied in order. The activation is
  idempotent, rewrites only on change, and does nothing when the file is
  absent (as today). A new install gets its first file from the host's seed.

Component contributions:

- **`retry`:**
  - removes the stale package entries of earlier pi-retry spellings
    (`pi-settings-migrate.nix:36-40`);
  - when `actorSubagents` is enabled, `ensureContains` on
    `piRetry.subagents.match.systemPromptRegex`.
- **`cacheLifecycle`:** `set cacheWarming "idle"`. This replaces the
  positional `idle` argument.

The host adds its own ops through the same option, for example the stale
`git:github.com/fdietze/pi-claude-auth@main` entry. The script and its fixture
check (`checks/pi-settings-migrate`) are ported in M0, with the fixtures
rewritten as op cases.

## 6. Router (milestone M5)

### 6.1 Tiers

The tier set is closed: `Tier = "qwen" | "H" | "T1" | "T2"`, ranked in that
order, so `tierRank` uses `[qwen, H, T1, T2]`. Bases are the tiers plus
`qwen-draft`, which ranks as qwen. Every table is a `Record` over the full
type, so `tsc` rejects a missing tier.

Configuration (typed HM options, merged into the settings JSON):

```nix
programs.piEconomics.taskRouter.tiers = {
  qwen = { localModel = null; cloudModel = null; effort = "xhigh"; contextWindow = 262144; fallback = "H"; };
  H    = { model = "anthropic/claude-haiku-5-5";  effort = "medium"; contextWindow = 1000000; };
  T1   = { model = "anthropic/claude-sonnet-5-5"; effort = "high";   contextWindow = 1000000; };
  T2   = { model = "anthropic/claude-opus-5-5";   effort = "high";   contextWindow = 1000000; };
};
programs.piEconomics.taskRouter.localHealthUrl = "http://127.0.0.1:11545";
```

Option rules:

- `effort` is an enum `off … xhigh`; `max` is excluded, because `plan.ts:41`
  rejects it.
- `fallback` is one of `H`, `T1`, `T2`.

The host sets `tiers.qwen.localModel = "llama/qwen3.8"` and
`localHealthUrl = "http://earth:11545"`. Today `settings.ts:19` defaults the
URL to `earth`, so without this setting andromeda would probe localhost.

**Settings parser.** `merge()` (`settings.ts:48-49`) drops a value whose
`typeof` differs from the default's. A `null` default would therefore silently
drop a configured string. The parser gets explicit nullable fields. The old
keys `models.*` and `contextWindow.*` are no longer read; when they are
present, a startup warning names them.

**Efforts come from data.** A leg is `{ tier, raise }`, with
`effort = raise ? min(next(tier.effort), xhigh) : tier.effort`. With the
default efforts this reproduces today's table exactly (`plan.ts:6-14,24-26`),
reviews included:

| Base \ importance | normal | high | critical |
|---|---|---|---|
| qwen | qwen | qwen, rev T1 | T1, rev T2 |
| qwen-draft | qwen, rev T1 | qwen, rev T1 | T1, rev T2 |
| **H** (new) | H | H, rev T1 | T1, rev T2 |
| T1 | T1 | T1 raise | T2 raise |
| T2 | T2 | T2 raise | T2 raise, rev T2 raise |

How the table reads:

- No other cell raises, so reviews use their tier's own effort (T1 `high`,
  T2 `high`), and T2 `critical` reviews at T2 raised (xhigh), as today.
- A profile pinned to T1 whose worker is not T1 gives T1 raise plus rev T2
  (`plan.ts:26`).
- A profile pinned to `qwen` stays qwen with no review.
- `plan` stays T2.

Other sites that hard-code effort `high` take the target tier's own effort
instead: escalation (`attempts.ts:26`), the queue fallback (`policy.ts:56`), the
failover target (`failover.ts:29`) and randomize (`randomize.ts:10`).

**Tests.** A golden test runs today's `planFor` (copied into the test as the
oracle) against the new one, for every base × importance × pin with the
default tiers.

**Explicit models.** `acceptExplicit`/`modelTier` (`plan.ts:32-38`) and
`unrouted.tierOf` (`unrouted.ts:12-17`) map a model to a tier through
`tiers.*.model`, plus `localModel`/`cloudModel` for qwen. An explicit Haiku
model is tier H, which ranks above qwen and below T1.

### 6.2 The Qwen chain

There are two slots. Each is present only when its model is set.

- **Local slot** (`localModel`): one running task, guarded by the health probe
  of `localHealthUrl`.
- **Free-cloud slot** (`cloudModel`): when set, today's behaviour returns
  unchanged: caps of 1 local + 2 cloud (3 cloud without local),
  `cloudDailyCap`, the counter in `cloud.ts`, and `freeCapHit` with its
  failover. While `null`, the slot does not exist: no route, cap, count or
  wait. `pickQwen` gets an explicit `cloudEnabled` input, so that
  `chain.ts:15` (`cloudRunning === 0 → cloud`) no longer fires.

`pickQwen`'s result depends on the local state and the free-cloud slot:

| Local state | Free cloud filled | Free cloud empty |
|---|---|---|
| free (up, not busy, no own task) | as today | local |
| busy with own task | as today | wait |
| busy with another client (probe says busy, no own task) | as today | wait |
| down (probe fails) | as today without local | fallback at once |
| no `localModel` | cloud-only chain | fallback at once |

The policy then handles the outcome:

- **Wait:** poll every 2 s until `queueMaxSec`, then go to the fallback.
- **Fallback:** `tiers.qwen.fallback` (default H) at that tier's effort. Today
  the fallback is Sonnet `high`.

This changes `policy.ts:49`. Today it treats "busy with another client" as
unavailable and falls through at once; the table above waits instead.

**Failover** (`failover.ts`):

- Only `local` and `cloud` children are rerouted, as today.
- H, T1 and T2 children are not: same provider, and pi-retry handles
  transient errors.
- An ordinary local failure goes to the free cloud if that slot is open,
  otherwise to `tiers.qwen.fallback`. Today it goes to T1.

**Other sites:**

- `guards.ts:16` takes the context window from the child's tier.
- The `Route` type becomes `local | cloud | H | T1 | T2` (`policy.ts:21,32`).

**Tests.** A state-table test covers every row of the table, plus failover
for each route.

### 6.3 Haiku placement and escalation

- `scout` gets `minTier = H`; today it is T1.
- **Escalation** after a failed attempt (`attempts.ts`):
  - `qwen → T1` and `H → T1`. A failed Qwen task skips H, which by the owner's
    measurement sits at Qwen's level.
  - `T1 → T2`. At T2, one retry is allowed, and a third attempt is rejected
    (unchanged).
  - The escalated worker runs at the target tier's own effort.
- **Randomize:** `randomize.to` (default T1) is the comparison tier for the
  randomized share of qwen-routed spawns. Setting it to H compares Qwen with
  Haiku on the same task mix.
- Whether H also takes `qwen-draft` or reviews is decided by bench results and
  changed in settings. No code change is needed.

### 6.4 Logs

- **New fields:** the `spawn` outcome event gains two optional fields:
  - `route`: the route the child actually started on (`local | cloud | H | T1 | T2`);
  - `ranTier`: its tier.

  `workerTier` keeps meaning the planned tier. A queue fallback or a randomized
  pick is visible today only as a `reasons` string. These fields make it data.
- **Readers:** the reports (`analyse.ts:289,323,362`) prefer `ranTier` and fall
  back to `workerTier` for old events. The Qwen share and the randomized
  control group count only runs whose tier is qwen.
- **Versioning:** the change is additive, so `v` stays as it is. That follows
  `LOGS.md:39-41`.
- **Tier ranks:** `TIER_RANK` gains H. `LOGS.md` documents both fields.

## 7. Bench (milestone M1)

Bench options:

- **`dataDir`:** default `<agentDir>/bench`, exported as `PI_BENCH_DATA`.
- **`workDir`:** default `$XDG_RUNTIME_DIR/pi/tmp/bench`.
- **`extensions`:** an attrset of name → path, the extensions a bench arm loads.
  It is data, not derived from the registry: today's `CHILD_EXTENSIONS`
  (`orch.ts:18-20`) deliberately excludes cache-lifecycle, and the arms need
  the host's claude-auth and web-search. The host sets it at W. After M6 its
  default covers the flake's own packages.
- **`agentsBaseline`:** the AGENTS.md variant a bench arm uses. Today it is the
  personal notes path read at `config.ts:46`.

Arms:

- `haiku` (H, `medium`) and `haikuHigh` (H, `high`) are added.
- The arm for the retired free OpenRouter Qwen is removed. The defaults of
  `judge` and `judge-all` (`cli.ts:99,105`) move to `qwenl` and `sonnet`.
- The paid OpenRouter judge `gpt` stays (§10).
- The bench records subscription usage per solved task and refusals as its own
  outcome, alongside the pass rate. Reason: Haiku's verbose output and early
  reports of over-refusal.

## 8. Testing

### 8.1 Layer A, inside the flake (every milestone)

- **Package tests:** each package's
  `node --test --experimental-strip-types test/*.test.ts`. For the patched
  upstreams, their own suites, as in today's `checks/pi-*`; pi-retry uses
  vitest.
- **Type check:** `tsc --noEmit --strict --allowImportingTsExtensions` per
  package. `typescript` and `@types/node` come from the shared lock (§3). pi
  enters only through four `index.ts` files, which cast to local interfaces, so
  a small declaration stub for its few imports (`getAgentDir`, `ExtensionAPI`)
  is enough. The interface comparison of §5.3 runs here.
- **Module evaluation:** `homeManagerConfiguration` cases for:
  - each component alone, every component together, and the host-like
    combination;
  - one negative case per assertion;
  - one case per warning.

  The cases assert the rendered files (settings, links, `childExtensions`,
  the piSettings program) with `lib.hasInfix` or line splits, never
  `builtins.match`.
- **piSettings:** the ported fixtures (M0).
- **Log contract:** the check moves here, re-pointed at `packages/`. It needs
  all four extension packages, so it lands in M5 (§9).
- **Leak check:** see §8.3.

### 8.2 Layer B, in the host (during W only)

- `--override-input pi-economics path:/home/pallon/projects/nix/pi-economics`.
- The host's renamed eval assertions, a thin check for its own registry
  entries, and the full gate
  `nix flake check --keep-going --option eval-cache false`.
- A host-side term scan of `inputs.pi-economics`, modelled on
  `checks/terminal-kit-leaks.nix`, which derives its terms from the host's own
  configurations.
- `nixos-rebuild test` is an owner step. It swaps the extensions of running pi
  sessions.

### 8.3 Publication

- **In-flake leak check:** generic patterns only, because a literal term list
  in a public repository would itself be the leak. It looks for e-mail
  addresses, `/home/<name>/`, `git+ssh://` and private-network host
  literals in sources, defaults, fixtures and docs.
  - Test fixtures use neutral names. Today they use real ones, for example
    `task-router/test/settings.test.ts:26` and `policy.test.ts:82`; those are
    rewritten when moved.
- **Real names:** this spec and the plans name the owner's hosts. Before
  publication they are scrubbed or moved out of the repository.
- **History:** published as a squashed history.
- **Licensing:** the upstream licenses of `pi-actor-subagents`,
  `pi-infinite-context` and `pi-retry` are checked. The flake's license must
  allow distributing patches against them.

## 9. Milestones

Each milestone gets its own TDD plan, written right before it starts, at
`docs/plans/YYYY-MM-DD-<topic>-plan.md`. Each plan ends with an
`# Execution Record`. Code is copied from host commit `cee41b5`.

| # | Content |
|---|---|
| M0 | Flake skeleton, `common.nix` (agentDir, registry, piSettings with ported fixtures), shared npm lock, type-check harness, module-eval harness, leak check |
| M1 | `bench` (§7) |
| M2 | `actorSubagents` (3 patches, `spawnPolicyApi` passthru), `childExtensions` rendering |
| M3 | `tokenMeter` (reports, `LOGS.md`, readers for `route`/`ranTier`, `TIER_RANK` with H), `analysisSkill` |
| M4 | `cacheLifecycle`, `experiments` |
| M5 | `taskRouter` with §6; log-contract check (all four packages present) |
| M6 | `infiniteContext` (reminder options), `retry` (print-mode and free-cap patches, piSettings ops); bench `extensions` default from the packages |
| W | Wiring in the host (§9.1) |
| P | Publication (§8.3) |

Every milestone builds and tests on its own:

- The bench takes its extensions as data, so it does not wait for M2–M6.
- The readers of the new log fields (M3) land before their writer (M5) and
  tolerate the fields' absence.
- The log contract lands only once all four packages are present (M5).

### 9.1 Wiring (W)

**Gate.** The pluto plan
(`docs/plans/2026-09-29-pluto-server-plan.md:217,263`) compares the desktops'
derivations with the recorded baseline at every deploy through S3a. Wiring
changes andromeda's derivation. W therefore starts when the owner says the
host repo is free, which requires one of:

- the pluto plan's last deploy that checks the baseline is done, or
- the owner re-records the baseline.

**W0, all at once:** `actorSubagents` and the host's whole extension selection
move onto the registry. Today `pi-extensions.nix:384` writes
`actor-subagents/settings.json` unconditionally, so no single component can
switch before this step. After W0:

- the host's fixed extensions are registry entries;
- the in-tree packages are still the in-tree ones, registered through the
  registry.

**W1–Wn, one component per step:** replace the in-tree package with the flake's
component, move its settings from `homes/pallon`, and delete the in-tree copy
and its checks.

Host sites that change during W:

- **`ai/default.nix`:**
  - `:982` and `:1114` read `programs.pi.cacheLifecycle.enable` (the settings
    seed and the migrate `idle` flag). They are replaced by the piSettings ops.
  - `localSkillNames` (`:39`) loses the skill. The host wires
    `analysisSkill.path` instead.
- **`checks/eval-assertions.nix`:**
  - `:9330-9511`: the child set, the settings-seed and migrate assertions, the
    activation DAG order and the command line.
  - `:1175` and `:8932-8977`: the local-skill list and its "15 local" count.
- **`checks/pi-token-economics-checks.nix`:** the required-checks list.
- **`checks/pi-extensions.nix`:** split; the host part stays.
- **`homes/pallon`:**
  - `tiers.qwen.localModel` and `localHealthUrl` (§6.1);
  - the randomize and spotCheck settings;
  - the Haiku reminder override and prices (§5.2);
  - the bench `extensions` and `agentsBaseline`.
- **Docs:** the `AGENTS.md` routing bullet; `docs/pi-token-economics.md`
  becomes a pointer; `docs/README.md`.

**Drift.** Before W0, the in-tree paths are diffed against `cee41b5`. Changes
made meanwhile are ported into the flake first.

## 10. Decisions on former open questions

1. **Bench judge:** pi-bench keeps one paid, non-Claude judge on OpenRouter
   (`gpt`). It counters self-preference when Claude judges Claude arms. It is
   the only OpenRouter use outside the optional free-cloud slot.
2. **Publication:** the flake becomes public (`github:GRBurst/pi-economics`)
   when finished, under the conditions in §8.3.

## 11. Risks

- **Haiku usage:** Haiku's output is verbose (Artificial Analysis: about 3×
  GPT-6 Luna per task), and there were early over-refusal reports. The bench
  measures both (§7).
- **Upstream patches:** patches against upstream sources can stop applying on
  an input bump. The patched-package builds keep that a build failure, never a
  silent skip.
- **Tokenizer:** the newer tokenizer counts about 30% more tokens. Fold
  thresholds for Haiku are set in tokens (§5.2).
- **Waiting:** waiting on an externally busy local Qwen (§6.2) delays work by up
  to `queueMaxSec`. That is intended, and `queueMaxSec` is the knob.
