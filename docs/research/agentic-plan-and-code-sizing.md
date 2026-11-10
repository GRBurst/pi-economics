# Sizing and Structuring Incremental Software Engineering Architectures for Dual-Model Execution and Review Pipelines
Developing software through autonomous language model pipelines introduces structural friction between generation capacity and verification reliability. When a mid-size open-weight model—specifically within the 30-billion parameter class, such as Qwen 2.5-Coder-32B or Qwen 3.x-Coder variants—serves as the primary execution engine, architectural constraints differ fundamentally from pipelines powered entirely by monolithic frontier models[^1]. Mid-size models exhibit bounded multi-step reasoning horizons, high susceptibility to context rot, and diminished spatial reasoning across sprawling codebases[^3]. Concurrently, deploying an advanced frontier model, such as Claude Opus, as an automated merge reviewer introduces asymmetric verification dynamics: frontier models excel at high-level semantic alignment, cross-module structural critique, and subtle defect detection, yet their defect recall degrades precipitously as patch volume expands[^6].  
To optimize throughput, maintain correctness, and avoid compounding regressions, the development workflow must be engineered around small, verifiable batch sizes. This requires treating plans as persistent external state, isolating execution environments within dedicated version control structures such as Git worktrees, and formatting the review interface to evaluate incremental diffs against bounded specifications rather than open-ended conversational context[^8].

## Diff Size Dynamics and Defect Detection Thresholds
Code review functions as a quality filter whose defect detection efficacy depends directly on cognitive and contextual load. Empirical software engineering literature demonstrates that review performance is not linear; both human engineers and synthetic language model reviewers suffer acute performance collapse once change sets surpass critical volume thresholds[^3].

### Human Code Review Empirical Foundations
Foundational industrial research established the quantitative boundaries of human code inspection. In the benchmark Cisco Systems code review study conducted by SmartBear—spanning 2,500 reviews, 50 developers, and 3.2 million lines of code—defect detection density degraded rapidly when review increments exceeded 200 to 400 lines of code (LOC)[^3]. Defect density exhibited an equally sharp drop when inspection rates exceeded 300 to 500 lines per hour; specifically, 87% of reviews executed faster than 450 LOC per hour scored below average in defect density detected[^3]. Beyond 400 lines of code, reviewers experienced cognitive fatigue and semantic overload, transitioning from analytical verification to superficial scanning[^12].  
Subsequent empirical studies across Microsoft, Google, and open-source ecosystems reinforced these thresholds while uncovering deeper operational mismatches. In their extensive study on the expectations and outcomes of modern code review, Bacchelli and Bird discovered that while identifying defects is widely perceived as the primary objective of code review, fewer than 15% of human code review comments actually address functional defects[^13]. The vast majority of review activity centers on readability, stylistic consistency, alternative implementations, and knowledge transfer[^14]. Crucially, the authors found that code and change comprehension represents the single greatest hurdle for reviewers[^14]. When changes cross multiple semantic boundaries or exceed several hundred lines, understanding the underlying intent and indirect ripple effects of the modification outstrips the reviewer's cognitive capacity, leading directly to unverified logic paths and high defect omission rates[^12].

### Empirical Collapse of LLM Defect Detection
Large language models operating as automated code reviewers exhibit an even steeper decay curve than biological reviewers. Empirical evaluations demonstrate that while frontier LLMs achieve acceptable precision on atomic, single-intent changes, their recall collapses under realistic pull request scales[^6].  
In an empirical benchmark analyzing LLM code review performance across synthetic mutations and real pull requests, patch size proved to be the single dominant predictor of defect detection efficacy[^6]. Across multiple language models, the F1 score for defect detection dropped from an average of 0.657 on diffs under 10 LOC to 0.043 on diffs exceeding 150 LOC[^6]. This performance degradation stems from two interdependent mechanisms. First, transformer self-attention mechanisms distribute probability mass across non-critical modifications—such as boilerplate updates, formatting, imports, and interface plumbing—which obscures the critical-path logic change where regressions typically reside[^6]. Second, while models score deceptively well on synthetic unit-level benchmarks where isolated bugs are injected into small code blocks, their F1 score declines by up to 92% when evaluated against real pull requests containing multi-file churn, auxiliary modifications, and interleaved refactoring[^6].

