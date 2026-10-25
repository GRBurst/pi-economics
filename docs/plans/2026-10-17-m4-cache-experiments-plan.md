# M4 — `cacheLifecycle` and `experiments`: TDD plan

Date: 2026-10-18 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 · Milestone: M4 (§9) · Base: this repository at the end of M3 (plan `docs/plans/2026-10-17-m3-token-meter-plan.md`, `d79e261`). M3 was executing while this plan was written (HEAD `c505840` = M3.1).

Source commit: host dotfiles `f6a3c81`, `projects/nixos/new/modules/home-manager/features/ai/extensions/{cache-lifecycle,experiments}/` (without `nix/hm-module.nix`, which `modules/{cache-lifecycle,experiments}.nix` replace); read only: `…/ai/pi-extensions.nix` lines 62–63, 194–204, 217–228, 339–340, 355–360; `…/ai/default.nix` lines 976–988, 1111–1114; `checks/pi-extensions.nix` lines 56–67, 80–86, 146–150, 228–272; host `flake.nix` lines 273–274 (`pi-cache-lifecycle`, `pi-experiments`). Drift checked while planning: `git dot diff --stat f6a3c81 HEAD -- <those paths and every path M0–M3 moved>` is empty at host HEAD `14b84d9` (2026-10-18). Task M4.0 checks again.

## Motivation

§9 row M4: `cacheLifecycle` and `experiments`. The host's two packages move to `packages/cache-lifecycle/` and `packages/experiments/`; their own suites (78 and 47 tests) run as before, and both pass `tsc --strict` (§8.1). `programs.piEconomics.cacheLifecycle` registers the extension for main sessions and children (§5.1), writes `<agentDir>/cache-lifecycle/settings.json` only when `settings` is non-empty, and contributes the piSettings op `set cacheWarming "idle"` at order 1500 in place of the host's positional `idle` flag (§4, §5.4). `programs.piEconomics.experiments` registers the extension for main sessions only and writes `<agentDir>/experiments/settings.json` only when non-empty. Both warn without `actorSubagents` (§4.1, soft dependencies marked *w*). M4 brings the provider of `__piExperimentsApi_v1`, so four interface comparisons start here (§8.1): cache-lifecycle and experiments against `__subagentsApi_v1`, token-meter and cache-lifecycle against `__piExperimentsApi_v1`. The move is pure (§1): with the default `agentDir` each package's output is the host's build file for file until M4.19's comment edits, the op renders the program that `pi-settings-migrate` already compares byte for byte with the host's script run with `idle`, and the actor-subagents file of the host's combination is the host's.

## Approach

