# M1 — `bench`: TDD plan

Date: 2026-10-17 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 · Milestone: M1 (§9) · Base: this repository at `1add130` (M0 done)

Source commit: host dotfiles `f6a3c81`, `projects/nixos/new/pkgs/pi-bench/`. Drift checked while planning: `git dot diff --stat f6a3c81 HEAD -- pkgs/pi-bench` is empty at host HEAD `df23ba2` (2026-10-17); the paths M0 ported are unchanged too. Task M1.0 checks again.

## Motivation

§9 row M1: the bench (§7), with `router` defaulting to `{}`. The host's `pkgs/pi-bench` moves to `packages/bench/` as copied; its own tests pass unchanged and `tsc --strict` passes (§8.1). A Home Manager component `programs.piEconomics.bench` puts `pi-bench` and `bench-report` on `PATH` and configures them through session variables: `dataDir` (`PI_BENCH_DATA`), the agent source (`PI_BENCH_AGENT_SRC`), `workDir`, `extensions` (a `linkFarm`), `router` (a JSON base for an orch arm's `task-router/settings.json`) and `agentsBaseline`. The move is pure (§1): with `router = {}` an arm's file is today's, byte for byte; with the default `agentDir`, `PI_BENCH_DATA` is today's default.

## Approach

- Copy `pkgs/pi-bench` at `f6a3c81` verbatim to `packages/bench/` (`git dot archive`, modes kept). `flake.nix` gains `packages.x86_64-linux.bench = pkgs.callPackage ./packages/bench/package.nix {}`; checks `bench` (the package's `code` derivation, whose `checkPhase` runs `node --test`, as the host's check `pi-bench`) and `typecheck-bench` (M0's `typecheck`).
- `tsc --strict` reports one error (TS7053, `src/report.ts:131`); a type-only edit fixes it.
- TypeScript: `Paths.router` (from `PI_BENCH_ROUTER`); `orch.ts` gains `recursiveUpdate` (Nix's `lib.recursiveUpdate` on JSON) and `routerBase`; `materializeAgentDir` writes `recursiveUpdate(routerBase(paths.router), <the arm's keys>)`. Tests in a new file `test/router.test.ts`; existing test files stay as copied (one comment line re-pointed in M1.9).
- `modules/bench.nix`, imported by `modules/default.nix`. Every option at its empty default exports nothing, so the bench keeps its own default for it; `PI_BENCH_DATA` and `PI_BENCH_AGENT_SRC` are always exported when enabled.
- Module-evaluation cases in `checks/module-eval/cases/bench.nix`. The harness passes each case file only the arguments it names, so this file can take `pkgs` (for the `linkFarm` expectation) while `cases/common.nix` stays untouched.
- §2: the bench's citations of the host's 2026-10-02 spec and plan (`§5.6.5`, `T10.5`, `T0.3`, `S14`) are re-pointed to the package README or dropped.

## Decisions

| # | Decision | Rationale | Rejected alternative, and why |
|---|---|---|---|
| D1 | Directory `packages/bench/`, flake output `packages.x86_64-linux.bench`; binaries stay `pi-bench`, `bench-report` | §3 `packages/<c>/`, `packages.<c>`; `typecheck { name = "bench"; }` (M0 interface) | `pi-bench`: a second naming scheme next to the component name. The host reads its own `packages.pi-bench` (host `checks/pluto/deploy-wrapper.nix:104`, stubs `:79`); W1 keeps or re-points that output (open question Q2) |
| D2 | `package.nix` copied verbatim; the module's `package` default is `pkgs.callPackage ../packages/bench/package.nix {}` | The consumer's `pkgs`; with the host's `follows` it is the flake's derivation (`bench-today` compares the drvPaths) | Closing over `self`: `homeModules.default` would have to become a function, not the path M0 exports |
| D3 | Check `bench` = `packages.<system>.bench.code` (tests in `checkPhase`); `typecheck-bench` separate | The host's own check (`flake.nix:293`); one derivation runs the tests the package build needs anyway | A second `node --test` derivation: the tests would run twice |
| D4 | The `tsc --strict` fix: `type ContrastMetric = "pass" \| "score" \| "wallMin" \| "costUsd"`, `CONTRAST: ContrastMetric[]`, `Contrast = … & Record<ContrastMetric, CI>` | Type-only (erased by `--experimental-strip-types`); removes the duplicated union | `(c as any)[m]`: hides the error instead of typing it |
| D5 | An option at its empty default exports nothing: `workDir = null`, `agentsBaseline = null` (§7), and also `extensions = {}`, `router = {}` | §7: "Unset, the bench behaves as today"; an empty `linkFarm` would make every arm miss its extensions, a `{}` file would be a variable without effect | Always exporting both: the default config would point the bench at an empty extension directory |
| D6 | `PI_BENCH_ROUTER` = `builtins.toFile "pi-bench-router.json" (builtins.toJSON router)` | A store file made at evaluation: the case reads it back with `lib.importJSON`, no import-from-derivation (AGENTS.md) | `pkgs.writeText`: reading it back is IFD. Cost: a router value carrying a store path's context fails evaluation (router settings are names and URLs) |
| D7 | `recursiveUpdate` (TS) recurses where both sides are objects (non-null, non-array), else the right side wins; key order: the left's, then the right's new keys | §7: "merged … deeply, as `lib.recursiveUpdate` does"; with `{}` on the left the output is the arm's object, so its bytes are today's | `{...base, ...arm}`: shallow, drops base siblings under `delegation`/`t0Limits` |
| D8 | `routerBase`: unset → `{}`; a missing file or a non-object → an error naming the file | As `materializeAgentDir` treats a missing AGENTS.md; reachable only through the new variable | Silent `{}`: a typo in the path would run the arms on defaults unnoticed |
| D9 | `Paths.router?: string`, set by `resolvePaths` from `PI_BENCH_ROUTER` | Optional: no existing `Paths` literal changes; the field rides with the other paths into `materializeAgentDir` | A new parameter of `materializeAgentDir`: changes `runOne` and its callers |
| D10 | New tests in `test/router.test.ts`; existing test files as copied | §1 pure move: the copied suites prove behaviour is kept; the new file is the new behaviour | Appending to `orch.test.ts`: mixes the copy and the change |
| D11 | `checks/module-eval/default.nix` calls a case file with `builtins.intersectAttrs (lib.functionArgs f) {inherit lib pkgs hm self expect;}` | `cases/bench.nix` needs `pkgs`; `cases/common.nix` (`{lib, hm, self, expect}`, no `...`) stays unchanged | Adding `...` or `pkgs` to `cases/common.nix`: edits a passing test file for no behaviour |
| D12 | §2's re-pointing done in M1 for the bench: to `README.md, "Orchestrator factor arms"`, or dropped where the text says it already | The citations name the host's 2026-10-02 documents, which stay in the host; the moved doc arrives only with the last of M0–M6 | Waiting for the moved doc: M1's code would cite a document the flake never has |
| D13 | `packages/bench/README.md` stays next to the package (updated: flake attribute names, `PI_BENCH_ROUTER`, citations) | The rule exempts `README.md`; the host reads it the same way for `pkgs/pi-bench/README.md` | `docs/bench.md`: the package's own docs leave the package (open question Q5) |
| D14 | The probe's inline `__subagentsApi_v1` type (§8.1) stays inline in M1 | §8.1: the comparison against the provider starts in M2; the alias belongs to the task that names it | Aliasing now: a type edit no check reads |
| D15 | Option types as §7: `dataDir` `str`, `workDir`/`agentsBaseline` `nullOr str`, `extensions` `attrsOf path`, `router` `attrsOf (formats.json {}).type`; `PI_BENCH_AGENTS_ON` not modelled | §7 names these; the routing-on AGENTS.md follows the agent source (`config.ts:45`) | Absolute-path checks (`strMatching "/.*"`): beyond the spec |

## The gate

No principles document; the gate is §4's rules, §8's testing rules, AGENTS.md and the M0 lessons.

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: every task has a RED; M1.1 (a move) and M1.4 (a refactor) carry planted violations and before/after evidence |
| No `builtins.match` on generated text | PASS: cases compare values with `eq`/`holds`; no regex |
| Typed options; assertions for invariants | PASS: D15. No hard dependency of `bench` (§4.1), so no assertion and no negative case |
| camelCase options, kebab-case directories (§4) | PASS: `dataDir`, `workDir`, `agentsBaseline`; `packages/bench` |
| Settings files are literal text (§4) | N/A: `bench` writes no file (§4 table); `PI_BENCH_ROUTER` is a `toFile` of `builtins.toJSON` |
| Merges with `lib.recursiveUpdate` (§4) | PASS: the arm's keys over `router`, D7, tested against Nix's semantics in `router.test.ts` |
| Every assertion message `pi-economics:` with a negative case | N/A: none added |
| No import-from-derivation | PASS: D6; `bench-today` compares `drvPath`s, `bench-extensions` store paths, no build is read |
| Scripts strict and dependency-explicit | PASS: `package.nix`'s `writeShellApplication` wrappers, unchanged |
| Alejandra on every changed `.nix` file | PASS: CLEAN steps; the planner's prototype passed `alejandra --check` |
| Markdown under `docs/` (+ `README.md`, `AGENTS.md`) | PASS: D13 |
| `flake.lock` unchanged | PASS: no new input |
| Leak patterns (§8.3) | PASS: `leak` scans `packages/bench` from M1.1 (prototype: green; the helpers' `t@t` has no TLD) |
| Host read-only | PASS: `git dot show`/`archive`/`diff` only |
| Every check built with both `git+file://` and `path:` refs (M0 deviation 5) | PASS: M1.11 |
| Pure move (§1) | PASS: M1.1 `diff -r` with the host's tree; copied suites unchanged; `router.test.ts` pins today's bytes |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION.

## Files to read first

Listed, not quoted; the tasks show only what changes.

- The spec: §1 (pure move), §2 (citations), §3, §4 (row `bench`), §7 (all), §8.1, §8.3, §9 (row M1, "Drift").
- The M0 plan (`docs/plans/2026-10-17-m0-skeleton-plan.md`): "Environment", "Interfaces M0 publishes", the Execution Record (deviation 5: `path:` copies `.git/`).
- This repository: `modules/common.nix` (module style), `checks/default.nix`, `checks/module-eval/{default.nix,expect.nix,cases/common.nix}`, `checks/typecheck/default.nix`, `checks/lib/hm-eval.nix`, `docs/pi-economics.md`.
- Host at `f6a3c81` (`host <path>` below): `pkgs/pi-bench/{package.nix,README.md,src/config.ts,src/orch.ts,src/types.ts,src/run.ts,src/report.ts}` (report lines 84–112), `test/orch.test.ts`, `test/run.test.ts` lines 72–86, `test/helpers.ts`; host `flake.nix` at HEAD, lines with `pi-bench` (`packages.pi-bench`, check `pi-bench`).
- This plan's Snippets.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| `tsc --strict` via `typecheck-bench` | from M1.2, every build | implicit `any` (TS7053 at `report.ts:131` until D4), a missing export (TS2305 in M1.3's RED), `Paths.router` misuse |
| Nix module system (`check = true`) | `module-eval` | unknown options (each task's RED), a non-path `extensions` value, a non-JSON `router` value, a non-attrset `router` |
| shellcheck | build of `pi-bench`/`bench-report` wrappers | unchanged scripts |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package tests (`bench`) | the copied suites (71 tests at `f6a3c81`) and `router.test.ts` (5): today's bytes, the deep merge, `PI_BENCH_ROUTER` | nodejs, git, gnutar, bash, coreutils (the package's `runtimeInputs`); ~10 s |
| Type check (`typecheck-bench`) | `--strict` over `src/`, `probe/`, `test/` | the shared lock (M0) |
| Module evaluation (`module-eval`) | `bench` off by default; enabled: package, the two variables following `agentDir`, the options' variables, empty options export nothing | Home Manager (M0 harness); 22 cases, ≤ 1 GiB, ~30 s |
| Leak (`leak`) | the copied package | — |
| Interface comparison (probe vs `__subagentsApi_v1`) | N/A in M1: the provider comes with M2 (§8.1, D14) | — |
| Router projection from `taskRouter` | N/A in M1: M5 (§7) | — |
| Layer B, activation | N/A: W1 (§9.1), owner step | — |