| Diff Size Bucket (LOC) | Human Defect Density Index | LLM Reviewer F1 Score | Primary Failure Mode | Recommended System Policy |
| :---- | :---- | :---- | :---- | :---- |
| **1 – 49 LOC** | Optimal ($> 1.0\times$ baseline) | 0.657 – 0.520 | Semantic under-specification | Auto-admit to model review; high merge confidence |
| **50 – 149 LOC** | High ($0.8\times-1.0\times$) | 0.380 – 0.180 | Inter-procedural edge-case omission | Target increment envelope for autonomous tasks |
| **150 – 399 LOC** | Moderate to Low ($0.4\times-0.7\times$) | 0.043 – 0.110 | Attention dispersion, false positives | Hard ceiling; split into sub-tasks prior to generation |
| $\geq$ **400 LOC** | Severe Collapse ($<0.3\times$) | $<0.030$ | Total review bankruptcy, rubber-stamping | Reject automatically at CI boundary; require decomposition |

### Blast Radius and Defect Criticality
The empirical reality that LLM defect detection drops by an order of magnitude between 10 and 150 lines indicates that relying on Claude Opus to catch defects in diffs exceeding 200 lines produces an unearned sense of security[^6]. Large diffs do not merely lead to missed bugs; they also increase false positive rates and surface nitpicks as the reviewer model latches onto superficial style points rather than verifying architectural correctness[^7].  
However, line counts alone are insufficient for scoring review difficulty; the blast radius of the change governs risk[^12]. A 50-line diff modifying public API contracts, database migration scripts, or core authentication middleware carries a substantially higher blast radius than a 300-line mechanical refactoring across presentation components[^12]. Consequently, pipelines must combine static blast-radius scoring—evaluating path sensitivity, export modifications, and call-graph reach—with deterministic line caps to enforce small, reviewable increments[^12].

## Task Granularity and Execution Reliability for 30B-Class Models
Directing a mid-size local model (~30B parameters) to execute software modifications requires calibrating task granularity against its operational capability envelope. While frontier models can navigate large repository trees and coordinate changes across a dozen files, 30B open-weight models degrade rapidly when tasks demand multi-file localization and sustained tool-use trajectories[^5].

### Benchmark Distributions and Ground Truth Complexity
The structural distributions of established software engineering benchmarks reveal the boundaries of automated patch generation. In SWE-bench Verified, the vast majority of tasks involve localized bug fixes[^21]. Gold patches average 1.52 files modified and 41.0 lines of code[^22]. In SWE-bench Multilingual, the median gold patch modifies only 10 lines of code, with the 95th percentile reaching 110 lines[^23]. Even within this relatively narrow domain, vanilla execution of open-weight models like Qwen 2.5-Coder-32B in generic harnesses yields low resolve rates (between 6.2% and 31.0%) unless paired with specialized scaffolding, search optimization, or reinforcement learning policies[^1].  
When benchmark tasks expand beyond single-file fixes, mid-size model completion rates decline precipitously. In SWE-Bench Mobile, which evaluates multi-file feature development in large-scale mobile repositories, task success exhibits an inverse exponential relationship with file churn and patch size[^5]. Success rates fall from 18% on tasks requiring 1 to 2 file modifications down to 2% when 7 or more files are modified[^5]. Similarly, patches under 50 lines achieve a 20% success rate, whereas patches exceeding 200 lines collapse to 3%[^5].  
Under SWE-Bench ProMax, where tasks average 11.4 files modified and 261.6 lines changed, state-of-the-art frontier models achieve resolve rates of only 41.2%, while mid-size models fail almost entirely due to localization degradation and premature abandonment[^19]. Mid-size models consistently modify fewer files than required by ground-truth patches, underscoring an inability to propagate architectural changes across multiple repository modules[^24].

### Long-Horizon Capabilities and METR Time Horizons
The Model Evaluation and Threat Research (METR) task-length framework formalizes this capability cliff. METR measures autonomous agency using the *time horizon* metric—the length of a task, rated in human expert completion time, at which an agent achieves a specified success probability[^26]. The agent's probability of success $p_{\text{success}}$ across a task of human duration $t$ is modeled as a logistic function parameterized by the agent's characteristic horizon $h_{\text{agent}}$ and a scaling parameter $\beta$:  
$p_{\text{success}}(\text{agent}, t) = \sigma(\beta(\log h_{\text{agent}} - \log t))$  
Empirical measurements on software engineering tasks indicate that the 50% time horizon for frontier models expanded from minutes in 2021 to roughly 1 to 4 hours by 2025–202629. However, two underlying findings govern pipeline sizing.  
First, when the required operational success threshold is raised from a coin-flip (50%) to an engineering-grade reliability standard (80%), the achievable task horizon contracts by a factor of $4\times$ to $6\times$[^28]. A model capable of completing a 1-hour human task at a 50% success rate can only complete a 10- to 15-minute human task at an 80% success rate[^28]. Second, for mid-size models (~30B), the 80% success horizon corresponds to software tasks that take an expert human between 5 and 20 minutes to complete[^28]. In practical terms, this restricts the task to isolated function generation, test authoring, small localized bug fixes, or well-defined single-component refactors[^21].

