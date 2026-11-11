# Local mode: design and specification

Status: design, not implemented. Decisions marked **LD** are this document's. The user's decisions it builds
on (§1) are settled and are not reopened here. Research in `docs/research/` is general advice whose numbers are
unreliable (`docs/research/README.md`). Every number below is a starting value, configurable and tuned with the
meter, unless the text says otherwise.

Terms. *Qwen*: the local model, member `qwen-local` (`llama/qwen3.8`, one server slot). *Main*: the foreground
pi session, whose model the user sets. *Router*: `packages/task-router`. *Actor*: the patched
`pi-actor-subagents` (`packages/actor-subagents`). *Overseer*: an Opus child with read-only tools and a typed
verdict. *Worktree branch*: a feature branch checked out in its own git worktree. *Main branch*: a branch named
in `mergeGate.mainBranches` (§3.4).

## 1. Intent

Local mode is a profile in which Qwen drives the main session and does most work itself. Claude Haiku, Sonnet
and Opus run only as subagents, for subtasks that need more ability or when Qwen is stuck. Opus also oversees:
it reviews merges, writes plan skeletons, reviews plan amendments, and steers a persistent loop. No human takes
part in any routing or oversight decision. The user keeps manual control through `/force` (§3.6) and through
their own `!` commands. The router never blocks those commands (`user_bash` is not hooked).

### 1.1 Goals

- G1. Most tokens go to Qwen (cost 0). Claude is paid for ability and oversight, not for routine work.
- G2. A weak model's mistakes cannot reach the main branch unreviewed. Merging into it is a binding,
  mechanical gate: an Opus approval bound to the reviewed commit.
- G3. The harness measures what goes wrong (check failures, retries, churn, loops, size, risky paths) and
  tells Qwen. A persistent problem escalates without a human.
- G4. Increments stay small: 1–2 files and about 60 net changed lines per task, a merge diff of at most
  150 lines.
- G5. Work that spans more than one branch follows a plan. Opus writes its skeleton, and an Opus delta review
  approves every change to it.
- G6. Default mode is unchanged: same decisions, same golden files, same prompt text, same log lines.

### 1.2 Non-goals

- N1. Setting the main session's model. The user does that in pi, and the router routes subagents only.
- N2. A learned router or a CPU classifier. Qwen decides by writing task cards. A classifier may come later.
- N3. Defence against an adversary. The merge gate guards against the local model's mistakes. A command that
  hides a merge from the parser (variables, scripts, writes under `.git/`) is out of scope. §3.4.6 detects it
  afterwards; it does not prevent it.
- N4. More than one llama slot. Qwen children queue behind the main session, and that queueing is accepted.
- N5. Interactive approval. There is no prompt, confirmation dialog or wait for the user in any flow.

### 1.3 Anti-goals (things the design must not do)

- A1. Read Qwen's self-assessed confidence as a signal. The router reads only what it measures (card t0 flags
  stay as today: code can only lower them).
- A2. Let Opus work in an overseer role. The overseer has no write tools, puts no code or plan bodies in its
  verdict, and its approval is computed by the harness, not stated by it.
- A3. Let advisory text substitute for a binding gate. Merges and plan changes are refused mechanically.
  Hints only advise (research: weak models ignore advisory critique).
- A4. Silently refuse a user's force. A force is honoured, or rejected with a visible message and a log line.
- A5. Change a default-mode decision, or re-record the golden files.

## 2. Switching local mode on, and what changes

### 2.1 Switch

- Settings key `mode` in `<agentDir>/task-router/settings.json`: `"default"` (the default) or `"local"`.
- Home Manager: `programs.piEconomics.taskRouter.localMode.enable` (bool, default false). When true, the module
  defines `taskRouter.settings.mode = lib.mkDefault "local"`, so the settings file is written even when
  `settings` was `{}`.
- There is no auto-detection: a session whose main model is not Qwen still runs in local mode when `mode` is
  `"local"`. The status line shows it (§2.5).
- Each local-mode component has its own toggle, `enabled: "auto" | "on" | "off"` (default `"auto"`):
  `hints`, `overseer` (implied by the components that need it), `worktrees`, `mergeGate`, `plans`. `"auto"`
  means on in local mode and off in default mode. `"on"` turns a component on in default mode later (§7 OQ11).
  `force` (§3.6) works in both modes.

New HM assertions (each has a negative case in `checks/module-eval/cases/task-router.nix`):

| Condition | Message |
|---|---|
| `localMode.enable && !taskRouter.enable` | `pi-economics: taskRouter.localMode.enable requires taskRouter.enable` |
| `localMode.enable && settings.mode` set to something other than `"local"` | `pi-economics: taskRouter.localMode.enable needs taskRouter.settings.mode = "local" (found "<x>")` |
| `localMode.enable && spawnPolicyApi < 2` | `pi-economics: taskRouter.localMode requires actorSubagents with passthru.spawnPolicyApi >= 2 (the overseer spawns review agents through the API's spawn and childTools)` |

The existing assertion `pi-economics: taskRouter requires actorSubagents with passthru.spawnPolicyApi >= 1 (…)`
stays.

### 2.2 Routing in local mode

The routing table, its members, the abilities, the levels and `planSpawn` are unchanged. Qwen already is the
level-0 `write`/`read` member at cost 0, so cheapest-fit sends level-0 work to Qwen and the rest to Claude.
`mode: "local"` changes only these:

1. **Importance.** The main session's effort is not used as an importance source. Today `FROM_EFFORT`
   (`core/importance.ts`) maps a main at `xhigh` to `high`, and `qwen-local` offers only `xhigh`. Every child of
   a Qwen main would therefore be `high`, which in the write-0 row means a Qwen worker plus a Sonnet review
   leg. The card's `importance`, the parent's importance and `pathRules` still count. (LD1)
2. **Default child cwd.** While a worktree is active (§3.3), a card without `cwd` gets the active worktree.
   The Actor API extension (§3.0.4) also lets the policy start the child session in that directory. (LD2)
3. **Composed tool guard for every routed child.** The git guard (§3.4.5), the plan guard (§3.5.6) and the
   call tripwires (§3.1.3) are composed with the existing `read-only+files` guard (`composeGuards`,
   `core/toolguard.ts`).
4. **Delegation nudge off, orchestrator rule off.** Both were designed for a strong main model that should
   delegate. Local mode replaces them with hints (§3.1). This holds even when an experiments arm sets
   `delegationRule`. (LD3)
5. **Router-internal spawns.** These are overseers and the merge fixer. They carry a one-time ticket in
   `task.ticket`. The policy recognises the ticket and returns the ticket's pinned member, tools, child tools,
   guard and cwd, without card routing (§3.2.2).

The single slot: a Qwen child spawned by a Qwen main waits in `resolveLeg` until the slot is free (today's
queue rules, `queueMaxSec`). The main is inside a tool call while it spawns, so the server is idle and the
child usually starts at once. Afterwards the two alternate per request, and each switch re-reads the other
context. The section text (§2.3) therefore tells the main to end its turn after a spawn. (Accepted per N4;
measure it with the meter.)

### 2.3 The prompt section for a Qwen main

In local mode, `before_agent_start` sets `sections.task_cards` to `localSection(settings)`
(`core/prompt.ts`) instead of `cardSection`. Children still get no section, and rejections still embed
`cardSchema`. The section is short: it keeps rules, field names and one example, and drops the strategy
prose. Its exact text is part of the acceptance criteria (AC-R3); it is cache-stable (no per-turn values):

```
## Local mode

You do most of the work yourself. Spawn a subagent only when a task needs more ability than yours
(design, security, concurrency, an unknown root cause) or when a <router-hint> says so. After spawning,
end your turn; the child's report wakes you.
Code changes happen on branches: start_branch, then edit and commit in its worktree (absolute paths),
then request_merge. You cannot merge, push or commit to a main branch; the router blocks it.
A request that needs more than one branch starts with plan_request. Follow the plan file, tick only your
task's checkbox, and change the plan only with amend_plan.
<router-hint> notes report what the router measured. Act on them.

Task card (spawn_subagent `task`; do not set model or thinkingLevel):
<cardSchema(settings), unchanged>
{"kind":"debug-design","files":["src/a.ts"],"check":"npm test -- a","acceptance":["a() handles empty input"],
 "t0":{"bounded":true,"specified":true,"verifiable":true,"lowRisk":true,"small":true,"linear":true},"t2":[]}
```

The lines about branches and plans appear only when `worktrees`/`mergeGate` and `plans` are active
(`localSection` takes the active set).

### 2.4 Hints instead of the nudge

`installNudge` gets `enabled() = false` in local mode. The hint engine (§3.1) appends its notes to tool results.
The nudge's steer messages would interrupt Qwen mid-task.

### 2.5 Status and visibility

At `session_start` the router sets the status line `task-router` to `local` (in default mode it sets nothing).
When a force is active it adds `· force <model> <effort> [(<n> left)]`, and when the Opus budget is low it adds
`· opus <n> left`.

### 2.6 What does not change (default mode)

