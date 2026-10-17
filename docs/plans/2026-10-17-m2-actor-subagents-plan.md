# M2 — `actorSubagents`: TDD plan

Date: 2026-10-18 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 · Milestone: M2 (§9) · Base: this repository at the end of M1 (plan `docs/plans/2026-10-17-m1-bench-plan.md`, `31f2a7e`; M1 was executing while this plan was written, HEAD `6a0fd4b` = M1.1–M1.8)

Source commit: host dotfiles `f6a3c81`, `projects/nixos/new/modules/home-manager/features/ai/pi-actor-subagents{.nix,-child-prompt.patch,-spawn-policy.patch,-first-turn.patch}`, `checks/pi-actor-subagents/default.nix`, and `pi-extensions.nix` lines 35–41, 90–100, 232–238, 366–390. Drift checked while planning: `git dot diff --stat f6a3c81 HEAD -- <those paths> pkgs/pi-bench checks/pi-extensions.nix …` is empty at host HEAD `df23ba2` (2026-10-17); the host's lock pins `pi-actor-subagents` at `707496e` at both commits. Task M2.0 checks again.

## Motivation

§9 row M2: `actorSubagents` (the upstream extension with 3 patches, `passthru.spawnPolicyApi`) and the registry's `childExtensions` rendering. The host's patched pi-actor-subagents moves into the flake as a package built from a new `flake = false` input; its upstream suite runs as before (§8.1). A Home Manager component `programs.piEconomics.actorSubagents` registers the extension (§5.1: link, existence assertion on the unpatched source, `forChildren = false`) and writes `<agentDir>/actor-subagents/settings.json` = `lib.recursiveUpdate settings { childExtensions = …; }` (§4), the one file that names the children's extensions. `childExtensions` are the link paths of the registry's `forChildren` entries, sorted by name (§5.1). §8.1 starts two things here: the type check of the provider's package, and the first interface comparison, the bench probe's copy of `__subagentsApi_v1` against the provider's `SubagentsApiV1`, read from the `applyPatches` output (§5.3). The move is pure (§1): with `settings = {}` the file is today's, and the package is the host's derivation.

## Approach

- `flake.nix`: input `pi-actor-subagents` (`flake = false`), locked with `--override-input` at the host's revision `707496e` (as M0 D1 did); `packages.x86_64-linux.actor-subagents`; `homeModules.default` becomes `{ imports = [./modules]; programs.piEconomics.actorSubagents.src = lib.mkDefault pi-actor-subagents; }`, the one way the input reaches the module (D3).
- `patches/pi-actor-subagents/` holds the host's three patch files under their host names, byte for byte; `packages/actor-subagents/package.nix` = `(applyPatches {name = "pi-actor-subagents-patched"; …}).overrideAttrs` adding `passthru.spawnPolicyApi = 1`. Prototyped: its drvPath equals the host's expression evaluated on the flake's nixpkgs (`/nix/store/1wn44qbf…-pi-actor-subagents-patched.drv`).
- Checks:
  - `actor-subagents`: the host's `checks/pi-actor-subagents/default.nix`, copied verbatim to `checks/actor-subagents/default.nix` (297 upstream and patch tests, plus its greps).
  - `typecheck-actor-subagents`: M0's runner over the patched source without upstream's `tsconfig.json` (tsc refuses named files next to one, TS5112). Green on first build: upstream is strict-typed already.
  - `iface-harness` and `iface-subagents-bench-probe`: a small harness `checks/iface` that copies provider and consumer next to a generated `compare.ts` (`export const consumer: Consumer = provider;`) and runs M0's type-check runner; a self-test with fixtures. The probe's inline type becomes the exported alias `SubagentsApi` (type-only edit, §8.1).
- `modules/common.nix` gains the read-only internal option `childExtensions` (the registry's rendering, §5.1); `modules/actor-subagents.nix` declares `enable`, `src` (internal), `package`, `settings`, adds the registry entry and writes the settings file (§4 row).
- Module-evaluation cases in `checks/module-eval/cases/actor-subagents.nix` (8) and `cases/together.nix` (1, every component together, §8.1).
- §2: the host comment of `pi-actor-subagents.nix` is rewritten into `package.nix` without the host's plan and note citations; the copied check loses one citation (`defect D3`) in a task of its own. The patches stay byte-identical (D2), with one test name that says "S6" (open question Q6).

## Decisions

| # | Decision | Rationale | Rejected alternative, and why |
|---|---|---|---|
| D1 | Package `packages/actor-subagents/package.nix` (`{applyPatches, src}`), flake output `packages.x86_64-linux.actor-subagents`, checks `actor-subagents`, `typecheck-actor-subagents` | §3 `packages/<c>/`; kebab-case like the directory and the extension's install name (§4 rule); one file both the flake output and the module's `package` default call | `packages.actorSubagents`: an option-style name among package names; the expression in `modules/actor-subagents.nix`: the flake output could not reuse it |
| D2 | Patch files keep the host's names: `patches/pi-actor-subagents/pi-actor-subagents-{child-prompt,spawn-policy,first-turn}.patch`, byte for byte; derivation `name` stays `pi-actor-subagents-patched` | Same store paths, so the derivation is the host's (drvPath equal on the same nixpkgs, M2.1 Step 4); W0's home-file comparison then shows the link unchanged, and the host's `checks/pi-extensions.nix` suffix `-pi-actor-subagents-patched/extensions/actor-subagents` keeps matching | `patches/pi-actor-subagents/child-prompt.patch`: a new store path and derivation for a rename only |
| D3 | The upstream source reaches the module through the internal option `actorSubagents.src`, which `homeModules.default` sets with `lib.mkDefault` from the input; `homeModules.default` becomes an attrset module that imports `./modules` | The module needs the input for `package`'s default and for `checkPath`; an option is typed, visible to the cases (the negative case sets it) and overridable; M6 repeats it for infinite-context and retry | `_module.args`: an untyped global argument; `modules/default.nix` as a function of the inputs: changes M0's module shape; `self.packages`: the flake's pkgs instead of the consumer's (M1 D2) |
| D4 | `passthru.spawnPolicyApi = 1` through `overrideAttrs`, `(old.passthru or {}) // {…}` | §4.1; nixpkgs' `applyPatches` asserts `!args ? passthru` (checked in the locked nixpkgs); `passthru` does not enter the derivation, so the drvPath stays the host's | `passthru` argument: evaluation error |
| D5 | `childExtensions` is a read-only internal option of `common.nix`; `modules/actor-subagents.nix` writes the file | §5.1 puts the rendering in the registry, §4's table puts the file in the component's row; this way common.nix does not read a component's options, and the file has one writer | common.nix writing the file: the shared module would depend on `actorSubagents.{enable,settings}` |
| D6 | File text `builtins.toJSON (lib.recursiveUpdate cfg.settings {inherit (pe) childExtensions;})`: the registry's list wins over a `childExtensions` in `settings` | §4 table states exactly this expression; the registry owns the key (one writer, §5.1); `builtins.toJSON` sorts keys, so with `settings = {}` the bytes are today's (`pi-extensions.nix:389-390`) | §4's general rule (user's settings on the right): a `settings.childExtensions` would silently replace the registry's list, which is fail-closed upstream (open question Q1) |
| D7 | `settings` type `attrsOf (pkgs.formats.json {}).type`, free-form | Upstream reads `maxAgents`, `maxSpawnDepth`, `errorNoticeGraceMs` (patched `settings.ts`); the spec gives no typed options; same type as M1's `router` | Typed options per key: beyond §4 |
| D8 | `typecheck-actor-subagents` checks a copy of `extensions/` and `package.json` (no `tsconfig.json`), named `actorSubagentsTs` in `checks/default.nix` | tsc refuses files on its command line next to a `tsconfig.json` (TS5112, seen); `package.json` (`"type": "module"`) keeps the files ESM (without it: TS1470, seen); the flags stay M0's | `--ignoreConfig` in M0's runner: changes the shared harness and its self-test for one package (M6 may revisit, open question Q4) |
| D9 | Interface comparison harness `checks/iface/default.nix`: `compare {name; provider = {src; file; type}; consumer = {…};}` = M0's `typecheck` over a generated directory; self-test `iface-harness` with three fixtures | §5.3/§8.1 "provider's type assignable to the consumer's copy" is literally `const c: Consumer = provider`; one runner, one set of flags; M4 and M5 add pairs; a harness gets a self-test, as M0's did | Type-level `[P] extends [C]`: worse messages; calling tsc directly: a second copy of the flags |
| D10 | The probe's alias: `export type SubagentsApi = { list(): Info[] };`, used in the cast | §8.1 "inline type becomes a named type alias, a type-only edit"; `export` because `compare.ts` imports it; erased by `--experimental-strip-types` | Naming it `SubagentsApiV1`: two types of one name, provider and copy |
| D11 | The host's check is copied verbatim to `checks/actor-subagents/default.nix` and called with `src = actorSubagents` | It is the moved test (§8.1 "as in today's `checks/pi-*`"); its greps pin each patch's wiring | Rewriting it: a moved test that is no longer the host's |
| D12 | `components-together` in a new case file `cases/together.nix` with a `components` list each milestone extends; `hm-session-vars.sh` is left out of the package union | §8.1 "every component together"; M2 is the first milestone with two components; that one package is built from the session variables, which the case compares itself | One case per pair: quadratic |
| D13 | The flake's `nixpkgs` stays where M0 locked it (`c59305b`) although the host moved to `f45c6f0` | `flake.lock` changes only as needed (AGENTS.md); the host's `follows` replaces it anyway; the drvPath comparison (M2.1) evaluates both sides on the flake's nixpkgs | Moving it with M2: lock churn without a task that needs it |