### Turn Budgets and Context Saturation
In agentic loops, task success is closely linked to trajectory length. Trajectory analyses demonstrate that failed runs consume substantially more rounds than successful attempts; agents enter repetitive diagnostic loops, re-reading the same files, retrying failed shell commands, and generating syntax invalidation errors[^24].  
For a 30B model operating in a standard codebase, reliable execution occurs strictly between 3 and 8 turns, encompassing file inspection, edit invocation, and test execution. Beyond 12 to 15 turns, failure probabilities compound, and the agent frequently succumbs to premature task abandonment or loop repetition[^26]. Although modern 30B architectures boast theoretical context windows of 32k to 128k tokens, operational reasoning performance degrades long before reaching this architectural ceiling[^2]. When intermediate tool outputs push the active context past 24,000 to 32,000 tokens, instruction-following adherence drops, leading to unprompted edits, regression loops, and stale variable references[^4].

| Parameter Metric | Safe Envelope (Target) | High-Risk Ceiling (Enforce Split) | Observed Failure Modes Past Ceiling |
| :---- | :---- | :---- | :---- |
| **Files Modified** | 1 – 2 files | 3 files | Incomplete cross-file updates; orphaned references[^5] |
| **Net Lines Changed** | 20 – 60 LOC | 100 LOC | Incoherent patch hunks; logic truncation; hallucinated APIs[^5] |
| **Execution Turns** | 4 – 8 tool calls | 12 tool calls | Repetitive failed tool execution; infinite edit-lint loops[^24] |
| **Active Context Size** | 8k – 16k tokens | 32k tokens | Context rot; forgetting system instructions; loss of plan[^4] |
| **Task Human Duration** | 10 – 20 minutes | 30 minutes | Exponential drop in pass rates; wandering focus[^28] |

## Externalized Memory Architecture: Mitigating Conversational Context Rot
Small and mid-size models lack the internal representational stability required to maintain long-horizon state inside an evolving conversation history[^8]. Multi-turn conversation evaluations show that language models suffer an average performance degradation of 39% compared to single-turn executions, frequently taking unrecoverable wrong turns[^3]. Furthermore, evaluations of agents extending their own prior code demonstrate code quality erosion in 80% of trajectories, accompanied by a $2.2\times$ increase in verbosity[^3].

### Pathologies of Context-Resident State
Context rot in autonomous software development is driven by three specific structural properties of agent execution environments:  
The "lost-in-the-middle" phenomenon causes models to attend preferentially to information positioned at the extreme beginning and extreme end of their context window[^4]. Important implementation decisions, constraints, and intermediate architectural agreements formulated in the middle turns are effectively ignored as conversation length grows[^4].  
Noise accumulation from intermediate tooling exacerbates this degradation. Terminal outputs, repetitive diff fragments, test discovery outputs, and verbose stack traces introduce lexical distractor patterns into the working memory[^4]. For a 30B parameter model, this semantic noise degrades token representations, resulting in rule erosion where the model begins violating pre-specified formatting constraints or modifying unauthorized files[^4].  
Hallucinated task completion emerges as the active context expands. Trajectory analyses demonstrate a marked rise in premature task abandonment, where the agent prematurely concludes that an issue is resolved despite failing tests or missing requirements, simply because its self-monitoring capability decays under heavy contextual load[^26].

### Filesystem State Decoupling
To protect a 30B model from conversational entropy, execution state must be shifted out of conversational context into the file system[^8]. Externalizing plan state into structured markdown files (such as PLAN.md or dedicated scratchpad documents) decouples task execution from trajectory length[^8].  
This architectural pattern is validated by the *Agentless* framework[^40]. By deliberately eliminating autonomous, unbounded tool selection and dynamic conversational planning, and instead implementing a rigid, hierarchical pipeline—localized file identification, function-level isolation, patch synthesis, and deterministic test validation—Agentless outperformed complex autonomous agents on SWE-bench Lite, achieving a 32.0% resolve rate at just \$0.34 to \$0.70 per fix[^40]. Decoupling execution stages into bounded, single-purpose steps prevents the model from derailing its own execution environment[^40].

