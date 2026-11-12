# Merge-gate sizing: class, atomic units, and the review's fixed cost (proposal)

Status: proposal (OQ21) — open, not accepted; the current budgets stay: 150
lines / 6 files (gate), 100/3 (task), 250/6 (milestone; clamped to 150/6 by
the gate). The batch-3 report
(`docs/research/autonomous-merge-pipeline-size-limits.md`) and prompts 8–9
(`docs/research/prompts.md`) are on main.
Triggered by `size` refusals on real work (a docs branch of 1148 lines / 8
files adding user-supplied references; a CI-images migration of 13299/136;
repeated hits in other sessions) and one metered waste: a 46 s cold Opus
review ran on `lm/context-folding-notes` before the `main-dirty` refusal
that a step-2 check would have returned for free.

## 1. What the gate gets wrong

1. **One global budget for three jobs.** `maxDiffLines`/`maxDiffFiles`
   simultaneously cap reviewer attention, executor reliability and the unit
   of work. A reference drop, a small code fix and a migration are all
   "branches" with very different review value.
2. **Lines as a proxy for review value.** Review value is a function of
   class and risk, not line count. For reference material the user collected
   (markdown under `docs/`), an LLM review detects essentially nothing: the
   real gates are deterministic (leak, boundary, build). Paying a cold
   frontier review for it is pure cost.
3. **The remedy is the most expensive path.** Each merge pays a fixed cost
   `F` — the branch check, the red run (a second check run at base), and the
   cold prefill of the review (the overseer is a fresh session per review:
   system prompt and framing at full price) — plus a variable part
   `v·(diff + check output)`. Laying a unit of work `W` out as `n` merges
   costs ≈ `n·F + v·W`: **splitting strictly increases the total review and
   check cost**. It does buy something: the recall-per-review gain is real
   and verified for code (README spot check: review F1 0.657 below 10
   changed lines, 0.043 above 150). The question is total cost per unit of
   work, where splitting multiplies `F`; "split the branch" is the most
   expensive shape available, and the gate prescribes it as the only remedy.
   (The research's own cost function agrees at the small end: below ≈30
   lines, orchestration overhead dominates the denominator.) The diff budget
   is `8·lines + 8·files`, so a 150/6 diff arrives at the reviewer as up to
   ≈1250 input lines of context and headers.
4. **No escape, no class, no data.** No override on `request_merge`, no
   docs/reference class, one budget for all repositories, plan budgets can
   never exceed the gate budget, and the tuning loop (OQ17) is unbuilt. The
   numbers are guesses (OQ6), and the only published "evidence" so far
   (`autonomous-merge-pipeline-size-limits.md`) recommends *smaller* (120/3)
   — contradicting the lived experience. Its recall data is about code
   review and never models our per-merge fixed cost, so the two objectives
   (recall per review vs total cost per unit of work) can have different
   optima.

## 2. Proposal

Principle: **spend the review budget in proportion to review value (class ×
risk), not diff size.**

### 2.1 A deterministic branch class

From the numstat; no model-declared exemption. Setting
`mergeGate.inertGlobs` (default `["**/*.md", "**/*.txt", "**/*.rst",
"**/LICENSE", "**/NOTICE"]`; globs are anchored and `*` stays within one
path segment, so the `**/` prefix is what matches at any depth, as in the
riskGlobs). Excluded from inert (routed to code): agent-instruction files —
`AGENTS.md` and `CLAUDE.md` at any level, anything under `.pi/`, the
`skills` and `prompts` paths the repository's package manifest declares (a
pi package can declare them anywhere) and anything under a directory named
`skills` or `prompts` at any depth — files under `plans.dir` (a branch that
rewrites the plan, including marking a milestone `atomic`, goes through a
code review; that trust is the premise of §2.2) — and matches of the
router's riskGlobs.
An unreviewed rewrite of the base's AGENTS.md would re-poison every later
review: the overseer uses the base's AGENTS.md precisely because it is
trusted (LD14). An inert branch must have at least one user-configured
`mergeGate.extraChecks` entry; the model-supplied branch check does not
count — for a non-plan branch it is written by the model at `start_branch`,
and the inert red run is skipped, so a vacuous check (`true`) would go
unflagged. Without an `extraChecks` entry the branch is refused
(`no-check`): an inert merge with no real check is just a bypass with
better manners.