## The gate

No principles document; the gate is §4's rules, §8's testing rules, AGENTS.md and the M0/M1 lessons.

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: every task has a RED; the characterisation case (M2.9) and the green-on-first-build type check (M2.2, natural red TS5112 first) carry planted violations |
| No `builtins.match` on generated text | PASS: cases compare values (`eq`, `holds`, `lib.splitString`, `lib.hasSuffix`) |
| Typed options; assertions for invariants | PASS: `enable`, `src` (path), `package`, `settings` (JSON attrs); the registry's existence assertion covers the entry; `taskRouter`'s assertion on `spawnPolicyApi` is M5's (§9) |
| camelCase options, kebab-case directories (§4) | PASS: `actorSubagents`, `childExtensions`; `packages/actor-subagents`, `patches/pi-actor-subagents`, `actor-subagents/settings.json` |
| Settings files are literal text (§4) | PASS: `.text = builtins.toJSON …`; cases read it with `fromJSON` |
| Merges with `lib.recursiveUpdate` (§4) | PASS: D6 (the table's operand order; open question Q1) |
| Every assertion message `pi-economics:` with a negative case | PASS: no new assertion; the registry's (M0) gets `actor-subagents-missing` for this entry |
| No import-from-derivation | PASS: `checkPath` probes `src` (a fetched source), not the patched output; the plant in M2.6 shows an IFD build when it does |
| Scripts strict and dependency-explicit | PASS: no new script; `runCommand`s use `set -euo pipefail` where they branch |
| Alejandra on every changed `.nix` file | PASS: CLEAN steps; the prototype passed `alejandra --check` over every tracked `.nix` file |
| Markdown under `docs/` (+ `README.md`, `AGENTS.md`) | PASS |
| `flake.lock` changes only as needed | PASS: one input added at the host's revision; other nodes unchanged (M2.1 Step 4) |
| Leak patterns (§8.3) | PASS: `leak` green with the patches and fixtures (prototype) |
| Host read-only | PASS: `git dot show`/`archive`/`diff` only |
| Every check built with both `git+file://` and `path:` refs | PASS: M2.12 (prototype: all 12 green under both) |
| Pure move (§1) | PASS: patches `cmp`-equal, check copied verbatim, drvPath equal to the host's expression, today's file bytes (M2.7), host lock node equal |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION.

## Files to read first

Listed, not quoted; the tasks show only what changes.

- The spec: §1, §2 (row `actorSubagents`, citations), §3, §4 (row `actorSubagents`, merges), §4.1 (`spawnPolicyApi`, soft dependencies), §5.1 (all), §5.3, §8.1 (type check, interface comparisons, module evaluation), §8.3, §9 (row M2, "Drift").
- The M0 plan's "Interfaces M0 publishes" and Execution Record (deviation 5); the M1 plan's "Interfaces M1 publishes", D2, D11, and its Execution Record (whatever deviated).
- This repository at M1's end: `flake.nix`, `checks/default.nix`, `checks/typecheck/default.nix` (`runner`, `typecheck`), `checks/module-eval/{default.nix,expect.nix,cases/common.nix,cases/bench.nix}`, `checks/lib/hm-eval.nix`, `modules/common.nix`, `modules/default.nix`, `packages/bench/probe/index.ts`, `docs/pi-economics.md`, `AGENTS.md`.
- Host at `f6a3c81` (`host <path>`): `modules/home-manager/features/ai/pi-actor-subagents.nix`, the three `.patch` files (skim; `spawn-policy` lines 266–437 are `api.ts`), `checks/pi-actor-subagents/default.nix`, `modules/home-manager/features/ai/pi-extensions.nix` lines 35–41, 90–100, 232–238, 366–390; host `flake.nix` at HEAD, lines with `pi-actor-subagents`; host `checks/pi-extensions.nix` lines 117–119, 164–170, 250–275 (what W0 will read).
- The patched upstream after M2.1: `nix build "$F#packages.x86_64-linux.actor-subagents" --print-out-paths`, then `extensions/actor-subagents/{api.ts,settings.ts}`.
- This plan's Snippets.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| `tsc --strict` via `typecheck-actor-subagents` | from M2.2, every build | strict errors in the patched upstream (none today); a `tsconfig.json` beside the files (TS5112, the natural red); CommonJS treatment without `package.json` (TS1470) |
| `tsc --strict` via `iface-*` | from M2.3 (`iface-harness`), M2.4 (`iface-subagents-bench-probe`) | a provider not assignable to the consumer's copy (TS2322, TS2741), a missing exported alias (TS2614) |
| `tsc --strict` via `typecheck-bench` (M1) | M2.4 | the alias edit's use in the probe |
| Nix module system | `module-eval` | unknown options (each task's RED), a non-path `src`, a non-object `settings` |
| `applyPatches` | build of `packages.actor-subagents` | a patch that no longer applies |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package tests (`actor-subagents`) | upstream suite + the patches' tests (297 at `707496e`), and the check's greps for each patch's wiring | nodejs; ~4 s, 0.14 GiB |
| Type check (`typecheck-actor-subagents`) | `--strict` over the patched upstream's 69 `.ts` files with pi 1.0.0's types | the shared lock; ~10–30 s, 0.25 GiB |
| Interface comparison (`iface-subagents-bench-probe`) and its harness (`iface-harness`) | probe copy ⊒ provider `SubagentsApiV1`; the harness accepts a satisfied copy and rejects an unsatisfied one | the shared lock; ~10–30 s each |
| Module evaluation (`module-eval`) | `childExtensions`; the component off, on, its package, the negative case, its files, today's bytes, `settings`; every component together | Home Manager (M0 harness); 31 cases, ≤ 0.9 GiB, ~40 s |
| Package tests (`bench`, M1) | the probe alias leaves the bench's behaviour as it is | M1's check |
| Leak (`leak`) | patches, fixtures, new files | — |
| Interface comparisons for cache-lifecycle, experiments, router | N/A: M4, M5 (§8.1) | — |
| `taskRouter`'s hard dependency on `spawnPolicyApi` | N/A: M5 (the assertion's consumer); M2 pins the passthru | — |
| Soft-dependency warnings (`cacheLifecycle`, `experiments` without `actorSubagents`) | N/A: M4 (their consumers) | — |
| `retry`'s child-regex op "when actorSubagents is enabled" | N/A: M6 | — |
| Layer B, activation | N/A: W0 (§9.1), owner step | — |

## Scenario coverage

| Spec scenario | Check · case (task) |
|---|---|
| §2 `actorSubagents` = `pi-actor-subagents.nix` + 3 patches | M2.1 Step 4 (`cmp` patches; drvPath = host's expression); `actor-subagents` greps per patch |
| §3 input `pi-actor-subagents`, `flake = false`, host's revision | M2.1 Step 4 (lock node `diff` with the host's) |
| §3 `packages.<c>`; §3 `patches/<upstream>/*.patch` | M2.12 gate (`packages` lists `actor-subagents`, `bench`); `actor-subagents-package` (M2.6) |
| §4 `enable`, `package` | `actor-subagents-off`, `actor-subagents-defaults`, `actor-subagents-package` (M2.6) |
| §4 the link via the registry | `actor-subagents-defaults` (registry entry `path`, link target, ∀ agentDir) (M2.6) |
| §4 `settings.json` = `recursiveUpdate settings {childExtensions}`; with `settings = {}` today's file | `actor-subagents-files`, `actor-subagents-today` (M2.7); `actor-subagents-settings` (M2.8) |
| §4.1 `passthru.spawnPolicyApi = 1` via `overrideAttrs` | `actor-subagents-package` (M2.6) |
| §5.1 existence assertion on `checkPath` (the unpatched input), message names `input` | `actor-subagents-missing` (M2.6); `actor-subagents-defaults` (`checkPath`, `input`) |
| §5.1 children: link paths of `forChildren` entries, sorted by name; last path component is the name | `child-extensions` (M2.5) |
| §5.1 one writer; the file only when `actorSubagents` is enabled | `actor-subagents-files` ("while off") (M2.7); `actor-subagents-defaults` exact targets |
| §5.1 actor-subagents itself withheld from children | `actor-subagents-defaults` (`forChildren = false`) (M2.6) |
| §5.3 `__subagentsApi_v1` provided by the spawn-policy patch (`api.ts`) | `actor-subagents` (`grep -q '__subagentsApi_v1' api.ts`); `iface-subagents-bench-probe` reads it (M2.4) |
| §8.1 package tests of the patched upstream | `actor-subagents` (M2.1) |
| §8.1 `tsc --strict` per package | `typecheck-actor-subagents` (M2.2) |
| §8.1 interface comparison, bench probe vs `__subagentsApi_v1`, from M2; inline type → named alias | `iface-subagents-bench-probe` (M2.4); harness `iface-harness` (M2.3) |
| §8.1 each component alone, every component together | `actor-subagents-defaults`; `components-together` (M2.9) |
| §8.1 host-like combination | `actor-subagents-today` (a registry with two children and one withheld entry) (M2.7) |
| §8.3 leak patterns over moved files | `leak` (M2.1 Step 6, M2.12) |
| §2 citations re-pointed | `package.nix` written without them (M2.1); M2.10 (check) |
| §9 drift | M2.0, M2.12 Step 3 |

## Properties

- `child-extensions`: ∀ dir ∈ {".pi/agent", "custom/agent"}: childExtensions = [home/dir/extensions/n | n ∈ sort(names), forChildren(n)] (literal for the fixture: the order and the link-path form are the criterion) ∧ ∀ p ∈ childExtensions: ∃ f ∈ home.file: home/target(f) = p ∧ map lastComponent childExtensions = the sorted child names.
- `actor-subagents-defaults`: ∀ dir: entry = {path = package/extensions/actor-subagents; checkPath = src/extensions/actor-subagents/index.ts; input = "pi-actor-subagents"; forChildren = false} (read from the evaluated `package` and `src`, so a new source needs no new expectation) ∧ dir/extensions/actor-subagents ∈ targets ∧ failed = ∅ ∧ warnings = bare.
- `actor-subagents-files`: ∀ dir: targets(on) = targets(bare) ∪ {dir/extensions/actor-subagents, dir/actor-subagents/settings.json} (exact set) ∧ text = `{"childExtensions":[]}`; off with children registered: no file.
- `actor-subagents-today`: text = `builtins.toJSON {childExtensions = childExtensions;}` (the host's expression, `pi-extensions.nix:389-390`) ∧ keys(fromJSON text) = ["childExtensions"] (the host's `checks/pi-extensions.nix:253`).
- `actor-subagents-settings`: fromJSON text = settings ⊕ {childExtensions = the registry's} (D6).
- `actor-subagents-package`: drvPath = `packages.x86_64-linux.actor-subagents.drvPath` ∧ `passthru.spawnPolicyApi or 0` = 1.
- `actor-subagents-missing`: failed("pi-economics:") = [the M0 message built from the entry's own `checkPath` and `input`].
- `components-together`: for components C = {bench, actorSubagents}: targets(all C) = ⋃_c targets(c) ∧ packages(all C) = ⋃_c packages(c) (without `hm-session-vars.sh`) ∧ sessionVariables(all C) = ⨆_c sessionVariables(c) ∧ failed = ∅ ∧ warnings = bare.
- `iface-*`: provider type ≤ consumer copy (assignability); `iface-harness`: ok ↦ exit 0, bad ↦ exit ≠ 0 ∧ TS2741.
- M2.1 one-offs: bytes(patch_i) = bytes(host patch_i) for i ∈ 1..3; drvPath(flake package) = drvPath(host expression, same nixpkgs, same src); lock node = host's node.

## Planted violations

Tick in the task once seen.

| Check | Plant | Must fail with | Task |
|---|---|---|---|
| `actor-subagents` | drop `pi-actor-subagents-first-turn.patch` from `package.nix`'s list | log `ℹ tests 290`, `ℹ fail 0`, then `builder failed with exit code 1` (the check's `test -f first-turn.test.ts`) | M2.1 Step 5 |
| `typecheck-actor-subagents` | (natural red) `src = actorSubagents` (with `tsconfig.json`) | `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline` | M2.2 Step 2 |
| `typecheck-actor-subagents` | `actorSubagentsTs` without `package.json` | `extensions/actor-subagents/spawn-wording.test.ts:9:65 - error TS1470: The 'import.meta' meta-property is not allowed in files which will build into CommonJS output.` | M2.2 Step 4 |
| `iface-harness` | (stub red) `compare.ts` = `export {};` | `FAIL consumer-bad: accepted` | M2.3 Step 2 |
| `iface-harness` | `declare const provider: any;` | `FAIL consumer-bad: accepted` | M2.3 Step 4 |
| `iface-subagents-bench-probe` | (natural red) before the alias | `error TS2614: Module '"./consumer/probe/index.ts"' has no exported member 'SubagentsApi'` | M2.4 Step 2 |
| `iface-subagents-bench-probe` | alias `{ list(): Info[]; send(to: string): void }` | `error TS2322: Type 'SubagentsApiV1' is not assignable to type 'SubagentsApi'.` | M2.4 Step 5 |
| `iface-subagents-bench-probe` | alias `{ list(): { name: string; state: "running" }[] }` (`typecheck-bench` stays green) | same TS2322 | M2.4 Step 5 |
| `module-eval` | `childExtensions` = `map (n: toString cfg.extensions.${n}.path)` (store paths) | three `FAIL child-extensions: …` lines per agentDir (`childExtensions`, `every child is a link`, `names from the last path component`) | M2.5 Step 5 |
| `module-eval` | `config = lib.mkIf true {` in `modules/actor-subagents.nix` | `FAIL actor-subagents-off: no registry entry`, `… no link`, and `FAIL inert: home.file names: …` | M2.6 Step 5 |
| `module-eval` | `passthru = old.passthru or {};` | `FAIL actor-subagents-package: spawnPolicyApi: expected 1, got 0` | M2.6 Step 5 |
| `module-eval` | delete the `checkPath` line (it defaults to the patched output) | evaluation builds `pi-actor-subagents-patched` from the fixture (import from derivation) and fails: `can't find file to patch` | M2.6 Step 5 |
| `module-eval` | `lib.recursiveUpdate {inherit (pe) childExtensions;} cfg.settings` | `FAIL actor-subagents-settings: settings file: expected { childExtensions = [ … ]; … }, got { childExtensions = [ "/elsewhere" ]; … }` | M2.8 Step 4 |
| `module-eval` | `home.file.planted = lib.mkIf pe.bench.enable {text = "x";};` in the actorSubagents config | `FAIL components-together: home.file targets: …` | M2.9 Step 3 |

Planner's dry run (2026-10-18, scratch clone under `$TMPDIR` at M1.2 plus a minimal stand-in for M1.4–M1.8; final state of every snippet): all 12 checks green under `git+file://` and under `path:` (`actor-subagents` 297 tests, 3 s, 0.14 GiB; `typecheck-actor-subagents` 0.25 GiB; `module-eval` 26 cases with the stand-in, 40 s, 0.84 GiB; `iface-*` 0.25 GiB); `alejandra --check` clean; drvPath `/nix/store/1wn44qbf…-pi-actor-subagents-patched.drv` on both sides; lock node equal to the host's. Seen red: every row above except M2.3's stub (the `any` plant gives the same line), and the option- or attribute-missing REDs of M2.1, M2.5, M2.6, M2.8. M2.7's RED was seen as listed (six `FAIL` lines, `6 failure(s)`). The snippets S2, S7, S8, S9 were extracted from this file into the scratch clone and passed `alejandra --check` and `module-eval` (26 cases with the stand-in). With M1's full cases the count is 22 + 9 = 31.

## Coverage gap

- **Real pi.** The suite drives fakes; no check spawns a child in pi. Same as the host today; W0's activation (owner step) covers it.
- **The settings file read at runtime.** Upstream reads `getAgentDir()/actor-subagents/settings.json`; that `agentDir` matches pi's agent dir (`PI_CODING_AGENT_DIR` not modelled, §4) is the host's concern at W0.
- **The host's own readers** (`checks/pi-extensions.nix` link suffix and policy keys, `eval-assertions.nix:9353-9360` child names): not run here; the properties above mirror them, W0 runs them.
- **Upstream licence.** MIT (`LICENSE` in the locked source); whether it allows distributing the patches is P's check (§8.3), noted, not checked.
- **`taskRouter`'s assertion** reads `spawnPolicyApi`: M5. M2 pins the value only.
- **The upstream's tsconfig.json** (bundler resolution, pi 0.84.2) is ignored by design (D8): the flake checks against the lock's pi 1.0.0.

## Environment (every step)

```sh
source ~/.cache/pi/m0env.sh      # XDG dirs, cd, F (git+file), o, cap, nb, ne, fmt, host (f6a3c81), nbl, addcases
Fp=path:$HOME/projects/nix/pi-economics
nbp() { (ulimit -v $cap && exec timeout -s KILL 900 nix build --no-link -L "$Fp#checks.x86_64-linux.$1" "${o[@]}"); }
ai=modules/home-manager/features/ai
```

- `git+file:` sees only indexed files: `git add` new files (patches, fixtures, case files) before `nb`/`ne`.
- `nb` prints no log for an output already in the store: `nbl <check>` to see a green log.
- `git dot archive` takes paths relative to `~/projects/nixos/new` when run there; `--strip-components=4` drops `modules/home-manager/features/ai`.
- Plain `git` here; `git dot` only to read the host. Commits unsigned.
- TypeScript edits keep tab indentation.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `flake.nix`, `flake.lock` | input `pi-actor-subagents`, `packages.actor-subagents` | M2.1 |
| `flake.nix` | `homeModules.default` sets `actorSubagents.src` | M2.6 |
| `patches/pi-actor-subagents/*.patch` | the host's patches, verbatim | M2.1 |
| `packages/actor-subagents/package.nix` | `applyPatches` + `spawnPolicyApi` | M2.1 |
| `checks/actor-subagents/default.nix` | the host's check, verbatim (one citation dropped in M2.10) | M2.1, M2.10 |
| `checks/default.nix` | `actorSubagents`, `actorSubagentsTs`, `iface`; four checks | M2.1–M2.4 |
| `checks/iface/default.nix`, `checks/iface/fixtures/{provider,consumer-ok,consumer-bad}/` | comparison harness, self-test | M2.3 |
| `packages/bench/probe/index.ts` | exported alias `SubagentsApi` | M2.4 |
| `modules/common.nix` | `childExtensions` | M2.5 |
| `modules/actor-subagents.nix`, `modules/default.nix` | the component | M2.6–M2.8 |
| `checks/module-eval/cases/actor-subagents.nix` | 8 cases | M2.5–M2.8 |
| `checks/module-eval/cases/together.nix` | `components-together` | M2.9 |
| `checks/module-eval/default.nix` | `caseFiles` | M2.5, M2.9 |
| `docs/pi-economics.md`, `AGENTS.md` | component section, checks, patched upstreams | M2.11 |

Interfaces M2 publishes: options `programs.piEconomics.actorSubagents.{enable, package, settings}` and internal `.src`; read-only internal `programs.piEconomics.childExtensions`; `actorSubagents.package.passthru.spawnPolicyApi` (M5's assertion reads it); `packages.x86_64-linux.actor-subagents`; `checks/iface` → `iface.compare {name; provider = {src; file; type}; consumer = {…};}` (M4, M5 add pairs; a `src` holds no `tsconfig.json`); `actorSubagentsTs` in `checks/default.nix` (the provider for those pairs); `cases/together.nix`'s `components` list (M3–M6 append).

---

## Tasks

| Task | Delivers | Commit |
|---|---|---|
| M2.0 | read; M1 landed; drift | — |
| M2.1 | input, patches, package, check `actor-subagents` | `m2: actor-subagents package and upstream suite` |
| M2.2 | `typecheck-actor-subagents` | `m2(actor-subagents): tsc --strict` |
| M2.3 | interface-comparison harness | `m2: interface-comparison harness` |
| M2.4 | probe alias, `iface-subagents-bench-probe` | `m2: bench probe compared with __subagentsApi_v1` |
| M2.5 | registry `childExtensions` | `m2(common): childExtensions` |
| M2.6 | component: `enable`, `src`, `package`, registry entry | `m2(actor-subagents): module, package, registry entry` |
| M2.7 | the settings file | `m2(actor-subagents): settings file with childExtensions` |
| M2.8 | `settings` | `m2(actor-subagents): settings option` |
| M2.9 | every component together | `m2: every component together` |
| M2.10 | citation in the copied check (§2) | `m2(actor-subagents): re-point a citation` |
| M2.11 | docs | `m2: docs for actorSubagents` |
| M2.12 | gate, Execution Record | `m2: execution record` |

Every task starts at `[ ]`. Order as numbered. Never more than one red check at a time.

### Task M2.0 — Read, M1 landed, drift

- [ ] **Step 1:** read "Files to read first".
- [ ] **Step 2 (M1 landed):** `git log --oneline | grep -c ' m1: execution record$'` → `1`; `ne checks.x86_64-linux --apply builtins.attrNames --json` → `["bench","leak","leak-selftest","module-eval","npm-deps","pi-settings-migrate","typecheck-bench","typecheck-harness"]`; `nbl module-eval` → `22 cases passed`; `grep -c intersectAttrs checks/module-eval/default.nix` → `1` (M1.4). Otherwise stop: M2 builds on M1's end state. Read M1's Execution Record; a deviation that touches a file of this plan's File structure is reconciled before M2.1.
- [ ] **Step 3 (drift, §9):**

```sh
(cd ~/projects/nixos/new && git dot diff --stat f6a3c81 -- $ai/pi-actor-subagents.nix \
  $ai/pi-actor-subagents-child-prompt.patch $ai/pi-actor-subagents-spawn-policy.patch \
  $ai/pi-actor-subagents-first-turn.patch checks/pi-actor-subagents $ai/pi-extensions.nix \
  checks/pi-extensions.nix pkgs/pi-bench $ai/pi-settings-migrate.nix checks/pi-settings-migrate \
  checks/pi-retry/package.json checks/pi-retry/package-lock.json; echo "rc=$?")
git dot show HEAD:projects/nixos/new/flake.lock | jq -r '.nodes["pi-actor-subagents"].locked.rev'
```

Expected: no file line, `rc=0`; `707496e93d78aac3d2be609aee69c2b7ffff6c33`. A listed file or another revision is drift: stop and report; it is ported first, with its test. Note the host's HEAD for M2.12.

### Task M2.1 — Input, patches, package, check `actor-subagents`

**Files:** create `checks/actor-subagents/default.nix` (host copy), `patches/pi-actor-subagents/*.patch` (host copies), `packages/actor-subagents/package.nix` (S2); modify `checks/default.nix` (S3, M2.1 lines), `flake.nix` (S1 a, b, d), `flake.lock`.

- [ ] **Step 1:** the test first: copy the host's check and wire it (S3, the `actorSubagents` binding and the `actor-subagents` check):

```sh
mkdir -p checks/actor-subagents
host checks/pi-actor-subagents/default.nix > checks/actor-subagents/default.nix
git add checks/actor-subagents
```

- [ ] **Step 2 (RED):** `nb actor-subagents` → evaluation error `attribute 'actor-subagents' missing` (in `self.packages.x86_64-linux`).
  - [ ] red seen
- [ ] **Step 3 (GREEN):**

```sh
mkdir -p patches/pi-actor-subagents packages/actor-subagents
(cd ~/projects/nixos/new && git dot archive f6a3c81 -- $ai/pi-actor-subagents-child-prompt.patch \
  $ai/pi-actor-subagents-spawn-policy.patch $ai/pi-actor-subagents-first-turn.patch) |
  tar -x -C patches/pi-actor-subagents --strip-components=4
# S2 → packages/actor-subagents/package.nix; S1 a, b, d → flake.nix
git add patches packages/actor-subagents flake.nix
(ulimit -v $cap && exec timeout -s KILL 300 nix flake lock "$F" \
  --override-input pi-actor-subagents github:fdietze/pi-actor-subagents/707496e93d78aac3d2be609aee69c2b7ffff6c33 "${o[@]}")
git add flake.lock
nbl actor-subagents
```

Expected: the lock gains `pi-actor-subagents`; the log ends with `ℹ tests 297`, `ℹ pass 297`, `ℹ fail 0`.
- [ ] **Step 4 (pure move, one-off evidence):**

```sh
h=$(mktemp -d)
(cd ~/projects/nixos/new && git dot archive f6a3c81 -- $ai/pi-actor-subagents.nix $ai/pi-actor-subagents-child-prompt.patch \
  $ai/pi-actor-subagents-spawn-policy.patch $ai/pi-actor-subagents-first-turn.patch) | tar -x -C "$h" --strip-components=4
for p in child-prompt spawn-policy first-turn; do cmp "$h/pi-actor-subagents-$p.patch" patches/pi-actor-subagents/pi-actor-subagents-$p.patch && echo "same $p"; done
host checks/pi-actor-subagents/default.nix | cmp - checks/actor-subagents/default.nix && echo "same check"
echo '{}' > "$h/config.nix"
ne packages.x86_64-linux.actor-subagents.drvPath --raw; echo
(export NIXPKGS_CONFIG=$h/config.nix; ulimit -v $cap && exec timeout -s KILL 300 nix eval --raw --impure --expr \
  "let f = builtins.getFlake \"$F\"; in (import $h/pi-actor-subagents.nix {pkgs = f.inputs.nixpkgs.legacyPackages.x86_64-linux; src = f.inputs.pi-actor-subagents;}).drvPath" "${o[@]}"); echo
diff <(git dot show HEAD:projects/nixos/new/flake.lock | jq -S '.nodes["pi-actor-subagents"]') <(jq -S '.nodes["pi-actor-subagents"]' flake.lock) && echo "lock node = host's"
diff <(git show HEAD:flake.lock | jq -S '.nodes | del(.root)') <(jq -S '.nodes | del(.root, .["pi-actor-subagents"])' flake.lock) && echo "other nodes unchanged"
jq -c .nodes.root flake.lock
rm -rf "$h"
```

Expected: `same` ×3, `same check`; the two drvPaths equal (planning: `/nix/store/1wn44qbf…-pi-actor-subagents-patched.drv`); `lock node = host's`; `other nodes unchanged`; `{"inputs":{"home-manager":"home-manager","nixpkgs":"nixpkgs","pi-actor-subagents":"pi-actor-subagents"}}`.
- [ ] **Step 5 (planted):** delete the line `../../patches/pi-actor-subagents/pi-actor-subagents-first-turn.patch` from `package.nix`; `nb actor-subagents` → log `ℹ tests 290`, `ℹ fail 0`, then `builder failed with exit code 1`. Restore the line (`git diff packages/actor-subagents` against S2 empty once staged as S2).
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt flake.nix checks/default.nix packages/actor-subagents/package.nix`; `nb leak` passes; `ne packages.x86_64-linux --apply builtins.attrNames --json` → `["actor-subagents","bench"]`; `git status --short` lists only the files above. Commit.

### Task M2.2 — `typecheck-actor-subagents`

**Files:** `checks/default.nix` (S3, M2.2 lines).

- [ ] **Step 1:** add `typecheck-actor-subagents` with `src = actorSubagents` (the package as is).
- [ ] **Step 2 (RED, natural):** `nb typecheck-actor-subagents` → `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig' to skip this error.`
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the `actorSubagentsTs` binding (S3) and `src = actorSubagentsTs`. `nbl typecheck-actor-subagents` → passes, no `error TS` line.
- [ ] **Step 4 (planted):** in `actorSubagentsTs` copy only `${actorSubagents}/extensions` (drop `${actorSubagents}/package.json`) → `nb typecheck-actor-subagents` fails with `extensions/actor-subagents/spawn-wording.test.ts:9:65 - error TS1470: The 'import.meta' meta-property is not allowed in files which will build into CommonJS output.` (the patched files are in the program, as ESM only with the package's `package.json`). Restore.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M2.3 — Interface-comparison harness

**Files:** create `checks/iface/default.nix` (S4), `checks/iface/fixtures/{provider/api.ts,consumer-ok/index.ts,consumer-bad/index.ts}` (S4); modify `checks/default.nix` (S3, `iface` binding and `iface-harness`).

- [ ] **Step 1:** the fixtures and `checks/iface/default.nix` as in S4, except that the `compare.ts` heredoc holds only `export {};` (a stub that compares nothing); the `iface` binding and `iface-harness = iface.selftest;` in `checks/default.nix`. `git add checks/iface`.
- [ ] **Step 2 (RED):** `nb iface-harness` → `ok consumer-ok accepted`, then `FAIL consumer-bad: accepted`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the full `compare.ts` heredoc of S4. `nbl iface-harness` → `ok consumer-ok accepted`, `ok consumer-bad rejected with TS2741`.
- [ ] **Step 4 (planted):** `declare const provider: Provider;` → `declare const provider: any;` → `FAIL consumer-bad: accepted`. Restore.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt checks/iface/default.nix checks/default.nix`; `nb leak` passes. Commit.

### Task M2.4 — The bench probe against `__subagentsApi_v1`

**Files:** `checks/default.nix` (S3, `iface-subagents-bench-probe`), `packages/bench/probe/index.ts` (S5).

- [ ] **Step 1:** add `iface-subagents-bench-probe` (S3).
- [ ] **Step 2 (RED, natural):** `nb iface-subagents-bench-probe` → `compare.ts:2:15 - error TS2614: Module '"./consumer/probe/index.ts"' has no exported member 'SubagentsApi'.`
  - [ ] red seen
- [ ] **Step 3 (GREEN):** S5 (two added lines, one changed line, all types). `nbl iface-subagents-bench-probe` → passes.
- [ ] **Step 4 (behaviour kept, §8.1):** `nbl bench` → `ℹ pass 76`, `ℹ fail 0` (M1's count); `nb typecheck-bench` passes; `git diff -U0 packages/bench` shows exactly S5.
- [ ] **Step 5 (planted):** (a) alias `{ list(): Info[]; send(to: string): void }` → `error TS2322: Type 'SubagentsApiV1' is not assignable to type 'SubagentsApi'.`; (b) alias `{ list(): { name: string; state: "running" }[] }` → the same TS2322, while `nb typecheck-bench` stays green (the copy is narrower than what the provider gives). Restore S5.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 6 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M2.5 — The registry's `childExtensions`

**Files:** `modules/common.nix` (S6), create `checks/module-eval/cases/actor-subagents.nix` (S8: the `let` block and `child-extensions` only), `checks/module-eval/default.nix` (S10, the `actor-subagents.nix` line).

- [ ] **Step 1:** the case file with `child-extensions`; list it in `caseFiles`. `git add checks/module-eval/cases/actor-subagents.nix`.
- [ ] **Step 2 (RED):** `nb module-eval` → evaluation error `attribute 'childExtensions' missing`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** S6 (the option, the config line, the two comment updates). `nbl module-eval` → `23 cases passed`.
- [ ] **Step 4:** `inert` and the M0 registry cases are still green (part of the 23).
- [ ] **Step 5 (planted):** `map (n: toString cfg.extensions.${n}.path)` for the `map (n: "${config.home.homeDirectory}/…")` line → per agentDir `FAIL child-extensions: childExtensions (…): expected [ "/home/u/…/extensions/alpha" "/home/u/…/extensions/zeta" ], got [ "/nix/store/…/ext-b" "/nix/store/…/ext-a" ]`, `… every child is a link the registry renders (…): does not hold`, `… names from the last path component (…): expected [ "alpha" "zeta" ], got [ "ext-b" "ext-a" ]`. Revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt modules/common.nix checks/module-eval/default.nix checks/module-eval/cases/actor-subagents.nix`. Commit.

### Task M2.6 — Component: `enable`, `src`, `package`, registry entry

**Files:** create `modules/actor-subagents.nix` (S7 without the parts tagged M2.7, M2.8); modify `modules/default.nix` (S10), `flake.nix` (S1 c), `checks/module-eval/cases/actor-subagents.nix` (S8: `actor-subagents-off`, `-defaults`, `-package`, `-missing`).

- [ ] **Step 1:** add the four cases.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.actorSubagents' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the module (options `enable`, `src`, `package`; config: the registry entry), its import, and `homeModules.default` of S1 c. `git add modules/actor-subagents.nix`. `nbl module-eval` → `27 cases passed` (`exports` and `inert` stay green: `homeModules` is still `["default"]`, the disabled component renders nothing).
- [ ] **Step 4:** `nb leak` passes.
- [ ] **Step 5 (planted):** (a) `config = lib.mkIf true {` → `FAIL actor-subagents-off: no registry entry: does not hold`, `FAIL actor-subagents-off: no link: does not hold`, `FAIL inert: home.file names: …`; revert. (b) in `package.nix`, `passthru = old.passthru or {};` → `FAIL actor-subagents-package: spawnPolicyApi: expected 1, got 0`; revert. (c) delete the `checkPath = …;` line → `nb module-eval` builds `pi-actor-subagents-patched` from the fixture while evaluating (import from derivation) and fails with `can't find file to patch`; revert.
  - [ ] red seen (a)
  - [ ] red seen (b)
  - [ ] red seen (c)
- [ ] **Step 6 (CLEAN):** `fmt flake.nix modules/actor-subagents.nix modules/default.nix checks/module-eval/cases/actor-subagents.nix`. Commit.

### Task M2.7 — The settings file

**Files:** `modules/actor-subagents.nix` (S7, tagged M2.7), `checks/module-eval/cases/actor-subagents.nix` (S8: `actor-subagents-files`, `actor-subagents-today`).

- [ ] **Step 1:** add the two cases.
- [ ] **Step 2 (RED):** `nb module-eval` → `FAIL actor-subagents-files: home.file targets (.pi/agent): …` and `… settings file (.pi/agent): expected "{\"childExtensions\":[]}", got null` (and the `custom/agent` lines), `FAIL actor-subagents-today: settings file: expected "{\"childExtensions\":[\"/home/u/.pi/agent/extensions/alpha\",…]}", got null`, `FAIL actor-subagents-today: keys: expected [ "childExtensions" ], got null`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the `home.file` line tagged M2.7, first as `builtins.toJSON {inherit (pe) childExtensions;}` (no `settings` yet). `nbl module-eval` → `29 cases passed`.
- [ ] **Step 4 (CLEAN):** `fmt` both files. Commit.

### Task M2.8 — `settings`

**Files:** `modules/actor-subagents.nix` (S7, tagged M2.8), `checks/module-eval/cases/actor-subagents.nix` (S8: `actor-subagents-settings`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.actorSubagents.settings' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the `settings` option, and the file line becomes `builtins.toJSON (lib.recursiveUpdate cfg.settings {inherit (pe) childExtensions;})`. `nbl module-eval` → `30 cases passed` (`actor-subagents-today` and `-files` stay green: `settings = {}` gives the same text).
- [ ] **Step 4 (planted):** swap the operands (`lib.recursiveUpdate {inherit (pe) childExtensions;} cfg.settings`) → `FAIL actor-subagents-settings: settings file: expected { childExtensions = [ … ]; errorNoticeGraceMs = 0; maxAgents = 4; }, got { childExtensions = [ "/elsewhere" ]; … }`. Revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files; S7 and S8 now hold in full. Commit.

### Task M2.9 — Every component together (characterisation)

**Files:** create `checks/module-eval/cases/together.nix` (S9); `checks/module-eval/default.nix` (S10, the `together.nix` line).

- [ ] **Step 1:** the case file; list it; `git add`.
- [ ] **Step 2:** `nbl module-eval` → `31 cases passed` (green first: it pins that the components do not interfere).
- [ ] **Step 3 (planted):** in `modules/actor-subagents.nix`'s config add `home.file.planted = lib.mkIf pe.bench.enable {text = "x";};` → `FAIL components-together: home.file targets: expected [ … ], got [ … "planted" … ]`. Revert.
  - [ ] red seen
- [ ] **Step 4 (CLEAN):** `fmt checks/module-eval/cases/together.nix checks/module-eval/default.nix`. Commit.

### Task M2.10 — Re-point a citation (§2)

**Files:** `checks/actor-subagents/default.nix` (S11). One comment line.

- [ ] **Step 1:** S11.
- [ ] **Step 2:** `grep -rnE 'D3|T4\.7|plan S6|docs/plans|notes/' checks/actor-subagents packages/actor-subagents; echo "rc=$?"` → no line, `rc=1`.
- [ ] **Step 3 (behaviour kept):** `git diff -U0 checks/actor-subagents | grep '^[-+][^-+]'` shows only lines starting with `  #`; `nb actor-subagents` passes (a comment in the build script changes the derivation, so it rebuilds: `ℹ pass 297`).
- [ ] **Step 4:** commit.

### Task M2.11 — Docs

**Files:** `docs/pi-economics.md`, `AGENTS.md` (S12).

- [ ] **Step 1:** S12.
- [ ] **Step 2:** every name is documented:

```sh
for p in actorSubagents enable package settings childExtensions forChildren spawnPolicyApi src actor-subagents typecheck-actor-subagents iface-harness iface-subagents-bench-probe patches/pi-actor-subagents; do
  grep -qF "\`$p\`" docs/pi-economics.md || echo "MISSING $p"
done
```

Expected: no `MISSING`. `nb leak` passes.
- [ ] **Step 3:** commit.

### Task M2.12 — Gate and Execution Record

- [ ] **Step 1 (the gate, both refs):** M1.11 Step 1's loop, unchanged. Expected listing per ref: `actor-subagents bench iface-harness iface-subagents-bench-probe leak leak-selftest module-eval npm-deps pi-settings-migrate typecheck-actor-subagents typecheck-bench typecheck-harness`; no `FAILED`; `packages` `["actor-subagents","bench"]`; `homeModules` `["default"]`; formatter `.drv`; `fmt --check $(git ls-files '*.nix')` clean.
- [ ] **Step 2:** the lock moved only by the new input: `diff <(git show <M1's last commit>:flake.lock | jq -S '.nodes | del(.root)') <(jq -S '.nodes | del(.root, .["pi-actor-subagents"])' flake.lock) && echo unchanged` → `unchanged`.
- [ ] **Step 3:** drift again (M2.0 Step 3), and `git dot diff --stat <M2.0's host HEAD> HEAD -- <M2.0's paths>`: empty, or ported first.
- [ ] **Step 4:** fill `# Execution Record`: date, commit per task, boxes ticked, red messages seen, the gate's peaks and times, deviations, answers to the open questions.
- [ ] **Step 5:** commit.

---

## Snippets

### S1 — `flake.nix` (against M1's end state)

(a) inputs, after `home-manager`:

```nix
    # A patched upstream (spec §3), locked to the host's revision; the host
    # makes it follow its own input.
    pi-actor-subagents = {
      url = "github:fdietze/pi-actor-subagents";
      flake = false;
    };
```

(b) `outputs` arguments: `pi-actor-subagents,` after `home-manager,`.

(c) (M2.6) `homeModules.default`:

```diff
-    homeModules.default = ./modules;
+    homeModules.default = {
+      imports = [./modules];
+      # The upstream source the patched component builds from (spec §3).
+      programs.piEconomics.actorSubagents.src = lib.mkDefault pi-actor-subagents;
+    };
```

(d) packages (two dynamic-attribute paths `packages.${system}.x` cannot be merged, so the attrset form):

```diff
-    packages.${system}.bench = pkgs.callPackage ./packages/bench/package.nix {};
+    packages.${system} = {
+      bench = pkgs.callPackage ./packages/bench/package.nix {};
+      actor-subagents = pkgs.callPackage ./packages/actor-subagents/package.nix {src = pi-actor-subagents;};
+    };
```

### S2 — `packages/actor-subagents/package.nix`

```nix
# pi-actor-subagents with three local patches, applied in this order (spec §2):
#
# - child-prompt: upstream builds every child with `systemPromptOverride`, and
#   in pi a custom system prompt drops the default `tools` and `rules`
#   sections, where extensions' promptGuidelines land. A child therefore got
#   the context_* and web_* tools without infinite-context's "fold
#   proactively" guidance. The patch hands the agent preamble to pi as an
#   append prompt instead, so the default sections stay. Offer it upstream.
# - spawn-policy: the stable `globalThis.__subagentsApi_v1` (api.ts) that the
#   task router drives (spec §5.3): a spawn-policy hook (model, effort, brief,
#   tools, tool guard), an optional `task` parameter, neutral model wording,
#   send/list, childSessionId on spawn events, and a grace period before a
#   child's transient error (429 under pi-retry) wakes its parent.
# - first-turn: a child's first task arrived through
#   session.sendCustomMessage({triggerTurn: true}), which on an idle pi 1.0
#   session starts the run without before_agent_start, the system prompt and
#   the tool loadout. The first message of a session now goes through
#   sendUserMessage (prompt()); later ones stay custom messages. Drop it once
#   pi's sendCustomMessage prepares the loadout itself.
#
# The patch files keep the host's names, so the store paths, and with the
# same nixpkgs the derivation, are the host's. A patch that no longer applies
# fails this build; checks/actor-subagents runs the upstream suite on it.
{
  applyPatches,
  src,
}:
(applyPatches {
  name = "pi-actor-subagents-patched";
  inherit src;
  patches = [
    ../../patches/pi-actor-subagents/pi-actor-subagents-child-prompt.patch
    ../../patches/pi-actor-subagents/pi-actor-subagents-spawn-policy.patch
    ../../patches/pi-actor-subagents/pi-actor-subagents-first-turn.patch
  ];
}).overrideAttrs (old: {
  # The version of __subagentsApi_v1 this build provides; taskRouter asserts
  # it (spec §4.1). Through overrideAttrs: applyPatches refuses `passthru`.
  passthru = (old.passthru or {}) // {spawnPolicyApi = 1;};
})
```

### S3 — `checks/default.nix`

`let` bindings, after `typecheck = …;`:

```nix
  # (M2.3)
  iface = import ./iface {inherit lib pkgs typecheck;};
  # (M2.1)
  actorSubagents = self.packages.${pkgs.stdenv.hostPlatform.system}.actor-subagents;
  # (M2.2) The patched source without upstream's tsconfig.json: tsc refuses
  # files named on its command line next to one (TS5112), and the type check's
  # flags are ours. package.json keeps the files ESM ("type": "module").
  actorSubagentsTs = pkgs.runCommand "actor-subagents-ts" {} ''
    mkdir $out
    cp -r ${actorSubagents}/extensions ${actorSubagents}/package.json $out/
  '';
```

Checks, after `typecheck-harness` (M2.3) and at the end of the attrset (M2.1, M2.2, M2.4):

```nix
  iface-harness = iface.selftest;
```

```nix
  # The upstream suite of the patched pi-actor-subagents (spec §8.1), with the
  # host's check (checks/actor-subagents/default.nix, copied).
  actor-subagents = pkgs.callPackage ./actor-subagents {src = actorSubagents;};
  typecheck-actor-subagents = typecheck.typecheck {
    name = "actor-subagents";
    src = actorSubagentsTs;
  };
  # The bench probe's copy of __subagentsApi_v1 (spec §5.3, §8.1).
  iface-subagents-bench-probe = iface.compare {
    name = "subagents-bench-probe";
    provider = {
      src = actorSubagentsTs;
      file = "extensions/actor-subagents/api.ts";
      type = "SubagentsApiV1";
    };
    consumer = {
      src = ../packages/bench;
      file = "probe/index.ts";
      type = "SubagentsApi";
    };
  };
```

### S4 — `checks/iface/`

`checks/iface/default.nix`:

```nix
# Interface comparisons (spec §5.3, §8.1): a consumer keeps its own copy of a
# provider's globalThis API type, and the provider's type must be assignable to
# that copy. Each pair becomes one generated compare.ts next to copies of both
# sources, type-checked by the type check's runner (same flags, same lock).
{
  lib,
  pkgs,
  typecheck,
}: let
  # provider, consumer: { src; file (relative to src); type (an exported type) }.
  # A src must not hold a tsconfig.json (tsc refuses named files next to one).
  source = {
    name,
    provider,
    consumer,
  }:
    pkgs.runCommand "iface-${name}-src" {} ''
      mkdir -p $out
      cp -r ${provider.src} $out/provider
      cp -r ${consumer.src} $out/consumer
      chmod -R u+w $out
      echo '{"type": "module"}' > $out/package.json
      cat > $out/compare.ts <<'TS'
      import type { ${provider.type} as Provider } from "./provider/${provider.file}";
      import type { ${consumer.type} as Consumer } from "./consumer/${consumer.file}";
      declare const provider: Provider;
      // The provider's type is assignable to the consumer's copy.
      export const consumer: Consumer = provider;
      TS
    '';
  fx = ./fixtures;
  fixture = consumer: {
    name = "selftest-${consumer}";
    provider = {
      src = fx + "/provider";
      file = "api.ts";
      type = "Api";
    };
    consumer = {
      src = fx + "/${consumer}";
      file = "index.ts";
      type = "Copy";
    };
  };
in {
  # One comparison: iface.compare { name; provider; consumer; }.
  compare = args:
    typecheck.typecheck {
      name = "iface-${args.name}";
      src = source args;
    };

  # The harness accepts a satisfied copy and rejects an unsatisfied one.
  selftest = pkgs.runCommand "iface-harness" {nativeBuildInputs = [pkgs.gnugrep];} ''
    set -euo pipefail
    tsc=${lib.getExe typecheck.runner}
    $tsc ${source (fixture "consumer-ok")} || { echo "FAIL consumer-ok: rejected" >&2; exit 1; }
    echo "ok consumer-ok accepted"
    st=0
    log=$($tsc ${source (fixture "consumer-bad")} 2>&1) || st=$?
    [ "$st" -ne 0 ] || { echo "FAIL consumer-bad: accepted" >&2; exit 1; }
    grep -qF "error TS2741: Property 'kill' is missing in type 'Api' but required in type 'Copy'" <<<"$log" || {
      echo "FAIL consumer-bad: rejected for another reason:" >&2
      echo "$log" >&2
      exit 1
    }
    echo "ok consumer-bad rejected with TS2741"
    touch $out
  '';
}
```

(`log`, not `out`: a shell variable `out` would shadow the output path.) M2.3 Step 1's stub: the heredoc body is the single line `export {};`.

`checks/iface/fixtures/provider/api.ts`:

```ts
// The harness's provider fixture: an API with more than any consumer reads.
export interface Api {
	version: 1;
	list(): { name: string; state: "running" | "idle" }[];
	send(to: string, text: string): Promise<void>;
}
```

`checks/iface/fixtures/consumer-ok/index.ts`:

```ts
// A consumer's copy the provider satisfies: a subset, with wider field types.
export type Copy = { list(): { name: string; state: string }[] };
```

`checks/iface/fixtures/consumer-bad/index.ts`:

```ts
// A consumer's copy the provider does not satisfy: a method the provider lacks.
export type Copy = { list(): { name: string; state: string }[]; kill(name: string): void };
```

### S5 — `packages/bench/probe/index.ts`

```diff
 type Info = { name: string; state: string };
 type ProbeApi = { on(event: string, handler: () => void): void };
+/** What the probe reads of actor-subagents' globalThis.__subagentsApi_v1; the type check compares it with the provider's SubagentsApiV1 (spec §5.3). */
+export type SubagentsApi = { list(): Info[] };
@@
-		const api = (globalThis as { __subagentsApi_v1?: { list(): Info[] } }).__subagentsApi_v1;
+		const api = (globalThis as { __subagentsApi_v1?: SubagentsApi }).__subagentsApi_v1;
```

### S6 — `modules/common.nix`

Header comment and `forChildren`'s description:

```diff
-#  - extensions: the extension registry, rendered as links and existence
-#    assertions (childExtensions follows in M2, with actorSubagents);
+#  - extensions: the extension registry, rendered as links, existence
+#    assertions and the children's list (childExtensions);
@@
-        description = "Whether actor-subagents children load the extension (`childExtensions`, rendered from M2 on).";
+        description = "Whether actor-subagents children load the extension (`childExtensions`).";
```

Option, after `extensions = lib.mkOption {…};`:

```nix
    # (M2.5) The registry's children, rendered for actorSubagents.
    childExtensions = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      readOnly = true;
      internal = true;
      description = ''
        The link path `<home>/<agentDir>/extensions/<name>` of every registry
        entry with `forChildren`, sorted by name: what actor-subagents loads
        into each child (its settings file's `childExtensions`).
      '';
    };
```

Config, after `programs.piEconomics.piSettings = {…};`:

```nix
    # (M2.5) Link paths, not store paths: the extension resolves them in a child
    # process, and a reader can take each name from the last path component.
    programs.piEconomics.childExtensions =
      map (n: "${config.home.homeDirectory}/${cfg.agentDir}/extensions/${n}")
      (lib.filter (n: cfg.extensions.${n}.forChildren) (lib.attrNames cfg.extensions));
```

(`lib.attrNames` is sorted: "sorted by name" holds by construction, and `child-extensions` pins it.)

### S7 — `modules/actor-subagents.nix` (state after M2.8)

```nix
# pi-actor-subagents (spec §2, §4): background agents spawned and supervised
# from a pi session. The upstream extension with three local patches
# (packages/actor-subagents/package.nix), linked through the registry, and its
# settings file, the one place children's extensions are named.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.actorSubagents;
in {
  options.programs.piEconomics.actorSubagents = {
    enable = lib.mkEnableOption "pi-actor-subagents, background agents spawned and supervised from a pi session";

    src = lib.mkOption {
      type = lib.types.path;
      internal = true;
      description = ''
        The unpatched upstream source. The flake's homeModules.default sets it
        from its input `pi-actor-subagents`; the registry's existence assertion
        probes it.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/actor-subagents/package.nix {inherit (cfg) src;};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/actor-subagents/package.nix { src = <input pi-actor-subagents>; }";
      description = ''
        The patched extension source (`extensions/actor-subagents`).
        `passthru.spawnPolicyApi` is the version of `globalThis.__subagentsApi_v1`
        it provides (1: the spawn-policy patch); taskRouter requires it.
      '';
    };

    # (M2.8)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {
        maxAgents = 4;
        errorNoticeGraceMs = 0;
      };
      description = ''
        Merged into `<agentDir>/actor-subagents/settings.json`, which the
        extension reads on every spawn (upstream keys: `maxAgents`,
        `maxSpawnDepth`, `errorNoticeGraceMs`). `childExtensions` is rendered
        from the registry (`extensions.<name>.forChildren`) and replaces a
        value given here.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    programs.piEconomics.extensions.actor-subagents = {
      path = "${cfg.package}/extensions/actor-subagents";
      checkPath = "${cfg.src}/extensions/actor-subagents/index.ts";
      input = "pi-actor-subagents";
      # Withheld from children on upstream's advice: children already receive
      # the orchestration tools through pi's customTools, and loading the
      # extension again would put the swarm UI and status panel into headless
      # children.
      forChildren = false;
      description = "Spawns and supervises background agents from the session, with a live status panel: spawn_subagent, send_message, set_agent_model, list_agents, kill_agent, agent_history, set_status, resume_agents, plus the /agents* commands. Swarms persist beside the main session.";
    };

    # (M2.7; M2.8 adds the merge) One writer (spec §5.1). Literal text, so
    # checks read it with fromJSON (spec §4). The registry's childExtensions on
    # the right: the registry owns that key.
    home.file."${pe.agentDir}/actor-subagents/settings.json".text =
      builtins.toJSON (lib.recursiveUpdate cfg.settings {inherit (pe) childExtensions;});
  };
}
```

M2.7's form of the last line: `builtins.toJSON {inherit (pe) childExtensions;};`.

### S8 — `checks/module-eval/cases/actor-subagents.nix` (state after M2.8)

```nix
# Cases for modules/actor-subagents.nix and the registry's childExtensions
# (spec §4, §4.1, §5.1).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  fx = ../fixtures;
  # Two children, out of name order, and one entry withheld from them.
  registry = {
    zeta = {
      path = fx + "/ext-a";
      forChildren = true;
      description = "fixture zeta";
    };
    alpha = {
      path = fx + "/ext-b";
      forChildren = true;
      description = "fixture alpha";
    };
    mid = {
      path = fx + "/ext-a";
      forChildren = false;
      description = "fixture mid";
    };
  };
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; as: actorSubagents options, null = not enabled.
  eval = dir: as:
    hm.eval {
      programs.piEconomics =
        {
          agentDir = dir;
          extensions = registry;
        }
        // lib.optionalAttrs (as != null) {actorSubagents = {enable = true;} // as;};
    };
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  # The text of the file at target, null when there is none.
  textAt = target: cfg: let
    fs = lib.filter (f: f.target == target) (lib.attrValues cfg.home.file);
  in
    if fs == []
    then null
    else (lib.head fs).text;
  settingsText = dir: textAt "${dir}/actor-subagents/settings.json";
  bare = hm.evalBare {};
in {
  # (M2.5) The registry's children: link paths of the forChildren entries,
  # sorted by name, whether or not actorSubagents is enabled.
  child-extensions = lib.concatMap (dir: let
    c = eval dir null;
    kids = (pe c).childExtensions;
  in
    eq "childExtensions (${dir})" kids ["/home/u/${dir}/extensions/alpha" "/home/u/${dir}/extensions/zeta"]
    ++ holds "every child is a link the registry renders (${dir})"
    (lib.all (p: lib.elem p (map (t: "${c.home.homeDirectory}/${t}") (targets c))) kids)
    ++ eq "names from the last path component (${dir})" (map (p: lib.last (lib.splitString "/" p)) kids) ["alpha" "zeta"])
  dirs;

  # (M2.6) Off by default: no registry entry, no link.
  actor-subagents-off = let
    c = eval ".pi/agent" null;
  in
    holds "no registry entry" (!(pe c).extensions ? actor-subagents)
    ++ holds "no link" (!lib.elem ".pi/agent/extensions/actor-subagents" (targets c));

  # (M2.6) On: the registry entry and its link, following agentDir.
  actor-subagents-defaults = lib.concatMap (dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        actorSubagents.enable = true;
      };
    };
    a = (pe c).actorSubagents;
    e = (pe c).extensions.actor-subagents;
  in
    eq "registry entry (${dir})" {inherit (e) path checkPath input forChildren;} {
      path = "${a.package}/extensions/actor-subagents";
      checkPath = "${a.src}/extensions/actor-subagents/index.ts";
      input = "pi-actor-subagents";
      forChildren = false;
    }
    ++ holds "link target (${dir})" (lib.elem "${dir}/extensions/actor-subagents" (targets c))
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M2.6) The package is the flake's, and carries the spawn-policy API version
  # that taskRouter's assertion reads (spec §4.1).
  actor-subagents-package = let
    a = (pe (eval ".pi/agent" {})).actorSubagents;
  in
    eq "drvPath" a.package.drvPath self.packages.x86_64-linux.actor-subagents.drvPath
    ++ eq "spawnPolicyApi" (a.package.passthru.spawnPolicyApi or 0) 1;

  # (M2.6) The existence assertion probes the unpatched source and names the input.
  actor-subagents-missing = let
    c = eval ".pi/agent" {src = fx + "/ext-a";};
  in
    eq "failed assertions" (failed "pi-economics:" c) [
      "pi-economics: extension 'actor-subagents' not found at ${(pe c).extensions.actor-subagents.checkPath}; the pi-actor-subagents input may have renamed or removed it."
    ];

  # (M2.7) The settings file: written only while enabled, next to the link;
  # with no child registered, an empty list.
  actor-subagents-files =
    lib.concatMap (dir: let
      c = hm.eval {
        programs.piEconomics = {
          agentDir = dir;
          actorSubagents.enable = true;
        };
      };
    in
      eq "home.file targets (${dir})" (lib.sort lib.lessThan (targets c))
      (lib.sort lib.lessThan (targets bare ++ ["${dir}/extensions/actor-subagents" "${dir}/actor-subagents/settings.json"]))
      ++ eq "settings file (${dir})" (settingsText dir c) ''{"childExtensions":[]}'')
    dirs
    ++ eq "settings file while off" (settingsText ".pi/agent" (eval ".pi/agent" null)) null;

  # (M2.7) Today's file (host pi-extensions.nix:389-390): builtins.toJSON of
  # { childExtensions = <the children's link paths>; } and no other key.
  actor-subagents-today = let
    c = eval ".pi/agent" {};
    text = settingsText ".pi/agent" c;
  in
    eq "settings file" text (builtins.toJSON {childExtensions = (pe c).childExtensions;})
    ++ eq "keys" (
      if text == null
      then null
      else lib.attrNames (builtins.fromJSON text)
    ) ["childExtensions"];

  # (M2.8) settings merge into the file; childExtensions stays the registry's.
  actor-subagents-settings = let
    c = eval ".pi/agent" {
      settings = {
        maxAgents = 4;
        errorNoticeGraceMs = 0;
        childExtensions = ["/elsewhere"];
      };
    };
  in
    eq "settings file" (builtins.fromJSON (settingsText ".pi/agent" c)) {
      maxAgents = 4;
      errorNoticeGraceMs = 0;
      childExtensions = (pe c).childExtensions;
    };
}
```

(Extracted from this file into the prototype: `alejandra --check` clean, all cases green. `fx` is M0's `checks/module-eval/fixtures`.)

### S9 — `checks/module-eval/cases/together.nix`

```nix
# Every component together (spec §8.1): enabling them all renders the union of
# what each renders alone, with no failed assertion and no warning. A milestone
# adds its component to `components`.
{
  lib,
  hm,
  expect,
}: let
  inherit (expect) eq failed;
  components = ["bench" "actorSubagents"];
  with' = cs: hm.eval {programs.piEconomics = lib.genAttrs cs (_: {enable = true;});};
  set = l: lib.sort lib.lessThan (lib.unique l);
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  # hm-session-vars.sh is built from the session variables, compared below.
  packages = cfg: lib.filter (p: !lib.hasSuffix "-hm-session-vars.sh" p) (map toString cfg.home.packages);
  union = f: set (lib.concatMap (c: f (with' [c])) components);
  all = with' components;
in {
  components-together =
    eq "home.file targets" (set (targets all)) (union targets)
    ++ eq "home.packages" (set (packages all)) (union packages)
    ++ eq "session variables" all.home.sessionVariables (lib.foldl' (acc: c: acc // (with' [c]).home.sessionVariables) {} components)
    ++ eq "failed assertions" (failed "" all) []
    ++ eq "warnings" all.warnings (hm.evalBare {}).warnings;
}
```

(It names no `self`: M1.4's harness passes a case file only the arguments it names.)

### S10 — `checks/module-eval/default.nix`, `modules/default.nix`

```diff
   caseFiles = [
     ./cases/common.nix
     ./cases/bench.nix
+    ./cases/actor-subagents.nix
+    ./cases/together.nix
   ];
```

(M2.5 the first line, M2.9 the second.)

```diff
   imports = [
     ./common.nix
     ./bench.nix
+    ./actor-subagents.nix
   ];
```

### S11 — `checks/actor-subagents/default.nix` (§2)

```diff
-  # system prompt / tool loadout (defect D3).
+  # system prompt / tool loadout.
```

### S12 — Docs

`docs/pi-economics.md`, the registry's `forChildren` bullet:

```diff
-- `forChildren` selects the extensions actor-subagents children load
-  (`childExtensions`, rendered with the `actorSubagents` component).
+- `forChildren` selects the extensions actor-subagents children load: their
+  link paths `<home>/<agentDir>/extensions/<name>`, sorted by name, are
+  `childExtensions` in `actor-subagents/settings.json` while `actorSubagents`
+  is enabled.
```

Under `## Components`, after the `bench` section:

```markdown
### `actorSubagents` (`modules/actor-subagents.nix`)

pi-actor-subagents (upstream input `pi-actor-subagents`) with three patches
from `patches/pi-actor-subagents`: child prompt, spawn policy (the
`globalThis.__subagentsApi_v1` other extensions drive) and first turn.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `actor-subagents` (link `<agentDir>/extensions/actor-subagents`, not loaded into children) and the settings file |
| `package` | the flake's `packages/actor-subagents` | the patched source; `passthru.spawnPolicyApi` = 1 |
| `settings` | `{}` | merged into `<agentDir>/actor-subagents/settings.json` (`maxAgents`, `maxSpawnDepth`, `errorNoticeGraceMs`); `childExtensions` there is always the registry's |
| `src` (internal) | set by `homeModules.default` from the input | the unpatched source the existence assertion probes |

With `settings = {}` the file is `{"childExtensions":[…]}`, the children's
link paths, as the host wrote it.

## Patched upstreams

A component built from an upstream repository takes it as a `flake = false`
input. Its patches live in `patches/<input>/` under the host's file names, so
the derivation is the host's; `homeModules.default` hands the input to the
component as its internal option `src`, and the registry entry's `checkPath`
points into `src`.
```

Rows for the checks table:

```markdown
| `actor-subagents` | the patched pi-actor-subagents' own suite and the host's checks of each patch's wiring |
| `typecheck-actor-subagents` | `tsc --strict` over the patched pi-actor-subagents |
| `iface-harness` | the interface-comparison harness accepts a satisfied copy and rejects an unsatisfied one |
| `iface-subagents-bench-probe` | the bench probe's copy of `__subagentsApi_v1` is satisfied by the provider's `SubagentsApiV1` |
```

`AGENTS.md`, under "Rules":

```markdown
- A consumer's copy of a cross-extension API type gets an `iface.compare`
  check in `checks/default.nix` (spec §5.3); its sources hold no
  `tsconfig.json`.
- Patched upstreams: `patches/<input>/`, file names as the host had them;
  the module reads the input through its internal `src` option.
```

---

## Open questions

Each with the planner's proposed decision; the plan follows the proposal.

- **Q1 (D6).** §4's table writes `lib.recursiveUpdate settings { childExtensions = …; }` (registry wins); §4's merge rule puts the user's `settings` on the right. Proposal: the table, documented in the option and pinned by `actor-subagents-settings`; the registry owns a fail-closed key. Alternative: an assertion that rejects `settings.childExtensions` (one more negative case).
- **Q2 (D2).** Patches keep the host's file names and the derivation name, so the package is the host's derivation. Proposal: accept; P may rename.
- **Q3 (D3).** `homeModules.default` becomes an attrset module that sets the internal `actorSubagents.src` from the input. Proposal: accept; M6 does the same for `pi-infinite-context` and `pi-retry`.
- **Q4 (D8).** `typecheck-actor-subagents` type-checks the patched upstream without its `tsconfig.json`, against the lock's pi 1.0.0 (upstream targets pi 0.84.2); green today. Proposal: accept; if M6's upstreams need the same, M6 moves it into M0's runner as `--ignoreConfig`, with a self-test fixture.
- **Q5 (D9).** A comparison harness with its own self-test, reused by M4/M5. Proposal: accept.
- **Q6 (D2).** The spawn-policy patch carries a test named "list reports each agent with the S6 fields" (a host plan id). Editing it would change the patch and the derivation. Proposal: leave it until P.
- **Q7 (D5).** `childExtensions` is computed in `common.nix`; the file is written by `modules/actor-subagents.nix`. Proposal: accept (one writer either way).
- **Q8 (D12).** `cases/together.nix` with a `components` list that M3–M6 extend. Proposal: accept.
- **Q9.** M2 needs M1 landed (M2.0 Step 2): its harness change (M1.4), `packages/bench` and the case count. Proposal: M2 starts after M1's Execution Record; if M1 deviates in `checks/default.nix`, `flake.nix` or the case harness, the implementer adapts S1/S3/S10 to M1's actual text.

# Execution Record