| State Dimension | In-Context Scratchpad / Dialogue History | External File-System State (PLAN.md / Worktree) |
| :---- | :---- | :---- |
| **Persistence Horizon** | Volatile; resets across sessions or upon context compaction[^8] | Durable; survives process restarts, crashes, and context wipes[^8] |
| **Attention Overhead** | High; consumes active window and introduces self-attention noise[^4] | Zero overhead during sub-steps; read explicitly only when queried[^8] |
| **Auditability & Sync** | Opaque; embedded in multi-turn JSON traces and hidden reasoning[^8] | Explicit; versioned via Git commits; directly diffable by reviewers[^43] |
| **Verification Gate** | Subject to agent rationalization and hallucinated self-checks[^4] | Verifiable by deterministic linter, test runner, and frontier review[^12] |

### Git Worktrees as Execution Boundaries
Using Git worktrees to isolate each task or milestone operationalizes external state tracking[^9]. A Git worktree provides an independent filesystem directory backed by a shared repository object store[^9]. This yields distinct architectural advantages for a dual-model execution pipeline.  
First, worktrees isolate uncommitted churn. Local execution models frequently create temporary debugging artifacts, broken intermediate files, and unintended edits[^4]. A dedicated worktree guarantees that uncommitted churn cannot contaminate neighboring tasks or concurrent agent runs[^9].  
Second, worktrees allow stateless agent initialization. When the 30B model executes a specific task, it does not inherit the conversational history of previous tasks[^4]. It is spawned afresh in the worktree directory, reads the local PLAN.md section corresponding to its assignment, executes within a clean 8k-token window, runs local verification tests, and commits[^38].  
Third, worktrees guarantee a clean merge surface. The pull request diff generated from a worktree branch is isolated to the specific task commit history, presenting the Claude Opus reviewer with an uncluttered, reviewable artifact[^10].

## Dynamic Replanning Protocols, Delta Reviews, and Drift Mitigation
During software execution, plans are frequently invalidated by real-world discoveries: unknown dependencies are uncovered, existing tests break, or localized design assumptions fail[^3]. Managing these plan updates requires structured protocols to prevent plan drift while avoiding excessive review overhead[^3].

### Deterministic Replanning Triggers
Replanning must not be left to the unconstrained discretion of a 30B model. Mid-size models left to manage their own planning frequently fall into plan divergence—either modifying tasks to fit their erroneous implementations or entering recursive redesign loops[^3]. Instead, replanning must be triggered exclusively by deterministic signals:  
A blast-radius breach occurs when the 30B model determines that completing an assigned task requires editing a file outside the explicit whitelist allocated to that milestone or worktree[^12].  
A test failure inversion arises when a pre-existing regression test fails, and remediation requires altering interfaces established in earlier milestones[^20].  
Interface specification incompatibility occurs when static type checkers or compilers flag that an external type signature or schema contract must be altered to support the assigned task[^12].  
Budget exhaustion happens when the execution agent exceeds 10 interaction turns or generates more than 100 net lines of churn without achieving a passing local test suite[^6].

### Delta vs. Full-Plan Re-Review
When a replan is triggered, the revised plan must be reviewed by Claude Opus before the 30B executor is permitted to continue[^10]. Deciding between a full-plan re-review and an incremental delta review involves structural trade-offs in context management and cost.  
A full-plan re-review evaluates the entire hierarchical document, including all milestones, tasks, architectural invariants, and completed items[^7]. This approach entails high token consumption and risks cascading adjustments across already merged or pending downstream tasks[^3]. It should be reserved strictly for major architectural shifts: public API signature modifications, database schema migrations, third-party library upgrades, or root architectural invariant changes[^12].  
In contrast, a delta review isolates the scope of evaluation. Claude Opus is provided with the target milestone goal, the current state of merged tasks, the proposed diff to PLAN.md (specifically the insertion, deletion, or modification of immediate sub-tasks), and the technical rationale generated by the executor (such as compiler error traces or unexpected dependency requirements)[^38]. Delta reviews require minimal token overhead, incur low latency, and present zero risk of destabilizing unaffected milestones[^7]. They represent the optimal choice for internal component refactoring, splitting an over-sized task into smaller sub-tasks, or introducing an intermediate utility function within the same module[^12].

