# Q — retire the bench's `qwen` arm: TDD plan

Date: 2026-10-25 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 with the 2026-10-25 amendments · Milestone: Q (§9) · Base: this repository at `5eff6ff` (M5 done; router G3 running on `main`)

> **For agentic workers:** use executing-plans (native) or subagent-driven-development. Steps use `- [ ]`; tick a "red seen" box only after the red was actually on screen.

**Goal:** the bench no longer defines the `qwen` arm (the free OpenRouter Qwen, gone), and `judge`/`judge-all` default to `qwenl` against `sonnet`; old `qwen` runs stay reportable and judgeable with explicit arms.

**Architecture:** one line leaves `defaultArms()` (`src/config.ts`); a constant `DEFAULT_PAIR` replaces the judge's literal defaults in `src/cli.ts`. Old-run behaviour is pinned first by characterization tests (green before and after); the new defaults and the retirement each come with a red test. No `.nix` file, option or module-eval case changes.

**Tech stack:** Node 24 `node:test` (`--experimental-strip-types`), `tsc --strict` (`typecheck-bench`), the flake's `bench` check.

**Spec:** §7 "Arms" (Step Q), §1 SC5 and Non-goals, §9 row Q and "Q comes after W … before P, so that nothing published names the dead free model", §10.1 (one paid OpenRouter judge), §8.3.

