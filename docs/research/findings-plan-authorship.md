# Findings: who writes the plan, increment sizing, plan review

Sources: three Gemini Deep Research reports: R1 = `two-tier-agent-planning-architecture.md`, R2 = `agentic-plan-and-code-sizing.md`, R3 = `frontier-model-plan-review-protocol.md`. Written by a subagent from the uncleaned exports (`originals/`), so line numbers do not apply; citation numbers do. `[n]` = citation number in that report's Works cited. Treat as general advice; see section 4 for credibility.

## 1. Per-report recommendations

**R1 (who writes the plan)**
- Compares A (Qwen drafts, Opus reviews in rounds), B (Opus writes, Qwen executes), C (Qwen drafts, Opus rewrites once). Recommends **B**; C is "near-optimal" but suffers anchoring on the weak draft; A is worst.
- Reasons: weak planner / strong executor inversion hurts more than the reverse (AgentCARD "Pushing the Cost-Accuracy Frontier of LLM Agent Teams" [1][2]); ~30B models write plans with inverted ordering, bundled scope and tautological checks; critique rounds saturate after 1–2 cycles; adherence comes from plan structure (bounded tasks, negative constraints, check commands), not authorship.
- Plan format: JSON/YAML with milestone → branch → tasks, each with `target_files` (1–3), `goal`, `forbidden_actions`, `check_command`.

**R2 (sizing, memory, replanning, review against plan)**
- Keep increments small: review quality collapses with diff size ("Bigger Isn't Always Better", arXiv 2606.15689 [6]: F1 0.657 under 10 LOC → 0.043 over 150 LOC; verified).
- Task: 1–2 files, ~30–60 net LOC, 4–8 tool turns, clean 8–16k context. Hard split at 3 files / 100 LOC / 10–12 turns. Milestone: 3–5 tasks, ≤150–250 LOC, 2–4 files.
- The plan is external memory (PLAN.md in the repo). Qwen starts each task fresh in a worktree, reads only its task section, and may tick checkboxes only. Goal, acceptance criteria and milestone boundaries are read-only to Qwen.
- Replanning only on deterministic triggers: file outside whitelist, interface/type break, pre-existing test breaks, budget (>10 turns or >100 LOC). Then Opus gives a delta review; a full re-review only for public API or schema changes.
- Opus review package = "triad": task spec + check output + diff. Rubric: spec parity, scope containment, regressions, style (advisory only). Opus over-flags style and rewrites, so suppress non-blocking comments.

**R3 (how Opus reviews a plan)**
- Assumes Qwen drafts. Opus is an auditor, not an author: schema-forced findings, no replacement plan. A deterministic harness computes the verdict (APPROVE iff zero blocking findings), not the model.
- Six review dimensions: decomposition, ordering, check verifiability, granularity (≤2–3 files, 50–150 LOC), codebase consistency, risk/invariants.
- Input: plan + AST/repo map + full text of the files the plan names (≈15–40k tokens); not a whole-repo dump, not plan alone.
- Anti-anchoring: Opus first derives its own invariants from the request and repo map, then audits the plan against them. Anti-rubber-stamp: adversarial/falsification mandate; for every check, name a way it could pass while the feature is broken.
- Read-only reviewer tools. Re-review is differential (findings + diff of amended tasks only), max 3 rounds. Qwen gets atomic criterion-referenced findings, not vague feedback.

## 2. Answer to the OPEN QUESTION

