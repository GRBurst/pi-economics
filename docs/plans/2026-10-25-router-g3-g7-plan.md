# Router redesign, Groups 3–7, continued in pi-economics — TDD plan

Date: 2026-10-25 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 with its "Amendment (2026-10-25, order)" (§6.1, §9, §9.1) · Behaviour spec: host `docs/specs/2026-10-17-task-router-abilities-design.md` r3 with its 2026-10-25 amendment (§5.4, "cap per table") · Task source: host `docs/plans/2026-10-17-task-router-abilities-plan.md`, Groups 3–7 · Base: this repository after M5's close-out and after W (spec §9 amendment: "After W, the redesign's Groups 3–7 continue in this flake").

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Status states per task: `TODO` → `RED` → `DONE` (the host plan's).

**Goal:** land the router redesign's Groups 3–7 (selection, logs, new defaults, scout gate, close-out) in `packages/task-router` (and `packages/token-meter`) of this flake, with every host gate mapped to a flake check.

**Architecture:** the host plan stays the task body (RED, GREEN, tests changed, plants, snippets S1–S13); this plan maps each task to flake paths and checks, adds the flake-only tasks (golden generator, private layer, bench projection, module text, models fixture), and fixes what reaches the host (only by a later lock move).

**Tech stack:** Node 24 (`--experimental-strip-types`), `node:test`, `tsc --strict` (shared lock), Nix module-eval, shell checks.

## Terms (defined once)

- **HP** = the host plan at host commit `566fd0d` (R'); **HS** = the host spec at `566fd0d`. Read with `hp`/`hs` (Environment). W4 deletes the host's router directory but not these two files; they stay the record (spec §6.1 amendment).
- **R'** = `566fd0d`, the source M5 moved. **B3** = this repository's `main` when T3.0 starts (recorded). **R5** = the commit that ends Group 5 (the flake's *R*). **R6** = T6.1's commit.
- **TR** = `packages/task-router`, **TM** = `packages/token-meter` (both relative to this repository).
- Task ids are HP's (`T3.1` … `T7.1`, `H6.0` … `H6.4`); flake-only tasks are `F3.n`, `F5.n`. HP's plants keep their numbers (`P9` …); this plan's are `FP1` ….
- **Private layer (PL):** checks that cannot live in the flake and run from `~/.cache/pi/router-g37/` (D9, D10): the host replay, the r4 stand-in, the edge matrix's raw output.

## Global constraints

- Behaviour = HS (r3 + 2026-10-25 amendment). This plan decides paths, checks and the flake-only steps; where it and HS disagree on behaviour, HS wins (stop and report).
- Keep the review-G2 fixes in front of the new selection: `capToTable` first in `planSpawn`, the requirement check (`beyondTop`), `planLegs`' `error` and review lowering (HP Execution Record, "Open for Group 3"). F3.0 pins them.
- Free-cloud slot: its code stays (member `qwen-cloud`, counter, caps, `FREE_CAP_PROVIDER`, free-cap block); its **default model is `""`** from T5.4 (`order: 1`, `slots: 2`, `dailyCap: 950` kept). The OpenRouter free Qwen is retired: no default names it after T5.4; only `test/fixtures/today-config.json` (the rollback and the oracle) and the golden grid's explicit model list keep its name. Local Qwen (`llama/qwen3.8`) is the only Qwen default. Haiku, Sonnet, Opus are `anthropic/claude-{haiku,sonnet,opus}-5-5` (provider `anthropic`; the subscription is the host's `claude-auth`, not router code).
- Models are configured through `programs.piEconomics.taskRouter.settings` (free-form JSON, spec §6.2; no typed options); every default lives in `TR/core/settings.ts` (MP1).
- **Scout gate:** no commit changes `BUILTIN_PROFILES.{scout,review,lookup}`' `level`/`minLevel`/`ability`, or `importanceTable.read`/`review` rows 0–2, except as HP's T5.2/T5.8 write them, until H6.4 (the bench scout run, Haiku medium vs local Qwen vs Sonnet high) is recorded. T6.1 is the only task that acts on its outcome.
- `flake.nix` and `flake.lock` unchanged from B3 (AC7 here). No new flake input.
- Nothing here reaches the host until the host moves its `pi-economics` lock (M5 Q7; spec §9.1 amendment). That move is a host step under the host's rules, not a task of this plan (D17).
- Commits: unsigned, pathspec only: `git add <new files>; git -c commit.gpgsign=false commit -o <paths> -m "router(<id>): <title>"`. Never `git add -A`/`-u`; other agents commit here.
- Heavy work (any `nix build` of `module-eval`, the gate) waits while `~/.cache/pi/pluto-exec/owner-deploy.flag` exists (`flag`).
- Leak rules (`AGENTS.md`): new fixtures use neutral names (`local/qwen`, `http://local.invalid:11545`, user `u`); `earth` stays only where M5 left it, until P.

## Review Focus

1. **A settings file that re-enables the free cloud with only its model** (`{"models":{"qwen-cloud":{"model":"<free>"}}}`) after T5.4: it is an ordinary member — cost 0, `order: 1` (after local), 2 slots, cap 950 (HS §4.9). Test in T5.4 (Step 2b).
2. **A short custom table** (the `cap381` config: `profiles.x = {ability: "read", table: "mine"}`): the selection must run on the same capped settings as the plan (D12). Test in T3.4 (Step 2b).
3. **Blank members under the new selection** (`opus`, `sonnet`, both blank; `review: {ability: "write"}`): a clean rejection or a route, never a throw. F3.0, re-run in every task.
4. **A rendered Home Manager settings file with `models` overrides** reaches the loader with 0 problems and the members as written. F5.2.
5. **An explicit Qwen model while the cloud slot is empty** (`llama/qwen3.8` on a busy local): waits `queueMaxSec`, then rejected; never the cloud (D14 + MP2). HP T3.6's cases run with `models.qwen-cloud.model = ""` too (T3.6 Step 2b).

---

## Motivation

Spec §6.1 amendment and §9 amendment: M5 moved the router at R' (after the redesign's Group 2 and its review fixes); after W the redesign's Groups 3–7 continue here, Q and P follow them. The router still resolves Qwen legs through today's chain (`pickQwen`: free cloud first), has no member runtime, logs no levels, and its defaults are the today-equivalent configuration (free OpenRouter Qwen, Haiku blank). Groups 3–7 replace the chain by cheapest-fit selection over members (G3), log requirement, levels and the started member (G4), flip the defaults one delta at a time to the end state — local Qwen first, Haiku as the cheap fallback, the free cloud empty (G5) — and gate the `lookup` level on a bench scout run (G6). The host plan holds the tasks; it was written for the host's tree and gates (`pi-task-router`, desktops, pluto, `tsc` by hand). This plan moves them onto this flake's packages and checks, keeps the oracle and grid tests runnable here, and adds what only the flake has: the golden file of spec §6.3, the bench's router projection and the module text.

## Approach

- **Tasks:** HP's G3–G7 in HP's order, each with HP's RED/GREEN/tests-changed/plants, on `TR`/`TM` paths (table "Path map"). Flake-only tasks slot in where their precondition lands: F3.0 (edge matrix test) and F3.1 (golden format) before T3.1; F3.2 (bench `contextFit`) after T3.1; F5.1 (golden `today` fixture) after T5.1; F5.2 (models fixture) after T5.5.
- **Gates (table "Gate map"):** HP's G0 = the node suite; G1 = `task-router` + `typecheck-task-router` + `router-golden` (+ `log-contract` for HP's L9 files); G2 = token-meter and module checks; G5 (`tsc` by hand) = `typecheck-task-router`, which is stricter (test/ included, node types present, no baseline filter); G3/G4/G6 (desktops, pluto, runner gate) belong to the host lock move. Per group: `rg-gate.sh` (every check, both refs, formatter, AC7, PL).
- **Golden (`router-golden`):** stays green at every commit. F3.1 renames the chain section to `select` and prints members (zero decision change); T3.3, T3.4, T3.5 adapt the generator's selection driver; a task that moves a decision re-records `golden.txt` in its own commit, appends a `# <task>: re-recorded <date>` line, and records the diff (sections, line counts). The P2 assertion becomes an invariance over the empty-slot fixture (F3.1) and, from T5.4, over the defaults (MP2). F5.1 adds a third fixture `today` (the rollback), the only golden witness of the configured free-cloud code after D3.
- **Oracle and grid:** in the flake, as package tests: `test/oracle.test.ts` (sha256 pins), `test/golden.test.ts` (today grid; from T5.1 the default-delta grid), `test/chain-table.test.ts` (→ the selection delta table, T3.4). In PL: the r4 stand-in `grid-sut.mts`, parametrized (`TR`, `MODE`), today mode 0/0 at every gate, defaults mode from T5.1 with the counts per flip; the host replay from R' (today 159/159; defaults E from T5.6); the edge matrix's raw output (0 `THROW`).
- **Selection candidates on capped settings (D12):** `planSpawn` returns the worker leg's candidates; the policy selects over them instead of recomputing `candidates` on uncapped settings (HS S9).
- **Module and bench:** T5.10's Home Manager text lands in `modules/task-router.nix` with a module-eval case; the bench projection gains `contextFit` (HS §5.1, §6.5; F3.2); F5.2 makes "models via `taskRouter.settings`" a tested, documented example.

## Path map (host → flake)

