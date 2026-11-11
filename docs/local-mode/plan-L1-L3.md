# Local mode L1–L3: test-driven implementation plan

Status: plan, not implemented. Scope: milestones **L1** (switch and local routing), **L2** (force override) and
**L3** (hints and tripwires) of `docs/local-mode/design.md` (the spec, b4b6a79; §7 resolutions accepted).
Task ids `L<m>.T<n>`; every task starts at status `[ ] todo` (states: `todo`, `red seen`, `green`, `done`).
One task = one scenario = one commit (`git -c commit.gpgsign=false commit`).

> AGENTS.md says "This repository holds no plans; the author keeps them with their system configuration." This
> file was requested in `docs/local-mode/` anyway; whether it stays in the repository is open question Q1.

## 1. Motivation

Local mode lets the local Qwen drive the main session and do most work itself (design §1). L1 adds the switch
(`mode: "local"`, HM `taskRouter.localMode.enable`), all local-mode settings keys (declared, inert), the importance
change (LD1), the short local prompt section, the nudge switched off (LD3) and the status line. L2 adds a user-only
force override (`/force`, settings `force`) that goes around `acceptModel` (LD4, LD11). L3 adds measured hints:
pure tripwire detectors over the main session's tool calls, fixed hint texts appended to tool results, cooldown,
a fixed escalation hint on persistence, and call-only tripwires for children (hint to the child, notice to the
parent). Default mode must stay byte-for-byte unchanged (G6, A5, AC-N1–N4).

## 2. Approach (shape of the diff)

- **Settings**: `core/types.ts` gains the local types; `core/settings.ts` `defaults()` gains the keys of design
  §3.0.1 (so `merge()` accepts them) and calls `validateLocal()` from a new `core/local/settings.ts` (enums,
  counts, ranges, member references). `core/local/mode.ts` holds `isLocal`, `componentOn`, `statusText`.
- **Routing**: one expression in `core/policy.ts` (`mainEffort: isLocal(s) ? undefined : caller.thinkingLevel`);
  `core/importance.ts` unchanged.
- **Prompt**: `core/prompt.ts` gains `localSection(s)`; `core/shell.ts` `before_agent_start` picks it in local mode.
- **Nudge/status**: `core/shell.ts` passes `enabled: () => active && !isLocal(settings)` to `installNudge`; sets the
  status line at `session_start` (and on `model_select`, registered in local mode only).
- **HM**: `modules/task-router.nix` gains `localMode.enable`, `settings.mode = mkDefault "local"`, two assertions;
  `checks/module-eval/cases/task-router.nix` gains one positive and two negative cases.
- **Force**: pure `core/force.ts` (parse, resolve, precedence, countdown, rebuild); impure `core/forceinstall.ts`
  (command, session entries, settings check, status); one branch in `createPolicy`; `core/guards.ts` tolerates a
  non-member child; new outcome builders/keys; token-meter contract, `pi-analyse` data-quality filter, `LOGS.md`.
- **Hints**: pure `core/local/tripwires.ts` (records, keys, error signatures, detectors) and `core/local/hints.ts`
  (texts, cooldown, persistence); `core/local/install.ts` `installLocal()` wires `tool_call`/`tool_result`/`turn_end`
  for the main session; `core/local/childtrips.ts` builds a never-blocking child guard; `core/toolguard.ts` gains
  `composeGuards`; the policy composes guards for routed children in local mode.
- **Logs**: `log-contract` exercises the new writers (`force`, `hint` lines).
- **Docs**: `docs/pi-economics.md` taskRouter section per milestone.
- No change to: `core/importance.ts`, `core/nudge.ts`, `core/explicit.ts`, `core/pipeline.ts`, `resolveLeg`, `core/api.ts`,
  the four `runtime-guard.ts`, golden files, `flake.lock`, root `package.json`, versions.

## 3. Decisions made

