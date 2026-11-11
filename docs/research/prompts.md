# The research prompts

The eight Gemini Deep Research prompts behind the reports, as sent. Prompts 1–3 went out first; 4–6 after
the decision to review plans and merges with Opus. The evidence rules at the end were meant for 4–6; the
user's own prompt carried similar rules. Prompt 7 was added with `docs/local-mode/design.md` (its OQ10);
prompts 7 and 8 went out with the evidence rules appended, and both reports are in. Prompt 9 was added
after the first `size` refusals hit real work; send it with the evidence rules appended.

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
| 9 | not yet run |

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

## Evidence rules (for prompts 4–9)

```
Evidence rules:
- Cite a primary source (paper, official repo, model card, vendor engineering post) for every quantitative claim, with title, authors or organisation, date and URL. Give the exact number as the source states it and where in the source it appears.
- Do not invent or extrapolate numbers, model names, benchmark versions or papers. If you cannot find evidence for a question, write "no evidence found" and say what is missing.
- Mark each claim as one of: peer-reviewed, preprint, vendor or practitioner blog, or your own inference. Keep inference visibly separate from reported results.
- Where sources disagree, report both and say which setup each used.
- End with a short list of the claims you consider least certain.
```
