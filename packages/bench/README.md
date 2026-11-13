# pi-bench

Bench harness for the pi token-economics work. Code and fixtures live here;
**task data, runs, judgements and reports do not** — they are under `~/.pi/agent/bench`
(`PI_BENCH_DATA`), checkouts and nix caches under `$XDG_RUNTIME_DIR/pi/tmp/bench`
(`PI_BENCH_WORK`, tmpfs). No private repository paths or reference diffs belong in this repo.

```
nix build .#bench             # pi-bench, bench-report (tests run at build time)
nix build .#checks.x86_64-linux.bench
node --test --experimental-strip-types test/*.test.ts     # from this directory
```

## Commands

| command | does |
|---|---|
| `pi-bench run TASK ARM [REP]` | `git archive` baseline → fresh dir + `git init` → agent → harness check → `runs/TASK.ARM.REP/` |
| `pi-bench sched ARM N TASK…` | each task once, `N` in parallel |
| `pi-bench refs` | `refs/<id>.patch` (accepted solution) or `refs/<id>.md` (scouts) from `tasks.json` |
| `pi-bench judge --all [--judges opus,gpt] [--arms a,b] [--parallel N] [--min-runs M]` | multi-arm: blind absolute rubric verdict of every run (of the named arms, with `--arms`) of each task with ≥ 2 runs (`judge/<task>/<run>/<judge>.json`, failing check caps at partial); idempotent |
| `pi-bench judge TASK opus\|gpt [X Y]` | pairwise: blind A/B judge of `TASK.X.1` vs `TASK.Y.1` (default `qwenl` vs `sonnet`), for 2-arm comparisons |
| `pi-bench judge-all [--once] [X]` | pairwise: judge everything that is finished (X default `qwenl`, against `sonnet`) |
| `pi-bench metrics` | per-run session metrics (requests, retried 429s, cost, peak context, folds, children) |
| `bench-report [--factors arm,kind]` | per-factor bootstrap CI (10 000), OLS with two-way interactions, judge κ → `reports/*.md` |

