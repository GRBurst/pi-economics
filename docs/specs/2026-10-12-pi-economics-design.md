# pi-economics — design

Date: 2026-10-12 · Status: draft for review · Owner: pallon

## 1. Intent

Move the pi token-economics stack out of the NixOS flake
`~/projects/nixos/new` (below: *the host repo*) into a standalone flake
`~/projects/nix/pi-economics`, component by component. Each component is
switched on and configured on its own; dependencies between components are
enforced by module assertions, not by convention. While moving, the model
router is reworked for the model situation of October 2026: Claude Haiku 5.5
exists, the free OpenRouter Qwen tier is gone, and Qwen runs only locally for
now. The free-cloud slot stays in the code, empty by default, so a good free
model can be added again by configuration.

What the owner said:

- Everything belonging to pi token economics moves, one component at a time.
- Name: *pi-economics*; options `programs.piEconomics.<component>`.
- Each component: enable/disable plus configuration; dependencies covered by
  option checks.
- Router: Qwen local only for now; Haiku/Sonnet/Opus from the Anthropic
  subscription only; models configurable; when local Qwen is busy, wait up to
  `queueMaxSec`, then Haiku. The free-cloud slot's code stays: a good free
  model may be added again; while the slot is empty it is not taken into
  account.
- A Haiku tier; `scout` and the Qwen fallback use it; bench arms decide the rest.
- Named tiers with configurable `{model, effort}`, no free-form ladder.
- The host repo stays untouched until the job currently running there (the
  pluto deployment) has finished. Until then, only tests inside the new flake. Integration testing
  on the real system happens afterwards, and activation is an owner step.
- One overall spec, reviewed at least once; one TDD plan per milestone.
- Public repository when finished; bench keeps one paid OpenRouter judge.

Assumption (correct me): the git history of the moved code is not imported.

### Success criteria

1. `nix flake check path:~/projects/nix/pi-economics` passes with every
   component's own tests, module evaluation cases and the negative cases of
   every dependency assertion.
2. After wiring (§8), the host repo enables each component through
   `programs.piEconomics.*`, carries no in-tree copy of it, and its own checks
   and the owner's `nixos-rebuild test` pass.
3. Existing logs under `~/.pi/agent` stay readable by the reports.
4. No OpenRouter model is a default. The free-cloud slot is optional; while it
   is empty, the router never routes to it, never counts it in the slot caps,
   and never waits for it.
5. The repository is fit for publication: no personal identifiers in sources
   or defaults, enforced by a leak check (§7).

### Non-goals

- `pi-claude-auth` (auth and billing headers, coupled to the host's
  `~/.pi/claude` sandbox layout) stays in the host repo.
- `pi-question`, `pi-session-name`, `web-search`, `prompt-log`,
  `static-working-indicator` stay in the host repo.
- No new experiments beyond the router's tier comparison.

## 2. Components

| Option `programs.piEconomics.…` | Source today (host repo) | Kind |
|---|---|---|
| `bench` | `pkgs/pi-bench/` | CLI (`pi-bench`, `bench-report`) |
| `actorSubagents` | `features/ai/pi-actor-subagents.nix` + 3 patches | patched third-party extension |
| `taskRouter` | `features/ai/extensions/task-router/` | extension |
| `tokenMeter` | `features/ai/extensions/token-meter/` | extension + `meter-report`, `pi-analyse`, `LOGS.md` |
| `cacheLifecycle` | `features/ai/extensions/cache-lifecycle/` | extension |
| `experiments` | `features/ai/extensions/experiments/` | extension |
| `infiniteContext` | `features/ai/pi-infinite-context.nix` + 2 patches, `piContextReminders` options | patched third-party extension |
| `retry` | `features/ai/pi-retry.nix` + print-mode patch | patched third-party extension |
| `analysisSkill` | `features/ai/skills/pi-token-economics-analysis/` | agent skill (exported path) |

`pi-retry-free-cap.patch` stays with `retry`: it keeps the daily free-tier
cap from being retried, which matters again as soon as the free-cloud slot is
filled. `pi-settings-migrate`
is split (§5.4).

## 3. Flake layout