Terms: **F** = the dead free model id `openrouter/qwen/qwen3.8-27b:free`. **`qwen`** = the retired arm (model F). **`qwenl`** = the local Qwen arm (`llama/qwen3.8`; the provider `llama` and its URL, `http://earth:11545` on the owner's machines, are host data, not bench code).

## Global constraints

- The arm goes; the judge defaults move to `qwenl` (§7). The paid OpenRouter judge `gpt` stays (§7, §10.1).
- After Q the bench reaches OpenRouter only through the judge `gpt` (§1 SC5).
- Existing `qwen` runs stay judgeable with explicit arguments; old reports are unchanged (§7).
- Extra arms are data: `<dataDir>/arms.json` overlays the defaults (§7) — unchanged.
- No router change: the free-cloud slot's code stays, its default is emptied by the router plan's T5.4 (`docs/plans/2026-10-25-router-g3-g7-plan.md`). Q only lists what remains for P.
- Nothing Q adds names F (fixtures use `old/qwen`).
- Commits unsigned, path-limited: `git -c commit.gpgsign=false commit -o <paths> -m …`; never stage another agent's file.

## Review Focus

1. **`judge-all` without X on a data dir whose pending pairs are old `qwen` pairs:** after Q it judges nothing for them (`--once`) or waits every 60 s (without `--once`), as it always did for a missing run. Expected: the user passes `qwen`. Pinned in Q.3 (left alone) and Q.2 (explicit `qwen` judges); README says so (Q.5).
2. **A task whose `map.json` was drawn for `qwen`/`sonnet`, judged later with the new default:** the recorded map wins, so both judges see the same two runs (κ needs that). Pinned in Q.2.
3. **An owner's `arms.json` that defines `qwen` again:** it stays runnable (overlay wins). The Q.1/Q.2 fixtures create old runs exactly that way.
4. **`run`/`sched` with `qwen`:** `unknown arm: qwen` before anything is created (`sched` logs `error <id>: unknown arm: qwen`). Pinned in Q.4.
5. **`bench-report` over old `qwen` rows:** identical rows, so identical tables, `--factors arm` and `--factors routing` alike. Pinned in Q.1.

## Motivation

Spec §7, Step Q: the bench's `qwen` arm names the retired free OpenRouter Qwen, and `judge` and `judge-all` take it as their default first arm (`cli.ts:99,105`). Q retires the arm and moves the judge defaults to `qwenl`, after W and before P, so that no published default names a dead free model. Old `qwen` runs keep working with explicit arguments, and old reports stay unchanged.

## Approach

- **Characterization first (Q.1, Q.2):** two new test files pin what must survive — report rows of old `qwen` runs, explicit pairwise judging of old runs, and the recorded blind map winning. Green at the base; each gets a planted red.
- **Defaults (Q.3):** `export const DEFAULT_PAIR = { x: "qwenl", y: "sonnet" } as const` in `src/config.ts`; `cli.ts` uses it in `judge`, `judge-all` and the usage text.
- **Retirement (Q.4):** delete `qwen: printArm(F, "xhigh")` from `defaultArms()`; drop `qwen` from the usage's ARM list. Properties: no default arm is on OpenRouter; the only OpenRouter judge is `gpt`; `DEFAULT_PAIR ⊆ defaultArms()`.
- **No stub (D1):** `qwen` never had factors, so `report.ts:66` (`arms[r.arm]?.factors ?? {}`) yields `{}` with or without the arm. Q.1 proves "old reports unchanged" without the spec's factors-only stub.
- **Docs (Q.5):** `packages/bench/README.md`; the spec's §7 amendment if OQ1 says so.

## Decisions

| # | Decision | Rationale | Rejected alternative, and why |
|---|---|---|---|
| D1 | No factors-only stub for `qwen` | `printArm` sets no `factors` (`config.ts:8-13,17`), so the report's factors for `qwen` rows are `{}` before and after; a stub `{factors: {}}` in `defaultArms()` is not an `Arm` (tsc: missing `model`, `thinking`, `driver`, `extensions`), and, typed loosely, makes `runOne("qwen")` take the factor-arm branch (`run.ts`, `if (arm.factors)`: `{}` is truthy) with no model | The stub (spec §7): no observable effect except the hazard; a `RETIRED` table in `report.ts`: code for no difference. Spec deviation → OQ1 |
| D2 | `DEFAULT_PAIR` in `config.ts`, used at every site in `cli.ts` (usage `:17`, `judge` `:99`, `judge-all` `:105,112,114`) | one source for the pair; the usage text cannot drift from the code | replacing only the two `"qwen"` literals: leaves the usage and `judge-all`'s `"sonnet"` as separate literals |
| D3 | Old-run tests are characterization, in their own file, before any production change | they must be green on both sides of Q; a separate file keeps Q.3's red from masking them | appending to `report.test.ts`/`judge.test.ts`: mixes old and new behaviour |
| D4 | Existing tests unchanged; the `qwen` labels in `judge.test.ts` (`:15-20,65-69,87,190`) and `report.test.ts` (`:54-152`) stay | they are arm names in old data and blind-map labels, not the arm definition; they pass after Q and are the evidence that old runs still report | renaming them to `qwenl`: removes that evidence |
| D5 | `qwen` becomes an ordinary unknown arm (`unknown arm: qwen`) | spec: "the arm goes"; no code keeps naming it | a special "retired, use qwenl" message: code naming the dead arm forever (OQ4) |
| D6 | Test fixtures re-create old runs through `<data>/arms.json` with model `old/qwen` | uses the public overlay (§7); names no dead model (§9) | fixtures carrying F: P would scrub them again |
| D7 | Q changes no `.nix` file, option or module-eval case | the bench module never names an arm or a judge | — |
| D8 | Docs: `packages/bench/README.md` only (plus the record and OQ1's amendment) | `docs/pi-token-economics.md` names no default (`:166`) and the router's T5.11 rewrites it; `docs/pi-economics.md` § `bench` names no arm | editing them: a merge with router T5.11/F3.2 for no content |
| D9 | `judge-all`'s loop unchanged (no skip, no warning for old `qwen` pairs) | Q is a defaults change; the loop's waiting is old behaviour | a warning: new behaviour beyond §7 |
| D10 | One red check at a time: only `bench` reds; `typecheck-bench` stays green (Q.3's test imports nothing new; Q.4's imports exist by then) | AGENTS.md | importing `DEFAULT_PAIR` in Q.3's red: a load error instead of a behavioural red, and two red checks |

## The gate

No principles document; the gate is AGENTS.md, spec §4/§8 rules and the earlier plans' lessons.

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: Q.3, Q.4 natural reds (seen in the planner's dry run); Q.1, Q.2 characterization with planted reds |
| A new check is seen red once | N/A for Nix checks (none added); every new test is seen red (natural or planted) |
| No `builtins.match` on generated text | N/A: no Nix check changes |
| Assertions `pi-economics:` with a negative case | N/A: none added |
| No import-from-derivation | N/A |
| Leak patterns (§8.3) | PASS: fixtures `old/qwen`, `/ext`; F is removed, not added; `nb leak` in Q.6 |
| `legacy.nix` untouched; patched upstreams | N/A |
| Interface comparisons | N/A: the probe is untouched; `iface-subagents-bench-probe` rebuilds (its `src` is the package) and stays green (Q.6) |
| `flake.lock` unchanged | PASS |
| Alejandra | N/A: no `.nix` file |
| Markdown under `docs/` (+ `README.md`) | PASS |
| Existing tests preserved | PASS: D4; 76 tests unchanged |
| Spec §7 text | DEVIATION D1 (no stub), needs main's OQ1; the need ("old reports unchanged") is met by Q.1's property |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION.

## Files to read first

Listed, not quoted.

- Spec: §1 (SC5, Non-goals), §7 "Arms", §8.3, §9 (row Q, the order bullets, amendment), §10.1.
- `docs/plans/2026-10-17-m1-bench-plan.md`: D10, the scenario row "§7 arms … `qwen` kept", Execution Record (`bench` 76 tests).
- `docs/plans/2026-10-25-router-g3-g7-plan.md`: "Global constraints" (free-cloud slot), "Path map" row `pkgs/pi-bench`, F3.2, H6.1–H6.3, "File structure" (what Q must not touch).
- Implementation: `packages/bench/src/config.ts` (whole), `src/cli.ts` (`USAGE`, `judge`, `judge-all`), `src/run.ts:26-29`, `src/report.ts:36-75`, `src/judge.ts:8-22` (`JUDGES`, `loadOrCreateMap`) and `:186-245` (`buildPacket`, `runJudge`), `test/helpers.ts`, `test/cli.test.ts` (the `run` helper), `packages/bench/README.md:15-31`.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| `tsc --strict` (`typecheck-bench`) | every task's GREEN and Q.6 | a `DEFAULT_PAIR` misuse, a non-`Arm` stub (D1), the fixtures' types |
| shellcheck (package wrappers) | `bench` build | unchanged |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package tests (`bench`) | 76 copied/M1 tests unchanged + 3 (`old-qwen-runs.test.ts`) + 4 (`defaults.test.ts`) = 83 | node, git, a fake `pi` (`helpers.ts`); ~12 s |
| Type check (`typecheck-bench`) | the new test files and `DEFAULT_PAIR` | shared lock |
| Leak (`leak`) | the changed package | — |
| Module eval | N/A: no option changes; `bench-today` compares the module's package with `packages.bench` (both move together), run in Q.6 | — |
| Router checks | N/A: untouched; run in Q.6's full listing | — |
| Layer B (host) | N/A: Q changes no host file; the host receives Q at its next `pi-economics` lock move (§7: W8) | — |
| Real pi on `qwenl` | coverage gap | earth up |

## Scenario coverage

| Spec scenario | Check · test (task) |
|---|---|
| §7 old reports unchanged (the stub's purpose) | `bench` · "report: an arm without factors adds nothing to a row …" (Q.1) |
| §7 existing `qwen` runs judgeable with explicit arguments | `bench` · "judge TASK JUDGE qwen sonnet and judge-all qwen: …" (Q.2) |
| Review Focus 2 (recorded map wins) | `bench` · "judge: a task's recorded blind map wins …" (Q.2) |
| §7 judge defaults move to `qwenl` | `bench` · "judge TASK JUDGE without arms …", "judge-all --once without X …" (Q.3) |
| §7 the arm goes | `bench` · "run TASK qwen: the retired arm is unknown …" (Q.4) |
| §1 SC5, §10.1: only OpenRouter use is the judge `gpt` | `bench` · "the bench's only OpenRouter use is the paid judge gpt …" (Q.4) |
| §9 nothing published names F (bench part) | Q.5 Step 3 (`git grep` empty); the rest → "Inventory for P" |
| §7 arms are data (`arms.json`) | the Q.1/Q.2 fixtures run `qwen` through `arms.json` |
| §7 the host receives Q with W8 | N/A here (coverage gap) |

## Properties

- **P-arms** `{n ∈ dom defaultArms() | model(n) starts "openrouter/"} = ∅`.
- **P-judge** `{j ∈ dom JUDGES | model(j) starts "openrouter/"} = {gpt}`.
- **P-pair** `DEFAULT_PAIR = {x: "qwenl", y: "sonnet"}` (the literal is the spec's criterion) ∧ `{x, y} ⊆ dom defaultArms()`.
- **P-report** for a data dir D with runs of `qwen`: `loadRows(D) = loadRows(D ⊕ arms.json{qwen ↦ OLD_QWEN})`, and `factorNames ∩ keys(row_qwen) = ∅`, `factorNames` derived from the first arm of `defaultArms()` that has `factors`.
- **P-explicit** `judge T J qwen sonnet` ⇒ `keys(arms(judge/T/J.json)) = {qwen, sonnet}`; `judge-all --once qwen` ⇒ the same for the pending judge.
- **P-map** `map.json` present ⇒ the judged pair is the map's, whatever X Y.
- **P-unknown** `runOne(arm = "qwen")` rejects `/unknown arm: qwen/` ∧ `¬exists runs/U.qwen.1`.
- **P-usage** the usage shows `(default qwenl sonnet)` and `(ARM: qwenl | sonnet | orch | orch-<signs> | arms.json)` (user-read text: literal).

## Planted violations

| Check · test | Plant | Must fail with | Task | Seen |
|---|---|---|---|---|
| `bench` · report | in the test, `arms.json` = `{ qwen: { ...OLD_QWEN, factors: { routing: "off" } } }` | `✖ report: an arm without factors adds nothing to a row, …` | Q.1 | [ ] |
| `bench` · explicit judge | `cli.ts` `judge`: `x: a[2] ?? …` → `x: a[3] ?? …` | `✖ judge TASK JUDGE qwen sonnet and judge-all qwen: …` (and `✖ judge: a task's recorded blind map wins …`) | Q.2 | [ ] |
| `bench` · explicit judge-all | `cli.ts` `judge-all`: `const x = "qwenl";` | `✖ judge TASK JUDGE qwen sonnet and judge-all qwen: …` | Q.2 | [ ] |
| `bench` · map wins | `judge.ts` `loadOrCreateMap`: `if (false && existsSync(file))` | `✖ judge: a task's recorded blind map wins …` (the copied "blind map follows the rng …" fails too) | Q.2 | [ ] |
| `bench` · defaults | natural | `ENOENT: … runs/T.qwen.1/result.json`; `[ null, null ]` vs `[ ['qwenl','sonnet'], … ]` | Q.3 | [ ] |
| `bench` · retirement | natural | `actual: [ 'qwen' ]`; `Missing expected rejection.` | Q.4 | [ ] |
| `bench` · P-arms | add `free: printArm("openrouter/x/y:free", "xhigh"),` to `defaultArms()` | `actual: [ 'free' ]` | Q.4 | [ ] |

Planner's dry run (2026-10-25, a scratch copy of `packages/bench` under `$TMPDIR`, final snippets): base 76 tests; Q.1/Q.2 green at the base and every plant above red with the stated test; Q.3 and Q.4 natural reds as stated; final state `ℹ tests 83`, `ℹ pass 83`; `pi-economics-tsc` on the final tree rc 0; `grep -F` for F in `packages/bench` empty. Not run: the Nix checks.

## Coverage gap

- **A real `qwenl` run.** Fake `pi` only; the owner's next bench run (earth up) covers it.
- **The host.** It gets Q only when its `pi-economics` lock moves (W8, or a router lock move after Q lands); that step's Layer B home-file diff shows only the bench package path.
- **`judge-all` without `--once`.** The 60 s wait loop is not run by a test (as before Q).
- **Owner data.** An `arms.json` under the owner's data dir may define `qwen`; Q neither reads nor changes it.

## Environment (every step)

```sh
source ~/.cache/pi/m0env.sh   # XDG dirs, cd, F (git+file), o, cap, nb, ne, nbl
flag() { while [ -e ~/.cache/pi/pluto-exec/owner-deploy.flag ]; do sleep 60; done; }
B=packages/bench
suite() { (cd $B && node --test --experimental-strip-types test/*.test.ts 2>&1 | grep -E '^(ℹ (tests|pass|fail)|✖ [a-z])' | sort -u); }
```

- `suite` is the quick loop; `nb bench` is the evidence. `git+file:` sees only indexed files: `git add` a new file before `nb`.
- **Shared work tree (OQ2).** Another agent works on `main` in this tree. `git+file:` builds see its uncommitted edits, and the index is shared. Either run Q in a clone (`git clone -q ~/projects/nix/pi-economics $TMPDIR/q && cd $TMPDIR/q`, `F=git+file://$TMPDIR/q`, push each commit to branch `q-retire-qwen` of the main repo) or run it while the router agent is idle. In the shared tree, commit with `git -c commit.gpgsign=false commit -o <paths> -m …` only.
- TypeScript keeps the files' tab indentation.

## File structure

| File | Responsibility | Task | Also touched by router G3–G7? |
|---|---|---|---|
| `packages/bench/test/q-fixtures.ts` (new) | `cliRun`, `OLD_QWEN`, `cand`, `judgeBench` | Q.1 | no |
| `packages/bench/test/old-qwen-runs.test.ts` (new) | P-report, P-explicit, P-map | Q.1, Q.2 | no |
| `packages/bench/test/defaults.test.ts` (new) | P-pair, P-usage, P-arms, P-judge, P-unknown | Q.3, Q.4 | no |
| `packages/bench/src/config.ts` | `DEFAULT_PAIR`; the arm line goes | Q.3, Q.4 | no (G6 adds arms as data outside the repo) |
| `packages/bench/src/cli.ts` | defaults from `DEFAULT_PAIR`; usage | Q.3, Q.4 | no |
| `packages/bench/README.md` | arms, judge defaults, old runs | Q.5 | no |
| `docs/specs/2026-10-12-pi-economics-design.md` | §7 amendment (only if OQ1 = yes) | Q.5 | T7.1 may amend §6.1 (another section) |
| this plan | Execution Record | Q.6 | no |
| `modules/bench.nix`, `checks/module-eval/**` | **not touched by Q** | — | yes: F3.2 (`contextFit`), F5.2, T5.10 |

No Q task touches `modules/bench.nix` or `checks/module-eval`; Q can land before, between or after the router groups. Its only coupling is the shared tree (OQ2).

---

## Tasks

| Task | Delivers | Commit |
|---|---|---|
| Q.0 | read; preconditions; baseline | — |
| Q.1 | old `qwen` rows unchanged without the arm | `q(bench): old qwen runs report the same without the arm` |
| Q.2 | old `qwen` runs judgeable with explicit arms; the map wins | `q(bench): old qwen runs stay judgeable with explicit arms` |
| Q.3 | judge defaults `qwenl` vs `sonnet` | `q(bench): judge defaults to qwenl against sonnet` |
| Q.4 | the `qwen` arm retired | `q(bench): retire the qwen arm` |
| Q.5 | docs | `q: docs for the retired qwen arm` |
| Q.6 | gate, Execution Record | `q: execution record` |

Every task starts at `[ ]`. Order as numbered.

### Task Q.0 — Read, preconditions, baseline

- [ ] **Step 1:** read "Files to read first".
- [ ] **Step 2 (preconditions):** OQ2 decided (clone or idle window). `git status --short -- packages/bench` empty (no one else edits the bench); `git log --oneline -1 -- packages/bench` noted. `grep -n 'qwen' $B/src/config.ts $B/src/cli.ts` shows exactly `config.ts:17-18` and `cli.ts:15,17,99,105`; otherwise stop and report (drift).
- [ ] **Step 3 (baseline):** `flag; nbl bench` → `ℹ tests 76`, `ℹ fail 0` (another count: record it as N0 and use N0 + 3, N0 + 7 below); `nb typecheck-bench`, `nb leak` green.

### Task Q.1 — Old `qwen` rows unchanged without the arm (characterization)

**Files:** create `$B/test/q-fixtures.ts` (S1), `$B/test/old-qwen-runs.test.ts` (S2, the first test only).
**Interfaces — produces:** `cliRun(env: Record<string,string>, ...args: string[]): string`; `OLD_QWEN: Arm`; `cand(verdict: string)`; `judgeBench(arms: string[]): { data: string; env: Record<string,string>; judged(judge: string): string[] | null }` (sorted arm keys of `judge/T/<judge>.json`, `null` when absent).

- [ ] **Step 1:** write both files; `git add` them.
- [ ] **Step 2 (green at base):** `suite` → N0 + 1 pass; `nb bench` green; `nb typecheck-bench` green.
- [ ] **Step 3 (planted):** the factors plant (table) → `nb bench` fails with `✖ report: an arm without factors adds nothing to a row, …`. Revert. [ ] red seen
- [ ] **Step 4:** commit (`git -c commit.gpgsign=false commit -o $B/test/q-fixtures.ts $B/test/old-qwen-runs.test.ts -m …`).

### Task Q.2 — Old `qwen` runs judgeable with explicit arms; the map wins (characterization)

**Files:** `$B/test/old-qwen-runs.test.ts` (S2, the other two tests).
**Interfaces — consumes:** Q.1's fixtures.

- [ ] **Step 1:** append the two tests.
- [ ] **Step 2 (green at base):** `suite` → N0 + 3 pass; `nb bench` green.
- [ ] **Step 3 (planted, one at a time, each reverted):** `a[3]`, `const x = "qwenl"`, `if (false && …)` (table). [ ] red seen ×3
- [ ] **Step 4:** commit.

### Task Q.3 — Judge defaults: `qwenl` against `sonnet`

**Files:** create `$B/test/defaults.test.ts` (S3 part 1); modify `$B/src/config.ts`, `$B/src/cli.ts` (S4 Q.3).
**Interfaces — produces:** `export const DEFAULT_PAIR: { readonly x: "qwenl"; readonly y: "sonnet" }` in `src/config.ts`.

- [ ] **Step 1 (RED):** write S3 part 1; `git add`; `nb bench` fails: `✖ judge TASK JUDGE without arms judges qwenl against sonnet` (`ENOENT: … runs/T.qwen.1/result.json`) and `✖ judge-all --once without X …` (`[ null, null ]`). `nb typecheck-bench` green. [ ] red seen
- [ ] **Step 2 (GREEN):** S4 Q.3. `suite` → N0 + 5 pass; `nb bench`, `nb typecheck-bench` green.
- [ ] **Step 3 (CLEAN):** `git diff $B/src` shows only S4 Q.3's lines (one import, one usage line, four call sites, the constant). Commit.

### Task Q.4 — Retire the `qwen` arm

**Files:** `$B/test/defaults.test.ts` (S3 part 2); `$B/src/config.ts`, `$B/src/cli.ts` (S4 Q.4).
**Interfaces — consumes:** `DEFAULT_PAIR` (Q.3), `JUDGES` (`src/judge.ts`), `runOne` (`src/run.ts`).

- [ ] **Step 1 (RED):** append S3 part 2 (and its imports). `nb bench` fails: `✖ the bench's only OpenRouter use …` (`actual: [ 'qwen' ]`), `✖ run TASK qwen: …` (`Missing expected rejection.`). `nb typecheck-bench` green. [ ] red seen
- [ ] **Step 2 (GREEN):** S4 Q.4. `suite` → N0 + 7 pass, Q.1/Q.2's three tests among them (now exercising the real case); `nb bench`, `nb typecheck-bench` green.
- [ ] **Step 3 (planted):** the `free:` arm (table) → `actual: [ 'free' ]`. Revert. [ ] red seen
- [ ] **Step 4 (CLEAN):** `grep -rn -F 'qwen3.8-27b:free' $B` → nothing, rc 1. Commit.

### Task Q.5 — Docs

**Files:** `$B/README.md` (S5); the spec (S6) only if OQ1 = yes.

- [ ] **Step 1:** S5. **Step 2:** S6 if decided.
- [ ] **Step 3 (checks):** `git grep -n -F 'qwen3.8-27b:free' -- packages/bench` → empty, rc 1; `git grep -n -w qwen -- $B/src $B/README.md` → only the README's retired-arm sentence; `nb leak` green. Commit.

### Task Q.6 — Gate and Execution Record

- [ ] **Step 1:** on a tree whose `git status --short` is empty (or the Q clone): the AGENTS.md loop over every check, under `flag`. Expected: no `FAILED`, no `LISTING FAILED`; `bench` log `ℹ tests N0 + 7`. A red router check caused by another agent's work is recorded, not fixed.
- [ ] **Step 2:** `ne packages.x86_64-linux --apply builtins.attrNames --json` unchanged from Q.0.
- [ ] **Step 3:** fill `# Execution Record` (per task: commit, red seen, deviation; the gate table; the updated "Inventory for P" line counts). Commit this plan only.
- [ ] **Step 4 (hand-off):** tell main: Q's commits/branch; that the router plan's H6.3 note ("arms named explicitly while Q has not landed") is moot once the host's lock includes Q.

---

## Snippets

### S1 — `test/q-fixtures.ts`

```ts
// Step Q (spec §7): fixtures for the retired `qwen` arm's old runs and the judge's default pair.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Arm } from "../src/types.ts";
import { fakePrintPi, script, sourceRepo, tmp } from "./helpers.ts";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");

/** `pi-bench <args>` in a child node; the parent environment is kept (see cli.test.ts), `env` wins. */
export const cliRun = (env: Record<string, string>, ...args: string[]): string =>
	execFileSync("node", ["--experimental-strip-types", "--no-warnings", cli, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });

/** The retired arm as an old data dir's `arms.json` defines it again; its model is irrelevant to runs with a fake pi. */
export const OLD_QWEN: Arm = { model: "old/qwen", thinking: "xhigh", driver: "print", extensions: ["infinite-context", "claude-auth"] };

export const cand = (verdict: string) => ({ correct: 3, scope: 2, quality: 3, verdict, requirements: [], notes: "" });
const PAIR_ANSWER = "```json\n" + JSON.stringify({ A: cand("pass"), B: cand("partial"), preference: "A", preferenceReason: "r" }) + "\n```";

/** Task `T` with refs and one finished run per arm (`qwen` through `arms.json`); a fake pairwise judge. */
export function judgeBench(arms: string[]): { data: string; env: Record<string, string>; judged: (judge: string) => string[] | null } {
	const repo = sourceRepo();
	const data = tmp();
	const env = { PI_BENCH_DATA: data, PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext", HOME: tmp() };
	writeFileSync(join(data, "tasks.json"), JSON.stringify({ T: { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], prompt: "p", check: "true" } }));
	writeFileSync(join(data, "arms.json"), JSON.stringify({ qwen: OLD_QWEN }));
	const agent = fakePrintPi(join(tmp(), "alog"));
	for (const arm of arms) cliRun({ ...env, PI_BENCH_PI: agent }, "run", "T", arm, "1");
	cliRun(env, "refs");
	const judge = script(`#!/bin/sh\ncat >/dev/null\ncat <<'EOF'\n${PAIR_ANSWER}\nEOF\n`);
	const judged = (j: string) => {
		const f = join(data, "judge/T", `${j}.json`);
		return existsSync(f) ? Object.keys(JSON.parse(readFileSync(f, "utf8")).arms).sort() : null;
	};
	return { data, env: { ...env, PI_BENCH_PI: judge }, judged };
}
```

### S2 — `test/old-qwen-runs.test.ts`

```ts
// Step Q (spec §7): runs of the retired `qwen` arm stay reportable and judgeable. Green before and after Q.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultArms, resolvePaths } from "../src/config.ts";
import { loadRows } from "../src/report.ts";
import { tmp } from "./helpers.ts";
import { cand, cliRun, judgeBench, OLD_QWEN } from "./q-fixtures.ts";

// Q.1
test("report: an arm without factors adds nothing to a row, so old qwen runs report the same with or without the arm", () => {
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp() }, "/pkg");
	const D = paths.data;
	writeFileSync(join(D, "tasks.json"), JSON.stringify({ S1: { kind: "small" } }));
	for (const arm of ["qwen", "sonnet"]) {
		mkdirSync(join(D, "runs", `S1.${arm}.1`), { recursive: true });
		writeFileSync(join(D, "runs", `S1.${arm}.1`, "result.json"), JSON.stringify({ id: "S1", arm, rep: 1, model: "m", think: "high", piexit: 0, checkExit: 0, wallSec: 60, checkSec: 0, filesChanged: 1, baseSha: "x" }));
	}
	mkdirSync(join(D, "judge/S1"), { recursive: true });
	writeFileSync(join(D, "judge/S1/opus.json"), JSON.stringify({ id: "S1", judge: "opus", map: { A: "qwen", B: "sonnet" },
		arms: { qwen: { ...cand("partial"), capped: false }, sonnet: { ...cand("pass"), capped: false } }, preference: "B" }));
	const without = loadRows(paths);
	writeFileSync(join(D, "arms.json"), JSON.stringify({ qwen: OLD_QWEN }));
	assert.deepEqual(loadRows(paths), without);
	const factors = Object.keys(Object.values(defaultArms()).find((a) => a.factors)!.factors!);
	const row = without.find((r) => r.arm === "qwen")!;
	assert.deepEqual(factors.filter((f) => f in row), [], "no factor column on an old qwen row");
	assert.equal(row.verdicts.opus, "partial");
});

// Q.2
test("judge TASK JUDGE qwen sonnet and judge-all qwen: old qwen runs stay judgeable with explicit arms", () => {
	const b = judgeBench(["qwen", "sonnet"]);
	cliRun(b.env, "judge", "T", "opus", "qwen", "sonnet");
	assert.deepEqual(b.judged("opus"), ["qwen", "sonnet"]);
	cliRun(b.env, "judge-all", "--once", "qwen");
	assert.deepEqual(b.judged("gpt"), ["qwen", "sonnet"]);
});

test("judge: a task's recorded blind map wins over the requested pair, so both judges see the same two runs", () => {
	const b = judgeBench(["qwen", "qwenl", "sonnet"]);
	cliRun(b.env, "judge", "T", "opus", "qwen", "sonnet");
	cliRun(b.env, "judge", "T", "gpt", "qwenl", "sonnet");
	assert.deepEqual(b.judged("gpt"), ["qwen", "sonnet"]);
});
```

### S3 — `test/defaults.test.ts`

Part 1 (Q.3), with header and imports `test`, `assert`, `tmp` (`./helpers.ts`), `cliRun`, `judgeBench` (`./q-fixtures.ts`):

```ts
// Step Q (spec §7, §9): the judge's default pair moves to qwenl; the retired `qwen` arm is gone.
test("judge TASK JUDGE without arms judges qwenl against sonnet", () => {
	const b = judgeBench(["qwenl", "sonnet"]);
	const out = JSON.parse(cliRun(b.env, "judge", "T", "opus"));
	assert.deepEqual(Object.keys(out.verdicts).sort(), ["qwenl", "sonnet"]);
	assert.deepEqual(b.judged("opus"), ["qwenl", "sonnet"]);
	assert.throws(() => cliRun({ HOME: tmp() }, "bogus"), /\(default qwenl sonnet\)/);
});

test("judge-all --once without X judges qwenl against sonnet, and leaves a task with only old qwen runs alone", () => {
	const b = judgeBench(["qwenl", "sonnet"]);
	cliRun(b.env, "judge-all", "--once");
	assert.deepEqual([b.judged("opus"), b.judged("gpt")], [["qwenl", "sonnet"], ["qwenl", "sonnet"]]);
	const old = judgeBench(["qwen", "sonnet"]);
	cliRun(old.env, "judge-all", "--once");
	assert.deepEqual([old.judged("opus"), old.judged("gpt")], [null, null]);
});
```

Part 2 (Q.4); imports gain `existsSync` (`node:fs`), `join` (`node:path`), `DEFAULT_PAIR, defaultArms, resolvePaths` (`../src/config.ts`), `JUDGES` (`../src/judge.ts`), `runOne` (`../src/run.ts`), `fakePrintPi, sourceRepo` (`./helpers.ts`):

```ts
test("the bench's only OpenRouter use is the paid judge gpt: no default arm is on OpenRouter, the default pair is two default arms", () => {
	const onOpenRouter = (xs: Record<string, { model: string }>) => Object.entries(xs).filter(([, v]) => v.model.startsWith("openrouter/")).map(([n]) => n);
	assert.deepEqual(onOpenRouter(defaultArms()), []);
	assert.deepEqual(onOpenRouter(JUDGES), ["gpt"]);
	for (const a of Object.values(DEFAULT_PAIR)) assert.ok(a in defaultArms(), a);
});

test("run TASK qwen: the retired arm is unknown and nothing is created; the usage no longer offers it", async () => {
	const repo = sourceRepo();
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "p", check: "true" };
	const pi = fakePrintPi(join(tmp(), "log"));
	await assert.rejects(runOne({ id: "U", task, arm: "qwen", rep: 1, paths, piBin: pi, env: { PATH: process.env.PATH! }, timeoutSec: 30 }), /unknown arm: qwen/);
	assert.equal(existsSync(join(paths.data, "runs/U.qwen.1")), false);
	assert.throws(() => cliRun({ HOME: tmp() }, "bogus"), /\(ARM: qwenl \| sonnet \| orch \| orch-<signs> \| arms\.json\)/);
});
```

### S4 — `src/config.ts`, `src/cli.ts`

Q.3 — `config.ts`, after `defaultArms`:

```ts
/** The pairwise judge's default arms (`judge TASK JUDGE`, `judge-all`): the local Qwen against Sonnet (spec §7, step Q). */
export const DEFAULT_PAIR = { x: "qwenl", y: "sonnet" } as const;
```

Q.3 — `cli.ts`: import `DEFAULT_PAIR` from `./config.ts`; usage `(default qwen sonnet)` → `(default ${DEFAULT_PAIR.x} ${DEFAULT_PAIR.y})`; `judge`: `x: a[2] ?? DEFAULT_PAIR.x, y: a[3] ?? DEFAULT_PAIR.y`; `judge-all`: `?? DEFAULT_PAIR.x` for `x`, `${id}.${DEFAULT_PAIR.y}.1/result.json` and `y: DEFAULT_PAIR.y` for the two `"sonnet"` literals.

Q.4 — `config.ts`: delete the line `qwen: printArm("<F>", "xhigh"),`. `cli.ts` usage: `(ARM: qwen | qwenl | sonnet | orch | …)` → `(ARM: qwenl | sonnet | orch | …)`.

### S5 — `packages/bench/README.md`

- `:22` `(default \`qwen\` vs \`sonnet\`)` → `(default \`qwenl\` vs \`sonnet\`)`.
- `:23` row `judge-all`: `pairwise: judge everything that is finished (X default \`qwenl\`, against \`sonnet\`)`.
- `:27` arms: `` `qwenl`, `sonnet` (print driver, `pi -p`) … ``; after that paragraph add:

  > The `qwen` arm (the free OpenRouter Qwen, gone) was retired in step Q. Its old runs (`runs/*.qwen.*`) stay in reports unchanged, and `pi-bench judge TASK opus|gpt qwen sonnet` or `pi-bench judge-all qwen` still judges them; without `qwen` named, the pairwise commands leave them alone. `run` and `sched` reject it as an unknown arm unless `<data>/arms.json` defines it again. The bench's only OpenRouter use is the judge `gpt`.

### S6 — spec §7 amendment (only if OQ1 = yes)

After the "Step Q" bullet of §7:

> Amendment (Q plan, 2026-10-25): no factors-only stub. The `qwen` arm never had factors (`config.ts`, `printArm`), so `report`'s `arms[r.arm]?.factors ?? {}` is `{}` with or without the arm, and old reports are unchanged without a stub. A stub in `defaultArms()` would not be an `Arm`, and would send `run … qwen` down the factor-arm path. Q's test "report: an arm without factors adds nothing to a row …" pins it.

---

## Inventory for P (at `5eff6ff`; router G3 is moving router lines — P re-runs `git grep -n -F 'qwen3.8-27b:free'` and `git grep -n -i -w -e qwen -e qwen-cloud`)

**I-1 Bench, changed by Q:** `packages/bench/src/config.ts:17` (the arm, names F); `src/cli.ts:15,17,99,105` (usage, defaults); `README.md:22,27`.

**I-2 Bench, stays after Q (arm labels of old data, not F):** `test/judge.test.ts:15-20,65-69,87,190`; `test/report.test.ts:54-152` (27 lines, the old-run fixture); Q's own fixtures (`old/qwen`). `qwenl` uses: `test/{cli,judge,run}.test.ts`.

**I-3 F still named after Q, router (not Q's; router T5.4 empties the default; the rest is P's call):**
- default: `packages/task-router/core/settings.ts:32` (T5.4 → `""`);
- tests: `test/settings.test.ts:27` (asserts the default; changes with T5.4), `cloud.test.ts:73`, `failover.test.ts:7`, `policy.test.ts:8`, `top.test.ts:11`, `unrouted.test.ts:11`, `select.test.ts:26`, `members.test.ts:60` (and `o/q:free` at `:15`, not F), `route.test.ts:221` (a message literal listing the routing table), `test/golden/grid.ts:32`, `test/fixtures/today-config.json:16`, `test/oracle/legacy-settings.ts:16`;
- `checks/router-golden/golden.txt:331-373` (9 `chain defaults` lines; T5.4 re-records `defaults`; F5.1 adds the `today` fixture, which keeps F on purpose, router D8);
- docs: `docs/pi-token-economics.md:60-61` (router T5.11 rewrites).

**I-4 Free-tier mechanism, generic (no model id):** `packages/task-router/core/{chain.ts:22-24,failover.ts:1,cloud.ts}`, `test/{chain.test.ts:71,81,failover.test.ts:9,free-cloud-slot.test.ts}`, `test/oracle/legacy-chain.ts:23-25`; `checks/router-golden/{default.nix:3,15,generate.ts:2,13,17}`; retry free-cap: `patches/pi-retry/pi-retry-free-cap.patch:12,44-45`, `packages/retry/package.nix:3`, `checks/retry/default.nix:25-31`, `docs/pi-economics.md:206`, `docs/pi-token-economics.md:19`. The router's slot code stays (owner); P only decides wording.

**I-5 `qwen` as a tier/member label, not the dead model:** the router (`core/{policy,randomize,settings,types,failover,health}.ts`, ~40 test files, `package.json:4`, `modules/task-router.nix:53`), token-meter (`core/analyse.ts:221-362,536-557`, `LOGS.md:96,107,208-210`, `test/{analyse,contract,delegation,ledger}.test.ts`, `test/world.ts:36-59`, which models a cloud child as `provider: "openrouter", model: "qwen"` at `:49`), `checks/log-contract/contract.ts:81` (`qwen3-coder`), `skills/pi-token-economics-analysis/SKILL.md:47,51,84`, `docs/pi-economics.md:231,233,257,311`, `docs/pi-token-economics.md:16,42`. No scrub needed unless P renames the tier.

**I-6 Excluded docs (leak check skips them until P; §8.3 scrubs or moves them):** the spec (§§1, 6.1, 7, 9, 10 prose about the retired free Qwen; no F literal), `docs/plans/2026-10-25-m5-task-router-plan.md` (25 lines), `2026-10-25-router-g3-g7-plan.md` (23), `2026-10-17-m1-bench-plan.md:111`, this plan.

**I-7 Outside this repository:** the owner's `<bench data>/arms.json` (may define `qwen`); the host's W4.2 pins `models.qwen-cloud.model = ""` (main's decision on router Q4).

---

## Open questions (each with a recommendation; the plan follows it)

- **OQ1 (D1) The spec's factors-only stub.** `qwen` has no factors, so the stub changes no report and is a hazard in `defaultArms()`. *Recommend:* no stub; Q.5 adds S6 to §7 (or main adds it), Q.1's property is the evidence. Fallback if main wants a stub: a report-only `RETIRED_FACTORS = { qwen: {} }`, never in `defaultArms()`.
- **OQ2 Shared work tree with router G3.** Q touches none of the router's files (not `modules/bench.nix`, not `checks/module-eval`), but `git+file:` builds see the other agent's uncommitted edits and the index is shared. *Recommend:* Q in a clone under `$TMPDIR`, pushed to branch `q-retire-qwen`; main cherry-picks it (file-disjoint) after G3's group gate T3.8. Alternative: Q on `main` while the router agent is idle, `commit -o` only.
- **OQ3 Order against the spec.** §9's amendment puts Q after Groups 3–7. Q is independent of them. *Recommend:* allow Q any time before P (e.g. after G3). Landing it before G6 changes nothing for H6 (H6 uses the host's installed bench, and `judge --all` has no default pair).
- **OQ4 (D5) A hint for `run … qwen`.** *Recommend:* no special message (`unknown arm: qwen`); the README explains.
- **OQ5 A Nix check that F never comes back into `packages/bench`.** *Recommend:* no; P-arms covers the defaults, and P's repo-wide scrub covers names (I-3).

# Execution Record

(To be filled by Q.6: per task commit, red seen, deviations; gate table; open questions as decided.)

# Main's decisions on the open questions (2026-10-25)

OQ1–OQ5 accepted as recommended. OQ2: Q runs in a git worktree on branch
`q-retire-qwen` (~/.cache/pi/q-wt) and is merged into main after G3's T3.8.
OQ3: Q may land any time before P (spec order amended by this record).