| # | Decision | Rationale | Rejected alternative (why) |
|---|---|---|---|
| D1 | Local validation lives in `core/local/settings.ts`, called from `validate()` | `settings.ts` is 394 lines; keeps the local rules in one reviewable file; `defaults()` still owns the keys (merge needs them) | everything in `settings.ts` (design §4 table; grows an already long file) |
| D2 | Member/effort references (`overseer.*`, `mergeGate.fixer*`) are validated only when `mode = "local"` or some component is `"on"` | Unconditional checks add problems in default mode when Opus/Sonnet are blank: breaks `settings.test.ts` "M1: the default tables…" exact problem list (AC-N2) and adds a default-mode notification (G6) | validate always (design §3.0.1 wording) |
| D3 | An invalid local value is reset to its default with `"<path>: <why>; default kept"` | the existing style (`readOnlyReview`, `contextFit`) | drop the whole section (loses valid siblings) |
| D4 | L1 ships `localSection(s)` without the branch/plan lines; L5–L7 add an `active` parameter with their lines | the branch line names `start_branch` (L5) and `request_merge` (L6), which ship separately; an unused parameter would be dead code | implement `localSection(s, active)` now (AC-R3's signature; dead until L5) |
| D5 | In local mode a child (if it ever loads the router) still gets `cardSection(s, false)` | today's child behaviour; the local section's instructions are main-only | `localSection` for children |
| D6 | `/force` is registered at install (inside the guarded body), whether or not the actor API is present | AC-N3 ("commands only `/force`"); a user gets an answer instead of "unknown command" | register only with the API |
| D7 | Force state lives in a `ForcePort` created by the shell and passed in `PolicyDeps.force` | the policy has no `ctx`/`pi`; one owner of state, persistence and logs | a module-global |
| D8 | Settings-force resolution runs inside the shell's existing `session_start` handler, before the problems notification | one notification (AC-F4) and no new hook (AC-N3's hook inventory) | its own `session_start` handler (two notifications, inventory change) |
| D9 | A forced member runs `resolveLeg` pinned with `failover: []`; a forced non-member gets a hand-written child entry with `member: ""`, `failover: []`, no reservation | design §3.6.3 2–3; `failover: []` makes `createFailover.move` find no candidate (AC-F5) | a separate child map (the spawn line is written from `children`) |
| D10 | `spawnEvent` omits `workerMember` when it is `""` | the contract's optional `workerMember` must be a non-empty string | log a pseudo member name |
| D11 | Force effort omitted → the plan's `worker.effort` literally | design "the routed effort is kept" | re-map onto the forced member's ladder (design does not say so) |
| D12 | A force applies only when `settings.routing` is on | design: "every routed worker spawn"; the routing-off path has no plan or counterfactual | force the unrouted path too (Q6) |
| D13 | `check-failing` and `over-size` detectors move to L5 | their inputs (the branch check, the active worktree's diff) do not exist before L5 | stub inputs now (dead code, AC-H1 for them is vacuous) |
| D14 | Detection vs delivery: every detection counts toward persistence; cooldown suppresses only the hint; the escalation (`1 + persistTrips`-th detection since progress) is never suppressed | the only reading under which AC-H6 ("two more trigger the parent notice", with `cooldownCalls 5`) and AC-H2 hold together | count only delivered hints (AC-H6 unreachable within cooldown) |
| D15 | A "successful write" in `identical-call` and "progress" both mean a **tree change**: a write whose file hash changed (`hashAfter ≠ ⊥ ∧ hashAfter ≠ hashBefore`) | a successful write of identical content is no progress | `isError = false` (a no-op write would reset the loop detector) |
| D16 | Call keys hash the stable JSON: `key = tool + ":" + sha1(stableJSON(input))` | a `write` input holds a whole file; the ring stays small | the raw JSON (design wording; memory) |
| D17 | Trips found at `turn_end` (`context-stall`) are queued and delivered on the next main `tool_result` | hints go into tool results only (§3.1.2); no steer message in L3 | `sendMessage` steer (interrupts Qwen; that is what LD3 removed) |
| D18 | Child parent-notice at most once per (child, trip) | avoids spamming the parent; `attemptOf` is the remedy | repeat after each further `1 + persistTrips` detections |
| D19 | `composeGuards(trip guard, files guard)`: the observer first | it must see every call, including calls the files guard blocks (a blocked call repeated is a loop) | files guard first |
| D20 | `"task events without a spawn"` in `pi-analyse` counts only the task events (`reroute check corrective escalate verdict spotcheck`) | `force` (`taskId ""`) and main `hint` (`taskId "main"`) lines would otherwise be reported as data-quality defects | leave it (a false data-quality alarm on every local session) |
| D21 | The contract's `taskId` rule accepts `""` for `event: "force"` only | design §3.0.3 ("session-level events use `taskId: ""`") | `taskId: "session"` (deviates from the design) |

## 4. Where design and code disagree (with the recommended fix)

| # | Design says | Code has | Recommendation (task) |
|---|---|---|---|
| X1 | §2.2.3 "the existing … guard (`composeGuards`, `core/toolguard.ts`)" | `toolguard.ts` has no `composeGuards` | add it in L3.T6; fix the wording in design §2.2.3 |
| X2 | §3.0.3 session-level events use `taskId: ""` | `token-meter/core/contract.ts` requires `taskId: str` (non-empty) for every outcome event; `LOGS.md` "taskId (subagent name) — all required" | relax for `force` (D21) in L2.T3; amend `LOGS.md` |
| X3 | §3.0.3 lists only `contract.ts` and `LOGS.md` for new events | `pi-analyse` (`core/analyse.ts` ~l.446) reports every non-spawn line without a spawn as "task events without a spawn" | filter to task events (D20) in L2.T3; add `analyse.ts` to design §3.0.3/§4 |
| X4 | §3.0.1 validates `overseer.member` etc. unconditionally | `test/settings.test.ts` "M1: the default tables …" asserts the exact problem list for `{models:{opus:{model:""}}}` | D2 (L1.T3) |
| X5 | §2.3 `localSection(settings)`; AC-R3 `localSection(s, active)`; the branch line spans worktrees (L5) and mergeGate (L6) | — | D4; L5/L6 split the branch line ("start_branch …" in L5, "then request_merge … the router blocks it" in L6) |
| X6 | §3.6.3 a non-member force "starts at once, with no slot accounting" | `core/guards.ts` reads `d.settings.models[c.member].contextWindow` unguarded: a non-member child's `turn` event throws inside the API listener | `?.` and skip the context note when the window is unknown (L2.T5) |
| X7 | AC-H1 "for each trip in §3.1.1" in L3 | `check-failing`/`over-size` have no inputs before L5 | D13: AC-H1 for those two in L5 |
| X8 | AC-F6 (overseer ignores force) in L2 | no overseer before L4 | test in L4 |
| X9 | §2.6/AC-N3 "commands only `/force`" | today no command | L1.T1 pins `[]`; L2.T4 changes that one assertion to `["force"]` |
| X10 | §2.3 "Children still get no section" | children never load the router (`forChildren = false`); if one did, it gets `cardSection(s,false)` | D5; reword §2.3 |
| X11 | §3.6.2 `getAvailable()` of `ctx.modelRegistry` | pi 1.4 docs/examples show only `find(provider, id)` | call `getAvailable?.()`; empty list when absent (coverage gap G3) |
| X12 | §2.5 "in default mode it sets nothing", and "when a force is active it adds `· force …`" | — | default mode with a force: status `force <model> <effort>` alone; no force: never touch the status (Q4) |
| X13 | §3.1.2 "a `hint` log line and a status entry" | "status entry" undefined | Q5; L3.T7 implements the status suffix `· hint <trip>` until the next progress if accepted |
| X14 | §3.1.1 `key = tool + stable-JSON(input)` | — | D16 |

## 5. Gate (AGENTS.md rules)

| Rule | Result | Note |
|---|---|---|
| Tests first; every new check seen red once | PASS | every task has a RED step; green-from-start characterization tests carry planted violations (§11) |
| Check matching (Nix): `hasPrefix`/`hasSuffix`/`splitString`/`replaceStrings`, never `match`/`hasInfix` on large text | PASS | module-eval cases compare `builtins.fromJSON f.text` with `eq` and messages with `failed` (prefix on short strings) |
| Assertion messages start with `pi-economics:` and have a negative case | PASS | two new assertions (L1.T7), two negative cases; the third (`spawnPolicyApi >= 2`) is L4 |
| No import-from-derivation | PASS | cases read option values and `home.file.<f>.text` |
| Leak check | PASS | fixtures use `/work`, `u`, `localhost`, `*.invalid`; this plan uses relative paths only |
| `legacy.nix` untouched | N/A | not touched |
| Name only shipped extensions; `boundary` | PASS | neutral names in tests/docs |
| Consumer copies of cross-extension types → `iface.compare` | N/A | `core/api.ts` unchanged in L1–L3 (`ToolGuard` type lives in `toolguard.ts`) |
| Patched upstreams | N/A | no patch in L1–L3 (the Actor patch is L4) |
| `flake.lock` unchanged | PASS | |
| Root `package.json` only via render | PASS | no new extension, no bin; `render-package` stays green |
| `runtime-guard.ts` copies identical; register only in the guarded body; no flags/providers | PASS | `/force` and hooks are registered by `install()`, which runs in the guarded body at `session_start`; no flag, no provider |
| Package checks pinned to pi 1.4 `PI_TIMING` | PASS | unchanged; run at each milestone end |
| README "Without Nix" | N/A | no install-line or subset change |
| Versions | N/A | no release in L1–L3 (Q2) |
| Imports: only node builtins and relative files (`pi-package-manifest` "imported-is-peer") | PASS | new code imports `node:crypto`, `node:fs`, `node:path` only |

No violations, so no complexity-tracking rows.

## 6. Files to read first (all tasks; each task adds its own list)

`AGENTS.md`; `docs/local-mode/design.md` §1, §2, §3.0, §3.1, §3.6, §4, §5, §6; `docs/pi-economics.md` taskRouter
section; `packages/task-router/core/{shell,policy,settings,types,prompt,importance,nudge,outcome,log,toolguard,fresh}.ts`;
`packages/task-router/test/{harness,fake-pi,fake-api}.ts`.

## 7. Commands

```sh
# fast loop: node ≥ 22 with type stripping (the local node 24 runs all 473 router tests in ~31 s)
cd packages/task-router && HOME=$(mktemp -d) node --test --experimental-strip-types test/<file>.test.ts
cd packages/token-meter && HOME=$(mktemp -d) node --test --experimental-strip-types test/<file>.test.ts
# gate: AGENTS.md form, one capped build per check; `git add` new files first (the flake reads the git index);
# if a sandbox denies ~/.cache/nix, point XDG_CACHE_HOME/XDG_DATA_HOME at a writable directory
F=git+file://$PWD o=(--option eval-cache false) cap=$((20 * 1024 * 1024))
chk() { for c in "$@"; do (ulimit -v $cap && exec timeout -s KILL 900 nix build --no-link -L "$F#checks.x86_64-linux.$c" "${o[@]}") || echo "FAILED $c"; done; }
# formatter for .nix files
out=$(nix build "$F#formatter.x86_64-linux" --no-link --print-out-paths) && "$out/bin/alejandra" modules/task-router.nix checks/module-eval/cases/task-router.nix
```

There is no local `tsc`: the type check is only `chk typecheck-task-router` / `chk typecheck-token-meter`.

Keep-green sets, named in the tasks:

- **KG-R** `task-router typecheck-task-router router-golden iface-subagents-task-router iface-experiments-task-router`
- **KG-L** `token-meter typecheck-token-meter log-contract`
- **KG-M** `module-eval`
- **KG-S** `leak boundary` (any task that adds a file or prose)
- **KG-P** (milestone end) `render-package pi-package-manifest home-files pi-install-smoke pi-install-actor pi-install-duplicate nix-route-smoke`

`router-golden` reads `planSpawn` (via `test/golden/sut.ts`) and `resolveLeg` only; `createPolicy`, the shell and
`defaults()`'s new keys do not reach it. It must stay green with `checks/router-golden/golden.txt` byte-unchanged
(AC-N1); no task re-records it.

## 8. Type-checking strategy

`tsc --strict` (`typecheck-task-router`, over `index.ts`, `core/`, `test/`) runs at every GREEN. It is expected to
reject: a key declared in `RouterSettings` but missing from `defaults()`; a `Record<Trip, …>` text table missing a
trip; a `PolicyResult` with a `toolGuard` of the wrong arity; calls of the optional `PiLike` members
(`registerCommand`, `appendEntry`) without `?.`; a `ChildBase.forced` of the wrong shape in `log.spawn`. In
token-meter, `every()`'s one-argument predicate type rejects a `(v, l)` predicate: the `taskId` rule is a separate
`Rule` object (snippet S9). Tests stub new exports first (e.g. `localSection = () => ""`) so RED is an assertion
failure, not a load error.

## 9. Testing strategy per layer

| Layer | Tool | Covers | Needs |
|---|---|---|---|
| Pure units | `node --test` (task-router, token-meter) | settings validation, `isLocal`/`componentOn`/`statusText`, `localSection`, force parse/resolve/precedence/countdown/rebuild, outcome builders, tripwire detectors (properties against reference counters), hint engine, `composeGuards`, contract rules, `analyse` filter | nothing external |
| Shell integration | `node --test` with `harness()` (fake pi + fake API + stub fetch + in-memory fs + manual clock) | importance via the policy, section in `before_agent_start`, nudge off, status line, `/force` end to end, forced spawns and their lines, hint delivery in `tool_result`, child hints via the composed `toolGuard`, exception safety | `test/fake-pi.ts` extended (L1.T1): `registerCommand`, `commands`, `appendEntry`, `entries`, `hookNames()` |
| Non-regression | `node --test` + `router-golden` | AC-N1–N4: golden bytes, pre-existing tests unmodified, tool/hook/command inventory, `task_cards` identity, outcome keys ⊆ today's | frozen literals recorded on the base commit |
| Log contract | `log-contract` (nix) + token-meter tests | `pi-analyse --check` accepts the real writers' `force`/`hint` lines; required events present | the router harness in `checks/log-contract/contract.ts` |
| HM | `module-eval` (nix) | AC-R5: settings file, two assertions with negative cases | `checks/module-eval/cases/task-router.nix` |
| Package/pi runs | KG-P (nix, real pi 1.4 offline) | the extension still loads; `/force` registration does not break a real host | milestone end only |
| Real model | none | whether Qwen acts on hints; real pi event payloads | manual (§12) |

## 10. Scenario coverage (L1–L3 acceptance criteria → task → the one check that executes it)

| AC | Task | Check (test file › test) |
|---|---|---|
| AC-N1 golden unchanged | every task | `router-golden` |
| AC-N2 pre-existing tests unmodified | every task | `task-router` (all files but the new `local-*`, `force-*`, `hint-*`; `fake-pi.ts` is extended additively) |
| AC-N3 tools/commands/bash/section in default mode | L1.T1 (inventory), L1.T5 (section), L2.T4 (`["force"]`) | `test/local-default.test.ts` › "default mode: inventory", "default mode: bash tool_call", `test/local-prompt.test.ts` › "default mode section" |
| AC-N4 keys ⊆ today's | L1.T1 | `test/local-default.test.ts` › "default mode: outcome keys" |
| AC-R1 | L1.T2, L1.T3 | `test/local-settings.test.ts` |
| AC-R2 | L1.T4 | `test/local-routing.test.ts` › "AC-R2" |
| AC-R3 | L1.T5 | `test/local-prompt.test.ts` › "AC-R3 pinned text" |
| AC-R4 | L1.T6 | `test/local-shell.test.ts` › "AC-R4" |
| AC-R5 | L1.T7 | `module-eval` › `task-router-local-mode`, `…-requires-enable`, `…-needs-mode` |
| §2.5 status (local, OQ12) | L1.T6; force part L2.T4 | `test/local-shell.test.ts` › "status"; `test/force-shell.test.ts` › "status" |
| AC-F1 | L2.T5 (lines from L2.T2, countdown L2.T1) | `test/force-policy.test.ts` › "AC-F1" |
| AC-F2 | L2.T5 | `test/force-policy.test.ts` › "AC-F2" |
| AC-F3 | L2.T4 | `test/force-shell.test.ts` › "AC-F3" |
| AC-F4 | L2.T4 (notification, problem, inactive), L2.T5 (applies, override) | `test/force-shell.test.ts` › "AC-F4 settings unresolvable"; `test/force-policy.test.ts` › "AC-F4 precedence" |
| AC-F5 | L2.T5 | `test/force-policy.test.ts` › "AC-F5" |
| AC-F6 | **L4** (X8) | — |
| AC-L1 (force, hint) | L2.T3, L3.T5; real path L2.T6, L3.T9 | `token-meter` › `test/contract.test.ts`; `log-contract` |
| AC-L2 (force, hint) | L2.T2, L3.T4 | `test/force-log.test.ts` › "AC-L2", `test/hint-log.test.ts` › "AC-L2" |
| AC-H1 (8 trips) | L3.T1, L3.T2 | `test/local-tripwires.test.ts` › "AC-H1 <trip>"; `check-failing`, `over-size` → **L5** |
| AC-H2 | L3.T3 (pure), L3.T7 (e2e) | `test/local-hints.test.ts` › "AC-H2" |
| AC-H3 | L3.T1 | `test/local-tripwires.test.ts` › "AC-H3" |
| AC-H4 (L3 part: escalation hint, no spawn) | L3.T3, L3.T7 | `test/local-hints.test.ts` › "AC-H4 (L3)"; overseer part → **L4** |
| AC-H5 | L3.T7 | `test/local-hints.test.ts` › "AC-H5" |
| AC-H6 | L3.T8 | `test/local-child-hints.test.ts` › "AC-H6" |

## 11. Planted violations (each new check must be seen red once)

| Check | Plant | Must FAIL | Seen |
|---|---|---|---|
| L1.T1 inventory (tools, hooks, commands) | add `pi.on("model_select", () => undefined)` unconditionally in `install()` | "default mode: inventory" | [x] |
| L1.T1 bash `tool_call` | in `installFreshOnCold` return `{}` for `bash` | "default mode: bash tool_call" | [x] |
| L1.T1 outcome keys ⊆ today's | add `"mode"` to `KEYS` and `mode: "default"` to `spawnEvent` | "default mode: outcome keys" | [x] |
| L1.T4 default importance kept | pass `mainEffort: undefined` unconditionally | "AC-R2 default mode stays high" | [x] |
| L1.T5 default section identity | append `"\n"` to `cardSection`'s result in the shell's default branch | "default mode section" | [x] |
| L1.T5 LD3 under the experiments flag | use `settings.delegation.rule === "on"` to pick `cardSection` in local mode | "LD3: delegationRule on, local → localSection" | [x] |
| L1.T6 nudge stays on in default mode | `enabled: () => false` | existing `test/delegation.test.ts` "main session: 6 mechanical calls …" | [x] |
| L1.T7 module-eval | (natural) option declared without config | three cases FAIL | [x] |
| L2.T3 contract `force` taskId | rule `str` for all events | `test/contract.test.ts` › "force lines" | [x] |
| L2.T3 analyse filter | revert to `e?.event !== "spawn"` | `test/analyse.test.ts` › "session-level lines are no data-quality defect" | [x] |
| L2.T6 log-contract `force` | comment out `log.force(...)` in `used()` and `set` | `log-contract` "outcomes: no force event" | [x] |
| L3.T8 trip guard never blocks | make the trip guard return its hint text | "AC-H6 no child call is blocked" | [ ] |
| L3.T9 log-contract `hint` | drop the `log.hint` call in `installLocal` | `log-contract` "outcomes: no hint event" | [ ] |

All other new tests are red by construction (the feature is absent); record the red in the task's status line.

## 12. Coverage gap (not reached by the automated run; run by hand at each milestone end)

- G1 Real pi payloads: `tool_call`/`tool_result` field names (`toolCallId`, `input.path`, `content`, `isError`),
  `ctx.cwd`, `ctx.getContextUsage()` (`tokens`, `percent`), `model_select` (`event.model.provider/id`), `ctx.model`.
  The fakes encode assumptions taken from pi's examples (`trigger-compact.ts`, `border-status-editor.ts`,
  `model-status.ts`, `preset.ts`).