## Scenario coverage

| Spec scenario | Check · case (task) |
|---|---|
| §3 `packages.<c>` | M1.11 gate: `packages.x86_64-linux` lists `["bench"]`; `bench-today` (M1.5) |
| §4 `bench` writes no file; `home.packages` + session variables; `enable`, `package` | `module-eval` · `bench-off`, `bench-defaults` (home.file names as without the module), `bench-today` (M1.5) |
| §7 `dataDir` default `<home>/<agentDir>/bench` → `PI_BENCH_DATA`; with the default `agentDir`, today's default | `bench-defaults` (∀ agentDir), `bench-today` (literal `config.ts:39` default) (M1.5) |
| §7 `PI_BENCH_AGENT_SRC = <home>/<agentDir>` | `bench-defaults` (M1.5) |
| §7 `workDir` `null` exports nothing, the bench keeps its default; set → `PI_BENCH_WORK` | `bench-defaults` (exact variable set), `bench-paths` (M1.6); bench default: copied `run.test.ts` "paths: …" |
| §7 `agentsBaseline` → `PI_BENCH_AGENTS_OFF`; `null` keeps the bench's default | `bench-paths`, `bench-defaults` (M1.6); copied `orch.test.ts` "paths: agent source …" |
| §7 `extensions` name → path, a `linkFarm` as `PI_BENCH_EXT_DIR`; looked up by name | `bench-extensions` (M1.7); lookup by name: copied `orch.test.ts` "runOne: a factor arm …" (`/ext/<name>`), `rpc.test.ts` |
| §7 `router` default `{}`: an arm's file is today's, byte for byte | `bench` · `router.test.ts` "router unset or {}" (M1.3); `bench-defaults` (no `PI_BENCH_ROUTER`) (M1.8) |
| §7 the arm's keys merged over `router` deeply (`lib.recursiveUpdate`) | `router.test.ts` "router base: merged …", "recursiveUpdate: …" (M1.3) |
| §7 `router` reaches the bench as a JSON file `PI_BENCH_ROUTER`; unset → as today | `bench-router` (M1.8); `router.test.ts` "resolvePaths: PI_BENCH_ROUTER …" (M1.3) |
| §7 router projection from `taskRouter.settings`, switches forced off | N/A: M5 |
| §7 arms and judge defaults as in the source; `qwen` kept | the copied suites unchanged (`cli.test.ts`, `orch.test.ts`, `judge.test.ts`); M1.1 `diff -r` |
| §8.1 package tests | `bench` (M1.1) |
| §8.1 `tsc --strict`; a forced edit keeps behaviour | `typecheck-bench`; 71 copied tests still pass (M1.2) |
| §8.3 leak patterns over the moved files | `leak` (M1.1) |
| §2 citations re-pointed | M1.9 Step 2 (`grep` empty) |
| §9 drift | M1.0, M1.11 Step 3 |

