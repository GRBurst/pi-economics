# Local mode L4–L8: test-driven implementation plan

Status: plan, not implemented. Scope: milestones **L4** (Actor spawn API and overseer), **L5** (worktrees), **L6**
(merge gate), **L7** (plans) and **L8** (close-out) of `docs/local-mode/design.md` (the spec; §7 resolutions: every
recommendation accepted, OQ18 a new patch file, OQ7 `quiet`). It builds on `docs/local-mode/plan-L1-L3.md`
(called *P13* below): its decisions D1–D21, disagreements X1–X14, keep-green sets, commands, snippets S1–S14 and §18
resolutions hold and are not repeated. Numbering continues: decisions D22+, disagreements X15+, snippets S15+,
questions Q13+, risks R6+, gaps G6+.
Task ids `L<m>.T<n>`; every task starts at `[ ] todo` (states: `todo`, `red seen`, `green`, `done`).
One task = one scenario = one commit (`git -c commit.gpgsign=false commit`).

Precondition: P13 complete (L1–L3 `done`); L4 starts from that tip. The plan stays in `docs/local-mode/` (P13 §18 Q1).

## 1. Motivation

Local mode lets a local Qwen main do most of the work; the binding quality gates are Opus reviews that Qwen cannot
skip or fake (design §1, G2–G5). L4 gives the router a way to spawn agents and receive a typed result (an Actor
patch: `api.spawn`, `api.kill`, `childTools`, `cwd`) and builds the overseer on it: tickets, budget, fallback, the
verdict schema and its harness rules, and the `steer` role that replaces L3's fixed escalation hint. L5 adds branches
in worktrees (`start_branch`), keeps main-session writes out of the main checkout and makes the active worktree the
default child cwd. L6 makes merging binding: a git-command classifier for the main session and children, and
`request_merge` (refusals, size, checks, red run, approval binding, Opus review, fast-forward, fixer, bypass
detection). L7 adds plans: Opus-authored skeletons with red-run checks, a plan file committed on main, plan-bound
branches with whitelists, tick-only edits, replan triggers and reviewed amendments. L8 completes the module docs and
log examples. Default mode stays byte-for-byte unchanged throughout (G6, AC-N1–N4).

## 2. Approach (shape of the diff)

- **L4 Actor patch** `patches/pi-actor-subagents/pi-actor-subagents-spawn-api.patch` (third in the list, after
  `…-spawn-policy.patch`): `api.ts` gains `ChildTool`, `PolicyResult.childTools/cwd`, optional `spawn`/`kill`;
  `spawner.ts` passes `childTools`/`cwd` into the session spec and takes `quiet`; `engine.ts` skips notices for
  quiet agents; `index.ts` wires `installApi({…, spawn, kill})`, starts the child session in `spec.cwd`, appends
  the child tools to `customTools`, keeps quiet agents out of the roster; `tool-guard.ts` lets a guard return a
  Promise; new `child-tools.ts`. Tests inside the patch; `passthru.spawnPolicyApi = 2`.
- **L4 router**: `core/api.ts` copy updated (+ a reverse iface check for `PolicyResult`); pure
  `core/local/schema.ts` (JSON-schema subset), `core/local/verdict.ts` (V1–V3); `core/local/overseer.ts`
  (tickets, ticket policy, budget, `runOverseer`); one first statement in `createPolicy` (ticket branch);
  `core/local/steer.ts`; shell: API-extension detection, budget entries, event forwarding, ticket spawn lines;
  outcome/contract `review`; HM third assertion; a real-host package check `pi-install-local`.
- **L5**: `core/local/git.ts` (argv runner + git port, grows per milestone), `core/local/worktree.ts` (names,
  `startBranch`, write guard, cleanup), `core/local/branches.ts` (branch store + session entries); `git` joins the
  router package's `nativeCheckInputs` (temp-repository tests); `start_branch` tool; `localSection(s, active)`;
  default child cwd in `createPolicy`; detectors `check-failing`, `over-size` (P13 D13), trip `outside-worktree`.
- **L6**: pure `core/local/gitcmd.ts`; main `tool_call` git guard; child git guard composed (async-aware
  `composeGuards`); `core/local/merge.ts` (pipeline steps as functions over ports), approvals, fixer, bypass
  detection; `request_merge` tool; `merge`/`gatebypass` events.
- **L7**: `core/local/plan.ts` (schema, validation, canonical JSON, render/parse, ticks, triggers),
  `core/local/planflow.ts` (`plan_request`, red runs, commit on main, `amend_plan`), plan and whitelist guards,
  merge step 4 and regression checks; `plan` event.
- **L8**: `docs/pi-economics.md`, `packages/token-meter/LOGS.md` examples (test-verified), design wording fixes, README.
- No change to: `core/importance.ts`, `core/nudge.ts`, `core/explicit.ts`, `resolveLeg`, `planSpawn`, golden files,
  the four `runtime-guard.ts` (API `version` stays 1), `flake.lock`, root `package.json`, versions.

## 3. Decisions made