```
flake.nix                 inputs, packages.<c>, homeModules.{default,<c>}, checks, formatter
modules/<c>.nix           one HM module per component
modules/common.nix        programs.piEconomics.{extensions, piSettings}, link rendering
packages/<c>/             TypeScript packages (moved verbatim, then changed by milestone)
patches/<upstream>/*.patch
checks/                   module-eval cases, assertion negatives, log contract
skills/pi-token-economics-analysis/
docs/specs, docs/plans    this spec; one plan per milestone
```

Inputs: `nixpkgs`, `home-manager` (checks only), and the `flake = false`
sources `pi-actor-subagents`, `pi-infinite-context`, `pi-retry`. The host
repo makes all of them `follows` its own inputs, so the store paths stay the
ones it pins (same rule as `nix-terminal`). `formatter` is Alejandra.

`homeModules.default` imports every component module, all default off.

## 4. Module contract

Every component module `programs.piEconomics.<c>` has:

- `enable` — `mkEnableOption`.
- `package` — default the flake's build of the component.
- `settings` — `(pkgs.formats.json {}).type`, default `{}`. It is written as
  literal text to `~/.pi/agent/<c>/settings.json` only when non-empty, as
  today: checks read it with `fromJSON`, and a literal avoids
  import-from-derivation. Typed options (e.g. the router's tiers, §6) are
  merged into the same JSON. Keys not covered by typed options stay reachable
  through `settings`.
- Its contribution to the shared extension registry (§5.1).

### 4.1 Dependency assertions

| Component | Requires | Why |
|---|---|---|
| `taskRouter` | `actorSubagents` | registers the spawn policy (`__subagentsApi_v1`) |
| `cacheLifecycle` | `actorSubagents` | reads `list`/`subscribe` |
| `experiments` | `actorSubagents` | child arm inheritance through `subscribe` |

Message convention: `pi-economics: <c> requires <d> (<reason>)`. Every
assertion has a negative case in `checks/`. Soft couplings are documented, not
asserted, because each side tolerates absence at runtime: experiments' flags
read by taskRouter, cacheLifecycle, tokenMeter and infiniteContext's
`foldHint`; tokenMeter's reports reading router and experiments logs.

`bench` uses the components' **packages** (`cfg.<c>.package`), not their
enable state, so it works with any selection.

## 5. Shared mechanisms

### 5.1 Extension registry

`programs.piEconomics.extensions.<name> = { path; forChildren; description; }`.
Each enabled extension component adds itself. The flake renders:

- the links `~/.pi/agent/extensions/<name>`;
- when `actorSubagents` is enabled,
  `~/.pi/agent/actor-subagents/settings.json` with
  `childExtensions = [paths where forChildren]`.

The registry is open: the host repo adds its remaining extensions
(claude-auth, question, …) to the same option instead of rendering them
itself. That keeps one selection, and makes Home Manager's file-conflict check
reject an extension linked twice. This replaces the
`linkExtension = false` arrangement and its double-link assertion.

### 5.2 Context reminders

The `piContextReminders` options (`prices`, `cacheTtlMinutes`, `foldHint`,
`default`, `overrides`) move to `programs.piEconomics.infiniteContext` and
render `~/.pi/agent/infinite-context/settings.json`, as
`pi-extensions.nix` does today. Haiku 5.5 gets an override entry in the host
(1M window).

### 5.3 Cross-extension contracts

The versioned `globalThis` keys `__subagentsApi_v1` and
`__piExperimentsApi_v1` are unchanged. Consumers keep copies of the interface
(no package imports another). A type check (§7) compares each copy with the
provider's definition.

### 5.4 Mutable pi settings

pi's `settings.json` is mutable, and the host keeps it at
`~/.local/state/pi/settings.json`. Components declare edits:

- `retry`: the child `systemPromptRegex`;
- `cacheLifecycle`: `cacheWarming = "idle"`.

`programs.piEconomics.piSettings = { file; after; }` applies them in one
activation step. It is idempotent and does nothing when nothing changes. `file`
and the activation ordering `after` are set by the host. The host keeps its own
edits, e.g. the claude-auth package cleanup.

## 6. Router changes (milestone M3)

### 6.1 Tiers

The closed set is `qwen | H | T1 | T2`. The TypeScript type stays closed, so
every table must cover every tier. Configuration per tier:

```nix
programs.piEconomics.taskRouter.tiers = {
  qwen = { model = "llama/qwen3.8";              effort = "xhigh"; contextWindow = 262144; };
  H    = { model = "anthropic/claude-haiku-5-5"; effort = "medium"; contextWindow = 1000000; };
  T1   = { model = "anthropic/claude-sonnet-5-5"; effort = "high"; contextWindow = 1000000; };
  T2   = { model = "anthropic/claude-opus-5-5";   effort = "high"; contextWindow = 1000000; };
};
```

`effort` is a Nix `enum` and is validated again by the settings parser.

- **Effort by importance:** `normal` uses the tier's effort. `high` and
  `critical` use one step more, capped at `xhigh`. This reproduces today's
  table (T1 high/xhigh, T2 high/xhigh, qwen xhigh) as data.
- **Plan table:** the table base × importance → worker, review keeps its
  shape; it gains no row for `H`.
- **Kinds:** they map to tiers through `profiles.<kind>.{tier,minTier}`, as
  today.

### 6.2 Qwen chain

The chain keeps both slots: a free-cloud slot and the local slot. The
local slot keeps the health probe of `localHealthUrl` (neutral default
`http://127.0.0.1:11545`; the host sets `earth`) and one running task.

- **Free-cloud slot:** `tiers.qwen.cloudModel`, type `nullOr str`, default
  `null`. While it is `null`, `pickQwen` treats the slot as absent: no route to
  it, no slot caps for it, no waiting for it, and no daily count. When it is
  set, today's behaviour returns unchanged: the free cloud first, then local,
  then cloud, with caps of 1 local + 2 cloud (3 cloud without local),
  `cloudDailyCap`, the counter in `cloud.ts`, and `freeCapHit` with its
  failover. None of that code is removed.
- **Fallback:** when no slot frees up within `queueMaxSec`, the task goes to
  `tiers.qwen.fallback` (default `H`), at that tier's effort. Today it goes to
  Sonnet at `high`.
- **Tests:** the chain table gets cases for an empty slot (local free / busy /
  down, then the fallback) next to the existing cases for a filled slot.

### 6.3 Haiku placement

- `scout` gets `minTier = H` (today T1).
- Escalation after a failed attempt: `qwen → T1`, `H → T1`, `T1 → T2`. A
  failed Qwen task skips H, which by the owner's measurement is roughly at
  Qwen's level.
- `randomize.to` (default `T1`) chooses the comparison tier for the
  randomized share. Setting it to `H` compares Qwen with Haiku on the same
  task mix.
- Where else H belongs (`qwen-draft`, reviews) is decided by bench results, as
  settings changes. No code change is needed.

### 6.4 Logs

- **Route names:** `local | cloud | H | T1 | T2`; `H` is new, `cloud` only
  appears while the free-cloud slot is filled. Tier names add `H`.
- **Versioning:** the outcome schema version is bumped in `contract.ts` and
  `LOGS.md`.
- **Reports:** `pi-analyse` and `meter-report` read both versions.
- **Tier ranks:** `TIER_RANK` gains `H`. The Qwen-share criterion counts only
  `qwen`.

## 7. Testing

**Layer A — inside the flake (every milestone):**

- **Package tests:** each package's `node --test --experimental-strip-types`
  suite, plus the upstream suites of the patched sources (as today's
  `checks/pi-*`).
- **Type check:** `tsc --noEmit --strict` per package. pi's peer imports
  resolve against pi's published declarations. If those are not reachable from
  the build, a minimal declaration stub is used, and the M0 plan settles which.
  Nothing is type-checked today.
- **Module evaluation:** evaluated `homeManagerConfiguration` cases for each
  component alone, all components together, and one negative case per
  assertion. The cases assert rendered files (`settings.json`, links,
  `childExtensions`), with `lib.hasInfix`/line splits, never `builtins.match`.
- **Log contract:** the log-contract check moves here, re-pointed at
  `packages/`.
- **Leak check:** a check scans the flake's source for personal identifiers
  (host names, user names, home paths, e-mail addresses, private repository
  URLs), on the model of the host's `checks/terminal-kit-leaks.nix`. Personal
  values (`earth`, the owner's models, `~/.local/state/pi`) are set by the
  host, never as defaults here.

**Layer B — in the host repo (wiring, §8, after the pluto deployment):**

- **Development override:**
  `--override-input pi-economics path:/home/pallon/projects/nix/pi-economics`.
- **Host checks:** the host's eval assertions, renamed to `piEconomics`,
  and a thin `pi-extensions` check for the host's own extensions.
- **Full gate:** `nix flake check --keep-going --option eval-cache false`.
- **Activation:** `nixos-rebuild test` is an owner step. It swaps the
  extensions of running pi sessions.

## 8. Milestones

Each milestone gets its own TDD plan (`docs/plans/YYYY-MM-DD-<topic>-plan.md`
in this flake), written right before it starts. Each plan ends with an
`# Execution Record`.

| # | Content | Layer |
|---|---|---|
| M0 | Flake skeleton, `common.nix` (registry, piSettings), type-check setup, check harness | A |
| M1 | `bench`: module (`dataDir` → `PI_BENCH_DATA`, work dir); arms `haiku` (H, medium) and `haikuHigh` added; the arm for the retired free OpenRouter Qwen removed; the paid OpenRouter `gpt` judge kept (§10); extension paths from the modules instead of hard-coded names | A |
| M2 | `actorSubagents` with its 3 patches; `childExtensions` rendering | A |
| M3 | `taskRouter` + §6 | A |
| M4 | `tokenMeter` (reports, `LOGS.md`, log contract, §6.4 readers), `analysisSkill` | A |
| M5 | `cacheLifecycle`, `experiments` | A |
| M6 | `infiniteContext` (+ reminders options), `retry` (print-mode and free-cap patches), `piSettings` edits | A |
| W | Wiring in the host repo, one component at a time | B |

### Wiring (W)

- **When:** the busy job in the host repo is the pluto deployment
  (`docs/plans/2026-09-29-pluto-server-plan.md`). The host's `AGENTS.md`
  freezes the desktops' derivations while pluto is ported; only the pluto
  plan's S1e milestone records a new baseline. Wiring changes andromeda's
  derivation, so W starts only after S1e (or on the owner's explicit
  go-ahead), and only when the owner says the host repo is free.
- **Per component:** add the input (with `follows`), enable
  `programs.piEconomics.<c>`, move the settings from `homes/pallon`, delete
  the in-tree copy and its checks, and update the host's docs (`AGENTS.md`
  routing bullet, `docs/pi-token-economics.md` → pointer, like
  `docs/terminal-kit.md`).
- **Coexistence:** the in-tree `programs.pi.*` and the new
  `programs.piEconomics.*` can coexist during W, because their option names
  differ. Enabling both for one component fails on the conflicting link
  target, which is intended.
- **Drift:** the code is copied from a recorded host commit. At wiring time,
  the in-tree copy is diffed against that commit, so changes made meanwhile are
  not lost.

## 9. Risks

- **Usage cost:** Haiku's output is verbose (AA: about 3× GPT-6 Luna per task).
  Bench measures subscription usage per solved task, not only pass rate.
- **Over-refusal:** early reports of Haiku over-refusing. Bench logs refusals
  separately.
- **Thinking blocks:** they are account-bound. Sub-agents run on the same
  subscription, so this is not an issue.
- **Upstream patches:** patches against fdietze/monotykamary sources can stop
  applying on an input bump. The patched-source checks keep that a build
  failure.
- **Tokenizer:** the newer tokenizer counts about 30% more tokens. Fold
  thresholds for Haiku are set in tokens (§5.2).

## 10. Decisions on former open questions

1. **Bench judge:** pi-bench keeps one paid, non-Claude judge on OpenRouter
   (`gpt`). It is the only OpenRouter use outside the optional free-cloud
   slot, and it counters self-preference when Claude judges Claude arms.
2. **Publication:** the flake becomes public (`github:GRBurst/pi-economics`)
   when finished. Hence the leak check (§7) and the neutral defaults.