## Properties

- `bench-defaults`: ∀ dir ∈ {".pi/agent", "custom/agent"}: vars_PI_BENCH_(enable) = {PI_BENCH_DATA ↦ home/dir/bench, PI_BENCH_AGENT_SRC ↦ home/dir} (exact set, so every empty option exports nothing) ∧ package ∈ home.packages ∧ names(home.file) = names(home.file without the module) ∧ failed = ∅ ∧ warnings as without the module.
- `bench-today`: the literal `/home/u/.pi/agent/bench` is the criterion (today's `config.ts:39` default for `HOME=/home/u`); package drvPath = `packages.x86_64-linux.bench.drvPath`.
- `bench-extensions`: PI_BENCH_EXT_DIR = `linkFarm "pi-bench-extensions" extensions` (store-path equality ⇔ same entries).
- `bench-router`: importJSON(PI_BENCH_ROUTER) = router.
- `router.test.ts`: ∀ arm ∈ orchArms(), ∀ base ∈ {unset, {}}: bytes(file(arm, base)) = `JSON.stringify(armKeys(arm), null, 2) + "\n"`, armKeys being host `orch.ts:64-68` at `f6a3c81`; ∀ arm: file(arm, B) holds every key of B the arm does not set, the arm's value at every leaf it sets, and B's siblings under `delegation` and `t0Limits`; keys(recursiveUpdate(l, r)) = keys(l) ++ (keys(r) ∖ keys(l)).

## Planted violations

Tick in the task once seen.

| Check | Plant | Must fail with | Task |
|---|---|---|---|
| `bench` | `packages/bench/test/run.test.ts`: `assert.equal(timeoutSec({}), 5401)` | `✖ timeout default is 5400 s, BENCH_TIMEOUT overrides` (the tests run in `checkPhase`) | M1.1 Step 5 |
| `typecheck-bench` | (natural red) | `src/report.ts:131:83 - error TS7053` | M1.2 Step 2 |
| `bench` | `Object.assign(routerBase(paths.router), {…})` for `recursiveUpdate(…)` | `✖ router base: merged under the arm's keys, deeply; …` | M1.3 Step 5 |
| `bench` | `JSON.stringify(recursiveUpdate(…))` without `, null, 2` | `✖ router unset or {}: every arm's task-router/settings.json is today's, byte for byte` | M1.3 Step 5 |
| `module-eval` | M1.4 Step 2: a case file naming `pkgs`, before the harness change | evaluation error: the case function called without required argument `pkgs` | M1.4 Step 2 |
| `module-eval` | `bench.enable` default `true` (`lib.mkEnableOption … // {default = true;}`) | `FAIL bench-off: PI_BENCH_ variables: …` | M1.5 Step 5 |
| `module-eval` | `dataDir` default `"${config.home.homeDirectory}/.pi/agent/bench"` | `FAIL bench-defaults: PI_BENCH_ variables (custom/agent): …` | M1.5 Step 5 |
| `module-eval` | `lib.optionalAttrs true` for the `extensions` line | `FAIL bench-defaults: PI_BENCH_ variables (.pi/agent): … PI_BENCH_EXT_DIR …` | M1.7 Step 4 |
| `module-eval` | `lib.optionalAttrs true` for the `router` line | `FAIL bench-defaults: PI_BENCH_ variables (.pi/agent): … PI_BENCH_ROUTER = "/nix/store/…-pi-bench-router.json"` | M1.8 Step 4 |

Planner's dry run (2026-10-17, scratch clone under `$TMPDIR`, final state of every snippet): all eight checks green under `git+file://` and under `path:` (`bench` 76 tests, 10 s, 0.15 GiB; `module-eval` 22 cases, 29 s, 0.92 GiB; the rest as in M0); `packages.x86_64-linux` = `["bench"]`; `alejandra --check` clean. Seen red: TS7053 (copy as is); `Object.assign`; no indentation; `dataDir` hard-coded together with `router` unconditional (both `bench-defaults` lines). Not simulated: the `5401`, harness, `enable`-default and `extensions` plants, and the option-missing REDs.

## Coverage gap

- **Real pi.** The suites drive fake `pi` executables; no check runs an arm against a model. The owner's next bench run covers it (unchanged code paths except `materializeAgentDir`'s merge).
- **Session variables in a shell.** The cases read `home.sessionVariables`; that `hm-session-vars.sh` reaches the owner's shells is W1's activation (owner step).
- **The `linkFarm` contents.** Compared by store path, not built; the farm is nixpkgs' `linkFarm`.
- **`router` with store-path context** fails evaluation (D6); documented in the option's description, no case.
- **Host readers of `packages.pi-bench`** (host deploy-wrapper check and stubs): W1.

## Environment (every step)

```sh
source ~/.cache/pi/m0env.sh      # XDG dirs, cd, F (git+file), o, cap, nb, ne, fmt, host (f6a3c81), nbl, addcases
Fp=path:$HOME/projects/nix/pi-economics
nbp() { (ulimit -v $cap && exec timeout -s KILL 900 nix build --no-link -L "$Fp#checks.x86_64-linux.$1" "${o[@]}"); }
```