- G2 `pi.registerCommand` after load, `pi.appendEntry` and `ctx.sessionManager.getBranch()` rebuild after a real
  resume; `ctx.ui.setStatus` rendering.
- G3 `ctx.modelRegistry.find(provider, id)` and `getAvailable()` (X11) on a real registry.
- G4 The actor calling the composed `toolGuard` for every child call, and `api.send` reaching a busy child.
- G5 Whether Qwen acts on the section, the hints and the escalation (measured later from `hint` lines, OQ10).

Manual runbook (agent dir with `task-router/settings.json` = `{"mode":"local"}`, the patched actor present):
1. Start pi: the footer shows `local` (or `local (main: <model>)` with a non-local main). 2. `/force sonnet high next:1`,
spawn a card, check the child's model and the outcome lines `force set/used/expired`; `/force` shows "no force".
3. `/force session` variants, quit and resume: `/force` shows the restored state. 4. Ask the main to run the same
`ls` three times: the third result carries `<router-hint trip="identical-call" n="1">`. 5. A child repeating a call
three times gets the hint as a message; two more repeats notify the main.

## 13. Snippets

### S1 Settings types (`core/types.ts`, L1.T2)

```ts
export type Toggle = "auto" | "on" | "off";
export type HintSettings = {
  enabled: Toggle; identicalCalls: number; noChangeWrites: number; alternations: number; repeatedErrors: number;
  errorSimilarity: number; churnEdits: number; churnTurns: number; checkFailures: number; contextPercent: number;
  stallTurns: number; contextSoftTokens: number; cooldownCalls: number; persistTrips: number; steer: "on" | "off";
};
export type OverseerSettings = { member: string; effort: ThinkingLevel; fallbackMember: string; fallbackEffort: ThinkingLevel;
  budget: number; steerBudget: number; timeoutSec: number; resubmits: number; tools: string[] };
export type WorktreeSettings = { enabled: Toggle; root: string; branchPrefix: string; removeAfterMerge: boolean };
export type MergeGateSettings = { enabled: Toggle; mainBranches: string[]; maxDiffLines: number; maxDiffFiles: number;
  extraChecks: string[]; redRun: boolean; rejectionsBeforeFixer: number; fixerMember: string; fixerEffort: ThinkingLevel;
  fixerRounds: number; push: boolean; remote: string };
export type PlanSettings = { enabled: Toggle; dir: string; taskFiles: number; taskLines: number; splitFiles: number;
  splitLines: number; milestoneTasks: number; milestoneLines: number; taskTurns: number; rounds: number;
  regression: "milestone" | "plan" | "off"; publicApiGlobs: string[] };
// RouterSettings += (design §3.0.1)
mode: "default" | "local"; hints: HintSettings; overseer: OverseerSettings; worktrees: WorktreeSettings;
mergeGate: MergeGateSettings; plans: PlanSettings; force: { model: string; thinkingLevel: "" | ThinkingLevel };
```

`defaults()` gets the JSON of design §3.0.1 verbatim (with `regression: "milestone"`).

### S2 Mode helpers (`core/local/mode.ts`, L1.T2; `statusText` L1.T6, force part L2.T4)

```ts
export const LOCAL_COMPONENTS = ["hints", "worktrees", "mergeGate", "plans"] as const;
export type LocalComponent = (typeof LOCAL_COMPONENTS)[number];
export const isLocal = (s: RouterSettings): boolean => s.mode === "local";
/** "on" anywhere, "auto" in local mode only (design §2.1). */
export const componentOn = (s: RouterSettings, c: LocalComponent): boolean =>
  s[c].enabled === "on" || (s[c].enabled === "auto" && isLocal(s));
/** undefined = leave the status line alone (default mode, no force). */
export function statusText(x: { local: boolean; main?: string; localModels: string[]; force?: string }): string | undefined {
  const parts: string[] = [];
  if (x.local) parts.push(x.main !== undefined && !x.localModels.includes(x.main) ? `local (main: ${x.main})` : "local");
  if (x.force) parts.push(x.force);
  return parts.length ? parts.join(" · ") : undefined;
}
```

`localModels = enabled(s.models).filter((m) => m.route === "local").map((m) => m.model)`; `main =
ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined`. Status key: `"task-router"`.

### S3 Validation rules (`core/local/settings.ts`)

`validateLocal(s, base, raw, problems)`; every failed rule sets the default at its path and pushes
`"<path>: <why>; default kept"`. L1.T2 (enums): `mode ∈ {default, local}` (`must be "default" or "local"`);
`X.enabled ∈ {auto, on, off}` for `X ∈ LOCAL_COMPONENTS` (`must be "auto", "on" or "off"`); `hints.steer ∈ {on, off}`;
`plans.regression ∈ {milestone, plan, off}`; `force.thinkingLevel ∈ {""} ∪ EFFORTS`; `overseer.effort`,
`overseer.fallbackEffort`, `mergeGate.fixerEffort ∈ EFFORTS`. L1.T3 (values):

- COUNT (positive integer, `must be a positive integer`): every number-valued leaf of `defaults().{hints, overseer,
  mergeGate, plans}` except the two ranges; the test derives this set from `defaults()`, not from a literal.
- RANGE: `hints.errorSimilarity ∈ (0, 1]`, `hints.contextPercent ∈ (0, 100]`.
- LIST: `mergeGate.mainBranches` non-empty, every item a non-empty string; `overseer.tools`, `mergeGate.extraChecks`,
  `plans.publicApiGlobs` every item a string (`tools`: non-empty).
- MEMBER (D2: only when `isLocal(s) ∨ ∃c ∈ LOCAL_COMPONENTS: s[c].enabled = "on"`): `overseer.member`,
  `overseer.fallbackMember`, `mergeGate.fixerMember` name an enabled member (`"<x>" is not an enabled member`); the
  paired effort is in that member's `efforts` (`<e> is not an effort of <member> (<ladder>)`). A default that is
  itself invalid (Opus blank) is reported and kept.

### S4 The local section (`core/prompt.ts`, L1.T5; text pinned by test)

```ts
const LOCAL_EXAMPLE = { kind: "debug-design", files: ["src/a.ts"], check: "npm test -- a", acceptance: ["a() handles empty input"],
  t0: Object.fromEntries(T0_KEYS.map((k) => [k, true])), t2: [] };
export function localSection(s: RouterSettings): string {
  return `## Local mode

You do most of the work yourself. Spawn a subagent only when a task needs more ability than yours
(design, security, concurrency, an unknown root cause) or when a <router-hint> says so. After spawning,
end your turn; the child's report wakes you.
<router-hint> notes report what the router measured. Act on them.

Task card (spawn_subagent \`task\`; do not set model or thinkingLevel):
${cardSchema(s)}
${JSON.stringify(LOCAL_EXAMPLE)}`;
}
```

The pinned test compares with the literal string written out in the test (line breaks as in design §2.3's code block;
the example is one line, `{"kind":"debug-design","files":["src/a.ts"],"check":"npm test -- a","acceptance":["a() handles empty input"],"t0":{"bounded":true,"specified":true,"verifiable":true,"lowRisk":true,"small":true,"linear":true},"t2":[]}`).

Shell (`before_agent_start`, after the `!active` and `routing` checks):

```ts
sections.task_cards = isLocal(settings) && !isChild(ctx) ? localSection(settings)
  : cardSection(settings, !isLocal(settings) && settings.delegation.rule === "on" && !isChild(ctx));
```

### S5 Force core (`core/force.ts`, L2.T1; pure)

```ts
export const FORCE_TYPE = "task-router/force";
export type ForceCmd = { op: "show" } | { op: "off" } | { op: "usage" }
  | { op: "set"; ref: string; effort?: ThinkingLevel; scope: "session" | "next"; n?: number };
/** tokens = args.trim().split(/\s+/).filter(Boolean): [] → show; ["off"] → off; [ref, effort?, scope?] with
 *  effort ∈ EFFORTS, scope ∈ {"session", "next", /^next:([1-9][0-9]*)$/} in that order, each at most once; else usage.
 *  "next" = next:1; default scope session. */