| Trigger Event | Scope Classification | Review Tier Assigned | Enforced Pipeline Action |
| :---- | :---- | :---- | :---- |
| **Task Size Overrun (\>100 LOC)** | Local Sub-task | Claude Opus Delta Review | Split task into sequential sub-tasks; re-enter queue[^6] |
| **Whitelisted File Breach** | Component Boundary | Claude Opus Delta Review | Expand whitelist if justified; reject if scope creep[^12] |
| **Public Interface / API Change** | Milestone Contract | Claude Opus Full-Plan Review | Freeze branch; re-evaluate downstream task contracts[^12] |
| **Database Schema Migration** | System Architectural | Claude Opus Full-Plan Review | Re-validate migration path, rollbacks, and data integrity[^12] |
| **Turn Budget Exhaustion (10+ Turns)** | Execution Failure | Automatic Rollback | Revert worktree to base; issue targeted replan prompt[^4] |

### Mitigating Plan Drift and Hallucinated Progress
Plan drift occurs when an executor progressively diverges from the user's intent across multiple iterations, arriving at a state that satisfies local automated checks but fails the broader engineering objective[^3]. Two architectural mechanisms prevent this drift.  
Immutable goal anchoring ensures that within PLAN.md, the root architecture, acceptance criteria, and milestone boundaries are marked read-only. The 30B model has write permissions only to the checkboxes and scratchpad notes of its active task[^8]. Any mutation to milestone acceptance criteria requires an explicit schema migration initiated via a delta-review request to Claude Opus[^38].  
Deterministic checkpoint auditing prevents tasks from being marked completed in PLAN.md based purely on the executor's self-declaration[^3]. Completion requires verifiable, deterministic proof: zero compiler warnings, pass-to-pass regression suite stability, and successful execution of an explicitly added unit test targeted at the changed behavior[^20].

## Goal-Conditioned Increment Review and Frontier Model Calibration
A frequent failure mode in automated code delivery is the *diff-only review*, where a reviewing model is supplied solely with the unified Git diff and asked to identify defects[^44]. In an isolated diff, reviewer models validate whether the code appears syntactically and idiomatically plausible, but cannot reliably determine whether the code fulfills the actual engineering objective[^44].

### The Omission Problem in Diff-Only Reviews
Human review research and empirical software analysis consistently identify errors of omission—missing edge case handling, absent input validation, forgotten error paths, and ignored requirements—as the hardest defects to detect[^14]. In diff-only reviews, omissions are practically invisible because the diff only displays lines that were added or modified[^44]. If an executor completely omits transaction rollback logic, bounds checking, or telemetry emission, a diff-only review perceives a clean, cohesive change set and approves the pull request[^44].  
Supplying Claude Opus with a triad bundle—(1) the specific PLAN.md task specification and acceptance criteria, (2) the execution check/test output, and (3) the unified diff—eliminates this information asymmetry[^7]. The reviewer's primary objective shifts from generic linting to specification-conformance auditing[^7].

### Verification Pillars
When reviewing an increment executed by a 30B model, Claude Opus must evaluate the pull request across four distinct verification dimensions:  
Plan conformance and functional completeness evaluate whether the increment delivered all acceptance criteria outlined in the plan section, ensuring that all edge cases and error contracts specified in the task are explicitly handled in the code[^7].  
Scope creep containment verifies that the executor did not over-generate code. Mid-size models frequently add unnecessary helper utilities, modify unrelated project files, or prematurely scaffold future milestone requirements[^3]. Claude Opus must reject any file modification or symbol export not strictly required to satisfy the assigned task[^12].  
Architectural and blast radius integrity checks whether the patch leaks implementation details or alters public method signatures outside the agreed plan scope, ensuring internal invariants and module boundaries remain intact[^12].  
Test validity and truthfulness assesses whether the executor wrote genuine verification tests, or introduced tautological assertions and excessive mocking that mask incomplete implementations[^20].

### Claude Opus Behavioral Calibration
Frontier models such as Claude Opus possess strong reasoning and cross-file defect detection capabilities, but display specific behavioral tendencies in automated review workflows[^7]. First, Claude Opus exhibits aggressive severity calibration, frequently inflating minor stylistic deviations or non-idiomatic (but correct) patterns into critical blockers[^7]. Second, it demonstrates high comment density and an instinct toward over-correction, tending to rewrite functioning code, propose extensive secondary refactors, or flag intentional project idioms as bugs[^7]. Third, it can exhibit false syntactic skepticism, critiquing code for lacking mechanisms that are already handled elsewhere in untouched repository modules[^7].  
To calibrate Claude Opus effectively, the review prompt must employ a rigid, structured rubric with clear gating criteria, forcing the model into an actionable, pass/fail evaluation mode[^7]. The prompt must explicitly instruct Claude Opus to suppress non-blocking stylistic suggestions and restrict rejections strictly to demonstrable correctness defects, scope violations, or plan omissions[^7]. Inline feedback must include concrete file paths, line references, and short remediation diffs[^7].