| Host (HP/HS) | Flake | Note |
|---|---|---|
| `TR/core/*`, `TR/test/*`, `TR/index.ts`, `TR/package.json` | `packages/task-router/…` (same relative paths) | |
| `TR/test/host-replay.test.ts`, `TR/test/host-fixtures/` | PL: scratch copy from R' (D9) | private data, never in the flake (spec §6.3) |
| `TR/nix/hm-module.nix` (T5.10 description, example) | `modules/task-router.nix` (`settings` description, example) | |
| `$ai/pi-extensions.nix:214` (registry description) | `modules/task-router.nix` `extensions.task-router.description` | |
| `checks/pi-extensions.nix:64,261` (`cloudDailyCap = 500`) | `checks/module-eval/cases/task-router.nix` (`task-router-settings`) | |
| `TM/core/contract.ts`, `TM/test/contract.test.ts` | `packages/token-meter/core/contract.ts`, `…/test/contract.test.ts` | T4.4 |
| `TM/core/levels.ts`, `TM/test/levels.test.ts` (new) | `packages/token-meter/core/levels.ts`, `…/test/levels.test.ts` | T4.5 |
| `TM/core/analyse.ts:230` `TIER_RANK` | `packages/token-meter/core/analyse.ts:230` (`{ qwen: 0, T1: 1, T2: 2 }` today) | T4.5 |
| `TM/LOGS.md` | `packages/token-meter/LOGS.md` | T4.6 |
| `checks/pi-log-contract/contract.ts` | `checks/log-contract/contract.ts` (required events at `:120`) | T4.7 |
| `docs/pi-token-economics.md` | `docs/pi-token-economics.md` (moved by M5.D) | T5.11; if M5 did not move it: stop, ask main |
| `docs/README.md` plan row | none here (no index); `docs/pi-economics.md` § `taskRouter` + this plan's record | host row: main's host edit (T7.1) |
| `pkgs/pi-bench`, `~/.pi/agent/bench/arms.json` | `packages/bench` (no code change), arms as data under `bench.dataDir` | G6 |
| — | `checks/router-golden/{generate.ts,golden.txt,default.nix}` | F3.1, T3.3–T3.5, G5 flips |
| — | `modules/bench.nix` `routerModelKeys`, `checks/module-eval/cases/bench.nix` | F3.2 |

## Gate map

| HP gate | Flake | When |
|---|---|---|
| G0 node suite | `suite $TR` (and `suite $TM` in G4) | every task |
| G1 `pi-task-router` | `nb task-router`, `nb typecheck-task-router`, `nb router-golden` (`inner`) | every task |
| G1 + `pi-log-contract` (L9: `test/harness.ts`, `core/shell.ts`, `core/outcome.ts`, `core/log.ts`) | `nb log-contract` | every task touching those files |
| G2 | `log-contract`, `token-meter`, `typecheck-token-meter`, `iface-experiments-token-meter`, `iface-subagents-task-router`, `iface-experiments-task-router`, `module-eval`, `home-files` | group end (in `rg-gate.sh`); `module-eval` also in F3.2, F5.2, T5.10 |
| G3 desktops, G4 pluto (AC8), G6 runner gate | N/A here; the host lock move step (Layer B: gate, pluto comparison, home files, term scan) | at R5 and R6 (D17) |
| G5 `tsc` by hand | `typecheck-task-router` (whole tree, `--strict`, `@types/node`; no filter) | every task |
| G-AC7 | `git diff --quiet $B3 HEAD -- flake.nix flake.lock` | group end |
| — | PL: replay today (159/159), stand-in today (0/0), matrix (0 `THROW`); from T5.1 stand-in defaults; from T5.6 replay defaults (E) | group end; and where a task says |
| — | `fmt --check $(git ls-files '*.nix')`; every check on `git+file:` and `path:` | group end (`rg-gate.sh`) |

## Decisions