export function parseForce(args: string): ForceCmd;
export type ForceEntry = { model: string; thinkingLevel?: ThinkingLevel; scope: "session" | "next"; remaining?: number; source: "command" }
  | { cleared: true };
export type ActiveForce = { model: string; thinkingLevel?: ThinkingLevel; source: "command" | "settings"; remaining?: number };
/** A member name maps to its model (a blank member is unknown); otherwise `provider/id` split at the first "/". */
export function resolveRef(ref: string, models: Record<string, Member>, find: (p: string, id: string) => unknown): string | undefined;
/** The last entry of type FORCE_TYPE on the branch (`e.type === "custom" && e.customType === FORCE_TYPE`), else undefined. */
export function rebuild(branch: readonly unknown[]): ForceEntry | undefined;
/** Command force (live: scope session, or next with remaining > 0) over the settings force. */
export function effective(cmd: ForceEntry | undefined, fromSettings: ActiveForce | undefined): ActiveForce | undefined;
/** One forced spawn on the command force: next → remaining − 1; at 0 the entry becomes {cleared: true} and expired = true. */
export function consume(cmd: ForceEntry | undefined): { next: ForceEntry | undefined; expired: boolean };
export const describeForce = (f: ActiveForce): string =>
  `force ${f.model}${f.thinkingLevel ? ` ${f.thinkingLevel}` : ""}${f.remaining !== undefined ? ` (${f.remaining} left)` : ""}`;
```

### S6 Force shell (`core/forceinstall.ts`, L2.T4)

```ts
export type ForcePort = { active(): ActiveForce | undefined; used(taskId: string): void };
export function installForce(pi: PiLike, d: { settings: RouterSettings; log: OutcomeLog; onChange(): void }): {
  port: ForcePort;
  /** In the shell's session_start handler, before the problems notification: rebuild the command force from
   *  ctx.sessionManager?.getBranch?.() ?? []; once per process resolve settings.force.model with ctx.modelRegistry
   *  (unresolvable or no registry → push "force.model: unknown model <ref>; the settings force is inactive" into
   *  `problems`, log force rejected source settings reason unknown-model). */
  start(ctx: any, problems: string[]): void;
};
```

Command handler (`pi.registerCommand?.("force", { description, handler(args, ctx) })`):

| input | state change | notify | log |
|---|---|---|---|
| `/force` | none | `task-router: <describeForce> (<source>)` or `task-router: no force; routing decides` (info) | — |
| `/force off` | append `{cleared: true}` | `task-router: force cleared` (+ `; the settings force <m> applies` when one is active) | `clear` |
| usage error | none | `usage: /force <model> [effort] [next[:N] \| session] \| /force off \| /force` (warning) | `rejected`, `reason: "usage"` |
| unknown model | none | `task-router: /force: unknown model <ref>; available: <first 10 of getAvailable?.() ?? []>` (error) | `rejected`, `model: <ref>`, `reason: "unknown-model"` |
| valid | append entry | `task-router: <describeForce> for <the session \| the next N spawns>; overseer reviews are not forced (they use overseer.*)` (info) | `set` |

`used(taskId)`: log `used` (source, model, effort); on a command `next` force `consume` → append the new entry, log
`expired` when it ran out; `onChange()` re-renders the status (the shell keeps the last `ctx.ui` it saw).

### S7 Policy branch (`core/policy.ts`, L2.T5)

```ts
// PolicyDeps += force?: ForcePort; childGuard?: (child: string, parent: string) => ToolGuard | undefined (L3.T8)
// ChildBase += forced?: { source: "command" | "settings"; routedModel: string; routedEffort: ThinkingLevel }
const f = s.routing ? d.force?.active() : undefined;
const sp = planSpawn(d, { ..., model: f ? undefined : args.model, effort: f ? undefined : args.thinkingLevel });
// … unchanged up to `entry` …
if (f) {
  const effort = f.thinkingLevel ?? plan.worker.effort;
  const forced = { source: f.source, routedModel: plan.worker.model, routedEffort: plan.worker.effort };
  const member = byModel(s.models, f.model);
  plan.reasons.push(`force: ${f.model} ${effort} (${f.source})`);
  if (member) {
    const to = await resolveLeg(d, { name: args.name, cands: [member], planned: member, step: plan.worker.step, effort,
      pinned: true, failover: [], entry: { ...entry, forced } });
    if (!to.ok) return reject(to.errors.map((e) => `force ${f.model}: ${e}`)); // nothing used
  } else {
    const now = d.now();
    d.children.set(args.name, { ...entry, forced, member: "", route: "forced", model: f.model, effort, at: now, reservedUntil: now,
      failover: [], start: { member: "", model: f.model, effort, waitMs: 0 } });
  }
  d.force!.used(args.name);
  return { model: f.model, thinkingLevel: effort, briefAppend: briefAppend(/* as today */), ...tools, meta: { taskId: args.name, importance } };
}
```

`core/guards.ts`: `const window = d.settings.models[c.member]?.contextWindow;` and the context note only when
`window !== undefined`. `shell.ts onEvent`: `log.spawn({ …, forced: c.forced })`.

### S8 Outcome builders (`core/outcome.ts`, `core/log.ts`)

```ts
// KEYS += L2: "action", "source", "model", "effort", "forced", "forceSource", "routedModel", "routedEffort"
//         L3: "trip", "stage", "count"
export const forceEvent = (i: { now: Date; action: "set" | "clear" | "used" | "expired" | "rejected"; source: "command" | "settings";
  model?: string; effort?: string; reason?: "unknown-model" | "usage" }) =>
  finish({ ...base("force", i.now, ""), action: i.action, source: i.source, model: i.model, effort: i.effort, reason: i.reason });
// spawnEvent input += forced?: { source; routedModel; routedEffort } →
//   forced: true, forceSource: source, routedModel, routedEffort (only when given); workerMember: i.start?.member || undefined
export const hintEvent = (i: { now: Date; taskId: string; trip: Trip; stage: "hint" | "steer" | "parent"; count?: number; sessionId?: string }) =>
  finish({ ...base("hint", i.now, i.taskId), trip: i.trip, stage: i.stage, count: i.count, sessionId: i.sessionId });
```

### S9 Contract (`packages/token-meter/core/contract.ts`)

```ts
// OUTCOMES: event enum += "force" (L2), "hint" (L3); taskId leaves the `every` list and becomes:
{ field: "taskId", why: "every outcome event (force: a string, may be empty)", ok: (v, l) => (l?.event === "force" ? typeof v === "string" : str(v)) },
...every({ action: oneOf("set", "clear", "used", "expired", "rejected"), source: oneOf("command", "settings") }, "force", (l) => l.event === "force"),
...optional({ model: str, effort: oneOf("off", "minimal", "low", "medium", "high", "xhigh", "max"), reason: oneOf("unknown-model", "usage") }, "force", (l) => l.event === "force"),
...optional({ forced: (v) => v === true, forceSource: oneOf("command", "settings"), routedModel: str, routedEffort: str }, "spawn: a forced spawn", (l) => l.event === "spawn"),
// L3
...every({ trip: oneOf(...TRIPS), stage: oneOf("hint", "steer", "parent") }, "hint", (l) => l.event === "hint"),
...optional({ count: int0, sessionId: str }, "hint", (l) => l.event === "hint"),
```

`TRIPS` is duplicated as a literal in the contract (token-meter does not import the router). `core/analyse.ts`:
`const TASK_EVENTS = new Set(["reroute", "check", "corrective", "escalate", "verdict", "spotcheck"])` and
`item("task events without a spawn", logs.outcomes.filter((e) => TASK_EVENTS.has(e?.event) && !spawnTasks.has(e?.taskId)), …)`.

### S10 Tripwires (`core/local/tripwires.ts`, pure)

```ts
export const TRIPS = ["identical-call", "no-change-writes", "alternation", "repeated-error", "churn", "check-failing",
  "over-size", "risky-path", "context-soft", "context-stall"] as const;
export type Trip = (typeof TRIPS)[number];
export type CallRecord = { tool: string; key: string; isWrite: boolean; path?: string; hashBefore?: string; hashAfter?: string;
  isError?: boolean; errSig?: string; turn: number };
