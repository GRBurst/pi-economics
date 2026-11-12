# The research prompts

The twelve Gemini Deep Research prompts behind the reports, as sent. Prompts 1–3 went out first; 4–6
after the decision to review plans and merges with Opus. The evidence rules at the end were meant for 4–6;
the user's own prompt carried similar rules. Prompt 7 was added with `docs/local-mode/design.md` (its
OQ10); prompts 7 and 8 went out with the evidence rules appended, and both reports are in. Prompt 9 was
added after the first `size` refusals hit real work and went out with the evidence rules appended.
Prompts 10 and 11 were added after the review-economics report (prompt 9's) and went out with the
evidence rules appended; the reports for prompts 9, 10 and 11 are in `originals/` awaiting the next
cleanup batch. Prompt 12 was added after the risk-classification and review-economics reports;
send it with the evidence rules appended.

| Prompt | Report |
|---|---|
| 1 | `llm-routing-for-coding-agents.md` |
| 2 | `local-model-coding-orchestration-research.md` |
| 3 | `strong-model-oversight-for-agents.md` |
| 4 | `two-tier-agent-planning-architecture.md` |
| 5 | `agentic-plan-and-code-sizing.md` |
| 6 | `frontier-model-plan-review-protocol.md` |
| 7 | `coding-agent-loop-harness-research.md` |
| 8 | `autonomous-merge-pipeline-size-limits.md` |
| 9 | `LLM Code Review Economics.md` (in `originals/`, cleanup pending) |
| 10 | `Code Review Risk Classification.md` (in `originals/`, cleanup pending) |
| 11 | `Autonomous Code Review Economics.md` (in `originals/`, cleanup pending) |
| 12 | not yet run |

## 1. Open-weight routing models that run on a CPU

```
Research open-weight models and methods that decide which LLM should handle a task ("LLM routers", "model selection", "difficulty/complexity classifiers", "cascades"), for use inside a coding agent.

Setting: A local coding agent runs on a local open-weight model (Qwen 3.x class, ~30B, on one consumer GPU with a single inference slot). It can delegate subtasks to three cloud models of increasing capability and cost: Claude Haiku, Claude Sonnet, Claude Opus. Each subtask is described by a structured card: kind (scout, lookup, mechanical, implement, debug-design, review, plan), list of files, a check command, acceptance criteria, and self-declared flags (bounded, specified, verifiable, low-risk, small, linear; plus high-risk triggers such as security, interface change, concurrency, destructive migration, repo-wide, unknown root cause). A deterministic rule-based router already maps cards to models. I want to know whether a learned decision model would add value, and whether one can run on CPU next to the GPU-bound main model.

Questions:
1. Which open-weight routing/decision models exist (e.g. Arch-Router-1.5B, NVIDIA prompt-task-and-complexity-classifier, RouteLLM's BERT/causal routers, RouterDC, GraphRouter, Router-R1, xRouter, and any newer ones)? For each: parameter count, base model, license, input format, what it outputs (binary strong/weak, multi-class, scores), training data domain, and whether it supports more than two target models.
2. Hardware: realistic CPU latency and RAM for each (quantized GGUF/ONNX where available), and whether it is packaged for Ollama, llama.cpp or ONNX Runtime.
3. Evidence on coding and agentic tasks specifically (SWE-bench, multi-step tool use), not chat benchmarks. Does routing quality transfer from chat prompts to coding-subtask descriptions?
4. Is a small learned router better than (a) rule-based routing from structured metadata, or (b) the main agent model choosing for itself with hints? Cite comparisons if any exist.
5. Can routers be adapted cheaply (few-shot policies, plain-language route descriptions, small fine-tune from logged outcomes)? How much logged data is needed?

Output: a comparison table (model, size, license, CPU latency, outputs, coding evidence, multi-target), then a recommendation with reasoning, then open risks. Cite primary sources (papers, model cards, repos) with dates; prefer 2025–2026 work; flag claims you could not verify from a primary source.
```

## 2. A small orchestrator that escalates to frontier models

```
Research the evidence that a small or local open-weight model can orchestrate an agentic coding workflow and call frontier models only when needed, reaching code quality and task success similar to a frontier-model orchestrator at much lower cost.

Setting: The orchestrator is a local Qwen 3.x-class model (~30B, 262K context, one GPU). It does most work itself and delegates subtasks to Claude Haiku / Sonnet / Opus via structured task cards. No human in the loop for routing decisions.

Questions:
1. Which studies show this (e.g. NVIDIA ToolOrchestra / Orchestrator-8B, small-agent collaboration papers, "advisor"/"consultant" patterns, cascades like FrugalGPT, speculative/agentic cascades)? For each: setup, models, benchmarks, cost and quality numbers, and whether the orchestrator was trained specifically for orchestration or only prompted.
2. Does the result hold for prompted (not fine-tuned) open models such as Qwen3, Qwen3-Coder, GLM, DeepSeek, gpt-oss acting as orchestrators? What failure modes are reported (over-delegation, under-delegation, poor task decomposition, tool-call errors, context loss on long horizons)?
3. How do these systems decide when to escalate: self-assessed confidence, verifier/test results, uncertainty signals (logprobs, self-consistency), learned policies, or fixed rules? Which signals predict "the small model will fail" best on coding tasks?
4. What delegation interface works best for a weak orchestrator: free-form messages, structured task cards, tool calls, or full handoff of the session?
5. Long-horizon limits: at what task length, file count, or context size do small orchestrators degrade in reported work?

Output: a summary table of studies (setup, models, trained vs prompted, benchmark, cost, quality vs frontier baseline), then the escalation signals ranked by evidence, then concrete design recommendations for a prompted Qwen orchestrator. Cite primary sources with dates; prefer 2025–2026; separate peer-reviewed results from preprints and blog posts.
```

## 3. Opus overseeing the local orchestrator

```
Research how a strong model should oversee or review a weaker agent orchestrator in agentic coding: when to trigger oversight, what the overseer should see, and whether its verdict should be advisory or binding.

Setting: A local Qwen 3.x-class model orchestrates a coding session and delegates subtasks to cloud models. Claude Opus is not the worker; it acts as an occasional overseer, invoked by the system (not the user) on particular events. Candidate trigger events: a check or test fails twice; a high-risk trigger appears (security, interface change, concurrency, destructive migration, repo-wide change, unknown root cause); the orchestrator claims the task is done, before commit; looping or stalling (many turns without progress, context nearly full). Cost matters: Opus calls are expensive.

Questions:
1. What does the literature and practitioner evidence say about strong-model oversight of weak agents (scalable oversight, weak-to-strong / strong-to-weak supervision, LLM-as-judge for code, critic/reviewer agents, "advisor" models, plan verification)? Cite results on coding tasks.
2. Which trigger events give the best quality gain per oversight call? Are there results comparing event-triggered review with periodic review, review at the end only, or review of plans versus review of diffs?
3. What should the overseer receive: the diff, the plan, the full transcript, a compressed summary, test output? Trade-offs in cost versus detection rate.
4. Advisory versus binding verdicts: evidence on weak agents ignoring or misapplying feedback, and on the overseer taking over versus guiding. How do systems keep the overseer from doing the work itself?
5. Signals for detecting looping, stalling, or silent failure in an agent session cheaply, without calling the overseer.

Output: ranked trigger events with evidence, a recommended overseer input package per trigger, a recommendation on advisory versus binding with reasoning, and known failure modes. Cite primary sources with dates; prefer 2025–2026; mark unverified or vendor-only claims.
```

## 4. Who writes the plan

```
Research who should write the implementation plan in a two-tier agentic coding setup: a local open-weight model (Qwen 3.x class, ~30B, one GPU, 262K context) that orchestrates and implements, and a frontier model (Claude Opus) that is expensive and used sparingly.

Plan shape: milestones, each split into tasks with a goal and a check command; each milestone or task becomes one small feature branch, merged after a frontier-model review. Plans are only written when a request spans more than one branch.

Compare three arrangements:
A. The weak model writes the plan; the strong model reviews it (binding approval, possibly several rounds).
B. The strong model writes the plan; the weak model executes it.
C. The weak model drafts, the strong model rewrites rather than reviews.

Questions:
1. What evidence exists on planner–executor splits with models of different strength (plan-and-execute agents, planner/coder/reviewer pipelines, "strong plans, weak executes", weak-to-strong refinement)? Report setups, models, benchmarks and measured quality and cost.
2. How well do mid-size open models (Qwen3, Qwen3-Coder, GLM, DeepSeek, gpt-oss) decompose software work: typical defects in their plans (missing steps, wrong order, tasks too large, unverifiable checks, ignoring existing code)?
3. When a strong model reviews a weak model's plan: how many revision rounds are typical, does the weak model apply plan feedback faithfully, and when does rewriting become cheaper than reviewing?
4. Does an executor follow a plan better when it wrote the plan itself (ownership, consistency with its own reasoning) or when a stronger model wrote it (higher quality but possibly beyond its ability)?
5. Cost model: output tokens for writing a plan vs input tokens for reviewing one; which arrangement is cheaper per accepted plan?
```

## 5. Plan and increment size for weak executors

```
Research how to size and structure plans and code increments when a mid-size local model (Qwen 3.x class, ~30B) executes them and a frontier model reviews each increment before it is merged.

Setting: a plan has milestones; each milestone has tasks; a milestone or a single task is one feature branch (git worktree). Each branch gets one merge review by Claude Opus, which sees the diff, the check output and the plan section the branch implements. Progress is tracked in the plan file, not in the model's context.

Questions:
1. Diff size vs review quality: what does evidence say about defect detection rate as a function of diff size, for human code review and for LLM reviewers? Is there a size beyond which review quality drops sharply?
2. Task granularity for weak executors: what task size (files touched, lines changed, turns, context tokens) do mid-size models complete reliably? Evidence from SWE-bench-style analyses, long-horizon agent studies, METR task-length work.
3. Plans as external memory: evidence that keeping progress and decisions in a file (plan, notes, todo) instead of the context improves long-horizon agent performance, especially for small models.
4. Replanning: how should plan changes during execution be handled (re-review whole plan vs changed part only, triggers for replanning, risk of plan drift)?
5. Reviewing an increment against a plan section: does giving the reviewer the intended goal improve detection over diff-only review? What should the reviewer check (scope creep, missing parts, plan conformance)?
```

## 6. Strong-model plan review

```
Research how a frontier model should review an implementation plan written by a weaker coding model, before any code is written.

Setting: a local Qwen 3.x-class model writes a plan (milestones, tasks with goals and check commands, branch boundaries). Claude Opus reviews it once, with a binding verdict, and later reviews only amended sections. No human is involved.

Questions:
1. What evidence exists that reviewing plans or designs early catches defects that later code review misses (software engineering literature on design review, and LLM-agent studies on plan verification)? How large is the effect?
2. What should a plan review check: decomposition, ordering and dependencies, verifiability of each check, task size, consistency with the existing codebase, risk areas? Which of these do LLM reviewers catch reliably?
3. What input should the reviewer get: the plan alone, plan plus a repository map, plus relevant files? Cost versus detection trade-offs.
4. Verdict format: typed verdicts (approve / revise with findings), how to keep the reviewer from rewriting the plan itself, and how weak models handle each kind of finding.
5. Failure modes: anchoring on the weak model's framing, rubber-stamping, over-specification that a weak executor cannot follow.
```

## 7. Breaking loops of small local coding agents: hints, blocks, resets

```
Research how a deterministic harness should detect and break loops and stalls of a small local coding agent, and whether advisory feedback works or the harness must block.

Setting: a local Qwen 3.x-class model (~30B, one inference slot) drives a coding agent and does most work itself. The harness sees every tool call and result. It detects tripwires (the same tool call 3 times; writes that leave the file unchanged; an A-B-A-B call pattern; the same error twice; the same file edited 3 times in 4 turns; a check failing twice; context nearly full without progress) and appends a short fixed note to the tool result. If the pattern persists, a frontier model (Claude Opus) is asked once for typed, advisory findings. No human is involved.

Questions:
1. Adherence: do small open models (7B-35B) change behaviour after harness feedback injected into tool results or system reminders? Compare with blocking the call (a tool error), forcing a context reset or summary, and re-prompting. Which intervention ends a loop most often, and at what cost?
2. Detectors: which loop and stall detectors have measured precision and recall in agent trajectories (exact call repeats, n-gram or alternation patterns, error-text similarity, no-progress counters, learned trajectory monitors)? What thresholds were used, and how often do they fire on productive work (false positives)?
3. Progress: how do agent harnesses or studies define progress deterministically (tree changes, test results, new information read), and which definition best separates stuck from slow?
4. Escalation: after a detector fires, when is escalating to a stronger model (advice only, or taking over the subtask) better than letting the small model retry? Evidence on advice-only overseers versus handoff.
5. Repetition across a session: do repeated hints lose effect (habituation), and how should cooldowns or escalating severity be set?
```

## 8. Size limits for the autonomous merge pipeline

```
Research the concrete size limits that should govern an autonomous merge
pipeline, for one specific model combination: a local open-weight executor
(Qwen 3.8, 27B) and three Claude reviewer tiers (Opus 5.5, Sonnet 5.5,
Haiku 5.5).

Setting: a local coding agent runs Qwen 3.8 (27B, open-weight) on one
consumer GPU with a single inference slot and does most work itself. Each
unit of work is one git-worktree branch with a check command that must pass
before a merge is requested. Before merging, one Claude model reviews the
increment: it sees the unified diff, the check output, and the goal and
acceptance criteria for the change. The pipeline enforces hard caps:
maxDiffLines (currently 150 changed lines = added + deleted) and
maxDiffFiles (currently 6 files) per branch, plus executor task budgets
(100 lines / 3 files per task; 250 lines per milestone branch). I need
evidence to set these caps for this exact combination.

Questions:
1. Executor capability (Qwen 3.8, 27B): what do benchmarks or trajectory
   analyses report for Qwen 3.8 models as agentic coding executors —
   success rate by patch size (files modified, lines changed), tool-turn
   budget, and context limits? Cite every study that evaluated a Qwen 3.8
   model (SWE-bench family, DeepSWE, Terminal-Bench, or similar), with the
   exact numbers and the model size tested. Where only other Qwen 3.x sizes
   were tested, say so explicitly and how far the result transfers to 27B.
2. Reviewer collapse curves, per reviewer model: for Claude Opus 5.5,
   Sonnet 5.5 and Haiku 5.5, evidence on defect detection (F1, precision,
   recall) as a function of diff size — for these versions if evaluated,
   else for the nearest published Claude version. For each: the size at
   which recall drops sharply, the shape of the curve, and the setup
   (synthetic mutations vs real PRs, single-file vs multi-file).
3. Files vs lines: which governs review quality more — files changed or
   lines changed? Evidence on multi-file diffs (cross-file context,
   imports, interleaved refactoring) for each reviewer tier.
4. Tier assignment: evidence that a cheaper reviewer (Haiku 5.5 class) is
   sufficient for small diffs and a frontier reviewer (Opus 5.5) is only
   worth it above a size or blast-radius threshold — and what that
   threshold is.
5. Rejection economics: how do rejection rate, finding counts and
   false-positive rate of LLM reviewers behave as a function of diff size,
   and what cap minimizes cost per accepted-and-correct merge?
6. Concrete recommendation: for this setup (Qwen 3.8-27B executor;
   Opus 5.5 as binding merge reviewer; Sonnet 5.5 as fallback), propose
   (a) maxDiffLines, (b) maxDiffFiles, (c) the executor's per-task budget
   (lines / files), and (d) the milestone cap — each with its evidence and
   a confidence rating, and every number that rests on extrapolation
   rather than direct evidence for these exact models flagged as such.
```

## 9. Review economics: fixed versus variable cost, batch versus split, risk triage

```
Research the economics of LLM code review in autonomous pipelines, specifically where the cost of review falls as a given unit of work is landed as more or fewer increments.

Setting: a local coding agent (Qwen 3.8, 27B) lands work through a merge gate. Each merge request runs a deterministic check, plus a second run of that check at the base commit (a "red run"), and then one frontier model (Claude Opus 5.5) reviews the diff in a fresh session — cold cache, so the reviewer's system prompt and framing are re-prefilled at full price for every review — and gives a typed approve/reject verdict. The gate caps each branch at 150 changed lines (added + deleted) and 6 files, and prescribes "split the branch" beyond that. We suspect the per-merge fixed cost (check runs, cold prefill, framing) dominates the variable cost, so that splitting work into more, smaller increments raises the total cost per unit of work instead of lowering it.

Questions:
1. Fixed versus variable review cost: published or measured breakdowns of LLM code-review cost into a per-review fixed component (system prompt, reviewer instructions, repo context, check output) and a per-diff-token component. How large is the fixed component relative to a 100–300 line diff for frontier-class models (Claude Opus/Sonnet 4.x/5.x or the nearest published tier)?
2. Batch versus split: evidence (studies, vendor engineering posts, practitioner measurements) on total review cost and on defect detection for the same total work landed as one large review versus several small ones — including the added check/test runs and orchestration overhead. Any measurement of cost per accepted-and-correct unit of work as a function of split granularity?
3. Risk triage: how do production code-review systems (CodeRabbit, Greptile, Graphite, Snyk, or similar) decide which changes get deep review versus light or no review — file classification, path risk, change type, test coverage — and what does their data say about missed defects in the lightly reviewed class?
4. Cache economics: evidence on reducing the per-review fixed cost with prompt caching or persistent reviewer sessions (one reviewer model session reviewing many diffs in sequence), and by how much the per-review input cost drops once the prefix is cached?

Output: for each question the evidence with exact numbers and sources; a cost model (fixed per review F, per-line v) with your best estimates for a 5.x-class reviewer and the implied optimal split granularity for low-risk versus high-risk work; and the list of least-certain claims.
```

## 10. Classifying changes: who already decides which diff gets which review

```
Research whether and how people already classify individual code changes (diffs / pull requests) into risk or value classes to decide how much — or what kind — of automated review each change gets, in autonomous or semi-autonomous merge pipelines.

Setting: a local coding agent (Qwen 3.8, 27B) lands work through a merge gate. Each merge request currently gets the same treatment: a deterministic check, a second run of that check at the base commit, and one frontier-model (Claude Opus 5.5) review of the diff in a fresh session. We suspect this is the wrong default: for some changes (e.g. user-supplied reference material under docs/) an LLM review detects essentially nothing and the deterministic checks are the real gate, while for other changes (security-relevant, cross-module, concurrency) the review is the only real gate. We want to assign each change to a class — e.g. inert (no LLM review, checks only), light (cheaper reviewer or a smaller review), deep (frontier reviewer) — deterministically, from the diff itself (file types, paths, changed symbols and modules, test coverage, change type) rather than from the model's self-declaration.

Questions:
1. State of the art: what published work and production systems already do change classification or risk scoring for review allocation — PR risk-prediction models (Microsoft, Google, GitHub, GitLab studies), production review bots (CodeRabbit, Greptile, Graphite, Snyk, SonarQube) and their triage or classification features, security triage (SAST/CodeQL finding prioritization), risk-based code-review literature (IEEE/ACM), and any LLM-agent pipeline that routes diffs by class? For each: the features used, the classes, and the measured effectiveness.
2. Features that predict review value or defect likelihood per change: file/path history (churn, past defect density), change type (docs vs code vs config vs generated), blast radius (call graph, symbols touched), test coverage of the touched lines, diff size, dependency distance from entry points. Which of these have measured predictive power for "this change will contain a real defect" or "this change is worth deep review", and with what precision and recall?
3. Rules vs learned classifiers: evidence comparing simple deterministic rules (path and file-type heuristics, symbol allow-lists) with learned risk models for the same job — when do learned models beat rules enough to justify their cost, and how much labeled data do they need?
4. The inert class: evidence that LLM code review adds little for specific change classes (documentation, configuration, test-only, formatting, dependency bumps) — measured review precision in those classes, or production data on defect-discovery rate by file type?
5. Failure cost of miscategorization: what happens when a high-risk change is classified low-risk (missed defects, with numbers where available) versus when a low-risk change is classified high-risk (wasted review cost)? Evidence on the asymmetry, and how production systems hedge (sampling, periodic re-audit of the inert class).
6. Concrete recommendation: for our gate (numstat, paths, changed file types and check output available at classification time), propose (a) the feature set, (b) the classes and their assignment rules, (c) the review treatment per class, and (d) the hedge for miscategorization — each with its evidence and a confidence rating, and every number that rests on extrapolation beyond the cited setup flagged as such.

Output: for each question the evidence with exact numbers and sources; a comparison table of the systems and studies (features, classes, measured effect); the recommendation; and the list of least-certain claims.
```

## 11. Which model reviews: local multi-turn versus frontier single-turn

```
Research which model — and how many turns — should perform the merge review in an autonomous pipeline, specifically to evaluate the claim that multi-turn (iterative) review with a local model beats single-turn review with a frontier model.

Setting: a local coding agent (Qwen 3.8, 27B, open-weight, one consumer GPU with a single inference slot, 262K context) lands work through a merge gate. Each merge request is currently reviewed by one frontier model (Claude Opus 5.5) in a single fresh session — cold cache, the reviewer system prompt and framing re-prefilled at full price — with a typed approve/reject verdict. A report we have seen claims that multi-turn review with a local Qwen 3.8-class model produces better results than single-turn review with an Opus-class model. We need that claim located and evaluated, and a model/turn policy for the gate.

Questions:
1. The claim itself: locate published or practitioner evidence comparing multi-turn (iterative, multi-pass, self-refining, panel or debate) review by a local/mid-size open model (Qwen 3.8 class, 27B–32B) against single-turn review by a frontier model (Claude Opus class). What exactly was measured (F1, recall, cost, task), on what benchmark, and under what prompt and turn budget? Separate the cases where the local model spent more total tokens or turns from the cases where it did not.
2. Single vs multi-pass review, same model: evidence on whether a second review pass (self-refinement, a fresh-session re-review, self-consistency over k reviews, a two-model panel) raises defect detection over a single pass — the measured increment per pass, its cost, and the pass number at which the curve flattens? Include context-rot and self-anchoring effects on multi-turn reviewers.
3. Local models as code reviewers: what do studies report for Qwen 3.x-class (27B–32B, Coder variants) defect-detection quality (F1, precision, recall) on code review, against Claude and GPT tiers — exact numbers, benchmarks, and how far results for 32B or Coder variants transfer to a 27B instruct model doing agentic review with the diff, check output and goal in context?
4. Turn economics on one inference slot: the local reviewer shares its GPU with the main executor. Evidence on prefill/decode cost of multi-turn review sessions for 27B-class models (KV-cache reuse across turns, prefix caching), and on the throughput interaction when review and execution contend for one slot.
5. Cost model: given that a frontier single-turn review of a ~150-line diff costs on the order of $0.09–0.12 all-in (cold prefill, framing, CI runs) and a local 27B reviewer has near-zero marginal cost but higher latency: at what review quality (F1) does a local multi-turn stack beat the frontier single pass on cost per accepted-and-correct merge, for low-risk versus high-risk classes? Compute it from cited numbers, not assumptions.
6. Concrete recommendation: propose (a) which model per risk class, (b) how many review turns per class and the early-stopping rule, (c) whether the frontier pass should come first (triage) or second (confirmation) after a local one, and (d) an A/B design to test the local multi-turn claim on our own pipeline — each with its evidence and a confidence rating; flag every extrapolation.

Output: for each question the evidence with exact numbers and sources; a verdict on the multi-turn-local vs single-turn-frontier claim (supported, refuted, or setup-dependent, naming the exact setups); the recommendation; and the list of least-certain claims.
```

## 12. Review structure: batched, specialized, interleaved, adversarial

```
Research four structural variants of LLM code review for an autonomous merge
pipeline, against the default of one frontier-model single pass per diff:
(a) batching several independent diffs into one review call, (b) several
role-specialized single passes (conformance, defects, security) instead of
one generalist pass, (c) interleaved per-task (checkpoint) review versus
end-of-branch review, and (d) an adversarial reviewer whose product is
failing tests instead of a judgement.

Setting: a local coding agent (Qwen 3.8, 27B, one consumer GPU, one
inference slot) lands work as small git-worktree branches, each with a check
command that must pass. A deterministic gate classifies each branch (inert:
no LLM review, checks only; standard; elevated) and reviews standard
branches with one frontier model (Claude Opus 5.5) in a single fresh
session: the reviewer sees the unified diff, the check output, and the goal
plus acceptance criteria, and returns a typed approve/reject verdict with
findings. Branches are capped near 150 changed lines (added + deleted) and
6 files. The measured cost structure of such a review is
fixed-cost-dominated: for a 150-line diff the per-review fixed component
(system prompt, framing, repo context, check output) is 73–96% of total
review cost, so the variants are judged on cost per accepted-and-correct
merge, not on cost per review call. Companion research has already compared
local multi-turn against frontier single-pass review; this prompt is about
the structure of the review itself, not about which model runs it.

Questions:
1. Batched review: evidence on reviewing several independent diffs in one
   LLM call (or one session in sequence): the per-diff defect recall and
   precision as the number of diffs in context grows (attention dilution,
   lost-in-the-middle with multiple items), against the fixed-cost
   amortization. Which studies or production systems reviewed more than one
   diff per call, with what count and per-diff size, and what did they
   measure per diff versus reviewing them separately? Compute from cited
   numbers: with fixed cost F per call and per-line cost v, for which count
   and diff size does batching win on cost per accepted-and-correct merge,
   and does the measured per-diff recall loss eat the gain?
2. Role-specialized single-pass panels: evidence on running separate
   single-pass reviews with different objectives — plan/goal conformance,
   defect detection, security — versus one generalist review of the same
   diff. For each objective: does a dedicated prompt measurably beat the
   generalist prompt at the same model tier (F1, recall, precision, exact
   numbers)? When does the union of panel findings beat the best single
   reviewer, and what is the duplicate-finding rate (the cost multiplier)?
   Any data on whether a conformance-only review can be downgraded to a
   cheaper model tier.
3. Interleaved versus end-of-branch review: for long-horizon work split
   into tasks (each task a checkpoint inside one milestone, or its own
   branch), evidence on reviewing at each checkpoint versus reviewing only
   the final diff: drift and accumulated-defect detection, cost per
   accepted-and-correct milestone, and the fix-cost asymmetry (a defect
   caught at a checkpoint versus at the end, with numbers where reported).
   Include plan-review-then-diff-review pipelines that report which stage
   catches which defect classes.
4. Adversarial / test-generation reviewers: evidence on reviewers whose
   output is executable failing tests (or mutation-killing attempts) rather
   than a judgement: measured yield (share of generated tests that fail on
   the diff and expose a real defect) versus judgement-style review at the
   same model tier, whether it works on diffs rather than whole
   repositories, and the cost per true defect found.
5. Concrete recommendation: for our gate (a standard branch of ~150 lines /
   6 files, one Opus 5.5 single pass in a fresh session today,
   fixed-cost-dominated), recommend per variant — adopt, adopt with
   changes, or do not adopt — with the expected change in cost per
   accepted-and-correct merge and in recall, computed from cited numbers;
   flag every number that rests on extrapolation beyond the cited setup.

Output: for each question the evidence with exact numbers and sources; a
comparison table of the four variants (setup, what was measured, cost and
recall effect per variant); the recommendation; and the list of
least-certain claims.
```

## Evidence rules (for prompts 4–12)

```
Evidence rules:
- Cite a primary source (paper, official repo, model card, vendor engineering post) for every quantitative claim, with title, authors or organisation, date and URL. Give the exact number as the source states it and where in the source it appears.
- Do not invent or extrapolate numbers, model names, benchmark versions or papers. If you cannot find evidence for a question, write "no evidence found" and say what is missing.
- Mark each claim as one of: peer-reviewed, preprint, vendor or practitioner blog, or your own inference. Keep inference visibly separate from reported results.
- Where sources disagree, report both and say which setup each used.
- End with a short list of the claims you consider least certain.
```
