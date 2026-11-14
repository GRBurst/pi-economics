# Meter analysis — 2026-11-12

A historical snapshot, written before the 0.3.0 analyser: its figures use the old definitions (the
$/accepted headline, the cache-miss share, the quota share, pooled experiment effects, designs v2–v4)
and are not comparable with a report from the current `pi-analyse` (`packages/token-meter/LOGS.md`).

Snapshot of the fleet's token economics from a `pi-analyse` run over the meter logs
(`~/.pi/agent/meter/2026-10.jsonl`, `2026-11.jsonl`; 102,400 lines: 2,420 v0 format, 99,980 v1).
Generated report: `~/.pi/agent/reports/2026-11-12-1257-analysis.{md,json}`.
Period: 2026-10-02 → 2026-11-12 (41 days, 41 root sessions).

## Fleet baseline

| metric | value |
|---|---|
| total spend | $5,385.57 |
| active time | 596.46 h |
| cost per active hour | $9.03 (CI 5.93–11.13) |
| accepted tasks | 445 / 470 |
| cost per accepted task | $4.15 |
| requests | 94,176 |

By model: Opus 5.5 $4,867.73 (**90.4%**), Sonnet 5.5 $513.83 (9.5%), Haiku $3.97, local qwen
(`qwen3.8`, `qwen3.8-27b:free`) $0 (5,093 requests). The fleet is already
"Opus-only in practice": the hypothetical baseline of the review-cost forecast thread is the
measured reality.

## Token components (price-ratio estimate)

| component | $ | share |
|---|---|---|
| fresh input | 0.43 | 0.008% |
| cache reads | 2,931.98 | 54.4% |
| cache writes | 1,434.88 | 26.6% |
| output | 1,018.28 | 18.9% |

81% of spend is cache mechanics; fresh input is negligible — pi's own cache warming works.
Overlapping splits: cache rewrites $1,357.06 (25%, 77,435 req); warming $278.22 (5%, 8,224 req);
**re-cold after cold resume $623.62 (12%, 723 req, ~$0.86/req ≈ 15× a warm req)** — the largest
identifiable cache inefficiency; after folds $133.36 (2%).

## Folds (pi-infinite-context) — the biggest measured lever

438 folds: cache-read saved $1,970.01 − rewrite paid $51.89 = **net +$1,918.12 = 35.6% of total
spend**; only 4% of folds net-negative. Value decays steeply with fold depth (K/R = folded span
vs retained context):

| K/R | folds | net $ |
|---|---|---|
| < 0.25 | 254 | 1,410.45 (89% of value) |
| 0.25–0.5 | 99 | 393.04 |
| 0.5–1 | 55 | 65.53 |
| 1–2 | 24 | 45.27 |
| ≥ 2 | 6 | 3.83 (50% net-negative) |

By design: v3 cache-aware 265 folds → net $1,564.03; v3 fixed 160 → $341.71.

## Experiment status: inconclusive

v3: 29 units; **no factor CI excludes 0** (mainCacheTtl 1 h +1.77 [−5.65, 8.11]; warmPolicy
−1.57 [−8.34, 5.03]; freshOnCold −1.46; maskOnCold +5.64; foldHint +3.64; delegationRule +2.74);
OLS R² 0.19 n.s. Skew cause: one arm carries a single unit with 283.4 h = **47.5% of all active
hours** (a marathon session, $9.07/h) — CIs are not trustworthy until it is analyzed separately.
v1 arms are degenerate (1 unit each).

## Delegation and tiers

- Child (delegated) sessions: $4,234.21 = **78.6% of spend**, 82.1% of requests; main sessions
  $1,151.36 (21.4%).
- 776 spawns; 65 spot-check reviews; 218 (28%) without a resolved task-card file (kind unknown).
- Checks: 504 ran, 70 failed (13.9%).

| tier | tasks | share | acceptance | $/accepted |
|---|---|---|---|---|
| T2 (Opus) | 267 | 54% | 97% | 6.44 |
| T1 (Sonnet) | 142 | 29% | 97% | 2.22 |
| qwen (local/free) | 82 | 17% | 86% (CI 77–95) | 0.56 |