| Evaluation Dimension | Gating Rule (Claude Opus Review Rubric) | Permitted Outcome Action |
| :---- | :---- | :---- |
| **Pillar 1: Specification Parity** | Must verify every requirement in the plan section against diff hunks. If a requirement is missing, output exact missing item. | **BLOCK MERGE** (Require task completion) |
| **Pillar 2: Scope Containment** | Check all modified files against authorized task paths. Any modification to non-whitelisted files triggers rejection. | **BLOCK MERGE** (Revert out-of-scope edits) |
| **Pillar 3: Regressions & Safety** | Identify logic flaws, race conditions, memory/resource leaks, or security issues introduced directly by the diff. | **BLOCK MERGE** (Provide reproducible failure case) |
| **Pillar 4: Style & Code Polish** | Naming conventions, minor formatting, documentation phrasing, or localized non-breaking cleanups. | **ADVISORY ONLY** (Do not block merge; auto-silence) |

## End-to-End Orchestration Architecture and Operational Recommendations
Combining these empirical constraints yields a resilient blueprint for an autonomous dual-model development pipeline. The architecture optimizes throughput by matching the strengths of each model family: the 30B model generates low-cost code increments within narrow, isolated contexts, while Claude Opus enforces architectural integrity across small, highly structured review batches[^7].

### Plan Structure and Granularity Decomposition
The global PLAN.md document serves as the shared single source of truth across the entire development lifecycle[^8]. The plan must be structured hierarchically into milestones and tasks:  
A milestone represents an independently functional subsystem or capability, sized to require no more than 3 to 5 tasks[^3]. Total milestone churn must not exceed 150 to 250 LOC across 2 to 4 files[^5].  
A task represents an atomic work unit executed within a single Git worktree[^9]. Each task is strictly bounded to a maximum of 1 to 2 files touched and 30 to 60 net lines of code[^5]. The task must be solvable within a 5 to 10 turn agent loop and consume less than 16k tokens of working context[^4].  
Every task entry in PLAN.md must contain an unambiguous definition of done: the exact paths to modify, the expected interface changes, and the specific test command that must exit with returncode zero[^20].

### Worktree Lifecycle and Execution Protocol
The orchestration harness manages execution across three decoupled operational phases:  
In the preparation phase, the orchestration harness parses PLAN.md, identifies the next unblocked task, and provisions an isolated sibling worktree via git worktree add -b task-branch ../worktrees/task-branch main[^9]. Project dependencies and language environments are initialized from pre-warmed local caches to avoid build collisions[^43].  
In the execution phase, the 30B local model is spawned with a clean context containing only the system tool instructions, the isolated task specification from PLAN.md, and the contents of the target files[^4]. The model executes its edit-test loop. Intermediate terminal outputs are stripped of non-critical warnings to keep active context below 24k tokens[^4]. The executor cannot request a merge review until all local unit and regression checks pass cleanly within the worktree environment[^20].  
In the verification phase, once local checks pass, the orchestration engine packages the triad bundle—the task specification, the clean unified diff from git diff main...HEAD, and the test output—and submits it to Claude Opus[^7].

### Merge Review and Remediation Handshake
Claude Opus processes the triad bundle against the four-pillar review rubric[^7]. If Claude Opus approves the patch, the branch is squashed or fast-forward merged into the integration branch, the worktree is deleted via git worktree remove, and the task checkbox in PLAN.md is updated to completed[^10].  
If defects, omissions, or scope breaches are detected, Claude Opus outputs structured line-level comments and a rejection flag[^7]. The local 30B model is re-spawned in the existing worktree with these comments provided as targeted feedback for a single remediation pass[^3]. To prevent infinite repair loops, remediation is strictly capped at 3 turns[^24].  
If the 30B model fails to resolve the review objections within this budget, or if execution triggers a replanning event (such as discovering an unauthorized file dependency), the worktree state is preserved, and a delta replanning request is escalated to Claude Opus[^26]. Claude Opus inspects the execution log, restructures the failing task into smaller, feasible sub-tasks in PLAN.md, and resets the branch to the last known good commit[^38].  
By enforcing strict, empirical batch-size caps at the task level, externalizing plan state into the filesystem, and providing the frontier reviewer with explicit goal specifications, this architecture circumvents the context rot and reasoning limits of 30B open-weight models while exploiting the defect-detection and semantic verification capabilities of Claude Opus[^6].

## Works cited

