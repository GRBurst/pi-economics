# M5 — `taskRouter`: TDD plan

Date: 2026-10-25 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 with its "Amendment (2026-10-25, order)" in §6.1, §9, §9.1 · Milestone: M5 (§9) · Base: this repository at the **planned end of M6** (plan `docs/plans/2026-10-17-m6-infinite-context-retry-plan.md`; impl-m6 was executing it while this plan was written, HEAD `d7b1162`).

**R'** (defined once; every later mention means this): the host dotfiles commit that lands the review fixes of the router redesign's Group 2 on top of `f1b140e` ("docs: task-router plan record: Group 2"), as the redesign plan's `# Execution Record` names it (host `docs/plans/2026-10-17-task-router-abilities-plan.md`). Not yet named while this plan was written. Task M5.0 sets the shell variable `RP` to its id and records it; every command below uses `$RP`. The prototype stood on `f1b140e` (see "Prototype").

Source paths at R' (`ai` = `modules/home-manager/features/ai`, read with `hr <path>` = `git dot show "$RP:projects/nixos/new/<path>"`):

- copied: `$ai/extensions/task-router/` **without** `nix/` (replaced by `packages/task-router/package.nix` and `modules/task-router.nix`) and **without** `test/host-replay.test.ts`, `test/host-fixtures/` (host data, redesign spec §6.6, pi-economics spec §6.3); `checks/pi-log-contract/contract.ts` (part 1 of the host's log contract; part 2 is M3's `analysis-skill-contract`);
- read only: `$ai/extensions/task-router/nix/{package.nix,hm-module.nix}`; `$ai/pi-extensions.nix` (the `task-router` registry entry, `:205-215` at `f1b140e`); `checks/pi-log-contract/default.nix`; `checks/pi-extensions.nix` (`:61-64`, `:224-226`, `:261`, `:275` at `f1b140e`); `homes/pallon/default.nix:197-209` (the host's `taskRouter.settings`); host `flake.nix` (`pi-task-router`, `:299` at `f1b140e`); `docs/pi-token-economics.md` (M5.D).

Drift checked while planning: `git dot diff --stat 4c714f0 f1b140e -- <every path M0–M4 and M6 moved, $ai/pi-extensions.nix, checks/pi-log-contract, checks/pi-extensions.nix, homes/pallon/default.nix, docs/pi-token-economics.md, flake.nix, flake.lock>` is empty (`4c714f0` is M6's source commit). Task M5.0 checks again against R'.

The host is **read-only** (other agents commit there with pathspecs): `git dot show`/`archive`/`diff` only.

## Prototype

Scratch clone of this repository at `07f8f0e` (M4's end; M6 not landed) plus the router at **`f1b140e`** standing in for R', under `$TMPDIR/m5proto` (2026-10-25). What stood in: `f1b140e` for R'; M4's end for M6's end (no `infiniteContext`/`retry` modules, so no host-like case and no bench-extension defaults were prototyped); the bench and module cases were not prototyped. Artefacts in `~/.cache/pi/m5plan/`: `generate.ts` (the golden generator), `golden-f1b140e.txt` (its output on `f1b140e`), `free-cloud-slot.test.ts` (P2), `tsc-edits.diff` (the type-only edits against `f1b140e`), `prototype-nontr.diff` (everything outside `packages/task-router`).

Measured:

- The copied suite: 346 tests, 0 failures, 14 s (the host's 348 minus `host-replay.test.ts`' two).
- `typecheck-task-router`: 26 errors in 9 test files (`core/` and `index.ts` clean); after the edits of S4, 0. Both interface comparisons failed only on those 26 (the consumer's tree is type-checked whole) and were green after them.
- The generator: 754 lines, 101 KB, 20 s per run; `f1b140e` and the edited copy give byte-equal output. A plant in the write table changes 234 lines; one in `pickQwen` changes 1 line.
- The P2 test: green on `f1b140e`, red on a planted `pickQwen` that ignores the cap.
- The host's `contract.ts` with its 10 import paths re-pointed to `packages/`: `pi-log-contract: ok (meter 28, outcomes 6, assignments 2, guards 5)` against this repository's token-meter, cache-lifecycle, experiments and the copied router.

## Motivation

§9 row M5: `taskRouter` from R' (§6, amended), with its golden test; drift from R'; the bench's `router` default from `taskRouter` (§7); the log-contract check (all four packages present, §8.1); the bench's `extensions` default gains `task-router` (M6 D11, Q3: per-name `mkDefault`); and, if M6 handed it over, the doc move (M6.D). The router moves as it stands after the redesign's Group 2 and its review fixes: abilities and levels per member (`planSpawn` on `importanceTable`, `members`, profiles with `ability`/`level`/`minLevel`), with the Qwen chain (`pickQwen`) still resolving Qwen legs until the redesign's Group 3. P1–P5 are checked against R'; one that fails is recorded and handed to the redesign's remaining groups, which continue in this flake after W (§6.1 amendment). The move is pure: no routing decision, default or log field changes; `tsc --strict` forces type-only edits in nine test files and one exported alias in `core/shell.ts`, which the golden test and the unchanged suite count show to be inert.

## Approach

- **Package:** `packages/task-router/` = R'’s directory without `nix/` and `test/host-*`; `package.nix` = R'’s `nix/package.nix` with `../package.json` → `./package.json`, `./..` → `./.`, a new header (M3 D1, M4 D1). Output `packages.x86_64-linux.task-router`; check `task-router` (the package: its `checkPhase` runs `node --test`).
- **Neutral fixture names (§8.3):** of R'’s six `earth` occurrences, only `test/members.test.ts:61` is a fixture that feeds a test alone; it becomes `lan`. The two default-asserting tests (`settings.test.ts:29`, `policy.test.ts:82`), the default itself (`core/settings.ts:29`), its frozen oracle copy (`test/oracle/legacy-settings.ts:20`, "never edit") and the today fixture (`test/fixtures/today-config.json:13`, which mirrors the default) stay until P (§8.3).
- **P2's test:** R'’s suite tests one of P2's three conditions (`cloud.test.ts:84`, no cloud route). `test/free-cloud-slot.test.ts` (new, S3) tests all three, local up and down; it runs against R'’s code first.
- **Golden test (§6.3):** `checks/router-golden/generate.ts <router dir>` imports the router's own golden grid (`test/golden/grid.ts`), its production adapter (`test/golden/sut.ts`, `sutSpawn` → `planSpawn`), `core/settings.ts` and `core/policy.ts`, and prints every decision of `planSpawn` over the grid (146,880 plan cases, 470,016 explicit cases) and of `resolveLeg` over the Qwen chain's 96 states, under R'’s defaults and the fixture `EMPTY_SLOT`. Rows of labels are interned; each grid line holds 64 row ids, one per t0 vector (S5). Run once by hand on a host checkout at R' → `checks/router-golden/golden.txt`, header `# R' = <id>`. The check `router-golden` runs it on `packages/task-router`, diffs against the file (comment lines aside), and asserts P2 over the file's empty-slot chain lines.
- **`tsc --strict`:** `typecheck-task-router` (M0's runner). Type-only edits in `test/{fake-pi,brief,card,delegation,outcome,prompt,randomize,shell}.test.ts`/`fake-pi.ts` (S4); their own commit after the golden test, so that golden and suite count are the before/after evidence.
- **Interface comparisons (§8.1, M5):** `iface-subagents-task-router` (consumer `core/api.ts` `SubagentsApiV1`, already exported) and `iface-experiments-task-router` (consumer: a new `export type ExperimentsApi` in `core/shell.ts` that the two inline casts name, M4 D6's form).
- **Module** `modules/task-router.nix` (S6): `enable`, `package`, `settings` (free-form JSON object, §6.2); the registry entry `task-router` (main session only); `<agentDir>/task-router/settings.json` when `settings ≠ {}`; the hard assertion on `actorSubagents` and `spawnPolicyApi` (§4.1). No warning (§4.1 marks no soft dependency of the router).
- **Log contract (§8.1):** `checks/log-contract/{default.nix,contract.ts}`: the host's `contract.ts` with the imports re-pointed to `packages/`, run on a fileset of the four packages (S8).
- **Bench:** `bench.router` gets per-name `mkDefault` definitions while `taskRouter.enable`: the projection of `taskRouter.settings` on R'’s model keys, plus `randomize.enabled = false` and `spotCheck.enabled = false` (§7, S9). `bench.extensions` gains `task-router` the M6 way (S9).
- **Cases:** `checks/module-eval/cases/task-router.nix` (S7: off, defaults, settings, two negative cases, the host-like combination), `bench-router-default` and the changed `bench-extensions-default` in `cases/bench.nix`, `taskRouter` in `cases/together.nix`; `home-files` builds the router's directory.
- **Doc move:** M5.D = M6.D verbatim, when M6's Execution Record says "moved to M5" (spec §9 amendment).
- **Citations:** none re-pointed in the router's code (D13): they cite the redesign's spec and plan, which continue here after W.

## Decisions

| # | Choice | Why | Rejected |
|---|---|---|---|
| D1 | Source R' (§6.1 amendment); P1–P5 checked at R' in M5.0; a failing property is recorded in the Execution Record ("handed to the redesign") and M5 goes on | The owner's order of 2026-10-25: W first | Waiting for the end of the redesign (r5's R): superseded |
| D2 | `packages/task-router/` = R' minus `nix/`, `test/host-*`; `package.nix` from R'’s `nix/package.nix` (paths moved up, header new) | M3 D1, M4 D1; `installPhase` copies `package.json index.ts core`, so the output is R'’s except `core/shell.ts` (D5) | Copying `nix/`: a dead second module next to `modules/task-router.nix` |
| D3 | Checks `task-router` (the package) and `typecheck-task-router` | M4 D2; the host's `pi-task-router` is the package build | A separate `node --test` derivation: the suite twice |
| D4 | `tsc` fixes, all in tests (S4): `fake-pi.ts` `getThinkingLevel` cast to `ThinkingLevel` (5 errors); `brief.test.ts`, `delegation.test.ts` wrap `tier-plan.ts`'s `planFor` in a typed `planFor` returning `Plan` via `as unknown as Plan` (15); the old-shape `Plan` fixtures in `outcome.test.ts:18`, `shell.test.ts:13` become `… as unknown as Plan` (3); `as const` profiles get the type `Profile` (`card.test.ts:134`, `delegation.test.ts:126`); `prompt.test.ts:49` narrows `bad` to `{ reject: string }`; `randomize.test.ts:95`'s legacy-key profile (deliberate, it tests the loader's mapping) `as never` | Type-only, erased by `--experimental-strip-types`; the stale shapes are G2's (the host type-checks only `core/`); the redesign continues here, so its tests should type-check from now on | Leaving `test/` out of the type check (M6 D8's form): untyped tests for code that keeps changing here (open question Q2); rewriting the fixtures to the new shapes: fixture changes with behaviour |
| D5 | `core/shell.ts`: `export type ExperimentsApi = { flag(n: string, d: string, s?: string): string; armFor?(s: string): { id?: string } \| undefined };` above `Deps`, with M4's comment; both inline casts name it | §8.1: an inline type becomes a named alias (type-only), M4 D6's form and members (cache-lifecycle's alias is the same type) | Two aliases, one per cast: two comparisons for one API |
| D6 | Golden input space = the redesign's own golden grid (`test/golden/grid.ts` at R': 2 profile variants × their kinds × 64 t0 vectors × 3 t2 modes × 3 importances × {randomize off, hit, miss} × 5 attempt sequences; explicit: × 6 models × 8 efforts) + the Qwen chain's 96 states through `resolveLeg` (`test/chain-table.test.ts`'s driver) | §6.3: "fixed from R'’s types": `planSpawn`'s inputs (profile incl. legacy keys, verified t0, t2, force, importance, rng draw, attempts, model, effort) and the chain's state; the grid is R'’s own, so the record and R'’s tests agree on the space | A new grid: a second definition of the space that could drift from R'’s |
| D7 | Golden file format: interned text (S5); header lines `#` (R'’s id, date) ignored by the comparison | 754 lines, 101 KB, diffable, leak-scannable; a changed decision shows as a changed grid character or row | One line per case (17 MB); an `xz` blob (binary, the leak scan cannot read it); per-slice digests (not "the decisions", §6.3) |
| D8 | `EMPTY_SLOT` = every member's `model` set to a neutral name (`local/qwen`, `api/haiku`, `api/sonnet`, `api/opus`), `qwen-local.health` = `http://local.invalid:11545`, `qwen-cloud.model = ""`; the explicit grid maps the grid's model names onto these, the free model's name stays (it names no member then) | §6.3: "sets every model key and leaves the free-cloud slot empty"; neutral names make P1 visible at grid scale | Leaving `haiku` blank: then the key is not set (open question Q3) |
| D9 | `router-golden` asserts P2 on the file before diffing: no `chain empty-slot` line names the route `cloud` or `wait` | §6.1 P2, last sentence; first, so that a planted line shows the property's message | Only the diff: the property would be implicit |
| D10 | P2 test `test/free-cloud-slot.test.ts` (S3) in the moved suite; if it is red at R', it lands with node:test's `{ todo: "P2 does not hold at R' (handed to the redesign)" }` and the Execution Record says so | §6.1 P2 "Failing that, M5 writes one", run against R' first; amendment: M5 does not stop; `todo` reports without failing the build | Skipping the test: the gap would be invisible |
| D11 | `modules/task-router.nix`: `settings` type `attrsOf (pkgs.formats.json {}).type`; registry `task-router` = `{path = "${package}"; checkPath = ../packages/task-router/index.ts; input = null; forChildren = false;}` with R'’s description; assertion `pi-economics: taskRouter requires actorSubagents with passthru.spawnPolicyApi >= 1 (the router registers through registerSpawnPolicy, and shell.ts swallows its absence: without the patched build the router does nothing)` | §4, §4.1, §5.1, §6.2; M3 D4/D5, M4 D7/D8; R'’s `pi-extensions.nix` entry (main session only) | Typed router options: §6.2 forbids them; the host's `(pkgs.formats.json {}).type`: accepts a list |
| D12 | Log contract: `checks/log-contract/contract.ts` = R'’s `checks/pi-log-contract/contract.ts` with `../../modules/home-manager/features/ai/extensions/` → `../../packages/` (10 lines) and its header's 2026-10-02 citation → `spec §8.1`; `default.nix` runs it on a fileset (contract.ts + the four packages), no Home Manager evaluation | §8.1; part 2 of the host's check is already `analysis-skill-contract` (M3 D11) | A copy of the whole host check: part 2 twice |
| D13 | The router's code comments stay byte-equal to R' (76 citation lines in 31 files: the redesign's `spec §…`, `T…`, `RD…`, `MP…` and some of the 2026-10-02 spec's) | §2 re-points the 2026-10-02 citations; here they are interleaved with the redesign's, which the redesign's Groups 3–7 keep using in this flake; `diff -r` against R' then shows only D4, D5, M5.2 | Re-pointing now (M4.19's form): edits the anchors the next groups work from (open question Q4) |
| D14 | `bench.router` (S9): `lib.mkIf pe.taskRouter.enable (lib.mapAttrs (_: lib.mkDefault) (lib.recursiveUpdate (lib.filterAttrs (n: _: lib.elem n routerModelKeys) pe.taskRouter.settings) {randomize.enabled = false; spotCheck.enabled = false;}))`, `routerModelKeys = ["models" "queueMaxSec" "localHealthUrl" "cloudDailyCap" "contextWindow"]` | §7: the keys that say which models exist and where to reach them, from R'’s schema (`models` with each member's `model`, `health`, `dailyCap`, `contextWindow`; `queueMaxSec`) plus the legacy keys R'’s loader still maps (`settings.ts:125-147`); switches forced off; per name, as `extensions` (M6 Q3) | The switches only when the settings name them: a later default `true` would reach the arms (open question Q5) |
| D15 | `bench.extensions`: `task-router = lib.mkDefault "${pe.taskRouter.package}"` next to M6's four | M6 D11/Q3; the bench loads it by name (`orch.ts:18`); the registry links `${package}` | Conditional on `taskRouter.enable`: M6's four are unconditional |
| D16 | The golden file lives until the redesign's next behaviour change; each later group re-records it, with the old and new file's diff in its record | §6.1 amendment | Freezing it: the redesign changes decisions on purpose |
| D17 | M5.D = M6.D verbatim (its scrub table S13 included), last before M5.18, only when M6's Execution Record says "moved to M5" | §9 amendment; M6 D17 | Moving it regardless: M6 may have carried it |

## The gate

No principles document; the gate is §4's rules, §8's testing rules, `AGENTS.md` and the M0–M6 lessons.

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: every task has a RED; the green-first steps (M5.6 interface, M5.14 host-like, M5.16 together) carry planted violations |
| No `builtins.match` on generated text | PASS: `eq`, `holds`, `lib.elem`; `router-golden` and `log-contract` are shell (`diff`, `grep -E` on a 101 KB file is linear) |
| Typed options; assertions for invariants | PASS: `enable`, `package`, `settings` (JSON object); the hard dependency is an assertion (D11) with two negative cases |
| camelCase options, kebab-case directories (§4) | PASS: `taskRouter`; `packages/task-router`, `checks/router-golden`, `checks/log-contract`, `task-router/settings.json` |
| Settings files are literal text (§4) | PASS: `.text = builtins.toJSON cfg.settings` |
| Merges with `lib.recursiveUpdate` (§4) | PASS: the bench projection (D14); `task-router/settings.json` has one writer, no merge |
| Every assertion message `pi-economics:` with a negative case | PASS: D11, cases `task-router-requires-actor-subagents`, `task-router-requires-spawn-policy-api` |
| No import-from-derivation | PASS: `checkPath` on the source; the file is read at evaluation |
| Scripts strict and dependency-explicit | PASS: both new checks are `runCommand` with `set -euo pipefail` and `nativeBuildInputs` |
| Alejandra on every changed `.nix` file | PASS: CLEAN steps |
| Markdown under `docs/` | PASS |
| `flake.lock` changes only as needed | PASS: no new input (the router is in-tree) |
| Leak patterns (§8.3) | PASS: `leak` green in the prototype's scope (`earth` is not a pattern, §8.3); the golden file is text |
| Host read-only | PASS: `git dot show`/`archive`/`diff` only |
| Every check built with both `git+file://` and `path:` refs | PASS: M5.18 |
| Pure move (§1) | PASS with the listed exceptions: output = R'’s build except `core/shell.ts` (D5); tests differ by D4, M5.2 and the new P2 test; decisions equal R'’s (`router-golden`) |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION.

## Files to read first

Listed, not quoted; the tasks show only what changes.

- The spec: §1, §2 (row `taskRouter`, the documentation bullets), §4 (row `taskRouter`, Rules), §4.1 (hard dependencies), §5.1, §5.3, §6 with its amendment, §7 (`router`, `extensions`), §8.1, §8.3 ("Fixtures and defaults"), §9 with its amendment (row M5, "Drift"), §9.1 W4 with its amendment.
- The M6 plan: D11, S10, M6.D, S13, Q3 and its Execution Record (the final case count `N6`, whether M6.D was "moved to M5", `cases/together.nix`, `home-files`). The M4 plan: D1, D2, D6, D7, D8, S5, S6, S10. The M3 plan: D1, D4, D5, D11 (`analysis-skill-contract`). The M1 plan: M1.8 (`bench.router`).
- This repository at M6's end: `flake.nix`, `checks/default.nix`, `checks/typecheck/default.nix`, `checks/iface/default.nix`, `checks/module-eval/{default.nix,expect.nix,cases/bench.nix,cases/cache-lifecycle.nix,cases/retry.nix,cases/together.nix}`, `checks/home-files/default.nix`, `modules/{bench,actor-subagents,cache-lifecycle,analysis-skill,default}.nix`, `packages/cache-lifecycle/package.nix`, `packages/token-meter/core/shell.ts` (lines 19–28).
- Host at R' (`hr <path>`): the paths in "Source paths" above; the redesign plan's Execution Record for Groups 0–2 and the entry that names R'; the redesign spec §6.6 ("The move") and §8.2 (the grid).
- The prototype artefacts in `~/.cache/pi/m5plan/` (see "Prototype").
- This plan's Snippets.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| `tsc --strict` via `typecheck-task-router` | from M5.5 | until S4: 26 errors in 9 test files (measured on `f1b140e`): `TS2345` ×21 (`brief.test.ts` ×13, `card.test.ts` ×2, `delegation.test.ts` ×2, `harness.ts:42`, `policy.test.ts:185`, `shell.test.ts:18,80`), `TS2322` ×3 (`outcome.test.ts:18` ×2, `shell.test.ts:13`), `TS2339` (`prompt.test.ts:49`), `TS2353` (`randomize.test.ts:95`); re-measured at R' in M5.5 |
| `tsc --strict` via `iface-subagents-task-router`, `iface-experiments-task-router` | from M5.6, M5.7 | the same 26 until M5.5 (the consumer's tree is checked whole); M5.7 until D5: `TS2305`/`TS2724`, `ExperimentsApi` not exported; afterwards a provider type not assignable to the router's copy |
| `tsc --strict` via every other `typecheck-*`, `iface-*` | unchanged | nothing new: M5 touches no other package |
| Nix module system | `module-eval` | unknown options (each module task's RED), a non-object `settings` |
| node's type stripping | `task-router`, `router-golden`, `log-contract` | syntax only; the generator (`checks/router-golden/generate.ts`) and `contract.ts` are not type-checked (coverage gap) |
| shellcheck | — | N/A: no `writeShellApplication`; the two checks are `runCommand` |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package tests (`task-router`) | R'’s suite minus `host-*` (346 tests on `f1b140e`), including the redesign's golden grid against its frozen oracle and the chain table; plus `free-cloud-slot.test.ts` (P2) | nodejs; ~15 s |
| Golden (`router-golden`) | every decision of `planSpawn` on R'’s grid and of `resolveLeg` on the chain's 96 states, under the defaults and `EMPTY_SLOT`, equal to R'’s recorded ones; P2 over the empty-slot chain lines | nodejs; ~20 s; the golden file from a host checkout at R' |
| Type check (`typecheck-task-router`) | `--strict` over `index.ts`, `core/`, `test/` | the shared lock; ~15 s |
| Interface comparisons | `__subagentsApi_v1` and `__piExperimentsApi_v1` against the router's copies | M2's harness, M4's provider bindings |
| Log contract (`log-contract`) | every log writer (token-meter, task-router, cache-lifecycle, experiments) through `pi-analyse --check` and a full report | nodejs; seconds |
| Module evaluation (`module-eval`) | off, defaults (registry entry, no file, main only), settings file, both negative assertion cases, the host-like combination, the bench's `router` and `extensions` defaults, every component together | M6's final count `N6` + 8 cases |
| Build check (`home-files`) | the router's directory as pi loads it | ~10 s |
| Leak (`leak`) | the copied router, the golden file, the checks | — |
| The host's replay of its October log | N/A: host data, stays in the host (§6.3; redesign spec §6.6) | — |
| Layer B, activation | N/A: W4 (§9.1), an owner step | — |

## Scenario coverage

| Scenario (spec) | Check |
|---|---|
| §6.1 P1 configurable models | M5.0 evidence (R'’s `core/settings.ts` `models`, `test/settings.test.ts` "nested keys deep-merge…" writes `models.sonnet.model` to a file); `router-golden` `EMPTY_SLOT` (decisions name the fixture's models) |
| §6.1 P2 optional free-cloud slot | `free-cloud-slot.test.ts` (M5.3, run at R' first); `router-golden`'s property (M5.4) |
| §6.1 P3 contracts | M5.0 evidence (`core/shell.ts` `registerSpawnPolicy`, the two casts); `iface-subagents-task-router` (M5.6), `iface-experiments-task-router` (M5.7) |
| §6.1 P4 logs | M5.0 evidence (the host's `pi-log-contract` green at R'); `log-contract` (M5.11) |
| §6.1 P5 free-form settings | M5.0 evidence (R'’s `nix/hm-module.nix`); `task-router-settings` (M5.9) |
| §6.2 file when non-empty | `task-router-defaults` (no file), `task-router-settings` (M5.8, M5.9) |
| §6.3 the suite as copied, neutral fixture names | `task-router` (M5.1), M5.2's probe |
| §6.3 golden test, two settings | `router-golden` (M5.4) |
| §8.1 tsc per package | `typecheck-task-router` (M5.5) |
| §8.1 interface comparisons for the router | M5.6, M5.7 |
| §4.1 hard dependency | `task-router-requires-actor-subagents`, `task-router-requires-spawn-policy-api` (M5.10) |
| §5.1 registry entry, main session only | `task-router-defaults` (M5.8), `m5-host-like` (M5.14) |
| §8.1 log contract, all four packages | `log-contract` (M5.11) |
| §7 `router` default from `taskRouter` | `bench-router-default` (M5.12); M1's `bench-router`, `bench-defaults` unchanged |
| §7 `extensions` default gains the router (M6 Q3) | `bench-extensions-default` (M5.13) |
| §8.1 host-like combination | `m5-host-like` (M5.14) |
| §8.1 every component together | `components-together` (M5.16) |
| §9 Drift from R' | M5.0 Step 3 |
| §2 doc move (§9 amendment) | M5.D |

## Properties

- P-copy `diff -r (R' task-router ∖ {nix/, test/host-*}) packages/task-router` = {`package.nix` (new), `core/shell.ts` (D5), the S4 test files, `test/members.test.ts` (M5.2), `test/free-cloud-slot.test.ts` (new)} (M5.18).
- P-golden `gen(packages/task-router) = gen(R')` byte for byte, comment lines aside, with `gen` = `checks/router-golden/generate.ts` (`router-golden`).
- P-count `∀ fx ∈ {defaults, empty-slot}: count(fx) = (146880, 470016)` and `|chain lines(fx)| = 48`; each grid line has 64 ids (a line of the golden file, compared by the diff).
- P-empty `∀ l ∈ chain lines(empty-slot): route(l) ∉ {cloud, wait}` (D9).
- P-out `diff -r out(host pi-task-router at R') out(packages.task-router)` = {`core/shell.ts`} (M5.18).
- P-file `settings = {} ⇒ ∄ file`; `settings = s ≠ {} ⇒ fromJSON(file) = s`, for both `agentDir`s.
- P-assert `taskRouter.enable ∧ (¬actorSubagents.enable ∨ spawnPolicyApi < 1) ⇔ the message of D11 ∈ failed assertions`.
- P-children `"task-router" ∉ childExtensions` in every case (main session only).
- P-bench-router `taskRouter.enable ⇒ bench.router = recursiveUpdate (filterAttrs (∈ routerModelKeys) s) {randomize.enabled = false; spotCheck.enabled = false}`; `¬taskRouter.enable ⇒ bench.router = {}`; a definition `{k = v}` replaces `k` only.
- P-bench-ext `bench.extensions(default) = M6's four ∪ {task-router ↦ "${taskRouter.package}"}`.

## Planted violations

| Check | Plant | Must FAIL with | Task |
|---|---|---|---|
| `task-router` | in `test/settings.test.ts`, assert `defaults().queueMaxSec === 121` | `node --test` failure, build fails | M5.1 [ ] |
| `free-cloud-slot.test.ts` | `core/chain.ts`: `if (blocked \|\| s.cloudToday >= s.cloudDailyCap)` → `if (blocked)` and `if (s.cloudRunning === 0)` → `if (s.cloudRunning === 0 && s.cloudDailyCap >= 0)` | 2 failures (seen on `f1b140e`) | M5.3 [ ] |
| `router-golden` | `core/settings.ts` write row 1 critical `C(2, 1)` → `C(2, 0)` | diff of 234 lines (seen) | M5.4 [ ] |
| `router-golden` | `core/chain.ts` `if (s.cloudRunning === 0)` → `if (s.cloudRunning === 0 && !localFree)` | diff of 2 lines (seen) | M5.4 [ ] |
| `router-golden` | append `chain empty-slot local=up cloudRunning=0 cloud=open cloud:x:xhigh wait` to `golden.txt` | `router-golden: an empty free-cloud slot is routed to or waited for` | M5.4 [ ] |
| `typecheck-task-router` | none (natural): R'’s tests unedited | the 26 errors (or R'’s count) | M5.5 [ ] |
| `iface-subagents-task-router` | add `unknownMember(): void;` to the router's `SubagentsApiV1` (`core/api.ts`) | `TS2741` in `compare.ts` | M5.6 [ ] |
| `iface-experiments-task-router` | none (natural): no `ExperimentsApi` export | `TS2305`/`TS2724` in `compare.ts` | M5.7 [ ] |
| `iface-experiments-task-router` | `flag(n: string, d: number, …)` in `ExperimentsApi` | `TS2322` in `compare.ts` | M5.7 [ ] |
| `task-router-defaults` | `forChildren = true` | `children: expected …` | M5.8 [ ] |
| `task-router-settings` | `lib.mkIf true` for the file | `files (.pi/agent): expected …` on the `{}` side | M5.9 [ ] |
| `task-router-requires-spawn-policy-api` | drop the `spawnPolicyApi` half of the assertion | `assertions: expected [ "pi-economics: taskRouter requires …" ]` | M5.10 [ ] |
| `log-contract` | none (natural): the host's imports | `ERR_MODULE_NOT_FOUND` for `../../modules/home-manager/…` | M5.11 [ ] |
| `log-contract` | drop `arm` from the router's `spawn` event (`core/outcome.ts`) | `pi-log-contract: FAILED` naming `arm` (the host's P31) | M5.11 [ ] |
| `bench-router-default` | drop `spotCheck.enabled = false` from the forced switches | `router: expected …` | M5.12 [ ] |
| `bench-extensions-default` | drop `task-router` from the defaults | `extensions: expected …` | M5.13 [ ] |
| `m5-host-like` | `forChildren = true` for `task-router` | `children: expected …` | M5.14 [ ] |
| `home-files` | point `task-router`'s check at `core/missing.ts` | `FAIL … task-router` | M5.15 [ ] |
| `components-together` | a file only the combination renders (M6.17's form) | `home.file targets: expected …` | M5.16 [ ] |

## Coverage gap

- **Real pi.** No check loads the router into pi; the fakes (`test/fake-pi.ts`, `fake-api.ts`) stand in. W4's activation (owner step) covers it.
- **The host's replay** of its October outcome log (`test/host-replay.test.ts`, 159 lines) stays in the host: private data (§6.3).
- **Randomization draws** in the golden grid are only "hit" (rng 0) and "miss" (rng 0.99); spot checks are not in the grid (the suite covers them).
- **The selection runtime** beyond the chain's 96 states (failover, health probes, the cloud counter's file) is covered by the suite only, not by the golden file.
- **The generator and `contract.ts`** are not type-checked (lone check files; node strips types).
- **The router's citations** (D13) point at host documents until the redesign's close-out or P.
- **The bench arms** with the router's projected settings: no check runs an arm.
- **`earth`** stays in the default, two tests, the oracle copy and the today fixture until P (§8.3); `leak` does not match it.

## Environment (every step)

```sh
source ~/.cache/pi/m0env.sh      # XDG dirs, cd, F (git+file), o, cap, nb, ne, fmt, nbl
Fp=path:$HOME/projects/nix/pi-economics
nbp() { (ulimit -v $cap && exec timeout -s KILL 1500 nix build --no-link -L "$Fp#checks.x86_64-linux.$1" "${o[@]}"); }
RP=<R' id, set in M5.0>                                    # the source commit
hr() { git dot show "$RP:projects/nixos/new/$1"; }
ai=modules/home-manager/features/ai; tr=$ai/extensions/task-router
hostR() { rm -rf "$TMPDIR/hostR" && mkdir -p "$TMPDIR/hostR" && (cd ~/projects/nixos/new && git dot archive "$RP" -- $tr checks/pi-log-contract) | tar -x -C "$TMPDIR/hostR"; }
HR=$TMPDIR/hostR/$tr                                       # R'’s router, after hostR
gen() { node --experimental-strip-types --no-warnings checks/router-golden/generate.ts "$1"; }
flag() { while [ -e ~/.cache/pi/pluto-exec/owner-deploy.flag ]; do sleep 60; done; }   # before every build above 2 GiB
```

- `nb`/`nbp` are capped (`ulimit -v 20971520`, `timeout -s KILL`); never `nix flake check`. Run `flag` before `module-eval` and the full loop.
- `git+file:` sees only indexed files: `git add` new files before `nb`/`ne`.
- `module-eval`'s derivation depends only on the failure report and the case count; `nbl module-eval` forces the log.
- Plain `git` here; `git dot` only to read the host. Commits unsigned, with pathspecs (another agent may work in this repository: never `git add -A`). Undo a plant with `git checkout -- <file>` after staging the green state.
- TypeScript edits keep each file's style (the router uses two-space indentation and long lines).

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/task-router/**` | R'’s router without `nix/`, `test/host-*` | M5.1 |
| `packages/task-router/package.nix` | the derivation (S1) | M5.1 |
| `flake.nix` | `packages.task-router` (S2) | M5.1 |
| `checks/default.nix` | `task-router`, `router-golden`, `typecheck-task-router`, `iface-subagents-task-router`, `iface-experiments-task-router`, `log-contract` (S2) | M5.1, M5.4–M5.7, M5.11 |
| `packages/task-router/test/members.test.ts` | `earth` → `lan` (line 61) | M5.2 |
| `packages/task-router/test/free-cloud-slot.test.ts` | P2 (S3) | M5.3 |
| `checks/router-golden/{default.nix,generate.ts,golden.txt}` | the golden test (S5) | M5.4 |
| `packages/task-router/test/{fake-pi.ts,brief,card,delegation,outcome,prompt,randomize,shell}.test.ts` | type-only edits (S4) | M5.5 |
| `packages/task-router/core/shell.ts` | `export type ExperimentsApi` (D5) | M5.7 |
| `modules/task-router.nix`, `modules/default.nix` | the component (S6) | M5.8–M5.10 |
| `checks/module-eval/cases/task-router.nix`, `checks/module-eval/default.nix` | 6 cases (S7); `caseFiles` | M5.8–M5.10, M5.14 |
| `checks/log-contract/{default.nix,contract.ts}` | part 1 of the log contract (S8) | M5.11 |
| `modules/bench.nix`, `checks/module-eval/cases/bench.nix` | `router` and `extensions` defaults (S9) | M5.12, M5.13 |
| `checks/home-files/default.nix` | the router's directory | M5.15 |
| `checks/module-eval/cases/together.nix` | `components` += `taskRouter` | M5.16 |
| `docs/pi-economics.md` | the component, the golden test, the redesign's continuation (S10) | M5.17 |
| `docs/pi-token-economics.md` | the moved document (M6's S13) | M5.D (if handed over) |

Interfaces M5 publishes: options `programs.piEconomics.taskRouter.{enable, package, settings}` (W4 moves the host's `taskRouter.settings` here, plus the model and health-URL values it relies on, §9.1); registry entry `task-router` (`forChildren = false`); `packages.x86_64-linux.task-router`; `bench.router` and `bench.extensions` defaults; checks `router-golden` and `log-contract` (W2/W6 decide on the host's `pi-log-contract` with it, §9.1); `checks/router-golden/generate.ts` for the redesign's later groups.

---

## Tasks

| Task | Delivers | Commit |
|---|---|---|
| M5.0 | read; M6 landed; R' named; drift; P1–P5 at R' | — |
| M5.1 | the copy, `packages.task-router`, check `task-router` | `m5: task-router package and check from the host's R'` |
| M5.2 | neutral fixture name | `m5(task-router): neutral fixture name (spec §8.3)` |
| M5.3 | P2 test | `m5(task-router): P2, the empty free-cloud slot` |
| M5.4 | golden generator, golden file, check `router-golden` | `m5(task-router): golden decisions of R'` |
| M5.5 | `typecheck-task-router` (type-only test edits) | `m5(task-router): tsc --strict` |
| M5.6 | `iface-subagents-task-router` | `m5(task-router): iface against __subagentsApi_v1` |
| M5.7 | `ExperimentsApi`, `iface-experiments-task-router` | `m5(task-router): iface against __piExperimentsApi_v1` |
| M5.8 | taskRouter: `enable`, `package`, registry entry | `m5(task-router): module, package, registry entry` |
| M5.9 | `settings` → the file | `m5(task-router): settings file` |
| M5.10 | the hard assertion | `m5(task-router): requires actorSubagents with spawnPolicyApi` |
| M5.11 | `log-contract` | `m5: log contract over the four packages` |
| M5.12 | bench `router` default | `m5(bench): router default from taskRouter` |
| M5.13 | bench `extensions` gains `task-router` | `m5(bench): task-router in the extensions default` |
| M5.14 | the host's combination (characterisation) | `m5: the host's combination of M2–M6 with taskRouter` |
| M5.15 | `home-files` for M5 | `m5: home-files builds the router` |
| M5.16 | every component together | `m5: taskRouter together with the rest` |
| M5.17 | docs | `m5: docs for taskRouter` |
| M5.D | **if handed over by M6:** the doc move | `m5: move docs/pi-token-economics.md` |
| M5.18 | gate, purity, Execution Record | `m5: execution record` |

Every task starts at `[ ]`. One failing check at a time; a task's commit holds only green checks.

### Task M5.0 — Read, M6 landed, R', drift, P1–P5

- [ ] **Step 1:** read "Files to read first".
- [ ] **Step 2 (M6 landed):** M6's Execution Record is closed; note its final module-eval count `N6` and whether M6.D says "moved to M5" (then M5.D runs).
- [ ] **Step 3 (R'):** in the host, `git dot log --oneline f1b140e..HEAD -- $tr docs/plans/2026-10-17-task-router-abilities-plan.md`; R' is the commit the redesign plan's Execution Record names as the end of Group 2's review fixes. Set `RP`, record it. If the record names none yet, stop and ask main (do not guess).
- [ ] **Step 4 (drift, §9):** `cd ~/projects/nixos/new && git dot diff --stat 4c714f0 $RP -- flake.lock $ai/pi-actor-subagents* $ai/pi-infinite-context* $ai/pi-retry* checks/pi-actor-subagents checks/pi-infinite-context checks/pi-retry $ai/pi-extensions.nix $ai/pi-settings-migrate.nix checks/pi-settings-migrate homes/pallon/default.nix docs/pi-token-economics.md pkgs/pi-bench $ai/extensions/{token-meter,cache-lifecycle,experiments} $ai/skills/pi-token-economics-analysis checks/pi-log-contract checks/pi-extensions.nix` — expected empty (empty at `f1b140e`). A change in a moved path is ported first, each with its test, as its own task `M5.0.<n>` before M5.1 (M6.0's form), and recorded. If M6 moved its source past `4c714f0`, diff from M6's recorded source instead.
- [ ] **Step 5 (P1–P5 at R', D1):** record each with its evidence; a property that fails is recorded as "handed to the redesign" and M5 continues (§6.1 amendment).
  - P1: `hr $tr/core/settings.ts | grep -n 'models: {'` (the defaults) and `hr $tr/test/settings.test.ts | grep -n 'models: { sonnet: { model: "m" } }'` (a file sets a model). Holds at `f1b140e` (`settings.ts:26`, `settings.test.ts:39`).
  - P2: `hr $tr/test/cloud.test.ts | grep -n 'a blank qwen-cloud is skipped'` (the route only; holds at `f1b140e`, `:84`); the full property is M5.3's test, run at R' there.
  - P3: `hr $tr/core/shell.ts | grep -n 'registerSpawnPolicy\|__piExperimentsApi_v1'` (holds at `f1b140e`: `:123`, `:64`, `:66`); the comparisons are M5.6, M5.7.
  - P4: the host's `pi-log-contract` at R': `hostR`-free form, `flag; (ulimit -v $cap && exec timeout -s KILL 1800 nix build --no-link "path:$TMPDIR/hostR-full#checks.x86_64-linux.pi-log-contract" "${o[@]}")` on a `git dot archive "$RP" -- .` of the whole flake (from `~/projects/nixos/new`) into `$TMPDIR/hostR-full`; or the redesign's own gate record at R' if it ran G2 (`pi-log-contract … ok`). Held at `5903562` (gate `g2`).
  - P5: `hr $tr/nix/hm-module.nix | grep -n 'formats.json\|settings != {}'` (free-form, written when non-empty; holds at `f1b140e`).
- [ ] **Step 6:** `flag; nb module-eval` green at M6's end (baseline `N6`).

### Task M5.1 — The copy, `packages.task-router`, check `task-router`

**Files:** `packages/task-router/**`, `flake.nix`, `checks/default.nix`.

- [ ] **Step 1 (RED):** add `task-router = self.packages.${…}.task-router;` to `checks/default.nix` (S2) → `nb task-router` fails: `attribute 'task-router' missing`. [ ] red seen
- [ ] **Step 2 (GREEN):** `hostR; mkdir -p packages/task-router && (cd $HR && tar -c --exclude=./nix --exclude='./test/host-*' .) | tar -x -C packages/task-router`; `package.nix` (S1); `flake.nix` output (S2); `git add packages/task-router flake.nix checks/default.nix`; `nb task-router` green. Record the suite count `T` (`cd packages/task-router && node --test --experimental-strip-types test/*.test.ts | grep '^ℹ tests'`; 346 at `f1b140e`).
- [ ] **Step 3 (planted):** the `queueMaxSec === 121` assertion → FAIL. [ ] red seen. Restore.
- [ ] **Step 4:** `diff -r --exclude=nix --exclude='host-*' $HR packages/task-router` lists only `package.nix`. Commit.

### Task M5.2 — Neutral fixture name (§8.3)

**Files:** `packages/task-router/test/members.test.ts`.

- [ ] **Step 1 (RED):** the probe `grep -rn 'earth' packages/task-router` lists six lines (at `f1b140e`: `core/settings.ts:29`, `test/settings.test.ts:29`, `test/policy.test.ts:82`, `test/oracle/legacy-settings.ts:20`, `test/fixtures/today-config.json:13`, `test/members.test.ts:61`). [ ] red seen
- [ ] **Step 2 (GREEN):** `test/members.test.ts:61`: `provider: "earth" })), "earth")` → `provider: "lan" })), "lan")`. The probe lists the other five, each kept by §8.3 (Approach); the Execution Record names them. `nb task-router` green, count `T`.
- [ ] Commit.

### Task M5.3 — P2: the empty free-cloud slot

**Files:** `packages/task-router/test/free-cloud-slot.test.ts` (new, S3).

- [ ] **Step 1 (against R' first, D10):** `cp ~/.cache/pi/m5plan/free-cloud-slot.test.ts $HR/test/ && (cd $HR && node --test --experimental-strip-types test/free-cloud-slot.test.ts)` → expected `pass 2` (seen on `f1b140e`). Red at R' → P2 does not hold: record it, add `{ todo: "P2 does not hold at R' (handed to the redesign)" }` as the tests' options, and go on.
- [ ] **Step 2 (RED, planted, S3's plant in `core/chain.ts`):** → `fail 2`. [ ] red seen. Restore.
- [ ] **Step 3 (GREEN):** the file in `packages/task-router/test/`; `nb task-router` green, count `T + 2`.
- [ ] Commit.

### Task M5.4 — Golden decisions of R', check `router-golden`

**Files:** `checks/router-golden/{generate.ts,default.nix,golden.txt}`, `checks/default.nix`.

- [ ] **Step 1:** `generate.ts` (S5), `default.nix` (S5), `golden.txt` = the header lines only; `router-golden = pkgs.callPackage ./router-golden {};` (S2); `git add checks/router-golden`.
- [ ] **Step 2 (RED):** `nb router-golden` → `router-golden: decisions differ from R'` (every line, 754 at `f1b140e`). [ ] red seen
- [ ] **Step 3 (GREEN, by hand, once):** `hostR; { printf '# task-router golden decisions (spec §6.3), from checks/router-golden/generate.ts\n'; printf "# R' = %s (host dotfiles), %s\n" "$RP" "$(date -u +%F)"; gen "$HR"; } > checks/router-golden/golden.txt`; `grep '^count' checks/router-golden/golden.txt` → two lines `146880`/`470016`; `cmp <(gen packages/task-router) <(grep -v '^#' checks/router-golden/golden.txt)`; `nb router-golden` green. If R'’s `test/golden/{grid,sut}.ts` or `resolveLeg`'s deps changed after `f1b140e`, adapt `generate.ts` to them first and record the change.
- [ ] **Step 4 (planted):** the write-table plant, the chain plant, the appended empty-slot line (table "Planted violations") → three FAILs. [ ] red seen ×3. Restore.
- [ ] Commit.

### Task M5.5 — `typecheck-task-router`

**Files:** the eight test files of S4, `checks/default.nix`.

- [ ] **Step 1 (RED):** `typecheck-task-router` (S2) → the errors of the "Type checking strategy" table (26 at `f1b140e`; record R'’s list). [ ] red seen
- [ ] **Step 2 (GREEN):** S4's edits, nothing else; for an error R' adds beyond the table, the same forms (cast at the fixture, never in `core/`), each listed in the record. `nb typecheck-task-router` green.
- [ ] **Step 3 (evidence, before/after):** `nb task-router` (count `T + 2`, unchanged) and `nb router-golden` green; `diff -r --exclude=nix --exclude='host-*' $HR packages/task-router` lists only `package.nix`, S4's files, `members.test.ts`, `free-cloud-slot.test.ts`.
- [ ] Commit.

### Task M5.6 — `iface-subagents-task-router`

- [ ] **Step 1 (GREEN-first):** S2's check → green (consumer `core/api.ts` `SubagentsApiV1`, already exported; green in the prototype after S4).
- [ ] **Step 2 (planted):** `unknownMember(): void;` in the router's copy → FAIL `TS2741`. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.7 — `ExperimentsApi`, `iface-experiments-task-router`

**Files:** `packages/task-router/core/shell.ts`, `checks/default.nix`.

- [ ] **Step 1 (RED):** S2's check → `TS2305`/`TS2724`: `ExperimentsApi` is not exported. [ ] red seen
- [ ] **Step 2 (GREEN):** D5's alias and the two casts (S4, `core/shell.ts` hunk). Green; `nb task-router`, `nb router-golden`, `nb typecheck-task-router` green.
- [ ] **Step 3 (planted):** `d: number` → FAIL `TS2322`. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.8 — taskRouter: module, package, registry entry

**Files:** `modules/task-router.nix` (S6), `modules/default.nix`, `checks/module-eval/cases/task-router.nix` (S7), `checks/module-eval/default.nix`.

- [ ] **Step 1 (RED):** `task-router-off`, `task-router-defaults` (S7) and the case file in `caseFiles` → `The option 'programs.piEconomics.taskRouter' does not exist`. [ ] red seen
- [ ] **Step 2 (GREEN):** `modules/task-router.nix` with `enable`, `package`, the registry entry (S6 without `settings` and the assertion); import in `modules/default.nix`. `flag; nb module-eval` green, count `N6 + 2`.
- [ ] **Step 3 (planted):** `forChildren = true` → FAIL `task-router-defaults`. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.9 — `settings` → the file

- [ ] **Step 1 (RED):** `task-router-settings` (S7) → unknown option `settings`. [ ] red seen
- [ ] **Step 2 (GREEN):** the option and the file (S6). Green, `N6 + 3`.
- [ ] **Step 3 (planted):** `lib.mkIf true` → FAIL. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.10 — The hard assertion

- [ ] **Step 1 (RED):** `task-router-requires-actor-subagents`, `task-router-requires-spawn-policy-api` (S7) → `assertions: expected [ "pi-economics: taskRouter requires …" ], got [ ]`. [ ] red seen
- [ ] **Step 2 (GREEN):** S6's `assertions`. Green, `N6 + 5`. Existing cases that enable `taskRouter` without `actorSubagents`: none before M5.
- [ ] **Step 3 (planted):** drop the `spawnPolicyApi` half → FAIL the second case. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.11 — `log-contract`

**Files:** `checks/log-contract/{default.nix,contract.ts}` (S8), `checks/default.nix`.

- [ ] **Step 1 (RED, natural):** `cp $TMPDIR/hostR/checks/pi-log-contract/contract.ts checks/log-contract/`; `default.nix` (S8); `log-contract = pkgs.callPackage ./log-contract {};`; `git add`; `nb log-contract` → `ERR_MODULE_NOT_FOUND` (`../../modules/home-manager/features/ai/extensions/token-meter/core/shell.ts`). [ ] red seen
- [ ] **Step 2 (GREEN):** `sed -i 's|\.\./\.\./modules/home-manager/features/ai/extensions/|../../packages/|g' checks/log-contract/contract.ts` (10 lines) and the header (S8). `nb log-contract` green: `pi-log-contract: ok (meter …, outcomes …, assignments …, guards …)`.
- [ ] **Step 3 (planted):** drop `arm` from the router's `spawnEvent` (`packages/task-router/core/outcome.ts`) → FAIL naming `arm`. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.12 — bench `router` default

**Files:** `modules/bench.nix`, `checks/module-eval/cases/bench.nix` (S9).

- [ ] **Step 1 (RED):** `bench-router-default` (S9) → `router: expected { localHealthUrl = …; models = …; randomize = { enabled = false; }; spotCheck = …; }, got { }`. M1's `bench-router` and `bench-defaults` stay unchanged (the bench without `taskRouter`). [ ] red seen
- [ ] **Step 2 (GREEN):** S9's definition and option description. Green, `N6 + 6`.
- [ ] **Step 3 (planted):** drop `spotCheck.enabled = false` → FAIL. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.13 — bench `extensions` gains `task-router`

- [ ] **Step 1 (RED):** M6's `bench-extensions-default` expects `task-router` too (S9; an existing case changes because §7/M6 Q3 extend the default to the router; its other expectations stay) → `extensions: expected …`. [ ] red seen
- [ ] **Step 2 (GREEN):** D15's line, the description's name list. Green (count unchanged).
- [ ] **Step 3 (planted):** drop it → FAIL. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.14 — The host's combination (characterisation)

- [ ] **Step 1 (GREEN-first):** `m5-host-like` (S7) → green.
- [ ] **Step 2 (planted):** `forChildren = true` for `task-router` → FAIL (`children`). [ ] red seen. Restore.
- [ ] Commit. Count `N6 + 7`.

### Task M5.15 — `home-files` for M5

- [ ] **Step 1 (RED):** the configuration gains `actorSubagents` (if M6's lacks it) and `taskRouter`; the shell part checks `package.json`, `index.ts`, `core/shell.ts` under the linked `extensions/task-router` (M4 D15's form), with a wrong name first (`core/missing.ts`) → `FAIL … task-router`. [ ] red seen
- [ ] **Step 2 (GREEN):** the right name. `nb home-files` green.
- [ ] Commit.

### Task M5.16 — Every component together

- [ ] **Step 1 (GREEN-first):** `components` += `"taskRouter"` in `cases/together.nix` (the case enables `actorSubagents` already) → green.
- [ ] **Step 2 (planted):** M6.17's form, a file only `taskRouter ∧ retry` renders → FAIL `components-together`. [ ] red seen. Restore.
- [ ] Commit.

### Task M5.17 — Docs

**Files:** `docs/pi-economics.md`.

- [ ] **Step 1:** section `taskRouter` (S10): options, the file, the hard dependency, the registry entry, the bench defaults, the golden test (what it records, how a later group re-records it, D16), the log contract, the source R' and that the redesign's Groups 3–7 continue here (spec §6.1 amendment). `nb leak`.
- [ ] Commit.

### Task M5.D — The doc move (only if M6 handed it over)

Run only when M6's Execution Record says M6.D was "moved to M5"; otherwise mark it "done in M6" in the record. It is M6.D verbatim (M6 plan, Task M6.D, Steps 1–4, scrub table S13), with these substitutions: the drift diff runs `4c714f0..$RP`; `h` reads `$RP` (`hr`); the router's section describes the router as moved (R'), and the scrub's `extensions/task-router` → `packages/task-router`. Commit `m5: move docs/pi-token-economics.md`. Last task before M5.18, and before W0.

### Task M5.18 — Gate and Execution Record

- [ ] **Step 1:** `fmt --check $(git ls-files '*.nix')` clean.
- [ ] **Step 2 (every check, both refs):** `flag`; list the checks with `ne checks.x86_64-linux --apply builtins.attrNames --json` (a failed or empty listing is a failure) and build each, capped, with `nb` and with `nbp`; name every failure at the end.
- [ ] **Step 3 (P-copy):** `diff -rq --exclude=nix --exclude='host-*' $HR packages/task-router` = the list of P-copy.
- [ ] **Step 4 (P-out):** `flag`; build the host's package at R' from the archive: `(ulimit -v $cap && exec timeout -s KILL 900 nix build --no-link --print-out-paths --impure --expr "(import <nixpkgs> {}).callPackage $HR/nix/package.nix {}")` is not pinned to the host's nixpkgs — use instead `nix build --no-link --print-out-paths "path:$TMPDIR/hostR-full#checks.x86_64-linux.pi-task-router" "${o[@]}"` (M5.0 Step 5's archive) and `nb`'s `task-router` output (`ne packages.x86_64-linux.task-router.outPath --raw`); `diff -r` the two → only `core/shell.ts`.
- [ ] **Step 5:** fill the Execution Record: R' and how it was named; P1–P5 with evidence (and any handed over); the drift; per task commit, red seen, deviations; `T`, the final case count; the `earth` lines kept (M5.2); the open questions as answered.
- [ ] Commit.