With `mode: "default"`, every component `"auto"` and no force, the router registers the same tools and hooks as
today. No new hook returns a value, `sections.task_cards` is byte-identical, and no outcome line carries a new
key. `planSpawn`, `acceptModel` (`core/explicit.ts`) and `resolveLeg` are untouched, so the router-golden files
stay as they are. A force goes around `acceptModel` instead of changing it (§3.6). (LD4)

## 3. Components

### 3.0 Shared pieces

#### 3.0.1 Settings (new keys in `core/settings.ts` `defaults()`, so `merge()` accepts them)

```json
{
  "mode": "default",
  "hints": {
    "enabled": "auto",
    "identicalCalls": 3, "noChangeWrites": 4, "alternations": 2,
    "repeatedErrors": 2, "errorSimilarity": 0.92,
    "churnEdits": 3, "churnTurns": 4,
    "checkFailures": 2,
    "contextPercent": 85, "stallTurns": 25, "contextSoftTokens": 32000,
    "cooldownCalls": 5, "persistTrips": 2, "steer": "on"
  },
  "overseer": {
    "member": "opus", "effort": "high",
    "fallbackMember": "sonnet", "fallbackEffort": "xhigh",
    "budget": 15, "steerBudget": 3,
    "timeoutSec": 900, "resubmits": 2,
    "tools": ["read", "grep", "find", "ls"]
  },
  "worktrees": { "enabled": "auto", "root": "../{repo}.worktrees", "branchPrefix": "lm/", "removeAfterMerge": true },
  "mergeGate": {
    "enabled": "auto", "mainBranches": ["main", "master"],
    "maxDiffLines": 150, "maxDiffFiles": 6, "extraChecks": [], "redRun": true,
    "rejectionsBeforeFixer": 2, "fixerMember": "sonnet", "fixerEffort": "high", "fixerRounds": 1,
    "push": false, "remote": "origin"
  },
  "plans": {
    "enabled": "auto", "dir": "docs/plans",
    "taskFiles": 2, "taskLines": 60, "splitFiles": 3, "splitLines": 100,
    "milestoneTasks": 5, "milestoneLines": 250, "taskTurns": 12,
    "rounds": 2, "regression": "milestone", "publicApiGlobs": []
  },
  "force": { "model": "", "thinkingLevel": "" }
}
```

Validation adds these to `problems`, which are shown once at `session_start`:

- `mode` is not one of `default`/`local`.
- `enabled` is not one of `auto`/`on`/`off`.
- `overseer.member`, `fallbackMember` or `fixerMember` is not an enabled member.
- An effort is not offered by the member it names.
- A count is ≤ 0, or a percent or similarity is out of range.
- `mergeGate.mainBranches` is empty.
- `force.model` cannot be resolved. This is checked at `session_start` with `ctx.modelRegistry`; the force stays
  inactive and the user is notified (§3.6).

#### 3.0.2 Session state

Session state lives in memory. Every change is persisted with `pi.appendEntry(customType, data)` and rebuilt at
`session_start` from `ctx.sessionManager.getBranch()`. It never goes into the LLM context.

| customType | data |
|---|---|
| `task-router/force` | `{ model, thinkingLevel?, scope: "session" \| "next", remaining?, source: "command" }` or `{ cleared: true }` |
| `task-router/branch` | `{ repo, branch, worktree, base, plan?: {slug, id}, state: "active" \| "merged" \| "abandoned" \| "fixer", rejections }` |
| `task-router/review` | `{ reviewId, role, member, commit?, verdict (full JSON), approved, ts }` |
| `task-router/approval` | `{ repo, branch, commit, tree, reviewId }` |
| `task-router/plan` | `{ slug, file, skeletonHash, approvedBy, triggers: [...] }` |
| `task-router/budget` | `{ opusUsed, steerUsed }` |
| `task-router/main-ref` | `{ repo, branch, sha }` (last known main sha, §3.4.6) |

#### 3.0.3 Outcome log records

The log stays text-free (`core/outcome.ts`: no card text, no prompt text, no finding text). New events and keys
are added to `KEYS`, and the log contract is updated with them: `packages/token-meter/core/contract.ts` (the
`event` enum and the per-event rules) and `packages/token-meter/LOGS.md`. The `log-contract` check runs every
writer through `pi-analyse --check`. Session-level events use `taskId: ""`.

| event | required | optional |
|---|---|---|
| `hint` | `taskId` (`"main"` or the child name), `trip`, `stage` (`"hint"`\|`"steer"`\|`"parent"`) | `count`, `sessionId` |
| `review` | `taskId` (reviewId), `role` (`merge`\|`plan-author`\|`plan-review`\|`delta`\|`steer`), `member`, `model`, `outcome` (`approve`\|`revise`\|`invalid`\|`timeout`\|`error`) | `blocking`, `findings` (counts), `fallback` (`"budget"`\|`"error"`), `inconsistent` (bool), `attempt`, `durationMs`, `commit`, `branch` |
| `merge` | `taskId` (branch), `outcome` (`merged`\|`refused`\|`revise`\|`fixer`\|`failed`) | `reason` (a fixed code, §3.4.3), `commit`, `nLines`, `nFiles`, `reviewId`, `pushed` |
| `plan` | `taskId` (plan slug), `action` (`skeleton`\|`approve`\|`trigger`\|`amend`\|`reject`) | `trigger` (code), `nTasks`, `reviewId`, `full` (bool) |
| `force` | `taskId: ""`, `action` (`set`\|`clear`\|`used`\|`expired`\|`rejected`), `source` (`command`\|`settings`) | `model`, `effort`, `reason` |
| `gatebypass` | `taskId` (branch), `from`, `to` (shas) | `repo` |

`spawn` gets these optional keys:

- `forced: true`, `forceSource`, and `routedModel`/`routedEffort` (what routing would have chosen), when a force
  is active.
- `ticket: "<role>"` for router-internal spawns.

#### 3.0.4 Actor API extension (spawnPolicyApi 2)

There is no way today for the router to spawn an agent or to receive its result. The verified API offers only
`registerSpawnPolicy`, `subscribe`, `retune`, `send` and `list`. Route events carry a 60-character preview, and
`engine.route` has no `router` endpoint. Two alternatives were rejected (LD5):

- A direct model call with a hand-written tool loop. It would bypass the Actor's sessions, panel, meter and
  retry handling.
- Asking Qwen to spawn the reviewer. Qwen would relay, or could fabricate, the verdict.

Instead, a new patch, `patches/pi-actor-subagents/pi-actor-subagents-spawn-api.patch`, applied after the
spawn-policy patch, adds optional members. `version` stays 1, so `hasSubagentsApiV1` and the four
`runtime-guard.ts` copies are untouched. The package passthru becomes `spawnPolicyApi = 2`.

```ts
// api.ts (provider) and core/api.ts (router's copy, iface-subagents-task-router compares them)
export type ChildTool = {
  name: string; description: string;
  parameters: Record<string, unknown>;            // JSON Schema object (TypeBox-compatible at runtime)
  execute(input: unknown): Promise<{ text: string; isError?: boolean; terminate?: boolean }>;
};
export type PolicyResult =
  | { model: string; thinkingLevel: ThinkingLevel; briefAppend?: string; tools?: string[]; meta?: unknown;
      toolGuard?: ToolGuard;
      childTools?: ChildTool[];   // NEW: appended to the child's customTools and to its allowlist
      cwd?: string }              // NEW: the child session's cwd (absolute); default: today's
  | { reject: string };
export interface SubagentsApiV1 {
  // ... v1 members unchanged ...
  /** NEW (spawnPolicyApi ≥ 2): spawn like spawn_subagent from `by` (default "main"), through the registered policy.
   *  quiet: no lifecycle notices to `by`. Resolves once the child exists. */
  spawn?(args: SpawnArgs, opts?: { by?: string; quiet?: boolean }): Promise<{ ok: true; name: string; sessionId: string } | { ok: false; reason: string }>;
  /** NEW: kill as the actor 'api' (main's authority); resolves with the names taken down. */
  kill?(names: string[]): Promise<string[]>;
}
```