- `git+file:` sees only indexed files: `git add` new files before `nb`/`ne`.
- `nb` prints no log for an output already in the store (M0 deviation): use `nbl <check>` to see a green log. A green `module-eval` with an unchanged case count is the same derivation as before.
- Plain `git` here; `git dot` only to read the host. Commits unsigned: `git -c commit.gpgsign=false commit -m …`.
- Edits to TypeScript keep the files' tab indentation.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/bench/**` | the bench, copied from host `pkgs/pi-bench` at `f6a3c81` | M1.1 |
| `packages/bench/src/report.ts` | D4 type-only edit | M1.2 |
| `packages/bench/src/{types,config,orch}.ts`, `test/router.test.ts` | `router` base | M1.3 |
| `packages/bench/{README.md,src/orch.ts,test/orch.test.ts}` | citations (comments, docs) | M1.9 |
| `flake.nix` | `packages.x86_64-linux.bench` | M1.1 |
| `checks/default.nix` | checks `bench`, `typecheck-bench` | M1.1, M1.2 |
| `checks/module-eval/default.nix` | case-file arguments (D11); `cases/bench.nix` listed | M1.4, M1.5 |
| `checks/module-eval/cases/bench.nix` | the bench cases | M1.5–M1.8 |
| `modules/bench.nix`, `modules/default.nix` | the component | M1.5–M1.8 |
| `docs/pi-economics.md` | the component's section, checks table | M1.10 |

Interfaces M1 publishes: option `programs.piEconomics.bench.{enable, package, dataDir, workDir, extensions, router, agentsBaseline}` (M5 sets `router`'s default, M6 `extensions`'); `packages.x86_64-linux.bench`; bench env `PI_BENCH_ROUTER`; case files may take `pkgs`.

---

## Tasks

| Task | Delivers | Commit |
|---|---|---|
| M1.0 | read; drift | — |
| M1.1 | the copy, `packages.bench`, check `bench` | `m1: bench package copied from the host` |
| M1.2 | `typecheck-bench`, D4 | `m1(bench): tsc --strict` |
| M1.3 | `PI_BENCH_ROUTER`, deep merge | `m1(bench): router base for orch arms` |
| M1.4 | case files take named arguments | `m1: module-eval case files take the arguments they name` |
| M1.5 | module: `enable`, `package`, `dataDir`, agent source | `m1(bench): module, package and data dir` |
| M1.6 | `workDir`, `agentsBaseline` | `m1(bench): workDir and agentsBaseline` |
| M1.7 | `extensions` | `m1(bench): extensions as a link farm` |
| M1.8 | `router` | `m1(bench): router option` |
| M1.9 | citations re-pointed (§2) | `m1(bench): re-point citations of the host's documents` |
| M1.10 | docs | `m1: docs for bench` |
| M1.11 | gate, Execution Record | `m1: execution record` |