| # | Choice | Why | Rejected |
|---|---|---|---|
| D1 | Start when W's Execution Record is closed (W's last lock-moving step done) and M5's is closed; work on `main`; B3 recorded in T3.0 | Spec §9 amendment ("after W"); the W plan locks `?ref=main` (W plan D1), so a G3 commit on `main` before W's last lock move would ride into a W step that claims a pure move | Starting after W4 on `main`: a later W lock move (W5/W6 drift) would carry G3 (open question Q1 offers a branch) |
| D2 | Task ids are HP's; flake-only tasks `F3.n`, `F5.n` | the record maps 1:1 onto HP and HS's milestones | New ids: two numbering schemes for one redesign |
| D3 | HP's task text at `566fd0d` is the task body; this plan states only the flake deltas | the host plan stays the record (§6.1 amendment); copying 900 lines would fork it | A full re-write: two diverging copies |
| D4 | Gates as in "Gate map"; the full gate `rg-gate.sh` once per group | G1 costs ~1 min here (three checks), the full gate ~25 min; HP's per-group rhythm | Full gate per task |
| D5 | `typecheck-task-router` on every task; new tests are written `--strict`-clean (explicit `any` allowed, as the suite does) | M5 D4 put `test/` under the type check; HP's G5 baseline (`TS2591`, `TS7006`) does not exist here | A filter like HP's G5: hides what the flake already rejects |
| D6 | `router-golden` green at every commit; a decision-moving task re-records in its commit; `golden.txt` keeps R'’s header and gains one `# <task>: re-recorded <date>` line per re-record; the diff summary (`rerecord` output) goes to the record | §6.1 amendment ("each re-records the golden file, and its diff is the evidence"); comment lines are ignored by the comparison | Re-recording per group: red checks inside the group |
| D7 | P2 in `router-golden` = invariance: for a fixture whose cloud is empty, (a) exactly 48 `select <fx>` lines, (b) no pick names `qwen-cloud`, (c) per `local=` state one distinct pick pair (the cloud's state changes nothing). Fixtures: `empty-slot` from F3.1, plus `defaults` from T5.4 | §6.1 P2 + HS MP2; after T3.4 an empty-slot line may `wait` for the **local** slot (D5 of HS), which today's `grep ' wait'` would reject falsely | Keeping the grep: red at T3.4 for a correct decision |
| D8 | F5.1: a third golden fixture `today` = `test/fixtures/today-config.json` | after T5.4 both other fixtures have an empty cloud; `today` is then the only recorded witness of the configured free-cloud code and of AC1 at golden level; it never changes in G5 | No third fixture: the slot's code would be unrecorded (open question Q7) |
| D9 | The host replay runs in PL from a scratch copy: `TR` + R'’s `test/host-replay.test.ts` + `test/host-fixtures/` (`git dot archive 566fd0d`); T5.6's "defaults → E" assertion is a private file `~/.cache/pi/router-g37/replay/host-replay-defaults.test.ts`, never committed; flake-visible stand-ins for E are HP T5.6's `policy.test.ts` rows 4, 12–14 and `select.test.ts` P-ctx | spec §6.3: the October log is private data and stays out of the flake; W4 deletes the files from the host's tree, R' keeps them | An anonymized fixture in the flake: contradicts §6.3 (open question Q2) |
| D10 | The r4 stand-in stays outside both repositories (`~/.cache/pi/router-g37/grid-sut.mts`, from `router-r2/r4new/grid-sut.mts`), parametrized by `TR` and `MODE` (S6); today mode 0/0 at every group gate; defaults mode from T5.1, with HP's counts per flip as the criterion | §6.1 amendment: the oracle scripts live under `~/.cache/pi`; an independent model, not the package's own oracle | A flake check importing the r4 model (open question Q3) |
| D11 | F3.0: the review-G2 edge matrix becomes a package test `test/edge-matrix.test.ts`: ∀ config × kind × importance × t2: `spawn` resolves (accept or reject), never throws, an accepted spawn names an enabled member's model | pins "keep M1 guards and capToTable in front of the new selection" for every later task; neutral data, unlike the replay | Only the scratch `matrix.mts`: a check nobody runs between gates |
| D12 | `SpawnPlan` gains `cands: string[]` (the worker leg's candidate names, from `planSpawn`'s capped settings and `need`, in `(cost, order, name)` order); the policy builds `resolveLeg`'s `cands` from it (`start.pinned ? [M] : cands`) and `failover` likewise; HS S9's `candidates(s, …)` recomputation is not used | `capToTable` clamps member levels for one plan only (review G2 M2 (b)); recomputing on raw settings can list a member the plan clamped | HS S9 verbatim: a plan/selection mismatch under short custom tables (Review Focus 2) |
| D13 | Free-cloud slot as in "Global constraints"; T5.4 adds the Review-Focus-1 test; `router-golden`'s P2 then covers `defaults` too | owner: the OpenRouter free Qwen is removed, the slot code stays (§1, HS §4.9) | Deleting `qwen-cloud`: the code would go (owner keeps it) |
| D14 | Models stay free-form under `taskRouter.settings.models` (§6.2); F5.2 adds `TR/test/fixtures/models-example.json` (neutral), read by a package test and by a module-eval case; the option `example` names `models` | makes "configurable via `programs.piEconomics.taskRouter.settings`" a tested contract across both layers without IFD (`lib.importJSON` of a source file) | Typed `models` options: §6.2 forbids, `core/settings.ts` owns the schema (open question Q6) |
| D15 | F3.2: `routerModelKeys` += `"contextFit"` | HS §5.1, §6.5: the bench projection is `models + queueMaxSec + contextFit`; from T3.1 the router reads it | Leaving it out: an arm runs with the router's default filter while the host sets another |
| D16 | Scout gate as in "Global constraints"; AC5's test (T5.8) is the pin; T6.1 changes `profiles.lookup.minLevel` only (OD15); `scout` and `review` stay at read 2 whatever the bench says | HS §7, OD5, OD14, OD15 | Lowering `scout` on a pass: OD15 says the gate decides `lookup` only (open question Q5) |
| D17 | What reaches the host: nothing until the host moves its lock. R5 and R6 each need a host step (owner or main): Layer B (§8.2), the W4.2 settings `K` revisited (Q4), activation H6.0 | M5 Q7; §9.1 amendment | A host edit from this plan: the host is read-only here |
| D18 | A review card per behaviour group (G3, G5) and for G4, before the next group starts (Opus, the host's practice for G0–G2) | each group changes routing or logs others build on | Review only at the end: G5 would build on an unreviewed selection |
| D19 | Docs move with the change that makes them wrong: `docs/pi-economics.md` § `taskRouter` in T3.4 (golden paragraph), F3.2 (projection list), T5.10 (description), T5.11; `docs/pi-token-economics.md` in T5.11; `TM/LOGS.md` in T4.6 | `AGENTS.md` (docs in sync) | One docs task at the end |

## The gate (rules)

No principles document; the gate is spec §4's rules, §8's testing rules, `AGENTS.md`, HS §8 and the M0–M6 lessons.

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: every task has a RED (HP's or this plan's); characterization tasks (F3.0, F3.1, F5.1) see red through a plant |
| No `builtins.match` on generated text | PASS: module-eval cases use `eq`/`holds`; `router-golden` is shell (`grep`, `awk`, `diff`, linear) |
| Assertion messages `pi-economics:` with a negative case | N/A: no new assertion |
| No import-from-derivation | PASS: F5.2 reads a source file with `lib.importJSON` |
| Typed options; settings free-form where §6.2 says | PASS: no new option; `taskRouter.settings` stays free-form (D14) |
| Settings files literal text; merges `recursiveUpdate` | PASS: unchanged writers; F3.2 extends a filter list |
| Scripts strict | PASS: `router-golden` keeps `set -euo pipefail` |
| Alejandra | PASS: CLEAN steps of F3.2, F5.2, T5.10; `rg-gate.sh` runs `fmt --check` |
| Markdown under `docs/` | PASS |
| `flake.lock` unchanged | PASS: AC7 per group |
| Leak patterns | PASS: neutral fixtures; `leak` in every group gate; PL files stay outside the repository |
| Host read-only | PASS: `git dot show`/`archive`/`log` only (D17) |
| Existing tests preserved or changed with a reason | PASS: HP's "Tests changed" lines; flake-only changes: `task-router-settings` key (T5.10, legacy key), `bench-router-default` (F3.2, new key), `router-golden`'s P2 form (F3.1, D7) |
| Pure core, functional shell | PASS: `pickMember`, `candidates`, `levelsOfLine` pure (HS §6.6) |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION.

## Files to read first

Listed, not summarized.

- This repository: `AGENTS.md`; the spec §1, §6 (with amendment), §7 (`router`), §8.1, §8.3, §9 (with amendment), §9.1 W4; `docs/plans/2026-10-25-m5-task-router-plan.md` (D4, D6–D9, D14, D16, S5, Q1–Q7, its Execution Record: `T`, the final case count, M5.D's outcome); `docs/pi-economics.md` § `taskRouter`.
- HP (`hp`): "Revision r2", "Approach", "Decisions made", "Scenario coverage", "Properties", "Planted violations", "Coverage gap", Snippets S1, S5–S11, Groups 3–7, the Execution Record's "Deviations decided in the plan" and "Review of Group 2 and its fixes" (the "Open for Group 3" list).
- HS (`hs`): §1.2, §1.4, §4.1–§4.11, §5.1–§5.5 (§5.4's amendment), §6.1–§6.5, §7, §8, §9, §10.
- Reviews: `~/.pi/agent/notes/2026-10-25-review-router-g2.md`; `~/.cache/pi/fix-r-g2/report.md`.
- Owner facts: `~/.pi/agent/notes/2026-10-17-router-redesign-decisions.md` (Haiku 5.5: write 0 / read 1 hypothesis, ladder medium/high, 1M window, cost 1).
- Oracle scripts: `~/.cache/pi/review-router/r4/{model.mts,grid.mts,replay.mts,cases.mts,results.txt}`, `~/.cache/pi/router-r2/r4new/grid-sut.mts`, `~/.cache/pi/fix-r-g2/matrix.mts`.
- Host W plan `docs/plans/2026-10-25-pi-economics-wiring-plan.md` W4 (`K`, W4.2) and "Q7" (host read-only).
- Implementation (when the task needs it): `TR/core/{pipeline,select,table,policy,failover,health,cloud,chain,shell,guards,outcome,log,settings,members}.ts`, `TR/test/{harness,fake-api,golden/*,chain-table.test,select.test,table.test,top.test}.ts`, `checks/router-golden/*`, `checks/log-contract/contract.ts`, `modules/{task-router,bench}.nix`, `checks/module-eval/cases/{task-router,bench}.nix`, `TM/core/{contract,analyse}.ts`, `TM/LOGS.md`.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| `tsc --strict` via `typecheck-task-router` (index.ts, core/, test/) | every task | HP's G5 list (a `Plan` literal without `ability`/`level`, a `Child` without `member`/`reservedUntil` (T3.4), an unknown outcome key type); here also untyped test helpers, a `SpawnPlan` without `cands` (D12), a `PolicyDeps` still carrying `cloud` after T3.3 |
| `tsc --strict` via `typecheck-token-meter` | G4 tasks | `levelsOfLine`'s `Levels` shape, `TIER_RANK` record |
| `iface-subagents-task-router` | T3.3–T3.7, group gate | a router copy of `SubagentsApiV1` using a member the provider lacks (`list`, `retune`, `send` exist) |
| node type stripping | `task-router`, `router-golden`, `log-contract`, PL | syntax only; `generate.ts`, `contract.ts`, PL scripts are not type-checked (coverage gap) |
| Nix module system | `module-eval` | unknown options, non-JSON settings (F5.2, T5.10) |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package (`task-router`) | HP's unit, shell and property tests (G3–G6), the today golden grid against the oracle, from T5.1 the default-delta grid, the selection delta table, F3.0 edge matrix, F5.2 models fixture | node; ~20 s |
| Package (`token-meter`) | contract rules, `levelsOfLine`, `TIER_RANK` (G4) | node |
| Golden (`router-golden`) | every decision of `planSpawn` (grid) and of `resolveLeg` (selection, 96 states) under `defaults`, `empty-slot`, from F5.1 `today`; P2 invariance (D7) | node; ~25 s |
| Type check | D5 | shared lock |
| Log contract (`log-contract`) | every writer through `pi-analyse --check`; from T4.7 with a `reroute` and an `escalate` | node |
| Module eval (`module-eval`) | `bench-router-default` with `contextFit` (F3.2), `task-router-models` (F5.2), `task-router-description` (T5.10), the existing cases | Home Manager eval |
| Build (`home-files`) | the router's directory as pi loads it (unchanged) | — |
| Leak (`leak`) | new fixtures, golden file | — |
| PL: host replay | AC1 today 159/159; from T5.6 AC2 (diff = E) | host git at R'; private |
| PL: r4 stand-in | today 0/146,880 and 0/470,016; defaults from T5.1 (counts per flip) | r4 model |
| PL: matrix raw output | 0 `THROW`; from T5.4 no `openrouter/` line | — |
| Live, owner (H6.0) | real probe, wait, Haiku fallback, provider error and retune, `ui.notify` | host lock move + activation |
| Bench (G6) | Haiku/Qwen scout quality (OD14) | quota, earth up |
| Host Layer B (pluto, desktops, term scan) | N/A here: the host lock move step (D17) | host |

## Scenario coverage

HP's "Scenario coverage" table holds for G3–G7 with these substitutions: every HP check named `pi-task-router` runs as `task-router`; `pi-log-contract` → `log-contract`; `pi-token-meter` → `token-meter`; `pi-extensions` → `module-eval` (`task-router-*` cases); `host-replay.test.ts` → PL replay (D9); G-AC7 → AC7 here; AC8 → the host lock move (D17). Flake-only scenarios:

| Scenario | Check (task) |
|---|---|
| spec §6.1 P2 / HS MP2: empty slot ignored, at golden scale | `router-golden` P2 invariance on `empty-slot` (F3.1), on `defaults` (T5.4) |
| The free-cloud code still works when configured (owner: code stays) | `router-golden` `today` fixture (F5.1); HP's `base: "today"` tests; Review Focus 1 test (T5.4) |
| Review-G2 guards in front of the selection | `edge-matrix.test.ts` (F3.0), every task |
| Selection on capped settings (D12) | `policy.test.ts` "short custom table: selection over the plan's candidates" (T3.4) |
| Bench arms get `contextFit` | `bench-router-default` (F3.2) |
| Models configurable via `programs.piEconomics.taskRouter.settings` | `task-router-models` (module-eval) + `settings.test.ts` "models example" (F5.2) |
| Module text (HS §5.5, mi13) | `task-router-description` (T5.10) |
| Golden decisions moved only where the task says | `rerecord` diff summary per task, in the record (D6) |
| Scout gate | AC5 test (T5.8) + FP6; H6.4 record; T6.1 |
| Oracle/grid runnable here | `golden.test.ts`, `oracle.test.ts`, `chain-table.test.ts` in `task-router`; PL stand-in (D10) |

## Properties

HP's P-mono, P-imp, P-nomax, P-floor, P-explicit, P-att, P-slots, P-ctx, P-cheapest, P-empty, P-ro hold as HP states them, in the tasks HP names. Flake-only:

- **P-golden** `gen(TR) = golden.txt` (comment lines aside) at every commit; for a task `t`, `sections(diff_t) ⊆ expected(t)` (table "Golden movement").
- **P-empty-golden** `∀ fx ∈ E(t): |select fx| = 48 ∧ ∀ l ∈ select fx: qwen-cloud ∉ picks(l) ∧ ∀ l, l′ with local(l) = local(l′): picks(l) = picks(l′)`, with `E(t) = {empty-slot}` before T5.4, `{empty-slot, defaults}` from T5.4.
- **P-today-fixed** `∀ t ∈ G5 ∪ {T6.1}: diff_t ∩ lines(today) = ∅` (the rollback reproduces today; AC1 at golden scale).
- **P-guard** `∀ c ∈ CONFIGS, k, i, t2: spawn(c, k, i, t2) ∈ {accept(m), reject(text)}`, `m` an enabled member's model (F3.0).
- **P-cands** `∀ plan p: set(resolveLeg.cands(p)) ⊆ set(p.cands)` (unpinned: equal), and `∀ m ∈ p.cands: lvl_capped(m, a) ≥ p.worker.level` (D12).
- **P-proj** `taskRouter.enable ⇒ bench.router = recursiveUpdate (filterAttrs (∈ routerModelKeys) s) {randomize.enabled = false; spotCheck.enabled = false;}`, `"contextFit" ∈ routerModelKeys` (F3.2).
- **P-models** `fromJSON(file(settings = X)) = X` and `loadSettingsReport(X).problems = []`, `∀ m ∈ keys X.models: settings.models[m].model = X.models[m].model` for `X = models-example.json` (F5.2).
- **P-stand-in** `today: (0, 0)` at every gate; `defaults: (plan, explicit)` = `(7917, 9411)` at T5.1 − Σ counts of the flipped deltas (HP T5.1's `COUNTS`): after T5.2 `(6957, 8835)`, T5.3 `(6912, 8820)`, T5.4 `(6912, 6456)`, T5.5 `(0, 0)`, unchanged after.

### Golden movement (expected per task; a different movement stops the task: report, do not adjust)

| Task | Sections that change | Expected |
|---|---|---|
| F3.1 | the chain section's name and pick format | decisions equal: the mechanical map of S2 turns the old file into the new one |
| T3.1, T3.2, T3.3, T3.5–T3.7, G4 | none | zero diff (T3.3, T3.5: the driver adapts, decisions stay) |
| T3.4 | `select defaults`: exactly HP T3.4's 22 picks in 19 lines; `select empty-slot`: the 36 lines with `local ∈ {busy, own, down}` (old: Sonnet; new: `wait` then `haiku:api/haiku:medium`, `down`: Haiku at once), the 12 `local=up` lines unchanged | derived, not measured (EMPTY_SLOT enables Haiku at write 0): a differing count stops the task |
| F5.1 | new `… today …` lines | `today` lines = `defaults` lines with `defaults` → `today` (defaults equal the fixture until T5.2) |
| T5.2 (D12), T5.3 (D1) | `plan`/`explicit` lines of `defaults` and `empty-slot` | `today` unchanged |
| T5.4 (D3) | `explicit defaults` (free model → `REJECT`), `select defaults` | `empty-slot`, `today` unchanged |
| T5.5 (Haiku) | `plan defaults` (D15), `explicit defaults` (D11), `select defaults` (D2) | `empty-slot`, `today` unchanged |
| T5.6 (D6), T5.7 (D7), T5.8, T5.9, T6.1 | none | zero diff (grid cards list no files; no runtime pick in the generator; `lookup` not in the grid's kinds; labels only) |

## Planted violations

HP's P9–P27 and P29–P33 keep their tasks, plants and expected reds, with HP's check names mapped (Gate map); P19 fails `log-contract` naming `outcomes.workerLevel`; P25, P26, P27's replay reds are seen in PL (`rg-private.sh`), their grid reds in `task-router`. P28 (AC8) is the host lock move's. New:

| # | Check | Plant | Must FAIL with | Task | Seen |
|---|---|---|---|---|---|
| FP1 | `edge-matrix.test.ts` | `core/pipeline.ts`: drop the `req.level > T` rejection | a `TypeError` in a `both` cell (`scout` or `review`: floor read 2 above `top(read)`) | F3.0 | [ ] |
| FP2 | `edge-matrix.test.ts` | `core/pipeline.ts`: `const s = d.settings` instead of `capToTable(…)` | the `cap381` cells differ from the pinned outcomes | F3.0 | [ ] |
| FP3 | `router-golden` P2 | in `golden.txt`, replace the picks of `select empty-slot local=up cloudRunning=1 cloud=open` by `wait wait` (`sed -i 's/^\(select empty-slot local=up cloudRunning=1 cloud=open\) .*/\1 wait wait/'`) | `router-golden: with the free-cloud slot empty, the cloud's state changes a decision (empty-slot)` | F3.1 | [ ] |
| FP4 | `router-golden` P2 | the same line's picks → `qwen-cloud:x:xhigh qwen-cloud:x:xhigh` | `router-golden: an empty free-cloud slot is picked (empty-slot)` | F3.1 | [ ] |
| FP5 | `bench-router-default` | `routerModelKeys` without `"contextFit"` | `router: expected …contextFit…` | F3.2 | [ ] |
| FP6 | AC5 test (`policy.test.ts`) | `BUILTIN_PROFILES.lookup.minLevel = 0` before H6.4 | AC5 `lookup` case (Sonnet expected) | T5.8 | [ ] |
| FP7 | `router-golden` P2 on `defaults` | after T5.4, `models.qwen-cloud.model` default back to the free model | `router-golden: an empty free-cloud slot is picked (defaults)` and the decisions diff | T5.4 | [ ] |
| FP8 | `router-golden` `today` | delete `"haiku": {"model": ""}` from `today-config.json` in a scratch copy, run `gen` | `today` lines differ (D2/D11/D15 cells) | F5.1 | [ ] |
| FP9 | `task-router-models` | `modules/task-router.nix` writes `builtins.toJSON (removeAttrs cfg.settings ["models"])` | `settings file: expected …` | F5.2 | [ ] |
| FP10 | `settings.test.ts` "models example" | in the fixture, `haiku.efforts = ["max"]` | `problems: expected [] …` | F5.2 | [ ] |
| FP11 | `task-router-description` | old description string | `registry description: expected …` | T5.10 | [ ] |
| FP12 | `policy.test.ts` "short custom table" | policy recomputes `candidates(s, …)` on `d.settings` (HS S9) | the started member is not in `plan.cands` | T3.4 | [ ] |
| FP13 | PL replay harness | `core/pipeline.ts`: pass `"normal"` instead of `i.importance` to `planLegs` | `host-replay.test.ts` red naming high/critical ids (proves the scratch copy runs the flake's code) | T3.0 | [ ] |
| FP14 | PL stand-in defaults | after T5.1, scratch: T5.2's GREEN (`read` row 2 critical → `C(2, 1)` in `core/settings.ts`) | stand-in defaults `(6957, 8835)` instead of `(7917, 9411)` (proves the mode reads the production defaults) | T5.1 | [ ] |

## Coverage gap

- HP's coverage gap (real llama probe, real wait and Haiku fallback, Haiku's quality beyond scouts, real provider error and retune, `ui.notify` live, `list()` timing against the 60 s reservation, two main sessions sharing earth's slot): H6.0, after the host lock move.
- The host replay and the r4 stand-in are not flake checks: a commit between gates can break them unseen until the group gate (PL).
- `generate.ts`, `contract.ts` and PL scripts are not type-checked.
- The golden file does not reach the context filter (grid cards list no files), the failover, the explicit model's runtime resolution or the counter's file: package tests only.
- The analysis skill's text is not checked against the new `LOGS.md` fields (no field list there today).
- Pluto, the desktops, the host's term scan and home-file comparison: the host lock move step.
- The bench arms with the projected router settings: no check runs an arm; H6.2 runs `qwenl`, `haiku`, `sonnet` only.

## Environment (every step)

`~/.cache/pi/router-g37/env.sh` (written in T3.0):

```sh
source ~/.cache/pi/m5env.sh   # XDG dirs, cd, F (git+file), Fp (path:), o, cap, nb, nbp, ne, fmt, nbl, RP=566fd0d, hr
C=$HOME/.cache/pi/router-g37; TR=packages/task-router; TM=packages/token-meter
B3=$(cat $C/B3 2>/dev/null)
flag() { while [ -e ~/.cache/pi/pluto-exec/owner-deploy.flag ]; do sleep 60; done; }
hp() { git dot show "566fd0d:projects/nixos/new/docs/plans/2026-10-17-task-router-abilities-plan.md"; }
hs() { git dot show "566fd0d:projects/nixos/new/docs/specs/2026-10-17-task-router-abilities-design.md"; }
suite() { (cd "$1" && node --test --experimental-strip-types test/*.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)'); }
gen() { node --experimental-strip-types --no-warnings checks/router-golden/generate.ts "$1"; }
inner() { suite $TR && nb task-router && nb typecheck-task-router && nb router-golden; }
# rerecord <task>: rewrite golden.txt from TR, keep the header, add one line, summarize the diff by section and fixture
rerecord() {
  local t=$1 g=checks/router-golden/golden.txt
  cp $g $C/golden.$t.before
  { grep '^#' $C/golden.$t.before; printf '# %s: re-recorded %s\n' "$t" "$(date -u +%F)"; gen $TR; } > $g.new && mv $g.new $g
  diff <(grep -v '^#' $C/golden.$t.before) <(grep -v '^#' $g) > $C/golden.$t.diff || true
  echo "changed lines: $(grep -c '^>' $C/golden.$t.diff)"; awk '/^>/{print $2, $3}' $C/golden.$t.diff | sort | uniq -c
}
```

`~/.cache/pi/router-g37/gate.sh <label>` (m2gate style; after the group's last commit; output `$C/<label>/result.txt`):

```sh
#!/usr/bin/env bash
source ~/.cache/pi/router-g37/env.sh
O=$C/$1; rm -rf $O; mkdir -p $O; exec > $O/result.txt 2>&1
git status --short --untracked-files=no | sed 's/^/WORKTREE /'      # other agents' staged files show here; the gate reads the index
for ref in "$F" "$Fp"; do
  flag
  names=$( (ulimit -v $cap && exec timeout -s KILL 900 nix eval --json "$ref#checks.x86_64-linux" --apply builtins.attrNames "${o[@]}") ) &&
    names=$(jq -er '.[]' <<<"$names") || { echo "LISTING FAILED $ref"; continue; }
  [ -n "$names" ] || { echo "LISTING EMPTY $ref"; continue; }
  for c in $names; do
    flag
    p=$( (ulimit -v $cap && exec timeout -s KILL 900 nix eval --raw "$ref#checks.x86_64-linux.$c.outPath" "${o[@]}") 2>/dev/null) && [ -e "$p" ] && nix-store --delete "$p" >/dev/null 2>&1
    if (ulimit -v $cap && exec timeout -s KILL 1800 nix build --no-link -L "$ref#checks.x86_64-linux.$c" "${o[@]}") > $O/$c.log 2>&1
    then echo "ok $c ($ref)"; else echo "FAILED $c ($ref)"; tail -n 15 $O/$c.log; fi
  done
done
fmt --check $(git ls-files '*.nix') && echo "fmt ok" || echo "FAILED fmt"
[ -n "$B3" ] && git diff --quiet "$B3" HEAD -- flake.nix flake.lock && echo "AC7 ok" || echo "FAILED AC7"
bash $C/private.sh
echo "failures: $(grep -cE '^(FAILED|LISTING)' $O/result.txt)"; echo GATE-DONE
```

`~/.cache/pi/router-g37/private.sh` (PL; prints one line per layer; `FAILED …` on a miss):

```sh
source ~/.cache/pi/router-g37/env.sh
S=$TMPDIR/rg-private; rm -rf $S; mkdir -p $S; cp -r $TR $S/tr
h=modules/home-manager/features/ai/extensions/task-router/test
(cd ~/projects/nixos/new && git dot archive 566fd0d -- $h/host-replay.test.ts $h/host-fixtures) | tar -x -C $S
cp $S/$h/host-replay.test.ts $S/tr/test/ && cp -r $S/$h/host-fixtures $S/tr/test/
[ -e $C/replay/host-replay-defaults.test.ts ] && cp $C/replay/host-replay-defaults.test.ts $S/tr/test/
(cd $S/tr && node --test --experimental-strip-types test/host-replay*.test.ts 2>&1 | grep -E '^ℹ (pass|fail)' | tr '\n' ' ' | sed 's/^/replay: /'); echo
TR=$PWD/$TR node --experimental-strip-types --no-warnings $C/grid-sut.mts today
[ -e $C/defaults-mode ] && TR=$PWD/$TR node --experimental-strip-types --no-warnings $C/grid-sut.mts defaults
node --experimental-strip-types --no-warnings $C/matrix.mts $PWD/$TR > $S/matrix.out 2>&1
echo "matrix: $(grep -c . $S/matrix.out) cells, $(grep -c ': THROW' $S/matrix.out) throws, $(grep -c 'openrouter/' $S/matrix.out) free-cloud starts"
```

`$C/defaults-mode` is created in T5.1; `$C/matrix.mts` is `~/.cache/pi/fix-r-g2/matrix.mts` copied in T3.0.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `TR/test/edge-matrix.test.ts` (new) | P-guard (D11) | F3.0 |
| `checks/router-golden/generate.ts` | `select` section; drivers for T3.3, T3.4, T3.5; fixture `today` | F3.1, T3.3–T3.5, F5.1 |
| `checks/router-golden/default.nix` | P2 invariance (D7), fixture list | F3.1, T5.4 |
| `checks/router-golden/golden.txt` | re-records | F3.1, T3.4, F5.1, T5.2–T5.5 |
| `TR/core/{verify,select,pipeline,table}.ts`, `TR/test/{select,table,verify}.test.ts` | context filter | T3.1 |
| `modules/bench.nix`, `checks/module-eval/cases/bench.nix`, `docs/pi-economics.md` | `contextFit` in the projection | F3.2 |
| `TR/core/{select,health,counter,policy,failover,freecap,shell,guards,pipeline,types}.ts`; `core/{chain,cloud}.ts` deleted | selection, runtime, failover (HP T3.2–T3.7) | T3.2–T3.7 |
| `TR/test/{select,health,policy,failover,cloud,chain-table,freecap,guards,fake-api}.test.ts` / `.ts`; `chain.test.ts` deleted | HP T3.2–T3.7 | T3.2–T3.7 |
| `TR/core/{outcome,log,policy,failover,shell}.ts`, `TR/test/{outcome,policy}.test.ts` | spawn, escalate, reroute fields | T4.1–T4.3 |
| `TM/core/{contract,levels,analyse}.ts`, `TM/test/{contract,levels,analyse}.test.ts`, `TM/LOGS.md` | contract, mapping, docs | T4.4–T4.6 |
| `checks/log-contract/contract.ts` | reroute + escalate | T4.7 |
| `TR/test/golden/{oracle,sut}.ts`, `TR/test/golden.test.ts`, `TR/test/*.test.ts` (`base: "today"`) | default-delta grid | T5.1 |
| `TR/core/settings.ts`, `TR/test/{settings,policy,failover,attempts,host-*}…` | the flips | T5.2–T5.8 |
| `TR/test/fixtures/models-example.json` (new), `TR/test/settings.test.ts`, `checks/module-eval/cases/task-router.nix`, `modules/task-router.nix` (example) | models via settings | F5.2 |
| `TR/core/{prompt,explicit,attempts,brief}.ts` + their tests | wording | T5.9 |
| `modules/task-router.nix`, `TR/package.json`, `checks/module-eval/cases/task-router.nix` | module text | T5.10 |
| `docs/pi-token-economics.md`, `docs/pi-economics.md` | docs | T5.11 |
| `TR/core/settings.ts`, `TR/test/policy.test.ts` | `lookup` floor | T6.1 |
| this plan | Execution Record | every group end, T7.1 |

---

## Tasks

| Task | Delivers | Commit message `router(<id>): …` |
|---|---|---|
| T3.0 | preconditions, B3, PL baseline | — |
| F3.0 | edge-matrix test | `edge matrix: never a throw (review G2 M1, M2)` |
| F3.1 | golden `select` section, P2 invariance | `golden: selection section by member, P2 as invariance` |
| T3.1 | context filter | HP's title |
| F3.2 | bench projection `contextFit` | `bench: contextFit in the router projection` |
| T3.2–T3.7 | HP | HP's titles |
| T3.8 | G3 gate, record, review | `record: group 3` |
| T4.1–T4.7 | HP | HP's titles |
| T4.8 | G4 gate, record, review | `record: group 4` |
| T5.1 | default-delta grid, `sutRouter(raw)`, stand-in defaults mode | HP's title |
| F5.1 | golden fixture `today` | `golden: the rollback fixture` |
| T5.2–T5.5 | HP flips | HP's titles |
| F5.2 | models via `taskRouter.settings` | `models example: package and module` |
| T5.6–T5.11 | HP | HP's titles |
| T5.12 | G5 gate; R5; review | `record: group 5 (R5)` |
| H6.0–H6.4 | scout gate (owner/agent with quota) | — |
| T6.1 | `lookup` floor | HP's title |
| T7.1 | close-out | `record: close-out` |

Every task starts `TODO`. One failing check at a time; a task's commit holds only green checks. Per task: RED → GREEN → CLEAN (CLEAN = HP's plants seen red and reverted, `inner`, plus `nb log-contract` for HP's L9 files), then commit with `-o <the task's paths>`.

### Group 3 — Selection

#### T3.0 — Preconditions, base, PL baseline · `TODO`

- [ ] **Step 1:** read "Files to read first".
- [ ] **Step 2 (preconditions, D1):** M5's Execution Record closed (note `T` and the module-eval count `N5`; M5.D moved `docs/pi-token-economics.md` or not); the host's W plan Execution Record closed (no W step left that moves the lock). Otherwise stop and ask main (Q1).
- [ ] **Step 3 (base):** `git rev-parse HEAD > ~/.cache/pi/router-g37/B3`; write `env.sh`, `gate.sh`, `private.sh` (Environment); `cp ~/.cache/pi/fix-r-g2/matrix.mts $C/`; `cp ~/.cache/pi/router-r2/r4new/grid-sut.mts $C/` and apply S6.
- [ ] **Step 4 (drift):** `git dot log --oneline 566fd0d..HEAD -- projects/nixos/new/modules/home-manager/features/ai/extensions/task-router projects/nixos/new/docs/specs/2026-10-17-task-router-abilities-design.md projects/nixos/new/docs/plans/2026-10-17-task-router-abilities-plan.md` (from the host). Router commits other than W4's deletion: port each first (task `T3.0.<n>`, its test first). A spec or plan amendment after R': read it; a behaviour change stops the plan (ask main).
- [ ] **Step 5 (baseline):** `flag; bash $C/gate.sh g3-base` → no `FAILED`; PL: `replay: pass 2 fail 0`, stand-in `today …: plan 146880 cases, 0 differ; explicit 470016 cases, 0 differ`, matrix `186 cells, 0 throws`. Record.
- [ ] **Step 6 (FP13):** the plant of FP13 in `TR/core/pipeline.ts` → `bash $C/private.sh` prints `replay: … fail` ≥ 1; [ ] red seen; revert (`git checkout -- TR/core/pipeline.ts`).

#### F3.0 — Edge matrix as a package test · `TODO` (D11; Review Focus 3)

**Files:** `TR/test/edge-matrix.test.ts` (new, S5).

- [ ] **Step 1 (GREEN-first, characterization):** S5 → `suite $TR` green (count `T + n_cells_tests`); `inner` green.
- [ ] **Step 2 (planted):** FP1, FP2 → red. [ ] [ ] red seen. Revert.
- [ ] Commit `TR/test/edge-matrix.test.ts`.

#### F3.1 — Golden: `select` section, P2 invariance · `TODO` (D6, D7)

**Files:** `checks/router-golden/{generate.ts,default.nix,golden.txt}`.

- [ ] **Step 1 (RED, the property first):** replace the `grep -E '^chain empty-slot …'` block of `default.nix` by S3 with `fixtures="empty-slot"`, reading `select` lines → `nb router-golden` FAILS `select empty-slot: expected 48 lines, got 0`. [ ] red seen
- [ ] **Step 2 (GREEN):** S2 (a): the chain section prints `select <fx> local=… cloudRunning=… cloud=… <member>:<model>:<effort>|wait …`, the member found by model (`memberOf`). `rerecord F3.1`; then the evidence: `sed -E 's/^chain /select /; s/ local:/ qwen-local:/g; s/ cloud:/ qwen-cloud:/g; s/ T1:/ sonnet:/g' $C/golden.F3.1.before | grep -v '^#'` equals the new file's non-comment lines (`cmp`); `nb router-golden` green.
- [ ] **Step 3 (planted):** FP3, FP4 → the two messages. [ ] [ ] red seen. Revert `golden.txt`.
- [ ] **Step 4 (docs, D19):** `docs/pi-economics.md` § `taskRouter`, golden paragraph: "the Qwen chain's 96 states" → "the selection's 96 states (`select` lines)"; the P2 sentence → the invariance (D7).
- [ ] Commit the three files and `docs/pi-economics.md`.

#### T3.1 — Context filter · `TODO` (HP T3.1)

HP T3.1 verbatim on `TR`. Flake deltas:
- [ ] RED/GREEN/CLEAN as HP (Cases A, B; P9, P10, P29 → `task-router`). [ ] P9 [ ] P10 [ ] P29.
- [ ] `need = i.verified.tokens ?? 0` replaces `need = 0` in `planSpawn`, **after** `capToTable` and the `beyondTop` check (keep their order; F3.0 green).
- [ ] `nb router-golden` green: zero diff (grid cards have no files).
- [ ] `inner`. Commit.

#### F3.2 — `contextFit` in the bench projection · `TODO` (D15)

**Files:** `checks/module-eval/cases/bench.nix`, `modules/bench.nix`, `docs/pi-economics.md`.

- [ ] **Step 1 (RED):** `bench-router-default` (S7): `s` and `want` gain `contextFit = 1;` → `flag; nb module-eval` FAILS `router: expected { contextFit = 1; …`. [ ] red seen
- [ ] **Step 2 (GREEN):** `routerModelKeys` += `"contextFit"`; the option description and `docs/pi-economics.md` list it. Green, count `N5`.
- [ ] **Step 3 (planted):** FP5 is Step 1's red; nothing more.
- [ ] CLEAN: `fmt modules/bench.nix checks/module-eval/cases/bench.nix`. Commit.

#### T3.2 — `pickMember` · `TODO` (HP T3.2)

HP verbatim. P11 [ ]. `router-golden` zero diff. Commit.

#### T3.3 — Member runtime · `TODO` (HP T3.3)

HP verbatim (`core/counter.ts` replaces `core/cloud.ts`; `PolicyDeps.probe(url)`, `counter`, `blocks`). Flake deltas:
- [ ] Golden driver (S2 (b)): `probe: async (_url) => …`, `counter: { today: (m) => m === "qwen-cloud" && cloud === "capped" ? cap : 0, bump() {} }`, `blocks: new Map(cloud === "blocked" ? [["qwen-cloud", NOW + 1]] : [])`; children entries carry `member` (`local` → `qwen-local`, `cloud` → `qwen-cloud`). `nb router-golden` green: zero diff.
- [ ] `nb log-contract` (`shell.ts`, L9). P31 [ ].
- [ ] `inner`. Commit with `generate.ts`.

#### T3.4 — Selection and failover on members; `pickQwen` goes · `TODO` (HP T3.4, D12)

HP verbatim (the delta table, the new tests, "Tests changed", plants P13, P17, P30, P32, P33). Flake deltas:
- [ ] **Step 2b (Review Focus 2, D12, RED first):** `policy.test.ts` "short custom table: selection over the plan's candidates": settings `{importanceTable: {mine: <write table rows 0..2>}, profiles: {x: {ability: "read", table: "mine"}}}`, spawn kind `x` with `t2` at normal → accepted; the started member ∈ `plan.cands` and equals `plan.cands[0]` (all free). RED until `SpawnPlan.cands` exists (S8).
- [ ] GREEN includes S8 (`SpawnPlan.cands`, the policy's `cands`/`failover` from it).
- [ ] Golden (S2 (c)): the driver calls the new `resolveLeg(d, {name, cands, planned, step: 0, pinned: false, failover: [], entry})` with `cands` from `candidates(s, "write", 0, 0)`; `nb router-golden` FAILS `decisions differ` (expected); `rerecord T3.4` → "Golden movement" T3.4 row exactly; `nb router-golden` green (P2 invariance holds on `empty-slot`).
- [ ] FP12 [ ]; HP plants P13 [ ] P17 [ ] P30 [ ] P32 [ ] P33 [ ].
- [ ] `nb log-contract`; `nb iface-subagents-task-router`; `suite $TR` count recorded (HP's replaced tests listed).
- [ ] Commit (including `golden.txt`, `generate.ts`; `core/chain.ts`, `core/cloud.ts`, `test/chain.test.ts` deleted with `git rm`).

#### T3.5 — Reservation at the pick; ghost sweep · `TODO` (HP T3.5)

HP verbatim; P14 [ ] P15 [ ]. Golden driver passes `name`/`entry` if the signature asks; zero diff. Commit.

#### T3.6 — Explicit model resolution · `TODO` (HP T3.6)

HP verbatim. Step 2b (Review Focus 5): the explicit `llama/qwen3.8` cases run once more with `models: {"qwen-cloud": {model: ""}}` (same results; no cloud probe, no cloud count). Zero golden diff. Commit.

#### T3.7 — Failover reserves before `retune` · `TODO` (HP T3.7)

HP verbatim; P16 [ ]. `nb log-contract` (`shell.ts`). Commit.

#### T3.8 — Group gate · `TODO`

- [ ] `flag; bash $C/gate.sh g3` → `failures: 0`; PL: replay `pass 2 fail 0`, stand-in today 0/0, matrix 0 throws. HP T3.8's exit (selection cases, P-slots/P-cheapest/P-empty/P-ctx, AC3).
- [ ] Record (below): B3, commits, counts, golden movements, plants, deviations.
- [ ] Review card (D18) on `git diff $B3 HEAD -- packages checks modules docs`; fix-forward before G4. Commit the record (`-o docs/plans/2026-10-25-router-g3-g7-plan.md`).

### Group 4 — Logs

HP T4.1–T4.7 verbatim on the mapped paths. Flake deltas:

- **T4.1–T4.3:** `TR/core/{outcome,policy,shell,log,failover}.ts`; `nb log-contract` each (L9). P18 [ ] (T4.2).
- **T4.4:** `TM/core/contract.ts`, `TM/test/contract.test.ts`; per-task gate `suite $TM && nb token-meter && nb typecheck-token-meter`; commit `router(T4.4): token-meter contract for the router's new fields`.
- **T4.5:** `TM/core/levels.ts` (new), `TM/test/levels.test.ts`, `TM/core/analyse.ts:230` `TIER_RANK = { qwen: 0, haiku: 1, T1: 2, T2: 3 }` and its test (`analyse.test.ts`). P20 [ ]. `nb token-meter`, `nb typecheck-token-meter`, `nb iface-experiments-token-meter`.
- **T4.6:** `TM/LOGS.md`. `flag; nb module-eval` (the token-meter case reads `LOGS.md`'s source).
- **T4.7:** `checks/log-contract/contract.ts` (`mainSession`; required events `:120` → `["spawn", "check", "verdict", "reroute", "escalate"]`). RED: the events line first → `log-contract` FAILS `outcomes: no reroute event`. [ ] red seen. P19 [ ].
- **Golden:** zero diff in every G4 task.
- **T4.8:** `bash $C/gate.sh g4` → `failures: 0`; PL as T3.8. Record; review card (D18). Commit the record.

### Group 5 — New defaults (the last commit is R5)

#### T5.1 — Default-delta grid · `TODO` (HP T5.1)

HP verbatim (`test/golden/oracle.ts` wrappers, `golden.test.ts` defaults test with `ACTIVE = ∅` and `COUNTS`, `base: "today"` on the listed tests, `unrouted.test.ts`'s rig). Flake deltas:
- [ ] `test/golden/sut.ts`: `sutRouter(raw: Record<string, unknown> = TODAY_RAW)`; `settingsOf` keyed by `raw` too; the today tests call `sutRouter()` unchanged.
- [ ] Stand-in defaults mode (S6): `touch $C/defaults-mode`; `private.sh` prints `defaults …: plan 146880 cases, 7917 differ; explicit 470016 cases, 9411 differ`. A different count stops the task. FP14 [ ] seen, reverted.
- [ ] Zero golden diff. Commit.

#### F5.1 — Golden fixture `today` · `TODO` (D8)

**Files:** `checks/router-golden/{generate.ts,golden.txt}`.

- [ ] **Step 1 (RED):** S4 in `generate.ts` (`FIXTURES` += `["today", TODAY]`, read from `<dir>/test/fixtures/today-config.json`) → `nb router-golden` FAILS `decisions differ` (the new lines). [ ] red seen
- [ ] **Step 2 (GREEN):** `rerecord F5.1` → only lines added, from `count today …` to the end; evidence (row-id lines included): `g=checks/router-golden/golden.txt; cmp <(awk '/^count /{b=$2} b=="defaults"' $g) <(awk '/^count /{b=$2} b=="today"' $g | sed 's/^\([a-z]*\) today /\1 defaults /')`. Green.
- [ ] **Step 3 (planted):** FP8 → `today` lines differ. [ ] red seen. Revert.
- [ ] Commit.

#### T5.2 — D12 · T5.3 — D1 · `TODO` (HP T5.2, T5.3)

HP verbatim. Each: golden step (`nb router-golden` FAILS → `rerecord T5.n` → movement row → green); stand-in defaults after T5.2 `(6957, 8835)`, after T5.3 `(6912, 8820)`. P21 [ ] P22 [ ]. Commit each.

#### T5.4 — D3: free cloud empty, local first · `TODO` (HP T5.4, D13)

HP verbatim. Flake deltas:
- [ ] **Step 2b (Review Focus 1, RED first):** `policy.test.ts` "a file that sets only the free cloud's model: an ordinary member after local": settings `{models: {"qwen-cloud": {model: FREE}}}` (defaults otherwise): local free → LOCAL xhigh; local busy (`slots: 503`) → CLOUD xhigh at once, no sleep; its turns count in `member-count.json` under `qwen-cloud`. RED: the first assertion fails before GREEN (the default cloud has `order: -1`).
- [ ] `default.nix`: `fixtures="empty-slot defaults"` (S3). FP7 [ ].
- [ ] Golden step: `rerecord T5.4` → movement row T5.4. Stand-in `(6912, 6456)`. Matrix: `0 free-cloud starts`.
- [ ] P12 [ ] (on the selection delta table). Commit.

#### T5.5 — Haiku enabled: D2, D11, D15 · `TODO` (HP T5.5)

HP verbatim; `haiku.model = "anthropic/claude-haiku-5-5"` (ladder `medium, high`, window 1,000,000, cost 1, abilities write 0 / read 1: already the defaults since M1). Golden step `rerecord T5.5`. Stand-in `(0, 0)`. P23 [ ] P24 [ ]. Commit.

#### F5.2 — Models via `programs.piEconomics.taskRouter.settings` · `TODO` (D14; Review Focus 4)

**Files:** `TR/test/fixtures/models-example.json` (new), `TR/test/settings.test.ts`, `checks/module-eval/cases/task-router.nix`, `modules/task-router.nix`.

Characterization of a contract that already holds (free-form settings, the loader's merge); the production change is text only (the option's example and description).

- [ ] **Step 1 (GREEN-first, package):** S9's fixture (`git add`) and the package test "models example: every member as written, 0 problems" → `suite $TR` green. FP10 [ ] seen red, reverted.
- [ ] **Step 2 (GREEN-first, module):** the module-eval case `task-router-models` (S9) → `flag; nb module-eval` green, `N5 + 1`. FP9 [ ] seen red, reverted.
- [ ] **Step 3 (text):** the option `example` and description of S9. `nb module-eval` green (no case reads them).
- [ ] CLEAN: `fmt modules/task-router.nix checks/module-eval/cases/task-router.nix`; `nb leak`. Commit.

#### T5.6 — D6: `contextFit: 1`; replay delta E · `TODO` (HP T5.6, D9)

HP verbatim, except the replay part:
- [ ] RED (private): write `$C/replay/host-replay-defaults.test.ts` = HP T5.6's "defaults" assertion (differing ids `["close-s1e", "records-s2e"]`, each `qwen-draft/haiku/medium/T1/high` against `qwen-draft/qwen/xhigh/T1/high`; SUT reasons of `impl-s1a`, `impl-s1e-b`, `land-sudofix` contain `took the largest window`; the 5 `review` T2/critical and `review2-…`, `review3-…` unchanged), importing `./host-fixtures/…`, `./golden/sut.ts` as R'’s `host-replay.test.ts` does → `private.sh` prints `replay: … fail 1` (`contextFit: 0`: 0 differences). [ ] red seen
- [ ] RED (flake): HP's `policy.test.ts` rows 4, 12–14 (custom `fs`), `FLIPPED` += `contextFit`.
- [ ] GREEN `contextFit: 1` → both green; zero golden diff. P25 [ ] P26 [ ] (replay reds in PL, grid/select reds in `task-router`). Commit (the private file is not committed).

#### T5.7 — D7 · T5.8 — `lookup` and AC5 · T5.9 — Wording · `TODO` (HP)

HP verbatim. Zero golden diff each. T5.8: FP6 [ ] (the scout gate pin) and P27 [ ]. T5.9 also updates any text a module-eval case pins (none at B3). Commit each.

#### T5.10 — Module text, check fixture, descriptions · `TODO` (HP T5.10, mapped)

**Files:** `modules/task-router.nix`, `TR/package.json`, `checks/module-eval/cases/task-router.nix`.

- [ ] **Step 1 (RED):** case `task-router-description` (S10): the registry entry's `description` equals HP T5.10's text → `flag; nb module-eval` FAILS (FP11). [ ] red seen
- [ ] **Step 2 (GREEN):** the registry `description` (HP's string verbatim); `TR/package.json` description (same first clause); the `settings` description (HP: `models` and `importanceTable` merge over the defaults, a member is removed by blanking its model, the rollback is `packages/task-router/test/fixtures/today-config.json`). Tests changed: `task-router-settings`' `s = {cloudDailyCap = 500;}` → `{queueMaxSec = 60;}` (reason: legacy key after M1, HS §5.5). Green.
- [ ] CLEAN: `fmt` on the two `.nix` files; `nb home-files`. Commit.

#### T5.11 — Docs · `TODO` (HP T5.11, mapped)

`docs/pi-token-economics.md` (HP's list: component row, members, tables, `readOnlyReview`, `contextFit`, `queueMaxSec`, the rollback fixture, legacy keys; known limits); `docs/pi-economics.md` § `taskRouter` (no "Qwen chain"; selection; the golden's three fixtures; the free-cloud slot empty by default; models via `settings.models`, the example). `nb leak`. Commit.

#### T5.12 — Group gate; R5 · `TODO`

- [ ] `flag; bash $C/gate.sh g5` → `failures: 0`; PL: replay `pass 3 fail 0` (today + defaults E), stand-in today `(0, 0)` and defaults `(0, 0)`, matrix 0 throws, 0 free-cloud starts.
- [ ] Record R5, every golden movement, every ticked plant; review card (D18). Commit the record.
- [ ] Hand-over to main (D17): R5 is ready for a host lock move (host step: Layer B, the W4.2 settings `K` per Q4, activation H6.0).

### Group 6 — Scout gate (after the host runs R5; spends quota)

The gate for changing scout defaults (D16). Steps HP H6.0–H6.4 with these flake facts:

- **H6.0** needs the host lock move to R5 (D17) and the owner's activation; then HP H6.0 (one spawn per HS §4.10 row, checked in the outcome log; a deliberate settings error shows one `ui.notify`; the owner updates `~/.pi/agent/AGENTS.md`).
- **H6.1** `<bench.dataDir>/arms.json` (default `~/.pi/agent/bench/arms.json`) gains `haiku` (`anthropic/claude-haiku-5-5`, `medium`, print driver, extensions `infinite-context`, `claude-auth`); no code change. The bench is the flake's (`packages/bench`, wired by W1).
- **H6.2** `pi-bench sched qwenl 1 X1 X2 X3 X4 X5 X6` (earth up; one job), `pi-bench sched haiku 2 X1 … X6`, `pi-bench sched sonnet 2 X1 … X6`.
- **H6.3** `pi-bench judge --all --judges opus,gpt`, with the arms named explicitly while Q has not landed (the judge's default first arm is still the retired `qwen`); `bench-report --factors arm`.
- **H6.4** HP's rule verbatim (OD14, OD20): `S(arm) ≥ 0.9 × S(sonnet)`, no task 0; `S(sonnet) < 0.6` inconclusive; borderline ±0.05 → re-run arm and `sonnet`. Outcome → `lookup`: Haiku and Qwen pass → read 0; only Haiku → read 1; Haiku fails → read 2. `scout` and `review` stay read 2 (OD15). Record scores per task, per judge.

#### T6.1 — `lookup`'s floor · `TODO` (HP T6.1)

HP verbatim on `TR` (RED: the AC5 `lookup` case at the new default first; the old expectation stays as the `minLevel: 2` override case). Zero golden diff. `inner`; `bash $C/gate.sh g6`. Commit; R6 → main for the next host lock move.

### Group 7 — Close-out

#### T7.1 — Records · `TODO` (HP T7.1, mapped)

- [ ] This plan's Execution Record: per group B, gate results, test counts, golden movements, PL results, plants, deviations; the supersession note (HS's list); HS §6.6 hand-over items checked; HP's "Deviations decided in the plan" confirmed or corrected against what landed here.
- [ ] `docs/pi-economics.md` § `taskRouter` final (redesign landed at R5/R6).
- [ ] To main (host edits, not this agent's): one line in HP's Execution Record and the host `docs/README.md` row pointing here; spec §6.1's amendment gains "Groups 3–7 landed at R5/R6" if main wants it in the spec.
- [ ] Commit.

---

## Snippets

### S2 — `generate.ts`: the selection section

(a) F3.1, old `resolveLeg` (format only):

```ts
// The selection: 4 local × 4 cloud running × 3 cloud states × {before, after the queue deadline}. Picks name the member.
const memberOf = (s: any, model: string): string =>
  Object.entries(s.models).find(([, m]: [string, any]) => m.model === model)?.[0] ?? `?${model}`;
// … unchanged driver …
try { const r = await resolveLeg(d, { tier: "qwen", effort: "xhigh" }); picks.push(`${memberOf(s, r.model)}:${r.model}:${r.effort}`); }
catch (e) { if (e instanceof Wait) picks.push("wait"); else throw e; }
// …
out.push(`select ${fx} local=${local} cloudRunning=${cr} cloud=${cloud} ${picks.join(" ")}`);
```

(b) T3.3: `d` as in T3.3's bullet; children `{ member, route, at: NOW, reservedUntil: 0 }`.

(c) T3.4: the new call; `none` prints `none`:

```ts
const { candidates } = await import(join(dir, "core/select.ts"));
const cands = candidates(s, "write", 0, 0).cands;
const r = await resolveLeg(d, { name: "x", cands, planned: cands[0], step: 0, pinned: false, failover: [], entry: { parent: "p", parentSession: "s" } as any });
picks.push(r.ok ? `${r.value.member.name}:${r.value.member.model}:${r.value.effort}` : "none");
```

`d` gains `attempts: new Map()`, `children` entries get `member`, `reservedUntil: NOW + 60_000` for `own` and running cloud children (listed `running` by `api.list`). The `expired` driver stays: `sleep` throws `Wait` before the deadline, else advances `now` past it.

### S3 — `router-golden/default.nix`: P2 invariance (replaces the `chain empty-slot` grep)

```sh
  # P2 (spec §6.1) / MP2: with the free-cloud slot empty, no selection picks it and the
  # cloud's state changes no decision (a wait for the local slot is allowed, HS D5).
  for fx in ${fixtures}; do
    grep "^select $fx " want.txt > sel.txt || true
    n=$(wc -l < sel.txt)
    [ "$n" -eq 48 ] || { echo "router-golden: select $fx: expected 48 lines, got $n" >&2; exit 1; }
    if grep ' qwen-cloud:' sel.txt >&2; then echo "router-golden: an empty free-cloud slot is picked ($fx)" >&2; exit 1; fi
    if ! awk '{ v = $6 " " $7; if (($3 in seen) && seen[$3] != v) bad = 1; seen[$3] = v } END { exit bad }' sel.txt; then
      echo "router-golden: with the free-cloud slot empty, the cloud's state changes a decision ($fx)" >&2; exit 1
    fi
  done
```

`fixtures` is a `let` binding: `"empty-slot"` (F3.1), `"empty-slot defaults"` (T5.4). Fields: `$3` = `local=…`, `$6`/`$7` = the two picks.

### S4 — F5.1: the `today` fixture

```ts
import { readFileSync } from "node:fs";
const TODAY = JSON.parse(readFileSync(join(dir, "test/fixtures/today-config.json"), "utf8"));
const FIXTURES: [string, Record<string, unknown>][] = [["defaults", {}], ["empty-slot", EMPTY_SLOT], ["today", TODAY]];
```

`model(m)` maps grid models only for `empty-slot` (`fx === "empty-slot"`), so `today` keeps the real names.

### S5 — F3.0 `test/edge-matrix.test.ts`

```ts
// Review G2 (M1, M2 (b)): every config the loader accepts routes or rejects cleanly; the guards and capToTable stay in front
// of the selection. CONFIGS = ~/.cache/pi/fix-r-g2/matrix.mts's six; 186 cells.
import { test } from "node:test";
import assert from "node:assert/strict";
import { card, harness, provideSkills } from "./harness.ts";
import { defaults } from "../core/settings.ts";
const mine = structuredClone(defaults().importanceTable.write);
const CONFIGS: Record<string, Record<string, unknown>> = { /* matrix.mts's opus, sonnet, both, cap381, revWrite, opusToday */ };
const SK = ["systematic-debugging", "code-reviewer", "tdd-implementation-planner"];
for (const [cn, raw] of Object.entries(CONFIGS))
  test(`edge matrix ${cn}: no spawn throws; an accepted spawn names an enabled member`, async () => {
    for (const kind of ["implement", "debug-design", "scout", "review", "plan", ...((raw as any).profiles?.x ? ["x"] : [])])
      for (const imp of [undefined, "high", "critical"] as const) for (const t2 of [[], ["security"]]) {
        const h = harness({ settings: raw as never }); provideSkills(h, SK);
        const r: any = await h.a.spawn({ name: "a", task: card({ kind, ...(imp ? { importance: imp } : {}), t2 }) });
        const models = Object.values(parseSettings(raw).settings.models).map((m) => m.model).filter((m) => m !== "");
        if (!("reject" in r)) assert.ok(models.includes(r.model), `${cn} ${kind} ${imp} t2=${t2.length}: ${r.model}`);
      }
  });
// The per-table cap (review G2 M2 (b)): profile x on the short table `mine` with t2 stays on Sonnet (~/.cache/pi/fix-r-g2/m.head1).
test("edge matrix cap381: x with t2 → Sonnet (high; xhigh at critical)", async () => { /* two spawns, assert.equal model and thinkingLevel */ });
```

A throw fails the test by itself (`parseSettings` from `../core/settings.ts`). The two pinned cells are `m.head1`'s `cap381 x undefined t2=1` and `cap381 x critical t2=1`; a later planned delta that moves one updates it in that task, with its reason.

### S6 — the stand-in, parametrized (`$C/grid-sut.mts`, from `router-r2/r4new/grid-sut.mts`)

```diff
-const TRT = "/home/pallon/projects/nixos/new/modules/home-manager/features/ai/extensions/task-router/test";
-const { sutRouter } = await import(`${TRT}/golden/sut.ts`);
+const TRT = `${process.env.TR ?? "packages/task-router"}/test`;
+const MODE = (process.argv[2] ?? "today") as "today" | "defaults";
+const { sutRouter } = await import(`${TRT}/golden/sut.ts`);
@@
-const c = config("today");
-const sut = sutRouter();
+const c = config(MODE);
+const sut = MODE === "today" ? sutRouter() : sutRouter({});
@@
-console.log(`today (model vs new pipeline): …`);
+console.log(`${MODE} (r4 model vs ${process.env.TR}): plan ${n} cases, ${diff} differ; explicit ${xn} cases, ${xdiff} differ`);
```

The import of `review-router/r4/model.mts` stays absolute (outside both repositories).

### S7 — F3.2 (`modules/bench.nix`, `cases/bench.nix`)

```diff
-  routerModelKeys = ["models" "queueMaxSec" "localHealthUrl" "cloudDailyCap" "contextWindow"];
+  routerModelKeys = ["models" "queueMaxSec" "contextFit" "localHealthUrl" "cloudDailyCap" "contextWindow"];
```

In `bench-router-default`: `s` and `want` gain `contextFit = 1;` (the module's description and `docs/pi-economics.md` list it).

### S8 — `SpawnPlan.cands` (T3.4, D12)

```ts
// core/pipeline.ts
export type SpawnPlan = { plan: Plan; start: Accepted; esc?: Escalation; cands: string[] }; // worker leg candidates, capped settings
// in planSpawn, after the final worker leg W:
const cands = candidates(s, a, worker.level, need).cands.map((m) => m.name);
// core/policy.ts (HS S9's policy part, with D12):
const M = named(s.models, start.member)!;
const leg = sp.value.cands.map((n) => named(s.models, n)!);
const cands = start.pinned ? [M] : leg;
const failover = (start.pinned ? leg.filter((m) => lvl(m, a) >= lvl(M, a)) : leg).map((m) => m.name);
```

`lvl` here reads `capToTable(s, prof.value)` (the plan's settings), not `s`.

### S9 — F5.2: models fixture and case

`TR/test/fixtures/models-example.json`:

```json
{ "models": {
    "qwen-local": { "model": "local/qwen", "health": "http://local.invalid:11545" },
    "qwen-cloud": { "model": "" },
    "haiku": { "model": "anthropic/claude-haiku-5-5" },
    "sonnet": { "model": "anthropic/claude-sonnet-5-5" },
    "opus": { "model": "anthropic/claude-opus-5-5" } },
  "queueMaxSec": 60 }
```

Package test (`settings.test.ts`): `loadSettingsReport(<fixture path>)` → `problems` `[]`; for each key `m`, `settings.models[m].model` = the fixture's; `enabled(settings.models)` has no `qwen-cloud`.

Module-eval case (`cases/task-router.nix`):

```nix
  # (F5.2) Models are configured through taskRouter.settings (spec §6.2): the
  # file holds them as written; the package's settings test reads the same fixture.
  task-router-models = let
    x = lib.importJSON ../../../packages/task-router/test/fixtures/models-example.json;
    f = fileAt ".pi/agent/task-router/settings.json" (eval ".pi/agent" {settings = x;} withActor);
  in
    eq "settings file" (builtins.fromJSON f.text) x;
```

Option `example`: `{ models = { qwen-local.health = "http://localhost:11545"; haiku.model = ""; }; queueMaxSec = 60; }`, description: "`models.<member>` merges field by field over the default member; `model = \"\"` removes it."

### S10 — T5.10 case

```nix
  # (T5.10) The registry text agents read (HS §5.5, mi13).
  task-router-description = let
    c = eval ".pi/agent" {} withActor;
  in
    eq "registry description" (pe c).extensions.task-router.description
    "Routes subagent spawns by task card: abilities and levels per model, cheapest-fit selection with a queue wait, attempts and an outcome log (<agentDir>/task-router/outcomes/YYYY-MM.jsonl); registers the task_verdict tool.";
```

## Open questions (each with a recommended answer)

- **Q1 (D1) Start:** after W closes, on `main`? *Recommended:* yes. If the owner wants G3 before W5–W7/WD: a branch `router-g3` here, merged after W's last lock move.
- **Q2 (D9) Replay:** private scratch from R' with the "defaults E" file under `~/.cache/pi/router-g37/replay/`? *Recommended:* yes (spec §6.3). Alternative: an anonymized fixture in the flake (needs a spec amendment).
- **Q3 (D10) r4 stand-in:** scratch, run by the gate? *Recommended:* yes; the edge matrix moves into the package instead (F3.0, neutral data).
- **Q4 (D17) Host settings at the lock move:** W4.2 sets `K` (the router's host-fact defaults) explicitly in `homes/pallon`. If `K` pins `models.qwen-cloud.model` (the free model) or `models.haiku.model = ""`, D2/D3/D11/D15 never reach the host. *Recommended:* the host step that moves the lock to R5 keeps in `K` only `models.qwen-local.{model,health}` and drops any `qwen-cloud`/`haiku` pin (the owner retired the free Qwen).
- **Q5 (D16) Scout gate scope:** the gate decides `lookup` only (OD15), `scout` stays read 2? *Recommended:* yes; lowering `scout` needs its own owner decision after H6.4.
- **Q6 (D14) Models option:** free-form `settings.models` with a tested example, no typed options? *Recommended:* yes (§6.2).
- **Q7 (D8) Third golden fixture `today`:** +~375 lines (~50 KB)? *Recommended:* yes; after T5.4 it is the only recorded witness of the configured free-cloud code.
- **Q8 (D12) `SpawnPlan.cands`** instead of HS S9's recomputation? *Recommended:* yes (capToTable clamps per plan).
- **Q9 (D18) Reviews:** one Opus review per group (G3, G4, G5) before the next? *Recommended:* yes.

---

# Execution Record