**Quiet agents answer only to the API (LD13).** The actor's rule "who spawns, owns" would give the spawner of
`api.spawn` (`main`, which is Qwen in local mode) full authority over its overseer: it could message it (shown as
`[message from main]`), retune it (retunes bypass the spawn policy), pause or kill it, and so shape an independent
review. In the patch a quiet agent therefore answers only to the API and the human: `send_message`,
`set_subagent_model`, `pause_subagents`, `resume_subagents` and `kill_subagents` refuse it for every agent, its
spawner and itself included ("'<name>' was spawned quietly through the API; only the API and the user act on
it"), and a pause or resume without names leaves it out. `list_subagents` and `subagent_history` still show it.
`api.kill` acts as the actor `api` (main's authority, a reserved name like `user` and `restore`); `api.send`
reaches it (sender `router`); `api.retune` acts as `main` and is refused, so an overseer keeps its ticket's model.
The human's commands (`user`) and panel input still reach it. The flag is set at the reservation, so the rule holds
while the child's session is created. Rejected: a `tool_call` guard in task-router that blocks these tools for
ticket children (it covers only the main session, and only while the router is loaded).

**A quiet agent has no agent preamble (review F3).** The actor appends its agent preamble to every child's
system prompt: the tools for reaching other agents, "end your turn with send_message", and a handshake ("your
FIRST turn must send_message to your spawner … then END YOUR TURN and wait for a go-ahead"). A quiet child
can use none of it (its guard blocks the agent tools, LD13 keeps agents away), and no go-ahead comes: it would
end its first turn idle, take the reminder, and end the next one idle too, which fails the attempt. In the
patch a quiet child's prompt is pi's own plus the caller's `systemPrompt`, without the preamble. The overseer's
prompt also says it ("No one answers you and no go-ahead comes: start at once, and end by calling <tool>.").
Rejected: only that sentence in the overseer's prompt against the preamble (two contradicting instructions,
and the preamble's "CRITICAL" outranks a one-liner); a policy flag to drop the preamble (every API caller that
spawns quietly needs it dropped, so the flag would only be one more thing to forget).

The router detects the extension with `typeof api.spawn === "function" && typeof api.kill === "function"`
(`core/local/overseer.ts`). If it is missing in local mode, the router warns once ("task-router: local mode needs
actor-subagents with spawnPolicyApi ≥ 2; merges are refused and plans are unavailable"). The merge gate then
fails closed: it refuses merges, and the bash guard still blocks merges to main. The user can still merge with
`!git merge`.

### 3.1 Hint engine and tripwires

#### 3.1.1 Behaviour

The router observes the main session's tool calls through `tool_call`/`tool_result` and keeps a ring of the last
`window = 4 × identicalCalls + 8` call records: `{tool, key, isWrite, path?, fileHashBefore/After?, isError,
errSig?, exit?, turn}`. Here `key = tool + stable-JSON(input)` and `errSig` = the error text lowercased, digits
replaced by `#`, whitespace collapsed, first 500 characters. A pure detector (`core/local/tripwires.ts`)
evaluates the ring after every `tool_result` and every `turn_end`:

| trip | fires when (defaults) |
|---|---|
| `identical-call` | the same `key` 3 times, with no successful write between the first and the last |
| `no-change-writes` | 4 consecutive `edit`/`write` results that left the target file's hash unchanged (failed or no-op edits) |
| `alternation` | the last 4 keys form A, B, A, B (`alternations: 2`), with no tree change between them |
| `repeated-error` | 2 consecutive failing calls of the same tool whose `errSig`s have character-trigram Jaccard ≥ 0.92 |
| `churn` | the same path written by ≥ 3 calls within the last 4 turns |
| `check-failing` | the task's check command (§3.3, §3.5; whitespace-normalised equality with the bash command) exits ≠ 0 twice in a row |
| `over-size` | after a write, the active worktree's diff against base (staged, unstaged and committed) exceeds `plans.splitLines` or `splitFiles` |
| `risky-path` | a write to a path matching `riskGlobs` or a `pathRules` entry of importance `critical` (once per path) |
| `context-soft` | context tokens (`ctx.getContextUsage()`) first exceed `contextSoftTokens` (fires again after a fold drops below it) |
| `context-stall` | context ≥ 85 % and no progress for 25 turns |

*Progress* means a tree change (a write that changed a hash, or a new commit in the active worktree), a passing
check, or a merge. Progress resets the `context-stall` counter and the persistence counters.

#### 3.1.2 Delivery and escalation

- **Hint.** The tool result of the call that tripped gets one extra text block,
  `<router-hint trip="<trip>" n="<count>"><fixed text></router-hint>` (the pattern of `core/fresh.ts`). The
  router also appends a `hint` log line and a status entry. Texts are fixed per trip (examples below) and
  carry no model-generated content. A trip kind that fired stays quiet for `cooldownCalls` calls.
- **Steer.** When the same trip fires `persistTrips` more times after its hint, with no progress in between,
  and `hints.steer` is on and `overseer.steerBudget` has room, the router runs an overseer of role `steer`
  (§3.2). Its input: the trip, the last 12 call records rendered as one line each (tool, path or command,
  exit/error signature; no bodies), the focal diff (≤ 80 lines), the task goal and check. Its findings reach
  Qwen as a steer message (`pi.sendMessage({customType: "task-router/steer", …}, {deliverAs: "steer"})`). When
  the budget is exhausted, the router sends a fixed escalation hint instead: "spawn a debug-design card for
  this; the router will route it to Sonnet or above". A `steer` overseer that fails is skipped; it is advisory
  and fails open.
- **Retries.** These stay with today's mechanisms (`attemptOf`, `autoEscalate`, the verify gate). The hint
  engine adds `check-failing` for the main session only.

Example fixed texts:

- identical-call: "You ran this exact call 3 times; its result will not change. Use the result you have, or
  change the approach."
- no-change-writes: "4 writes changed nothing. Re-read the file before editing; oldText must match exactly."
- check-failing: "The check failed twice in a row. If the cause is unclear, spawn a debug-design card (files,
  check, acceptance)."
- over-size: "This branch exceeds 100 changed lines or 3 files. Commit what passes and split the rest."
- context-soft: "Context is above 32k tokens. Fold finished work or hand off with a task card."

#### 3.1.3 Children

The router is not loaded in children (`forChildren = false`), so it sees a child's calls only through its
`toolGuard`. That gives call records without results. For children the router evaluates `identical-call` and
`alternation` on calls alone. On a trip it sends a hint with `api.send(child, "<router-hint …>", "router")`,
which never blocks the call. When the trip persists, it notifies the parent:
`api.send(parent, "[router] <child> looks stuck (<trip> ×n); consider killing it and respawning with attemptOf", "router")`.
No Opus is involved for children. `attemptOf` already escalates one level up.

#### 3.1.4 Failure handling

Detectors are pure and total. An exception inside a hook is caught and logged once, and the result passes
through unchanged. A hint must never block a tool, because pi treats a throwing `tool_call` handler as a block.
Computing a file hash that fails (missing file, unreadable) records `undefined` and that call does not count.
`git` calls for `over-size` run with a 5 s timeout; on a timeout the trip is skipped.

### 3.2 Overseer

#### 3.2.1 Roles

| role | trigger | input (rendered by the router) | output tool | binding |
|---|---|---|---|---|
| `merge` | `request_merge` | branch goal (plan section or `goal`), diff `base..commit` (≤ 150 lines), numstat, check outputs (exit codes, last 4 kB each), red-run result, risky paths, plan invariants | `submit_verdict` | yes |
| `plan-author` | `plan_request` | request digest, acceptance criteria, Qwen's grounding (files, symbols), repo map (`git ls-files`, first 400 paths), limits | `submit_plan` | (output is the skeleton) |
| `delta` | `amend_plan` | trigger and its evidence, the old tasks, the proposed tasks, dependants | `submit_verdict` | yes |
| `plan-review` | `amend_plan` with full re-review (§3.5.4) | the whole plan with the amendment applied | `submit_verdict` | yes |
| `steer` | a persistent trip (§3.1.2) | as in §3.1.2 | `submit_verdict` | no (advisory) |

Every role uses read-only tools (`overseer.tools`, with no bash: `bash` can write). The cwd is the worktree or
repository under review. The system prompt says: auditor, not author; derive the invariants from the goal
before reading the diff or plan; report only through the submit tool; findings name a target and a verifiable
fix criterion; no code, no replacement plan; no one answers and no go-ahead comes, so start at once and end
with the submit tool (§3.0.4, review F3).

#### 3.2.2 Invocation

1. **Budget.** If `opusUsed < overseer.budget` (`steer`: also `steerUsed < steerBudget`), the member is
   `overseer.member`/`effort`. Otherwise it is `fallbackMember`/`fallbackEffort`, logged as `fallback: "budget"`
   (`steer` is skipped instead).
2. **Ticket.** The router creates a ticket (128-bit random, single use) and stores
   `{role, member, effort, cwd, tool, resolve, reject}` under it.
3. **Spawn.**

   ```
   api.spawn({ name: "ovs-<role>-<n>", systemPrompt, message: input, task: { ticket } }, { by: "main", quiet: true })
   ```

   The router's own policy sees `task.ticket` and returns the following, with no card parsing:

   ```
   { model, thinkingLevel: effort, tools: overseer.tools,
     childTools: [submitTool], cwd,
     toolGuard: blocks every tool outside overseer.tools ∪ {submitTool.name}, including send_message and spawn_subagent,
     meta: { taskId: reviewId, role } }
   ```

   An unknown ticket falls through to card routing, so a forged ticket is just a card without its fields.
4. **Await.** `submitTool.execute(input)` validates the input (§3.2.3).
   - Invalid input returns `{text: "invalid: <reasons>; resubmit", isError: true}`, up to `resubmits` times.
     After that the outcome is `invalid`.
   - Valid input resolves the ticket and returns `{text: "recorded", terminate: true}`.

   The router then calls `api.kill([name])`. If the child goes idle without submitting, the router sends one
   reminder with `api.send(name, "Submit with <tool>.")`. A second idle, an `error`/`kill` event, or
   `timeoutSec` rejects the ticket.
5. **Failure.** On a rejected ticket the router retries once with `fallbackMember` (`fallback: "error"`). If
   that fails too:
   - `merge`, `delta`, `plan-review`: the calling tool returns `error: review unavailable`; nothing is merged
     or amended (fail closed).
   - `plan-author`: `plan_request` fails, and Qwen may retry later.
   - `steer`: skipped.

#### 3.2.3 Verdict schema (`submit_verdict.parameters`)

```json
{
  "type": "object", "additionalProperties": false,
  "required": ["verdict", "summary", "findings"],
  "properties": {
    "verdict": { "enum": ["APPROVE", "REVISE"] },
    "summary": { "type": "string", "maxLength": 500 },
    "findings": { "type": "array", "maxItems": 20, "items": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "category", "target", "defect", "evidence", "fix", "blocking"],
      "properties": {
        "id": { "type": "string", "pattern": "^F[0-9]{1,2}$" },
        "category": { "enum": ["correctness", "check", "scope", "plan", "interface", "security", "concurrency",
                               "data-loss", "performance", "maintainability", "approach"] },
        "target": { "type": "string", "maxLength": 200, "description": "path[:line] or plan task id" },
        "defect": { "type": "string", "maxLength": 400 },
        "evidence": { "type": "string", "maxLength": 400 },
        "fix": { "type": "string", "maxLength": 300, "description": "required-fix criterion: a checkable condition, not code" },
        "blocking": { "type": "boolean" }
      } } }
  }
}
```

The harness adds these rules (`core/local/verdict.ts`, pure):

- V1. Reject the verdict for resubmission when a string contains a fence (```` ``` ````), finding ids repeat,
  or a `target` names neither a path in the reviewed diff or plan nor a plan task id.
- V2. `approved = findings.every(f => !f.blocking)`. The `verdict` field is advisory. A mismatch is logged as
  `inconsistent: true` and the harness value stands.
- V3. Qwen receives one line per finding: `F1 [blocking] correctness src/a.ts:42: <defect>. Evidence: <evidence>. Fix when: <fix>`.

#### 3.2.4 Plan skeleton schema (`submit_plan.parameters`)

```json
{
  "type": "object", "additionalProperties": false, "required": ["milestones", "invariants"],
  "properties": {
    "invariants": { "type": "array", "maxItems": 12, "items": { "type": "string", "maxLength": 200 } },
    "milestones": { "type": "array", "minItems": 1, "maxItems": 8, "items": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "goal", "acceptance", "branch", "dependsOn", "tasks"],
      "properties": {
        "id": { "type": "string", "pattern": "^M[0-9]{1,2}$" },
        "goal": { "type": "string", "maxLength": 300 },
        "acceptance": { "type": "array", "maxItems": 8, "items": { "type": "string", "maxLength": 200 } },
        "branch": { "enum": ["milestone", "task"] },
        "dependsOn": { "type": "array", "items": { "type": "string" } },
        "tasks": { "type": "array", "minItems": 1, "items": {
          "type": "object", "additionalProperties": false,
          "required": ["id", "goal", "files", "forbidden", "check", "dependsOn"],
          "properties": {
            "id": { "type": "string", "pattern": "^M[0-9]{1,2}\\.T[0-9]{1,2}$" },
            "goal": { "type": "string", "maxLength": 300 },
            "files": { "type": "array", "minItems": 1, "items": { "type": "string" } },
            "create": { "type": "array", "items": { "type": "string" } },
            "forbidden": { "type": "array", "items": { "type": "string", "maxLength": 160 } },
            "check": { "type": "string", "maxLength": 300 },
            "checkCounterexample": { "type": "string", "maxLength": 200 },
            "dependsOn": { "type": "array", "items": { "type": "string" } }
          } } }
      } } }
  }
}
```

Deterministic validation (`core/local/plan.ts`, pure, given an `fs` port):

- Ids are unique, and `dependsOn` names earlier ids with no cycle.
- `files ∪ create ≤ plans.splitFiles`. Each path in `files` exists, and each path in `create` does not exist
  but its parent directory does.
- A milestone has at most `milestoneTasks` tasks, and every task has a non-empty check.

Errors return to the author as a resubmit, counted toward `plans.rounds`.

### 3.3 Worktrees and branches

#### 3.3.1 Convention

- Branch `<branchPrefix><plan-slug>/<id>` for plan work, else `<branchPrefix><slug>` (slug: `[a-z0-9-]{1,40}`).
- Worktree directory: `worktrees.root`, with `{repo}` replaced by the repository's directory name and relative
  roots resolved against the repository root's parent. Inside it, the branch name with `/` replaced by `--`.
  The default `../{repo}.worktrees` keeps worktrees outside the repository, so no `.gitignore` change is needed.
- Base: the current tip of the first existing branch in `mainBranches`.
- The *main checkout* is the worktree that has the main branch checked out (`git worktree list --porcelain`).

#### 3.3.2 Tool `start_branch` (main session only)

```json
{ "type": "object", "additionalProperties": false,
  "properties": {
    "slug": { "type": "string", "pattern": "^[a-z0-9-]{1,40}$" },
    "plan": { "type": "object", "required": ["slug", "id"], "properties": { "slug": {"type": "string"}, "id": {"type": "string"} } },
    "goal": { "type": "string", "maxLength": 300 },
    "check": { "type": "string", "maxLength": 300 },
    "repo": { "type": "string", "description": "absolute path; default: the session cwd's repository" }
  } }
```

Exactly one of `slug` and `plan` is required. Without a plan, `goal` and `check` are required: they become the
merge review's goal and the branch check.

Behaviour:

- Validate everything; nothing changes on failure.
- A plan-bound branch requires an approved plan, its skeleton hash unchanged, all `dependsOn` merged, and the
  unit matching the milestone's `branch`.
- If the branch already exists in a worktree, re-activate it (idempotent). Otherwise run
  `git worktree add -b <branch> <dir> <base>`.
- Make it the *active worktree*, append `task-router/branch`, and return
  `{branch, worktree, base, check, files?}`.

Failure: a git error returns `isError` with git's stderr tail (2 kB), and the state is unchanged.

#### 3.3.3 Writes outside the active worktree (main session)

While a worktree is active, the `tool_call` guard blocks `edit`/`write` whose resolved path is inside the main
checkout and outside every registered worktree. The reason: "write in the worktree <dir>; use absolute paths
under it". Bash is not parsed for this. A dirty main checkout found by `request_merge` is reported, not
cleaned. (LD6; the alternative, rewriting relative paths through the mutable `tool_call` input, is OQ1.)

#### 3.3.4 Cleanup

After a merge, with `removeAfterMerge` on, the router runs `git worktree remove <dir>` and
`git branch -d <branch>`. A failure only shows a hint; the merge stands. Abandoning a branch is plain git on a
non-main ref, which the guard allows. The router marks a branch `abandoned` when its worktree disappears.

### 3.4 Merge gate

#### 3.4.1 Tool `request_merge` (main session only)

```json
{ "type": "object", "additionalProperties": false,
  "properties": {
    "branch": { "type": "string", "description": "default: the active worktree's branch" },
    "summary": { "type": "string", "maxLength": 500, "description": "what the branch does, for the reviewer" }
  } }
```

Result (as text plus `structuredContent`):

```
{ status: "merged" | "refused" | "revise" | "fixer" | "error", reason: <code>, detail: string,
  commit, reviewId?, findings?: string[], pushed?: boolean }
```

#### 3.4.2 Pipeline (cheap and deterministic first; Opus last)

1. **Resolve** repo, branch, worktree, main branch, `commit = HEAD` of the worktree, and `tree`.
2. **Refuse** (`reason` codes):
   - `main-branch`: the branch is a main branch.
   - `dirty`: the worktree has uncommitted changes.
   - `behind`: main is not an ancestor of `commit`; "rebase onto <main> in the worktree, then request again".
   - `fixer-running`: a fixer is working on the branch.
   - `abandoned`: the branch is abandoned.
   - `blocked`: remediation is exhausted (§3.4.4).
3. **Size**: numstat `main...commit`. If lines (added + deleted, excluding tick-only plan lines) exceed
   `maxDiffLines` or files exceed `maxDiffFiles`, refuse with `size` ("split the branch"). No review is run. A
   plan-bound branch also opens the `over-budget` trigger (§3.5.5).
4. **Scope** (plan-bound): every changed file must be in the task or milestone whitelist (`files ∪ create`) or
   be the plan file. A plan file change must be tick-only and only for this branch's tasks. Otherwise refuse
   with `scope` and open `non-whitelisted`.
5. **Checks** in the worktree at `commit`, with `runCheck` (`core/gate.ts`) and `checkTimeoutSec`:
   - the task check, or all task checks of a milestone branch;
   - `mergeGate.extraChecks`;
   - when `plans.regression` is `milestone`/`plan`, the checks of already-merged tasks of the same
     milestone or plan.

   Any exit ≠ 0 refuses with `check` and the output tail. A regression opens `regression`.
6. **Red run** (non-plan branches, `redRun` on): run the branch check at `base` in a detached temporary
   worktree, which is removed afterwards. If the check passes there, the input is marked `vacuous-check` for
   the reviewer; this alone does not refuse. Plan tasks already have red runs recorded at plan time (§3.5.2).
7. **Approval reuse**: an existing `task-router/approval` for `(repo, branch, commit, tree)` skips step 8.
8. **Review**: overseer role `merge` (§3.2). When it is not approved: `rejections += 1`, then return
   `revise` with the findings, or start the fixer (§3.4.4). When approved: append `task-router/approval`.
9. **Merge**:
   - If the main branch is checked out in a worktree W, run `git -C W merge --ff-only <commit>`. W must be
     clean, else refuse with `main-dirty`.
   - Otherwise run `git update-ref refs/heads/<main> <commit> <old>`.
   - When `push` is on, run `git push <remote> <main>`.

   These are the router's own processes, so they bypass the tool hooks. Then record `task-router/main-ref`,
   tick nothing (ticks travel on the branch), and run cleanup (§3.3.4).
10. **Log** one `merge` line per call, and `review` lines per overseer run.

Fast-forward only, with no merge commits (LD7): the merged tree equals the reviewed and checked tree. A branch
that falls behind needs a rebase, which makes a new commit and therefore a new review. That is the user's
decision; see OQ3 on patch-id reuse.

#### 3.4.3 Approval binding

An approval holds for `(repo, branch, commit, tree)` only. A new commit on the branch (amend, rebase, fix)
invalidates it: step 7 finds no match. Approvals do not expire within a session. After a session restart they
are rebuilt from session entries. Step 9 checks the worktree HEAD against the approved commit immediately
before merging.

#### 3.4.4 Fixer after rejections

When `rejections` reaches `rejectionsBeforeFixer` (2), the router spawns the fixer itself, through `api.spawn`
with a ticket. The fixer runs on member `fixerMember` at `fixerEffort` (Sonnet high), with:

- cwd: the worktree;
- card: `{kind: "implement", files: changed files ∪ finding targets (paths), check: branch check,
  acceptance: the blocking findings' fix criteria, t0: all false, t2: []}`;
- tools: `all`, with the git guard and whitelist guard composed in.

The branch state becomes `fixer`. Main-session writes into that worktree are blocked ("a fixer owns this
branch"), and `request_merge` returns `fixer-running` until the fixer's report (a route event fixer→main) or
its death. Qwen gets `status: "fixer"`: "fixes were delegated to <name>; wait for its report, then call
request_merge".

A fixer round that is rejected again and leaves `fixerRounds` exhausted marks the branch `blocked`.

- Plan-bound branch: the `remediation-failed` trigger opens, and the task can only be restructured through
  `amend_plan`.
- Otherwise: Qwen is told to abandon the branch and start a new one with a smaller goal.

Nothing waits for a human.

#### 3.4.5 Git guard (bash, main and children)

`core/local/gitcmd.ts` is a pure classifier of a command string, given `cwd`, `mainBranches` and a
`branchOf(dir)` port. It returns `allow | {block, reason}`.

- **Split.** On unquoted `;`, `&&`, `||`, `|`, `&` and newlines. Recurse into `$(…)`, backticks and the string
  argument of `bash|sh|zsh -c` (depth ≤ 2).
- **Simple commands.** Strip leading `VAR=x` assignments and the wrappers `env`, `command`, `nice`, `nohup`,
  `time`, `sudo`, `xargs`. Track a literal `cd <path>` earlier in the same chain. Parse git's global options
  `-C <dir>` and `-c k=v`. `--git-dir`/`--work-tree` mark the directory as unknown.
- **Block** when the target is a main branch:
  - `push` whose refspec destination is a main branch (`main`, `x:main`, `HEAD:main`, `refs/heads/main`,
    `+…`), `--all`, `--mirror`, `--delete <main>`, or no refspec while the current branch is a main branch;
  - `merge`, `pull`, `rebase`, `cherry-pick`, `revert`, `am`, `commit` or `reset` while the current branch is
    a main branch;
  - `branch -f|-M|-m|-D|-d <main>`, `checkout -B <main>`, `switch -C <main>`, `update-ref refs/heads/<main>`;
  - `filter-branch` always.
- **Unknown directory** (a variable `cd`, `--git-dir`): the current-branch subcommands above are blocked with
  "cannot tell the branch; run git with a literal -C <worktree>".
- **Reason text** names the tool to use: "merging into <main> goes through request_merge".

Wiring:

- **Main session:** `pi.on("tool_call")` for `bash` and `powershell` (same input shape).
- **Children:** the composed `toolGuard`.

`branchOf` runs `git -C <dir> symbolic-ref --short -q HEAD` with a 2 s timeout. A timeout counts as an unknown
directory.

Exceptions inside the classifier: a command with no `git` token is allowed. Otherwise the call is blocked with
"router could not classify this git command; split it". This fails closed for git only. (LD8)

#### 3.4.6 Bypass detection (post hoc)

After every main-session `bash` result and every child `turn` event, the router reads `refs/heads/<main>` of
each known repository: the session cwd's repository plus every repository with a registered worktree. It
compares the value with `task-router/main-ref`. A ref that moved outside the gate produces:

- a `gatebypass` log line;
- `ctx.ui.notify(…, "warning")`;
- a hint to Qwen;
- an updated record.

There is no automatic revert (N3). User commands (`user_bash`) are not hooked. A ref the user moved is
detected and logged the same way, with neutral wording ("main moved outside the gate"), because the router
cannot tell who moved it.

### 3.5 Plans

#### 3.5.1 When

A request that spans more than one branch. Qwen decides this, and the section text tells it to. The hints
`over-size` and `size` refusals push it there. `start_branch` with `slug` (no plan) is always available.

#### 3.5.2 Tool `plan_request` (main session only)

```json
{ "type": "object", "additionalProperties": false, "required": ["slug", "request", "acceptance", "files"],
  "properties": {
    "slug": { "type": "string", "pattern": "^[a-z0-9-]{1,40}$" },
    "request": { "type": "string", "maxLength": 2000, "description": "digest of the user's request" },
    "acceptance": { "type": "array", "minItems": 1, "maxItems": 10, "items": { "type": "string", "maxLength": 200 } },
    "files": { "type": "array", "minItems": 1, "maxItems": 20, "items": { "type": "string" } },
    "symbols": { "type": "array", "maxItems": 40, "items": { "type": "string", "maxLength": 80 } }
  } }
```

Pipeline:

1. **Grounding check** (deterministic; refuse with the list of misses):
   - every file exists;
   - every symbol occurs as a word in one of the files (`git grep -w -l`);
   - no active plan already uses the slug.
2. **Author.** Overseer role `plan-author` writes the skeleton through `submit_plan` (§3.2.4), with validation
   resubmits.
3. **Red runs.** Each task check runs on the main tip in a detached temporary worktree.
   - Exit 0 means the check is vacuous. The author gets a finding (category `check`, target the task id) and
     a resubmit; this counts toward `plans.rounds`.
   - Exit 126/127 means the check is broken, handled the same way.
   - After `rounds`, still-vacuous tasks are accepted with the flag `vacuousCheck` recorded in the plan. The
     merge reviewer is told, and nothing deadlocks (LD9, OQ8).
4. **Render** `plans.dir/<slug>.md` deterministically (§3.5.3). The router commits it on the main branch itself
   (`plan(<slug>): approved <reviewId>`), through the same ff path as merges (LD10, OQ2). It records
   `task-router/plan` with the skeleton hash.
5. **Return** the path, the first startable unit, and `start_branch {plan: {slug, id}}`.

Opus's skeleton is not reviewed again by Opus; self-review adds nothing. The binding plan gate is: the
skeleton is validated, its red runs are recorded, and it is approved before `start_branch` accepts a
plan-bound branch. The binding reviews are on Qwen's amendments (§3.5.4).

#### 3.5.3 Plan file

~~~
# Plan: <slug>
<!-- task-router plan v1. Edit only checkboxes; change the plan with amend_plan. -->
Request: <digest>
Invariants: <one per line>

## M1: <goal> (branch: milestone|task; depends: —)
Acceptance: …
- [ ] M1.T1: <goal>
  files: a.ts, b.test.ts (new) · forbidden: … · check: `npm test -- a` · depends: —
…
<details><summary>skeleton</summary>

```json
<canonical skeleton JSON, keys sorted, 2-space indent>
```
</details>
~~~

The JSON block is the source of truth, and the rendered text is derived from it. `skeletonHash` is the
SHA-256 of the canonical JSON. Checkbox state is read from lines matching `^- \[( |x)\] (M\d+\.T\d+):`.

#### 3.5.4 Tool `amend_plan` (main session only)

```json
{ "type": "object", "additionalProperties": false, "required": ["slug", "trigger", "changes", "reason"],
  "properties": {
    "slug": { "type": "string" },
    "trigger": { "type": "object", "required": ["id"], "properties": {
      "id": { "type": "string", "description": "an open trigger id, or \"new\"" },
      "kind": { "enum": ["interface-break"] },
      "evidenceCommand": { "type": "string", "maxLength": 300 } } },
    "changes": { "type": "array", "minItems": 1, "maxItems": 8, "items": {
      "type": "object", "required": ["op"], "properties": {
        "op": { "enum": ["add", "replace", "remove"] },
        "id": { "type": "string" }, "after": { "type": "string" },
        "task": { "type": "object", "description": "a task object exactly as in submit_plan's tasks items" } } } },
    "reason": { "type": "string", "maxLength": 500 }
  } }
```

Behaviour:

1. **Trigger.** It must be open (§3.5.5). The one Qwen may open itself is `interface-break`
   (`trigger.id: "new"`): the router runs `evidenceCommand` in the active worktree and accepts the trigger only
   when it exits ≠ 0.
2. **Validate** the amended skeleton with the rules of §3.2.4. Checked tasks (ticked and merged) are immutable.
3. **Review.** A *full* re-review (`plan-review`) is needed when the trigger is `interface-break`, any amended
   task's files match `plans.publicApiGlobs`, or a milestone is added or removed. Otherwise a `delta` review
   runs.
4. **Approved:** re-render (keeping the ticks of unchanged tasks), commit on main, record, close the trigger.
5. **Not approved:** return the findings. After `plans.rounds` rejected amendments for the same trigger, the
   router asks `plan-author` to write the amendment for the affected milestone itself. That result is
   validated, red-run and applied without a further review. This follows the research's "Opus restructures
   failing tasks".

#### 3.5.5 Replan triggers (only these)

| trigger | opened by |
|---|---|
| `non-whitelisted` | a write (main guard, child guard) or a merge scope check touching a file outside the task whitelist; the write is blocked |
| `interface-break` | Qwen, with an evidence command that fails |
| `regression` | an earlier task's check failing in `request_merge` step 5 |
| `over-budget` | branch diff above `splitLines`/`splitFiles`, or more than `taskTurns` main turns since `start_branch` |
| `remediation-failed` | the fixer exhausted (§3.4.4) |

`amend_plan` without an open trigger is refused: "no replan trigger is open; finish the task as planned".

#### 3.5.6 Plan guard

`edit`/`write` to a file under `plans.dir` named in an active plan is computed in memory (`edit` applies
`edits[]` to the current text and is blocked when it cannot be applied). The write is allowed only when the
lines differ solely in checkbox state of the task lines. The block reason is "change the plan with
amend_plan". Bash writes are detected later: `start_branch` and `request_merge` re-hash the skeleton and refuse
`plan-changed`.

### 3.6 Force override

#### 3.6.1 Who can force

- **The user, with a slash command** (registered in the guarded body at `session_start`, like experiments'
  `/rate`):

  ```
  /force <model> [effort] [next[:N] | session]
  /force off
  /force
  ```

  - `<model>` is `provider/id` or a member name.
  - `effort` is `off|minimal|low|medium|high|xhigh|max`. When omitted, the routed effort is kept.
  - The scope defaults to `session`. `next` means 1 spawn, `next:N` means N spawns.
  - `/force off` clears the force, and `/force` alone shows it.
- **The user, through settings**: `force: {model, thinkingLevel}`, active for every session. A command force
  takes precedence over the settings force while it lasts.
- **Not the main model.** There is no card field and no tool. In local mode a model-level force would let
  Qwen bypass routing in either direction. Today's explicit `model`/`thinkingLevel` arguments keep their rules
  (at or above the routed level, no `max`). (LD11, OQ4)

#### 3.6.2 Resolution and rejection

The model is resolved with `ctx.modelRegistry.find(provider, id)`. A member name maps to its `model`. Anything
pi's registry resolves is accepted, including models outside the table and effort `max`.

An unresolvable model is rejected:

- `ctx.ui.notify("task-router: /force: unknown model <ref>; available: <first 10 of getAvailable()>", "error")`;
- a `force` line with `action: "rejected"` and `reason`;
- the previous state stays.

For settings, the check runs at `session_start`: the notification goes out once, the force stays inactive, and
it also appears in `problems`.

#### 3.6.3 Effect (`core/force.ts` and one branch in `core/policy.ts`)

For every routed worker spawn (cards, and the merge fixer), while a force is active:

1. The card is parsed and routed as usual (`planSpawn`), so the counterfactual `routedModel`/`routedEffort` is
   logged and card errors are still reported.
2. The policy returns the forced model and effort instead of the plan's. `acceptModel` is not consulted
   (LD4). A forced model that is a member runs through `resolveLeg` pinned to that member (it waits for its
   slot, as an explicit model does today). A non-member starts at once, with no slot accounting.
3. Forced spawns are not rerouted by failover. A provider error surfaces to the spawner as an error. A force
   never falls back silently (A4).
4. `spawn` carries `forced: true` and `forceSource`. A `force` line `used` is written per spawn, and `expired`
   when `next:N` runs out. The status line shows the force.

Overseer roles are not forced: they have their own `overseer.*` settings and budget fallback. `/force` says so
in its confirmation (OQ5).

## 4. Where each piece lives

Everything stays inside `packages/task-router`. pi allows one spawn policy per process
(`registerSpawnPolicy` throws on a second), and overseer tickets, force and the local-mode cwd and guards all
act inside that policy. A fifth component would also need a fifth `runtime-guard.ts` copy, its own HM option
and iface checks. (LD12)

| Piece | Location | Reason |
|---|---|---|
| keys, defaults, validation | `core/settings.ts`, `core/types.ts` | `merge()` takes only keys present in `defaults()` |
| mode effects: importance, child cwd, ticket branch, force branch, composed guards | `core/policy.ts` (plus `core/importance.ts` takes `mainEffort: undefined` in local mode) | the only place a spawn is decided |
| local section | `core/prompt.ts` `localSection` | beside `cardSchema`, its one field source |
| nudge off | `core/shell.ts` (the `enabled` predicate passed to `installNudge`) | `core/nudge.ts` stays unchanged |
| guard composition, overseer tool list | `core/toolguard.ts` (`composeGuards`, `OVERSEER_TOOLS`) | existing guard home |
| force | `core/force.ts` (pure: parse, precedence, countdown); `/force` registered in `core/shell.ts` | mode-independent |
| tripwires, hint texts, persistence | `core/local/tripwires.ts`, `core/local/hints.ts` (pure) | functional core |
| git classifier | `core/local/gitcmd.ts` (pure) | testable without git |
| git port | `core/local/git.ts` (run-injected: `branchOf`, `numstat`, `isAncestor`, `worktreeAdd/Remove`, `ffMerge`, `updateRef`, `push`) | one place for git processes, reusing `runCheck`'s process-group handling |
| overseer | `core/local/overseer.ts` (tickets, budget, spawn/await/kill), `core/local/verdict.ts` (schema, V1–V3) | — |
| merge gate | `core/local/merge.ts` (pipeline steps as pure functions over ports) | — |
| worktrees | `core/local/worktree.ts` | — |
| plans | `core/local/plan.ts` (schema, validation, render/parse, tick-only diff, triggers), `core/local/planflow.ts` | — |
| wiring | `core/local/install.ts` `installLocal(pi, deps)`, called from `install()` in `core/shell.ts` at `session_start` inside the guarded body | registers tools and hooks only when a component is active |
| outcome keys and events | `core/outcome.ts` `KEYS`, `core/log.ts`; `packages/token-meter/core/contract.ts`, `packages/token-meter/LOGS.md` | log contract |
| API types | `core/api.ts` (router's copy) | the iface check compares it with the provider |
| Actor patch | `patches/pi-actor-subagents/pi-actor-subagents-spawn-api.patch`; `packages/actor-subagents/package.nix` (patch list, `spawnPolicyApi = 2`) | §3.0.4 |
| HM | `modules/task-router.nix` (`localMode.enable`, three assertions); `checks/module-eval/cases/task-router.nix` (negative cases); `checks/module-eval/cases/actor-subagents.nix` (`spawnPolicyApi` 1 → 2) | — |
| docs | `docs/pi-economics.md` (taskRouter section: mode, toggles, tools, command, events) | module contract |

AGENTS.md rules that apply:

- Register nothing outside the guarded body. Tools and commands are registered at `session_start`, never
  flags or providers.
- `core/local/` is inside `core/`, so `package.nix` copies it and the typecheck covers it. Tests live in
  `test/local-*.test.ts` (top-level `test/`), with `test/fake-pi.ts` and `test/fake-api.ts` extended:
  `fakeApi` gets `spawn`, `kill` and `childTools` capture.
- Tests come first: each behaviour starts as a failing test.
- Every new assertion message starts with `pi-economics:` and has a negative module-eval case.
- No import-from-derivation.
- `runtime-guard.ts` copies are unchanged.
- Golden files are not re-recorded.
- The existing `actor-subagents` module-eval case changes `spawnPolicyApi` 1 → 2, because the build changes
  (stated in that task).
- Neutral names only in docs and tests.

## 5. Acceptance criteria

Each criterion is checkable with `node --test` on the router (fake pi, fake API, an injected git and `run`
port, a temporary git repository where noted). The HM criteria are module-eval cases.

**Non-regression (N)**

- AC-N1. `checks/router-golden` passes with the golden files byte-unchanged.
- AC-N2. All pre-existing router tests pass unmodified.
- AC-N3. With `{}` settings: the registered tool names equal today's (`task_verdict` only), and the registered
  commands are only `/force`. A `bash` `tool_call` with `git push origin main` returns `undefined`.
  `sections.task_cards === cardSection(s, …)`.
- AC-N4. With `{}` settings and no force, no outcome line contains a key outside today's `KEYS`.

**Switch and routing (R)**

- AC-R1. `parseSettings({mode: "local"})` has no problems. `{mode: "x"}` yields a problem naming `mode`.
  `{hints: {enabled: "maybe"}}` yields a problem.
- AC-R2. In local mode, with a caller at `thinkingLevel: "xhigh"`, a write-0 card without `importance` gets
  importance `normal` (one leg, worker `qwen-local`). In default mode the same spawn gets `high`, as today.
- AC-R3. In local mode `sections.task_cards === localSection(s, active)`. It contains `cardSchema(s)` and not
  `ORCHESTRATOR_RULE`. Its text is pinned by a test (it is read by a model).
- AC-R4. In local mode, 20 inline `edit` calls produce no `task-router/delegation-nudge` message.
- AC-R5. HM: `localMode.enable = true` writes `settings.json` containing `"mode":"local"`. Each of the three
  assertions fails its negative case with the message prefix given in §2.1.

**Hints (H)**

- AC-H1. For each trip in §3.1.1 there is a call sequence that fires it exactly at its threshold and not one
  call earlier: a property test over random sequences built from the threshold settings, compared with a
  reference counter.
- AC-H2. The tripping call's `tool_result` handler returns content equal to the original content plus one
  `<router-hint trip="…">` block. Within `cooldownCalls` the same trip adds nothing.
- AC-H3. `identical-call` does not fire when a successful write lies between the repeats.
- AC-H4. After `persistTrips` further trips without progress, exactly one `steer` overseer is spawned (fake
  API), and its findings are sent as a steer message. With `steerBudget` exhausted, a fixed escalation hint
  is sent instead and nothing is spawned.
- AC-H5. A detector that throws leaves the `tool_call` result `undefined` and the `tool_result` content
  unchanged.
- AC-H6. A child's third identical call triggers `api.send(child, /^<router-hint/)`. Two more trigger
  `api.send(parent, …)`. No child call is blocked by a hint.

**Overseer (O)**

- AC-O1. `request_merge` on a valid branch calls `api.spawn` once, with `task.ticket`. The policy, given that
  ticket, returns `tools === overseer.tools`, one `childTools` entry named `submit_verdict`, `cwd` = the
  worktree, and a `toolGuard` that blocks `bash`, `edit` and `send_message`.
- AC-O2. `verdict.approve(findings)` is true iff no finding is blocking, for every generated verdict (property
  test). A `REVISE` with only non-blocking findings is approved and logged `inconsistent: true`.
- AC-O3. A submission containing ```` ``` ```` or a duplicate id returns `isError` and does not resolve the
  ticket. After `resubmits` invalid submissions the review outcome is `invalid`.
- AC-O4. With `opusUsed = budget`, the spawned model is the `fallbackMember`'s, and the `review` line has
  `fallback: "budget"`.
- AC-O5. A spawn failure, then a fallback failure, makes `request_merge` return `status: "error"`, and the main
  ref is unchanged.
- AC-O6. A forged `task.ticket` (unknown) is routed as a card (rejected for missing card fields).
- AC-O7. Patched Actor: `api.spawn` runs the registered policy; a `childTools` tool is callable by the child
  and its `execute` receives the input; `PolicyResult.cwd` is the child session's cwd; `api.kill` removes the
  agent. These are tests in the patch, plus `spawnPolicyApi === 2` in the module-eval case.

**Worktrees (W)** (in a temporary repository)

- AC-W1. `start_branch {slug: "x"}` creates branch `lm/x` and a worktree at `<parent>/<repo>.worktrees/lm--x`
  based on the main tip. Calling it again returns the same worktree and creates nothing.
- AC-W2. `start_branch {plan: …}` is refused for a missing plan, an unmet dependency or a changed skeleton
  hash, and the repository is unchanged.
- AC-W3. With an active worktree, `edit` of `<main checkout>/a.ts` is blocked, and `edit` of `<worktree>/a.ts`
  passes.

**Merge gate (M)** (in a temporary repository, with a fake overseer)

- AC-M1. `gitcmd.classify` blocks every command in a fixed corpus of main-branch writes (≥ 40 forms: each
  subcommand × direct, `-C`, `cd &&`, `bash -c`, `$(…)`). It allows every command in a corpus of non-main and
  read-only forms (≥ 40). Every block reason names `request_merge`.
- AC-M2. Each refusal code in §3.4.2 steps 2–5 is produced by a minimal setup, makes no `api.spawn` call, and
  leaves the main ref unchanged.
- AC-M3. An approved review merges with fast-forward: the main tip equals the reviewed commit. A `merge` line
  is `merged`, and `main-ref` is recorded.
- AC-M4. Approval binding: approve commit c1, add commit c2, request again. A second review runs, and c1's
  approval is not used. Requesting again at an unchanged c2 after an approval reuses it with no spawn.
- AC-M5. The second rejection spawns the fixer, with the model of `fixerMember` and `cwd` = the worktree.
  `request_merge` then returns `fixer-running`. A further rejection beyond `fixerRounds` marks the branch
  `blocked`.
- AC-M6. Moving `refs/heads/main` outside the gate, followed by a `bash` result, writes one `gatebypass` line
  and one warning notification.
- AC-M7. A bash tool call in a child spawned in local mode with `git -C <wt> push origin HEAD:main` is blocked
  by its `toolGuard`.

**Plans (P)** (in a temporary repository, with a fake overseer)

- AC-P1. `plan_request` with a non-existent file or an absent symbol is refused, listing the misses. No spawn
  happens.
- AC-P2. A skeleton violating each validation rule of §3.2.4 is returned to the author as `isError`.
- AC-P3. A task whose check passes on the main tip produces a `check` finding to the author. After `rounds`
  it is accepted with `vacuousCheck` recorded.
- AC-P4. The rendered plan parses back to the same canonical skeleton (round-trip property over generated
  skeletons). `skeletonHash` is stable under re-rendering.
- AC-P5. The plan guard allows an `edit` that only flips `[ ]`→`[x]` on a task line and blocks any other change.
- AC-P6. `amend_plan` without an open trigger is refused. With `interface-break` it is accepted iff the
  evidence command exits ≠ 0. An amended task touching `publicApiGlobs` runs `plan-review`, otherwise `delta`.
- AC-P7. A write outside the task whitelist in a plan-bound worktree is blocked and opens `non-whitelisted`.

**Force (F)**

- AC-F1. `/force sonnet high next:2`: the next two routed spawns get Sonnet's model at `high`, the third is
  routed. The spawn lines carry `forced`, `forceSource: "command"` and `routedModel`. One `expired` line
  follows.
- AC-F2. `/force <a model below the routed level> max`: the spawn gets exactly that model and `max`, with no
  rejection (in contrast to `acceptModel` rules 2 and 5).
- AC-F3. `/force nosuch/model` leaves the state unchanged, shows one `error` notification and writes a
  `force rejected` line.
- AC-F4. Settings `force.model` unresolvable: one notification at `session_start`, a problem listed, the force
  inactive. A resolvable settings force applies to every spawn, and a command force overrides it.
- AC-F5. A forced spawn's provider error is not rerouted (no `reroute` line).
- AC-F6. Overseer spawns ignore the force.

**Logs (L)**

- AC-L1. `pi-analyse --check` accepts lines of every new event, and rejects a `review` line without `outcome`
  and a `force` line without `action`.
- AC-L2. No new log line contains finding text, diff text, command text or plan text (a property: every
  string value is either from a fixed enum, an id, a sha, or a model reference).

## 6. Milestones

Each milestone leaves default mode unchanged (AC-N1–N4 run in every milestone) and can ship alone.

1. **L1. Switch and local routing.** Settings keys and validation (all components declared, inert). `mode`,
   the importance change, `localSection`, nudge off, status line. HM `localMode.enable` with the first two
   assertions (the third arrives in L4). Docs: taskRouter section. *Ships:* a Qwen main gets a shorter
   section, sensible importance and no nudge.
2. **L2. Force override.** `core/force.ts`, `/force`, settings force, the policy branch, the logs and the
   contract. Mode-independent. *Ships:* the TODO item "overwrite the model".
3. **L3. Hints and tripwires.** Main session and children (call-based), fixed texts, cooldown, logs and
   contract. No steer yet: persistence produces the fixed escalation hint. *Ships:* measured hints.
4. **L4. Actor spawn API and overseer.** The patch, `spawnPolicyApi = 2`, the API types and iface,
   `overseer.ts`, `verdict.ts`, budget and fallback, the `steer` role wired into L3's persistence, the third HM
   assertion. *Ships:* Opus steering of persistent loops.
5. **L5. Worktrees.** `start_branch` (non-plan), worktree writes guard, cleanup. *Ships:* a branch workflow,
   with merging still manual.
6. **L6. Merge gate.** The git classifier and guard (main and children), `request_merge` steps 1–3 and 5–10
   for non-plan branches, the red run, approval binding, the fixer, bypass detection, logs. *Ships:* the
   binding merge gate.
7. **L7. Plans.** `plan_request`, `submit_plan`, red runs, the plan file, the plan guard, plan-bound
   `start_branch`, merge step 4 and regression checks, triggers, `amend_plan` with delta and full review.
   *Ships:* multi-branch work.
8. **L8. Close-out.** `docs/pi-economics.md` complete, and LOGS.md examples. Optional: `pi-analyse` sections
   for local-mode events (OQ17).

Order rationale: force and hints need no Actor change. The overseer must exist before any binding review.
Worktrees come before the gate so that L5 is usable on its own, and plans build on everything.

## 7. Open questions (with recommendations)

**Resolution:** every recommendation below is accepted for the first version. OQ18: a new patch file. OQ7: `quiet`.
Revisit OQ6, OQ10 and OQ19 with meter data and the answer to research prompt 7.

- **OQ1. Paths in worktrees.** Block writes to the main checkout and instruct (LD6), or rewrite relative paths
  and prefix bash with `cd <wt> &&` through the mutable `tool_call` input? *Recommend* blocking for L5. Count
  the blocks (a `hint` trip `outside-worktree`) and add rewriting only if they are frequent. Rewriting hides
  where files are and changes what Qwen sees.
- **OQ2. Plan file on the main branch.** The router commits plans and amendments directly on main, gated by
  the plan approval (LD10). Alternative: plans outside git (`.git/pi-plans/`), or committed through a branch
  and the merge gate. *Recommend* direct commits. A plan file must be on main for worktrees to see it, and a
  merge review of an Opus-written plan would be self-review.
- **OQ3. Approval after a rebase.** Should an approval carry over to a rebased commit with the same
  `git patch-id --stable`, after the checks re-run? *Recommend* no for now (the user's decision: a new commit
  needs a new review). Log rebase-caused reviews and revisit with data.
- **OQ4. Card-level force by the main model.** *Recommend* none in either mode (LD11). The existing explicit
  `model` argument (only at or above the routed level) stays. Whether local mode should also forbid explicit
  upward choices, so Qwen cannot pick Opus for everything, is open. *Recommend* keeping it and watching the
  cost per session in the meter.
- **OQ5. Force and overseers.** *Recommend* that a force does not apply to overseer roles, which have their own
  settings and budget. A user who wants cheaper reviews sets `overseer.member`.
- **OQ6. Starting values.** The budget of 15 Opus reviews per session, `timeoutSec` 900, `contextSoftTokens`
  32000, `maxDiffFiles` 6 and the tripwire thresholds come from unsourced research figures or are guesses.
  *Recommend* shipping them as defaults and tuning from `review`/`hint` lines.
- **OQ7. Overseer spawner identity.** API spawns use `by: "main"` with `quiet: true`, so main gets no
  lifecycle notices. An alternative is a pseudo-parent `router` in the Actor engine, which today has no such
  endpoint. *Recommend* `quiet`: a smaller patch.
- **OQ8. Vacuous checks after `rounds`.** Accept with a flag (LD9) or fail `plan_request`? *Recommend* accepting
  with the flag. Failing would deadlock with no human, and the merge reviewer is told.
- **OQ9. A blocked branch without a plan.** *Recommend* that Qwen starts a new, smaller branch. The router
  refuses further requests for the blocked branch, and no Opus authoring happens outside plans.
- **OQ10. Advisory hints versus blocks.** Should `identical-call` block from the fifth repeat (`blockAfter`)?
  The research says weak models ignore advisory critique, but its tripwires are advisory. *Recommend*
  advisory in L3 and measuring whether hints break loops (the share of `hint` lines followed by progress).
  Research prompt 7 (`docs/research/prompts.md`) asks for evidence.
- **OQ11. Components in default mode.** `"on"` is allowed by the settings. Is a binding merge gate for a strong
  main useful? *Recommend* allowing it but not testing combinations beyond `merge-gate on` in default mode
  until there is a use.
- **OQ12. Mode but no Qwen.** `mode: "local"` with a Claude main: no auto-detection (decided). *Recommend*
  that the status line shows `local (main: <model>)` when the main model is not a member with `route: local`,
  and nothing else.
- **OQ13. Experiments.** An experiments arm can flip `routing`, `verifyGate` and `delegationRule`. In local
  mode, `delegationRule` is ignored (LD3). *Recommend* that `mode` and the local components are not experiment
  factors until local mode has a baseline.
- **OQ14. Where full verdicts live.** Session entries only (the outcome log is text-free). *Recommend* that,
  plus the analysis skill reading `task-router/review` entries if needed. No new log file.
- **OQ15. Red runs for non-plan branches** cost one check run in a temporary worktree per request.
  *Recommend* on (reviewers miss vacuous checks), with `redRun: false` as the escape hatch.
- **OQ16. Several repositories.** The gate covers every repository the router sees (session cwd, worktrees,
  card cwds) by branch name. *Recommend* that; per-repository main names are a later setting.
- **OQ17. Analysis.** `pi-analyse` sections for hints, reviews and merges. *Recommend* a separate token-meter
  task after L6. The contract update in each milestone is enough to keep the check green.
- **OQ18. Patch layout.** A new patch file applied after `…-spawn-policy.patch` (recommended, easier to
  review), or an extension of that patch.
- **OQ19. Single-slot alternation cost.** Main and a Qwen child alternate on one slot and each re-reads the
  other's context. *Recommend* measuring the prefill time in the meter. If it hurts, the section's "end your
  turn after spawning" can become a router-enforced pause (the main's next request waits while a Qwen child
  runs).
- **OQ20. Turn cap for `over-budget`.** `taskTurns` 12 counts main turns since `start_branch`, including turns
  spent waiting for children. *Recommend* counting only turns with at least one tool call in the active
  worktree.

## 8. Research

New prompt: **7. Breaking loops of small local coding agents: hints, blocks, resets**, in
`docs/research/prompts.md`, with the evidence rules. It informs OQ10 and the tripwire thresholds (OQ6). The
existing reports are used as general advice only, and their numbers are not relied on.

## Appendix: decisions

| id | decision | rationale | rejected |
|---|---|---|---|
| LD1 | main effort is no importance source in local mode | Qwen offers only xhigh, so every child would be `high` | a Qwen-specific `FROM_EFFORT` entry (couples the table to a model) |
| LD2 | the active worktree is the default child cwd, and the API gains `PolicyResult.cwd` | children otherwise resolve paths against the main checkout | instruct children in the brief only (weak models forget) |
| LD3 | nudge and orchestrator rule off in local mode, even under experiments flags | they push a strong main to delegate; Qwen should work | a separate threshold for Qwen |
| LD4 | force goes around `acceptModel`, which stays unchanged | golden decisions unchanged (A5) | relaxing rules 2, 5 and 6 under a flag |
| LD5 | overseers are Actor children spawned through a new API `spawn` plus `childTools` | metered, visible, retried, typed result through a tool | direct model call; Qwen relays the verdict |
| LD6 | block main-checkout writes while a worktree is active | explicit, no hidden rewriting | input rewriting (OQ1) |
| LD7 | merge by fast-forward only | merged tree = reviewed tree = checked tree | `--no-ff` merges of a reviewed commit onto a moved main |
| LD8 | the git classifier fails closed for commands containing git, open otherwise | a guard error must not stop all bash | fail closed always |
| LD9 | vacuous checks after `rounds` are accepted with a flag | no deadlock without a human | fail `plan_request` |
| LD10 | the router commits approved plans on main | worktrees need the plan; no self-review | a plan branch through the merge gate |
| LD11 | only the user forces: command or settings | a main-model force bypasses routing | a card `force` field |
| LD12 | local mode lives in task-router (`core/local/`) | one spawn policy per process; no fifth runtime-guard copy | a new component package |
| LD13 | a quiet agent (`api.spawn` with `quiet`) answers only to the API and the user; agents' control tools and `send_message` refuse it (§3.0.4) | an overseer must be independent of the main model it reviews (LD5); "who spawns, owns" gave `main` message, retune, pause and kill | a task-router `tool_call` guard on the main session (misses other agents and an unloaded router) |
