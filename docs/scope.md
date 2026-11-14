# Scope: what pi-economics is, and what left

Decision recorded 2026-11-12 (after local mode was disabled over the merge-gate
problems: size refusals on real work, cold-cache review economics, fixer churn);
the extraction it announced is done in 0.2.0, the redesign that follows from it in
0.3.0. This file is the pointer for a fresh session that needs the goal of the extension.

## The goal

pi-economics is a **purely exploratory framework**: it measures, analyzes and
experiments with pi's own token economics. It does not route, gate, review or
drive work. Everything below stays:

| Stays in pi-economics | Role |
|---|---|
| `tokenMeter` | the meter: one JSON line per provider request with its billing class, timing and the value and source of every lever in force; `meter-report`, `pi-analyse` (budget first: quota windows and calibration, spend, local cost) |
| `analysisSkill` | the skill that runs `pi-analyse` and proposes decisions from the logs |
| `experiments` | one randomized arm per main session and setup (stratum), levers assigned through add-ons and read back |
| `bench` | `pi-bench`, blind judges, bootstrap reports, process-scope pi levers |
| `cacheLifecycle` | stale-result elision, cache warming (a cost mechanism) |
| `infiniteContext` | context folding: reminders, their limits per provider or model |
| `piSettings` | the settings.json migration |

pi-economics keeps **observing** the router after the split: the meter reads
the router's outcome log (`task-router/outcomes/*.jsonl`). The observation
relationship survives; the ownership does not (see below).

Measuring covers pi's own defaults (compaction, cache warming, thinking levels, codemode,
transport, retry) and the opt-in interventions this repository ships (cache lifecycle, fold-reminder
limits), each of them a lever whose value and source the meter records. Interventions are
opt-in and exploratory: they are tried per session at random and read back, never driven.

A quota guard that blocks and a quota waiter that pauses until the window reopens are control, not
measurement: the quota waiter is its own extension in its own repository (provided through
pi-setup). It is not part of 0.3.0, and neither is the meter's reading of its events; both ship
after 0.3.0.

## What left

| Left in 0.2.0 | Now |
|---|---|
| `packages/task-router`, `programs.piEconomics.taskRouter` | [pi-task-router](https://github.com/GRBurst/pi-task-router), its own flake: `programs.piTaskRouter`, version 0.2.0 |
| `docs/local-mode/`, `docs/research/` (whole, the cleanup scripts included) | the same paths in pi-task-router |
| `docs/prompts/`, the specification of the Gemini Deep Research cleanup tool (left after 0.2.0) | its own repository, `~/projects/gemini-research-cleanup` (not published yet): the command `gdr-clean`, the specification as its `docs/spec.md` |
| `packages/actor-subagents`, `patches/pi-actor-subagents`, `programs.piEconomics.actorSubagents` | pi-setup: `programs.pi.actorSubagents` (infrastructure that the router, cache-lifecycle, experiments and bench use) |
| `packages/retry`, its patch and input, `programs.piEconomics.retry` (left after 0.2.0; OpenRouter's free tier it handled is gone) | nowhere: pi's native retry (its `retry.*` settings) handles transient errors |

A definition of a removed option fails with a message that names the new
owner, or for `retry` the replacement (`modules/removed.nix`).

### The model router, including local mode

The task-card routing table, `/force`, the nudge and all of **local mode**
(hint engine and tripwires, the Opus overseer, worktrees and branches, the
merge gate, plans), with the design record and the research that drives it.

Why: the router is a control plane with its own product lifecycle, and the
merge-gate work showed it (a hard size budget tuned for one guessed number,
review economics that fight the budget, an escape-hatch discussion). That is
product design, not measurement. Coupling it to a stable exploration framework
slows both down.

How the two relate:

- **Installation.** Two pi packages and one agent dir: the router's Home
  Manager module sets pi-setup's options and registers itself in its registry;
  without Nix the router is a pi package of its own. Both ship the claim
  protocol of `core/runtime-guard.ts` (channel `pi-economics:claim:v1`, frozen;
  `runtime-guard-copies` pins the line in both).
- **Dependencies.** pi-economics may depend on extensions; extensions never on
  pi-economics. Today pi-economics takes the router and pi-setup as flake
  inputs for its checks only. The router's optional read of
  `__piExperimentsApi_v1` predates this rule; the redesign removed the global
  (M5b.2), so the read finds nothing and the router drops it on its side. The
  experiments factors `freshOnCold` and `delegationRule` are gone (design
  v4), so the read already finds the router's own settings.
- **The outcome log.** The router owns the schema (its `docs/outcome-log.md`).
  pi-economics keeps a consumer copy (`packages/token-meter/core/contract.ts`
  and the examples in `packages/token-meter/LOGS.md`) that `log-contract`
  proves against the router's real writer.
- **Versions.** Each repository has its own; pi-economics' constant is
  `render/default.nix` (AGENTS.md, "Versions").

### The research cleanup tool → its own repository

The Gemini Deep Research cleanup tool is about processing Gemini exports, not
about pi. It lives in a standalone repository, `~/projects/gemini-research-cleanup`
(not published yet), as the command `gdr-clean`.

- Its specification is `docs/spec.md` there, amended after fifteen exports;
  this repository no longer carries a copy.
- The one-off provenance scripts `clean-batch{1,2,3}.mjs` stay in
  pi-task-router's `docs/research/cleanup/` (the tool keeps copies as its rule
  reference); the reports, the raw exports and the formula sidecars stay there
  too, and `docs/research/cleanup.md` there names the tool and its version for
  each batch.

## Current state (2026-11-14)

0.3.0 is prepared: it contains neither the router nor the actor nor the retry component, and
the redesign is implemented (units, strata, levers, add-ons, load order). The router is not
tagged or published yet, so the checks read it, and pi-setup's branch that forwards the agent
directory, through input overrides (AGENTS.md, "Commands"); the release relocks both inputs.
The quota waiter and its metering come after 0.3.0. Local mode is disabled in the author's setup. The raw
research exports of batch 4 (review economics, two local-harness reports, a
note) were cleaned with `gdr-clean` in pi-task-router; a later batch is
cleaned the same way.