- **R1 answers directly: Opus writes, Qwen executes (B).** R2 is consistent with it: Opus restructures failing tasks, and Qwen cannot edit goals or boundaries.
- **R3 never argues against B**; its premise is "Qwen drafts, Opus audits", and it spends its effort making that workable.
- **Agreement:** (a) a binding Opus gate before execution; (b) tasks bounded and each with an executable check; (c) at most 1–3 review rounds, then escalate; (d) review output must be findings, not a rewritten plan, whenever the draft is Qwen's; (e) Opus needs a repo map plus the targeted files.
- **Disagreement:** R1 says review-without-rewrite by a strong model of a weak draft is the costliest and least stable path (anchoring, critique saturation, TeamBench "role collapse"). R3 says rewriting is the failure to prevent and prescribes schema-only audit. They differ on whether Opus should *author*. R1's cost model also ignores that Opus authoring costs more output tokens than Opus reading.
- **Evidence both sides share:** reviewers are weakest at *check verifiability* (R3 [16]: 11 of 12 frontier models rubber-stamped a test pointed at the wrong module, so Opus review of Qwen's checks is unreliable); this favours Opus *writing* the checks.
- **Inference (mine, not a report claim):** a hybrid fits our design best. Qwen produces grounding only (relevant files, symbols, request digest) via deterministic tools. Opus authors the skeleton: milestones, tasks, goal, file whitelist, forbidden actions, check command. Qwen may then fill in detail text, and its amendments go through Opus delta review. This keeps Opus's single binding plan review and avoids the Qwen-draft/Opus-rewrite loop.

## 3. Concrete guidance for our design (use as starting values, tune with the meter)

**Increment limits**
- Task: 1–2 files, ≤60 net LOC target, split at >100 LOC or >3 files; ≤8 turns target, cap 10–12; working context ≤16k target, ≤32k cap (the 24–32k degradation figure is unsourced and we have 262K; treat as soft).
- Milestone: 3–5 tasks, ≤250 LOC, 2–4 files.
- Opus merge review: aim for diffs ≤150 LOC; above that, reject and split. Add a blast-radius flag (public API, migrations, auth) that forces extra scrutiny even when the diff is small.

**Plan structure** (immutable by Qwen except checkboxes): milestone {id, branch, goal, acceptance criteria, depends_on}; task {id, goal, target_files whitelist, forbidden_actions, check_command, depends_on}. The check must be targeted and fast, and fail on the unmodified tree (record the red run).

**What plan review checks:** decomposition (one concern per task); topological order; each check fails before and passes after, and exercises the changed code; sizes within limits; names/files/imports exist in the repo (retrieval, not prose); risks and invariants (timeouts, idempotency, ordering, migrations).

**Opus plan-review input:** request + acceptance criteria; the plan; AST/symbol map (1–4k tokens); full text of files named in the plan (15–40k); red-run output of each check if available. Read-only tools only. Ask Opus to derive invariants from request + map *before* reading the plan.

**Verdict format:** `{verdict: APPROVE|REVISE, summary ≤500 chars, findings[{id, category, target_task_id, defect, file_evidence, failing_assumption, required_fix_criterion, blocking: bool}]}`. Harness sets APPROVE iff no blocking finding. Add a `check_counterexample` field per task (how the check could pass vacuously).

**Replanning rule:** only on deterministic triggers (non-whitelisted file, interface/type break, earlier-milestone test regression, task over budget, three failed remediation passes). Qwen files a replan request with evidence (log, diff); Opus does a **delta review** of the amended tasks; full re-review only for public API/schema changes. Never mid-task self-edits of goals.

**Keeping Opus from rewriting:** output schema has no plan-body field; system prompt "auditor, not author"; findings must name a task id and a verifiable fix criterion; read-only tools; cap 2–3 rounds, then escalate to the user rather than letting Opus take over; reject a response that contains a replacement plan.

## 4. Credibility

**Load-bearing claims behind the answer**
1. *Weak planner + strong executor loses up to 36% (inverted pairing); heterogeneous teams win.* AgentCARD, arXiv 2606.20629, preprint [1][2]. **Exists; partially supports.** Abstract: up to 44% over *cost-equivalent homogeneous teams*, or 12× lower cost; "domain-dependent" planner vs executor bottleneck. The 36% inversion figure is not in the abstract; R1's table mislabels 44% as "vs inverted pairs". Also not software-engineering specific.
2. *Opus-planner + cheaper executor beats solo, and a cheaper planner halves the score.* Blackbox blog "Orchestrator–Executor…", vendor blog [3]. **Exists, numbers (58.4→69.7) match.** But it is a vendor blog; Opus there explores, plans, delegates *and verifies* (not just plan-writing); the orchestrated stack cost $2.40 vs $0.84 solo; R1 garbles the "45% of cost" point (it was solo GLM vs the Kimi stack). Terminal-Bench, not multi-branch feature work.
3. *Weaker-model plans degrade the executor (COPE).* arXiv 2506.11578, TMLR 2026 [4][5]. **Exists, but the abstract does not support the claim**: it describes small and large models alternating planner/executor in a cascade with plans as a cheap "prior". R1's "weaker plan degrades executor" is unverified and could be the opposite of the paper's thrust for some stages.
4. *Reviewers rubber-stamp bad checks (11/12).* pvolkov.com "Choosing a Fallback LLM for Plan Review", personal blog, one plan, N≈1–4 runs [R3 16]. **Exists; the anecdote matches.** The report's "<15% precision", "88–92% recall", "~85–90% precision" tables are not in the article, i.e. invented.
5. *Review quality falls with diff size.* arXiv 2606.15689 [R2 6]. **Exists; 0.657→0.043 matches.** Caveats: 150 samples; models are Sonnet 4.6/Haiku 4.5/GPT-5.4 mini etc., **not Opus**; correlational; 7-page preprint. R2's intermediate bucket F1 values (0.52/0.38/0.18/0.11) are interpolated, not reported.

**Red flags**
- Invented precision/recall/frequency numbers with no source: R1 defect-frequency table (~35/40/50%), "first-round acceptance <35%", all R3 precision/recall columns, R2 per-bucket F1 and "3–8 turns", "24–32k tokens" thresholds.
- Mismatched citations by title: R3 "39.95% of failed attempts corrected" cited to [15] "Fine-Grained Diagnostics… for MLLMs" and the same 39.95% reused as plan-verification gain from [14] "Formal Modeling…Agent Workflow"; R1 critique-degradation claims cited to [17] "Controlling Form and Detail in LLM Translation Refinement" and [12] "SHEPHERD" (trajectory selection); R1 "Qwen2.5-Coder 47.6% SWE-bench Verified" cited to a price-comparison site (R2 itself says 6–31%); R2 "30B 80% horizon 5–20 min" cited to METR, which did not measure 30B models; R1 cost parameters [30] and [24] "unknown_url".
- Internal contradictions: R1 cites reviewer rewrites as "role collapse" yet rates C (Opus rewrites) near-optimal; task sizes differ (R2 30–60 LOC vs R3 50–150 LOC); R1 16–32K truncation argument is irrelevant to our 262K slot. Many sources are weak (GitHub issue, Reddit, price blogs, mirrors).
- No source directly tests "Qwen-30B-written plan reviewed by Opus vs Opus-written plan" — the open question itself is answered by inference from adjacent evidence.