export const windowSize = (h: HintSettings): number => 4 * h.identicalCalls + 8;
export const callKey = (tool: string, input: unknown): string => `${tool}:${sha1(stableJson(input))}`;
export const errSig = (text: string): string => text.toLowerCase().replace(/[0-9]/g, "#").replace(/\s+/g, " ").trim().slice(0, 500);
export const trigramJaccard = (a: string, b: string): number; // |T(a) ∩ T(b)| / |T(a) ∪ T(b)|, T = set of 3-char substrings; 1 when both empty
export const changed = (r: CallRecord): boolean => r.isWrite && r.hashAfter !== undefined && r.hashAfter !== r.hashBefore;
export const push = (ring: CallRecord[], r: CallRecord, h: HintSettings): CallRecord[]; // keeps the last windowSize(h)
export function callTrips(ring: CallRecord[], h: HintSettings, risk: { globs: string[]; seen: ReadonlySet<string>; rel(p: string): string }): Trip[];
```

Definitions over the ring `r_0 … r_{n−1}`, last record `ℓ = r_{n−1}`, `k_i = r_i.key` (D15 for "write"):

- **identical-call**: `b = max({i < n−1 : changed(r_i)} ∪ {0})`; fire ⇔ `|{i ∈ [b, n−1] : k_i = k_ℓ}| ≥ identicalCalls`.
- **no-change-writes**: `w` = the subsequence of `r` with `isWrite ∧ hashBefore ≠ ⊥ ∧ hashAfter ≠ ⊥` (⊥ records do not
  count, §3.1.4); fire ⇔ `ℓ.isWrite ∧ |w| ≥ N ∧ ∀ x ∈ last N of w: x.hashBefore = x.hashAfter`, `N = noChangeWrites`.
- **alternation**: `m = 2·alternations`; fire ⇔ `n ≥ m ∧ ∃ a ≠ b: ∀ j < m: k_{n−m+j} = (j even ? a : b) ∧ ¬∃ i ∈ [n−m, n−1]: changed(r_i)`.
- **repeated-error**: `m = repeatedErrors`; fire ⇔ `n ≥ m ∧ ∀ i ∈ [n−m, n−1]: r_i.isError ∧ r_i.tool = ℓ.tool ∧ r_i.errSig ≠ ⊥`
  `∧ ∀ i ∈ [n−m, n−2]: J(r_i.errSig, r_{i+1}.errSig) ≥ errorSimilarity`.
- **churn**: fire ⇔ `ℓ.isWrite ∧ ¬ℓ.isError ∧ ℓ.path ≠ ⊥ ∧ |{i : r_i.isWrite ∧ ¬r_i.isError ∧ r_i.path = ℓ.path ∧ r_i.turn > ℓ.turn − churnTurns}| ≥ churnEdits`.
- **risky-path**: fire ⇔ `ℓ.isWrite ∧ ¬ℓ.isError ∧ ℓ.path ∉ seen ∧ ∃ g ∈ riskGlobs ∪ {p.glob : p ∈ pathRules, p.level = critical}: globMatch(g, rel(ℓ.path))`; the engine adds the path to `seen`.
- **context-soft** (state `armed`, initially true; evaluated at every main `tool_result` and `turn_end` with `t = usage.tokens`):
  `armed ∧ t > contextSoftTokens` → fire, `armed := false`; `¬armed ∧ t < contextSoftTokens` → `armed := true`.
- **context-stall** (state `stall`, at `turn_end` with `p = usage.percent`): progress this turn → `stall := 0`; else if
  `p ≥ contextPercent` → `stall += 1`; fire ⇔ `stall = stallTurns` (then `stall := 0`).

Children (calls only, D16 keys; no hashes, no results): a record is `{tool, key, isWrite, turn: 0}`; for
`identical-call` a write with a key other than `k_ℓ` counts as a change (`changedChild(r) = r.isWrite ∧ r.key ≠ k_ℓ`),
`alternation` uses the same rule; the other trips are not evaluated.

### S11 Hint engine (`core/local/hints.ts`, pure)

```ts
export const HINT_TEXT: Record<Trip, (h: HintSettings, p: RouterSettings["plans"]) => string> = {
  "identical-call": (h) => `You ran this exact call ${h.identicalCalls} times; its result will not change. Use the result you have, or change the approach.`,
  "no-change-writes": (h) => `${h.noChangeWrites} writes changed nothing. Re-read the file before editing; oldText must match exactly.`,
  alternation: (h) => `You alternated between the same two calls ${h.alternations} times and no file changed. Change the approach.`,
  "repeated-error": (h) => `The same error came back ${h.repeatedErrors} times in a row. Fix its cause; do not repeat the call unchanged.`,
  churn: (h) => `You wrote the same file ${h.churnEdits} times within ${h.churnTurns} turns. Re-read it, decide the whole change, then write it once.`,
  "check-failing": (h) => `The check failed ${h.checkFailures} times in a row. If the cause is unclear, spawn a debug-design card (files, check, acceptance).`,
  "over-size": (_h, p) => `This branch exceeds ${p.splitLines} changed lines or ${p.splitFiles} files. Commit what passes and split the rest.`,
  "risky-path": () => `This path matches a risk rule. Keep the change minimal and spawn a review card for it (the file and its check).`,
  "context-soft": (h) => `Context is above ${Math.round(h.contextSoftTokens / 1000)}k tokens. Fold finished work or hand off with a task card.`,
  "context-stall": (h) => `Context is above ${h.contextPercent} % and nothing changed for ${h.stallTurns} turns. Hand the rest to a fresh agent with a task card, or fold finished work.`,
};
export const ESCALATION = "This persists after the hints. Spawn a debug-design card for it; the router will route it to Sonnet or above.";
export const block = (trip: Trip, n: number, text: string): string => `<router-hint trip="${trip}" n="${n}">${text}</router-hint>`;
export type Delivery = { trip: Trip; n: number; stage: "hint" | "steer"; text: string };
/** D14. Per trip: count since the last progress or escalation, and the call number of the last hint. */
export function createHintEngine(h: HintSettings, p: RouterSettings["plans"]): {
  detected(trips: Trip[], call: number): Delivery[]; // count += 1; count ≥ 1 + persistTrips → escalation (stage "steer", text ESCALATION, count := 0);
                                                    // else call − lastHint > cooldownCalls (or never) → hint (stage "hint", n = count); else nothing
  progress(): void;                                  // all counts := 0
};
```

Under defaults the pinned texts of identical-call, no-change-writes, context-soft and over-size equal design §3.1.2's
examples; check-failing reads "2 times" where the design example says "twice" (Q7).

### S12 Main wiring (`core/local/install.ts`, L3.T7)

```ts
export type LocalDeps = { settings: RouterSettings; log: OutcomeLog; isChild(ctx: any): boolean; sessionId(): string | undefined;
  hash?(abs: string): string | undefined;          // default sha256 of readFileSync, undefined on any error
  detect?: typeof callTrips;                        // test seam (AC-H5)
  onTrip?(trip: Trip | undefined): void };          // status suffix (Q5)
export function installLocal(pi: PiLike, d: LocalDeps): void; // no-op unless componentOn(settings, "hints")
```

- `tool_call` (main only): `pending.set(toolCallId, {tool, key, isWrite: tool ∈ {edit, write}, path, hashBefore})`
  with `path = resolve(ctx.cwd ?? process.cwd(), input.path)` for writes; returns `undefined` always.
- `tool_result` (main only): complete the record (`isError`, `errSig` from the text content when `isError`,
  `hashAfter`, `turn`), `push`, `changed` → `engine.progress()` and `stall := 0`, `callTrips` + `context-soft`,
  `engine.detected`, plus queued turn-end deliveries; non-empty → `{ content: [...e.content, ...blocks] }` and one
  `log.hint("main", trip, stage, n, sessionId)` per delivery; else `undefined`.
- `turn_end` (main only): `turn += 1`; `context-soft`/`context-stall` → queue deliveries; returns `undefined`.
- Every handler body is in `try/catch`; a throw logs once (`console.warn("task-router: hint engine: <msg>")`) and returns
  `undefined` (AC-H5).

### S13 Guard composition and child trips

```ts
// core/toolguard.ts
export type ToolGuard = (tool: string, input: unknown) => string | undefined;
export const composeGuards = (...gs: (ToolGuard | undefined)[]): ToolGuard | undefined => {
  const xs = gs.filter((g): g is ToolGuard => g !== undefined);
  return xs.length ? (t, i) => { for (const g of xs) { const r = g(t, i); if (r !== undefined) return r; } return undefined; } : undefined;
};
// core/local/childtrips.ts
export function createChildTrips(d: { settings: RouterSettings; api: () => SubagentsApiV1 | undefined; log: OutcomeLog }): {
  guard(child: string, parent: string): ToolGuard;   // records, detects identical-call/alternation, never returns a string
  forget(child: string): void;                        // on the API's kill event
};
// hint:   void api.send(child, block(trip, n, HINT_TEXT[trip](…)), "router").catch(() => {}); log.hint(child, trip, "hint", n)
// escalation (once per child and trip, D18):
//   void api.send(parent, `[router] ${child} looks stuck (${trip} ×${n}); consider killing it and respawning with attemptOf`, "router")
//   log.hint(child, trip, "parent", n)
// policy (local mode, hints on): toolGuard = composeGuards(d.childGuard?.(args.name, caller.name), toolsFor(...).toolGuard)
```

### S14 Home Manager (`modules/task-router.nix`, L1.T7)

```nix
options.programs.piEconomics.taskRouter.localMode.enable = lib.mkEnableOption
  "local mode: a local model drives the main session (writes settings.mode = \"local\"; docs/pi-economics.md, taskRouter)";
config = lib.mkMerge [
  {
    assertions = [{
      assertion = !(cfg.localMode.enable && !cfg.enable);
      message = "pi-economics: taskRouter.localMode.enable requires taskRouter.enable";
    }];
  }
  (lib.mkIf cfg.enable {
    # … today's registry entry, settings file and assertion, unchanged …
    programs.piEconomics.taskRouter.settings.mode = lib.mkIf cfg.localMode.enable (lib.mkDefault "local");
    assertions = [{
      assertion = !cfg.localMode.enable || (cfg.settings.mode or "local") == "local";
      message = "pi-economics: taskRouter.localMode.enable needs taskRouter.settings.mode = \"local\" (found ${builtins.toJSON (cfg.settings.mode or null)})";
    }];
  })
];
```

Cases (`checks/module-eval/cases/task-router.nix`), with `msgEnable`/`msgMode` as `let` bindings:

```nix
task-router-local-mode = lib.concatMap (dir: let
  f = fileAt "${dir}/task-router/settings.json" (eval dir {localMode.enable = true;} withActor);
  g = fileAt "${dir}/task-router/settings.json" (eval dir {localMode.enable = true; settings = {queueMaxSec = 60;};} withActor);
  json = x: if x == null then null else builtins.fromJSON x.text;
in
  eq "settings file (${dir})" (json f) {mode = "local";}
  ++ eq "merged with settings (${dir})" (json g) {mode = "local"; queueMaxSec = 60;}
  ++ eq "failed assertions (${dir})" (failed "" (eval dir {localMode.enable = true;} withActor)) [])