Arms (`defaultArms()` in `src/config.ts`, extended by `<data>/arms.json`): `qwenl`, `sonnet`
(print driver, `pi -p`), `orch` (RPC driver, Sonnet orchestrator with actor-subagents, smoke arm) and the four
orchestrator factor arms `orch-<signs>` (below). The arms name only this flake's extensions. Per-run limit
`BENCH_TIMEOUT` (default 5400 s). `PI_BENCH_PI` selects the pi binary, `PI_BENCH_EXT_DIR` the extension directory.
Your own extensions come in through two lists of names under that directory, comma-separated.
`PI_BENCH_BASE_EXTENSIONS` (`bench.baseExtensions`): every run loads them first, every arm, the factor arms'
children and every judge (which loads nothing else). The children of the smoke arm `orch` run with the live agent directory's settings instead. Your provider login extension, if your pi needs one, belongs
there; the bench does not check for one. `PI_BENCH_ORCH_EXTENSIONS` (`bench.orchExtensions`): only the orchestrator
factor arms (any arm with `factors`) and their children load them, last, after their own list; never the print arms,
the smoke arm `orch` or the judges (a search tool the orchestrator's setup has). Each name once (`src/extensions.ts`).
An old arm of `arms.json` that names one of your extensions still runs, reports and judges, as long as the extension
directory holds it.

The `qwen` arm (the free OpenRouter Qwen, gone) was retired in step Q. Its old runs (`runs/*.qwen.*`) stay in reports unchanged, and `pi-bench judge TASK opus|gpt qwen sonnet` or `pi-bench judge-all qwen` still judges them; without `qwen` named, the pairwise commands leave them alone. `run` and `sched` reject it as an unknown arm unless `<data>/arms.json` defines it again. The bench's only OpenRouter use is the judge `gpt`.

## Orchestrator factor arms

Factors `routing` (off|on), `delegation` (off|on: handoff line + nudge), `t0Widened` (off: t0Limits 3 files /
100000 tokens, on: 10 / 150000) as the 2³⁻¹ half fraction (`halfFraction` of the experiments' design module
`../experiments/core/design.ts`, x3 = −x1·x2, so the all-off baseline is an arm). Arm id = `orch-` + one sign per
factor in that order (`+` = on):

| arm | routing | delegation | t0Widened |
|---|---|---|---|
| `orch----` | off | off | off |
| `orch-+-+` | on | off | on |
| `orch--++` | off | on | on |
| `orch-++-` | on | on | off |

All: `--mode rpc`, `anthropic/claude-opus-5-5` at `high`, extensions: the base ones, actor-subagents,
infinite-context, token-meter, task-router, the orchestrator's extras (+ the probe). Routing off = task-router still
loaded with `routing: false`, so spawns, verdicts and `unjudged` are still written to the outcome log.

Every run of a factor arm gets its own **agent dir** `runs/<run>/agent/` (`PI_CODING_AGENT_DIR`), written by
`materializeAgentDir` (`src/orch.ts`): `settings.json` (thinking level, no telemetry; retries are pi's native ones from the checkout's `.pi/settings.json`),
`task-router/settings.json` (the router base, then `routing`, `delegation.nudge`, `t0Limits`), `actor-subagents/settings.json`
(`childExtensions`: the base extensions, infinite-context, token-meter, the orchestrator's extras; task-router is main only),
`AGENTS.md` (routing on → `~/.pi/agent/AGENTS.md`, off → `~/.pi/agent/notes/2026-10-03-AGENTS.md.before`),
`infinite-context/settings.json` (copy), and symlinks `auth.json`, `models.json`, `models-store.json` to the live
agent dir (no secrets are copied; a login extension that seeds `auth.json` writes through the link). Meter (`agent/meter/`) and outcome (`agent/task-router/outcomes/`) logs of the run land there.
Sources are overridable: `PI_BENCH_AGENT_SRC`, `PI_BENCH_AGENTS_ON`, `PI_BENCH_AGENTS_OFF`. The router base is read at
run time (`routerBase`, `src/orch.ts`) from the live router settings `<agent source>/task-router/settings.json`: its
model keys (`models`, `queueMaxSec`, `contextFit`, `localHealthUrl`, `cloudDailyCap`, `contextWindow`) with
`randomize.enabled` and `spotCheck.enabled` false (no file: `{}`). `PI_BENCH_ROUTER` names a JSON file merged over that
base, and the arm's keys over both, as `lib.recursiveUpdate` does (unset: the live base and the arm's keys). Arms with `factors`
(also from `arms.json`) get this treatment; other arms use the live agent dir as before. `bench-report --factors
routing,delegation,t0Widened` reads the factor levels from the arm.

Caveat: a login extension that keeps its refresh lock in the agent dir does not see the lock of a run with another
agent dir, so such runs do not exclude each other's token refresh. Start a batch with a fresh login (>1 h left) and keep `sched` parallelism small.

## Data layout (`~/.pi/agent/bench`)

```
tasks.json            { "<id>": Task }   see src/types.ts: kind (small|medium|large|scout), prompt, gitdir, sub, base,
                      refs, refExclude, refNote, overlay, extraFiles, check, ref_answer
tasks/<id>/…          extra files (ref_answer.md for scouts, extraFiles sources)
refs/                 generated by `pi-bench refs`
runs/<id>.<arm>.<rep>/  result.json prompt.md final.md diff.patch check.log session/ [events.jsonl probe.json agent/]
judge/<id>/           pairwise: map.json (recorded blinding), pkt/, prompt.<judge>.md, verdict.<judge>.md, <judge>.json
judge/<id>/<run>/     multi-arm (`judge --all`): prompt/verdict/<judge>.json; the blind packet is judge/<id>/pkt-<hash of run>/
reports/              bench-report output
```

## Drivers

* print (`src/driver-print.ts`): `pi -p -ne --approve -e <ext>… --session-dir …`; native retry
  (100 × 2 s) via an untracked `.pi/settings.json` (excluded in `.git/info/exclude`), as in every run of the checkout.
* rpc (`src/driver-rpc.ts`, `probe/index.ts`): `pi --mode rpc` plus the probe extension. A run is **done** when
  the orchestrator settled (the next `agent_settled` after the prompt), the probe reports no running child
  (`__subagentsApi_v1.list()`), and the RPC stream has been quiet for 30 s. A child's reply that wakes the
  orchestrator un-settles it again.
* `bin/` holds the `devenv`/`rustup` shims, put on `PATH` only for tasks whose check uses `devenv`.
