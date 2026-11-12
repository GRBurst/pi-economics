# Scope: what pi-economics is, and what is leaving

Decision recorded 2026-11-12 (after local mode was disabled over the merge-gate
problems: size refusals on real work, cold-cache review economics, fixer churn).
This file is the pointer for a fresh session that needs the goal of the
extension.

## The goal

pi-economics is a **purely exploratory framework**: it measures, analyzes and
experiments with pi's own token economics. It does not route, gate, review or
drive work. Everything below stays:

| Stays in pi-economics | Role |
|---|---|
| `tokenMeter` | the meter: one JSON line per provider request; `meter-report`, `pi-analyse` |
| `analysisSkill` | the skill that runs `pi-analyse` and proposes decisions from the logs |
| `experiments` | one fractional-factorial arm per main session |
| `bench` | `pi-bench`, blind judges, bootstrap reports |
| `cacheLifecycle` | stale-result elision, cache warming (a cost mechanism) |
| `infiniteContext` | context folding: reminders and the cost-aware fold hint |
| `retry` | OpenRouter free-cap handling |
| `actorSubagents` | the patched subagent runner (infrastructure, not routing policy) |
| `piSettings` | the settings.json migration |

pi-economics keeps **observing** the router after the split: the meter reads
the router's outcome log (`task-router/outcomes/*.jsonl`, documented in
`packages/token-meter/LOGS.md`). The observation relationship survives; the
ownership does not.

## What is leaving

### 1. The model router, including local mode → a separate plugin

`packages/task-router` and everything it owns: the task-card routing table,
`/force`, the nudge, and all of **local mode** (hint engine and tripwires,
the Opus overseer, worktrees and branches, the merge gate, plans). The design
record moves with it: `docs/local-mode/` (design and specification, the open
questions, `merge-gate-sizing.md`) and the research that drives that design
(`docs/research/` reports and prompts — its design record).

Why: the router is a control plane with its own product lifecycle, and the
merge-gate work showed it (a hard size budget tuned for one guessed number,
review economics that fight the budget, an escape-hatch discussion). That is
product design, not measurement. Coupling it to a stable exploration
framework slows both down.

### 2. The research cleanup tool → a new repository

The Gemini Deep Research cleanup tool is about processing Gemini exports, not
about pi. It moves to a standalone repository; suggested location
`~/projects/gemini-research-cleanup` (name not final).

- The specification is `docs/prompts/research-cleanup-tool.md` (the future
  tool, as specified).
- The one-off provenance scripts `docs/research/cleanup/clean-batch{1,2,3}.mjs`
  are the seed implementation for it.
- pi-economics keeps the cleaned research reports as *data* (and loses them
  entirely if `docs/research/` moves with the router — either way it does not
  keep the tool).

## Open for the extraction sessions

- Router plugin: repository name and layout; how it is installed alongside
  pi-economics (two pi packages, one agent dir); ownership of the outcome-log
  contract (`LOGS.md` documents it today); its own version (this repository
  currently ships one version constant for everything, including the router's
  package.json).
- Whether `docs/research/` moves wholesale with the router or is split
  (router design record vs generic research).
- Cleanup-tool repository: name, layout, and what exactly migrates from
  `docs/prompts/research-cleanup-tool.md` and the batch scripts.

## Current state (2026-11-12)

Local mode is disabled in the author's setup (the components stay installed;
the router routes in default mode). Nothing has moved yet; this file and the
README note are the only changes. Unprocessed raw research exports sit in
`docs/research/originals/` (batch 4: review economics, two local-harness
reports, the next batch) for a later cleanup session.