**T1 = T2 acceptance at 2.9× less**; randomized subset: T1 only, n=17, 100% (16/16),
$0.96/accepted. **No qwen arm in the randomized data** — the qwen read is correlational.
qwen share 16.6% vs the SC3 target ≥ 30%: miss on both axes (share; 11-pt acceptance gap vs the
10-pt boundary). Spot checks: 35 requested, 52 judged, 52/52 agreement (100%), 14 pending.
Kinds (493 resolved, excluding spot checks): implement 257, plan 83, review 70, mechanical 31,
scout 25, overseer 14, debug-design 9, lookup 4.

## Review layer vs the forecast

Review-kind children (multi-turn, with tools): 69 tasks at **$3.27 (T1) / $3.98 (T2) per
accepted** ≈ $220 total = **~4% of fleet spend**. A single-pass cold gate review (≈ $0.03–0.12)
would be 30–100× cheaper per review; quality equivalence is the pending shadow A/B. Rejection
loop: the fixer re-review within the 5-min TTL reads the cached prefix at ~0.1× — cheaper than a
cold model pass.

## Runaway sessions (limit: 150 req / $10 per child)

155 sessions = **43.3% of spend** ($2,329.68, 39,435 req); 111 over $10 (excess over $10:
**$898.39**; over $15: $517.56); 30 over $20; 9 over $30; max $64.03 (854 req). Quantiles:
p25 $9.43 / p50 $12.30 / p75 $18.19. Cost by task prefix: prep $516, impl $415, fix $409 —
long-horizon work systematically breaches the bounded-task limits.

## Interpretation — where we stand

1. The dominant cost term is **long-horizon delegated work**, not the main session (43.3% of
   spend in runaway sessions; children 78.6% overall). The real-world work unit is far larger
   than the 150-line increments the merge gate sizes for: the 150/6 cap and the prompt-8
   budgets are Qwen-executor / Haiku-reviewer-era artifacts and need an Opus-reviewer cliff
   study (OQ6/OQ19) before they are treated as tuned.
2. The Opus-cliff / 150-cap question is **unmeasurable from the meter today**: no merge-gate
   events (the gate never ran in local mode) and no nLines fields. It needs the gate running
   plus a pi-analyse merge-gate section.
3. The review-structure levers from the forecast (15–60% of L₀) apply to ~4% of spend. Measured
   levers, ranked by size: runaway discipline ($898 excess alone), fold depth (shallow folds
   have negative marginal value), re-cold (12% of spend, hypothesis unproven), model mix
   (T1=T2 parity; qwen causal gap), review design (30–100×, unvalidated).
4. pi's cache warming and pi-infinite-context are not side effects: 81% of spend is cache
   mechanics, and folds are net +35.6% of total spend.

## Data quality

- 28 warming lines (0.3% of 8,224) miss usage fields (all Opus 5.5, 2026-10-06→27, scattered;
  < ~$1) — writer/provider quirk.
- 133 lines miss the arm field (v0 legacy, expected).
- 142/493 resolved tasks (28.8%) lack a `task_verdict`.
- 218/776 spawns (28%) without a resolved card file.
- 14 child sessions without a spawn event; 103 assignments without meter lines.

## Decision menu (proposed — awaiting decision, nothing applied)

- **A. Fold strategy**: bias against shallow folds (K/R ≥ 2 is 50% net-negative; K/R < 0.25
  carries 89% of the value).
- **B. Keep the v3 experiment running**; analyze the 283-h unit separately; no TTL / warmPolicy
  conclusions yet.
- **C. Reroute T2→T1** for measured-parity kinds (or keep T2 only where importance justifies
  2.9×); **add a qwen arm** to the randomized design before pushing its share toward 30%.
- **D. Runaway discipline**: tighter per-session limits or forced decomposition of the
  long-horizon kinds (impl/fix/prep = $1,340 of the excess pool).
- **E. Hygiene**: `task_verdict` before kill; card file at spawn — fixes the 28% / 28% gaps.
- **F. Minor**: log or fix the 28-line warming usage quirk.