- `packages/{cache-lifecycle,experiments}/` = the host's directories at `f6a3c81`, without `nix/`; `package.nix` at each root is the host's `nix/package.nix` with its two relative paths moved up and a new header (S2), as M3 D1. Flake outputs `packages.x86_64-linux.{cache-lifecycle,experiments}`; checks `cache-lifecycle`, `experiments` (the packages: `checkPhase` runs `node --test`, the host's checks `pi-cache-lifecycle`, `pi-experiments`) and `typecheck-{cache-lifecycle,experiments}` (M0's runner).
- `tsc --strict` reports two errors in cache-lifecycle and none in experiments. A type-only edit fixes each (S3): `armFor?` joins the inline `__piExperimentsApi_v1` type the code already calls (`core/shell.ts:126`), and one test fake gets the file's own `as never` cast (`test/shell.test.ts:99`).
- Four `iface.compare` checks (M2's harness) with two provider bindings in `checks/default.nix` (S1). Three consumers need a type-only edit first (S4): experiments' `SubagentsApi` gets `export`; token-meter's and cache-lifecycle's inline experiments types become the exported aliases `ExperimentsApi`. cache-lifecycle's `SubagentsApiV1` copy in `core/api.ts` is already exported, so its comparison is green at once and gets a planted red.
- `modules/cache-lifecycle.nix` (S5): `enable` (its description states §4.1's standalone caveat), `package`, `settings`; the registry entry `cache-lifecycle` (`forChildren = true`, `checkPath` = the flake's source `index.ts`, `input = null`, M3 D4); the settings file; `piSettings.ops.cacheLifecycle` = today's op (`checks/pi-settings-migrate/today-ops.nix`); a warning without `actorSubagents`.
- `modules/experiments.nix` (S7): the same shape; `forChildren = false`; no piSettings op, no timer; a warning without `actorSubagents`.
- Module-evaluation cases in `checks/module-eval/cases/{cache-lifecycle,experiments}.nix` (7 + 7, S6, S8), including the host's combination from W3 on (`cache-experiments-host-like`). Both components join `cases/together.nix`'s `components`, and that case gains one comparison, the activation entries: cacheLifecycle is the first component that adds one (S10).
- `home-files` (M3) also builds the two extension directories and runs cacheLifecycle's op through the script the activation entry runs (S9).
- §2: the two packages' code comments that cite the host's 2026-10-02 spec, plan and reviews (`spec §5.6.3`, `T8.7`, `plan S11`, `D2`, `R10`, `P19`, `L6`) lose the citation (40 lines in 21 files, S11). Test names and descriptive property labels (`P-off`, `P-floor`, …) stay (D16).

## Decisions

| # | Decision | Rationale | Rejected alternative, and why |
|---|---|---|---|
| D1 | `packages/<c>/package.nix` (host's `nix/package.nix`, `../package.json` → `./package.json`, `./..` → `./.`, header rewritten); `nix/` not copied | M3 D1: §3's layout; `installPhase` copies only `package.json index.ts core`, so the output is the host's | Copying `nix/`: a dead second module next to `modules/<c>.nix` |
| D2 | Outputs `packages.x86_64-linux.{cache-lifecycle,experiments}`; checks `cache-lifecycle`, `experiments` (the packages), `typecheck-cache-lifecycle`, `typecheck-experiments` | M3 D2; the build runs the tests, as the host's `pi-cache-lifecycle`, `pi-experiments` (`flake.nix:273-274`) | A second `node --test` derivation: the tests twice |
| D3 | `tsc` fix 1: `armFor?(s: string): { id?: string } \| undefined` added to cache-lifecycle's inline experiments type (`core/shell.ts:39`) | Type-only; the code calls `experiments()?.armFor?.(sid)?.id` (`:126`), which the type omitted (TS2339); same member as token-meter's copy (`core/shell.ts:25`) | `(experiments() as any).armFor`: hides the error (M1 D4) |
| D4 | `tsc` fix 2: `api: () => api as never` at cache-lifecycle `test/shell.test.ts:99` | Type-only, erased by `--experimental-strip-types`; the fake implements only `list` on purpose, and the same file (`:198`) and `test/flags.test.ts:29` cast their partial fakes `as never` | Completing the fake (adds `subscribe` and `AgentInfo` fields the test does not need, a fixture change); widening `Deps.api` (a production type looser than the code reads) (open question Q2) |
| D5 | Four checks `iface-<api>-<consumer>`: `iface-subagents-cache-lifecycle`, `iface-subagents-experiments`, `iface-experiments-token-meter`, `iface-experiments-cache-lifecycle`; bindings `subagentsProvider`, `experimentsProvider` in `checks/default.nix` | §8.1's M4 pairs; M2's naming (`iface-subagents-bench-probe`); one binding per provider instead of four copies | Re-pointing M2's `iface-subagents-bench-probe` at `subagentsProvider` too: a refactor of an existing check that M4 does not need |
| D6 | Consumer types: experiments `type SubagentsApi` → `export type SubagentsApi` (`core/shell.ts:18`); token-meter and cache-lifecycle: `export type ExperimentsApi = {…}` next to the cast, the cast names it; each with the bench probe's comment ("the type check compares it with the provider's …") | §8.1: an inline type becomes a named alias, a type-only edit; next to its one use, as M2 did in `probe/index.ts` | Moving the copies into `core/api.ts`: a larger diff; importing the provider's type: packages do not import each other (`core/api.ts:1-2`) |
| D7 | Registry entries: `path = "${package}"`, `checkPath = ../packages/<c>/index.ts`, `input = null`; `forChildren` true (cache-lifecycle), false (experiments); the host's descriptions, experiments' without "spec §5.6" | M3 D4; host `pi-extensions.nix:194-228`; the description's citation names the host's spec (§2) and is rendered nowhere | Keeping "spec §5.6": a pointer into a document this flake does not have |
| D8 | `settings` type `attrsOf (pkgs.formats.json {}).type` | M3 D5; the host sets none, its checks set `{maskOnCold = "tools";}` and `{minExplore = 0.15;}` | The host's `(pkgs.formats.json {}).type`: accepts a list for a settings object |
| D9 | `piSettings.ops.cacheLifecycle = [{op = "set"; path = ["cacheWarming"]; value = "idle"; order = 1500;}]` inside `mkIf enable`; the case compares it with `today-ops.nix`'s `withWarming.cacheLifecycle` and the program with today's other ops with `withWarming`'s | §5.4; M0 wrote `today-ops.nix` for this comparison ("M4 compares ops.cacheLifecycle"); equal programs make M0's byte comparison with the legacy script's `idle` run (`pi-settings-migrate`, part 2) cover the component | A literal op in the case only: a second copy of today's op that could drift from the fixture the differential check runs |
| D10 | Warnings, while `!actorSubagents.enable`: `pi-economics: <c> without actorSubagents loses <feature> (<reason>)`, the features of §4.1's table | §4.1 *w*; the form parallels the assertion form; a user reads it, so the case pins the literal | No warning (§4.1 asks for one); an option to silence it: not in the spec (open question Q1) |
| D11 | §4.1's standalone caveat stands in `cacheLifecycle.enable`'s description; the case requires `cacheWarming`, `settings.json`, `piSettings.enable` in it | §4.1: "The module's description says so"; a word check survives rewording | No case: a requirement nothing checks |
| D12 | No `linkExtension` | §5.1, M3 D6 | Keeping it |
| D13 | `cache-experiments-host-like` (in `cases/experiments.nix`): actorSubagents, tokenMeter, cacheLifecycle, experiments, `piSettings.enable = false` | §8.1 "the host-like combination"; the host's state from W3 to W6 (§9.1): children `cache-lifecycle`, `token-meter` (host `eval-assertions.nix` child set), no `piSettingsMigrate` entry of the flake's (the host's script runs) | A case per pair: the host's child set would be spread over cases |
| D14 | `components-together` also compares activation entry names | cacheLifecycle is the first component with an activation entry; without the line a stray entry under the combination goes unseen (an existing case changes: it gains one comparison and keeps the others) | Leaving the case as it is: `home.activation` is not covered by any combination case |
| D15 | `home-files` also checks both extension directories (`package.json`, `index.ts`, `core/shell.ts`) and runs `piSettings.package` of the rendered configuration on `{"theme":"dark"}` → `{"theme":"dark","cacheWarming":"idle"}` | module-eval evaluates only; this builds the paths pi loads and runs the op end to end through the activation's script | A new check: `home-files` is the place M3 opened for rendered sources |
| D16 | §2 re-pointing: code comments only (40 lines, 21 files, S11). Dropped: `spec §…`, bare `§…`, `plan S…`, `(plan)`, task ids `T…`, the host's numbered items `D2`, `R10`, `P19`, `L6`. Kept: test names (`"… (T7.0)"`, `"P19: …"`), property labels (`P-off`, `P-balance`, `P-floor`, `P-design`, `P-tail`, `P-idem`, `P-stable`) and dates | §2 names code comments; tests stay as copied (§8.3, M3 D10); a property label names the property stated next to it, not a document; the one trailing code comment `// D2` becomes `// main is not a child (above)` | Editing test names: changes the copied tests; dropping property labels: loses the names the tests use (open question Q3) |
| D17 | No timer: `experiments-defaults` requires the systemd user services and timers to equal the bare configuration's | The host's check (`checks/pi-extensions.nix:264-269`) pins it; the host's module comment says so | No case: a timer could arrive unseen |
| D18 | The four comparisons are all of M4's; the router's two (`__subagentsApi_v1`, `__piExperimentsApi_v1`) are M5's | §8.1 lists token-meter and cache-lifecycle against experiments for M4 and the router for M5 | Router comparisons now: the router moves in M5 (open question Q6) |

## The gate

No principles document; the gate is §4's rules, §8's testing rules, `AGENTS.md` and the M0–M3 lessons.

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: every task has a RED; the green-first tasks (M4.4, M4.5, M4.16–M4.18) carry planted violations, and so does the move (M4.1, M4.3) |
| No `builtins.match` on generated text | PASS: `eq`, `holds`, `lib.hasInfix`, `lib.hasPrefix`, `lib.hasSuffix`; `home-files` uses `jq -e` |
| Typed options; assertions for invariants | PASS: `enable`, `package`, `settings` (JSON object); no hard dependency in M4 (§4.1), so no assertion; the soft ones are warnings (M4.12, M4.15) |
| camelCase options, kebab-case directories (§4) | PASS: `cacheLifecycle`, `experiments`; `packages/cache-lifecycle`, `cache-lifecycle/settings.json`, `experiments/settings.json` |
| Settings files are literal text (§4) | PASS: `.text = builtins.toJSON settings` |
| Merges with `lib.recursiveUpdate` (§4) | N/A: no file of M4 has two writers; `actor-subagents/settings.json` is M2's |
| Every assertion message `pi-economics:` with a negative case | N/A for assertions (none new); the two warnings start with `pi-economics:` and each has a case (§8.1 "one case per warning") |
| No import-from-derivation | PASS: `checkPath` probes the source (`*-defaults`: no derivation behind it); the op and program are read at evaluation |
| Contributor-keyed piSettings ops, today's order (§5.4) | PASS: key `cacheLifecycle`, order 1500; `cache-lifecycle-pisettings` equals today's program |
| Scripts strict and dependency-explicit | PASS: `home-files` keeps `set -euo pipefail`, gains `pkgs.jq` in `nativeBuildInputs` |
| Alejandra on every changed `.nix` file | PASS: CLEAN steps; the prototype passed `alejandra --check` over every tracked `.nix` file |
| Markdown under `docs/` | PASS: `docs/pi-economics.md` gets the component sections |
| `flake.lock` changes only as needed | PASS: no new input |
| Leak patterns (§8.3) | PASS: `leak` green with both packages (prototype); the copied tests name no host or person |
| Host read-only | PASS: `git dot show`/`archive`/`diff` only |
| Every check built with both `git+file://` and `path:` refs | PASS: M4.21 (prototype: all 23 checks green under both) |
| Pure move (§1) | PASS: tree `diff -r` and built-output `diff -r` with the host's (M4.1, M4.3); `tsc` edits type-only with the suites unchanged (M4.2); comment edits shown comment-only (M4.19); today's op and program (M4.11); today's child set (M4.16) |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION.

## Files to read first

Listed, not quoted; the tasks show only what changes.

- The spec: §1, §2 (rows `cacheLifecycle`, `experiments`; citations), §3, §4 (rows `cacheLifecycle`, `experiments`), §4.1 (standalone notes, soft dependencies), §5.1, §5.3, §5.4 ("Order", "Today's sequence", "Component contributions"), §8.1 ("Interface comparisons", "Module evaluation"), §8.3, §9 (row M4, "Drift"), §9.1 W3.
- The M3 plan: "Interfaces M3 publishes", D4, D10, D14, S8, S9, and its Execution Record (deviations, the final case count N, the final `home-files` and `together.nix`). The M2 plan: D9 and S3–S5 (the iface harness). The M0 plan's `today-ops.nix` and `pi-settings-migrate` parts.
- This repository at M3's end: `flake.nix`, `checks/default.nix`, `checks/iface/default.nix`, `checks/module-eval/{default.nix,expect.nix,cases/common.nix (pisettings-*),cases/token-meter.nix,cases/together.nix}`, `checks/home-files/default.nix`, `checks/pi-settings-migrate/today-ops.nix`, `modules/{common,actor-subagents,token-meter,default}.nix`, `packages/token-meter/core/shell.ts` (lines 1–30), `patches/pi-actor-subagents/pi-actor-subagents-spawn-policy.patch` (the `api.ts` hunk), `docs/pi-economics.md`.
- Host at `f6a3c81` (`host <path>`): `$ai/extensions/cache-lifecycle/{nix/package.nix,nix/hm-module.nix,package.json,index.ts,core/api.ts,core/settings.ts,core/shell.ts}`, `$ai/extensions/experiments/{nix/package.nix,nix/hm-module.nix,index.ts,core/api.ts,core/settings.ts,core/shell.ts}`; `$ai/pi-extensions.nix` lines 194–228; `$ai/default.nix` lines 976–988, 1111–1114; `checks/pi-extensions.nix` lines 56–67, 146–150, 228–272.
- This plan's Snippets.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| `tsc --strict` via `typecheck-cache-lifecycle` | from M4.2 | until D3/D4: `core/shell.ts:126:34 - error TS2339: Property 'armFor' does not exist on type '{ flag(n: string, d: string, s?: string \| undefined): string; }'.` and `test/shell.test.ts:99:92 - error TS2322`; later any implicit `any` |
| `tsc --strict` via `typecheck-experiments` | from M4.4 | nothing at the copy (green); a planted `TS2322` |
| `tsc --strict` via `iface-*` (M2's harness) | from M4.5–M4.8 | a missing export (TS2459, TS2305), a provider not assignable to the consumer's copy (TS2322) |
| Nix module system | `module-eval` | unknown options (each module task's RED), a non-object `settings`, an op without `path` |
| shellcheck | — | N/A: no new script (`home-files` is a `runCommand`) |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package tests (`cache-lifecycle`, `experiments`) | the copied suites: 78 tests (cold, flags, guards, identity, mask, messages, portable, settings, shell, ttl, warm) and 47 (api, assign, design, guards, portable, settings, shell) | nodejs; ~10 s each, 0.15 GiB |
| Type check (`typecheck-*`) | `--strict` over `index.ts`, `core/`, `test/` of each | the shared lock; ~25 s, 0.25 GiB |
| Interface comparisons (`iface-*`) | the provider's type is assignable to each consumer's copy: cache-lifecycle and experiments ⊒ `SubagentsApiV1` (the patched actor-subagents); token-meter and cache-lifecycle ⊒ `ExperimentsApiV1` | M2's harness; ~30 s each, 0.25 GiB |
| Module evaluation (`module-eval`) | both components off, on, package, files, settings, the registry entries, the op and program, the activation entry, the warnings, the host's combination, every component together | Home Manager (M0 harness); N + 14 cases (planned 57), 1.64 GiB peak, ~120 s under load |
| Build check (`home-files`) | the extension directories pi loads; the op through the activation's script | ~27 s, 0.43 GiB |
| piSettings script (`pi-settings-migrate`, M0) | today's ops incl. `cacheLifecycle`'s, byte-compared with the legacy script | unchanged; `cache-lifecycle-pisettings` ties the component to it |
| Leak (`leak`) | the copied packages | — |
| Log contract (assignments, guards → `pi-analyse --check`) | N/A: M5, once the router is here (§8.1) | — |
| Layer B, activation | N/A: W3 (§9.1), owner step | — |

## Scenario coverage

| Spec scenario | Check · case (task) |
|---|---|
| §2 `cacheLifecycle` = `ai/extensions/cache-lifecycle/` | M4.1 Step 4 (tree and built-output `diff -r`); `cache-lifecycle` (M4.1) |
| §2 `experiments` = `ai/extensions/experiments/` | M4.3 Step 4; `experiments` (M4.3) |
| §3 `packages/<c>/`, `packages.<c>` | `cache-lifecycle-package`, `experiments-package` (M4.9, M4.13); M4.21 listing |
| §4 `enable`, `package` | `*-off`, `*-defaults`, `*-package` (M4.9, M4.13) |
| §4 `<c>/settings.json` if non-empty | `*-files` (none with `{}`), `*-settings` (M4.9–M4.10, M4.13–M4.14) |
| §4 cacheLifecycle's piSettings op `cacheWarming = "idle"` | `cache-lifecycle-pisettings` (M4.11); `home-files` (M4.17) |
| §4.1 standalone cacheLifecycle: description states the caveat | `cache-lifecycle-pisettings` (M4.11) |
| §4.1 *w* cacheLifecycle without actorSubagents | `cache-lifecycle-warning` (M4.12) |
| §4.1 *w* experiments without actorSubagents | `experiments-warning` (M4.15) |
| §4.1 other soft dependencies (infiniteContext, experiments flags): no warning | `*-defaults` (warnings = bare); `components-together` (M4.18) |
| §5.1 registry: link, `forChildren`, `checkPath` without import-from-derivation | `*-defaults` (M4.9, M4.13) |
| §5.1 children: cache-lifecycle yes, experiments no; link paths | `cache-experiments-host-like` (M4.16) |
| §5.3 `__subagentsApi_v1` consumers cache-lifecycle, experiments | `iface-subagents-cache-lifecycle` (M4.5), `iface-subagents-experiments` (M4.6) |
| §5.3 `__piExperimentsApi_v1` provider experiments; consumers token-meter, cache-lifecycle | `iface-experiments-token-meter` (M4.7), `iface-experiments-cache-lifecycle` (M4.8) |
| §5.3 consumers task-router; infinite-context patch | N/A: M5 (router); excluded by §5.3 (inline cast in a patch) |
| §5.4 contributor key, `order = 1500`, today's bytes | `cache-lifecycle-pisettings` (ops = today's, program = today's) (M4.11); `pi-settings-migrate` part 2 (M0) |
| §5.4 `enable = false`: no entry, whatever ops | `cache-lifecycle-pisettings`, `cache-experiments-host-like` (M4.11, M4.16) |
| §8.1 package tests; `tsc --strict`; a forced edit keeps behaviour | `cache-lifecycle`, `experiments`; `typecheck-*`, the suites after (M4.2, M4.4) |
| §8.1 inline type → named alias, type-only | M4.6–M4.8 (suites and type checks unchanged) |
| §8.1 each alone, every component together, host-like | `*-warning` (alone); `components-together` (M4.18); `cache-experiments-host-like` (M4.16) |
| §8.1 one case per warning | `cache-lifecycle-warning`, `experiments-warning` |
| §8.3 leak; neutral fixtures | `leak` (M4.1, M4.3, M4.21) |
| §2 citations re-pointed | M4.19 |
| §9 drift | M4.0, M4.21 Step 3 |
| host check: no posterior timer | `experiments-defaults` (M4.13) |

## Properties

- `*-off` (c ∈ {cacheLifecycle, experiments}): ¬extensions ? name(c) ∧ targets = targets(bare) (∧ for cacheLifecycle: piSettings.ops = {}).
- `*-defaults`: ∀ dir ∈ {".pi/agent", "custom/agent"}, with actorSubagents: entry = {path = "${package}"; input = null; forChildren = f(c)} (f(cacheLifecycle) = true, f(experiments) = false; `package` read from the evaluated config) ∧ checkPath ends in `/packages/<c>/index.ts` ∧ {x ∈ context(checkPath) | x has outputs} = ∅ ∧ dir/extensions/<c> ∈ targets ∧ failed = ∅ ∧ warnings = bare (∧ for experiments: units(systemd.user) = units(bare)).
- `*-package`: drvPath = `packages.x86_64-linux.<c>.drvPath` ∧ name = `pi-<c>-0.1.0` (literal: the host's `checks/pi-extensions.nix:147,150` match it).
- `*-files`: ∀ dir: sort(targets(on)) = sort(targets(bare) ∪ {dir/extensions/<c>}) (exact: no settings file with `{}`).
- `*-settings`: ∀ dir: fromJSON(text(dir/<c>/settings.json)) = s, s = the host's check value.
- `cache-lifecycle-pisettings`: ops(on) = {cacheLifecycle = today.withWarming.cacheLifecycle} ∧ program(on ⊕ ops = today.withoutWarming) = program(ops = today.withWarming) ∧ piSettingsMigrate ∈ activation(on) ∧ piSettingsMigrate ∉ activation(on ∧ piSettings.enable = false) ∧ {"cacheWarming", "settings.json", "piSettings.enable"} ⊂ words(description(enable)).
- `*-warning`: warnings(c alone) ∖ warnings(bare) = [message(c)] (literal: users read it) ∧ failed = ∅.
- `cache-experiments-host-like`: childExtensions = [home/.pi/agent/extensions/{cache-lifecycle, token-meter}] ∧ text(actor-subagents/settings.json) = toJSON {childExtensions = that list} ∧ links = {actor-subagents, cache-lifecycle, experiments, token-meter} ∧ piSettingsMigrate ∉ activation ∧ failed = ∅ ∧ warnings = bare.
- `components-together`: as M3, with C = {bench, actorSubagents, tokenMeter, analysisSkill, cacheLifecycle, experiments}, plus names(activation(all C)) = ⋃_c names(activation(c)).
- `home-files` (added): ∀ dir: {package.json, index.ts, core/shell.ts} ⊂ extension dir of each ∧ piSettings.package({"theme":"dark"}) = {"theme":"dark","cacheWarming":"idle"}.
- `iface-*`: Provider ≤ Consumer (assignability).
- M4.1/M4.3 one-offs: tree(flake) = tree(host) ∖ nix/; output(flake) = output(host `nix/package.nix`), file for file. M4.19: strip_comments(after) = strip_comments(before) per file.

## Planted violations

Tick in the task once seen.

| Check | Plant | Must fail with | Task |
|---|---|---|---|
| `cache-lifecycle` | `test/settings.test.ts`: `{ ...defaults(), maskOnCold: "tools" }` → `maskOnCold: "off"` | `✖ known keys override defaults, unknown keys and wrong types are ignored`, `ℹ fail 1` | M4.1 Step 5 |
| `typecheck-cache-lifecycle` | (natural red) the copy as is | `core/shell.ts:126:34 - error TS2339: Property 'armFor' does not exist on type '{ flag(n: string, d: string, s?: string \| undefined): string; }'.`, `test/shell.test.ts:99:92 - error TS2322: Type '() => { list: () => { sessionId: string; }[]; } \| undefined' is not assignable to type '() => Pick<SubagentsApiV1, "list" \| "subscribe"> \| undefined'.`, `Found 2 errors in 2 files.` | M4.2 Step 2 |
| `experiments` | `test/settings.test.ts`: the expected `maxArms: 8` → `maxArms: 16` | `✖ known keys override defaults, unknown keys and wrong types are ignored`, `ℹ fail 1` | M4.3 Step 5 |
| `typecheck-experiments` | append `export const planted: number = "x";` to `core/api.ts` | `core/api.ts:70:14 - error TS2322: Type 'string' is not assignable to type 'number'.` | M4.4 Step 3 |
| `iface-subagents-cache-lifecycle` | `version: 2;` as the first member of `interface SubagentsApiV1` in cache-lifecycle `core/api.ts` (`typecheck-cache-lifecycle` stays green) | `compare.ts:5:14 - error TS2322: Type 'import("…/provider/extensions/actor-subagents/api", …).SubagentsApiV1' is not assignable to type 'import("…/consumer/core/api", …).SubagentsApiV1'.` | M4.5 Step 3 |
| `iface-subagents-experiments` | (natural red) before the `export` | `compare.ts:2:15 - error TS2459: Module '"./consumer/core/shell.ts"' declares 'SubagentsApi' locally, but it is not exported.` | M4.6 Step 2 |
| `iface-subagents-experiments` | `list(): Array<{ name: string; sessionId: string; depth: number }>;` (`typecheck-experiments` stays green) | `compare.ts:5:14 - error TS2322: Type 'SubagentsApiV1' is not assignable to type 'SubagentsApi'.` | M4.6 Step 5 |
| `iface-experiments-token-meter` | (natural red) before the alias | `compare.ts:2:15 - error TS2305: Module '"./consumer/core/shell.ts"' has no exported member 'ExperimentsApi'.` | M4.7 Step 2 |
| `iface-experiments-token-meter` | `export type ExperimentsApi = { version: 2; armFor?…` (`typecheck-token-meter` stays green) | `compare.ts:5:14 - error TS2322: Type 'ExperimentsApiV1' is not assignable to type 'ExperimentsApi'.` | M4.7 Step 5 |
| `iface-experiments-cache-lifecycle` | (natural red) before the alias | `compare.ts:2:15 - error TS2305: Module '"./consumer/core/shell.ts"' has no exported member 'ExperimentsApi'.` | M4.8 Step 2 |
| `iface-experiments-cache-lifecycle` | `export type ExperimentsApi = { version: 2; flag…` (`typecheck-cache-lifecycle` stays green) | `compare.ts:5:14 - error TS2322: Type 'ExperimentsApiV1' is not assignable to type 'ExperimentsApi'.` | M4.8 Step 5 |
| `module-eval` | cacheLifecycle `forChildren = false;` | `FAIL cache-lifecycle-defaults: registry entry (.pi/agent): expected { forChildren = true; … }, got { forChildren = false; … }` (both dirs) | M4.9 Step 5 |
| `module-eval` | cacheLifecycle settings file `lib.mkIf true {…}` | `FAIL cache-lifecycle-files: home.file targets (.pi/agent): …` and `(custom/agent)` (a settings target with `{}`) | M4.10 Step 4 |
| `module-eval` | op `order = 1000;` | `FAIL cache-lifecycle-pisettings: ops: expected { cacheLifecycle = [ { op = "set"; order = 1500; … } ]; }, got { … order = 1000; … }` and `… program with today's other ops: expected "def op1: …` | M4.11 Step 5 |
| `module-eval` | description: `while piSettings.enable is false` → `while the entry is off` | `FAIL cache-lifecycle-pisettings: the description states the standalone caveat: does not hold` | M4.11 Step 5 |
| `module-eval` | cacheLifecycle `warnings = lib.optional pe.actorSubagents.enable …` (inverted) | `FAIL cache-lifecycle-warning: new warnings: expected [ "pi-economics: cacheLifecycle without actorSubagents …" ], got [ ]`, `FAIL cache-lifecycle-defaults: warnings (.pi/agent): …` (both dirs) | M4.12 Step 4 |
| `module-eval` | experiments `forChildren = true;` | `FAIL experiments-defaults: registry entry (.pi/agent): expected { forChildren = false; … }` (both dirs) | M4.13 Step 5 |
| `module-eval` | experiments settings file `lib.mkIf true {…}` | `FAIL experiments-files: home.file targets (.pi/agent): …` and `(custom/agent)` (a settings target with `{}`) | M4.14 Step 4 |
| `module-eval` | experiments warning inverted | `FAIL experiments-warning: new warnings: expected [ "pi-economics: experiments without actorSubagents …" ], got [ ]`, `FAIL experiments-defaults: warnings (…)` (both dirs) | M4.15 Step 4 |
| `module-eval` | cacheLifecycle `forChildren = false;` | `FAIL cache-experiments-host-like: childExtensions: expected [ "/home/u/.pi/agent/extensions/cache-lifecycle" "/home/u/.pi/agent/extensions/token-meter" ], got [ "/home/u/.pi/agent/extensions/token-meter" ]`, `… actor-subagents/settings.json: …` (with M4.9's lines) | M4.16 Step 3 |
| `home-files` | experiments `path = "${cfg.package}/core";` | `FAIL .pi/agent: /nix/store/…-pi-experiments-0.1.0/core lacks package.json` | M4.17 Step 3 |
| `home-files` | op `value = "streaming";` | `FAIL .pi/agent: settings.json after the op: { "theme": "dark", "cacheWarming": "streaming" }` | M4.17 Step 3 |
| `module-eval` | in `modules/cache-lifecycle.nix`'s config `home.activation.planted = lib.mkIf pe.actorSubagents.enable (lib.hm.dag.entryAnywhere "");` | `FAIL components-together: activation entries: expected [ … "piSettingsMigrate" "reloadSystemd" "writeBoundary" ], got [ … "planted" … ]` | M4.18 Step 3 |

Planner's dry run (2026-10-18, scratch clone under `$TMPDIR` at `c505840` = M3.1, with M3's S3–S9 applied as a stand-in for M3.2–M3.11; M3's S10 not applied, it touches no file M4 edits; final state of every snippet; load average 21–27): 23 checks green under `git+file://` and under `path:` (9.5 min for both listings; `cache-lifecycle` 78 tests, `experiments` 47; `module-eval` 57 cases = 43 + 14, 121 s, 1.64 GiB; `home-files` 27 s, 0.43 GiB); `alejandra --check` clean over every tracked `.nix` file; M4.19's comment-stripped files equal. Seen red: every row above except M4.10's, M4.12's and M4.13's (the same plants were seen on the sibling component), plus TS2339/TS2322 at M4.2. Not seen: the option- or attribute-missing REDs, M4.11's/M4.12's/M4.15's pre-GREEN lists (the same lines were seen through their plants), and M4.1/M4.3 Step 4 at the copy state (at the end state the built outputs differ from the host's exactly by S3, S4 and S11). Several `module-eval` plants were seen together in one build (15 `FAIL` lines, each naming its case).

## Coverage gap

- **Real pi.** The suites drive fakes (`test/fake-pi.ts`, a fake `__subagentsApi_v1`); no check loads either extension into pi, lets pi ask for a warming decision (`cache_warming_decision` fires only with `cacheWarming = "idle"`), or spawns a child that inherits an arm. W3's activation (owner step) covers it, as for the host today.
- **The activation on the real file.** `home-files` runs the script on a scratch file; the activation line and its file path are M0's cases. A new install without `settings.json` keeps pi's default (`streaming`) until the host's seed writes one: documented (D11), not testable here.
- **Cross-package runtime contract.** The `iface-*` checks compare types; the flags' values (factor names, levels) that cache-lifecycle reads from an arm are pinned only by each package's own tests (`flags.test.ts`, `design.test.ts`). A renamed factor in experiments' defaults would pass every check here.
- **infinite-context's cast of `__piExperimentsApi_v1`** (`cache.patch:102`): excluded by §5.3; M6 moves it.
- **The host's readers** (`ai/default.nix:982,1114`, `eval-assertions.nix` child set, seed and migrate flag, `checks/pi-extensions.nix` link suffixes and settings cases): W3 re-points and runs them; `*-package`, `*-settings` and `cache-experiments-host-like` mirror them.
- **Log contract** (assignments and guard events through `pi-analyse --check`): M5.

## Environment (every step)

```sh
source ~/.cache/pi/m0env.sh      # XDG dirs, cd, F (git+file), o, cap, nb, ne, fmt, host (f6a3c81), nbl
Fp=path:$HOME/projects/nix/pi-economics
nbp() { (ulimit -v $cap && exec timeout -s KILL 1500 nix build --no-link -L "$Fp#checks.x86_64-linux.$1" "${o[@]}"); }
ai=modules/home-manager/features/ai
strip() { sed -E 's#^[[:space:]]*(//|/\*\*|\*).*$##; s#[[:space:]]+// .*$##'; }   # M4.19
```

- The machine is loaded (load average 21–27 while planning): `module-eval` took ~120 s. If `nb` is killed at 900 s, run the same `nix build` with `timeout -s KILL 1500` once more, unchanged, and note it.
- `git+file:` sees only indexed files: `git add` new files before `nb`/`ne`.
- `nb` prints no log for an output already in the store: `nbl <check>`. A 2-second green package check is a cached one; `nix log` on its `.drv` shows the tests.
- `git dot archive` takes paths relative to `~/projects/nixos/new` when run there; `--strip-components=5` drops `modules/home-manager/features/ai/extensions`.
- Plain `git` here; `git dot` only to read the host. Commits unsigned. Undo a plant with `git checkout -- <file>` after staging the green state (`/tmp` is private, M2 Execution Record).
- TypeScript edits keep each package's two-space indentation.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/cache-lifecycle/**` | the host's package without `nix/`; `package.nix` (S2) | M4.1 |
| `packages/cache-lifecycle/{core/shell.ts,test/shell.test.ts}` | D3, D4 (S3) | M4.2 |
| `packages/experiments/**` | the host's package without `nix/`; `package.nix` (S2) | M4.3 |
| `packages/experiments/core/shell.ts` | `export type SubagentsApi` (S4) | M4.6 |
| `packages/token-meter/core/shell.ts` | `export type ExperimentsApi` (S4) | M4.7 |
| `packages/cache-lifecycle/core/shell.ts` | `export type ExperimentsApi` (S4) | M4.8 |
| `packages/{cache-lifecycle,experiments}/**/*.ts` | 40 comment lines (S11) | M4.19 |
| `flake.nix` | `packages.x86_64-linux.{cache-lifecycle,experiments}` | M4.1, M4.3 |
| `checks/default.nix` | 8 checks, `subagentsProvider`, `experimentsProvider` (S1) | M4.1–M4.8 |
| `modules/cache-lifecycle.nix`, `modules/default.nix` | the component (S5, S10) | M4.9–M4.12 |
| `checks/module-eval/cases/cache-lifecycle.nix` | 7 cases (S6) | M4.9–M4.12 |
| `modules/experiments.nix`, `modules/default.nix` | the component (S7, S10) | M4.13–M4.15 |
| `checks/module-eval/cases/experiments.nix` | 7 cases (S8) | M4.13–M4.16 |
| `checks/module-eval/default.nix` | `caseFiles` (S10) | M4.9, M4.13 |
| `checks/home-files/default.nix` | two extension directories, the op (S9) | M4.17 |
| `checks/module-eval/cases/together.nix` | `components` += 2, activation entries (S10) | M4.18 |
| `docs/pi-economics.md` | component sections, checks (S12) | M4.20 |

Interfaces M4 publishes: options `programs.piEconomics.cacheLifecycle.{enable, package, settings}` and `programs.piEconomics.experiments.{enable, package, settings}` (W3 re-points the host's readers to `cacheLifecycle.enable`); `piSettings.ops.cacheLifecycle`; registry entries `cache-lifecycle` (`forChildren = true`) and `experiments` (`forChildren = false`); `packages.x86_64-linux.{cache-lifecycle,experiments}`; `experimentsProvider` and `subagentsProvider` in `checks/default.nix` (M5 adds the router's two comparisons with them); the exported consumer aliases `ExperimentsApi` (token-meter, cache-lifecycle) and `SubagentsApi` (experiments); `cases/together.nix` with six components and the activation comparison. M5's log contract reads `packages/{cache-lifecycle,experiments}`.

---

## Tasks

| Task | Delivers | Commit |
|---|---|---|
| M4.0 | read; M3 landed; drift | — |
| M4.1 | cache-lifecycle copy, `packages.cache-lifecycle`, check `cache-lifecycle` | `m4: cache-lifecycle package copied from the host` |
| M4.2 | `typecheck-cache-lifecycle`, D3, D4 | `m4(cache-lifecycle): tsc --strict` |
| M4.3 | experiments copy, `packages.experiments`, check `experiments` | `m4: experiments package copied from the host` |
| M4.4 | `typecheck-experiments` | `m4(experiments): tsc --strict` |
| M4.5 | `iface-subagents-cache-lifecycle` | `m4: cache-lifecycle compared with __subagentsApi_v1` |
| M4.6 | `iface-subagents-experiments`, export | `m4: experiments compared with __subagentsApi_v1` |
| M4.7 | `iface-experiments-token-meter`, alias | `m4: token-meter compared with __piExperimentsApi_v1` |
| M4.8 | `iface-experiments-cache-lifecycle`, alias | `m4: cache-lifecycle compared with __piExperimentsApi_v1` |
| M4.9 | cacheLifecycle: `enable`, `package`, registry entry | `m4(cache-lifecycle): module, package, registry entry` |
| M4.10 | cacheLifecycle `settings` | `m4(cache-lifecycle): settings option` |
| M4.11 | the piSettings op | `m4(cache-lifecycle): cacheWarming idle through piSettings` |
| M4.12 | warning without actorSubagents | `m4(cache-lifecycle): warn without actorSubagents` |
| M4.13 | experiments: `enable`, `package`, registry entry | `m4(experiments): module, package, registry entry` |
| M4.14 | experiments `settings` | `m4(experiments): settings option` |
| M4.15 | warning without actorSubagents | `m4(experiments): warn without actorSubagents` |
| M4.16 | the host's combination (characterisation) | `m4: the host's combination of M2–M4` |
| M4.17 | `home-files` for M4 | `m4: home-files builds the M4 sources` |
| M4.18 | every component together | `m4: cacheLifecycle and experiments together with the rest` |
| M4.19 | citations (§2) | `m4: drop citations of the host's documents` |
| M4.20 | docs | `m4: docs for cacheLifecycle and experiments` |
| M4.21 | gate, Execution Record | `m4: execution record` |

Every task starts at `[ ]`. Order as numbered. Never more than one red check at a time. N below is `module-eval`'s case count at M3's end (M4.0 Step 2; planned 43).

### Task M4.0 — Read, M3 landed, drift

- [ ] **Step 1:** read "Files to read first".
- [ ] **Step 2 (M3 landed):** `git log --oneline | grep -c ' m3: execution record$'` → `1`; `ne checks.x86_64-linux --apply builtins.attrNames --json` → `["actor-subagents","bench","home-files","iface-harness","iface-subagents-bench-probe","leak","leak-selftest","module-eval","npm-deps","pi-settings-migrate","token-meter","typecheck-actor-subagents","typecheck-bench","typecheck-harness","typecheck-token-meter"]`; `nbl module-eval` → `N cases passed` (note N); `grep -c '"tokenMeter" "analysisSkill"\]' checks/module-eval/cases/together.nix` → `1`; `grep -c 'analysisSkill.enable = true;' checks/home-files/default.nix` → `1`; `grep -c '__piExperimentsApi_v1?: { armFor?' packages/token-meter/core/shell.ts` → `1` (M3 D14: still inline). Otherwise stop: M4 builds on M3's end state. Read M3's Execution Record; a deviation touching a file of this plan's File structure is reconciled before M4.1 (adapt S1, S9, S10 to M3's actual text).
- [ ] **Step 3 (drift, §9):**

```sh
(cd ~/projects/nixos/new && git dot diff --stat f6a3c81 -- $ai/extensions/cache-lifecycle $ai/extensions/experiments \
  $ai/extensions/token-meter $ai/skills/pi-token-economics-analysis checks/pi-log-contract $ai/pi-extensions.nix \
  checks/pi-extensions.nix $ai/default.nix pkgs/pi-bench $ai/pi-settings-migrate.nix checks/pi-settings-migrate \
  checks/pi-retry/package.json checks/pi-retry/package-lock.json $ai/pi-actor-subagents.nix \
  $ai/pi-actor-subagents-child-prompt.patch $ai/pi-actor-subagents-spawn-policy.patch \
  $ai/pi-actor-subagents-first-turn.patch checks/pi-actor-subagents; echo "rc=$?")
(cd ~/projects/nixos/new && git dot log -1 --format=%h HEAD)
```

Expected: no file line, `rc=0`. (`$ai/default.nix` is listed for the lines M4 reads; a change outside lines 976–988 and 1111–1114 is not drift for M4: read the diff before stopping.) A listed file under a moved path is drift: stop and report; it is ported first, with its test. Note the host's HEAD for M4.21.

### Task M4.1 — cache-lifecycle: the copy, `packages.cache-lifecycle`, check `cache-lifecycle`

**Files:** create `packages/cache-lifecycle/**`; modify `flake.nix`, `checks/default.nix` (S1, M4.1 lines).

- [ ] **Step 1:** the `cache-lifecycle` line in `flake.nix`'s `packages` and the `cache-lifecycle` check (S1).
- [ ] **Step 2 (RED):** `nb cache-lifecycle` → `Path 'packages/cache-lifecycle/package.nix' does not exist in Git repository` (or `attribute 'cache-lifecycle' missing`).
  - [ ] red seen
- [ ] **Step 3 (GREEN):**

```sh
(cd ~/projects/nixos/new && git dot archive f6a3c81 -- $ai/extensions/cache-lifecycle) | tar -x -C packages --strip-components=5
mv packages/cache-lifecycle/nix/package.nix packages/cache-lifecycle/package.nix
rm -r packages/cache-lifecycle/nix
# S2: the header and the two path lines of packages/cache-lifecycle/package.nix
git add packages/cache-lifecycle flake.nix checks/default.nix
nbl cache-lifecycle
```

Expected: `ℹ tests 78`, `ℹ pass 78`, `ℹ fail 0`.
- [ ] **Step 4 (pure move, one-off evidence):** M3.1 Step 4's commands with `token-meter` → `cache-lifecycle` (tree `diff -r -x nix -x package.nix`, `diff` of the two `package.nix`, built outputs `diff -r`). Expected: `tree identical`; the `package.nix` diff shows S2's lines only; `outputs identical`.
- [ ] **Step 5 (planted):** `sed -i 's/{ ...defaults(), maskOnCold: "tools" }/{ ...defaults(), maskOnCold: "off" }/' packages/cache-lifecycle/test/settings.test.ts; git add -u; nb cache-lifecycle` → `✖ known keys override defaults, unknown keys and wrong types are ignored`, `ℹ fail 1`. Undo with the reverse `sed` (the package is not committed yet), `git add -u`, and repeat Step 4's tree `diff -r` → `tree identical`.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt flake.nix checks/default.nix packages/cache-lifecycle/package.nix`; `nb leak` passes; `ne packages.x86_64-linux --apply builtins.attrNames --json` → `["actor-subagents","bench","cache-lifecycle","token-meter"]`. Commit.

### Task M4.2 — `typecheck-cache-lifecycle`

**Files:** `checks/default.nix` (S1, M4.2 lines), `packages/cache-lifecycle/core/shell.ts`, `packages/cache-lifecycle/test/shell.test.ts` (S3).

- [ ] **Step 1:** add `typecheck-cache-lifecycle` (S1).
- [ ] **Step 2 (RED, natural):** `nb typecheck-cache-lifecycle` → `core/shell.ts:126:34 - error TS2339: Property 'armFor' does not exist on type '{ flag(n: string, d: string, s?: string | undefined): string; }'.`, `test/shell.test.ts:99:92 - error TS2322: …`, `Found 2 errors in 2 files.`
  - [ ] red seen
- [ ] **Step 3 (GREEN):** S3 (two lines). `nbl typecheck-cache-lifecycle` → passes, no `error TS` line.
- [ ] **Step 4 (behaviour kept, §8.1):** `nbl cache-lifecycle` → `ℹ pass 78`, `ℹ fail 0`; `git diff -U0 HEAD -- packages/cache-lifecycle | grep -cE '^[-+][^-+]'` → `4` (S3's two lines, both type-only).
- [ ] **Step 5 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M4.3 — experiments: the copy, `packages.experiments`, check `experiments`

**Files:** create `packages/experiments/**`; modify `flake.nix`, `checks/default.nix` (S1, M4.3 lines).

- [ ] **Step 1:** the `experiments` line in `flake.nix` and the `experiments` check (S1).
- [ ] **Step 2 (RED):** `nb experiments` → `Path 'packages/experiments/package.nix' does not exist in Git repository`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** M4.1 Step 3 with `experiments`. `nbl experiments` → `ℹ tests 47`, `ℹ pass 47`, `ℹ fail 0`.
- [ ] **Step 4 (pure move):** as M4.1 Step 4. Expected: `tree identical`, S2's lines only, `outputs identical`.
- [ ] **Step 5 (planted):** `sed -i 's/mode: "exploit", maxArms: 8, minExplore: 0.2, baseline: "b" }/mode: "exploit", maxArms: 16, minExplore: 0.2, baseline: "b" }/' packages/experiments/test/settings.test.ts` (the expectation, line 41); `nb experiments` → `✖ known keys override defaults, unknown keys and wrong types are ignored`, `ℹ fail 1`; undo as in M4.1 Step 5.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt flake.nix checks/default.nix packages/experiments/package.nix`; `nb leak` passes; `packages` → `["actor-subagents","bench","cache-lifecycle","experiments","token-meter"]`. Commit.

### Task M4.4 — `typecheck-experiments`

**Files:** `checks/default.nix` (S1, M4.4 lines).

- [ ] **Step 1:** add `typecheck-experiments` (S1).
- [ ] **Step 2:** `nbl typecheck-experiments` → passes (green first: the copy is strict-clean).
- [ ] **Step 3 (planted):** `printf '\nexport const planted: number = "x";\n' >> packages/experiments/core/api.ts; git add -u; nb typecheck-experiments` → `core/api.ts:70:14 - error TS2322: Type 'string' is not assignable to type 'number'.`; `git checkout -- packages/experiments/core/api.ts`.
  - [ ] red seen
- [ ] **Step 4 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M4.5 — `iface-subagents-cache-lifecycle`

**Files:** `checks/default.nix` (S1: `subagentsProvider`, the check).

- [ ] **Step 1:** the binding and the check.
- [ ] **Step 2:** `nbl iface-subagents-cache-lifecycle` → passes (green first: `core/api.ts` already exports its copy `SubagentsApiV1`).
- [ ] **Step 3 (planted):** in `packages/cache-lifecycle/core/api.ts`, `export interface SubagentsApiV1 {` followed by a new line `  version: 2;`; `git add -u`; `nb iface-subagents-cache-lifecycle` → `compare.ts:5:14 - error TS2322: Type 'import("…/provider/extensions/actor-subagents/api", …).SubagentsApiV1' is not assignable to type 'import("…/consumer/core/api", …).SubagentsApiV1'.`; `nb typecheck-cache-lifecycle` passes (the comparison catches what the package's own check does not); `git checkout -- packages/cache-lifecycle/core/api.ts`.
  - [ ] red seen
- [ ] **Step 4 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M4.6 — `iface-subagents-experiments`

**Files:** `checks/default.nix` (S1), `packages/experiments/core/shell.ts` (S4 a).

- [ ] **Step 1:** add the check.
- [ ] **Step 2 (RED, natural):** `nb iface-subagents-experiments` → `compare.ts:2:15 - error TS2459: Module '"./consumer/core/shell.ts"' declares 'SubagentsApi' locally, but it is not exported.`
  - [ ] red seen
- [ ] **Step 3 (GREEN):** S4 a (the comment and `export`). `nbl iface-subagents-experiments` → passes.
- [ ] **Step 4 (behaviour kept):** `nbl experiments` → `ℹ pass 47`; `nb typecheck-experiments` passes; `git diff -U0 HEAD -- packages/experiments` shows S4 a's two lines only.
- [ ] **Step 5 (planted):** `list(): Array<{ name: string; sessionId: string; depth: number }>;` in that type → `compare.ts:5:14 - error TS2322: Type 'SubagentsApiV1' is not assignable to type 'SubagentsApi'.`; `nb typecheck-experiments` passes; revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M4.7 — `iface-experiments-token-meter`

**Files:** `checks/default.nix` (S1: `experimentsProvider`, the check), `packages/token-meter/core/shell.ts` (S4 b).

- [ ] **Step 1:** the binding and the check.
- [ ] **Step 2 (RED, natural):** `nb iface-experiments-token-meter` → `compare.ts:2:15 - error TS2305: Module '"./consumer/core/shell.ts"' has no exported member 'ExperimentsApi'.`
  - [ ] red seen
- [ ] **Step 3 (GREEN):** S4 b (three added lines, one changed). `nbl iface-experiments-token-meter` → passes.
- [ ] **Step 4 (behaviour kept):** `nbl token-meter` → `ℹ pass 154`; `nb typecheck-token-meter`, `nb home-files` pass.
- [ ] **Step 5 (planted):** `export type ExperimentsApi = { version: 2; armFor?(s: string): { id?: string } | undefined };` → `compare.ts:5:14 - error TS2322: Type 'ExperimentsApiV1' is not assignable to type 'ExperimentsApi'.`; `nb typecheck-token-meter` passes; revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M4.8 — `iface-experiments-cache-lifecycle`

**Files:** `checks/default.nix` (S1), `packages/cache-lifecycle/core/shell.ts` (S4 c).

- [ ] **Step 1:** add the check.
- [ ] **Step 2 (RED, natural):** `nb iface-experiments-cache-lifecycle` → `compare.ts:2:15 - error TS2305: Module '"./consumer/core/shell.ts"' has no exported member 'ExperimentsApi'.`
  - [ ] red seen
- [ ] **Step 3 (GREEN):** S4 c. `nbl iface-experiments-cache-lifecycle` → passes.
- [ ] **Step 4 (behaviour kept):** `nbl cache-lifecycle` → `ℹ pass 78`; `nb typecheck-cache-lifecycle`, `nb iface-subagents-cache-lifecycle` pass.
- [ ] **Step 5 (planted):** `export type ExperimentsApi = { version: 2; flag(…` → `compare.ts:5:14 - error TS2322: Type 'ExperimentsApiV1' is not assignable to type 'ExperimentsApi'.`; `nb typecheck-cache-lifecycle` passes; revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M4.9 — cacheLifecycle: `enable`, `package`, registry entry

**Files:** create `modules/cache-lifecycle.nix` (S5 without the parts tagged M4.10–M4.12; `enable`'s description ends after `orchestrator-aware warming)`), `checks/module-eval/cases/cache-lifecycle.nix` (S6: the `let` block, `cache-lifecycle-off`, `-defaults`, `-package`, `-files`); modify `modules/default.nix`, `checks/module-eval/default.nix` (S10).

- [ ] **Step 1:** the case file with the four cases, listed in `caseFiles`; `git add` it.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.cacheLifecycle' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the module with `enable`, `package`, the registry entry; its import; `git add modules/cache-lifecycle.nix`. `nbl module-eval` → `N+4 cases passed` (`inert` stays green).
- [ ] **Step 4:** `nb leak` passes.
- [ ] **Step 5 (planted):** `forChildren = false;` → `FAIL cache-lifecycle-defaults: registry entry (.pi/agent): expected { forChildren = true; … }, got { forChildren = false; … }` and `(custom/agent)`; revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt modules/cache-lifecycle.nix modules/default.nix checks/module-eval/default.nix checks/module-eval/cases/cache-lifecycle.nix`. Commit.

### Task M4.10 — cacheLifecycle `settings`

**Files:** `modules/cache-lifecycle.nix` (S5, tagged M4.10), `checks/module-eval/cases/cache-lifecycle.nix` (S6 `cache-lifecycle-settings`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.cacheLifecycle.settings' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the option and the file. `nbl module-eval` → `N+5 cases passed` (`cache-lifecycle-files` stays green: `{}` writes no file).
- [ ] **Step 4 (planted):** `lib.mkIf true {text = builtins.toJSON cfg.settings;}` → `FAIL cache-lifecycle-files: home.file targets (.pi/agent): …` and `(custom/agent)`; revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files. Commit.

### Task M4.11 — `cacheWarming = "idle"` through piSettings

**Files:** `modules/cache-lifecycle.nix` (S5, tagged M4.11: the op, and `enable`'s description from `It also sets` to the end), `checks/module-eval/cases/cache-lifecycle.nix` (S6 `cache-lifecycle-pisettings`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → `FAIL cache-lifecycle-pisettings: ops: expected { cacheLifecycle = [ { op = "set"; order = 1500; path = [ "cacheWarming" ]; value = "idle"; } ]; }, got { }`, `… program with today's other ops: expected "def op1: …", got "def op1: …"`, `… activation entry piSettingsMigrate: does not hold`, `… the description states the standalone caveat: does not hold`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the op block and the description's remaining sentences. `nbl module-eval` → `N+6 cases passed`; `nbl pi-settings-migrate` passes, unchanged (its fixture is the op's reference).
- [ ] **Step 4:** `cache-lifecycle-off` still green (no op while disabled).
- [ ] **Step 5 (planted):** (a) `order = 1000;` → `FAIL cache-lifecycle-pisettings: ops: …order = 1500…, got …order = 1000…` and `… program with today's other ops: …`; revert. (b) in the description, `while piSettings.enable is false` → `while the entry is off` → `FAIL cache-lifecycle-pisettings: the description states the standalone caveat: does not hold`; revert.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 6 (CLEAN):** `fmt` both files. Commit.

### Task M4.12 — cacheLifecycle warns without actorSubagents

**Files:** `modules/cache-lifecycle.nix` (S5, tagged M4.12), `checks/module-eval/cases/cache-lifecycle.nix` (S6 `cache-lifecycle-warning`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → `FAIL cache-lifecycle-warning: new warnings: expected [ "pi-economics: cacheLifecycle without actorSubagents loses warming while a session waits on its children (the warm policy reads __subagentsApi_v1)" ], got [ ]`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the `warnings` line. `nbl module-eval` → `N+7 cases passed` (`cache-lifecycle-defaults` enables actorSubagents: no warning there).
- [ ] **Step 4 (planted):** `lib.optional pe.actorSubagents.enable …` (inverted) → the RED line of Step 2 and `FAIL cache-lifecycle-defaults: warnings (.pi/agent): expected [ ], got [ "pi-economics: cacheLifecycle …" ]` (both dirs); revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files; S5 and S6 now hold in full. Commit.

### Task M4.13 — experiments: `enable`, `package`, registry entry

**Files:** create `modules/experiments.nix` (S7 without the parts tagged M4.14, M4.15), `checks/module-eval/cases/experiments.nix` (S8: the `let` block, `experiments-off`, `-defaults`, `-package`, `-files`); modify `modules/default.nix`, `checks/module-eval/default.nix` (S10).

- [ ] **Step 1:** the case file with the four cases, listed in `caseFiles`; `git add` it.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.experiments' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the module with `enable`, `package`, the registry entry; its import; `git add modules/experiments.nix`. `nbl module-eval` → `N+11 cases passed`.
- [ ] **Step 4:** `nb leak` passes.
- [ ] **Step 5 (planted):** `forChildren = true;` → `FAIL experiments-defaults: registry entry (.pi/agent): expected { forChildren = false; … }, got { forChildren = true; … }` (both dirs); revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt modules/experiments.nix modules/default.nix checks/module-eval/default.nix checks/module-eval/cases/experiments.nix`. Commit.

### Task M4.14 — experiments `settings`

**Files:** `modules/experiments.nix` (S7, tagged M4.14), `checks/module-eval/cases/experiments.nix` (S8 `experiments-settings`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.experiments.settings' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the option and the file. `nbl module-eval` → `N+12 cases passed`.
- [ ] **Step 4 (planted):** `lib.mkIf true {text = builtins.toJSON cfg.settings;}` → `FAIL experiments-files: home.file targets (.pi/agent): …` and `(custom/agent)`; revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files. Commit.

### Task M4.15 — experiments warns without actorSubagents

**Files:** `modules/experiments.nix` (S7, tagged M4.15), `checks/module-eval/cases/experiments.nix` (S8 `experiments-warning`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → `FAIL experiments-warning: new warnings: expected [ "pi-economics: experiments without actorSubagents loses arm inheritance by children (it reads spawn events from __subagentsApi_v1)" ], got [ ]`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the `warnings` line. `nbl module-eval` → `N+13 cases passed`.
- [ ] **Step 4 (planted):** inverted condition → the RED line and `FAIL experiments-defaults: warnings (.pi/agent): …` (both dirs); revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files; S7 now holds in full. Commit.

### Task M4.16 — The host's combination (characterisation)

**Files:** `checks/module-eval/cases/experiments.nix` (S8 `cache-experiments-host-like`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2:** `nbl module-eval` → `N+14 cases passed` (green first: it pins the host's state from W3 on with M2–M4's files).
- [ ] **Step 3 (planted):** cacheLifecycle `forChildren = false;` → `FAIL cache-experiments-host-like: childExtensions: expected [ "/home/u/.pi/agent/extensions/cache-lifecycle" "/home/u/.pi/agent/extensions/token-meter" ], got [ "/home/u/.pi/agent/extensions/token-meter" ]` and `… actor-subagents/settings.json: …` (with M4.9's `cache-lifecycle-defaults` lines); revert.
  - [ ] red seen
- [ ] **Step 4 (CLEAN):** `fmt checks/module-eval/cases/experiments.nix`; S8 now holds in full. Commit.

### Task M4.17 — `home-files` for M4

**Files:** `checks/home-files/default.nix` (S9). An existing check gains lines; its M3 lines stay.

- [ ] **Step 1:** S9.
- [ ] **Step 2:** `nbl home-files` → `== .pi/agent`, `ok .pi/agent`, `== custom/agent`, `ok custom/agent` (green first).
- [ ] **Step 3 (planted):** (a) experiments `path = "${cfg.package}/core";` → `FAIL .pi/agent: /nix/store/…-pi-experiments-0.1.0/core lacks package.json`; revert. (b) the op's `value = "streaming";` → `FAIL .pi/agent: settings.json after the op: {` … `"cacheWarming": "streaming"`; revert.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 4 (CLEAN):** `fmt checks/home-files/default.nix`. Commit.

### Task M4.18 — Every component together

**Files:** `checks/module-eval/cases/together.nix` (S10). An existing case changes: two components join, and one comparison is added (D14); the existing comparisons stay.

- [ ] **Step 1:** S10's two lines.
- [ ] **Step 2:** `nbl module-eval` → `N+14 cases passed`.
- [ ] **Step 3 (planted):** in `modules/cache-lifecycle.nix`'s config `home.activation.planted = lib.mkIf pe.actorSubagents.enable (lib.hm.dag.entryAnywhere "");` → `FAIL components-together: activation entries: expected [ … ], got [ … "planted" … ]`, `1 failure(s)`; revert.
  - [ ] red seen
- [ ] **Step 4 (CLEAN):** `fmt checks/module-eval/cases/together.nix`. Commit.

### Task M4.19 — Citations (§2)

**Files:** 21 `.ts` files of `packages/{cache-lifecycle,experiments}` (S11). Comment text only; test files change only in comments (§2 requires it; no test changes).

- [ ] **Step 1 (before):** `grep -rnE '(§|\bT[0-9]+\.[0-9]+|plan S[0-9]+|\(plan\)|\bD[0-9]+\b|\b[RL][0-9]+\b|\bP[0-9]+\b)' packages/cache-lifecycle packages/experiments --include=*.ts | grep -v 'the type check compares' | wc -l` → `42`.
- [ ] **Step 2:** the edits of S11. The same command → `2` (the test names `"… (T7.0)"` at `cache-lifecycle/test/shell.test.ts:147` and `"P19: …"` at `experiments/test/api.test.ts:25`, kept, D16).
- [ ] **Step 3 (behaviour kept):**

```sh
for f in $(git diff HEAD --name-only -- packages); do
  cmp -s <(git show HEAD:"$f" | strip) <(strip <"$f") || echo "CODE CHANGED $f"
done
git diff -U0 HEAD -- packages | grep -cE '^[-+][^-+]'
```

Expected: no `CODE CHANGED` line; `80` (40 lines changed). `nbl cache-lifecycle` → `ℹ pass 78`; `nbl experiments` → `ℹ pass 47`; `nb typecheck-cache-lifecycle`, `nb typecheck-experiments`, `nb leak`, all four `iface-*` of M4 pass.
- [ ] **Step 4:** commit.

### Task M4.20 — Docs

**Files:** `docs/pi-economics.md` (S12).

- [ ] **Step 1:** S12.
- [ ] **Step 2:** every name is documented:

```sh
for p in cacheLifecycle experiments enable package settings cacheWarming forChildren cache-lifecycle typecheck-cache-lifecycle typecheck-experiments iface-subagents-cache-lifecycle iface-subagents-experiments iface-experiments-token-meter iface-experiments-cache-lifecycle __piExperimentsApi_v1; do
  grep -qF "\`$p\`" docs/pi-economics.md || echo "MISSING $p"
done
```

Expected: no `MISSING`. `nb leak` passes.
- [ ] **Step 3:** commit.

### Task M4.21 — Gate and Execution Record

- [ ] **Step 1 (the gate, both refs):** M1.11 Step 1's loop with `timeout -s KILL 1500` per build. Expected listing per ref: `actor-subagents bench cache-lifecycle experiments home-files iface-experiments-cache-lifecycle iface-experiments-token-meter iface-harness iface-subagents-bench-probe iface-subagents-cache-lifecycle iface-subagents-experiments leak leak-selftest module-eval npm-deps pi-settings-migrate token-meter typecheck-actor-subagents typecheck-bench typecheck-cache-lifecycle typecheck-experiments typecheck-harness typecheck-token-meter`; no `FAILED`; `packages` `["actor-subagents","bench","cache-lifecycle","experiments","token-meter"]`; `homeModules` `["default"]`; formatter `.drv`; `fmt --check $(git ls-files '*.nix')` clean.
- [ ] **Step 2:** `git diff <M3's last commit> -- flake.lock` empty.
- [ ] **Step 3:** drift again (M4.0 Step 3), and `git dot diff --stat <M4.0's host HEAD> HEAD -- <M4.0's paths>`: empty, or ported first.
- [ ] **Step 4:** fill `# Execution Record`: date, commit per task, boxes ticked, red messages seen, the gate's peaks and times, deviations, answers to the open questions.
- [ ] **Step 5:** commit.

---

## Snippets

### S1 — `flake.nix`, `checks/default.nix` (against M3's end state)

`flake.nix`, in `packages.${system}` (M4.1 the first line, M4.3 the second):

```diff
       token-meter = pkgs.callPackage ./packages/token-meter/package.nix {};
+      cache-lifecycle = pkgs.callPackage ./packages/cache-lifecycle/package.nix {};
+      experiments = pkgs.callPackage ./packages/experiments/package.nix {};
     };
```

`checks/default.nix`, in the `let` block after `iface = …;` (M4.5 `subagentsProvider`, M4.7 `experimentsProvider`):

```nix
  # (M4.5, M4.7) The providers of the two globalThis APIs (spec §5.3).
  subagentsProvider = {
    src = actorSubagentsTs;
    file = "extensions/actor-subagents/api.ts";
    type = "SubagentsApiV1";
  };
  experimentsProvider = {
    src = ../packages/experiments;
    file = "core/api.ts";
    type = "ExperimentsApiV1";
  };
```

At the end of the attrset (each check in its task):

```nix
  # (M4.1) The cache-lifecycle tests run when it builds (spec §8.1, "Package tests").
  cache-lifecycle = self.packages.${pkgs.stdenv.hostPlatform.system}.cache-lifecycle;
  # (M4.2)
  typecheck-cache-lifecycle = typecheck.typecheck {
    name = "cache-lifecycle";
    src = ../packages/cache-lifecycle;
  };
  # (M4.3) The experiments tests run when it builds.
  experiments = self.packages.${pkgs.stdenv.hostPlatform.system}.experiments;
  # (M4.4)
  typecheck-experiments = typecheck.typecheck {
    name = "experiments";
    src = ../packages/experiments;
  };
  # (M4.5, M4.6) The copies of __subagentsApi_v1 in cache-lifecycle and experiments (spec §5.3, §8.1).
  iface-subagents-cache-lifecycle = iface.compare {
    name = "subagents-cache-lifecycle";
    provider = subagentsProvider;
    consumer = {
      src = ../packages/cache-lifecycle;
      file = "core/api.ts";
      type = "SubagentsApiV1";
    };
  };
  iface-subagents-experiments = iface.compare {
    name = "subagents-experiments";
    provider = subagentsProvider;
    consumer = {
      src = ../packages/experiments;
      file = "core/shell.ts";
      type = "SubagentsApi";
    };
  };
  # (M4.7, M4.8) The copies of __piExperimentsApi_v1 in token-meter and cache-lifecycle.
  iface-experiments-token-meter = iface.compare {
    name = "experiments-token-meter";
    provider = experimentsProvider;
    consumer = {
      src = ../packages/token-meter;
      file = "core/shell.ts";
      type = "ExperimentsApi";
    };
  };
  iface-experiments-cache-lifecycle = iface.compare {
    name = "experiments-cache-lifecycle";
    provider = experimentsProvider;
    consumer = {
      src = ../packages/cache-lifecycle;
      file = "core/shell.ts";
      type = "ExperimentsApi";
    };
  };
```

(None of the three sources holds a `tsconfig.json`, which the harness requires.)

### S2 — `packages/{cache-lifecycle,experiments}/package.nix`

The host's `nix/package.nix`, moved up one directory (`<c>` = `cache-lifecycle`, `experiments`):

```diff
-# The <c> pi package, tested at build time. Self-contained: this
-# file and ./hm-module.nix are what a standalone flake would export unchanged.
+# The <c> pi package (spec §2), tested at build time: node --test over
+# test/*.test.ts in checkPhase.
@@
-  manifest = lib.importJSON ../package.json;
+  manifest = lib.importJSON ./package.json;
@@
-    src = lib.cleanSource ./..;
+    src = lib.cleanSource ./.;
```

(`installPhase` copies `package.json index.ts core` and a `bin` neither has, so the output is the host's, M4.1/M4.3 Step 4.)

### S3 — `tsc --strict` fixes, `packages/cache-lifecycle` (D3, D4)

```diff
--- a/packages/cache-lifecycle/core/shell.ts   (line 39)
-  const experiments = () => (globalThis as { __piExperimentsApi_v1?: { flag(n: string, d: string, s?: string): string } }).__piExperimentsApi_v1;
+  const experiments = () => (globalThis as { __piExperimentsApi_v1?: { flag(n: string, d: string, s?: string): string; armFor?(s: string): { id?: string } | undefined } }).__piExperimentsApi_v1;
--- a/packages/cache-lifecycle/test/shell.test.ts   (line 99)
-  install(f.pi as never, { settings: { ...defaults(), ...settings }, now: () => clock.now, api: () => api });
+  install(f.pi as never, { settings: { ...defaults(), ...settings }, now: () => clock.now, api: () => api as never });
```

### S4 — Consumer types named for the comparisons (D6)

a) `packages/experiments/core/shell.ts:17-18` (M4.6):

```diff
-/** The part of the actor-subagents API this package reads (own copy: packages do not import each other). */
-type SubagentsApi = {
+/** The part of the actor-subagents API this package reads (own copy: packages do not import each other); the type check compares it with the provider's SubagentsApiV1 (spec §5.3). */
+export type SubagentsApi = {
```

b) `packages/token-meter/core/shell.ts:22-25` (M4.7):

```diff
 };
 
+/** What token-meter reads of the experiments package's globalThis.__piExperimentsApi_v1; the type check compares it with the provider's ExperimentsApiV1 (spec §5.3). */
+export type ExperimentsApi = { armFor?(s: string): { id?: string } | undefined };
+
 /** The experiments package is optional and never imported: its process-global API, or nothing. */
 const experimentArm = (sid: string): string | undefined =>
-  (globalThis as { __piExperimentsApi_v1?: { armFor?(s: string): { id?: string } | undefined } }).__piExperimentsApi_v1?.armFor?.(sid)?.id;
+  (globalThis as { __piExperimentsApi_v1?: ExperimentsApi }).__piExperimentsApi_v1?.armFor?.(sid)?.id;
```

c) `packages/cache-lifecycle/core/shell.ts`, after `Deps` and at the cast (M4.8):

```diff
   api?: () => Pick<SubagentsApiV1, "list" | "subscribe"> | undefined;
 };
 
+/** What cache-lifecycle reads of the experiments package's globalThis.__piExperimentsApi_v1; the type check compares it with the provider's ExperimentsApiV1 (spec §5.3). */
+export type ExperimentsApi = { flag(n: string, d: string, s?: string): string; armFor?(s: string): { id?: string } | undefined };
+
 const MASKS = "cache-lifecycle/masks";
@@
-  const experiments = () => (globalThis as { __piExperimentsApi_v1?: { flag(n: string, d: string, s?: string): string; armFor?(s: string): { id?: string } | undefined } }).__piExperimentsApi_v1;
+  const experiments = () => (globalThis as { __piExperimentsApi_v1?: ExperimentsApi }).__piExperimentsApi_v1;
```

(`spec §5.3` here is this flake's spec, as in the bench probe's comment.)

### S5 — `modules/cache-lifecycle.nix` (state after M4.12)

```nix
# The prompt-cache lifecycle (spec §2, §4): elides stale tool results and
# thinking on the first request after the prompt cache expired, can request a
# 1 h cache TTL for the main session, and decides pi's idle cache warming,
# which pi asks for only while its settings.json says cacheWarming = "idle"
# (the piSettings op below). Loaded into children too: each session has its
# own prompt cache.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.cacheLifecycle;
in {
  options.programs.piEconomics.cacheLifecycle = {
    # (M4.9; from "It also sets" on: M4.11)
    enable = lib.mkEnableOption ''
      the pi cache-lifecycle extension (elides stale context after cache
      expiry, 1 h TTL for the main session, orchestrator-aware warming). It
      also sets cacheWarming = "idle" in pi's settings.json through the
      piSettings activation entry: its warm policy fires only in that mode,
      and pi's default is "streaming". Standalone, pi keeps its default while
      there is no settings.json (the entry edits an existing file only) and
      while piSettings.enable is false'';

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/cache-lifecycle/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/cache-lifecycle/package.nix { }";
      description = "The extension (package.json, index.ts, core/); its tests run when it builds.";
    };

    # (M4.10)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {maskOnCold = "tools";};
      description = ''
        Written to `<agentDir>/cache-lifecycle/settings.json` when non-empty.
        Every key has a default in the package's core/settings.ts
        (`warmPolicy`, `mainCacheTtl`, `maskOnCold`, `protectedTailTokens`,
        `identityShim`), so `{}` writes no file.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # (M4.9) Children too: each session has its own prompt cache, which the
    # elision and (main only) the 1 h TTL manage.
    programs.piEconomics.extensions.cache-lifecycle = {
      path = "${cfg.package}";
      # The source, not the package: probing a build output would be
      # import-from-derivation.
      checkPath = ../packages/cache-lifecycle/index.ts;
      forChildren = true;
      description = "Elides stale tool results and thinking on the first request after the prompt cache expired (outside a protected tail) and can request a 1 h cache TTL for the main session; settings in <agentDir>/cache-lifecycle/settings.json.";
    };

    # (M4.10) Literal text (spec §4): checks read it with builtins.fromJSON.
    home.file."${pe.agentDir}/cache-lifecycle/settings.json" =
      lib.mkIf (cfg.settings != {}) {text = builtins.toJSON cfg.settings;};

    # (M4.11) Replaces the host's positional `idle` flag (spec §5.4). Order
    # 1500: after the removals and the child rule (1000), as today's script
    # edits, so a file that lacks both keys gets today's bytes.
    programs.piEconomics.piSettings.ops.cacheLifecycle = [
      {
        op = "set";
        path = ["cacheWarming"];
        value = "idle";
        order = 1500;
      }
    ];

    # (M4.12) A soft dependency (spec §4.1): shell.ts tolerates a missing API.
    warnings = lib.optional (!pe.actorSubagents.enable) "pi-economics: cacheLifecycle without actorSubagents loses warming while a session waits on its children (the warm policy reads __subagentsApi_v1)";
  };
}
```

M4.9's state: without the parts tagged M4.10–M4.12; `enable`'s text ends `…orchestrator-aware warming)''`.

### S6 — `checks/module-eval/cases/cache-lifecycle.nix` (state after M4.12)

```nix
# Cases for modules/cache-lifecycle.nix (spec §4, §4.1, §5.1, §5.4).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  today = import ../../pi-settings-migrate/today-ops.nix;
  # dir: agentDir; cl: cacheLifecycle options, null = not enabled; more: other
  # programs.piEconomics options.
  eval = dir: cl: more:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (cl != null) {cacheLifecycle = {enable = true;} // cl;}
        // more;
    };
  sorted = lib.sort lib.lessThan;
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  bare = hm.evalBare {};
  warning = "pi-economics: cacheLifecycle without actorSubagents loses warming while a session waits on its children (the warm policy reads __subagentsApi_v1)";
in {
  # (M4.9) Off by default: no registry entry, no file, no op.
  cache-lifecycle-off = let
    c = eval ".pi/agent" null {};
  in
    holds "no registry entry" (!(pe c).extensions ? cache-lifecycle)
    ++ eq "home.file targets" (targets c) (targets bare)
    ++ eq "piSettings ops" (pe c).piSettings.ops {};

  # (M4.9) On, with actorSubagents (no warning): the registry entry, loaded
  # into children, its link following agentDir; the existence probe reads the
  # source, so evaluation builds nothing.
  cache-lifecycle-defaults = lib.concatMap (dir: let
    c = eval dir {} {actorSubagents.enable = true;};
    e = (pe c).extensions.cache-lifecycle;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).cacheLifecycle.package}";
      input = null;
      forChildren = true;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/cache-lifecycle/index.ts" (toString e.checkPath))
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ holds "link target (${dir})" (lib.elem "${dir}/extensions/cache-lifecycle" (targets c))
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M4.9) The package is the flake's, under the name the host's
  # checks/pi-extensions.nix:147 matches in the link target.
  cache-lifecycle-package = let
    cl = (pe (eval ".pi/agent" {} {})).cacheLifecycle;
  in
    eq "drvPath" cl.package.drvPath self.packages.x86_64-linux.cache-lifecycle.drvPath
    ++ eq "name" cl.package.name "pi-cache-lifecycle-0.1.0";

  # (M4.9) Files: the link only; no settings file while settings = {}.
  cache-lifecycle-files = lib.concatMap (dir:
    eq "home.file targets (${dir})" (sorted (targets (eval dir {} {})))
    (sorted (targets bare ++ ["${dir}/extensions/cache-lifecycle"])))
  dirs;

  # (M4.10) settings: written as given, under agentDir (the host's check value,
  # checks/pi-extensions.nix:260).
  cache-lifecycle-settings = lib.concatMap (dir: let
    s = {maskOnCold = "tools";};
    f = fileAt "${dir}/cache-lifecycle/settings.json" (eval dir {settings = s;} {});
  in
    eq "settings file (${dir})" (
      if f == null
      then null
      else builtins.fromJSON f.text
    )
    s)
  dirs;

  # (M4.11) The op is today's (checks/pi-settings-migrate/today-ops.nix): with
  # today's other ops the program is the one pi-settings-migrate compares with
  # the legacy script's `idle` run. Rendered only while piSettings.enable; the
  # option's description states the standalone caveat (spec §4.1).
  cache-lifecycle-pisettings = let
    c = eval ".pi/agent" {} {};
    withToday = eval ".pi/agent" {} {piSettings.ops = today.withoutWarming;};
    todays = hm.eval {programs.piEconomics.piSettings.ops = today.withWarming;};
    disabled = eval ".pi/agent" {} {piSettings.enable = false;};
    description = (hm.options {}).programs.piEconomics.cacheLifecycle.enable.description;
  in
    eq "ops" (pe c).piSettings.ops {inherit (today.withWarming) cacheLifecycle;}
    ++ eq "program with today's other ops" (pe withToday).piSettings.program (pe todays).piSettings.program
    ++ holds "activation entry piSettingsMigrate" (c.home.activation ? piSettingsMigrate)
    ++ holds "no entry while piSettings.enable = false" (!(disabled.home.activation ? piSettingsMigrate))
    ++ holds "the description states the standalone caveat"
    (lib.all (w: lib.hasInfix w description) ["cacheWarming" "settings.json" "piSettings.enable"]);

  # (M4.12) Alone, without actorSubagents: one warning, no assertion.
  cache-lifecycle-warning = let
    c = eval ".pi/agent" {} {};
  in
    eq "new warnings" (lib.subtractLists bare.warnings c.warnings) [warning]
    ++ eq "failed assertions" (failed "" c) [];
}
```

### S7 — `modules/experiments.nix` (state after M4.15)

```nix
# The online experiment (spec §2, §4): one fractional-factorial arm per main
# session (explore/exploit assignment), recorded in
# <agentDir>/experiments/assignments.jsonl and published as
# globalThis.__piExperimentsApi_v1, whose factor flags cache-lifecycle,
# token-meter, the task router and infinite-context read. Main session only:
# children inherit their parent's arm from actor-subagents' spawn events. No
# timer: the posterior update and the kill switch (token-meter's
# `meter-report --arms --posterior`) run on demand.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.experiments;
in {
  options.programs.piEconomics.experiments = {
    enable = lib.mkEnableOption "the pi experiments extension (one fractional-factorial arm per main session; explore/exploit assignment, spawn inheritance for children)";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/experiments/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/experiments/package.nix { }";
      description = "The extension (package.json, index.ts, core/); its tests run when it builds.";
    };

    # (M4.14)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {
        mode = "explore";
        minExplore = 0.15;
      };
      description = ''
        Written to `<agentDir>/experiments/settings.json` when non-empty.
        Every key has a default in the package's core/settings.ts (`mode`,
        `factors`, `maxArms`, `minExplore`, `baseline`, `guards`,
        `correctionRegex`), so `{}` writes no file.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # (M4.13) Main session only: one arm per main session; children inherit
    # the parent's arm instead of drawing their own.
    programs.piEconomics.extensions.experiments = {
      path = "${cfg.package}";
      checkPath = ../packages/experiments/index.ts;
      forChildren = false;
      description = "One fractional-factorial arm per main session (explore/exploit assignment); children inherit the parent's arm, other extensions read the factor flags.";
    };

    # (M4.14) Literal text (spec §4).
    home.file."${pe.agentDir}/experiments/settings.json" =
      lib.mkIf (cfg.settings != {}) {text = builtins.toJSON cfg.settings;};

    # (M4.15) A soft dependency (spec §4.1): shell.ts tolerates a missing API.
    warnings = lib.optional (!pe.actorSubagents.enable) "pi-economics: experiments without actorSubagents loses arm inheritance by children (it reads spawn events from __subagentsApi_v1)";
  };
}
```

M4.13's state: without the parts tagged M4.14, M4.15.

### S8 — `checks/module-eval/cases/experiments.nix` (state after M4.16)

```nix
# Cases for modules/experiments.nix (spec §4, §4.1, §5.1), and the host's
# combination of M2–M4's components.
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; ex: experiments options, null = not enabled; more: other
  # programs.piEconomics options.
  eval = dir: ex: more:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (ex != null) {experiments = {enable = true;} // ex;}
        // more;
    };
  sorted = lib.sort lib.lessThan;
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  units = cfg: lib.attrNames cfg.systemd.user.services ++ lib.attrNames cfg.systemd.user.timers;
  bare = hm.evalBare {};
  warning = "pi-economics: experiments without actorSubagents loses arm inheritance by children (it reads spawn events from __subagentsApi_v1)";
in {
  # (M4.13) Off by default: no registry entry, no file.
  experiments-off = let
    c = eval ".pi/agent" null {};
  in
    holds "no registry entry" (!(pe c).extensions ? experiments)
    ++ eq "home.file targets" (targets c) (targets bare);

  # (M4.13) On, with actorSubagents (no warning): the registry entry, main
  # session only, its link following agentDir; no timer (the host's
  # checks/pi-extensions.nix:264-269).
  experiments-defaults = lib.concatMap (dir: let
    c = eval dir {} {actorSubagents.enable = true;};
    e = (pe c).extensions.experiments;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).experiments.package}";
      input = null;
      forChildren = false;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/experiments/index.ts" (toString e.checkPath))
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ holds "link target (${dir})" (lib.elem "${dir}/extensions/experiments" (targets c))
    ++ eq "systemd user units (${dir})" (units c) (units bare)
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M4.13) The package is the flake's, under the name the host's
  # checks/pi-extensions.nix:150 matches in the link target.
  experiments-package = let
    x = (pe (eval ".pi/agent" {} {})).experiments;
  in
    eq "drvPath" x.package.drvPath self.packages.x86_64-linux.experiments.drvPath
    ++ eq "name" x.package.name "pi-experiments-0.1.0";

  # (M4.13) Files: the link only; no settings file while settings = {}.
  experiments-files = lib.concatMap (dir:
    eq "home.file targets (${dir})" (sorted (targets (eval dir {} {})))
    (sorted (targets bare ++ ["${dir}/extensions/experiments"])))
  dirs;

  # (M4.14) settings: written as given (the host's check value,
  # checks/pi-extensions.nix:262).
  experiments-settings = lib.concatMap (dir: let
    s = {minExplore = 0.15;};
    f = fileAt "${dir}/experiments/settings.json" (eval dir {settings = s;} {});
  in
    eq "settings file (${dir})" (
      if f == null
      then null
      else builtins.fromJSON f.text
    )
    s)
  dirs;

  # (M4.15) Alone, without actorSubagents: one warning, no assertion.
  experiments-warning = let
    c = eval ".pi/agent" {} {};
  in
    eq "new warnings" (lib.subtractLists bare.warnings c.warnings) [warning]
    ++ eq "failed assertions" (failed "" c) [];

  # (M4.16) The host's combination from W3 on (spec §9.1): M2–M4's extension
  # components, piSettings off (the host's own script runs until W6). Children
  # load cache-lifecycle and token-meter, not experiments: today's file
  # (host pi-extensions.nix:389-390) for that registry.
  cache-experiments-host-like = let
    c = hm.eval {
      programs.piEconomics = {
        actorSubagents.enable = true;
        tokenMeter.enable = true;
        cacheLifecycle.enable = true;
        experiments.enable = true;
        piSettings.enable = false;
      };
    };
    kids = ["/home/u/.pi/agent/extensions/cache-lifecycle" "/home/u/.pi/agent/extensions/token-meter"];
  in
    eq "childExtensions" (pe c).childExtensions kids
    ++ eq "actor-subagents/settings.json" (fileAt ".pi/agent/actor-subagents/settings.json" c).text (builtins.toJSON {childExtensions = kids;})
    ++ eq "links" (sorted (lib.filter (lib.hasPrefix ".pi/agent/extensions/") (targets c)))
    (map (n: ".pi/agent/extensions/${n}") ["actor-subagents" "cache-lifecycle" "experiments" "token-meter"])
    ++ holds "no piSettingsMigrate entry" (!(c.home.activation ? piSettingsMigrate))
    ++ eq "failed assertions" (failed "" c) []
    ++ eq "warnings" c.warnings bare.warnings;
}
```

### S9 — `checks/home-files/default.nix` (M4.17, against M3's S8)

```diff
         agentDir = dir;
         tokenMeter.enable = true;
         analysisSkill.enable = true;
+        cacheLifecycle.enable = true;
+        experiments.enable = true;
       };
@@
       ''
     }
+    # cacheLifecycle and experiments: the extensions pi loads.
+    for e in ${pe.extensions.cache-lifecycle.path} ${pe.extensions.experiments.path}; do
+      for f in package.json index.ts core/shell.ts; do
+        [ -f "$e/$f" ] || { echo "FAIL ${dir}: $e lacks $f" >&2; exit 1; }
+      done
+    done
+    # cacheLifecycle's op, through the script the activation entry runs.
+    printf '{"theme":"dark"}\n' >"$TMPDIR/settings.json"
+    ${lib.getExe pe.piSettings.package} "$TMPDIR/settings.json" 2>/dev/null
+    jq -e '. == {theme: "dark", cacheWarming: "idle"}' "$TMPDIR/settings.json" >/dev/null || { echo "FAIL ${dir}: settings.json after the op: $(cat "$TMPDIR/settings.json")" >&2; exit 1; }
     echo "ok ${dir}"
   '';
 in
-  pkgs.runCommand "home-files" {nativeBuildInputs = [pkgs.gnugrep pkgs.diffutils];} ''
+  pkgs.runCommand "home-files" {nativeBuildInputs = [pkgs.gnugrep pkgs.diffutils pkgs.jq];} ''
```

### S10 — `modules/default.nix`, `checks/module-eval/default.nix`, `cases/together.nix`

```diff
     ./token-meter.nix
     ./analysis-skill.nix
+    ./cache-lifecycle.nix
+    ./experiments.nix
   ];
```

(M4.9 the first line, M4.13 the second.)

```diff
     ./cases/token-meter.nix
     ./cases/analysis-skill.nix
+    ./cases/cache-lifecycle.nix
+    ./cases/experiments.nix
     ./cases/together.nix
```

(M4.9, M4.13.)

```diff
-  components = ["bench" "actorSubagents" "tokenMeter" "analysisSkill"];
+  components = ["bench" "actorSubagents" "tokenMeter" "analysisSkill" "cacheLifecycle" "experiments"];
@@
     ++ eq "session variables" all.home.sessionVariables (lib.foldl' (acc: c: acc // (with' [c]).home.sessionVariables) {} components)
+    ++ eq "activation entries" (set (lib.attrNames all.home.activation)) (union (cfg: lib.attrNames cfg.home.activation))
     ++ eq "failed assertions" (failed "" all) []
```

(M4.18.)

### S11 — Citations (§2), `packages/{cache-lifecycle,experiments}/`

Each pair is one line; nothing else in the files changes (M4.19 Step 3 proves it).

```diff
+++ b/packages/cache-lifecycle/core/settings.ts
-  /** native: pi's own idle-warming rule; orchestrator-aware: keep a main with running children and a child awaiting a reply warm (§5.3). */
+  /** native: pi's own idle-warming rule; orchestrator-aware: keep a main with running children and a child awaiting a reply warm. */
-  /** Keep message identity stable across projections so pi 1.0.0 cache warming survives custom messages (T7.0). */
+  /** Keep message identity stable across projections so pi 1.0.0 cache warming survives custom messages. */
+++ b/packages/cache-lifecycle/core/shell.ts
-  /** pi's agent dir; when set, a `context_peek` call after masking is logged to <agentDir>/guards/events.jsonl (experiments guard, spec §5.6.3). */
+  /** pi's agent dir; when set, a `context_peek` call after masking is logged to <agentDir>/guards/events.jsonl (experiments guard). */
-  // The one seam for the factors the experiments package switches (spec §5.6): its arm's value, else the own setting.
+  // The one seam for the factors the experiments package switches: its arm's value, else the own setting.
-  // D2: actor-subagents' list() carries a `main` record with the main session id
+  // actor-subagents' list() carries a `main` record with the main session id
-  // Warming (§5.3). Idle time counts from the last real message; a warm ping has no message_end.
+  // Warming. Idle time counts from the last real message; a warm ping has no message_end.
-    const children = agents.filter((x) => x.name !== "main"); // D2
+    const children = agents.filter((x) => x.name !== "main"); // main is not a child (above)
+++ b/packages/cache-lifecycle/core/warm.ts
-// Idle prompt-cache warming policy (spec §5.3): pure decision table.
+// Idle prompt-cache warming policy: pure decision table.
+++ b/packages/cache-lifecycle/index.ts
-// cache-lifecycle: prompt-cache aware elision and TTL (spec §5.3).
+// cache-lifecycle: prompt-cache aware elision and TTL.
+++ b/packages/cache-lifecycle/test/flags.test.ts
-// T8.5 (R10): warmPolicy / mainCacheTtl / maskOnCold read through `__piExperimentsApi_v1.flag(name, own, sessionId)`.
+// warmPolicy / mainCacheTtl / maskOnCold read through `__piExperimentsApi_v1.flag(name, own, sessionId)`.
+++ b/packages/cache-lifecycle/test/guards.test.ts
-// T8.7 guard: `context_peek` use after masking is logged as `peek-after-mask` to <agentDir>/guards/events.jsonl
+// Guard: `context_peek` use after masking is logged as `peek-after-mask` to <agentDir>/guards/events.jsonl
+++ b/packages/cache-lifecycle/test/identity.test.ts
-// Identity shim (T7.0): pi 1.0.0's CacheWarmer stops a warm run when any message
+// Identity shim: pi 1.0.0's CacheWarmer stops a warm run when any message
+++ b/packages/cache-lifecycle/test/portable.test.ts
-// Portability contract (spec §6, plan S4): the package can be copied into its
+// Portability contract: the package can be copied into its
+++ b/packages/cache-lifecycle/test/shell.test.ts
-// --- masking on the first request after cache expiry (T7.5) ---
+// --- masking on the first request after cache expiry ---
-// --- 1 h TTL for the main session (T7.6) ---
+// --- 1 h TTL for the main session ---
-// --- warming decision (T7.2) ---
+// --- warming decision ---
-// D2 (2026-10-03 live check, L6): actor-subagents' list() carries a `main`
+// Live check of 2026-10-03: actor-subagents' list() carries a `main`
+++ b/packages/experiments/core/api.ts
-// The process-global experiments API (plan S11): other extensions reach it only through
+// The process-global experiments API: other extensions reach it only through
+++ b/packages/experiments/core/assign.ts
-// Arm assignment per plan S11 (properties P-off, P-balance, P-floor).
+// Arm assignment (properties P-off, P-balance, P-floor).
+++ b/packages/experiments/core/design.ts
-// Fractional-factorial arm design (spec §5.6.2, plan S11, property P-design).
+// Fractional-factorial arm design (property P-design).
-//   (T8.9, design v2): E = ABC, F = BCD, defining relation I = ABCE = BCDF = ADEF,
+//   (design v2): E = ABC, F = BCD, defining relation I = ABCE = BCDF = ADEF,
+++ b/packages/experiments/core/settings.ts
-  /** Arm selection mode; "off" always returns the baseline arm (spec §5.6.4). */
+  /** Arm selection mode; "off" always returns the baseline arm. */
-  /** Two-level factors to design the arms from (spec §5.6.2). */
+  /** Two-level factors to design the arms from. */
-  /** Kill switch (spec §5.6.3), evaluated by `meter-report --arms --posterior`, which runs on demand only (no timer): an arm with ≥ minSessions sessions whose verdict acceptance is below the baseline's by more than threshold (a fraction) is disabled. */
+  /** Kill switch, evaluated by `meter-report --arms --posterior`, which runs on demand only (no timer): an arm with ≥ minSessions sessions whose verdict acceptance is below the baseline's by more than threshold (a fraction) is disabled. */
-  /** Source of the case-insensitive RegExp that marks a user message right after an assistant turn as a correction (guard, spec §5.6.3). */
+  /** Source of the case-insensitive RegExp that marks a user message right after an assistant turn as a correction (guard). */
-/** The six online factors of spec §5.6.2 (designs v2 and v3: 2^(6-2), 16 arms, the arm ids are the same in both; v1 had the first five); values[0] is today's behaviour, so the all-low arm is the baseline. */
+/** The six online factors (designs v2 and v3: 2^(6-2), 16 arms, the arm ids are the same in both; v1 had the first five); values[0] is today's behaviour, so the all-low arm is the baseline. */
+++ b/packages/experiments/core/shell.ts
- * `design` is absent on v1 lines (five factors, 5-char arm ids); v2 = six factors, 2^(6-2); v3 (T8.10) = the same factors and arms as v2,
+ * `design` is absent on v1 lines (five factors, 5-char arm ids); v2 = six factors, 2^(6-2); v3 = the same factors and arms as v2,
-  // Guards (spec §5.6.3, T8.7): corrections and the end-of-session rating go to <agentDir>/guards/events.jsonl; only the fact, never text.
+  // Guards: corrections and the end-of-session rating go to <agentDir>/guards/events.jsonl; only the fact, never text.
+++ b/packages/experiments/index.ts
-// experiments: one fractional-factorial arm per main session (spec §5.6):
+// experiments: one fractional-factorial arm per main session:
+++ b/packages/experiments/test/api.test.ts
-// The process-global API (plan S11): armFor / flag / inherit. P19: flag honours child inheritance.
+// The process-global API: armFor / flag / inherit; flag honours child inheritance.
-// T13.7: a process restart drops the in-memory inheritance of a resumed child (its spawn
+// A process restart drops the in-memory inheritance of a resumed child (its spawn
+++ b/packages/experiments/test/assign.test.ts
-// P-off, P-balance, P-floor (plan) for assign(). Seeded RNG throughout.
+// P-off, P-balance, P-floor for assign(). Seeded RNG throughout.
+++ b/packages/experiments/test/design.test.ts
-// P-design (plan): k factors, 2-level, half fraction with generator
+// P-design: k factors, 2-level, half fraction with generator
-// v2 (T8.9): six factors in 16 arms = the 2^(6-2) fraction, generators E = ABC, F = BCD (defining relation
+// v2: six factors in 16 arms = the 2^(6-2) fraction, generators E = ABC, F = BCD (defining relation
+++ b/packages/experiments/test/guards.test.ts
-// T8.7 guards: user corrections (regex setting) and the /rate command, logged to <agentDir>/guards/events.jsonl
+// Guards: user corrections (regex setting) and the /rate command, logged to <agentDir>/guards/events.jsonl
+++ b/packages/experiments/test/portable.test.ts
-// Portability contract (spec §6, plan S4): the package can be copied into its
+// Portability contract: the package can be copied into its
+++ b/packages/experiments/test/shell.test.ts
-// Session lifecycle (T8.4, R10): assignment on session_start, assignments.jsonl, spawn → inherit.
+// Session lifecycle: assignment on session_start, assignments.jsonl, spawn → inherit.
-// T13.7: the restart drops the in-memory inheritance of a RESUMED child (its spawn event
+// The restart drops the in-memory inheritance of a RESUMED child (its spawn event
-// T8.9: the assignment line names its design. Lines without `design` are v1 (the five-factor 2^(5-1) design, 5-char arm ids).
+// The assignment line names its design. Lines without `design` are v1 (the five-factor 2^(5-1) design, 5-char arm ids).
-// T8.10: v3 = v2's factors and arms with a new meaning of foldHint = cache-aware: resumed v2 sessions keep "v2", v2 rows do not balance v3.
+// v3 = v2's factors and arms with a new meaning of foldHint = cache-aware: resumed v2 sessions keep "v2", v2 rows do not balance v3.
```

Unchanged on purpose (D16): the test names `"identityShim is on by default: … (T7.0)"` (`cache-lifecycle/test/shell.test.ts:147`) and `"P19: …"` (`experiments/test/api.test.ts:25`); the property labels (`P-off`, `P-balance`, `P-floor`, `P-design`, `P-tail`, `P-idem`, `P-stable`) in comments and test names; S4's new comments, which cite this flake's spec.

### S12 — `docs/pi-economics.md`

Under `## Components`, after the `analysisSkill` section:

```markdown
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
`cacheWarming = "idle"`, and pi's default is `streaming`. The op edits an
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
```

Rows for the checks table:

```markdown
| `cache-lifecycle`, `experiments` | each package's own tests (`node --test`), run when it builds |
| `typecheck-cache-lifecycle`, `typecheck-experiments` | `tsc --strict` over each package |
| `iface-subagents-cache-lifecycle`, `iface-subagents-experiments` | their copies of `__subagentsApi_v1` are satisfied by the provider's `SubagentsApiV1` |
| `iface-experiments-token-meter`, `iface-experiments-cache-lifecycle` | their copies of `__piExperimentsApi_v1` are satisfied by the provider's `ExperimentsApiV1` |
```

The `module-eval` row gains "soft-dependency warnings, the host's combination"; the `home-files` row gains "the cache-lifecycle and experiments directories, cacheLifecycle's op through the activation's script".

---

## Open questions

Each with the planner's proposed decision; the plan follows the proposal.

- **Q1 (D10).** The two warnings fire whenever `actorSubagents` is off, with no way to silence them; the spec asks for a warning and names no switch. Proposal: accept; the host enables `actorSubagents` (W0), so it never sees them.
- **Q2 (D4).** `tsc --strict` forces one type-only edit in a copied test (`as never` on a partial fake, `cache-lifecycle/test/shell.test.ts:99`). §8.3 lets tests change only for neutral names; §8.1 allows forced edits that keep behaviour. Proposal: accept the cast (the file's own idiom).
- **Q3 (D16).** Citations: drop `§`, `spec`, `plan S…`, `(plan)`, `T…`, `D2`, `R10`, `P19`, `L6` from comments; keep test names and property labels. Proposal: accept; P scrubs test names with the router's defaults if wanted.
- **Q4 (D7).** experiments' registry description loses "spec §5.6" (a host citation rendered nowhere). Proposal: accept.
- **Q5 (D14).** `components-together` gains an activation comparison (an existing case extended). Proposal: accept.
- **Q6 (D18).** The brief named "cache-lifecycle and task-router against experiments"; §8.1 puts token-meter and cache-lifecycle against experiments in M4 and the router in M5. Proposal: follow §8.1.
- **Q7.** M4 edits `packages/token-meter/core/shell.ts` (M3's file, D14 of M3) and extends M3's `home-files`. Proposal: M4 starts after M3's Execution Record; if M3 deviates in `home-files`, `together.nix`, `caseFiles` or `checks/default.nix`, the implementer adapts S1, S9, S10 to M3's text, and N is M3's final count.
- **Q8 (D9).** `cacheLifecycle` contributes its op even while `piSettings.enable = false` (only the entry is withheld, §5.4). Proposal: accept; the host's script reads `cacheLifecycle.enable` until W6.

# Execution Record

Executed 2026-10-25 (agent impl-m4), on the plan at `ed4a9eb` and M3 as landed (`c0d97a1`, `module-eval` 43 cases). Q1–Q8 accepted as proposed (Q6: §8.1's pairs). Every task done; builds under `ulimit -v 20971520`, `--option eval-cache false`, `timeout -s KILL`; the host read only through `git dot`. Commits are unsigned (no gpg in the sandbox) and made with pathspecs; plan-M6 commits by another agent sit between M4's in the history.

**The shared pi 1.2.0 resync is pending** (group M6.0 of the M6 plan does it). M4's sources stay on host `f6a3c81`; `patches/pi-actor-subagents/` is still the `f6a3c81` copy, so the two `iface-subagents-*` checks compare against that provider, not `4c714f0`'s (its spawn-policy patch changed).

## M4.0, drift

Host HEAD at the start `f9776f4` (router redesign commits after `4c714f0`, only in `extensions/task-router`); at the end `f1b140e`. Drift `f6a3c81..4c714f0` over the M4 paths (`extensions/cache-lifecycle`, `extensions/experiments`, `pi-extensions.nix`, `default.nix`, `flake.nix`'s `pi-cache-lifecycle`/`pi-experiments` lines, `checks/pi-extensions.nix` lines 56–67, 80–86, 146–150, 228–272): none. The one comment-only drift is `checks/pi-extensions.nix:114-115` (the `infinite-context` PATCHED comment, M6's), outside M4's lines. Elsewhere only the actor-subagents patches and `checks/pi-actor-subagents`, `checks/pi-retry`, `flake.nix` (inputs) moved: the resync. So M4 copied from `f6a3c81`, as planned. At the end: `f9776f4..f1b140e` over the same paths: empty.

## Commits

| Task | Commit | Red seen | Deviation |
|---|---|---|---|
| M4.0 | — | — | none |
| M4.1 | `d4171ef` | `Path 'packages/cache-lifecycle/package.nix' does not exist`; plant `maskOnCold: "off"` → `✖ known keys override defaults…`, `ℹ fail 1` | none; `tree identical`, S2's lines only, `outputs identical`, 78 tests |
| M4.2 | `4a6fdb2` | TS2339 at `core/shell.ts:126:34` and TS2322 at `test/shell.test.ts:99:92`, `Found 2 errors in 2 files.` | none; 4 changed lines, `pass 78` |
| M4.3 | `1307489` | `Path 'packages/experiments/package.nix' does not exist` | the copy was made first, the directory moved aside for the RED, then restored; plant `maxArms: 16` → `✖ known keys…`; 47 tests, outputs identical |
| M4.4 | `8dce3b3` | green first; plant → `core/api.ts:70:14 - error TS2322` | none |
| M4.5 | `7d46650` | green first; plant `version: 2;` → `compare.ts:5:14 - error TS2322` (typecheck stays green) | none |
| M4.6 | `e3a0c93` | `compare.ts:2:15 - error TS2459`; plant `depth: number` → `compare.ts:5:14 - error TS2322` | none |
| M4.7 | `151e6cc` | `compare.ts:2:15 - error TS2305`; plant `version: 2` → TS2322 | none; `token-meter` 154, `home-files`, typecheck green |
| M4.8 | `818205f` | TS2305; plant → TS2322 | none |
| M4.9 | `255f8ea` | `The option 'programs.piEconomics.cacheLifecycle' does not exist`; plant `forChildren = false` → `FAIL cache-lifecycle-defaults` ×2 | 47 cases |
| M4.10 | `bc5b320` | `…cacheLifecycle.settings' does not exist`; plant `mkIf true` → `FAIL cache-lifecycle-files` ×2 | 48 |
| M4.11 | `2039aa0` | the four `FAIL cache-lifecycle-pisettings` lines of the plan | plants (a) `order = 1000` and (b) the description in one build: three FAIL lines (ops, program, description); 49 |
| M4.12 | `230a522` | `FAIL cache-lifecycle-warning: new warnings: expected [ … ], got [ ]`; inverted plant → `FAIL cache-lifecycle-defaults: warnings` ×2 + the warning case | 50 |
| M4.13 | `0453fd0` | option missing; plant `forChildren = true` → `FAIL experiments-defaults` ×2 | 54 |
| M4.14 | `c3e6420` | option missing; plant → `FAIL experiments-files` ×2 | 55 |
| M4.15 | `8718cda` | `FAIL experiments-warning`; inverted plant → `FAIL experiments-defaults: warnings` ×2 + the case | 56 |
| M4.16 | `4d5d454` | green first (57 cases); plant `forChildren = false` → `FAIL cache-experiments-host-like: childExtensions`, `…actor-subagents/settings.json`, and M4.9's two | none |
| M4.17 | `776e9f5` | green first; plants (a) `${cfg.package}/core` → `FAIL .pi/agent: …-pi-experiments-0.1.0/core lacks package.json`; (b) `value = "streaming"` → `FAIL .pi/agent: settings.json after the op: …"cacheWarming": "streaming"` | none |
| M4.18 | `dcf6611` | green first; plant `home.activation.planted` → `FAIL components-together: activation entries`, `1 failure(s) in 57 cases` | none |
| M4.19 | `d9c66d1` | 42 lines before; 3 after (the two kept test names and S4's own `(spec §5.3)` comment) | applied with a perl script over comment lines only; it first stripped S4's two new `(spec §5.3)` citations, restored; 80 changed lines in 21 files, no `CODE CHANGED`; the suites `pass 78`/`pass 47` |
| M4.20 | `cc089c8` | — | S12's `cacheWarming = "idle"` fails the plan's own `MISSING cacheWarming` grep (the backticked name is not alone): reworded to `` `cacheWarming` is `"idle"` ``; no `MISSING` |
| M4.21 | this record's commit | — | see below |

## Gate (M4.21), 2026-10-25

`~/.cache/pi/m2gate.sh` (log `~/.cache/pi/m4gate.log`): per ref a listing, each check's output deleted before its build, one capped build each. Listing under both refs: the 23 checks of M4.21 Step 1, no `FAILED`; `packages` `["actor-subagents","bench","cache-lifecycle","experiments","token-meter"]`; `homeModules` `["default"]`; formatter `.drv` evaluates; `alejandra --check` over 35 files clean. `flake.lock` unchanged since `c0d97a1`. Peaks: `module-eval` (57 cases) 1.64 GiB / 34 s (`git+file://`), 1.87 GiB / 33 s (`path:`); `typecheck-*` and `iface-*` 0.25 GiB, 3–8 s; `home-files` 0.43 GiB, 3–5 s; `pi-settings-migrate` 0.56 GiB.

Outputs that `home-files` references cannot be deleted by the gate's delete step, so `cache-lifecycle`, `experiments`, `token-meter` and `actor-subagents` were short no-op builds there; a separate `nix build --rebuild` of each ran the suites: `ℹ pass 78`, `ℹ pass 47`, `ℹ pass 154`, `ℹ pass 297`, all `ℹ fail 0`.

Open questions: Q1–Q8 accepted. Follow-ups, not done: the pi 1.2.0 resync (M6.0); W3 re-points the host's readers (`cacheLifecycle.enable`).
