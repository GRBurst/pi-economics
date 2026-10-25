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