| # | Decision | Rationale | Rejected alternative (why) |
|---|---|---|---|
| D22 | The patch lets `ToolGuard` return `string \| undefined \| Promise<…>`; the guard extension `await`s it | the child git guard needs `branchOf` (a git process, design §3.4.5), and the guard is synchronous today (X15) | `execFileSync` in the guard (freezes every session's event loop up to 2 s); a stale branch cache (misclassifies after `checkout`) |
| D23 | `createSession` gets a third parameter `cwd = cwdOf(spec)` that shadows the closure `cwd`; `cwdOf` is defined beside the closure | no hunk touches the `SessionManager.create(cwd, …)` lines, whose neighbour (the child session's display-name setter) contains a `boundary` term; a hunk's 3 context lines would carry it into the patch | edit every `cwd` use (a hunk next to that line fails `boundary`) |
| D24 | Quiet agents (overseers) are not written to the roster | a restored overseer has no `childTools` and no ticket; it could never submit | let the router kill stale `ovs-*` agents (load-order race with the Actor's restore) |
| D25 | The ticket branch is the **first** statement of `createPolicy`, before `if (!s.routing)` | tickets are router-internal and must work under an experiments arm with routing off; a forged ticket falls through (AC-O6) | inside the routing path (overseers break with `routing: false`) |
| D26 | Ticket children are not entries of `pd.children`; the overseer owns them and the shell writes their `spawn` line via `log.ticketSpawn` (no verdict slot) | failover, verify gate and effort guard must not act on them, and a kill after `submit` must not log `verdict unjudged` (X24) | reuse `children` (every overseer produces an `unjudged` line and can be rerouted) |
| D27 | Idle is detected by polling `api.list()` (status `idle` after a `turn` event), with the verify gate's `POLL_MS`; injected `sleep`/`now` | the API has no idle event (`turn` = turn start, X16) | a patch-side idle event (more patch, no other user) |
| D28 | Attempts per overseer run: 2 (the second always on `fallbackMember`/`fallbackEffort`, `fallback: "error"`), `steer` 1; an `invalid` outcome counts as a failed attempt | design §3.2.2 step 5; one rule for every failure kind (X18) | no retry after `invalid` (fails a merge on one sloppy submission) |
| D29 | `invalid` outcome on the `(resubmits + 1)`-th invalid submission; submissions 1…`resubmits` get `invalid: <reasons>; resubmit` | "up to `resubmits` times" (§3.2.2) read literally; AC-O3 boundary pinned both sides (X17) | outcome at the `resubmits`-th |
| D30 | `opusUsed += 1` per spawn on `overseer.member` (counted at spawn); `steerUsed += 1` per steer spawn; one `task-router/budget` entry per change | an Opus attempt that times out still cost; the entry rebuilds the budget at resume | count successes only (under-counts cost) |
| D31 | A failed `steer` sends the fixed `ESCALATION` text as a steer message | Qwen still gets the escalation the budget-exhausted path gives; advisory, never blocks (X19, Q16) | nothing (design "skipped": a persistent loop gets no signal) |
| D32 | Steer input in L4 = trip + the last 12 call records (one line each, `CallRecord.cmd` added for bash); L5 adds the focal diff (≤ 80 lines), goal and check | those inputs exist only from L5 | stub them in L4 |
| D33 | V1 target rule: `targets` set per role (merge: diff paths; steer: record paths ∪ branch files; delta/plan-review: plan files ∪ task ids); `undefined` or empty set → rule skipped | a steer without paths would otherwise reject every finding | one global rule |
| D34 | Review ids `rv-<8 hex>` and tickets 32 hex from the injected `rng`; overseer agent names `ovs-<role>-<n>` (`n` per session) | ids satisfy AC-L2; tests stay deterministic | sequential review ids (collide across sessions in the log) |
| D35 | `repo` key = the repository root (`dirname(--git-common-dir)` when it ends in `/.git`, else the common dir); logs carry only its basename | one key for all worktrees of a repository; AC-L2 (X22) | `--show-toplevel` (differs per worktree) |
| D36 | Relative `worktrees.root` resolves against the repository root | AC-W1 (`<parent>/<repo>.worktrees/lm--x` with `../{repo}.worktrees`) (X20) | against the root's parent (lands one level higher) |
| D37 | `task-router/branch` entry gains `goal?`, `check?`, `fixerRuns`, `fixer?`, state `blocked` | resume needs goal/check for merges; fixer rounds and the blocked state must survive a restart (X21) | memory only |
| D38 | The active worktree = the branch of the newest `task-router/branch` entry with state `active` | one rule for live state and rebuild | a separate `active` entry |
| D39 | The main-checkout write guard uses cached facts (main checkout dir, registered worktrees), refreshed by `start_branch`, `request_merge` and at `session_start` | the guard stays synchronous and total | a git call per `edit` |
| D40 | `mergeGate` does not require `worktrees`; `request_merge` finds the branch's worktree with `git worktree list` and refuses `no-worktree` when none has it. `plans` is effective only with `worktrees` and `mergeGate` effective (`activeSet`), else a problem `plans: needs worktrees and mergeGate; off` | OQ11 allows `mergeGate: on` in default mode, where a strong main makes its own worktrees; plans need both (X26) | `mergeGate` ⇒ `worktrees` (no gate for a default-mode main) |
| D41 | `check-failing`: a bash `tool_result` whose whitespace-normalised `command` equals the active branch's check (or a plan task check), `isError === true` = exit ≠ 0; consecutive such runs, other calls do not reset, a passing run does | pi 1.4 bash reports a non-zero exit as an error result (G1) | parse `exit code: N` from text (fragile) |
| D42 | `over-size` counts `git diff --numstat <base>` in the worktree plus untracked files (`ls-files --others --exclude-standard`, their line counts read through `fs`) | design "staged, unstaged and committed"; new files are the common case | numstat only (misses new files) |
| D43 | Git classification is two-phase and pure: `gitDirs(cmd, cwd)` → the shell resolves `branchOf` for those dirs (async, 2 s) → `classify(cmd, cwd, mains, branches)` | pure and testable without git; one async step in the hook/guard | async classifier |
| D44 | `composeGuards` becomes async-aware: sync guards keep sync results; the first Promise turns the rest into a Promise chain | P13 L3.T6 property tests stay valid; children get async guards (D22) | always async (changes existing sync results) |
| D45 | Overseers spawn with `{by: "main", quiet: true}`; the fixer with `{by: "main", quiet: false}` | OQ7 for overseers; the fixer's report and its error notice must wake main (fixer-running ends on either) | fixer quiet (main waits forever after a fixer crash) |
| D46 | The fixer is killed by the router on its report (route fixer→main) or when the branch merges/blocks | frees the agent slot; the next round spawns a fresh fixer | keep it idle |
| D47 | The fixer ticket applies an active force (design §3.6.3 "and the merge fixer"); overseer tickets ignore it (AC-F6). Ticket spawns skip slot accounting | design; members are cloud by default (R12) | force overseers too |
| D48 | Router tool results: `{content: [{type: "text", text}], details: <result object>}`; `isError` only for `status: "error"` and invalid input | pi 1.4 `structuredContent` needs an `outputSchema` (X23) | `structuredContent` |
| D49 | `request_merge`, `plan_request`, `amend_plan` honour the tool's `AbortSignal`: abort → kill the overseer/fixer-in-flight ticket, return `status: "error"`, reason `aborted` | a user abort must not leave a 15-minute Opus run | ignore aborts |
| D50 | Plan commits on main use plumbing (`read-tree` into a temporary index, `hash-object -w`, `update-index --cacheinfo`, `write-tree`, `commit-tree -p <tip>`), then the merge's fast-forward path | never touches the main checkout's index or files; same path as merges (LD10) | `git -C <main checkout> commit` (needs a clean, checked-out main) |
| D51 | `plan_request` checks main cleanliness (when main is checked out) before authoring | avoids an approved, unwritable plan after an Opus run | check only at commit time |
| D52 | Broken checks (exit 126/127) still broken after `plans.rounds` fail `plan_request`; vacuous ones are accepted with `vacuousCheck` (LD9) | a broken check makes every merge of the task fail | accept broken with a flag |
| D53 | A trigger has id `t<n>` (per plan); triggers persist in the `task-router/plan` entry | `amend_plan.trigger.id` must name it | free-text ids |
| D54 | OQ20: a main turn counts toward `taskTurns` when one of its tool calls has a `path` under the active worktree or a bash `command` containing the worktree path | the accepted OQ20 rule, made decidable from call records | every main turn |
| D55 | The temp-repository helper sets `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null`, author/committer `u` and an e-mail joined at runtime from two strings | the leak check scans every tracked file for e-mail addresses; tests must not read the developer's git config | a literal fixture address (fails `leak`) |
| D56 | Unit layers use a scripted `test/fake-git.ts` (implements the `Git` port in memory); the ACs marked "in a temporary repository" use real git (`test/git-repo.ts`) | fast and deterministic logic tests; real git only where git behaviour is the subject | real git everywhere (slow) or fakes everywhere (git semantics unverified) |
| D57 | `log-contract` drives `review`/`merge`/`gatebypass`/`plan` writers through the harness with `fake-git` | its `runCommand` has only `nodejs` | add git to `log-contract` |
| D58 | `LOGS.md` local-mode examples are extracted by a token-meter test and run through the contract | examples a reader copies must be valid | prose-only examples |

## 4. Where design and code disagree (with the recommended fix)

| # | Design says | Code has | Recommendation (task) |
|---|---|---|---|
| X15 | §3.4.5 children use the composed `toolGuard` with `branchOf` (a git process, 2 s timeout) | `tool-guard.ts` (spawn-policy patch): `ToolGuard = (…) => string \| undefined`, sync | D22 in L4.T2; D44 in L6.T4 |
| X16 | §3.2.2 "if the child goes idle without submitting" | `AgentEvent` has `turn` (start) only, no idle event | D27 (L4.T9) |
| X17 | §3.2.2 "up to `resubmits` times" vs AC-O3 "after `resubmits` invalid submissions the outcome is `invalid`" | — | D29, both boundaries tested (L4.T8) |
| X18 | §3.2.2 step 5 does not say whether `invalid` is retried, nor what happens when attempt 1 already used the fallback (budget) | — | D28 |
| X19 | §3.1.2 "a `steer` overseer that fails is skipped" | — | D31 (Q16) |
| X20 | §3.3.1 "relative roots resolved against the repository root's parent" | AC-W1 expects `<parent>/<repo>.worktrees` from `../{repo}.worktrees` | D36 (L5.T2); reword §3.3.1 (L8.T3) |
| X21 | §3.0.2 `task-router/branch` has no `goal`, `check`, fixer count; states lack `blocked` | — | D37 (L5.T4, L6.T11) |
| X22 | §3.0.3 `gatebypass.repo` (a path) vs AC-L2 (ids, shas, enums only) | — | D35: basename (L6.T15) |
| X23 | §3.4.1 result "as text plus `structuredContent`" | pi 1.4 tools return `content` + `details`; `structuredContent` requires `outputSchema` | D48 |
| X24 | §3.0.3 `spawn` gets `ticket`; contract requires `kind`, `workerTier`, `workerEffort`; `log.spawn` opens a verdict slot | `core/log.ts` `killed()` writes `unjudged` | D26: `ticketSpawn` with `kind: "overseer"` (fixer: `"implement"`), no slot (L4.T10) |
| X25 | AC-M1 "every block reason names `request_merge`" | §3.4.5's unknown-directory and fail-closed reasons do not | the AC-M1 property ranges over the corpus (literal directories only); those two reasons keep the design text (L6.T2); reword AC-M1 (L8.T3) |
| X26 | §2.3 the branch lines appear "when worktrees/mergeGate … are active" | the two lines name both `start_branch` and `request_merge` | three variants by active set (S25), D40 (Q17) |
| X27 | §3.2.1 every role's prompt says "auditor, not author" | `plan-author` authors | its own prompt (S20, Q18) |
| X28 | `packages/task-router/package.nix` checkPhase has only `nodejs`; ACs W/M/P run "in a temporary repository" | — | `git` in `nativeCheckInputs` (L5.T1) |
| X29 | §6 L5 does not list the default child cwd (§2.2 item 2) | it needs the active worktree | L5.T9 |
| X30 | P13 L3.T7 "AC-H4 (L3)" expects `ESCALATION` and no spawn in local mode | with an API extension present, L4 spawns `steer` instead | `fakeApi`'s extension is opt-in (`ext: true`); that test runs without it, unmodified |
| X31 | P13 L1.T5 pins the local section for `{mode: "local"}` | from L5 the active set adds lines in local mode | L5.T6 changes that test's input to switch `worktrees`/`mergeGate`/`plans` off (literal unchanged), stated in the task |
| X32 | §3.0.4 the warning names merges and plans | in L4 neither exists | the text is shipped verbatim in L4 (it describes the configuration, not the build) |

## 5. Gate (AGENTS.md rules)

| Rule | Result | Note |
|---|---|---|
| Tests first; every new check seen red once | PASS | every task has a RED step; green-at-once characterisation tests carry planted violations (§11) |
| Check matching (Nix): `hasPrefix`/`hasSuffix`/`splitString`/`replaceStrings`, no `match`/`hasInfix` on large text | PASS | the new module-eval case uses `failed` (prefix); `pi-install-local` is a shell check (`grep -qF`, `jq`) |
| Assertion messages `pi-economics:` + negative case | PASS | the third assertion (L4.T15) with `task-router-local-mode-needs-spawn-api` |
| No import-from-derivation | PASS | the negative case uses `overrideAttrs` on `passthru` (evaluation only) |
| Leak check | PASS | temp repos under `os.tmpdir()`; D55 (no literal e-mail); fixtures `u`, `*.invalid` |
| `legacy.nix` untouched | N/A | not touched |
| Name only shipped extensions; `boundary` | PASS | the patch must not carry the display-name setter line in any hunk context (D23); `chk boundary` after every patch regeneration; neutral names in tests (`search-ext`) |
| Consumer copies → `iface.compare` | PASS | `core/api.ts` changes: `iface-subagents-task-router` (provider → copy) stays, new `iface-policy-task-router` (router `PolicyResult` → Actor's, the direction the value flows); other consumers' copies are untouched and stay assignable (new members are optional) |
| Patched upstreams in `patches/<input>/`, `LICENSE` present, explicit patch list | PASS | new file beside the two; `patches/pi-actor-subagents/LICENSE` exists; `package.nix` lists it explicitly (OQ18) |
| `flake.lock` unchanged | PASS | |
| Root `package.json` only via render | PASS | no new extension, no bin |
| `runtime-guard.ts` copies identical; register only in the guarded body; no flags/providers | PASS | API `version` stays 1, `hasSubagentsApiV1` unchanged; tools/hooks registered by `installLocal` at `session_start` |
| Package checks pinned to pi 1.4 | PASS | `pi-install-local` uses `checks/pi-package/lib.nix` like `pi-install-actor` |
| README "Without Nix" | PASS | prose rows change in L8.T4; install line and subset block unchanged (`readme-package` green) |
| Versions | N/A | no release in L4–L8 (Q13) |
| Imports: node builtins and relative files only | PASS | `node:child_process`, `node:crypto`, `node:fs`, `node:os`, `node:path`; the schema validator is in-house (S17) |

No violations, so no complexity-tracking rows.

## 6. Files to read first (all tasks; each task adds its own list)

`AGENTS.md`; `docs/local-mode/design.md` §2.2, §2.3, §3.0, §3.2–§3.5, §4–§7; `docs/local-mode/plan-L1-L3.md` §3, §4,
§7, §13; `packages/task-router/core/{shell,policy,api,toolguard,gate,outcome,log,settings,types}.ts`,
`core/local/{install,mode,settings,tripwires,hints,childtrips}.ts` (from P13);
`packages/task-router/test/{harness,fake-pi,fake-api}.ts`; `patches/pi-actor-subagents/pi-actor-subagents-spawn-policy.patch`;
`packages/actor-subagents/package.nix`; `checks/actor-subagents/default.nix`; `checks/default.nix` (iface section);
`packages/token-meter/core/contract.ts`; `checks/log-contract/contract.ts`; `checks/pi-package/{lib,actor}.nix`.

## 7. Commands

P13 §7 holds (fast runner, `chk`, formatter, no local `tsc`). Additions:

```sh
# Actor patch work tree (L4.T1–T2): keep $W for both tasks; regenerate the patch after every change
out=$(nix build "$F#actor-subagents" --no-link --print-out-paths "${o[@]}")   # built with the two old patches only
W=$(mktemp -d)/actor && cp -r "$out" "$W" && chmod -R u+w "$W" && find "$W" -name '*.orig' -delete
git -C "$W" init -q && echo node_modules >> "$W/.git/info/exclude"
git -C "$W" add -A && git -C "$W" -c commit.gpgsign=false commit -qm base
# … edit $W/extensions/actor-subagents/… …
git -C "$W" add -A && git -C "$W" diff --cached > patches/pi-actor-subagents/pi-actor-subagents-spawn-api.patch
git add patches/pi-actor-subagents/pi-actor-subagents-spawn-api.patch && chk actor-subagents boundary leak
# temp-repository tests need git on PATH (local shell: present; nix: L5.T1)
cd packages/task-router && HOME=$(mktemp -d) node --test --experimental-strip-types test/local-git.test.ts
```

Keep-green sets (P13's KG-R, KG-L, KG-M, KG-S, KG-P, plus):

- **KG-A** `actor-subagents iface-subagents-bench-probe iface-subagents-cache-lifecycle iface-subagents-experiments iface-subagents-task-router iface-subagents-runtime-guard` (+ `iface-policy-task-router` from L4.T4)
- **KG-P** gains `pi-install-local` from L4.T17.

`router-golden` reads `planSpawn`/`resolveLeg` only; no task re-records it (AC-N1).

## 8. Type-checking strategy

`typecheck-task-router` (`tsc --strict` over `index.ts`, `core/`, `test/`) at every GREEN; the Actor's own suite
type-strips only, so the patch's type errors surface through `iface-*` and the router copy. Expected rejections:
a `Record<Trip, …>` (`HINT_TEXT`) missing `outside-worktree`; a `Record<Role, string>` prompt table missing a role;
a `MergeReason` switch that is not exhaustive (`never` default in `reasonText`); a router `PolicyResult` whose
`childTools`/`cwd`/`toolGuard` differ from the Actor's (`iface-policy-task-router`); an `Api` without `spawn?`/`kill?`
used without the `hasSpawnApi` narrowing; a `Git` fake missing a port method (`fake-git.ts` is typed `Git`). New
exports are stubbed first (`classify = () => undefined`, `validateVerdict = () => ({ok: false, reasons: []})`) so
RED is an assertion failure, not a load error.

## 9. Testing strategy per layer

| Layer | Tool | Covers | Needs |
|---|---|---|---|
| Actor patch units | `actor-subagents` (nix, upstream suite + patch tests) | `api.spawn/kill`, `quiet`, `piTool`, allowlist, spawner pass-through, async guard, roster filter | `$W` work tree (§7) |
| Pure units | `node --test` | schema, verdict V1–V3, tickets, budget pick, names/parsers, write guard, gitcmd corpus, refusal order, size, plan schema/validation/render/parse/ticks/triggers, log builders | nothing |
| Overseer integration | `node --test`, `fakeApi({ext: true})`, manual clock | ticket policy, spawn/submit/kill, idle/timeout/fallback/budget, steer delivery | `test/fake-api.ts` extension (L4.T7) |
| Shell integration | `harness()` + `test/fake-git.ts` | tool registration, guards in hooks, result rendering, entries/rebuild, bypass, plan flow | `test/fake-git.ts` (L5.T4) |
| Git integration | `node --test` + real git in a temp repository | git port, AC-W1–W3, AC-M2–M6, AC-P1/P3/P5–P7 end to end | `git` in `nativeCheckInputs` (L5.T1), `test/git-repo.ts` |
| Types/iface | `typecheck-task-router`, `iface-*` | API copy ↔ provider in both directions | L4.T4 |
| Log contract | token-meter tests, `log-contract` | `review`, `merge`, `gatebypass`, `plan`, ticket `spawn` accepted; malformed rejected | D57 |
| HM | `module-eval` | `spawnPolicyApi = 2`; third assertion | cases |
| Real host | `pi-install-local` (pi 1.4 offline) | the patched Actor exposes `spawn`/`kill` (no warning); local tools registered | L4.T17 |
| Real model | none | Opus verdict quality, Qwen following refusals/hints | manual (§12) |

Non-regression in every task: AC-N1 (`router-golden`), AC-N2 (pre-existing tests unmodified, except the two
named changes: actor module-eval case 1 → 2 in L4.T3, P13's pinned-section input in L5.T6), AC-N3/N4 (P13 L1.T1
inventory/keys tests; L6.T3 adds the default-mode `git push origin main` assertion).

## 10. Scenario coverage (AC → task → the one check that executes it)

| AC | Task | Check (test file › test) |
|---|---|---|
| AC-N1–N4 | every task | `router-golden`; P13 `test/local-default.test.ts`; AC-N3 bash: `test/local-git-guard.test.ts` › "AC-N3 default mode push" (L6.T3) |
| AC-R3 (active set) | L5.T6, L6.T13, L7.T17 | `test/local-prompt.test.ts` › "AC-R3 worktrees", "AC-R3 worktrees+mergeGate", "AC-R3 all" |
| AC-R5 (third assertion) | L4.T15 | `module-eval` › `task-router-local-mode-needs-spawn-api` |
| AC-H1 `check-failing`, `over-size` | L5.T11, L5.T12 | `test/local-tripwires.test.ts` › "AC-H1 check-failing", "AC-H1 over-size" |
| AC-H4 (overseer part) | L4.T13 | `test/local-steer.test.ts` › "AC-H4" |
| AC-O1 | L4.T7 (policy), L6.T9 (request_merge) | `test/local-ticket-policy.test.ts` › "AC-O1 policy"; `test/local-merge-review.test.ts` › "AC-O1" |
| AC-O2 | L4.T6 | `test/local-verdict.test.ts` › "AC-O2" |
| AC-O3 | L4.T6 (pure), L4.T8 (ticket) | `test/local-overseer.test.ts` › "AC-O3" |
| AC-O4 | L4.T9 (run), L6.T12 (merge) | `test/local-overseer.test.ts` › "AC-O4"; `test/local-merge-review.test.ts` › "AC-O4" |
| AC-O5 | L6.T12 | `test/local-merge-review.test.ts` › "AC-O5" |
| AC-O6 | L4.T7 | `test/local-ticket-policy.test.ts` › "AC-O6" |
| AC-O7 | L4.T1, L4.T2, L4.T3 | `actor-subagents` (`spawn-api.test.ts`, `child-tools.test.ts`); `module-eval` › `actor-subagents` |
| AC-F6 | L4.T7 | `test/local-ticket-policy.test.ts` › "AC-F6" |
| AC-W1 | L5.T5 | `test/local-start-branch.test.ts` › "AC-W1" |
| AC-W2 | L7.T9 | `test/local-plan-branch.test.ts` › "AC-W2" |
| AC-W3 | L5.T7 | `test/local-write-guard.test.ts` › "AC-W3" |
| AC-M1 | L6.T2 | `test/local-gitcmd.test.ts` › "AC-M1 block corpus", "AC-M1 allow corpus" |
| AC-M2 | L6.T6 (steps 2–3), L6.T7 (check), L7.T12 (scope) | `test/local-merge-refuse.test.ts` › "AC-M2 <code>" |
| AC-M3 | L6.T10 | `test/local-merge-ff.test.ts` › "AC-M3" |
| AC-M4 | L6.T9 | `test/local-merge-review.test.ts` › "AC-M4" |
| AC-M5 | L6.T11 | `test/local-fixer.test.ts` › "AC-M5" |
| AC-M6 | L6.T14 | `test/local-bypass.test.ts` › "AC-M6" |
| AC-M7 | L6.T4 | `test/local-git-guard.test.ts` › "AC-M7" |
| AC-P1 | L7.T6 | `test/local-plan-request.test.ts` › "AC-P1" |
| AC-P2 | L7.T1 | `test/local-plan.test.ts` › "AC-P2 <rule>" |
| AC-P3 | L7.T7 | `test/local-plan-request.test.ts` › "AC-P3" |
| AC-P4 | L7.T2 | `test/local-plan.test.ts` › "AC-P4" |
| AC-P5 | L7.T3 (pure), L7.T10 (guard) | `test/local-plan-guard.test.ts` › "AC-P5" |
| AC-P6 | L7.T14, L7.T15 | `test/local-amend.test.ts` › "AC-P6 trigger", "AC-P6 evidence", "AC-P6 review kind" |
| AC-P7 | L7.T11 | `test/local-plan-guard.test.ts` › "AC-P7" |
| AC-L1 | L4.T11, L5.T8, L6.T16, L7.T16; real path L4.T16, L6.T17, L7.T16 | `token-meter` › `test/contract.test.ts`; `log-contract` |
| AC-L2 | L4.T10, L6.T15, L7.T16 | `test/review-log.test.ts`, `test/merge-log.test.ts`, `test/plan-log.test.ts` › "AC-L2" |
| §3.0.4 warning | L4.T12 | `test/local-overseer-shell.test.ts` › "missing API extension" |
| §3.3.4 cleanup/abandoned | L5.T10 | `test/local-cleanup.test.ts` |
| §3.4.4 blocked/plan `remediation-failed` | L6.T11, L7.T13 | `test/local-fixer.test.ts` › "blocked"; `test/local-triggers.test.ts` |
| §3.5.4 rounds fallback | L7.T15 | `test/local-amend.test.ts` › "rounds exhausted" |
| §3.5.5 `over-budget` | L7.T12 (size), L7.T13 (turns) | `test/local-triggers.test.ts` |
| §2.2 item 2 (LD2) | L5.T9 | `test/local-child-cwd.test.ts` |

## 11. Planted violations (each new check must be seen red once)

| Check | Plant | Must FAIL | Seen |
|---|---|---|---|
| L4.T1 patch tests | patch holding only `spawn-api.test.ts` (natural red) | `actor-subagents` | [x] |
| L4.T2 roster filter | `persisted = (rs) => rs` | `child-tools.test.ts` › "roster" | [x] |
| L4.T4 `iface-policy-task-router` | router copy `cwd?: number` | `iface-policy-task-router` | [x] |
| L4.T4 `iface-subagents-task-router` (new members) | router copy `kill?(names: string[]): Promise<number[]>` | `iface-subagents-task-router` | [x] |
| L4.T7 AC-O6 forged ticket | `take` returns any ticket for any string | "AC-O6" | [x] |
| L4.T7 AC-F6 | apply the force branch before the ticket branch | "AC-F6" | [x] |
| L4.T10 no verdict slot | `ticketSpawn` calls `log.spawn` | "ticket spawn: no unjudged line" | [x] |
| L4.T11 contract `review` | `outcome` in `optional` | `test/contract.test.ts` › "review without outcome" | [x] |
| L4.T15 module-eval | (natural) assertion absent | `task-router-local-mode-needs-spawn-api` | [x] |
| L4.T16 log-contract `review` | drop `log.review` | `log-contract` "outcomes: no review event" | [x] |
| L4.T17 `pi-install-local` | build against the Actor without the spawn-api patch | `pi-install-local` (warning present) | [x] |
| L5.T1 git in sandbox | remove `git` from `nativeCheckInputs` | `task-router` (exit 127) | [x] |
| L5.T6 default inventory | register `start_branch` unconditionally | P13 "default mode: inventory" | [x] |
| L5.T7 write guard property | `inside()` by string prefix without a separator (`/r/x` vs `/r/xy`) | "write guard property" | [x] |
| L5.T9 default mode keys | return `cwd` always | "default mode: no cwd key" | [x] |
| L6.T2 AC-M1 allow corpus | block every `push` | "AC-M1 allow corpus" | [x] |
| L6.T3 AC-N3 | register the bash guard regardless of `mergeGate` | "AC-N3 default mode push" | [x] |
| L6.T4 AC-M7 | compose the git guard after the files guard returns early | "AC-M7" | [x] |
| L6.T9 AC-M4 binding | approval key without `commit` | "AC-M4" | [x] |
| L6.T10 ff only | `merge --no-ff` | "AC-M3" (tip ≠ reviewed commit) | [x] |
| L6.T14 AC-M6 | compare against the live ref instead of the record | "AC-M6" | [x] |
| L6.T16 contract `merge` | `reason: str` instead of `oneOf(REASONS)` | `test/contract.test.ts` › "merge reason" | [x] |
| L6.T17 log-contract `merge` | drop `log.merge` | `log-contract` | [x] |
| L7.T2 AC-P4 | render keys unsorted | "AC-P4" (hash differs) | [ ] |
| L7.T3 tick-only | allow `[x]`→`[ ]` | "AC-P5 untick blocked" | [ ] |
| L7.T16 log-contract `plan` | drop `log.plan` | `log-contract` | [ ] |
| L8.T2 LOGS examples | add a `review` example without `outcome` | `test/logs-examples.test.ts` | [ ] |

All other new tests are red by construction; record the red in the task's status line.

## 12. Coverage gap (not reached by the automated run; run by hand at each milestone end)

- G6 Real Actor host: `api.spawn` from inside a main tool call; the child session really starting in
  `PolicyResult.cwd`; a `childTools` tool offered to the model, its `isError` shown and `terminate: true` ending the
  child's loop; `quiet` suppressing notices; `api.kill`. Unit tests cover the code paths; `pi-install-local` only
  proves the members exist.
- G7 Real models: whether Opus submits valid verdicts within `resubmits`, finding quality, plan-author skeleton
  quality; whether Qwen follows refusal texts, `fixer` waits and section lines.
- G8 Git environments: hooks (`post-checkout`, `post-merge`), signing (`commit.gpgsign` on `commit-tree`, R10),
  submodules, sparse checkouts, LFS, a `main` checked out in a second worktree, network pushes (`push: true`).
- G9 pi 1.4 payloads: `edit` input shape (`edits[]` vs `oldText`/`newText`) for the plan guard, `powershell`'s
  `command`, bash `isError` on non-zero exit (D41), `AbortSignal` in `execute`.
- G10 Load: ref reads after every bash result and child `turn` (bypass detection) on large repositories.

Manual runbook (agent dir with `task-router/settings.json` = `{"mode":"local"}`, the patched Actor, a scratch repo):
1. L4: ask Qwen to repeat a failing call until escalation: one `ovs-steer-1` appears in the panel, a steer message
   with `F1 …` lines arrives, the agent disappears; `review` line in the outcome log. 2. L5: `start_branch` a slug;
   the worktree appears beside the repo; an `edit` of the main checkout is refused with the worktree path. 3. L6:
   commit in the worktree, `request_merge`: an Opus review runs, main fast-forwards to the reviewed commit; `git push
   origin main` from Qwen's bash is refused; `git update-ref` by hand → warning + `gatebypass` line. 4. L7:
   `plan_request` on a two-file change; the plan file lands on main; tick a box; edit a task line → refused;
   `amend_plan` without trigger → refused.

## 13. Snippets

### S15 Actor patch (provider side, L4.T1–T2)

```ts
// extensions/actor-subagents/api.ts (+)
export type ChildTool = {
  name: string; description: string; parameters: Record<string, unknown>;
  execute(input: unknown): Promise<{ text: string; isError?: boolean; terminate?: boolean }>;
};
// PolicyResult, allow branch: + childTools?: ChildTool[]; + cwd?: string
export type SpawnResult = { ok: true; name: string; sessionId: string } | { ok: false; reason: string };
// SubagentsApiV1 +:
//   spawn?(args: SpawnArgs, opts?: { by?: string; quiet?: boolean }): Promise<SpawnResult>;
//   kill?(names: string[]): Promise<string[]>;
// ApiDeps +: spawn?: (args: SpawnArgs, by: string, quiet: boolean) => Promise<SpawnResult>;
//            kill?: (names: string[]) => Promise<string[]>;
// makeApi: ...(d.spawn && { spawn: (a, o = {}) => d.spawn!(a, o.by ?? "main", o.quiet === true) }),
//          ...(d.kill && { kill: (n) => d.kill!(n) })        // absent deps → no key (v1 shape unchanged)

// extensions/actor-subagents/tool-guard.ts (~)
export type ToolGuard = (toolName: string, input: unknown) => string | undefined | Promise<string | undefined>;
//   pi.on("tool_call", async (e) => { const reason = await guard(e.toolName, e.input); return reason === undefined ? undefined : { block: true, reason }; });

// extensions/actor-subagents/child-tools.ts (new)
export function piTool(t: ChildTool) {
  return {
    name: t.name, label: t.name, description: t.description, parameters: t.parameters,
    async execute(_id: string, params: unknown) {
      const r = await t.execute(params);
      return { content: [{ type: "text" as const, text: r.text }], details: {}, isError: r.isError === true, terminate: r.terminate === true };
    },
  };
}
export const sessionCwd = (spec: { cwd?: string }, fallback: string): string => spec.cwd ?? fallback;
export const persisted = <R extends { quiet?: boolean }>(rs: R[]): R[] => rs.filter((r) => r.quiet !== true);

// spawner.ts: spawnAgent(spec, spawnerName, opts: { quiet?: boolean } = {})
//   createSession({ ...today, ...(decision.childTools && { childTools: decision.childTools }), ...(decision.cwd && { cwd: decision.cwd }) })
//   engine.attach(name, { ...today, quiet: opts.quiet === true }); ok result gains sessionId
// engine.ts: record.quiet; lifecycle and terminal-error notices to the parent skipped when quiet
// index.ts:
//   const cwdOf = (spec: { cwd?: string }) => sessionCwd(spec, cwd);           // beside `let cwd`
//   async function createSession(spec, existingFile, cwd = cwdOf(spec)) { … }  // D23: shadows the closure
//   customTools = [...toolsFor(spec.name), ...(spec.childTools ?? []).map(piTool)]
//   installApi({ engine, retune,
//     spawn: async (a, by, quiet) => { const r = await spawnAgent(a, by, { quiet }); persistRoster();
//       return r.ok ? { ok: true, name: a.name, sessionId: r.sessionId! } : { ok: false, reason: r.msg }; },
//     kill: async (names) => { const r = engine.kill("main", names); persistRoster(); return r.affected; } });
//   persistRoster: writeRoster(subDir, persisted(engine.list()))
```

### S16 Router copy (`core/api.ts`, L4.T4)

The same `ChildTool`, `SpawnResult`, `PolicyResult` members and optional `spawn?`/`kill?`; `toolGuard?: Guard` with
`type Guard = (toolName: string, input: unknown) => string | undefined | Promise<string | undefined>` (exported from
`core/toolguard.ts`; `SyncGuard` keeps today's signature for `toolsFor`).

### S17 Schema subset (`core/local/schema.ts`, L4.T5)

```ts
export type Schema = {
  type?: "object" | "array" | "string" | "boolean" | "number"; enum?: readonly unknown[]; pattern?: string;
  maxLength?: number; minItems?: number; maxItems?: number; items?: Schema; properties?: Record<string, Schema>;
  required?: readonly string[]; additionalProperties?: false; description?: string;
};
/** Reasons, one per violation, each prefixed with its JSON path ("$.findings[2].id: must match ^F[0-9]{1,2}$"). */
export function check(s: Schema, v: unknown, at = "$"): string[];
```

### S18 Verdict (`core/local/verdict.ts`, L4.T6)

```ts
export const CATEGORIES = ["correctness", "check", "scope", "plan", "interface", "security", "concurrency",
  "data-loss", "performance", "maintainability", "approach"] as const;
export type Finding = { id: string; category: (typeof CATEGORIES)[number]; target: string; defect: string; evidence: string; fix: string; blocking: boolean };
export type Verdict = { verdict: "APPROVE" | "REVISE"; summary: string; findings: Finding[] };
export const VERDICT_SCHEMA: Schema = /* design §3.2.3, verbatim */;
const TASK_ID = /^M[0-9]{1,2}(\.T[0-9]{1,2})?$/;
export const targetPath = (t: string) => t.replace(/:\d+(-\d+)?$/, "");
export function validateVerdict(x: unknown, targets?: ReadonlySet<string>): { ok: true; value: Verdict } | { ok: false; reasons: string[] };
//   reasons: check(VERDICT_SCHEMA, x) ∪ {"<path>: contains a code fence"} ∪ {"duplicate id <id>"}
//            ∪ (targets?.size ? {"target <t> is not in the diff or plan"} for t with targetPath(t) ∉ targets ∧ ¬TASK_ID.test(t) : ∅)
export const approve = (fs: readonly Finding[]): boolean => fs.every((f) => !f.blocking);
export const inconsistent = (v: Verdict): boolean => (v.verdict === "APPROVE") !== approve(v.findings);
const trim = (s: string) => s.replace(/[.\s]+$/, "");
export const findingLine = (f: Finding): string =>
  `${f.id} [${f.blocking ? "blocking" : "non-blocking"}] ${f.category} ${f.target}: ${trim(f.defect)}. Evidence: ${trim(f.evidence)}. Fix when: ${trim(f.fix)}`;
```

### S19 Tickets and the ticket policy (`core/local/overseer.ts`, L4.T7)

```ts
export type Role = "merge" | "plan-author" | "delta" | "plan-review" | "steer";
export type TicketRole = Role | "fixer";
export type Ticket = { role: TicketRole; reviewId: string; member: string; model: string; effort: ThinkingLevel; cwd: string;
  tools?: string[]; childTools: ChildTool[]; toolGuard?: Guard; briefAppend?: string;
  forced?: { source: "command" | "settings"; routedModel: string; routedEffort: ThinkingLevel } };
export function createTickets(hex: (bytes: number) => string): {
  issue(t: Ticket): string;                                        // 32 hex
  take(id: unknown, name: string): Ticket | undefined;             // single use; remembers name → ticket
  owner(name: string): Ticket | undefined;                         // for the spawn line and events
  forget(name: string): void;
};
export const hasSpawnApi = (a: SubagentsApiV1): a is SubagentsApiV1 & Required<Pick<SubagentsApiV1, "spawn" | "kill">> =>
  typeof a.spawn === "function" && typeof a.kill === "function";
export const overseerGuard = (allowed: readonly string[]): SyncGuard => (tool) =>
  allowed.includes(tool) ? undefined : `overseer: ${tool} is not available; report with ${allowed[allowed.length - 1]}`;
export const ticketPolicy = (t: Ticket): PolicyResult => ({
  model: t.model, thinkingLevel: t.effort, cwd: t.cwd, childTools: t.childTools,
  ...(t.tools && { tools: t.tools }), ...(t.toolGuard && { toolGuard: t.toolGuard }), ...(t.briefAppend && { briefAppend: t.briefAppend }),
  meta: { taskId: t.reviewId, role: t.role },
});
// core/policy.ts createPolicy, first statement (D25):
//   const t = d.tickets?.take((args.task as { ticket?: unknown } | undefined)?.ticket, args.name);
//   if (t) return ticketPolicy(t);
```

### S20 Running an overseer (`core/local/overseer.ts`, L4.T8–T9)

```ts
export type SubmitSpec<T> = { name: "submit_verdict" | "submit_plan"; description: string; parameters: Schema;
  check(input: unknown): Promise<{ ok: true; value: T } | { ok: false; reasons: string[] }> };
export type Budget = { opusUsed: number; steerUsed: number };
export function pickMember(s: RouterSettings, role: Role, b: Budget):
  { member: string; effort: ThinkingLevel; fallback?: "budget" } | "skip" {
  const room = b.opusUsed < s.overseer.budget && (role !== "steer" || b.steerUsed < s.overseer.steerBudget);
  if (room) return { member: s.overseer.member, effort: s.overseer.effort };
  return role === "steer" ? "skip" : { member: s.overseer.fallbackMember, effort: s.overseer.fallbackEffort, fallback: "budget" };
}
export type RunResult<T> = { ok: true; value: T; reviewId: string; member: string; model: string }
                         | { ok: false; outcome: "timeout" | "error" | "invalid" | "skipped" | "aborted" };
export async function runOverseer<T>(d: OverseerDeps, r: { role: Role; input: string; cwd: string; submit: SubmitSpec<T>;
  commit?: string; branch?: string; signal?: AbortSignal }): Promise<RunResult<T>>;
```

Algorithm: `for attempt of r.role === "steer" ? [1] : [1, 2]`: pick (`attempt 2` → fallback member, `fallback:
"error"`; `"skip"` → return `skipped`); count budget (D30); `reviewId`, `name = ovs-<role>-<++n>`; a deferred;
`invalid = 0`; `submitTool.execute(x)`: `ok` → resolve, `{text: "recorded", terminate: true}`; else `invalid += 1`,
`invalid > resubmits` → settle `invalid`, `{text: "invalid: <reasons>; no resubmits left", isError: true, terminate:
true}`, else `{text: "invalid: <reasons joined by "; ">; resubmit", isError: true}`; issue ticket (tools
`overseer.tools`, guard `overseerGuard([...tools, submit.name])`); `api.spawn({name, systemPrompt: PROMPT[role],
message: r.input, task: {ticket}}, {by: "main", quiet: true})`; `!ok` → outcome `error`, next attempt; `watch`
(D27: on `turn` mark busy; `busy ∧ status idle` → idle += 1, first → `api.send(name, "Submit with <tool>.",
"router")`, second → `error`; `kill`/`error` event or agent gone → `error`; elapsed ≥ `timeoutSec` → `timeout`;
`signal.aborted` → `aborted`, no further attempt); `api.kill([name])` (errors swallowed); `log.review(…)`; on success
append `task-router/review` and return. Model-facing texts (pinned, Q18):

```ts
export const AUDITOR = `You are an auditor, not an author. Before reading the diff or plan, derive the invariants the goal implies; then check the work against them.
Report only through the submit tool. Every finding names a target (path[:line] or a plan task id) and a fix criterion: a checkable condition, not code.
Write no code and no replacement plan. You cannot edit files or run commands.`;
export const PROMPT: Record<Role, string> = {
  merge: `${AUDITOR}\nReview the branch below for merging into the main branch. A finding is blocking when the branch must not merge without its fix.`,
  delta: `${AUDITOR}\nReview the plan amendment below against its trigger and evidence. A finding is blocking when the amendment must not be applied as proposed.`,
  "plan-review": `${AUDITOR}\nReview the whole plan below with the amendment applied. A finding is blocking when work must not continue on this plan.`,
  steer: `${AUDITOR}\nA local model is stuck; the call records below show how. Name the cause and what to do next. Mark a finding blocking only when the current approach cannot work.`,
  "plan-author": `You are the planner. Write the plan skeleton for the request below and submit it with submit_plan.
Each task is small: few files, and one check command that fails before the task and passes after it. Write no code.`,
};
```

### S21 Git runner and port (`core/local/git.ts`, L5.T1 → L7.T5)

```ts
export type GitOut = { exit: number; out: string; err: string; timedOut: boolean };
export type GitRun = (args: string[], cwd: string, timeoutMs: number, opts?: { stdin?: string; env?: Record<string, string> }) => Promise<GitOut>;
/** spawn("git", args, {cwd, detached: true}); process-group kill on timeout → exit 124; spawn error → exit 127 (as runCheck). */
export function gitRunner(file = "git"): GitRun;
export type Res = { ok: true; out: string } | { ok: false; err: string };       // err: stderr tail, 2048 chars
export type Wt = { dir: string; branch?: string; head: string };
export type Stat = { path: string; added: number; deleted: number }[];       // binary: 0/0 counted as a file
export type Git = {
  // L5
  root(dir: string): Promise<string | undefined>;  top(dir: string): Promise<string | undefined>;
  branchOf(dir: string): Promise<string | undefined | "unknown">;           // symbolic-ref --short -q HEAD, 2 s
  worktrees(repo: string): Promise<Wt[]>;  sha(repo: string, ref: string): Promise<string | undefined>;
  worktreeAdd(repo: string, dir: string, branch: string, base: string): Promise<Res>;
  worktreeRemove(repo: string, dir: string): Promise<Res>;  branchDelete(repo: string, branch: string): Promise<Res>;
  dirty(dir: string): Promise<boolean>;  diffStat(dir: string, base: string): Promise<Stat>;   // + untracked (D42)
  diff(dir: string, a: string, b: string | undefined, maxLines: number): Promise<string>;
  // L6
  isAncestor(repo: string, a: string, b: string): Promise<boolean>;  numstat(repo: string, a: string, b: string): Promise<Stat>; // a...b
  tree(repo: string, commit: string): Promise<string>;  worktreeAddDetached(repo: string, dir: string, commit: string): Promise<Res>;
  ffMerge(dir: string, commit: string): Promise<Res>;  updateRef(repo: string, ref: string, next: string, prev: string): Promise<Res>;
  push(repo: string, remote: string, branch: string): Promise<Res>;
  // L7
  grepWord(repo: string, word: string, files: string[]): Promise<string[]>;  lsFiles(repo: string, n: number): Promise<string[]>;
  commitFile(repo: string, parent: string, path: string, content: string, message: string): Promise<Res>;  // D50, out = sha
};
export function createGit(run: GitRun): Git;
// pure parsers (L5.T2): parseWorktrees(porcelain): Wt[]; parseNumstat(text): Stat; repoRootOf(commonDir): string
```

### S22 Names and branch state (`core/local/worktree.ts`, `core/local/branches.ts`, L5.T2/T4)

```ts
export const SLUG = /^[a-z0-9-]{1,40}$/;
export const branchName = (prefix: string, u: { slug: string } | { plan: string; id: string }) =>
  "slug" in u ? prefix + u.slug : `${prefix}${u.plan}/${u.id}`;
export const worktreeDir = (root: string, repo: string, branch: string) =>      // D36
  path.join(path.resolve(repo, root.replaceAll("{repo}", path.basename(repo))), branch.replaceAll("/", "--"));
export const inside = (p: string, dir: string) => { const r = path.relative(dir, p); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
export type BranchRecord = { repo: string; branch: string; worktree: string; base: string; plan?: { slug: string; id: string };
  state: "active" | "merged" | "abandoned" | "fixer" | "blocked"; rejections: number; fixerRuns: number; fixer?: string;
  goal?: string; check?: string };                                            // D37
export type BranchStore = { all(): BranchRecord[]; get(repo: string, branch: string): BranchRecord | undefined;
  put(r: BranchRecord): void /* memory + appendEntry("task-router/branch", r) */; active(): BranchRecord | undefined /* D38 */;
  rebuild(entries: { customType?: string; data?: unknown }[]): void; facts: { mainCheckout: Map<string, string> } /* D39 */ };
```

### S23 Write guard (`core/local/worktree.ts`, L5.T7; fixer part L6.T11)

```ts
export function writeGuard(x: { tool: string; input: unknown; cwd: string; active?: BranchRecord;
  mainCheckout?: string; worktrees: readonly string[]; fixerDirs: readonly string[] }): string | undefined {
  if (x.tool !== "edit" && x.tool !== "write") return undefined;
  const raw = (x.input as { path?: unknown })?.path; if (typeof raw !== "string") return undefined;
  const p = path.resolve(x.cwd, raw);
  if (x.fixerDirs.some((d) => inside(p, d))) return "a fixer owns this branch";
  if (x.active && x.mainCheckout && inside(p, x.mainCheckout) && !x.worktrees.some((w) => inside(p, w)))
    return `write in the worktree ${x.active.worktree}; use absolute paths under it`;
  return undefined;
}
```

### S24 Git command classifier (`core/local/gitcmd.ts`, L6.T1–T2)

```ts
export type Seg = { argv: string[]; dir: string | undefined };                 // dir undefined = unknown (variable cd, --git-dir)
export function segments(cmd: string, cwd: string, depth = 0): Seg[];          // split ; && || | & \n outside quotes; recurse $(…), `…`, bash|sh|zsh -c (depth ≤ 2); literal cd
export type GitCall = { dir: string | undefined; sub: string; args: string[] };
export function gitCalls(cmd: string, cwd: string): GitCall[];                 // strip VAR=x, env command nice nohup time sudo xargs; -C dir (relative to seg dir), -c k=v; --git-dir/--work-tree → dir undefined
export const gitDirs = (cmd: string, cwd: string): string[] => [...new Set(gitCalls(cmd, cwd).flatMap((c) => (c.dir ? [c.dir] : [])))];
export const MERGE_REASON = (main: string) => `merging into ${main} goes through request_merge`;
export const UNKNOWN_DIR = "cannot tell the branch; run git with a literal -C <worktree>";
export const UNCLASSIFIED = "router could not classify this git command; split it";
/** undefined = allow; a string = block reason. branches: dir → current branch (undefined: detached/none, "unknown": timeout). */
export function classify(cmd: string, cwd: string, mains: readonly string[], branches: ReadonlyMap<string, string | undefined | "unknown">): string | undefined;
/** LD8: exceptions → allow when no `git` token, else UNCLASSIFIED. */
export function safeClassify(...a: Parameters<typeof classify>): string | undefined;
```

Rules (design §3.4.5): `ON_MAIN = {merge, pull, rebase, cherry-pick, revert, am, commit, reset}` block when the
dir's branch ∈ mains, `UNKNOWN_DIR` when the dir is unknown or `"unknown"`; `push`: destination of any refspec
(`x`, `x:y`, `+x:y`, `refs/heads/y`) ∈ mains, `--all`, `--mirror`, `--delete`/`-d` with a main, or no refspec on a
main branch; `branch` with `-f|-M|-m|-D|-d` naming a main; `checkout -B <main>`, `switch -C <main>`; `update-ref
refs/heads/<main>`; `filter-branch` always. Block reason: `MERGE_REASON(<the main named or checked out>)`.

### S25 Section lines (`core/prompt.ts`, L5.T6, L6.T13, L7.T17; pinned, Q17)

```ts
export type Active = { worktrees: boolean; mergeGate: boolean; plans: boolean };
const BRANCH_FULL = `Code changes happen on branches: start_branch, then edit and commit in its worktree (absolute paths),
then request_merge. You cannot merge, push or commit to a main branch; the router blocks it.`;            // design §2.3
const BRANCH_ONLY = "Code changes happen on branches: start_branch, then edit and commit in its worktree (absolute paths).";
const GATE_ONLY = "Merge into a main branch only with request_merge. You cannot merge, push or commit to a main branch; the router blocks it.";
const PLANS = `A request that needs more than one branch starts with plan_request. Follow the plan file, tick only your
task's checkbox, and change the plan only with amend_plan.`;                                               // design §2.3
// lines inserted after "…the child's report wakes you." in this order:
//   (w ∧ m ? BRANCH_FULL : w ? BRANCH_ONLY : m ? GATE_ONLY : ∅), (plans ? PLANS : ∅)
export function localSection(s: RouterSettings, active: Active = { worktrees: false, mergeGate: false, plans: false }): string;
// core/local/mode.ts
export const activeSet = (s: RouterSettings): Active => {
  const w = componentOn(s, "worktrees"), m = componentOn(s, "mergeGate");
  return { worktrees: w, mergeGate: m, plans: componentOn(s, "plans") && w && m };              // D40
};
```

### S26 Merge pipeline (`core/local/merge.ts`, L6.T6–T12)

```ts
export const REASONS = ["main-branch", "dirty", "behind", "fixer-running", "abandoned", "blocked", "size", "scope",
  "check", "main-dirty", "plan-changed", "no-worktree", "review-unavailable", "aborted", "git"] as const;
export type MergeReason = (typeof REASONS)[number];
export type MergeResult = { status: "merged" | "refused" | "revise" | "fixer" | "error"; reason?: MergeReason; detail: string;
  commit?: string; reviewId?: string; findings?: string[]; pushed?: boolean };
export type Facts = { isMain: boolean; state: BranchRecord["state"] | undefined; dirty: boolean; behind: boolean };
/** Step 2, fixed order. */
export const refusal = (f: Facts): MergeReason | undefined =>
  f.isMain ? "main-branch" : f.state === "abandoned" ? "abandoned" : f.state === "blocked" ? "blocked"
  : f.state === "fixer" ? "fixer-running" : f.dirty ? "dirty" : f.behind ? "behind" : undefined;
export const oversize = (st: Stat, s: RouterSettings, planFile?: string, tickOnly = false) => { /* lines = Σ added+deleted except a tick-only plan file */ };
export type MergePorts = { git: Git; run: Runner; overseer: OverseerPort; branches: BranchStore; approvals: Approvals;
  log: MergeLog; settings: RouterSettings; tmp(): string; plans?: PlanPort; mainRefs: MainRefs; signal?: AbortSignal };
export async function requestMerge(p: MergePorts, input: { branch?: string; summary?: string }, cwd: string): Promise<MergeResult>;
export const reasonText: (r: MergeReason, x: Record<string, string>) => string;  // exhaustive switch, texts pinned (Q18)
```

Steps: 1 resolve (`root(cwd)`; branch = input or active; worktree from `worktrees(repo)` else `no-worktree`; main =
first existing of `mainBranches`; commit = `sha(worktree, "HEAD")`; tree); 2 `refusal`; 3 `numstat(main...commit)` →
`size`; 4 scope (L7); 5 checks (`runCheck` per command in the worktree, `checkTimeoutSec`; first failure →
`check` with `exit` and the output tail); 6 red run (non-plan, `redRun`: `worktreeAddDetached(tmp, base)`, run the
check, remove; exit 0 → `vacuous-check` in the review input); 7 approval for `(repo, branch, commit, tree)` → skip 8;
8 `runOverseer(merge)` (input S27; `!ok` → `error`/`review-unavailable`, main unchanged); not approved →
`rejections += 1`, then fixer rule (L6.T11) or `revise` with V3 lines; approved → `task-router/approval`; 9 re-check
the worktree `HEAD` = approved commit, then `ffMerge(W)` if main is checked out in W (W dirty → `main-dirty`) else
`updateRef(refs/heads/<main>, commit, old)`; `push` when on; `task-router/main-ref`; state `merged`; cleanup; 10
one `merge` line.

### S27 Merge review input (L6.T9; rendered by the router, no bodies beyond the diff)

```
Goal: <goal or plan section>
Summary from the author: <summary>
Check: `<cmd>` exit <n> (last 4 kB each)
Red run at base: <passed — the check may be vacuous | failed as expected | skipped>
Risky paths: <paths matching riskGlobs/pathRules critical, or none>
Invariants: <plan invariants or none>
Numstat:
<added>\t<deleted>\t<path>
Diff <base>..<commit> (≤ maxDiffLines lines):
<diff>
```

### S28 Fixer (L6.T11)

Ticket `{role: "fixer", member: fixerMember, model, effort: fixerEffort, cwd: worktree, childTools: [], toolGuard:
composeGuards(gitGuard, whitelistGuard?), briefAppend: cardBrief(card)}` with `card = {kind: "implement", files:
changed ∪ targetPath(finding targets), check, acceptance: blocking findings' `fix`, t0: all false, t2: []}`; force
applied (D47). Rule on a rejection: `fixerRuns ≥ fixerRounds ∧ fixerRuns > 0` → `blocked` (plan-bound: open
`remediation-failed`); else `rejections ≥ rejectionsBeforeFixer` → spawn fixer (`quiet: false`), `fixerRuns += 1`,
state `fixer`, status `fixer`; else `revise`. A route event fixer→main or the fixer's `kill`/`error` → state
`active`; the router kills it on its report (D46).

### S29 Plan core (`core/local/plan.ts`, L7.T1–T4)

```ts
export type Task = { id: string; goal: string; files: string[]; create?: string[]; forbidden: string[]; check: string;
  checkCounterexample?: string; dependsOn: string[]; vacuousCheck?: true };
export type Milestone = { id: string; goal: string; acceptance: string[]; branch: "milestone" | "task"; dependsOn: string[]; tasks: Task[] };
export type Skeleton = { invariants: string[]; milestones: Milestone[] };
export const SKELETON_SCHEMA: Schema = /* design §3.2.4, verbatim */;
export function validateSkeleton(x: unknown, s: RouterSettings, fs: { exists(p: string): boolean; isDir(p: string): boolean }): { ok: true; value: Skeleton } | { ok: false; reasons: string[] };
export const canonical = (x: unknown): string => JSON.stringify(sortKeys(x), null, 2);
export const skeletonHash = (sk: Skeleton) => createHash("sha256").update(canonical(sk)).digest("hex");
export function renderPlan(meta: { slug: string; request: string }, sk: Skeleton, ticks: ReadonlySet<string>): string;   // design §3.5.3
export function parsePlan(text: string): { sk: Skeleton; ticks: Set<string> } | undefined;   // from the <details> JSON; ticks from TICK lines
export const TICK = /^- \[( |x)\] (M\d+\.T\d+):/;
export function tickOnly(before: string, after: string): { ok: true; flipped: string[] } | { ok: false };  // [ ]→[x] only
export const TRIGGERS = ["non-whitelisted", "interface-break", "regression", "over-budget", "remediation-failed"] as const;
export type Trigger = { id: string /* t<n> */; kind: (typeof TRIGGERS)[number]; task?: string; open: boolean };
export type PlanRecord = { slug: string; file: string; skeletonHash: string; approvedBy: string; triggers: Trigger[] };
```

### S30 Log builders and contract rules (L4.T10–11, L6.T15–16, L7.T16)

```ts
// core/outcome.ts; KEYS += role member outcome blocking findings fallback inconsistent attempt durationMs commit
//                          branch ticket reason nLines nFiles reviewId pushed repo slug trigger nTasks full
reviewEvent({now, reviewId, role, member, model, outcome, attempt, durationMs, fallback?, findings?, blocking?, inconsistent?, commit?, branch?})
ticketSpawnEvent({now, name, role, member, model, effort, sessionId, parentSessionId})   // kind "overseer" | "implement", ticket role
mergeEvent({now, branch, outcome, reason?, commit?, nLines?, nFiles?, reviewId?, pushed?})
gatebypassEvent({now, branch, from, to, repo?})            // repo = basename (D35)
planEvent({now, slug, action, trigger?, nTasks?, reviewId?, full?})
```

Contract (`packages/token-meter/core/contract.ts`): event enum += `review merge plan gatebypass`; `review`: every
`{role: oneOf(ROLES), member: str, model: str, outcome: oneOf("approve","revise","invalid","timeout","error")}`,
optional `{blocking: int0, findings: int0, fallback: oneOf("budget","error"), inconsistent: bool, attempt: int1,
durationMs: int0, commit: sha, branch: str}`; spawn optional `ticket: oneOf(ROLES ∪ {"fixer"})`; `merge`: every
`{outcome: oneOf("merged","refused","revise","fixer","failed")}`, optional `{reason: oneOf(REASONS), commit: sha,
nLines: int0, nFiles: int0, reviewId: str, pushed: bool}`; `gatebypass`: every `{from: sha, to: sha}`, optional
`{repo: str}`; `plan`: every `{action: oneOf("skeleton","approve","trigger","amend","reject")}`, optional
`{trigger: oneOf(TRIGGERS), nTasks: int1, reviewId: str, full: bool}`. Enums are literals in the contract (P13 S9
convention); a router test asserts they equal the router's constants.

AC-L2 property helper (`test/text-free.ts`): every string value of a line is in an enum, matches
`/^[0-9a-f]{7,64}$/` (sha/hex id), or matches `/^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,99}$/` (id, branch, model ref);
generated inputs put spaces and fences into every free text, so no free text can pass.

## 14. Tasks

### L4 Actor spawn API and overseer

#### L4.T1 Patch: `api.spawn`, `api.kill`, `quiet` (AC-O7 spawn/kill) `[x] done`
- **Files**: `patches/pi-actor-subagents/pi-actor-subagents-spawn-api.patch` (new: `api.ts`, `spawner.ts`, `engine.ts`, `index.ts`, new `spawn-api.test.ts`), `packages/actor-subagents/package.nix` (third patch entry; passthru stays 1 until T3), `checks/actor-subagents/default.nix` (`test -f spawn-api.test.ts`; `grep -q` for `spawn: async` in `index.ts`).
- **Depends**: P13 done. **Read first**: the spawn-policy patch's `api.ts`/`spawner.ts` hunks and its `api.test.ts`/`spawn-policy.test.ts` fakes; upstream `engine.ts` (`kill`, `announce`, terminal-error notices); `index.ts` around `installApi`/`persistRoster`.
- **RED** (`$W`, §7; patch = test only): "spawn runs the policy": the policy records its args; `api.spawn({name: "ovs-merge-1", systemPrompt: "s", message: "m", task: {ticket: "t"}}, {by: "main", quiet: true})` → policy saw `task.ticket === "t"`, `caller.name === "main"`; result `{ok: true, name, sessionId}` with the created session's id. "reject": policy `{reject: "r"}` → `{ok: false, reason}` containing `r`; the name is free again. "kill": `api.kill(["ovs-merge-1"])` → `["ovs-merge-1"]`, absent from `list()`, kill event `by: "main"`. "quiet": a quiet child's terminal error routes no scheduler message to main; a non-quiet child's does. "v1 shape": `version === 1`; `makeApi` without `spawn`/`kill` deps has neither key. → `chk actor-subagents` FAILS.
- **GREEN**: S15 (`api.ts`, `spawner.ts` `quiet`/`sessionId`, `engine.ts` quiet, `index.ts` `installApi`).
- **Check**: `chk actor-subagents boundary leak`. **Keep green**: KG-A, KG-P (`pi-install-actor`). **ACs**: AC-O7 (spawn, kill).

#### L4.T2 Patch: `childTools`, `cwd`, async guard, roster (AC-O7 tools/cwd) `[x] done`
- **Files**: the patch (+ `child-tools.ts`, `child-tools.test.ts`; `tool-guard.ts`, `spawner.ts`, `index.ts`), `checks/actor-subagents/default.nix` (`test -f child-tools.test.ts`; `grep -q` for `cwd = cwdOf(spec)`, `.map(piTool)`, `persisted(engine.list())`).
- **Depends**: L4.T1.
- **RED**: "piTool": `execute` receives the input object itself (`===`); result mapping for every `isError`×`terminate` combination; "allowlist": `childToolAllowlist(["read"], [...orch, piTool(t)])` contains `t.name`; "spawner passes": a recording `createSession` gets `childTools`/`cwd` exactly when the decision has them (otherwise the spec deep-equals today's); "sessionCwd"; "async guard": `toolGuardExtensions(async () => "no")` handler resolves `{block: true, reason: "no"}`, the existing `tool-guard.test.ts` stays green; "roster": `persisted` drops quiet records (plant §11).
- **GREEN**: S15 rest; D23 (keep every hunk ≥ 4 lines away from the display-name setter; `chk boundary` proves it).
- **Check**: `chk actor-subagents boundary leak`. **Keep green**: KG-A, KG-P. **ACs**: AC-O7 (child tool callable with its input; cwd).

#### L4.T3 `spawnPolicyApi = 2` (AC-O7 module-eval) `[x] done`
- **Files**: `packages/actor-subagents/package.nix` (passthru 2; header "three local patches"), `checks/module-eval/cases/actor-subagents.nix` (l.99 `1` → `2`: an existing assertion changes because the build changes, design §4), `modules/actor-subagents.nix` (header; option text "(2: the spawn-api patch)"), `docs/pi-economics.md` (l.113).
- **Depends**: L4.T2. **RED**: the case at 2 → `chk module-eval` FAILS. **GREEN**: passthru 2.
- **Check**: `chk module-eval`. **Keep green**: KG-M (`task-router`'s `>= 1` assertion), KG-P. **ACs**: AC-O7 (module-eval).

#### L4.T4 Router API copy and `iface-policy-task-router` `[x] done`
- **Files**: `packages/task-router/core/api.ts` (S16), `core/toolguard.ts` (`Guard`, `SyncGuard` types), `checks/default.nix` (new `iface-policy-task-router`: provider `{src = ../packages/task-router; file = "core/api.ts"; type = "PolicyResult";}`, consumer = `subagentsProvider // {type = "PolicyResult";}`).
- **Depends**: L4.T2. **Parallel**: with L4.T3, L4.T5, L4.T6.
- **RED/plant**: add the check with today's copy (passes: optional fields), plant `cwd?: number` → FAIL seen; plant `kill?(…): Promise<number[]>` in the `SubagentsApiV1` copy → `iface-subagents-task-router` FAILS; then S16.
- **Check**: `chk iface-subagents-task-router iface-policy-task-router typecheck-task-router task-router`. **Keep green**: KG-A, KG-R.

#### L4.T5 Schema subset (`core/local/schema.ts`) `[x] done`
- **Files**: `core/local/schema.ts` (S17), `test/local-schema.test.ts`. **Depends**: — . **Parallel**: with L4.T1–T4.
- **RED**: property: a generator of values valid for a random schema (from the S17 subset) → `check = []`; each single mutation (drop a required key, add a key under `additionalProperties: false`, wrong type, string over `maxLength`, enum miss, pattern miss, array over `maxItems`/under `minItems`) → exactly one reason, prefixed with the mutated path.
- **GREEN**: S17. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R.

#### L4.T6 Verdict rules (AC-O2, AC-O3 pure) `[x] done`
- **Files**: `core/local/verdict.ts` (S18), `test/local-verdict.test.ts`. **Depends**: L4.T5.
- **RED**: `VERDICT_SCHEMA` deep-equals the design §3.2.3 JSON (literal in the test); "AC-O2" property over generated verdicts: `approve` ⇔ ∀ ¬blocking; `inconsistent` ⇔ (`APPROVE`) ≠ `approve`; V1: a fence in any string → `ok: false`; a repeated id → `duplicate id F<n>`; a target outside `targets` (after `targetPath`) and not a task id → reason; `targets` undefined/empty → no target reason; V3 pinned for one blocking and one non-blocking finding (trailing dots trimmed).
- **GREEN**: S18. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R. **ACs**: AC-O2, AC-O3 (pure).

#### L4.T7 Fake API extension, tickets, ticket policy (AC-O1 policy, AC-O6, AC-F6) `[x] done`
- **Files**: `test/fake-api.ts` (opt-in `fakeApi({ext: true})`: `api.spawn` runs the registered policy with caller `{name: opts.by ?? "main", cwd: "/work", …}`, records `apiSpawns: {args, opts, result}[]`, pushes an `AgentInfo` (status `idle`), emits `spawn` with `sessionId: "s-<name>"`; `api.kill` records `killed`, removes, emits `kill`; additive), `test/harness.ts` (`apiExt?: boolean`), `core/local/overseer.ts` (S19), `core/policy.ts` (first statement), `core/shell.ts` (`pd.tickets`), `test/local-ticket-policy.test.ts`.
- **Depends**: L4.T4. **Read first**: `test/fake-api.ts`, `core/policy.ts`, P13 S7 (force branch).
- **RED**: "AC-O1 policy": issue `{role: "merge", member: "opus", model, effort: "high", cwd: "/wt", tools: s.overseer.tools, childTools: [submit_verdict]}` → `a.spawn({name, task: {ticket}})` returns `tools` = `overseer.tools`, one `childTools` entry `submit_verdict`, `cwd: "/wt"`, `toolGuard` blocks `bash`, `edit`, `write`, `send_message`, `spawn_subagent` and allows `read`, `submit_verdict`; `meta = {taskId: reviewId, role: "merge"}`. "single use": same ticket again → card routing. "AC-O6": `{ticket: "forged"}` → result deep-equals the result for task `{}` (derived from the SUT). "AC-F6": settings force active → the ticket's model, no `forced`. "routing off" → ticket honoured. Default mode: P13 inventory test and `router-golden` green.
- **GREEN**: S19. **Check**: fast runner; `chk task-router typecheck-task-router router-golden`. **Keep green**: KG-R; every existing `fake-api` user (opt-in). **ACs**: AC-O1 (policy), AC-O6, AC-F6.

#### L4.T8 `runOverseer`: spawn, submit, resubmits, kill (AC-O3) `[x] done`
- **Files**: `core/local/overseer.ts` (`runOverseer`, one attempt), `test/local-overseer.test.ts`. **Depends**: L4.T6, L4.T7.
- **RED** (ext fake API, manual clock/sleep): "happy": one `api.spawn`, `task.ticket` 32 hex, opts `{by: "main", quiet: true}`, name `ovs-merge-1`; `childTools[0].execute(valid)` → `{text: "recorded", terminate: true}`; result `{ok: true, value, reviewId: /^rv-[0-9a-f]{8}$/}`; `killed` = `[name]`; one `task-router/review` entry. "AC-O3": fenced summary or duplicate id → `isError`, text `^invalid: `, still unresolved; property over `resubmits ∈ {0, 1, 2, 3}`: submissions 1…r invalid → `…; resubmit`, the (r+1)-th → `terminate`, attempt outcome `invalid` (D29).
- **GREEN**: S20 (single attempt). **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R. **ACs**: AC-O3.

#### L4.T9 Idle, timeout, failure, fallback, budget (AC-O4, AC-O5 run part) `[x] done`
- **Files**: `core/local/overseer.ts`, `test/local-overseer.test.ts`. **Depends**: L4.T8.
- **RED**: "reminder": `turn` event then status `idle` → one `api.send(name, "Submit with submit_verdict.", "router")`; a second busy→idle → attempt 2 on `fallbackMember`'s model. "timeout": no submit for `timeoutSec` → `killed`, outcome `timeout`, attempt 2. "kill/error event" → `error`. "spawn {ok: false}" → attempt 2. "both fail" → `{ok: false}`. "AC-O4": budget `{opusUsed: budget}` → the only spawn on `fallbackMember`/`fallbackEffort`, `fallback: "budget"`, `opusUsed` unchanged; property: k successful runs → `opusUsed = min(k, budget)`. "steer": `steerUsed = steerBudget` → `skipped`, no spawn; a failing steer → no attempt 2. "abort": aborted signal → `aborted`, no attempt 2.
- **GREEN**: S20 complete (D27, D28, D30). **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-O4 (run), AC-O5 (run part).

#### L4.T10 `review` and ticket `spawn` lines (AC-L2) `[x] done`
- **Files**: `core/outcome.ts` (S30 L4 part), `core/log.ts` (`review`, `ticketSpawn`), `core/shell.ts` (`onEvent`: `spawn` of `tickets.owner(name)` → `log.ticketSpawn`), `core/local/overseer.ts` (log calls), `test/review-log.test.ts`.
- **Depends**: L4.T9. **Parallel**: with L4.T11.
- **RED**: builder shapes; "AC-L2": `textFree` (S30) over review lines from generated verdicts; ticket spawn line `{kind: "overseer", ticket: "merge", workerTier, workerEffort, workerMember, workerModel, sessionId, parentSessionId}`; "ticket spawn: no unjudged line" after `kill` (plant §11), a card child still gets one.
- **GREEN**: S30. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R, P13 "default mode: outcome keys". **ACs**: AC-L2 (review).

#### L4.T11 Contract: `review`, spawn `ticket` (AC-L1) `[x] done`
- **Files**: `packages/token-meter/core/contract.ts`, `test/contract.test.ts`, `LOGS.md` (rows). **Depends**: P13 L3.T5.
- **RED**: a valid `review` passes; without `outcome` → `outcomes.outcome` problem (plant §11); `outcome: "x"` → problem; spawn `ticket: "merge"` passes, `"x"` fails; `analyse`: review lines raise no "task events without a spawn", overseer sessions are no "child sessions without a spawn event"; a router test asserts the contract's `ROLES` literal equals `Role`s.
- **GREEN**: S30 contract part. **Check**: `chk token-meter typecheck-token-meter`. **Keep green**: KG-L. **ACs**: AC-L1 (review).

#### L4.T12 Shell wiring: detection, budget entries, status (§3.0.4, §2.5) `[x] done`
- **Files**: `core/local/install.ts` (overseer instance; `task-router/budget` rebuild), `core/shell.ts` (warning; `onEvent` → `overseer.onEvent`), `core/local/mode.ts` (`statusText` + `opusLeft`), `test/local-overseer-shell.test.ts`.
- **Depends**: L4.T10.
- **RED**: "missing API extension": `{mode: "local"}` without ext → one `notify` with the §3.0.4 text, none on a second `session_start`, none in default mode. "budget persisted": two runs → entries `{opusUsed: 1, steerUsed: 0}`, `{opusUsed: 2, …}`; a harness rebuilt from them starts at 2. "status": `budget − opusUsed ≤ 3` → `local · opus 3 left` (Q19); otherwise P13's L1.T6 texts unchanged.
- **GREEN**: wiring. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R, P13 L1.T6.

#### L4.T13 Steer overseer from persistence (AC-H4) `[x] done`
- **Files**: `core/local/steer.ts` (new: `steerInput`, `createSteer`), `core/local/install.ts` (stage `steer`: `steer.available()` → `start`, no `ESCALATION` block; else L3 behaviour), `core/local/tripwires.ts` (`CallRecord.cmd?`, first 200 chars of a bash command), `test/local-steer.test.ts`.
- **Depends**: L4.T12.
- **RED**: "AC-H4": `{mode: "local"}`, `apiExt`: five identical `read` pairs → exactly one `api.spawn` (`ovs-steer-1`, ticket), the fifth result has no `ESCALATION`; hint line `stage: "steer"`; the child submits → one `f.sent` `{customType: "task-router/steer", …}` with `opts.deliverAs === "steer"`, content = `[router] steer (<trip>): <summary>` + V3 lines. "budget exhausted" (entries `steerUsed = steerBudget`) → `ESCALATION` block, no spawn. "failure" → `ESCALATION` as a steer message (D31). "`hints.steer: off`" → L3 behaviour. "one at a time": while a steer runs, a further escalation gets `ESCALATION`. `steerInput` pinned for a fixed record list (≤ 12 lines, no bodies). P13 "AC-H4 (L3)" unmodified (X30).
- **GREEN**: D31, D32. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R, P13 L3 tests. **ACs**: AC-H4.

#### L4.T14 `overseer.tools` must not write (P13 Q11) `[x] done`
- **Files**: `core/local/settings.ts`, `test/local-settings.test.ts`. **Depends**: — . **Parallel**: any L4 task.
- **RED**: `tools` containing `bash`, `edit` or `write` → `overseer.tools: <t> can write; default kept`; `["read", "search-ext"]` accepted. **GREEN**: one rule. **Check**: fast runner; `chk task-router`.

#### L4.T15 Third HM assertion (AC-R5) `[x] done`
- **Files**: `modules/task-router.nix` (beside the second assertion), `checks/module-eval/cases/task-router.nix` (`task-router-local-mode-needs-spawn-api`: `actorSubagents.package = actor.overrideAttrs (o: {passthru = (o.passthru or {}) // {spawnPolicyApi = 1;};})`, `failed` with the §2.1 message prefix).
- **Depends**: L4.T3. **RED**: the case first → FAILS. **GREEN**: `assertion = !cfg.localMode.enable || (actor.passthru.spawnPolicyApi or 0) >= 2`.
- **Check**: `chk module-eval`; alejandra. **Keep green**: KG-M (P13 positive case). **ACs**: AC-R5 (third).

#### L4.T16 log-contract over the review path `[x] done`
- **Files**: `checks/log-contract/contract.ts`. **Depends**: L4.T11, L4.T13.
- **RED/plant**: a local harness with `apiExt`, five identical pairs, the fake child submits → `review` and ticket `spawn` lines; `"review"` in the required events; plant (drop `log.review`) → red; remove. **Check**: `chk log-contract`. **Keep green**: KG-L.

#### L4.T17 Real host `pi-install-local` `[x] done`
- **Files**: `checks/pi-package/local.nix` (new; `lib.nix` `installed` with `before` writing `$PI_CODING_AGENT_DIR/task-router/settings.json` = `{"mode":"local"}`, the patched Actor, `probe.ts`), `checks/default.nix`.
- **Depends**: L4.T12. **RED/plant**: asserts `run.all` lacks `spawnPolicyApi ≥ 2` and `task_verdict` is in `tools`; plant (Actor without the new patch) → FAILS; restore.
- **Check**: `chk pi-install-local`. **Keep green**: KG-P.

#### L4.T18 Docs and milestone close `[x] done`
- **Files**: `docs/pi-economics.md` (actorSubagents: three patches, `spawn`/`kill`/`childTools`/`cwd`/`quiet`; taskRouter: overseer settings, budget, steer, `review` event, the warning, third assertion; Patched upstreams; Checks: `iface-policy-task-router`, `pi-install-local`), `README.md` l.16.
- **Depends**: L4.T1–T17. **Check**: `chk leak boundary`; sweep KG-R, KG-L, KG-M, KG-A, KG-P.

#### L4 review follow-up `[x] done`
The review of L4 (0425d3e..a3ac7c0) found F1–F5 and low items L1–L5, N1–N3. Fixed: F1 (fail closed without the
router's policy), F2 (LD13: a quiet agent answers only to the API and the user), F3 (a quiet child has no agent
preamble; the prompts say to start at once), F4 (a ticket no policy took is revoked), F5 (LD14: the overseer runs in
the main checkout; `RunArgs.worktree` names the tree under review; L6.T9/T11 pass it), L3 (quiet from the
reservation), L5 (the Opus pick holds its unit), N1 (docs: a failed steer sends the escalation as the steer
message). Open notes, for L6 or later:
- L1 `overseer.ts` attempt: any `error` event ends the attempt at once, a transient 429 that pi-retry would recover
  from included; the Opus unit is spent and the run falls back. Count an `error` only when the child is still idle
  after the actor's error grace (`errorNoticeGraceMs`).
- L2 `overseer.ts` attempt: `timeoutSec` starts after `api.spawn` resolves, and `a.spawn`/`a.kill` are unbounded;
  a hung session creation leaves `run` pending (a steer's `running` stays true for the session). Start the deadline
  before the spawn and race it.
- L4 Ticket spawns bypass member slots, health, blocks and the `dailyCap` counter (`shell.ts` counts only routed
  children); Opus overseer turns count toward no cap. Decide in L6 whether `overseer.budget` is the only cap.
  **Decided in L6 (orchestrator, L6 review fix):** `overseer.budget` is not the only cap. Ticket spawns (overseers, the
  merge review, the fixer) count toward their member's `dailyCap` (one per turn, as routed children; a forced fixer runs on
  another model and counts toward none) and hold its slots (pending 60 s or listed running), which routed spawns see too.
  The policy refuses a ticket spawn on a member at its cap or without a free slot; a review attempt then does not start
  (attempt 2 on the fallback member), and with no member left the review fails closed (`error` `review-unavailable`, the
  detail names the cap): the merge is refused. A fixer that cannot start answers `revise`. Health and blocks are still not
  probed for ticket spawns (a failed spawn fails closed).
- N2 Patch `child-tools.ts` `sessionCwd`: a relative policy `cwd` is accepted silently (the API says absolute;
  the router now refuses one before the spawn, LD14). Assert it or resolve it in the patch.
- N3 `core/local/settings.ts` `WRITERS` (bash, edit, write) is a denylist: a consumer's child-extension tool that
  writes passes the `overseer.tools` warning. Acceptable with the guard; the option text should say "read-only
  tools only".
- G6/G7 runbook step 1 (§12) on a real host: see the L4-fix report; until it is run, F3's effect on a real model
  is unproven.

### L5 Worktrees

#### L5.T1 Git in the check sandbox, runner, temp repository `[x] done`
- **Files**: `packages/task-router/package.nix` (`git` argument, `nativeCheckInputs = [git]`), `core/local/git.ts` (`gitRunner`, `createGit` with `root`/`top`), `test/git-repo.ts` (`tempRepo`, D55), `test/local-git.test.ts`.
- **Depends**: L4 done.
- **RED**: "root": `tempRepo()` → `root(dir) === realpath(dir)`; "timeout": `git hash-object --stdin` with no stdin end and 100 ms → `{timedOut: true, exit: 124}`; "missing binary": `gitRunner("git-nosuch")` → exit 127. `chk task-router` FAILS (exit 127) until `nativeCheckInputs` (plant §11).
- **GREEN**: S21 runner. **Check**: fast runner; `chk task-router typecheck-task-router leak`.

#### L5.T2 Names and parsers (pure) `[x] done`
- **Files**: `core/local/worktree.ts` (`SLUG`, `branchName`, `worktreeDir`, `inside`), `core/local/git.ts` (`parseWorktrees`, `parseNumstat`, `repoRootOf`), `test/local-worktree-names.test.ts`. **Parallel**: with L5.T1.
- **RED**: ∀ slug ∈ SLUG: `worktreeDir("../{repo}.worktrees", "/r/p/x", branchName("lm/", {slug}))` = `/r/p/x.worktrees/lm--<slug>` (D36); never inside `/r/p/x`; injective over valid slugs and plan units; porcelain fixtures (detached, bare, locked, prunable); numstat with binary (`-\t-\t`) and renames.
- **GREEN**: S21/S22 pure parts. **Check**: fast runner; `chk task-router typecheck-task-router`.

#### L5.T3 Git port for worktrees `[x] done`
- **Files**: `core/local/git.ts` (L5 methods of S21), `test/local-git.test.ts`. **Depends**: L5.T1, L5.T2.
- **RED** (temp repo): `worktreeAdd` → `worktrees()` lists dir+branch; `sha`, `branchOf` (branch, detached → undefined), `dirty`, `worktreeRemove`, `branchDelete`; a failing call → `{ok: false, err}` with `err.length ≤ 2048`.
- **GREEN**: S21. **Check**: fast runner; `chk task-router`.

#### L5.T4 Branch store and `fake-git` `[x] done`
- **Files**: `core/local/branches.ts` (S22 store), `test/fake-git.ts` (typed `Git`, scripted refs/worktrees/stats), `test/local-branch-store.test.ts`. **Depends**: L5.T2.
- **RED**: `put` appends one `task-router/branch` entry per change; `rebuild` from entries reproduces `all()` (property over random put sequences: last record per `(repo, branch)` wins); `active()` = D38.
- **GREEN**: S22. **Check**: fast runner; `chk task-router typecheck-task-router`.

#### L5.T5 `startBranch` (AC-W1) `[x] done`
- **Files**: `core/local/worktree.ts` (`startBranch(deps, input, cwd)`), `test/local-start-branch.test.ts`. **Depends**: L5.T3, L5.T4.
- **RED** (temp repo): "AC-W1": `{slug: "x", goal: "g", check: "true"}` → branch `lm/x` at the main tip, worktree `<parent>/repo.worktrees/lm--x` (realpath), result `{branch, worktree, base, check}`; again → same result, worktree and branch lists unchanged. Failure table, each leaving worktrees, branches and entries unchanged: slug and plan; neither; slug `X_y`; no goal; no check; cwd outside a repo; no main branch; `plan` (`plans are not active`, until L7); target dir exists as a file → `isError` with git's stderr tail.
- **GREEN**: §3.3.2. **Check**: fast runner; `chk task-router`. **ACs**: AC-W1.

#### L5.T6 `start_branch` tool, active set, section lines (AC-R3 active) `[x] done`
- **Files**: `core/local/install.ts` (register when `activeSet(s).worktrees`), `core/local/mode.ts` (`activeSet`), `core/prompt.ts` (`localSection(s, active)`, S25), `core/shell.ts`, `test/local-prompt.test.ts` (P13's "AC-R3 pinned text": input gains `worktrees/mergeGate/plans: {enabled: "off"}`, literal unchanged — X31), `test/local-start-branch.test.ts`.
- **Depends**: L5.T5.
- **RED**: tool registered in local mode, schema = §3.3.2; result text/`details` (D48); default mode: P13 inventory green (plant §11); "AC-R3 worktrees" pinned (`BRANCH_ONLY`); `mergeGate` off, worktrees on is what L5 ships.
- **GREEN**: S25 (L5 part). **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-R3 (worktrees line).

#### L5.T7 Main-checkout write guard (AC-W3) and `outside-worktree` `[x] done`
- **Files**: `core/local/worktree.ts` (`writeGuard`, S23), `core/local/install.ts` (main `tool_call` for `edit`/`write`; hint line), `core/local/tripwires.ts` (`TRIPS += "outside-worktree"`), `core/local/hints.ts` (its text: the block reason without the dir), `test/local-write-guard.test.ts`.
- **Depends**: L5.T6.
- **RED**: "AC-W3" (temp repo): active worktree; `edit {path: <main>/a.ts}` → `{block: true, reason: "write in the worktree <wt>; use absolute paths under it"}`; `edit <wt>/a.ts` → `undefined`; relative `a.ts` with `ctx.cwd = <main>` → blocked; no active worktree → `undefined`; each block → one `hint` line `trip: "outside-worktree"`. Property: blocked ⇔ tool ∈ {edit, write} ∧ inside(p, main) ∧ ∄w inside(p, w) (plant §11).
- **GREEN**: S23. **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-W3.

#### L5.T8 Contract: trip `outside-worktree` `[x] done`
- **Files**: token-meter `contract.ts` (TRIPS literal), `test/contract.test.ts`, `LOGS.md`. **Depends**: L5.T7.
- **RED**: a hint line with that trip passes (fails before). **Check**: `chk token-meter typecheck-token-meter log-contract`. **ACs**: AC-L1 (hint).

#### L5.T9 Default child cwd (LD2) `[x] done`
- **Files**: `core/policy.ts` (`cwd` default `d.local?.activeWorktree()` when `isLocal(s)`; `PolicyResult.cwd` when ≠ `caller.cwd`; `toolsFor(…, own = cwd)`), `core/shell.ts` (`pd.local`), `test/local-child-cwd.test.ts`. **Depends**: L5.T6.
- **RED**: local + active `/wt`: card without `cwd` → `cwd: "/wt"`, a `read-only+files` child with `files: ["src/a.ts"]` may `read {path: "src/a.ts"}` and is blocked on a foreign path; `card.cwd: "/other"` → `/other`; no active worktree → no `cwd` key; default mode → result keys ⊆ today's for every card of `test/policy.test.ts`'s fixtures (plant §11).
- **GREEN**: as above. **Check**: fast runner; `chk task-router typecheck-task-router router-golden`. **ACs**: §2.2 item 2.

#### L5.T10 Cleanup and abandoned branches (§3.3.4) `[x] done`
- **Files**: `core/local/worktree.ts` (`cleanupBranch`, `refreshAbandoned`), `core/local/install.ts` (`session_start`, before `start_branch`), `test/local-cleanup.test.ts`. **Depends**: L5.T5.
- **RED** (temp repo): `cleanupBranch` removes dir and branch; a dirty worktree → returns `cleanup failed: <tail>`, throws nothing, merge state untouched; the worktree dir deleted → `refreshAbandoned` sets `abandoned` + entry; `start_branch` of the same slug afterwards → `isError` (branch exists).
- **GREEN**: §3.3.4. **Check**: fast runner; `chk task-router`.

#### L5.T11 `check-failing` (AC-H1) `[x] done`
- **Files**: `core/local/tripwires.ts` (detector; input `checks: string[]`), `core/local/install.ts` (active branch check; a passing check = progress), `test/local-tripwires.test.ts`. **Depends**: L5.T6.
- **RED**: property over random bash sequences (the check with whitespace variants, other commands, pass/fail) vs a reference counter: fires exactly at the `checkFailures`-th consecutive failing check run (D41); a pass resets; P13 S11 text delivered.
- **GREEN**: D41. **Check**: fast runner; `chk task-router`. **ACs**: AC-H1 (check-failing).

#### L5.T12 `over-size` (AC-H1) `[x] done`
- **Files**: `core/local/tripwires.ts` (pure `overSize(stat, s)`), `core/local/git.ts` (`diffStat` + untracked, D42), `core/local/install.ts` (after a write in the active worktree; 5 s timeout → skip), `test/local-tripwires.test.ts`, `test/local-git.test.ts`. **Depends**: L5.T11.
- **RED**: property: fires iff lines > `splitLines` ∨ files > `splitFiles`, not one line earlier; temp repo: an untracked 101-line file trips; a timed-out `diffStat` → no trip, no throw.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-H1 (over-size).

#### L5.T13 Steer input: diff, goal, check `[x] done`
- **Files**: `core/local/steer.ts`, `test/local-steer.test.ts`. **Depends**: L5.T12.
- **RED**: with an active branch, `steerInput` gains `Goal:`, `Check:` and `Diff (≤ 80 lines):` (pinned on fake-git output); targets add the branch's changed files (D33). **Check**: fast runner.

#### L5.T14 Package check, docs, close `[x] done`
- **Files**: `checks/pi-package/local.nix` (`start_branch` in `tools`), `docs/pi-economics.md` (worktrees settings, `start_branch`, write guard, child cwd, `outside-worktree`, trips). **Check**: `chk pi-install-local leak boundary`; sweep KG-R, KG-L, KG-M, KG-P.

### L6 Merge gate

#### L6.T1 Shell segments (`gitcmd`) `[x] done`
- **Files**: `core/local/gitcmd.ts` (`segments`, `gitCalls`, `gitDirs`), `test/local-gitcmd.test.ts`. **Depends**: L5 done.
- **RED**: table: quoting (`'a;b'`, `"a&&b"`), every operator, `$(git …)`, backticks, `bash -c 'cd x && git …'` (depth 2 recursed, depth 3 → unknown), `VAR=1 env nice git …`, `cd /a && git -C b …` → dir `/a/b`, `cd $X && git …` → dir undefined, `--git-dir=…` → undefined; unbalanced quote throws.
- **GREEN**: S24 parsing. **Check**: fast runner; `chk task-router typecheck-task-router`.

#### L6.T2 Classifier rules and corpus (AC-M1) `[x] done`
- **Files**: `core/local/gitcmd.ts` (`classify`, `safeClassify`), `test/local-gitcmd.test.ts`. **Depends**: L6.T1.
- **RED**: block corpus generated = {push origin main, push origin HEAD:main, push origin +x:refs/heads/main, push --all, push --mirror, push --delete origin main, push (on main), merge x, pull, rebase x, cherry-pick c, revert c, am p, commit -m x, reset --hard x, branch -f main x, branch -D main, checkout -B main, switch -C main, update-ref refs/heads/main x, filter-branch …} × {direct (cwd on main), `-C <main dir>`, `cd <main dir> &&`, `bash -c '…'`, `echo $(…)`} (≥ 40); allow corpus = the same subcommands on `lm/x`, plus status/log/diff/show/fetch/`push origin lm/x`/`branch -d lm/x` and non-git commands (≥ 40). Every corpus block reason = `MERGE_REASON(main)` (X25); unknown dir → `UNKNOWN_DIR`; `safeClassify` of a throwing input: with `git` → `UNCLASSIFIED`, without → allow.
- **GREEN**: S24 rules. **Check**: fast runner; `chk task-router`. **ACs**: AC-M1.

#### L6.T3 Main bash guard (AC-N3 bash) `[x] done`
- **Files**: `core/local/install.ts` (`tool_call` for `bash`/`powershell` when `activeSet(s).mergeGate`: `gitDirs` → `branchOf` (2 s; timeout = `"unknown"`) → `safeClassify`), `test/local-git-guard.test.ts`. **Depends**: L6.T2.
- **RED**: local, fake-git main on `main`: `git push origin main` → `{block: true, reason}` naming `request_merge`; `git push origin lm/x` → `undefined`; `branchOf` timeout → `UNKNOWN_DIR` for `commit`; "AC-N3 default mode push": `{}` → `undefined` and no extra hook (plant §11); `{mergeGate: {enabled: "on"}}` in default mode → blocked (OQ11).
- **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-N3 (bash), §3.4.5 main wiring.

#### L6.T4 Child git guard, async `composeGuards` (AC-M7) `[x] done`
- **Files**: `core/toolguard.ts` (`composeGuards` async-aware, D44), `core/local/childguards.ts` (new: git guard for children), `core/policy.ts` (compose for routed children in local mode), `test/compose.test.ts` (new cases only), `test/local-git-guard.test.ts`. **Depends**: L6.T3.
- **RED**: "AC-M7": a child spawned in local mode, `toolGuard("bash", {command: "git -C <wt> push origin HEAD:main"})` resolves to a reason naming `request_merge`; its `read` stays allowed; a `read-only+files` child keeps its files block (plant §11); P13 `compose.test.ts` cases green (sync results stay sync); property: async composition = first non-undefined in order.
- **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-M7.

#### L6.T5 Git port for merging `[x] done`
- **Files**: `core/local/git.ts` (L6 methods), `test/local-git.test.ts`. **Depends**: L5.T3. **Parallel**: with L6.T1–T4.
- **RED** (temp repo): `isAncestor`; `numstat(main...x)` equals the branch's own changes after main moved; `tree`; `worktreeAddDetached` + remove; `ffMerge` (fails on diverged); `updateRef` with a wrong `prev` fails; `push` to a local bare remote.
- **Check**: fast runner; `chk task-router`.

#### L6.T6 Pipeline steps 1–3 (AC-M2 part) `[x] done`
- **Files**: `core/local/merge.ts` (`resolve`, `refusal`, `oversize`, `reasonText`), `test/local-merge-refuse.test.ts`. **Depends**: L6.T5.
- **RED**: `refusal` table over all `Facts` (order fixed, S26); "AC-M2 <code>" in a temp repo with a counting fake overseer for `main-branch`, `dirty`, `behind`, `abandoned`, `blocked`, `fixer-running` (state set in the store), `size` (151 lines, then 7 files), `no-worktree`: each → `status: "refused"`, that reason, 0 overseer calls, main sha unchanged; texts pinned.
- **GREEN**: S26 steps 1–3. **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-M2 (steps 2–3).

#### L6.T7 Step 5 checks (AC-M2 `check`) `[x] done`
- **Files**: `core/local/merge.ts`, `test/local-merge-refuse.test.ts`. **Depends**: L6.T6.
- **RED**: branch check `false` → `check`, detail has `exit 1` and the tail; `extraChecks: ["true", "exit 3"]` → `check` on the second; passing checks reach step 6; checks run with `cwd` = worktree (a check `test -f only-in-branch`).
- **Check**: fast runner; `chk task-router`. **ACs**: AC-M2 (check).

#### L6.T8 Step 6 red run `[x] done`
- **Files**: `core/local/merge.ts`, `test/local-merge-redrun.test.ts`. **Depends**: L6.T7.
- **RED**: check passes at base → the review input says `passed — the check may be vacuous`; fails at base → `failed as expected`; `redRun: false` → `skipped`, no temp worktree; the temp worktree is gone afterwards (also after a check timeout).
- **Check**: fast runner; `chk task-router`.

#### L6.T9 Steps 7–8: approvals and the merge review (AC-M4, AC-O1) `[x] done`
- **Files**: `core/local/merge.ts` (`Approvals` + `task-router/approval`, review input S27, targets = numstat paths), `test/local-merge-review.test.ts`. **Depends**: L6.T8, L4 done.
- **RED**: "AC-O1": `request_merge` on a valid branch → exactly one `api.spawn` with `task.ticket`, ticket policy `cwd` = worktree, `childTools` `submit_verdict`. "AC-M4": approve c1 (fake child submits APPROVE) with merge stubbed off, commit c2, request → second review (spawn count 2), c1's approval unused; request again at c2 → no spawn (reuse); approvals rebuilt from entries in a new harness. Not approved → `revise` with V3 lines, `rejections` 1.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-O1, AC-M4.

#### L6.T10 Step 9: fast-forward, push, main-ref, cleanup (AC-M3) `[x] done`
- **Files**: `core/local/merge.ts`, `test/local-merge-ff.test.ts`. **Depends**: L6.T9.
- **RED** (temp repo): "AC-M3": approved → main tip = reviewed commit (both: main checked out in W → `ff-only`; main not checked out → `update-ref`), state `merged`, `task-router/main-ref` entry, worktree and branch removed (`removeAfterMerge`); W dirty → `main-dirty`, main unchanged; `push: true` with a bare remote → `pushed: true`; HEAD moved after approval → re-review, not a merge.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-M3.

#### L6.T11 Fixer (AC-M5) `[x] done`
- **Files**: `core/local/merge.ts` (S28), `core/local/overseer.ts` (fixer ticket; force, D47), `core/local/worktree.ts` (fixer write block), `test/local-fixer.test.ts`. **Depends**: L6.T10.
- **RED**: "AC-M5": second rejection → one `api.spawn` with the `fixerMember` model, `fixerEffort`, `cwd` = worktree, opts `quiet: false`, card brief listing the fix criteria; `request_merge` → `fixer-running`; main `edit` in that worktree → `a fixer owns this branch`; route fixer→main → state `active`, fixer killed; next rejection with `fixerRounds` 1 → `blocked`; then `request_merge` → `refused`/`blocked`; with a settings force the fixer spawn is forced (`forced: true`).
- **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-M5.

#### L6.T12 Review failure, budget, missing API (AC-O5, AC-O4) `[x] done`
- **Files**: `core/local/merge.ts`, `test/local-merge-review.test.ts`. **Depends**: L6.T9.
- **RED**: "AC-O5": `api.spawn` `{ok: false}` twice → `status: "error"`, `reason: "review-unavailable"`, detail `error: review unavailable`, main sha unchanged; "AC-O4": `opusUsed = budget` → the merge review spawns on `fallbackMember`, review line `fallback: "budget"`; no API extension → `review-unavailable` without spawning (fail closed).
- **Check**: fast runner; `chk task-router`. **ACs**: AC-O5, AC-O4 (merge).

#### L6.T13 `request_merge` tool, rendering, abort, section `[x] done`
- **Files**: `core/local/install.ts` (register when `activeSet(s).mergeGate`; `execute(id, params, signal)` → D49), `core/prompt.ts` (`BRANCH_FULL`, `GATE_ONLY`), `test/local-prompt.test.ts`, `test/local-merge-tool.test.ts`. **Depends**: L6.T11, L6.T12.
- **RED**: schema = §3.4.1; `details` = `MergeResult`, text = `status: <s> (<reason>)\n<detail>` + findings lines; `isError` only for `error`; abort mid-review → overseer killed, `aborted`; "AC-R3 worktrees+mergeGate" pinned (`BRANCH_FULL`), "mergeGate only" pinned (`GATE_ONLY`); default mode inventory green.
- **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-R3 (gate lines).

#### L6.T14 Bypass detection (AC-M6) `[x] done`
- **Files**: `core/local/merge.ts` (`MainRefs`, `checkBypass`), `core/local/install.ts` (after main `bash` results; on child `turn` events, queued for the next main `tool_result` per P13 D17), `test/local-bypass.test.ts`. **Depends**: L6.T10.
- **RED**: "AC-M6" (temp repo): `git update-ref refs/heads/main <other>` outside the gate, then a `bash` result → one `gatebypass` line (`from`, `to`, `repo` basename), one `notify(…, "warning")` (`task-router: main moved outside the gate (<repo> <main> <from7>→<to7>)`), a `<router-hint trip="gatebypass">` block, record updated (a second result → nothing); first sight of a repo records silently; a merge through the gate → no line.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-M6.

#### L6.T15 `merge`/`gatebypass` builders (AC-L2) `[x] done`
- **Files**: `core/outcome.ts`, `core/log.ts`, `test/merge-log.test.ts`. **Depends**: L6.T13. **Parallel**: with L6.T16.
- **RED**: shapes; one `merge` line per `request_merge` call (every status); `textFree` over lines from generated branches/details. **Check**: fast runner; `chk task-router`. **ACs**: AC-L2 (merge, gatebypass).

#### L6.T16 Contract `merge`/`gatebypass` (AC-L1) `[x] done`
- **Files**: token-meter `contract.ts`, tests, `LOGS.md`. **RED**: valid lines pass; `reason: "nope"` fails (plant §11); `gatebypass` without `to` fails; enums equal the router's (`REASONS`). **Check**: `chk token-meter typecheck-token-meter`. **ACs**: AC-L1.

#### L6.T17 log-contract real path `[x] done`
- **Files**: `checks/log-contract/contract.ts` (fake-git harness: one merged and one refused request, one bypass). **Depends**: L6.T15, L6.T16. **RED/plant**: required events += `merge`, `gatebypass`; drop `log.merge` → red. **Check**: `chk log-contract`.

#### L6.T18 Package check, docs, close `[x] done`
- **Files**: `checks/pi-package/local.nix` (`request_merge` in `tools`), `docs/pi-economics.md` (merge gate: settings, pipeline, refusal codes, fixer, guard, bypass, events). **Check**: `chk pi-install-local leak boundary`; sweep KG-R, KG-L, KG-M, KG-A, KG-P.

#### L6 deviations
- T8: the red run's base is main's tip at the request (the commit the branch merges onto), not the record's `base`.
- T9: the merge overseer's cwd is the main checkout, `RunArgs.worktree` the worktree (LD14 supersedes "ticket cwd = worktree").
- T14: the refs are read off the event (as over-size, D17): the `gatebypass` line and the warning come when the read ends,
  the hint block on the next main tool result, not on the `bash` result itself (an awaited `tool_result` handler would hold
  every bash result on git). T14 adds `gatebypassEvent`/`log.gatebypass`, T15 the `merge` builder.
- T15/T16: one `merge` line per call includes a `no-worktree` refusal before any branch is known: `taskId: ""`, which the
  contract accepts on `merge` as on `force`. The `REASONS` equality is in `checks/log-contract/contract.ts`, next to ROLES.
- Review fixes (L6 merge-gate review, branch `local-mode/L6-fix`; one commit each, every new test seen red):
  - F1: `gitcmd.ts` keeps the words after `--` as positionals (except `checkout`/`restore`/`reset` paths); push and fetch
    destinations match a main in every spelling (`main`, `heads/main`, `refs/heads/main`, `+main`, `:main`, `X:heads/main`,
    `*`); a computed fetch/pull refspec is unclassified. The F1 forms × the five contexts are in the AC-M1 deny corpus.
  - F6: `worktree add -b|-B <main>`, `symbolic-ref` of a main, aliases and unknown subcommands (`UNKNOWN_SUB`), `-c
    remote.*.fetch|push|mirror` and config writes of them fail closed. A `git` token the parser cannot attribute to an
    analysed git call (`function f {…}`, `coproc`, `watch`, `parallel`, `find -exec`, `nix develop -c`, a
    `sh -c`/`eval` string it cannot read, heredoc bodies, a computed command name) makes the command unclassified (LD8:
    only commands that contain git); wrappers it knows (`env`, `sudo`, `xargs`, `nohup`, …) and readable `-c`/`eval` strings are analysed. The allow corpus is unchanged and green.
  - F2: `session_start` (merge gate on) and `start_branch` read the main refs once, so a move in the first bash call is a bypass.
  - F3: step 9 (ref move, push, `task-router/main-ref`) runs on the bypass chain (`exclusive`): a concurrent check sees
    the old tip or the recorded new one, never the gate's own move as a bypass.
  - F4/F5: a fixer named by a branch record but not spawned by this process (a restored one) is killed on sight (at
    `session_start` and on its first event), with a warning; a branch in state `fixer` whose fixer is gone or not ours
    is `active` again (at start, and in request_merge). A fixer report or death before its record (spawn race) is kept
    and applied. No actor patch change: restored routed children (spawn_subagent) still run unguarded (open, below).
  - F7: the branch `check` passes the git classifier (cwd the worktree) in `start_branch` and before step 5 runs it;
    a check that could move main is refused (`check`, "was not run"). `extraChecks` are settings, not vetted.
  - F8: `branches.update` keeps a record's place; a rejected record-less branch gets a `handmade` record that is never
    active and never cleaned up; rejections and fixer reports do not change the active branch; start_branch adopts it.
  - F9: the review's diff budget is 8 × (`maxDiffLines` + `maxDiffFiles`) lines (never below what step 3 lets through);
    a longer diff, or none while the numstat has changes, fails the review closed. The review input header shows the budget.
  - F10: the `merge` line's `taskId` is the branch only when it is a branch name (`git check-ref-format --branch` rules),
    else `""`.
  - F11: Esc kills a running check or red run (`Runner` takes the signal; exit 130) and answers `aborted`;
    `mergeGate.fixerRounds` may be 0 (no fixer: every rejection answers `revise`).
  - Caps (the L4 note, decided by the orchestrator): ticket spawns count toward `dailyCap` and hold member slots; a
    capped or full member refuses the spawn; with no member left the review fails closed and the merge is refused
    (see the L4 note above). A failed review's detail now names the spawn refusal (`error: review unavailable: <why>`).
- Open: the actor restores routed children (spawn_subagent) without their policy (no toolGuard, no cwd); only the fixer
  is handled (killed). Re-running the spawn policy on restore needs an actor change beyond the spawn-API patch.

### L7 Plans

#### L7.T1 Skeleton schema and validation (AC-P2) `[ ] todo`
- **Files**: `core/local/plan.ts` (`SKELETON_SCHEMA`, `validateSkeleton`), `test/local-plan.test.ts`. **Depends**: L4.T5.
- **RED**: schema deep-equals design §3.2.4; "AC-P2 <rule>" one counterexample per rule (duplicate id; `dependsOn` naming a later id; a cycle; `files ∪ create` > `splitFiles`; a missing file; a `create` that exists; a `create` without parent dir; > `milestoneTasks`; empty check) → `ok: false` naming the rule; generated valid skeletons → `ok`.
- **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-P2 (pure).

#### L7.T2 Canonical JSON, hash, render, parse (AC-P4) `[ ] todo`
- **Files**: `core/local/plan.ts`, `test/local-plan.test.ts`. **Depends**: L7.T1.
- **RED**: "AC-P4" property over generated skeletons and tick sets: `parsePlan(renderPlan(m, sk, t))` = `{sk, ticks: t}`; `skeletonHash` invariant under key order and re-render; one rendered file pinned (design §3.5.3 layout).
- **Check**: fast runner. **ACs**: AC-P4.

#### L7.T3 Ticks and tick-only diff (AC-P5 pure) `[ ] todo`
- **Files**: `core/local/plan.ts` (`TICK`, `tickOnly`), `test/local-plan.test.ts`. **Parallel**: with L7.T2.
- **RED**: property: flipping any subset of `[ ]` task lines → `ok` with exactly those ids; any other line change, `[x]`→`[ ]` (plant §11), or an added line → `ok: false`. **Check**: fast runner.

#### L7.T4 Plan store and triggers `[ ] todo`
- **Files**: `core/local/plans.ts` (store: `PlanRecord`, `open(slug, kind, task?)` → `t<n>`, `close`, merged-task set from branch records), `test/local-triggers.test.ts`. **Depends**: L7.T2.
- **RED**: entries round-trip (rebuild); trigger ids sequential per plan; `open` of an already-open (kind, task) returns the same id.
- **Check**: fast runner; `chk task-router typecheck-task-router`.

#### L7.T5 Git port for plans `[ ] todo`
- **Files**: `core/local/git.ts` (`grepWord`, `lsFiles`, `commitFile` D50), `test/local-git.test.ts`. **Parallel**: with L7.T1–T4.
- **RED** (temp repo): `grepWord` whole-word (`foo` ∉ `foobar`); `lsFiles(n)` capped; `commitFile` → a commit whose parent is the tip, whose tree differs only in that path, main checkout's index and files untouched.
- **Check**: fast runner; `chk task-router`.

#### L7.T6 `plan_request` grounding (AC-P1) `[ ] todo`
- **Files**: `core/local/planflow.ts` (`planRequest` step 1, D51), `test/local-plan-request.test.ts`. **Depends**: L7.T4, L7.T5.
- **RED**: "AC-P1": a missing file and an absent symbol → refused, detail lists both misses, 0 spawns; a used slug → refused; a dirty main checkout → refused before authoring.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-P1.

#### L7.T7 Plan author and red runs (AC-P3) `[ ] todo`
- **Files**: `core/local/planflow.ts` (step 2–3: `runOverseer("plan-author")` with `submit_plan`; `check` = validate + red runs in a detached temp worktree at the main tip), `test/local-plan-request.test.ts`. **Depends**: L7.T6.
- **RED**: "AC-P3": a task check `true` → the author's `execute` gets `isError` with a `check` finding targeting the task id; after `plans.rounds` such rounds → accepted, `vacuousCheck: true` recorded; a check exiting 127 after `rounds` → `plan_request` fails (D52); validation errors count toward `rounds`.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-P3.

#### L7.T8 Render, commit on main, record, return (LD10) `[ ] todo`
- **Files**: `core/local/planflow.ts` (steps 4–5), `test/local-plan-request.test.ts`. **Depends**: L7.T7, L6.T10 (ff path).
- **RED** (temp repo): approved skeleton → `plans.dir/<slug>.md` on main in one commit `plan(<slug>): approved <reviewId>`, main checkout fast-forwarded (or ref updated), `task-router/plan` + `main-ref` entries; result names the path, the first startable unit and `start_branch {plan: {slug, id}}`; no `gatebypass` afterwards.
- **Check**: fast runner; `chk task-router`.

#### L7.T9 Plan-bound `start_branch` (AC-W2) `[ ] todo`
- **Files**: `core/local/worktree.ts`, `test/local-plan-branch.test.ts`. **Depends**: L7.T8.
- **RED**: "AC-W2": missing plan, an unmet dependency, a changed skeleton hash (file edited by bash), a task id in a `milestone`-branch milestone → refused, repository unchanged; valid → branch `lm/<slug>/<id>`, result `files` = whitelist and the check(s).
- **Check**: fast runner; `chk task-router`. **ACs**: AC-W2.

#### L7.T10 Plan guard, main and children (AC-P5) `[ ] todo`
- **Files**: `core/local/planguard.ts` (new: simulate `edit` (`edits[]` or `oldText`/`newText`, G9) / `write`, then `tickOnly`), `core/local/install.ts`, `core/local/childguards.ts`, `test/local-plan-guard.test.ts`. **Depends**: L7.T9, L6.T4.
- **RED**: "AC-P5": an `edit` flipping `[ ]`→`[x]` on a task line → allowed; any other change, an unappliable `edit`, a `write` of other content → `change the plan with amend_plan`; the same through a child's guard.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-P5.

#### L7.T11 Whitelist guard (AC-P7) `[ ] todo`
- **Files**: `core/local/planguard.ts` (`whitelistGuard`), `core/local/install.ts`, `core/local/childguards.ts`, `test/local-plan-guard.test.ts`. **Depends**: L7.T10.
- **RED**: "AC-P7": in a plan-bound worktree, a write outside `files ∪ create` (and not the plan file) → blocked with `<path> is outside the task's files; finish within them or call amend_plan (trigger <id> is open)` and opens `non-whitelisted`; inside → allowed; a child of that branch likewise.
- **Check**: fast runner. **ACs**: AC-P7.

#### L7.T12 Merge for plan-bound branches (AC-M2 `scope`) `[ ] todo`
- **Files**: `core/local/merge.ts` (step 3 tick-only exclusion + `over-budget`; step 4 scope; `plan-changed`; step 5 task/milestone checks + regression per `plans.regression`; goal from the plan), `test/local-merge-plan.test.ts`. **Depends**: L7.T11.
- **RED**: "AC-M2 scope": a changed file outside the whitelist → `scope`, `non-whitelisted` open; a non-tick plan change → `scope`; skeleton hash changed → `plan-changed`; a tick-only plan change does not count toward size; size over `splitLines` → `size` + `over-budget`; an earlier task's check failing → `check` + `regression`; `regression: "off"` → not run.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-M2 (scope).

#### L7.T13 `over-budget` turns and `remediation-failed` `[ ] todo`
- **Files**: `core/local/install.ts` (`turn_end` count, D54), `core/local/merge.ts` (fixer exhaustion), `test/local-triggers.test.ts`. **Depends**: L7.T12.
- **RED**: `taskTurns + 1` counted turns → `over-budget` open; turns without worktree calls not counted; a plan-bound `blocked` → `remediation-failed` open and the result text names `amend_plan`.
- **Check**: fast runner.

#### L7.T14 `amend_plan`: trigger, evidence, validation (AC-P6 trigger/evidence) `[ ] todo`
- **Files**: `core/local/planflow.ts` (`amendPlan` steps 1–2), `test/local-amend.test.ts`. **Depends**: L7.T13.
- **RED**: "AC-P6 trigger": no open trigger → `no replan trigger is open; finish the task as planned`; "AC-P6 evidence": `{id: "new", kind: "interface-break", evidenceCommand: "false"}` → accepted, `"true"` → refused; validation errors; a change to a checked task → refused.
- **Check**: fast runner. **ACs**: AC-P6 (part).

#### L7.T15 `amend_plan`: review kind, apply, rounds (AC-P6 review kind) `[ ] todo`
- **Files**: `core/local/planflow.ts` (steps 3–5), `test/local-amend.test.ts`. **Depends**: L7.T14.
- **RED**: "AC-P6 review kind": a task touching `publicApiGlobs` → `plan-review`, `interface-break` → `plan-review`, a milestone added → `plan-review`, else `delta`; approved → re-rendered with unchanged ticks kept, committed on main, trigger closed; rejected → findings; "rounds exhausted" → `plan-author` writes the amendment, applied without review.
- **Check**: fast runner; `chk task-router`. **ACs**: AC-P6.

#### L7.T16 `plan` lines, contract, log-contract (AC-L1, AC-L2) `[ ] todo`
- **Files**: `core/outcome.ts`, `core/log.ts`, `test/plan-log.test.ts`, token-meter `contract.ts`/tests/`LOGS.md`, `checks/log-contract/contract.ts`. **Depends**: L7.T15.
- **RED**: shapes and `textFree`; contract accepts each `action`, rejects `trigger: "x"`; log-contract required `plan` (plant §11).
- **Check**: fast runner; `chk task-router token-meter typecheck-token-meter log-contract`. **ACs**: AC-L1, AC-L2 (plan).

#### L7.T17 Tools, prerequisites, section plans line `[ ] todo`
- **Files**: `core/local/install.ts` (`plan_request`, `amend_plan` when `activeSet(s).plans`; `submit_plan` is a child tool only), `core/local/settings.ts` (problem `plans: needs worktrees and mergeGate; off`, D40), `core/prompt.ts` (`PLANS`), tests. **Depends**: L7.T16.
- **RED**: "AC-R3 all" pinned (`BRANCH_FULL` + `PLANS`); `plans: on` with `mergeGate: off` → problem, no plan tools; default mode inventory green.
- **Check**: fast runner; `chk task-router typecheck-task-router`. **ACs**: AC-R3 (plans line).

#### L7.T18 Package check, docs, close `[ ] todo`
- **Files**: `checks/pi-package/local.nix` (`plan_request`, `amend_plan`), `docs/pi-economics.md` (plans). **Check**: `chk pi-install-local leak boundary`; sweep KG-R, KG-L, KG-M, KG-A, KG-P.

### L8 Close-out

#### L8.T1 Module contract complete `[ ] todo`
- **Files**: `docs/pi-economics.md` (taskRouter: one local-mode subsection — switch, components and `activeSet`, settings table for every §3.0.1 key with default and unit, tools `start_branch`/`request_merge`/`plan_request`/`amend_plan`, `/force`, session entries, events, failure modes; actorSubagents and Patched upstreams consistent). **Check**: `chk leak boundary`.

#### L8.T2 `LOGS.md` examples, verified (D58) `[ ] todo`
- **Files**: `packages/token-meter/LOGS.md` (one example line per new event: `force`, `hint`, `review`, `merge`, `gatebypass`, `plan`, ticket `spawn`, in one fenced `jsonl` block under a fixed heading), `packages/token-meter/test/logs-examples.test.ts`.
- **RED**: the test extracts the block's lines and runs them through the contract: before the examples exist it fails (block missing); plant (a `review` example without `outcome`) → FAIL seen. **Check**: `chk token-meter`.

#### L8.T3 Design wording fixes `[ ] todo`
- **Files**: `docs/local-mode/design.md` (P13 X1, X3, X10 and X15, X20, X22–X26, X29: wording only; AC-M1 scope; §3.0.2 branch entry fields; §3.4.1 `details`). **Check**: `chk leak boundary`.

#### L8.T4 README `[ ] todo`
- **Files**: `README.md` ("Without Nix" prerequisites row: local mode needs the spawn-api patch; component table). **Check**: `chk module-eval` (`readme-package` case), `chk leak boundary`.

#### L8.T5 Final sweep and manual runbook `[ ] todo`
- Every check (AGENTS.md loop); §12 runbook steps 1–4; record results in the task's status line. Optional (OQ17): `pi-analyse` sections for hints, reviews, merges — a separate plan (Q20).

## 15. Order and parallelism

```
L4: T1 ── T2 ─┬─ T3 ── T15
              └─ T4 ── T7 ─┐
    T5 ── T6 ──────────────┴─ T8 ── T9 ── T10 ── T12 ── T13 ── T16 (needs T11) ── T17 ── T18
    T11 (after T10's enums; any time) · T14 (any time)
L5: {T1 ∥ T2} ── T3 ── T5 ── T6 ── T7 ── T8
                 T4 ──┘          ├─ T9
                                 ├─ T10 (after T5)
                                 └─ T11 ── T12 ── T13 ── T14
L6: T1 ── T2 ── T3 ── T4          T5 (∥ T1–T4) ── T6 ── T7 ── T8 ── T9 ─┬─ T10 ── T11 ─┬─ T13 ── T15 ── T17 ── T18
                                                                       └─ T12 ─────────┘   T14 (after T10)   T16 ∥ T15
L7: T1 ── {T2 ∥ T3} ── T4 ── T6 ── T7 ── T8 ── T9 ── T10 ── T11 ── T12 ── T13 ── T14 ── T15 ── T16 ── T17 ── T18
    T5 ∥ T1–T4
L8: T1 ∥ T2 ∥ T3 ∥ T4 ── T5
```

Shared files (strictly sequential tasks): `core/local/install.ts` (L4.T12–13, L5.T6–7, T9–T12, L6.T3, T13–14,
L7.T10–11, T13, T17); `core/policy.ts` (L4.T7, L5.T9, L6.T4); `core/local/merge.ts` (L6.T6–T14, L7.T12–13);
`core/local/git.ts` (L5.T1–3, T12, L6.T5, L7.T5); the patch (L4.T1–T2, one work tree). Parallel groups are
file-disjoint: L4 {T5/T6 `schema.ts`/`verdict.ts`; T3/T15 Nix; T11 token-meter; T14 `local/settings.ts`}; L6 {T5
`git.ts` vs T1–T4 `gitcmd.ts`/`toolguard.ts`}; L7 {T5 `git.ts` vs T1–T4 `plan.ts`/`plans.ts`}.

## 16. Open questions (each with a recommendation; the parent decides)

13. **Q13 Release.** `spawnPolicyApi = 2` changes a shipped package. *Recommend* one release after L8 (AGENTS.md
    "Versions" steps), none per milestone.
14. **Q14 `git` in the router's `nativeCheckInputs`** (X28). *Recommend* yes; the alternative (temp-repo tests skip
    without git) makes a green run a lie.
15. **Q15 Async tool guards in the patch** (D22, X15). *Recommend* yes.
16. **Q16 Steer failure** sends the fixed escalation text (D31) instead of nothing. *Recommend* yes.
17. **Q17 Section variants** `BRANCH_ONLY`/`GATE_ONLY` (S25) and `mergeGate` independent of `worktrees`, `plans` needing
    both (D40, X26). *Recommend* as written.
18. **Q18 Model-facing texts**: overseer prompts (S20), refusal texts (`reasonText`), fixer message, whitelist block
    reason (L7.T11), steer message header, V3 `non-blocking` label. *Recommend* approving them as pinned text.
19. **Q19 "Opus budget is low"** (§2.5): *recommend* `budget − opusUsed ≤ 3`.
20. **Q20 OQ17 analysis sections**: *recommend* a separate token-meter plan after L8 (not in this plan).
21. **Q21 Invalid as failure** (D28/D29): retry an `invalid` attempt on the fallback member. *Recommend* yes.
22. **Q22 Broken plan checks after `rounds`** fail `plan_request` (D52). *Recommend* yes.
23. **Q23 Fixer forced and unslotted** (D47): ticket spawns skip slot accounting even when a member is local.
    *Recommend* yes; validation could later reject a `route: "local"` overseer/fixer member.

## 17. Top risks

- R6 Patch fragility: the Actor upstream moves; three stacked patches with fuzz (`.orig` files seen). Mitigation:
  the patch's own tests; `chk actor-subagents` on every `flake.lock` change.
- R7 Long tool calls: `request_merge` can take checks + red run + 2 × `timeoutSec`; the main session waits. Mitigation:
  D49 abort; logged `durationMs`; OQ6 tuning.
- R8 Classifier false positives block legitimate git (LD8 fails closed on git). Mitigation: the allow corpus; the
  reason tells how to split; `hint`-like counting can be added from logs.
- R9 `boundary` hazard in the patch context (D23). Mitigation: `chk boundary` after each regeneration.
- R10 Router-made commits (`commit-tree`) follow the user's signing config and may prompt (pinentry) → timeout.
  Mitigation: the git timeout; G8 manual check; a later `-c commit.gpgsign=false` option if it bites.
- R11 The `task-router` check slows down with temp repositories. Mitigation: unit layers on `fake-git` (D56); real git
  only for the AC tests.
- R12 A local member configured as overseer/fixer bypasses the single-slot queue (D47).

## 18. Resolutions (parent)

(empty)

## Resolutions (parent)

- Q13: no automatic release; a release is a separate step after L8, on the user's request.
- Q14–Q23: the recommendations are accepted as written (Q18: the texts in S20, S25 and the refusal texts are pinned).