[^1]: Evaluating Qwen2.5-Coder-32B for Enterprise Coding, <https://threatfrontier.com/articles/open-weight-coding-at-the-frontier-evaluating-qwen2-5-coder-32b-for-enterprise-software-engineering>
[^2]: SWE-Master: Unleashing the Potential of Software Engineering, <https://arxiv.org/html/2602.03411v1>
[^3]: the shape of a thin agent shell over fabrika skills \#5561 - GitHub, <https://github.com/kamp-us/phoenix/issues/5561?timeline_page=1>
[^4]: Context rot is slowing down your AI agent: How to fix it, <https://blog.logrocket.com/context-rot-slowing-down-your-ai-agent-how-fix/>
[^5]: SWE-Bench Mobile: Can Large Language Model Agents Develop, <https://arxiv.org/html/2602.09540>
[^6]: A Comparative Evaluation of LLMs for Automated Code Review - arXiv, <https://arxiv.org/html/2606.15689v1>
[^7]: What Claude Opus 4.7 means for AI code review - CodeRabbit, <https://www.coderabbit.ai/blog/claude-opus-4-7-for-ai-code-review>
[^8]: Agent Scratchpad & Working Memory Explained - AI/TLDR, <https://ai-tldr.dev/learn/ai-agents/planning-and-memory/agent-scratchpad-working-memory/>
[^9]: Git Worktrees for AI Coding: Run Multiple Agents in Parallel, <https://dev.to/mashrulhaque/git-worktrees-for-ai-coding-run-multiple-agents-in-parallel-3pgb>
[^10]: Claude Code Agents Overwriting Each Other? Use Git Worktrees, <https://aidenapp.org/parallel-agents-git-worktree>
[^11]: Reviewing AI-Generated Code: What Actually Breaks - Francis Okafor, <https://www.francisokafor.com/field-notes/reviewing-ai-generated-code-review-bottleneck>
[^12]: Code Review Can't Scale With Agents. Score Blast Radius, <https://www.cyberdevtech.com/articles/blast-radius-code-review-ci-gate>
[^13]: AI Code Review Statistics (2026): Sourced Data | aicodereview.io, <https://www.aicodereviews.io/blog/ai-code-review-statistics>
[^14]: Expectations, Outcomes, and Challenges of Modern Code Review, <https://sback.it/publications/icse2013.pdf>
[^15]: Expectations, outcomes, and challenges of modern code review, <https://www.semanticscholar.org/paper/Expectations%2C-outcomes%2C-and-challenges-of-modern-Bacchelli-Bird/3ad467fe13ffa8ee705d62d8228a2c254a96f5bd>
[^16]: Code Review Strategies That Cut Pull Request Size - GitClear, <https://www.gitclear.com/research_studies/pull_request_diff_methods_comparison_faster_review>
[^17]: Towards Practical Defect-Focused Automated Code Review - arXiv, <https://arxiv.org/pdf/2505.17928>
[^18]: scorekeeper/docs/research/overreach-landscape.md at main - GitHub, <https://github.com/michalstrnadel/scorekeeper/blob/main/docs/research/overreach-landscape.md>
[^19]: SWE-Bench ProMax: Benchmarking Agents on Large-Scale ... - arXiv, <https://arxiv.org/html/2608.09802v2>
[^20]: SWE-Bench Pro Leaderboard AI Coding Benchmark - Scale Labs, <https://labs.scale.com/leaderboard/swe_bench_pro>
[^21]: What skills does SWE-bench Verified evaluate? - Epoch AI, <https://epoch.ai/publications/what-skills-does-swe-bench-verified-evaluate>
[^22]: SWE-Bench-Pro Benchmark Suite - Emergent Mind, <https://www.emergentmind.com/topics/swe-bench-pro-ecd5fbe8-1171-4842-b741-58d3df0ec409>
[^23]: SWE-bench Multilingual, <https://www.swebench.com/multilingual.html>
[^24]: SWE-Bench ProMax: Benchmarking Agents on Large-Scale ... - arXiv, <https://arxiv.org/html/2608.09802v1>
[^25]: SWE-Bench ProMax Benchmarking Agents on Large-Scale ... - Scribd, <https://www.scribd.com/document/1072592090/SWE-Bench-ProMax-Benchmarking-Agents-on-Large-Scale-Multilingual-Code-Refactoring>
[^26]: Task Horizon: How to Read METR's Time Horizon Metric and Use It, <https://behavioralstatedecay.com/blog/task-horizon>
[^27]: METR Time Horizon 2.0—The benchmark you've been waiting for, <https://forum.effectivealtruism.org/posts/ghhJh6SBYXxDktnZX/metr-time-horizon-2-0-the-benchmark-you-ve-been-waiting-for>
[^28]: Measuring AI Ability to Complete Long Software Tasks | alphaXiv, <https://www.alphaxiv.org/abs/2503.14499>
[^29]: Task horizon · METR's agent task-length doubling curve, <https://agentfieldbook.org/horizon/>
[^30]: Measuring AI Ability to Complete Long Software Tasks - METR, <https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/>
[^31]: Details about METR's evaluation of OpenAI GPT-5, <https://metr.org/evaluations/gpt-5-report/>
[^32]: Diagnosing and Mitigating Context Rot in Long-horizon Search - arXiv, <https://arxiv.org/html/2606.29718v3>
[^33]: How Does Time Horizon Vary Across Domains? - METR, <https://metr.org/blog/2025-07-14-how-does-time-horizon-vary-across-domains/>
[^34]: Memory for Autonomous LLM Agents:Mechanisms, Evaluation, and, <https://arxiv.org/html/2603.07670v1>
[^35]: What Is Context Rot? | Salesforce, <https://www.salesforce.com/artificial-intelligence/ai-context/context-rot/>
[^36]: Types of Context Rot in Harness Engineering - DEV Community, <https://dev.to/coderonfleek/types-of-context-rot-in-harness-engineering-4fpc>
[^37]: Examining the Influence of Semantic Recall on Long Context Code, <https://aclanthology.org/2026.acl-long.19.pdf>
[^38]: Demystifying Harness Effects in Software Engineering Agents - arXiv, <https://arxiv.org/html/2609.32459v1>
[^39]: NVIDIA-labs OO Agents Native Python Object-Oriented Agents - arXiv, <https://arxiv.org/html/2607.20709v1>
[^40]: arXiv:2407.01489v2 [cs.SE] 29 Oct 2024, <https://arxiv.org/pdf/2407.01489>
[^41]: Agentless :Demystifying LLM-based Software Engineering Agents, <https://arxiv.org/html/2407.01489v2>
[^42]: Agentless :Demystifying LLM-based Software Engineering Agents, <https://arxiv.org/html/2407.01489v1>
[^43]: Ralph Wiggum: Orchestrating AI Agents to Migrate a 3-Year-Old, <https://www.dan-malone.com/blog/ralph-wiggum-orchestrating-ai-agents>
[^44]: I stopped letting my critic inherit the suspect context - Moltbook, <https://moltbook.com/post/d8b3258e-cd4a-4e4b-a03a-63c199374aeb>
[^45]: Git Worktree Isolation Patterns for Parallel AI Agent Development, <https://zylos.ai/research/2026-02-22-git-worktree-parallel-ai-development/>
[^46]: How to Run Cursor Subagents in Parallel with Git Worktrees - Medium, <https://medium.com/@shahsoumil519/how-to-run-cursor-subagents-in-parallel-with-git-worktrees-b8d7d5d298fc>
[^47]: SEPM: Self-Evolving Procedural Memory Grounded in Task Graphs, <https://arxiv.org/html/2610.14515v1>
[^48]: Orchestrating AI Code Review at scale - Cloudflare Blog, <https://blog.cloudflare.com/ai-code-review/>
[^49]: LLM-as-Judge: Automated AI Quality Evaluation for Product Teams, <https://www.institutepm.com/knowledge-hub/llm-as-judge-ai-evaluation>
[^50]: The Claude Code team shares its workflow for reviewing AI-written, <https://xiaohu.ai/en/article/anthropic-code-review/>
[^51]: Task — TogetherBench, <https://togetherbench.com/tasks.html>
[^52]: Open Questions - Howardism, <https://www.howardism.dev/questions>
[^53]: Intent-Aware Training Improves LLM Safety Classification Across, <https://arxiv.org/html/2606.27210v2>
[^54]: SWE-chat:Coding Agent Interactions From Real Users in the Wild, <https://arxiv.org/html/2604.20779v1>
[^55]: rubric applied to 10 recent Eichler-lab genomics papers scores them, <https://github.com/veg/BARS/issues/10>
[^56]: Rubric Is All You Need: Improving LLM-Based Code Evaluation With, <https://www.researchgate.net/publication/394242474_Rubric_Is_All_You_Need_Improving_LLM-Based_Code_Evaluation_With_Question-Specific_Rubrics>
[^57]: Open Source vs. Frontier AI Models for Coding - Faros AI, <https://www.faros.ai/blog/open-models-vs-frontier-models>
[^58]: A Survey of Code Review Benchmarks and Evaluation Practices in, <https://arxiv.org/html/2602.13377v1>