Every task starts at `[ ]`. Order as numbered. Never more than one red check at a time (M1.3's RED reds `bench` and `typecheck-bench` for one cause, the missing export).

### Task M1.0 — Read, and check drift

- [ ] **Step 1:** read "Files to read first".
- [ ] **Step 2 (drift, §9):**

```sh
(cd ~/projects/nixos/new && git dot diff --stat f6a3c81 -- pkgs/pi-bench \
  modules/home-manager/features/ai/pi-settings-migrate.nix checks/pi-settings-migrate \
  checks/pi-retry/package.json checks/pi-retry/package-lock.json \
  modules/home-manager/features/ai/pi-extensions.nix; echo "rc=$?")
```

Expected: no file line, `rc=0`. A listed file is drift: stop and report; it is ported first, with its test.

### Task M1.1 — The copy, `packages.bench`, check `bench`

**Files:** `flake.nix`, `checks/default.nix` (S1); create `packages/bench/**`.

- [ ] **Step 1:** add the `packages` line to `flake.nix` and the `bench` check to `checks/default.nix` as in S1 (not yet `typecheck-bench`).
- [ ] **Step 2 (RED):** `nb bench` → evaluation error: `path '…/packages/bench/package.nix' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):**

```sh
mkdir -p packages
(cd ~/projects/nixos/new && git dot archive f6a3c81 -- pkgs/pi-bench) | tar -x -C packages --strip-components=1
mv packages/pi-bench packages/bench
h=$(mktemp -d) && (cd ~/projects/nixos/new && git dot archive f6a3c81 -- pkgs/pi-bench) | tar -x -C "$h" --strip-components=1
diff -r "$h/pi-bench" packages/bench && echo identical; rm -rf "$h"
git add packages/bench flake.nix checks/default.nix
git ls-files -s packages/bench/bin | cut -c1-6 | sort -u     # 100755
nbl bench
```

Expected: `identical`; mode `100755` for both shims; the log ends with `ℹ tests 71`, `ℹ pass 71`, `ℹ fail 0`.
- [ ] **Step 4:** `nb leak` → passes (the package is scanned); `ne packages.x86_64-linux --apply builtins.attrNames --json` → `["bench"]`.
- [ ] **Step 5 (planted):** `sed -i 's/timeoutSec({}), 5400)/timeoutSec({}), 5401)/' packages/bench/test/run.test.ts; nb bench` → fails with `✖ timeout default is 5400 s, BENCH_TIMEOUT overrides`. `git checkout packages/bench/test/run.test.ts`.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt flake.nix checks/default.nix`; `git status --short` lists only the files above. Commit.

### Task M1.2 — `typecheck-bench`

**Files:** `checks/default.nix` (S1, the `typecheck-bench` entry), `packages/bench/src/report.ts` (S2).

- [ ] **Step 1:** add `typecheck-bench` to `checks/default.nix` (S1).
- [ ] **Step 2 (RED):** `nb typecheck-bench` → fails, single error `src/report.ts:131:83 - error TS7053: Element implicitly has an 'any' type …`, `Found 1 error`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the edit of S2. `nb typecheck-bench` → passes.
- [ ] **Step 4 (behaviour kept, §8.1):** `nbl bench` → `ℹ pass 71`, `ℹ fail 0`; `git diff -U0 packages/bench/src/report.ts` shows exactly the lines of S2 (two changed, one added, all types).
- [ ] **Step 5 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M1.3 — Router base in the bench

**Files:** create `packages/bench/test/router.test.ts` (S3); modify `packages/bench/src/{types,config,orch}.ts` (S4).

- [ ] **Step 1:** write `test/router.test.ts` (S3). `git add packages/bench/test/router.test.ts`.
- [ ] **Step 2 (RED):** `nb bench` → fails; the log names `test/router.test.ts` with `SyntaxError: The requested module '../src/orch.ts' does not provide an export named 'recursiveUpdate'`. (`typecheck-bench` is red too, TS2305, same cause.)
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the three edits of S4. `nbl bench` → `ℹ tests 76`, `ℹ pass 76`; the five `router.test.ts` names appear with `✔`. `nb typecheck-bench` → passes.
- [ ] **Step 4:** the copied suites are untouched: `git diff --stat packages/bench/test` lists nothing (the new file is staged as added, no copied file modified).
- [ ] **Step 5 (planted):** (a) in `orch.ts` replace `JSON.stringify(recursiveUpdate(routerBase(paths.router), {` by `JSON.stringify(Object.assign(routerBase(paths.router), {` → `nb bench` fails with `✖ router base: merged under the arm's keys, deeply; …`; restore. (b) replace that writer's `}), null, 2) + "\n");` by `})) + "\n");` → `✖ router unset or {}: …`; restore. Restore with `git checkout` only if the file was committed; otherwise undo the `sed`/edit by hand and check `git diff` against S4.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 6 (CLEAN):** `nb bench` and `nb typecheck-bench` green. Commit.

### Task M1.4 — Case files take the arguments they name (refactor)

**Files:** `checks/module-eval/default.nix` (S5, the `f`/`new` lines only).

- [ ] **Step 1 (before):** `nbl module-eval` → `module-eval: 16 cases passed`.
- [ ] **Step 2 (planted RED):** create `checks/module-eval/cases/bench.nix` as `{pkgs, ...}: {}` and add it to `caseFiles`; `git add` it; `nb module-eval` → evaluation error, the function called without required argument `pkgs`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the `f`/`new` lines of S5. `nb module-eval` → passes (`16 cases passed`, the empty file adds none).
- [ ] **Step 4 (after):** remove the placeholder file and its `caseFiles` line (`git rm -q --cached checks/module-eval/cases/bench.nix; rm …`); `nbl module-eval` → `module-eval: 16 cases passed`, as in Step 1.
- [ ] **Step 5 (CLEAN):** `fmt checks/module-eval/default.nix`. Commit.

### Task M1.5 — Module: `enable`, `package`, `dataDir`, agent source

**Files:** create `modules/bench.nix` (S6 without the options and lines tagged M1.6–M1.8), `checks/module-eval/cases/bench.nix` (S7: `bench-off`, `bench-defaults`, `bench-today`); modify `modules/default.nix` (S8), `checks/module-eval/default.nix` (`./cases/bench.nix` in `caseFiles`).

- [ ] **Step 1:** write the case file with the three cases; list it in `caseFiles`. `git add checks/module-eval/cases/bench.nix`.
- [ ] **Step 2 (RED):** `nb module-eval` → evaluation error `The option `programs.piEconomics.bench' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** `modules/bench.nix` with `enable`, `package`, `dataDir` and the config block whose `sessionVariables` has only `PI_BENCH_DATA` and `PI_BENCH_AGENT_SRC`; the import in `modules/default.nix`. `git add modules/bench.nix`. `nbl module-eval` → `module-eval: 19 cases passed`.
- [ ] **Step 4:** `nb leak` passes.
- [ ] **Step 5 (planted):** (a) `enable = lib.mkEnableOption "…" // {default = true;};` → `FAIL bench-off: PI_BENCH_ variables: expected { }, got { … }`; revert. (b) `dataDir` default `"${config.home.homeDirectory}/.pi/agent/bench"` → `FAIL bench-defaults: PI_BENCH_ variables (custom/agent): …`; revert.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 6 (CLEAN):** `fmt modules/bench.nix modules/default.nix checks/module-eval/default.nix checks/module-eval/cases/bench.nix`. Commit.

### Task M1.6 — `workDir`, `agentsBaseline`

**Files:** `modules/bench.nix` (S6, tagged M1.6), `checks/module-eval/cases/bench.nix` (S7 `bench-paths`).

- [ ] **Step 1:** add `bench-paths`.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.bench.workDir' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the two options and their two `optionalAttrs` lines. `nbl module-eval` → `20 cases passed` (`bench-defaults` stays green: `null` exports nothing).
- [ ] **Step 4 (CLEAN):** `fmt` both files. Commit.

### Task M1.7 — `extensions`

**Files:** `modules/bench.nix` (S6, tagged M1.7), `checks/module-eval/cases/bench.nix` (S7 `bench-extensions`).

- [ ] **Step 1:** add `bench-extensions`.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.bench.extensions' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the option and its `optionalAttrs (cfg.extensions != {})` line. `nbl module-eval` → `21 cases passed`.
- [ ] **Step 4 (planted):** `lib.optionalAttrs true` for that line → `FAIL bench-defaults: PI_BENCH_ variables (.pi/agent): … PI_BENCH_EXT_DIR …`; revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files. Commit.

### Task M1.8 — `router`

**Files:** `modules/bench.nix` (S6, tagged M1.8), `checks/module-eval/cases/bench.nix` (S7 `bench-router`).

- [ ] **Step 1:** add `bench-router`.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.bench.router' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the option and its `optionalAttrs (cfg.router != {})` line. `nbl module-eval` → `22 cases passed`.
- [ ] **Step 4 (planted):** `lib.optionalAttrs true` for that line → `FAIL bench-defaults: PI_BENCH_ variables (.pi/agent): … PI_BENCH_ROUTER = "/nix/store/…-pi-bench-router.json"; }` (and the `custom/agent` line); revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files; S6 and S7 now hold in full (`diff` the files with the snippets). Commit.

### Task M1.9 — Re-point citations (§2)

**Files:** `packages/bench/src/orch.ts`, `packages/bench/test/orch.test.ts`, `packages/bench/README.md` (S9). Comment and doc lines only; the test file's change is its first comment line (§2 requires it; no test changes).

- [ ] **Step 1:** the edits of S9.
- [ ] **Step 2:** `grep -rnE '§5\.6\.5|T10\.5|T0\.3|plan S14' packages/bench; echo "rc=$?"` → no line, `rc=1`.
- [ ] **Step 3 (behaviour kept):** `git diff -U0 packages/bench/src packages/bench/test | grep '^[-+][^-+]'` shows only lines starting with `/**` or `//`; `nbl bench` → `ℹ pass 76`; `nb typecheck-bench`, `nb leak` pass.
- [ ] **Step 4:** commit.

### Task M1.10 — Docs

**Files:** `docs/pi-economics.md` (S10).

- [ ] **Step 1:** add the section and the two check rows of S10.
- [ ] **Step 2:** every option is named:

```sh
for p in enable package dataDir workDir extensions router agentsBaseline PI_BENCH_DATA PI_BENCH_AGENT_SRC PI_BENCH_WORK PI_BENCH_EXT_DIR PI_BENCH_ROUTER PI_BENCH_AGENTS_OFF; do
  grep -qF "\`$p\`" docs/pi-economics.md || echo "MISSING $p"
done
```

Expected: no `MISSING`. `nb leak` passes.
- [ ] **Step 3:** commit.

### Task M1.11 — Gate and Execution Record

- [ ] **Step 1 (the gate, both refs):**

```sh
for ref in "$F" "$Fp"; do
  names=$( (ulimit -v $cap && exec timeout -s KILL 300 nix eval --json "$ref#checks.x86_64-linux" --apply builtins.attrNames "${o[@]}") ) &&
    names=$(jq -er '.[]' <<<"$names") || echo "LISTING FAILED $ref"
  echo "$ref: $(echo $names)"
  for c in $names; do
    /usr/bin/env time -f "$c: %M KiB peak, %e s" bash -c "ulimit -v $cap && exec timeout -s KILL 900 nix build --no-link '$ref#checks.x86_64-linux.$c' --option eval-cache false" || echo "FAILED $c ($ref)"
  done
done
ne packages.x86_64-linux --apply builtins.attrNames --json
ne homeModules --apply builtins.attrNames --json
ne formatter.x86_64-linux.drvPath --raw; echo
fmt --check $(git ls-files '*.nix')
```

Expected, per ref: `bench leak leak-selftest module-eval npm-deps pi-settings-migrate typecheck-bench typecheck-harness`; no `FAILED`; `["bench"]`; `["default"]`; a `.drv`; Alejandra clean. For honest timings delete each output first (`nbl`'s way), at least for the `git+file:` pass.
- [ ] **Step 2:** `git ls-files -s packages/bench/bin` still `100755`.
- [ ] **Step 3:** drift again (M1.0 Step 2), and `git dot diff --stat <M1.0's host HEAD> HEAD -- pkgs/pi-bench`: empty, or ported first.
- [ ] **Step 4:** fill `# Execution Record`: date, commit per task, boxes ticked, red messages seen, the gate's peaks and times, deviations, answers to the open questions.
- [ ] **Step 5:** commit.

---

## Snippets

### S1 — `flake.nix`, `checks/default.nix`

`flake.nix`, after `homeModules.default = ./modules;`:

```nix
    # One package per component (spec §3); the module's `package` default
    # builds the same derivation from the consumer's pkgs.
    packages.${system}.bench = pkgs.callPackage ./packages/bench/package.nix {};
```

`checks/default.nix`, at the end of the attrset (`typecheck-bench` from M1.2):

```nix
  # The bench's own tests run when its code builds (spec §8.1, "Package tests").
  bench = self.packages.${pkgs.stdenv.hostPlatform.system}.bench.code;
  typecheck-bench = typecheck.typecheck {
    name = "bench";
    src = ../packages/bench;
  };
```

### S2 — `packages/bench/src/report.ts` (D4)

```diff
-const CONTRAST: Metric[] = ["pass", "score", "wallMin", "costUsd"];
+type ContrastMetric = "pass" | "score" | "wallMin" | "costUsd";
+const CONTRAST: ContrastMetric[] = ["pass", "score", "wallMin", "costUsd"];
 
 export type LevelStats = { level: string; n: number; metrics: Record<Metric, CI> };
-export type Contrast = { level: string; vs: string } & Record<"pass" | "score" | "wallMin" | "costUsd", CI>;
+export type Contrast = { level: string; vs: string } & Record<ContrastMetric, CI>;
```

### S3 — `packages/bench/test/router.test.ts`

```ts
// Spec §7, `router`: the base of every orch arm's task-router/settings.json (PI_BENCH_ROUTER), merged
// under the arm's own keys as Nix's lib.recursiveUpdate does. Unset or {}, an arm's file is today's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "../src/config.ts";
import { T0_LIMITS, materializeAgentDir, orchArms, recursiveUpdate } from "../src/orch.ts";
import { tmp } from "./helpers.ts";

/** An agent source with both AGENTS.md variants; `router`, when given, is written to a file and exported. */
function paths(router?: unknown) {
	const home = tmp();
	const src = join(home, ".pi/agent");
	mkdirSync(join(src, "notes"), { recursive: true });
	writeFileSync(join(src, "AGENTS.md"), "on\n");
	writeFileSync(join(src, "notes/2026-10-03-AGENTS.md.before"), "off\n");
	const env: Record<string, string> = { HOME: home, PI_BENCH_EXT_DIR: "/ext", PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp() };
	if (router !== undefined) {
		env.PI_BENCH_ROUTER = join(tmp(), "router.json");
		writeFileSync(env.PI_BENCH_ROUTER, JSON.stringify(router));
	}
	return resolvePaths(env, "/pkg");
}

/** The task-router settings file an arm writes. */
function routerFile(id: string, p: ReturnType<typeof paths>): string {
	const dir = join(tmp(), "agent");
	materializeAgentDir({ dir, arm: orchArms()[id], paths: p });
	return readFileSync(join(dir, "task-router/settings.json"), "utf8");
}

/** The arm's own keys, as the writer at host f6a3c81 (orch.ts:64-68) put them. */
function armKeys(id: string) {
	const f = orchArms()[id].factors!;
	return { routing: f.routing === "on", delegation: { nudge: f.delegation }, t0Limits: T0_LIMITS[f.t0Widened as "off" | "on"] };
}

test("resolvePaths: PI_BENCH_ROUTER names the router base; unset, there is none", () => {
	assert.equal(resolvePaths({ HOME: "/h" }, "/pkg").router, undefined);
	assert.equal(resolvePaths({ HOME: "/h", PI_BENCH_ROUTER: "/r.json" }, "/pkg").router, "/r.json");
});

test("router unset or {}: every arm's task-router/settings.json is today's, byte for byte", () => {
	for (const id of Object.keys(orchArms())) {
		const today = JSON.stringify(armKeys(id), null, 2) + "\n";
		assert.equal(routerFile(id, paths()), today, `${id}, unset`);
		assert.equal(routerFile(id, paths({})), today, `${id}, {}`);
	}
});

test("router base: merged under the arm's keys, deeply; base keys the arm does not set survive", () => {
	const base = {
		models: { worker: "m1", local: "m2" },
		localHealthUrl: "http://h:1",
		routing: true,
		delegation: { nudge: "x", handoff: true },
		t0Limits: { files: 99, extra: 1 },
		randomize: { enabled: false },
	};
	for (const id of Object.keys(orchArms())) {
		const got = JSON.parse(routerFile(id, paths(base)));
		const arm = armKeys(id);
		assert.deepEqual(got, {
			models: base.models,
			localHealthUrl: base.localHealthUrl,
			routing: arm.routing,
			delegation: { nudge: arm.delegation.nudge, handoff: true },
			t0Limits: { ...arm.t0Limits, extra: 1 },
			randomize: base.randomize,
		}, id);
	}
});

test("recursiveUpdate: right wins; objects recurse; lists and scalars are replaced whole; left's key order", () => {
	assert.deepEqual(recursiveUpdate({ a: [1, 2], b: { c: 1, d: 2 }, e: { f: 1 }, g: 1 }, { a: [3], b: { c: 9 }, e: 5, h: { i: 1 } }),
		{ a: [3], b: { c: 9, d: 2 }, e: 5, g: 1, h: { i: 1 } });
	assert.deepEqual(Object.keys(recursiveUpdate({ z: 1, a: 1 }, { m: 1, z: 2 })), ["z", "a", "m"]);
	assert.deepEqual(Object.keys(recursiveUpdate({}, { z: 1, a: 1 })), ["z", "a"]);
});

test("router base: a missing file or a non-object is an error naming the file", () => {
	const missing = { ...paths(), router: "/nonexistent/router.json" };
	assert.throws(() => routerFile("orch----", missing), /router base not found: \/nonexistent\/router\.json/);
	const list = paths([1]);
	assert.throws(() => routerFile("orch----", list), /router base is not a JSON object: .*router\.json/);
});
```

### S4 — `packages/bench/src/{types,config,orch}.ts`

`types.ts`, in `Paths` after `agentsOff`:

```ts
	router?: string; // JSON file (PI_BENCH_ROUTER): the base of an orch arm's task-router/settings.json; unset = {}
```

`config.ts`, in `resolvePaths`'s object after `agentsOff`:

```ts
		router: env.PI_BENCH_ROUTER,
```

`orch.ts`: add `readFileSync` to the `node:fs` import; after `const on = …;` insert:

```ts
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Nix's lib.recursiveUpdate: right wins; where both sides hold an object the merge recurses; lists and scalars are replaced whole. */
export function recursiveUpdate(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...left };
	for (const [k, v] of Object.entries(right)) {
		const l = out[k];
		out[k] = isObject(l) && isObject(v) ? recursiveUpdate(l, v) : v;
	}
	return out;
}

/** The base of every orch arm's task-router settings (paths.router, PI_BENCH_ROUTER): {} when unset. */
export function routerBase(file: string | undefined): Record<string, unknown> {
	if (file === undefined) return {};
	if (!existsSync(file)) throw new Error(`router base not found: ${file}`);
	const base: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!isObject(base)) throw new Error(`router base is not a JSON object: ${file}`);
	return base;
}
```

and the writer in `materializeAgentDir`:

```diff
-	put("task-router/settings.json", JSON.stringify({
+	put("task-router/settings.json", JSON.stringify(recursiveUpdate(routerBase(paths.router), {
 		routing,
 		delegation: { nudge: on(f.delegation) ? "on" : "off" },
 		t0Limits: T0_LIMITS[on(f.t0Widened) ? "on" : "off"],
-	}, null, 2) + "\n");
+	}), null, 2) + "\n");
```

### S5 — `checks/module-eval/default.nix`

```diff
   caseFiles = [
     ./cases/common.nix
+    ./cases/bench.nix
   ];
   cases =
     lib.foldl' (
       acc: file: let
-        new = import file {inherit lib hm self expect;};
+        f = import file;
+        # A case file takes the arguments it names.
+        new = f (builtins.intersectAttrs (lib.functionArgs f) {inherit lib pkgs hm self expect;});
         dup = lib.intersectLists (lib.attrNames acc) (lib.attrNames new);
```

(M1.4 adds the `f`/`new` lines; M1.5 the `caseFiles` line.)

### S6 — `modules/bench.nix` (state after M1.8)

M1.5 writes the file without the options tagged `(M1.6)`–`(M1.8)` and without their `optionalAttrs` lines; each later task adds its own.

```nix
# The bench (spec §7): pi-bench and bench-report on PATH, configured through
# session variables. Every option at its empty default exports nothing, and the
# bench keeps its own default for it (packages/bench/src/config.ts).
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.bench;
  agentSrc = "${config.home.homeDirectory}/${pe.agentDir}";
in {
  options.programs.piEconomics.bench = {
    enable = lib.mkEnableOption "the pi-bench harness (pi-bench, bench-report)";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/bench/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/bench/package.nix { }";
      description = "The bench; its tests run when it builds.";
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "${agentSrc}/bench";
      defaultText = lib.literalExpression ''"''${config.home.homeDirectory}/''${config.programs.piEconomics.agentDir}/bench"'';
      description = "Tasks, runs, judgements and reports (`PI_BENCH_DATA`).";
    };

    # (M1.6)
    workDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Checkouts and caches (`PI_BENCH_WORK`). `null` exports nothing: the
        bench then uses `$XDG_RUNTIME_DIR/pi/tmp/bench`, or `/tmp/pi/tmp/bench`
        without `XDG_RUNTIME_DIR`.
      '';
    };

    # (M1.7)
    extensions = lib.mkOption {
      type = lib.types.attrsOf lib.types.path;
      default = {};
      example = lib.literalExpression ''{ claude-auth = "''${pi-claude-auth}"; }'';
      description = ''
        The extensions a bench arm loads, by the name the arm uses. Data, not
        the registry: the arms load extensions the registry does not hold, and
        leave out some it does. Exported as a directory of links
        (`PI_BENCH_EXT_DIR`); `{}` exports nothing, and the bench looks the
        names up in `~/.pi/agent/extensions`.
      '';
    };

    # (M1.8)
    router = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      description = ''
        The base of the `task-router/settings.json` an orchestrator arm writes;
        the arm's own keys (`routing`, `delegation`, `t0Limits`) are merged over
        it as `lib.recursiveUpdate` does. Exported as a JSON file
        (`PI_BENCH_ROUTER`, made with `builtins.toFile`, so no value may carry
        a store path's context); `{}` exports nothing, and an arm's file is the
        arm's keys alone.
      '';
    };

    # (M1.6)
    agentsBaseline = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        The AGENTS.md of the arms without routing (`PI_BENCH_AGENTS_OFF`).
        `null` exports nothing: the bench then uses its default under the agent
        source.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [cfg.package];
    home.sessionVariables =
      {
        PI_BENCH_DATA = cfg.dataDir;
        # Credentials, model definitions, the infinite-context settings and the
        # two AGENTS.md defaults come from here (spec §7, "Agent source").
        PI_BENCH_AGENT_SRC = agentSrc;
      }
      // lib.optionalAttrs (cfg.workDir != null) {PI_BENCH_WORK = cfg.workDir;}
      // lib.optionalAttrs (cfg.extensions != {}) {
        PI_BENCH_EXT_DIR = "${pkgs.linkFarm "pi-bench-extensions" cfg.extensions}";
      }
      // lib.optionalAttrs (cfg.router != {}) {
        PI_BENCH_ROUTER = builtins.toFile "pi-bench-router.json" (builtins.toJSON cfg.router);
      }
      // lib.optionalAttrs (cfg.agentsBaseline != null) {PI_BENCH_AGENTS_OFF = cfg.agentsBaseline;};
  };
}
```

(Prototyped as written, tags included: `alejandra --check` clean, `module-eval` green.)

### S7 — `checks/module-eval/cases/bench.nix` (state after M1.8)

```nix
# Cases for modules/bench.nix (spec §7).
{
  lib,
  pkgs,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  fx = ../fixtures;
  benchVars = cfg: lib.filterAttrs (n: _: lib.hasPrefix "PI_BENCH_" n) cfg.home.sessionVariables;
  on = extra: hm.eval {programs.piEconomics.bench = {enable = true;} // extra;};
in {
  # (M1.5) Off by default: no variable, no package.
  bench-off = let
    c = hm.eval {};
    b = hm.evalBare {};
  in
    eq "PI_BENCH_ variables" (benchVars c) {}
    ++ eq "home.packages" (map toString c.home.packages) (map toString b.home.packages);

  # (M1.5) Enabled with defaults: the package and the two variables that
  # follow agentDir. Every other option is empty and exports nothing.
  bench-defaults = lib.concatMap (dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        bench.enable = true;
      };
    };
    src = "${c.home.homeDirectory}/${dir}";
  in
    eq "PI_BENCH_ variables (${dir})" (benchVars c) {
      PI_BENCH_DATA = "${src}/bench";
      PI_BENCH_AGENT_SRC = src;
    }
    ++ holds "home.packages holds the bench (${dir})" (lib.elem (toString (pe c).bench.package) (map toString c.home.packages))
    ++ eq "home.file names (${dir})" (lib.attrNames c.home.file) (lib.attrNames (hm.evalBare {}).home.file)
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings (hm.evalBare {}).warnings)
  [".pi/agent" "custom/agent"];

  # (M1.5) With the default agentDir, PI_BENCH_DATA is the bench's own default
  # (packages/bench/src/config.ts, `data`); the default package is the flake's.
  bench-today = let
    c = on {};
  in
    eq "PI_BENCH_DATA" c.home.sessionVariables.PI_BENCH_DATA "/home/u/.pi/agent/bench"
    ++ eq "package" (pe c).bench.package.drvPath self.packages.x86_64-linux.bench.drvPath;

  # (M1.6)
  bench-paths = let
    v =
      (on {
        dataDir = "/d";
        workDir = "/w";
        agentsBaseline = "/b.md";
      }).home.sessionVariables;
  in
    eq "PI_BENCH_DATA" v.PI_BENCH_DATA "/d"
    ++ eq "PI_BENCH_WORK" v.PI_BENCH_WORK "/w"
    ++ eq "PI_BENCH_AGENTS_OFF" v.PI_BENCH_AGENTS_OFF "/b.md";

  # (M1.7) One link per name, in a directory of links.
  bench-extensions = let
    exts = {
      ext-a = fx + "/ext-a";
      ext-b = fx + "/ext-b";
    };
    v = (on {extensions = exts;}).home.sessionVariables;
  in
    eq "PI_BENCH_EXT_DIR" v.PI_BENCH_EXT_DIR "${pkgs.linkFarm "pi-bench-extensions" exts}";

  # (M1.8) The router base as a JSON file, read back without building.
  bench-router = let
    router = {
      models.worker = "m";
      localHealthUrl = "http://h:1";
      randomize.enabled = false;
    };
    v = (on {inherit router;}).home.sessionVariables;
  in
    eq "PI_BENCH_ROUTER" (lib.importJSON v.PI_BENCH_ROUTER) router;
}
```

(`fx` is M0's `checks/module-eval/fixtures`, with `ext-a`, `ext-b`.)

### S8 — `modules/default.nix`

```nix
# Every module of the flake. Only this one is exported (homeModules.default).
{
  imports = [
    ./common.nix
    ./bench.nix
  ];
}
```

### S9 — Citations (§2)

`packages/bench/src/orch.ts`:

```diff
-/** Spec §5.6.5: routing, delegation (handoff + nudge), t0Widened (pilot-derived limits). */
+/** The factors (README.md, "Orchestrator factor arms"): routing, delegation (handoff + nudge), t0Widened (pilot-derived limits). */
-/** t0Limits per t0Widened level: "off" = the spec defaults, "on" = pilot-derived (T0.3). */
+/** t0Limits per t0Widened level: "off" = the limits before the pilot, "on" = pilot-derived. */
```

`packages/bench/test/orch.test.ts`, line 1:

```diff
-// T10.5 orchestrator factor arms: the 2^(3-1) half fraction over routing × delegation × t0Widened, and the
+// Orchestrator factor arms (README.md): the 2^(3-1) half fraction over routing × delegation × t0Widened, and the
```

`packages/bench/README.md`:

```diff
-Bench harness for the pi token-economics work (plan S14). Code and fixtures live here;
+Bench harness for the pi token-economics work. Code and fixtures live here;
@@
-nix build .#pi-bench          # pi-bench, bench-report (tests run at build time)
-nix build .#checks.x86_64-linux.pi-bench
+nix build .#bench             # pi-bench, bench-report (tests run at build time)
+nix build .#checks.x86_64-linux.bench
@@
-## Orchestrator factor arms (spec §5.6.5, plan T10.5)
+## Orchestrator factor arms
@@
-Sources are overridable: `PI_BENCH_AGENT_SRC`, `PI_BENCH_AGENTS_ON`, `PI_BENCH_AGENTS_OFF`. Arms with `factors`
+Sources are overridable: `PI_BENCH_AGENT_SRC`, `PI_BENCH_AGENTS_ON`, `PI_BENCH_AGENTS_OFF`. `PI_BENCH_ROUTER` names a JSON
+file that is the base of `task-router/settings.json`: the arm's keys are merged over it as `lib.recursiveUpdate` does
+(unset: the arm's keys alone). Arms with `factors`
```

### S10 — `docs/pi-economics.md`

Before `## Checks`:

```markdown
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
| `extensions` | `{}` (the bench: `~/.pi/agent/extensions`) | `PI_BENCH_EXT_DIR`, a `linkFarm` of name → path |
| `router` | `{}` (an arm's file: its own keys) | `PI_BENCH_ROUTER`, a JSON file; an orch arm merges its `routing`, `delegation`, `t0Limits` over it as `lib.recursiveUpdate` does |
| `agentsBaseline` | `null` (the bench: `<agent source>/notes/…`) | `PI_BENCH_AGENTS_OFF` |
```

Rows for the checks table:

```markdown
| `bench` | the bench's own tests (`node --test`), run when its code builds |
| `typecheck-bench` | `tsc --strict` over the bench |
```

---

## Open questions

Each with the planner's proposed decision; the plan follows the proposal.

- **Q1 (D5).** §7 says `extensions` reaches the bench as a `linkFarm` and `router` as a JSON file, without saying what an empty value exports. Proposal: nothing, like `workDir`/`agentsBaseline`'s `null`, so the bench keeps its defaults.
- **Q2 (D1).** Flake output `packages.x86_64-linux.bench` (component name), not `pi-bench`. The host's deploy-wrapper check reads the host's own `packages.pi-bench`; proposal: W1 decides whether the host keeps that output (pointing at `programs.piEconomics.bench.package`) or re-points the check.
- **Q3 (D8).** A missing or non-object `PI_BENCH_ROUTER` file is an error, not `{}`. Proposal: accept (reachable only through the new variable).
- **Q4 (D12).** §2's re-pointing for the bench happens in M1, to the package README, since the moved doc arrives last. Proposal: accept; later milestones do the same for their packages.
- **Q5 (D13).** `packages/bench/README.md` stays next to the package (AGENTS.md exempts `README.md`). Proposal: accept; P may fold it into `docs/`.
- **Q6 (D14).** The probe's inline type becomes a named alias in M2, with its comparison. Proposal: accept.
- **Q7 (D11).** The module-eval harness now passes case files only the arguments they name. Proposal: accept; M0's interface ("a milestone adds `./cases/<component>.nix`") is unchanged.

# Execution Record