| | inert (all files match) | code |
|---|---|---|
| refusals (step 2) | as today, plus main-dirty | as today, plus main-dirty |
| size refusal | none | as today (150/6) |
| checks | `extraChecks` (leak, boundary, build) | as today |
| red run | skipped | as today |
| LLM review | **none** | as today |
| merge line | `class: inert` | `class: code` |

This is the process for "the user dropped references into the repo": a
branch, the gate, done — no Opus, no splitting.

### 2.2 An atomic override for unsplittable code units

A plan milestone the author marks `atomic` in the plan file (trusted only
through an Opus-approved plan — the marker in the working copy alone is not
evidence; §2.1 keeps plan files out of the inert class for the same reason)
merges at `atomicFactor × (150/6)`
(default factor 5 → 750/30); the reviewer is told the unit is atomic
(review it whole; invariants and the check first); the merge line logs
`atomic: true`. Capped at 2 atomic units per session. 750 lines is above
the verified recall range (F1 0.043 above 150): the compensation is the
invariants, the checks and the atomic instruction, and it is the rare path,
not the default. A migration that large as the 13299/136 example is beyond
one atomic unit: structure it as a plan of atomic milestones (each ≤ 750/30);
if it is truly one unit, it merges manually outside the gate — a logged
bypass, the last resort, visible in the OQ17 section. No silent bypass
otherwise: the path is visible.

### 2.3 Measure before tuning (OQ17, token-meter)

Per merged branch: class, atomic flag, review input/output tokens and $
(the overseer child is metered), check and red-run durations, refusal
reason, rejection rate. From that: cost per unit of work by split
granularity, and per-class budgets. That is where 120 vs 150 vs 300 gets
judged with our own numbers — and where the research's recall curve gets
tested against our cost curve.

### 2.4 Later, if `F` proves dominant: cache-warm review

One overseer session per branch (or per work session) reviewing several
requests in sequence: system prompt and repo context cached, only the new
diff at full price. Attacks `F` directly. A bigger change (overseer
lifecycle); take it up after 2.3 shows `F` is the cost to kill.

### 2.5 The research numbers, recorded but not adopted

From `autonomous-merge-pipeline-size-limits.md` §6: maxDiffLines **120**
(hard cap 150), maxDiffFiles **3**, task budget **60 lines / 1–2 files**,
milestone **200 lines / 5 files**; plus a three-round review cap, diff-only
re-review in rounds 2–3, and tier routing (Haiku < 50 lines single-file
non-logic; Sonnet 50–120 lines 1–3 files; Opus for 3+ files and critical
paths). Kept as exploration candidates; the current values stay until 2.3
or an experiment arm (OQ13) says otherwise. Note the tension: the report
optimizes recall per review, our cost model says the per-merge fixed cost
dominates — different objectives, possibly different optima. The report's
load-bearing sources are not spot-checked (`docs/research/cleanup.md`).

## 3. Phases

| Phase | Work | Where |
|---|---|---|
| P0 (config only, now) | nothing ships; the parked docs branches fast-forward manually (the established pattern); optionally the user raises `mergeGate.maxDiffLines`/`maxDiffFiles` globally to unblock a repository's work (one value for all repos) | user settings |
| P1 (task-router milestone) | the class (§2.1), the atomic override (§2.2), main-dirty in step 2 as well as step 9, the `class`/`atomic` fields on the merge line | task-router |
| P2 (token-meter task) | the OQ17 merge section (§2.3) | token-meter |
| P3 (tune) | per-class budgets from data; cache-warm review if indicated (§2.4); budget levels as experiment arms (OQ13) | both |
