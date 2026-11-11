# Local mode: known gaps and limitations

State of `main` after L8 (1dfafb6). Each item: what is missing, its effect, and where the details are.
Sources: `docs/local-mode/plan-L1-L3.md` §12, `docs/local-mode/plan-L4-L8.md` §12, its L4 review follow-up,
its L8 deviations and `docs/pi-economics.md` (taskRouter, local mode).

## Not verified on a real host

The automated checks use fakes for pi, the Actor and the models. Nothing has run against a real local Qwen server
or a real Opus overseer yet.

- Manual runbooks not run: `plan-L1-L3.md` §12 (steps 1–5: status line, `/force`, its restore, hints in the main
  session and in a child) and `plan-L4-L8.md` §12 (steps 1–4: overseer steer, worktrees, merge gate, plans).
- G1–G3 (`plan-L1-L3.md` §12): real pi event field names, `appendEntry`/branch rebuild after a resume, the model
  registry. If a field name differs from the fakes, hints never fire, or the status line and `/force` throw.
- G6 (`plan-L4-L8.md` §12): the patched Actor's `api.spawn` and `childTools` in a real host. That includes the
  child's `cwd`, `quiet`, `terminate` and `api.kill`.
- G7: real model behaviour is untested. Unknown whether Opus returns valid verdicts within `resubmits` and writes
  usable plan skeletons, and whether Qwen follows the refusal texts, hints and the `## Local mode` section.
- G8: untested git setups: hooks, commit signing on `commit-tree`, submodules, sparse checkouts, LFS, `main`
  checked out in a second worktree, and `push: true`.
- G9: pi 1.4 payload shapes the guards rely on: `edit` input shape, `powershell`'s `command`, bash `isError` on a
  non-zero exit, `AbortSignal` in tools.
- G10: cost of the ref reads after every bash result and child turn (bypass detection) in large repositories.

## Design limits

- One global switch: `settings.mode = "local"` applies to every session of the agent dir. A Claude main in that
  dir also runs in local mode. There is no auto-detection and no per-session mode.
  Wanted (user, 2026-11-11): a runtime switch between local and default mode (per session, without a rebuild).
  Until then the author's setup runs every session in local mode with `llama/qwen3.8` as the default model.
- The router routes subagents only. It does not choose or change the main session's model.
- Plan and branch records live only in the session that made them. Another session cannot continue a plan
  (`start_branch {plan}`, `amend_plan` and `plan_request` say so). Rebuilding the records from `main` would trust
  any parseable plan file as approved.
- The main-checkout guard and the git classifier block the agent's tools. They do not block a human or another
  process; a ref move found later only gives a warning and a `gatebypass` line.
- A forced fixer skips the ticket checks (provider block, health) (D47).
- With one local slot, a Qwen main and Qwen-routed children share the same server.

## Open defects (known, not fixed)

- Overseer attempt (`core/local/overseer.ts`): any `error` event ends the attempt at once, including a transient
  429 that pi-retry would recover. The Opus unit is spent and the run falls back (L4 note L1).
- Overseer attempt: `timeoutSec` starts only after `api.spawn` resolves, and spawn and kill have no time limit. A
  hung session creation leaves the run pending (L4 note L2).
- When a ticket child (overseer, merge review, fixer) fails because a provider's free quota is used up, no
  provider block is set (`failover.ts` watches routed children only).
- A transient git error ends a `plan_request` without a resubmit.
- Patch `child-tools.ts`: a relative `cwd` is accepted silently. The router refuses one before the spawn (L4
  note N2).
- `overseer.tools`: the writer check is a denylist (`bash`, `edit`, `write`). A child-extension tool that writes
  passes the warning (L4 note N3).

## Not released

Local mode is on `main` only. The last release, v0.1.2, does not contain it. Per Q13 there is no release unless
the user asks for one.