dirs;
task-router-local-mode-requires-enable = eq "assertions"
  (failed "pi-economics: taskRouter.localMode" (eval ".pi/agent" null (withActor // {taskRouter.localMode.enable = true;}))) [msgEnable];
task-router-local-mode-needs-mode = eq "assertions"
  (failed "pi-economics: taskRouter.localMode" (eval ".pi/agent" {localMode.enable = true; settings.mode = "default";} withActor))
  [''pi-economics: taskRouter.localMode.enable needs taskRouter.settings.mode = "local" (found "default")''];
```

## 14. Tasks

Each task: read its files first, write the test(s), see RED with the fast runner, implement GREEN, CLEAN (format,
names, comments citing `design §…`/`LD…`), then run the named nix checks. Never more than one failing check at a time.

### L1 — Switch and local routing

#### L1.T1 Test seams and default-mode baseline (AC-N3, AC-N4) `[x] done`
- **Goal**: freeze today's default-mode surface before any production change.
- **Files**: `packages/task-router/test/fake-pi.ts` (additive), `packages/task-router/test/local-default.test.ts` (new).
- **Depends**: — . **Parallel**: with L1.T7.
- **Read first**: `test/fake-pi.ts`, `test/harness.ts`, `test/shell.test.ts`, `test/outcome.test.ts` (`K_ALLOWED`), `core/shell.ts`, `core/fresh.ts`, `core/effort.ts`.
- **RED/baseline**: extend `fakePi()` with `registerCommand(name, c)` → `commands: Map`, `appendEntry(type, data)` →
  `entries: {type, data}[]`, `hookNames(): string[]` (sorted multiset of `pi.on` names). New tests:
  1. "default mode: inventory": `harness()` + `session_start` → `[...tools.keys()] = ["task_verdict"]`,
     `[...commands.keys()] = []`, `hookNames()` = the literal recorded on the base commit (run once, paste).
  2. "default mode: bash tool_call": `fire("tool_call", {toolName: "bash", toolCallId: "b1", input: {command: "git push origin main"}}, MAIN)` → every result `undefined`.
  3. "default mode: outcome keys": a session with spawn, `check` (stub `run`), verdict, error→reroute, `attemptOf`→escalate,
     spotcheck (`spotCheck.enabled`, `rng: () => 0`) → every key of every line ∈ `TODAY_KEYS` (literal copy of today's `KEYS`).
  These pass at once: see them red with the three plants of §11, then remove the plants.
- **GREEN**: nothing (baseline).
- **Check**: fast runner on `test/local-default.test.ts`; then `chk task-router typecheck-task-router`.
- **Keep green**: KG-R. **ACs**: AC-N3 (inventory, bash), AC-N4.

#### L1.T2 Settings keys, types, enums, mode helpers (AC-R1) `[x] done`
- **Goal**: `parseSettings` knows every local key; `mode` and toggles are validated.
- **Files**: `core/types.ts`, `core/settings.ts` (`defaults()` + one call), `core/local/settings.ts` (new, enum rules), `core/local/mode.ts` (new: `LOCAL_COMPONENTS`, `isLocal`, `componentOn`), `test/local-settings.test.ts` (new).
- **Depends**: L1.T1. **Parallel**: with L1.T7.
- **Read first**: `core/settings.ts` (`merge`, `validate`, `parseSettings`), `test/settings.test.ts`, design §3.0.1.
- **RED** (`test/local-settings.test.ts`): `parseSettings({mode: "local"})` → `settings.mode === "local"`, `problems = []`;
  `{mode: "x"}` → `mode === "default"`, problems `['mode: must be "default" or "local"; default kept']`;
  `{hints: {enabled: "maybe"}}` → one problem starting `hints.enabled:`; property: `∀ c ∈ LOCAL_COMPONENTS, v ∈ {"auto","on","off"}`
  no problem and `componentOn` = `v === "on" ∨ (v === "auto" ∧ mode = local)` for both modes; `parseSettings({}).settings`
  deep-equals `defaults()` and `defaults()` contains every key of design §3.0.1 (key list derived from the JSON in the test).
- **GREEN**: S1 types; S1 defaults; `validateLocal` enum part (S3) called at the end of `validate()`; S2 helpers.
- **Check**: fast runner `test/local-settings.test.ts` red → green; `chk task-router typecheck-task-router router-golden`.
- **Keep green**: KG-R (incl. `test/settings.test.ts` unmodified). **ACs**: AC-R1.

#### L1.T3 Value and member validation (design §3.0.1 rules 3–6) `[x] done`
- **Goal**: counts, ranges, lists and member references produce problems; default mode untouched (D2).
- **Files**: `core/local/settings.ts`, `test/local-settings.test.ts`.
- **Depends**: L1.T2. **Parallel**: with L1.T4, L1.T5, L1.T7.
- **RED**: property: for every COUNT path `p` (derived: number leaves of `defaults().{hints,overseer,mergeGate,plans}` minus
  RANGE) and `v ∈ {0, −1, 1.5, "7"}` → value at `p` = default, problems = [`${p}: must be a positive integer; default kept`]
  (for `"7"` `merge()` already drops it: expect no problem); `v ∈ {1, 9}` accepted. RANGE: `errorSimilarity ∈ {0, 1.2}`,
  `contextPercent ∈ {0, 101}` → problem; `{1, 0.5}`/`{100, 85}` → none. `mergeGate.mainBranches: []` → problem.
  MEMBER: `{mode: "local", models: {opus: {model: ""}}}` → problem `overseer.member: "opus" is not an enabled member; default kept`;
  `{mode: "local", overseer: {effort: "low"}}` → `overseer.effort: low is not an effort of opus (high, xhigh); default kept`;
  the same two inputs **without** `mode` → no `overseer.` problem (D2); `{hints: {enabled: "on"}, models: {opus: {model: ""}}}` → the member problem.
- **GREEN**: S3 COUNT/RANGE/LIST/MEMBER.
- **Check**: fast runner; `chk task-router typecheck-task-router`.
- **Keep green**: KG-R; `test/settings.test.ts` "M1: the default tables …" (X4) must stay green. **ACs**: AC-R1 (rest of §3.0.1).

#### L1.T4 Importance without the main effort (AC-R2, LD1) `[x] done`
- **Files**: `core/policy.ts` (one expression), `test/local-routing.test.ts` (new).
- **Depends**: L1.T2. **Parallel**: with L1.T3, L1.T5, L1.T7.
- **Read first**: `core/policy.ts` `createPolicy`, `core/importance.ts`, `test/policy.test.ts` "meta carries the importance …".
- **RED**: "AC-R2": `harness({settings: {mode: "local"}})`, `a.spawn({name: "c1", task: card()}, {thinkingLevel: "xhigh"})` →
  `meta.importance === "normal"`, `model === "llama/qwen3.8"`, `briefAppend` has no "Review required", and after the
  API's `spawn` event the spawn line has `importance: "normal"` and no `reviewTier`. "AC-R2 default mode stays high": same
  spawn under `harness()` → `meta.importance === "high"`, spawn line `reviewTier: "T1"` (green at once; plant §11). Property: in local mode, ∀ `thinkingLevel ∈ EFFORTS`, the importance equals the importance at
  `thinkingLevel: undefined` (derived from the SUT).
- **GREEN**: `mainEffort: isLocal(s) ? undefined : caller.thinkingLevel`.
- **Check**: fast runner; `chk task-router typecheck-task-router router-golden`.
- **Keep green**: KG-R. **ACs**: AC-R2.

#### L1.T5 The local section (AC-R3, LD3) `[x] done`
- **Files**: `core/prompt.ts` (`LOCAL_EXAMPLE`, `localSection`), `core/shell.ts` (`before_agent_start` branch), `test/local-prompt.test.ts` (new).
- **Depends**: L1.T2. **Parallel**: with L1.T3, L1.T4, L1.T7.
- **Read first**: `core/prompt.ts`, `test/prompt.test.ts` (its `fire` helper), `core/flags.ts`, design §2.3.
- **RED** (stub `localSection = () => ""` first): "AC-R3 pinned text": local mode → `task_cards === <literal of S4 with cardSchema(defaults()) spliced>`;
  `includes(cardSchema(s))`; `!includes(ORCHESTRATOR_RULE)`; stable across two harnesses. "LD3": experiments flag
  `delegationRule` = "on" (stub `globalThis.__piExperimentsApi_v1`, as `test/flags.test.ts` does) + local → `localSection`.
  "default mode section": `{}` → `task_cards === cardSection(s, false)`; with `delegation.rule: "on"` → `cardSection(s, true)` (plant §11).
  "child in local mode": a ctx whose session is listed as a child → `cardSection(s, false)` (D5).
- **GREEN**: S4.
- **Check**: fast runner; `chk task-router typecheck-task-router`.
- **Keep green**: KG-R (`test/prompt.test.ts`, `test/flags.test.ts`, `test/activation.test.ts` unmodified). **ACs**: AC-R3, AC-N3 (section).

#### L1.T6 Nudge off and status line (AC-R4, §2.5, OQ12) `[x] done`
- **Files**: `core/shell.ts`, `core/local/mode.ts` (`statusText`), `test/local-shell.test.ts` (new).
- **Depends**: L1.T5 (same `shell.ts`), L1.T2.
- **Read first**: `core/nudge.ts`, `test/delegation.test.ts` (shell hook part), pi example `model-status.ts` (event shape).
- **RED**: "AC-R4": local mode, 20 `turn_end` with one `edit` each (and once 20 edits in one turn) → no
  `task-router/delegation-nudge` in `f.sent`. "status": ctx with `ui.setStatus` spy: local + `ctx.model = {provider:"llama", id:"qwen3.8"}` →
  `setStatus("task-router", "local")`; `ctx.model` Sonnet → `"local (main: anthropic/claude-sonnet-5-5)"`; a later
  `model_select` to the local model → `"local"`; default mode → no `setStatus` call and no `model_select` hook (inventory test of
  L1.T1 stays green). Pure `statusText` table test (S2).
- **GREEN**: `installNudge(pi, {settings, isChild, enabled: () => active && !isLocal(settings)})`; in the existing
  `session_start` handler: `const t = statusText(...); if (t !== undefined) ctx?.ui?.setStatus?.("task-router", t)`; register
  `model_select` only when `isLocal(settings)`.
- **Check**: fast runner; `chk task-router typecheck-task-router`.
- **Keep green**: KG-R (`test/delegation.test.ts` unmodified; plant §11). **ACs**: AC-R4, §2.5 (local part).

#### L1.T7 Home Manager `localMode.enable` and two assertions (AC-R5) `[x] done`
- **Files**: `modules/task-router.nix`, `checks/module-eval/cases/task-router.nix`.
- **Depends**: — . **Parallel**: with every L1 TypeScript task.
- **Read first**: `modules/task-router.nix`, `checks/module-eval/{default,expect}.nix`, `checks/module-eval/cases/task-router.nix`.
- **RED**: add the three cases of S14; add **only** the option declaration (no config) so the cases FAIL cleanly
  (`settings file: expected {mode = "local";}, got null`, `assertions: expected [ … ], got [ ]`), not with "option does not exist".
- **GREEN**: S14 config (`mkMerge`, `mkDefault`, two assertions); Alejandra.
- **Check**: `chk module-eval` red → green.
- **Keep green**: KG-M (`task-router-off`, `-defaults`, `-settings`, `-models`, `m5-host-like`, `bench` cases unchanged), `render-package`. **ACs**: AC-R5.

#### L1.T8 Docs and milestone close `[x] done`
- **Files**: `docs/pi-economics.md` (taskRouter: `localMode.enable` row; a "Local mode" paragraph: `mode`, the toggles and
  `"auto"`, importance without the main effort, the local section, nudge off, status line; the settings keys list points to
  `core/settings.ts`; Checks unchanged).
- **Depends**: L1.T1–T7. **Check**: `chk leak boundary`, then the full L1 sweep: KG-R, KG-L, KG-M, KG-P.
- **ACs**: milestone L1 (design §6.1).

### L2 — Force override

#### L2.T1 Pure force core `[x] done`
- **Files**: `core/force.ts` (new, S5), `test/force.test.ts` (new).
- **Depends**: L1 done. **Parallel**: with L2.T2, L2.T3.
- **RED**: `parseForce` table: `""`→show, `"off"`→off, `"sonnet"`→set session, `"sonnet high"`, `"sonnet next"`→n 1,
  `"sonnet high next:2"`, `"a/b session"`, `"sonnet next:0"`/`"sonnet bogus"`/`"sonnet next high"`/`"sonnet high high"`→usage.
  `resolveRef`: member → its model; blank member → undefined; `provider/id` with `find` true → itself; `openrouter/qwen/x:free` → `find("openrouter", "qwen/x:free")`.
  Properties: ∀ N ∈ 1..6, applying `consume` N times to `{scope: "next", remaining: N}` yields exactly N live states, the
  last call `expired = true` and the result `{cleared: true}`; `effective` = command when live, else settings, for all four
  combinations; `rebuild` takes the last `FORCE_TYPE` entry and ignores other custom types and non-custom entries.
- **GREEN**: S5. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R.

#### L2.T2 Force log lines (router side) (AC-L2) `[x] done`
- **Files**: `core/outcome.ts` (KEYS, `forceEvent`, `spawnEvent` forced keys, empty `workerMember` omitted), `core/log.ts` (`force`, `spawn` passes `forced`), `test/force-log.test.ts` (new).
- **Depends**: L1 done. **Parallel**: with L2.T1, L2.T3.
- **RED**: `forceEvent` for each action has `taskId: ""`, `event: "force"`; `spawnEvent` with `forced` has the four keys,
  without it none of them (and `sample()`-style lines ⊆ `K_ALLOWED` of today); `start.member === ""` → no `workerMember`.
  "AC-L2": every string value of a force line ∈ `{action enum, source enum, reason enum, EFFORTS}` ∪ model refs
  (`/^[^\s/]+\/\S+$/`) ∪ `{""}` for `taskId`.
- **GREEN**: S8 (L2 part). **Check**: fast runner; `chk task-router typecheck-task-router`.
- **Keep green**: KG-R, `test/outcome.test.ts` unmodified, L1.T1 "outcome keys". **ACs**: AC-L2 (force).

#### L2.T3 Contract, analyse filter, LOGS.md (token-meter) (AC-L1) `[x] done`
- **Files**: `packages/token-meter/core/contract.ts`, `packages/token-meter/core/analyse.ts`, `packages/token-meter/test/contract.test.ts`, `packages/token-meter/test/analyse.test.ts`, `packages/token-meter/LOGS.md`.
- **Depends**: L1 done. **Parallel**: with L2.T1, L2.T2.
- **Read first**: `core/contract.ts`, `test/contract.test.ts`, `test/world.ts`, `core/analyse.ts` (~l.420–450), `LOGS.md` §task-router.
- **RED**: contract: a world plus `{event: "force", taskId: "", action: "set", source: "command", model: "anthropic/claude-sonnet-5-5", effort: "high"}`
  → `check = []`; without `action` → `["outcomes.action"]`; `action: "maybe"` → problem; a `spawn` with `forced: "yes"` → `outcomes.forced`;
  a `verdict` with `taskId: ""` → `outcomes.taskId` (only `force` may be empty). analyse: the report of `world()` and of
  `world()` + force lines have the same "task events without a spawn" item (`n` and examples).
- **GREEN**: S9 (L2 part) and the `TASK_EVENTS` filter; `LOGS.md`: the `force` row, the spawn's force fields (†), the
  common-fields line ("`taskId` … `""` on `force` lines").
- **Check**: fast runner (token-meter); `chk token-meter typecheck-token-meter log-contract`.
- **Keep green**: KG-L. **ACs**: AC-L1 (force).

#### L2.T4 `/force` command, session entries, settings force, status (AC-F3, AC-F4 part, AC-N3) `[x] done`
- **Files**: `core/forceinstall.ts` (new, S6), `core/shell.ts` (create it; `force.start(ctx, problems)` in the `session_start`
  handler before the problems notification; status uses `describeForce`), `core/local/mode.ts` (`statusText` force part, if not in L1),
  `test/force-shell.test.ts` (new), `test/local-default.test.ts` (one assertion).
- **Depends**: L2.T1, L2.T2.
- **Changes an existing test**: `local-default.test.ts` "inventory" `commands` `[]` → `["force"]` (why: AC-N3's final form, X9).
- **RED** (ctx fake: `modelRegistry.find` over a set of known `provider/id`, `getAvailable` → list, `ui.notify`/`setStatus` spies,
  `sessionManager.getBranch` over `f.entries` mapped to `{type: "custom", customType, data}`): "AC-F3": `/force nosuch/model` →
  state unchanged (`/force` shows "no force"), exactly one `error` notify with the S6 text, one `force` line `rejected`
  `reason: "unknown-model"`. "set/show/off": entries appended as S6; status `force anthropic/claude-sonnet-5-5 high (2 left)` in default mode, `local · force …` in local
  mode; `/force off` → status cleared (`setStatus(key, undefined)`) in default mode. "rebuild": a second `install` on the same
  entries → `/force` shows the restored force. "AC-F4 settings unresolvable": `settings.force.model: "nosuch/x"` → at the first
  `session_start` exactly one notify (the problems one) whose text contains `force.model: unknown model nosuch/x`; a `force`
  line `rejected` `source: "settings"`; `port.active()` undefined. "usage": `/force sonnet bogus` → warning + `rejected usage`.
- **GREEN**: S6; shell wiring (no new `pi.on`).
- **Check**: fast runner; `chk task-router typecheck-task-router`.
- **Keep green**: KG-R, L1.T1 hooks inventory (unchanged), `test/shell.test.ts` problems tests unmodified. **ACs**: AC-F3, AC-F4 (notify/problem/inactive), AC-N3 (`/force`), §2.5 force.

#### L2.T5 The policy's force branch (AC-F1, AC-F2, AC-F4 part, AC-F5) `[x] done`
- **Files**: `core/policy.ts` (S7), `core/guards.ts` (X6), `core/shell.ts` (`pd.force = force.port`; `onEvent` passes `forced`), `test/force-policy.test.ts` (new).
- **Depends**: L2.T4.
- **Read first**: `core/policy.ts` `resolveLeg`/`createPolicy`, `core/failover.ts`, `core/guards.ts`, `test/policy.test.ts` (explicit-model tests), `test/failover.test.ts`.
- **RED**: "AC-F1": `/force sonnet high next:2`, three all-t0 spawns (+ spawn events) → models sonnet, sonnet, `llama/qwen3.8`;
  spawn lines 1–2 `forced: true`, `forceSource: "command"`, `routedModel: "llama/qwen3.8"`, line 3 none of them; force lines
  `set, used, used, expired` (one `expired`). "AC-F2": a non-t0 card (routed to Sonnet) with `/force haiku max` → `model` Haiku's,
  `thinkingLevel: "max"`; the same card with explicit `model: <haiku>` and no force → `reject` (contrast). "AC-F4 precedence":
  resolvable settings force → every spawn forced `forceSource: "settings"`; `/force opus` → opus `command`; `/force off` → settings again.
  "AC-F5": a forced Sonnet child, then an API `error` event → no `retune`, no `reroute` line. "non-member": `/force other/model`
  (registry knows it, no member) → result model `other/model`, no wait, the spawn line has no `workerMember`; a `turn` event for it does not throw (X6).
  "routing off": with the `routing` flag off the force is not applied (D12).
- **GREEN**: S7; guards `?.`.
- **Check**: fast runner; `chk task-router typecheck-task-router router-golden`.
- **Keep green**: KG-R (all `policy.test.ts`, `failover.test.ts`, `explicit.test.ts` unmodified). **ACs**: AC-F1, AC-F2, AC-F4, AC-F5.

#### L2.T6 Log contract over the real force path `[x] done`
- **Files**: `checks/log-contract/contract.ts`.
- **Depends**: L2.T3, L2.T5.
- **RED/plant**: in `mainSession`, before the first spawn, `tr.f.commands.get("force").handler("sonnet high next:1", ctxWithRegistry)`
  (so one spawn is forced and `set/used/expired` are written); add `"force"` to the required outcome events. Plant §11 → red; remove.
- **Check**: `chk log-contract` red (plant) → green. **Keep green**: KG-L. **ACs**: AC-L1 (real path).

#### L2.T7 Docs and milestone close `[x] done`
- **Files**: `docs/pi-economics.md` (taskRouter: `/force` syntax and scopes, the settings `force`, precedence, overseers not
  forced (OQ5), the `force` event and spawn fields; Checks row of `task-router` unchanged).
- **Depends**: L2.T1–T6. **Check**: `chk leak boundary`; L2 sweep KG-R, KG-L, KG-M, KG-P.

### L3 — Hints and tripwires

#### L3.T1 Records, keys and the first detectors (AC-H1 part, AC-H3) `[x] done`
- **Files**: `core/local/tripwires.ts` (new: `TRIPS`, `CallRecord`, `windowSize`, `push`, `stableJson`, `callKey`, `errSig`,
  `trigramJaccard`, `changed`, identical-call, no-change-writes, alternation), `test/local-tripwires.test.ts` (new).
- **Depends**: L1 done. **Parallel**: with L3.T4, L3.T5, L3.T6.
- **RED**: `stableJson` order-independent (`{a,b}` = `{b,a}`); `errSig` (digits → `#`, whitespace, 500 cut); `trigramJaccard`
  symmetric, 1 on equal, 0 on disjoint. "AC-H1 identical-call/no-change-writes/alternation": for each trip a sequence of
  threshold − 1 qualifying records → `[]`, plus one → the trip; property over ≥ 200 random sequences (seeded, length ≤
  `windowSize`) built from 3 keys, 2 paths, random `changed`: the index of the first fire equals a reference counter
  written naively over the whole history (S10 definitions). "AC-H3": k, k, (changed write), k → no identical-call; k, k, k → fires.
- **GREEN**: S10 (these parts). **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R. **ACs**: AC-H1 (3 trips), AC-H3.

#### L3.T2 Remaining call and context detectors (AC-H1 part) `[x] done`
- **Files**: `core/local/tripwires.ts` (repeated-error, churn, risky-path, `contextSoft`, `contextStall` state functions), `test/local-tripwires.test.ts`.
- **Depends**: L3.T1. **Parallel**: with L3.T3.
- **RED**: per trip: threshold − 1 → none, threshold → fire; property against reference counters as in L3.T1 for
  repeated-error (sigs drawn from two templates with one digit varying, J ≥ 0.92 for same template) and churn (turns);
  risky-path fires once per path for a `riskGlobs` match and for a `pathRules` `critical` match, never for `high`;
  context-soft fires on the first crossing, not again until tokens fall below and cross again; context-stall fires at
  exactly `stallTurns` turns ≥ `contextPercent` without progress and resets on progress.
- **GREEN**: S10 rest. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R. **ACs**: AC-H1 (5 more trips).

#### L3.T3 Hint texts, cooldown, persistence (AC-H2 pure, AC-H4 L3 part) `[x] done`
- **Files**: `core/local/hints.ts` (new, S11), `test/local-hints-engine.test.ts` (new).
- **Depends**: L3.T1 (`Trip`). **Parallel**: with L3.T2.
- **RED**: `HINT_TEXT` under defaults pinned for all 10 trips (S11 literals); `block` format; engine: first detection →
  stage hint n 1; a second detection within `cooldownCalls` → nothing; detection `1 + persistTrips` → stage steer with
  `ESCALATION`, counts reset; `progress()` resets; property over random detection/progress streams: #escalations =
  Σ over progress-free runs of ⌊detections / (1 + persistTrips)⌋, and no two hints of one trip are ≤ `cooldownCalls` calls apart.
- **GREEN**: S11. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R. **ACs**: AC-H2 (pure), AC-H4 (L3).

#### L3.T4 Hint log line (router side) (AC-L2) `[x] done`
- **Files**: `core/outcome.ts` (`trip`, `stage`, `count` in KEYS; `hintEvent`), `core/log.ts` (`hint`), `test/hint-log.test.ts` (new).
- **Depends**: L2.T2 (same files). **Parallel**: with L3.T1–T3, L3.T5, L3.T6.
- **RED**: `hintEvent` shape; "AC-L2": every string value ∈ `TRIPS ∪ {hint, steer, parent} ∪ {"main"} ∪ ids` and no hint text
  reaches the line (`HINT_TEXT` outputs are not substrings of the serialized line).
- **GREEN**: S8 (L3 part). **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R, L1.T1 keys test. **ACs**: AC-L2 (hint).

#### L3.T5 Contract and LOGS.md for `hint` (AC-L1) `[x] done`
- **Files**: `packages/token-meter/core/contract.ts`, `packages/token-meter/test/contract.test.ts`, `packages/token-meter/LOGS.md`.
- **Depends**: L2.T3. **Parallel**: with L3.T1–T4, L3.T6.
- **RED**: a hint line `{taskId: "main", trip: "identical-call", stage: "hint", count: 1}` passes; without `trip` →
  `outcomes.trip`; `stage: "x"` → problem; analyse: hint lines do not change "task events without a spawn" (D20 already in place).
- **GREEN**: S9 (L3 part); `LOGS.md` `hint` row. **Check**: fast runner (token-meter); `chk token-meter typecheck-token-meter log-contract`. **Keep green**: KG-L. **ACs**: AC-L1 (hint).

#### L3.T6 `composeGuards` `[ ] todo`
- **Files**: `core/toolguard.ts`, `test/compose.test.ts` (new).
- **Depends**: L1 done. **Parallel**: with L3.T1–T5.
- **RED**: property over random guard tables: `composeGuards(g1, …, gk)(t, i)` = the first non-undefined `gj(t, i)`; every
  guard is called until the first block (call log); `composeGuards()` and `composeGuards(undefined)` → `undefined`.
- **GREEN**: S13 first part. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R (`test/guard.test.ts` unmodified). **ACs**: X1.

#### L3.T7 Main-session wiring (AC-H2, AC-H4 L3, AC-H5) `[ ] todo`
- **Files**: `core/local/install.ts` (new, S12), `core/shell.ts` (`installLocal(pi, {...})` after `installFreshOnCold`; status suffix if Q5 accepted), `test/local-hints.test.ts` (new).
- **Depends**: L3.T2, L3.T3, L3.T4.
- **Read first**: `core/fresh.ts` (the `tool_call`/`tool_result` note pattern), `test/fresh.test.ts`.
- **RED** (harness `{mode: "local"}`, `hash` from an in-memory map): "AC-H2": three identical `read` call/result pairs →
  the third `tool_result` returns `content` = original content + exactly one text block matching
  `^<router-hint trip="identical-call" n="1">`; the fourth adds nothing; one `hint` line `stage: "hint"`. "AC-H4 (L3)": the
  fifth identical pair appends the `ESCALATION` block; `api` saw no spawn; line `stage: "steer"`. "progress": an `edit`
  whose hash changes between repeats prevents the trip. "turn-end queue": usage ≥ `contextPercent` for `stallTurns` turns →
  the next `tool_result` carries `context-stall`. "AC-H5": `detect` that throws → `tool_call` results all `undefined`,
  `tool_result` returns `undefined` (content unchanged), one `console.warn`; a throwing `hash` likewise. "default mode":
  `{}` → the L1.T1 inventory is unchanged (no extra hooks); `{hints: {enabled: "on"}}` → hooks present (OQ11).
- **GREEN**: S12. **Check**: fast runner; `chk task-router typecheck-task-router`. **Keep green**: KG-R, L1.T1 inventory, `test/fresh.test.ts`. **ACs**: AC-H2, AC-H4 (L3), AC-H5.

#### L3.T8 Child tripwires through the composed guard (AC-H6) `[ ] todo`
- **Files**: `core/local/childtrips.ts` (new, S13), `core/policy.ts` (compose when `isLocal(s) && componentOn(s, "hints")`), `core/shell.ts` (`pd.childGuard`, `forget` on `kill`), `test/local-child-hints.test.ts` (new).
- **Depends**: L3.T6, L3.T7 (same `shell.ts`).
- **RED**: "AC-H6": local mode, a routed child `c1` (profile `all`, so today no guard); call its `toolGuard("read", {path: "a"})`
  three times → `a.sent` has one `{to: "c1", text: /^<router-hint trip="identical-call"/, from: "router"}`; two more →
  one `{to: "main", text: "[router] c1 looks stuck (identical-call ×3); consider killing it and respawning with attemptOf"}`;
  every guard call returned `undefined` (plant §11); a `read-only+files` child still gets the files block for a foreign path
  (composition keeps it); default mode → `toolGuard` of an `all` child is `undefined` (unchanged); a `kill` event drops its state.
- **GREEN**: S13. **Check**: fast runner; `chk task-router typecheck-task-router router-golden`. **Keep green**: KG-R. **ACs**: AC-H6.

#### L3.T9 Log contract over the real hint path `[ ] todo`
- **Files**: `checks/log-contract/contract.ts`.
- **Depends**: L3.T5, L3.T7.
- **RED/plant**: a second harness `harness({agentDir, settings: {mode: "local"}})` in `mainSession`, three identical
  `tool_call`/`tool_result` pairs → one `hint` line; add `"hint"` to the required events; plant §11 → red; remove.
- **Check**: `chk log-contract`. **Keep green**: KG-L. **ACs**: AC-L1 (real path).

#### L3.T10 Docs and milestone close `[ ] todo`
- **Files**: `docs/pi-economics.md` (taskRouter: hints, the trips shipped in L3 and their settings, cooldown/persistence,
  child hints, the `hint` event; that `check-failing`/`over-size` arrive with worktrees).
- **Depends**: L3.T1–T9. **Check**: `chk leak boundary`; L3 sweep KG-R, KG-L, KG-M, KG-P.

## 15. Order and parallelism

```
L1: T1 ─┬─ T2 ─┬─ T3
        │      ├─ T4
        │      └─ T5 ── T6
        T7 (independent, any time) ─────────────── T8 (after all)
L2: {T1 ∥ T2 ∥ T3} ── T4 (needs T1,T2) ── T5 ── T6 (needs T3,T5) ── T7
L3: T1 ─┬─ T2 ─┐
        └─ T3 ─┼─ T7 (needs T2,T3,T4) ── T8 (needs T6) ── T9 (needs T5) ── T10
    T4, T5, T6 ∥ (any time after L2)
```

File-disjointness of the parallel groups: L1 {T3: `core/local/settings.ts`+`test/local-settings…`; T4: `core/policy.ts`+`test/local-routing…`;
T5: `core/prompt.ts`,`core/shell.ts`+`test/local-prompt…`; T7: Nix}; L2 {T1: `core/force.ts`; T2: `core/outcome.ts`,`core/log.ts`;
T3: token-meter}; L3 {T2 vs T3: `tripwires.ts` vs `hints.ts`; T4: outcome/log; T5: token-meter; T6: `toolguard.ts`}.
`core/shell.ts` is touched by L1.T5, L1.T6, L2.T4, L2.T5, L3.T7, L3.T8 (strictly sequential); `core/policy.ts` by L1.T4,
L2.T5, L3.T8.

## 16. Open questions (each with a recommendation; the parent decides)

1. **Q1 Plan location.** AGENTS.md says the repository holds no plans. *Recommend* keeping this file untracked or moving it
   to the author's system configuration before the first commit of L1.
2. **Q2 Release.** Bump `version` at the end of L1/L2/L3? *Recommend* one release after L3 (AGENTS.md "Versions" steps).
3. **Q3 `/force off` with a settings force.** Clear only the command force (settings force resumes; design's `{cleared: true}`)
   or suppress all forcing for the session? *Recommend* the former, with the notify text saying the settings force applies.
4. **Q4 Status in default mode with a force.** *Recommend* `force <model> <effort>` alone; never touch the status otherwise (X12).
5. **Q5 "A status entry" for hints** (X13). *Recommend* the status suffix `· hint <trip>` until the next progress; no session
   entry (not in design §3.0.2).
6. **Q6 Force with `routing` off** (experiments arm). *Recommend* not applied (D12); `/force` notify says so when routing is off.
7. **Q7 Hint texts.** Model-facing texts for alternation, repeated-error, churn, risky-path, context-stall and the escalation
   are proposals (S11); check-failing says "2 times" for "twice". *Recommend* approving S11 as pinned text.
8. **Q8 The `<router-hint>` sentences of the local section when `hints.enabled = "off"`.** *Recommend* keeping them (design text);
   revisit in L5 when the section gets its `active` parameter.
9. **Q9 Parent notices** once per (child, trip) (D18) vs repeating. *Recommend* once.
10. **Q10 Forced effort off the forced member's ladder** (D11). *Recommend* literal, as designed.
11. **Q11 `overseer.tools` containing a writer** (`bash`, `edit`, `write`): reject in validation now or in L4? *Recommend* L4.
12. **Q12 `plans.regression` values.** The design names `milestone`/`plan`; *recommend* adding `off` as the third value.

## 17. Top risks

- R1 Real pi payload shapes differ from the fakes (G1–G3): hints silently never fire, or the status/command calls throw.
  Mitigation: every handler is total (`?.`, try/catch); the manual runbook at each milestone end.
- R2 Default-mode drift: a new hook, key or problem in default mode. Mitigation: L1.T1's frozen inventory and key tests,
  D2, `router-golden`.
- R3 `appendEntry` from inside the spawn policy (forced countdown) during a tool call of the main session (G2).
- R4 The child guard runs on the actor's hot path for every child call; it must stay O(window) and never throw.
- R5 `pi-analyse` reports: new events must not shift any section; covered for data quality (D20), other sections only by
  the log-contract run.

## 18. Resolutions (parent)

- Q1: the plan stays in `docs/local-mode/` (the user asked for everything in this repository; an exception to
  AGENTS.md's "no plans" rule for this feature).
- Q2: no version bump in L1–L3; a release is a separate step after L3, on request.
- Q3–Q12: the recommendations are accepted as written (Q7: S11 texts pinned).
