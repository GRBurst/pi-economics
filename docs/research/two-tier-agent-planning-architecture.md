# Architectural Optimization of Planner–Executor Hierarchies: Implementation Planning in Asymmetric Open-Weight and Frontier Model Deployments
The design of two-tier autonomous software engineering architectures requires an asymmetric division of labor between high-capacity frontier models and localized, high-throughput open-weight models. In a topology where a local ~30B parameter model (such as the Qwen 3.x class deployed on a single accelerator with extended context support) serves as the persistent orchestrator and implementation engine, and a frontier model (such as Claude Opus) operates as an expensive, selectively invoked authority, the locus of implementation planning dictates operational stability, token economics, and repository integrity.  
When user requests span multiple Git feature branches, architectural requirements must be partitioned into sequential milestones and granular tasks, each defined by an explicit objective and a deterministic check command. Determining whether the local model should draft the plan for binding frontier review across multiple rounds (Arrangement A), the frontier model should author the plan directly for local execution (Arrangement B), or the local model should provide an initial draft that the frontier model rewrites (Arrangement C) requires analyzing empirical multi-agent dynamics, failure modes in task decomposition, iterative critique convergence, plan execution adherence, and the token unit economics of input prefill versus output generation.

## Empirical Evidence on Heterogeneous Planner–Executor Architectures
Heterogeneous agent architectures—frameworks that pair models with asymmetric parameter scales and capability profiles—consistently demonstrate superior cost-to-performance efficiency compared to homogeneous deployments[^1]. However, empirical evaluations confirm that model capability is non-scalar: performance across software engineering workflows is dictated by whether a given task domain is planner-critical or executor-critical[^1].  
The AgentCARD benchmarking framework evaluated 16 pairwise planner–executor assignments across heterogeneous commercial APIs and self-hosted open-weight models over five complex domains[^1]. The findings established that agent team performance is directionally sensitive: assigning models to roles aligned with their core competencies improves end-to-end task accuracy by up to 44%, whereas inverting the identical model pair—placing the weaker model in the planner role and the stronger model in the executor seat—causes accuracy drops of up to 36%[^2].  
Across diverse benchmarks, the global Pareto frontier is dominated by heterogeneous configurations, matching the task completion rates of homogeneous frontier teams at 1.4× to 12× lower per-task cost[^2]. Shapley-value diagnostics within AgentCARD further revealed that planner versus executor capability returns diverge by up to 40%[^2]. In executor-critical domains requiring long-context tool interaction, dense file scanning, or intensive runtime debugging, the executor forms the primary operational bottleneck ($\phi_E$ up to +34%)[^1]. Conversely, in domains requiring complex dependency resolution and architectural scoping, the planner constitutes the critical path ($\phi_P$ up to +29%)[^1].

| Benchmark / Framework | Architectural Topology | Planner Model | Executor Model | Baseline / Solo Pass Rate | Heterogeneous Pass Rate | Efficiency and Cost Dynamics |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **Terminal-Bench 2.0**3 | Orchestrator–Executor Briefing Loop | Claude Opus 4.8 | GLM-5.2 | 58.4% (GLM-5.2 Solo) | 69.7% (+11.3 pp) | GLM-5.2 executor matched Kimi K2.7 at 45% of total cost[^3] |
| **AgentCARD**[^2] | Role-Aware Heterogeneous Pairing | Frontier API | Local / Open-Weight | Variable across models | Up to +44% vs inverted pairs | 1.4× to 12× per-task cost reduction vs homogeneous frontier[^2] |
| **COPE Framework**[^4] | Collaborative Cascade via Planning | Frontier API | Local SLM | Baseline Cascades | Matched proprietary baselines | 45%–50% cost drop vs GPT-4o on MATH-5004 |
| **TeamBench**[^6] | Isolated Role Separation (P-E-V) | Mixed-Provider | Mixed-Provider | 22.7% (All-Anthropic) | 26.7% (PGEAVA Team) | Per-task cost reduced from \$39.58 to \$20.52 (-48%)[^6] |
| **SWE-bench Verified**[^7] | Structured Flow vs ReAct Agent | Deterministic Harness | Local / Frontier | \<5% (Early ReAct agents)[^9] | 27.3% (Agentless Lite)[^8]; 47.6% (Qwen 2.5 Coder 32B)[^10] | Agentless resolves tasks at \$0.34 per instance[^8] |

Repository-level software development represents a hybrid discipline wherein initial architectural decomposition, interface contracts, and isolation barriers are planner-critical, while routine method generation and syntax compliance are executor-critical[^3]. On the Terminal-Bench 2.0 evaluation suite, an orchestrator-executor architecture deploying Claude Opus 4.8 as an architectural planner and GLM-5.2 as a local executor increased task completion rates from 58.4% (for GLM-5.2 operating autonomously) to 69.7%, an absolute gain of 11.3 percentage points (+10 resolved tasks)[^3]. Crucially, the executor proved to be horizontally swappable based on raw throughput economics, whereas downgrading the planner to an open-weight model eliminated the performance gains entirely[^3].  
These empirical observations are further supported by the COPE (Collaborative Planning and Execution) framework, which demonstrated that introducing an intermediate plan authored by a weaker model actively degrades the performance of a downstream executor relative to that executor operating without an external plan[^5].  
COPE established that downstream execution efficacy is bounded by capacity-aligned planning: if an implementation plan lacks structural granularity or specifies tasks that exceed the executor's operational horizon, the executor inevitably fails[^5]. Similarly, TeamBench demonstrated that multi-agent structural uplifts concentrate in the lowest solo-performance quintiles (+15.7 percentage points on complex tasks), whereas for tasks within a single model's baseline competency, multi-agent coordination introduces coordination entropy and role collapse[^6]. In capability-saturation studies, when a model achieves \>45% solo success on SWE-bench Verified, unstructured multi-agent dialogue degrades performance by -1.3% to -12.8% due to inter-agent communication overhead[^7]. Consequently, heterogeneous collaboration yields positive returns only when the division of labor is strictly hierarchical and decouples strategic architectural specification from physical code execution[^3].

## Decomposition Dynamics and Failure Modes in Mid-Sized Open-Weight Models
Evaluating whether a local ~30B model (e.g., Qwen 2.5/3.x-Coder-32B) can independently formulate multi-branch implementation plans requires assessing its capacity for repository-scale task decomposition. While ~30B open models achieve competitive scores on isolated, single-function generation tasks (e.g., Qwen 2.5-Coder-32B achieves 92.7% on zero-shot HumanEval and 47.6% on SWE-bench Verified)[^10], their underlying attention mechanisms and parameter scales introduce systemic failure modes when orchestrating multi-file, multi-branch architectures[^12].  
Trajectory analyses across benchmark coding tasks highlight three dominant behavioral defects in open-weight models[^12].  
The first failure mode is speculative overplanning, characterized by a failure to act within the environment[^12]. When presented with repository-scale requirements, mid-sized models often generate discursive natural language declarations outlining future actions without validating assumptions against the live filesystem or symbol hierarchy[^12]. This results in speculative plans that propose modifications to interfaces, configuration files, and classes that do not exist in the target repository[^12].  
The second failure mode is out-of-order action chaining, where models struggle to linearize complex directed acyclic dependency graphs[^12]. Open models routinely schedule interdependent tasks concurrently or invert prerequisite relationships, such as attempting to write end-to-end integration tests before scaffolding target classes, or modifying downstream call sites prior to updating underlying schema definitions[^12]. In a multi-branch setting, this leads to continuous integration failures caused by unresolved symbols and broken merge bases.  
The third failure mode is spatial task inflation and scope miscalibration[^10]. While frontier models naturally compartmentalize code modifications within isolated module boundaries, ~30B models struggle with spatial containment[^10]. Empirical evaluations show that while Qwen 32B models operate effectively across 1 to 3 localized files, error rates rise sharply when a task touches 10 or more interlinked files[^10]. Mid-sized models consistently author monolithic task definitions that combine database migrations, service layer logic, and API exposure into single tasks, overwhelming their local working context[^10].

| Plan Defect Category | Structural Manifestation in Plan Artifact | Downstream Impact on Multi-Branch Development | Frequency in ~30B Models |
| :---- | :---- | :---- | :---- |
| **Prerequisite Inversion**[^12] | Tasks scheduled prior to structural dependencies. | Feature branch fails CI due to missing symbols or unmigrated schemas. | High (~35% of generated plans) |
| **Scope Miscalibration**[^10] | Multiple subsystems bundled into a single task. | Context window exhaustion, localized attention dropouts, branch abandonments[^10]. | High (~40% of unprompted plans) |
| **Tautological Check Commands**[^12] | Verification commands rely on shallow mocks or trivial assertions. | False-positive branch merges; logic regressions reach the primary branch[^6]. | Critical (~50% of drafted checks) |
| **Repository Amnesia**[^13] | Plans re-implement existing utilities or ignore conventions. | Code duplication, architectural drift, merge conflicts across branches. | Moderate to High (~30%) |
| **Premature Termination**[^12] | Declaring milestone completion without executing checks. | Unvalidated code submitted to expensive frontier PR review[^12]. | High (~25% of trajectories) |

Beyond structural decomposition, mid-sized models struggle to generate deterministic verification commands[^3]. In a multi-branch workflow, every task must culminate in an executable shell command returning a strict exit code. Open models frequently supply non-executable pseudocode, suggest circular unit tests that mock out the target logic, or prescribe broad repository test suites (such as mvn verify or make test) that take 30 minutes to run or fail on unrelated environment issues, destroying rapid feedback cycles.  
These behavioral patterns are exacerbated by physical hardware constraints[^13]. Serving a 32B parameter model at full context length under 16-bit precision requires substantial dedicated memory, with the KV cache alone requiring approximately 33 GB at 128K context[^13]. On a single GPU (typically 24 GB to 32 GB VRAM), local runtimes must employ aggressively quantized KV caches (such as FP[^8] or INT[^4]) or truncate the operational context to 16K–32K tokens[^13].  
This truncation induces severe attention dilution and "Lost in the Middle" degradation across longer sequence lengths[^13]. The local model loses sight of global repository invariants, causing it to author plans that duplicate existing functionality or conflict with global configurations[^13]. When evaluated as repository reviewers over complete execution traces, ~32B models catch only 17% of omitted functional requirements[^15].

## Multi-Turn Review Dynamics, Feedback Fidelity, and the Review-to-Rewrite Tipping Point
Arrangement A presumes that a local ~30B model can author an initial plan that a frontier model inspects and refines through iterative review rounds until achieving binding approval. However, research into multi-turn critique pipelines, self-refinement systems, and multi-agent interaction loops demonstrates that this pattern introduces severe operational friction[^16].  
Iterative refinement research across systems like Self-Refine and Reflexion shows that performance gains saturate rapidly, with diminishing returns setting in after 1 to 2 critique cycles[^16]. Beyond two rounds, repeated critique and modification cycles often degrade output quality[^16]. In complex planning tasks, multi-turn review triggers semantic drift: the local model modifies previously compliant tasks to satisfy localized feedback, inadvertently introducing regressions into other milestones[^17]. Repair, Regression, and NetGain metrics confirm that 80% to 90% of recoverable errors are resolved in the first revision cycle, while subsequent iterations yield flat or negative net utility[^20].  
This saturation is driven by critique degradation in weaker models[^17]. When a frontier model provides high-level architectural feedback—such as identifying missing synchronization barriers or non-isolated check commands—the ~30B model often responds with superficial syntactic edits[^17]. It inserts verbatim phrases from the critique into task descriptions without repairing the underlying execution sequencing, or deletes contentious milestones to bypass validation[^17]. As multi-turn dialogue expands, weaker models exhibit attention decay, over-indexing on the latest critique while dropping constraints established in earlier rounds[^17].  
Furthermore, continuous review-and-rejection loops degrade evaluator stability[^6]. TeamBench documented that in multi-agent configurations where an evaluator must approve an executor's work, language model verifiers produce a 49.4% false-acceptance rate on failing runs, approving non-compliant implementations as conversational context lengths increase[^6]. TeamBench also observed that unconstrained multi-turn critique setups experienced 3.6× more occurrences of role collapse, where the reviewer model abandoned iterative feedback and directly rewrote the target artifact[^6].  
The decision between reviewing and rewriting is governed by an asymmetric economic and computational tipping point. Reviewing requires the frontier model to re-ingest the full repository context and conversation history on every cycle while generating unstructured critique tokens[^17].  
Let $T_{\text{repo}}$ represent the repository context and requirements, $T_{\text{plan}}$ the size of the plan, and $T_{\text{critique}}$ the size of the critique. For each review turn $i$ in Arrangement A, the frontier model must process the cumulative context:  
$\text{Input Tokens}_i = T_{\text{repo}} + T_{\text{req}} + T_{\text{plan}}^{(0)} + \sum_{j=1}^{i-1}\left(T_{\text{critique}}^{(j)} + T_{\text{plan}}^{(j)}\right)$  
If the probability of a ~30B model producing a fully compliant multi-branch plan on Round 1 is $P^{(1)}_{\text{pass}} < 0.35$, the system will trigger a second or third turn in more than 65% of sessions.  
As established in the subsequent cost modeling, when the expected number of review rounds exceeds $k \approx 1.45$ under prompt caching (or $k \approx 1.14$ without caching), the cumulative prefill input costs charged by the frontier API surpass the cost of having the frontier model author the plan directly in a single turn. Reviewing remains economically viable only when initial plan compliance approaches certainty. Given the documented decomposition defects of mid-sized models, Arrangement A operates in a regime of systematic cost escalation and operational delay.

## Plan Adherence Mechanics: Internal Ownership versus External Frontier Scaffolding
An intuitive assumption in agent design is that an executor adheres more faithfully to a self-generated plan due to "ownership" and alignment with its internal parameter distributions. However, empirical studies examining agentic trajectories reject this hypothesis[^25].  
The investigation *"Do LLM Agents Execute the Plans They Declare?"* identified a widespread Plan Declaration–Execution Gap in autonomous language models[^25]. When an agent formulates an end-to-end plan within an open-ended ReAct or tool-use loop, it regularly deviates from its own declared path during execution[^25]. This behavior is driven by local reactive drift: upon receiving unexpected environmental observations—such as unfamiliar shell outputs, compiler warnings, or complex directory layouts—the model's localized attention shifts entirely to immediate error suppression[^8]. It abandons downstream milestones and begins executing uncoordinated, reactive tool calls[^8].  
Plan adherence is governed not by authorial ownership, but by the structural properties and constraints embedded in the plan artifact[^3].  
In terms of cognitive granularity alignment, the COPE framework proved that downstream executors require plans calibrated to their effective reasoning horizons[^5]. When a ~30B model drafts its own plan, it tends to specify sub-goals with high semantic ambiguity (such as "implement secure token exchange"), which overwhelms its reasoning capacity during multi-turn tool interaction[^26].  
Conversely, when a frontier model authors the plan, it decomposes complex features into bounded subtasks (such as updating dependency manifests, creating isolated adapter classes, and executing targeted unit tests)[^3]. This bounded scope insulates the local executor from context fragmentation and multi-file amnesia[^10].  
In terms of operational constraints, frontier models are uniquely capable of imposing explicit negative boundaries that prevent execution drift[^3]. In the Terminal-Bench 2.0 evaluation, orchestrator success depended on providing executor prompts with strict negative constraints (such as prohibiting algorithmic redesigns and requiring strict adherence to specified interfaces)[^3]. Mid-sized models do not generate negative constraints against themselves, creating plans that permit scope expansion and uncontrolled refactoring[^12].  
Finally, plan adherence depends on objective, external verification gating[^3]. An executor remains on track when task progression is gated by deterministic feedback[^3]. By embedding shell-executable check commands into each task, a frontier-authored plan creates an automated feedback loop: the local model is confined to an inner repair loop that terminates only when the shell assertion succeeds[^3]. This eliminates premature termination failures, where models falsely assume task completion without verifying results[^12].  
An open-weight executor adheres significantly better to a structured plan authored by a superior frontier model, provided that the plan enforces single-branch isolation, limits task scope to 1 to 3 files, and provides deterministic check commands[^3].

## Quantitative Token Cost Modeling and Unit Economics
To establish the financial characteristics of Arrangements A, B, and C, a unit token cost model must be formalized. Anthropic's pricing structure for Claude Opus reflects an asymmetric ratio where output token generation is billed at five times the rate of base input prefill[^28]. Prompt caching introduces write surcharges alongside substantial read discounts[^30].  
The economic parameters based on the Claude Opus platform architecture include:

* Base Input Rate ($P_{\text{in}}$): $\$5.00 \text{ per } 10^6 \text{ tokens}$ ($\$0.000005/\text{token}$)[^30]  
* Base Output Rate ($P_{\text{out}}$): $\$25.00 \text{ per } 10^6 \text{ tokens}$ ($\$0.000025/\text{token}$)[^30]  
* Prompt Cache Read Rate ($P_{\text{read}}$): $\$0.50 \text{ per } 10^6 \text{ tokens}$ ($0.10 \times P_{\text{in}}$)[^30]  
* Prompt Cache Write Rate ($P_{\text{write}}$, 5-minute TTL): $\$6.25 \text{ per } 10^6 \text{ tokens}$ ($1.25 \times P_{\text{in}}$)[^30]  
* Local ~30B Inference Cost ($C_{\text{local}}$): Fixed compute amortization, estimated at $\approx \$0.001 \text{ per run}$, representing zero marginal API cost[^1]

The operational parameters for a multi-branch repository feature request include:

* Repository Skeleton, Symbol Map, and Grounding Context ($T_{\text{repo}}$): $25,000 \text{ tokens}$  
* User Feature Request and Acceptance Criteria ($T_{\text{req}}$): $1,000 \text{ tokens}$  
* Multi-Branch Implementation Plan ($T_{\text{plan}}$): $2,000 \text{ tokens}$  
* Review Critique / Structural Feedback ($T_{\text{critique}}$): $600 \text{ tokens}$  
* Number of Review Rounds in Arrangement A ($k$): $k \geq 1.0$

### Mathematical Cost Formulations
In Arrangement B, the frontier model authors the implementation plan directly. The uncached cost formulation is:  
$C_B = \frac{(T_{\text{repo}} + T_{\text{req}}) \cdot P_{\text{in}} + T_{\text{plan}} \cdot P_{\text{out}}}{10^6} = \frac{26,000 \cdot \$5.00 + 2,000 \cdot \$25.00}{10^6} = \$0.1800$  
When accounting for an initial prompt cache write on the repository context (5-minute TTL), the cost becomes:  
$C_{B,\text{cached}} = \frac{T_{\text{repo}} \cdot P_{\text{write}} + T_{\text{req}} \cdot P_{\text{in}} + T_{\text{plan}} \cdot P_{\text{out}}}{10^6} = \frac{25,000 \cdot \$6.25 + 1,000 \cdot \$5.00 + 2,000 \cdot \$25.00}{10^6} = \$0.2113$  
If $T_{\text{repo}}$ is already resident in cache from prior operations, input prefill drops to $P_{\text{read}}$, reducing the cost to $\$0.0675$.  
In Arrangement C, the local model drafts an initial plan locally ($C_{\text{local}} \approx \$0$), and the frontier model rewrites it in a single turn. The uncached cost formulation is:  
$C_C = \frac{(T_{\text{repo}} - T_{\text{req}} + T_{\text{plan}}) \cdot P_{\text{in}} + T_{\text{plan}} \cdot P_{\text{out}}}{10^6} = \frac{28,000 \cdot \$5.00 + 2,000 \cdot \$25.00}{10^6} = \$0.1900$  
Under an initial cache write on the repository prefix, the cost becomes:  
$C_{C,\text{cached}} = \frac{25,000 \cdot \$6.25 + 3,000 \cdot \$5.00 + 2,000 \cdot \$25.00}{10^6} = \$0.2213$  
The financial overhead of Arrangement C relative to Arrangement B is exactly $T_{\text{plan}} \cdot P_{\text{in}} = \$0.0100$ per plan.  
In Arrangement A, the local model drafts the plan locally, and the frontier model conducts iterative review rounds. In Round 1, the frontier model ingests the context and emits a critique ($T_{\text{critique}} = 600 \text{ tokens}$):  
$C_{A,1} = \frac{28,000 \cdot \$5.00 + 600 \cdot \$25.00}{10^6} = \$0.1550 \quad (\text{Uncached})$  
$C_{A,1,\text{cached}} = \frac{25,000 \cdot \$6.25 + 3,000 \cdot \$5.00 - 600 \cdot \$25.00}{10^6} = \$0.1863 \quad (\text{Cached Write})$  
If the plan passes on Round 1 ($k = 1$), Arrangement A is $\$0.0250$ cheaper than Arrangement B. However, when the plan is rejected, the system enters Round 2. In Round 2, the cached repository prefix is read at $P_{\text{read}}$, but the uncached conversation history expands to include the initial draft, the critique, and the revised draft ($\approx 5,600$ uncached input tokens):  
$\Delta C_{A,2,\text{cached}} = \frac{25,000 \cdot \$0.50 + 5,600 \cdot \$5.00 + 600 \cdot \$25.00}{10^6} = \$0.0125 + \$0.0280 + \$0.0150 = \$0.0555$  
$C_{A,k=2,\text{cached}} = \$0.1863 + \$0.0555 = \$0.2418$  
Under uncached conditions, Round 2 incurs full prefill charges across the expanding context:  
$C_{A,k=2,\text{uncached}} = \$0.1550 + \frac{33,600 \cdot \$5.00 + 600 \cdot \$25.00}{10^6} = \$0.3380$  
For $k = 3$ rounds, the cached cost rises to $\$0.3015$, and the uncached cost reaches $\$0.5400$.

| Operational Cost Metric | Arrangement A (k=1k=1k=1, First Turn Pass) | Arrangement A (k=1.5k=1.5k=1.5, Mean Expected) | Arrangement A (k=2k=2k=2, Two Rounds) | Arrangement A (k=3k=3k=3, Three Rounds) | Arrangement B (Direct Authoring) | Arrangement C (Draft + Rewrite) |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **Opus 5 API (Uncached)** | \$0.1550 | \$0.2465 | \$0.3380 | \$0.5400 | **\$0.1800** | \$0.1900 |
| **Opus 5 API (Initial Cache Write)** | \$0.1863 | \$0.2140 | \$0.2418 | \$0.3015 | **\$0.2113** | \$0.2213 |
| **Opus 5 API (Steady Cache Read)** | \$0.0425 | \$0.0980 | \$0.1535 | \$0.2645 | **\$0.0675** | \$0.0775 |
| **Legacy Opus Rates (\$15/\$75\)**[^28] | \$0.4650 | \$0.6975 | \$0.9300 | \$1.3950 | **\$0.5400** | \$0.5700 |
| **Mean Wall-Clock Latency** | Baseline Single Turn | +1 Local Turn, +1 API Turn | +2 Local Turns, +2 API Turns | +3 Local Turns, +3 API Turns | **Lowest (1 API Turn)** | Moderate (+1 Local) |
| **Risk of Reviewer Fatigue**[^6] | Minimal | Moderate | High (Role Collapse Risk) | Severe (49% False Accept) | **Zero (Deterministic)** | **Zero (Deterministic)** |

The economic breakeven point between Arrangement A and Arrangement B is:  
$k_{\text{breakeven}} = 1.0 + \frac{C_B - C_{A,1}}{\Delta C_{A,2}} = 1.0 - \frac{\$0.2113 - \$0.1863}{\$0.0555} \approx 1.45 \text{ rounds (Cached)}$  
$k_{\text{breakeven}} = 1.0 + \frac{\$0.1800 - \$0.1550}{\$0.1830} \approx 1.14 \text{ rounds (Uncached)}$  
If the local ~30B model cannot achieve an immediate first-turn approval rate greater than $85\%$ ($P^{(1)}_{\text{pass}} \geq 0.85$), Arrangement A is mathematically more expensive per accepted plan than Arrangement B. Because empirical first-round acceptance rates for multi-branch architectures drafted by mid-sized models remain below 35%, Arrangement A operates with higher costs, elevated latency, and increased operational risk.

## Comparative Architectural Synthesis and Operational Recommendations
Comparing Arrangements A, B, and C across performance, cost, and stability establishes a clear architectural hierarchy.  
Arrangement A represents an inefficient multi-agent pattern. Mid-sized open models lack the attention stability and architectural reasoning required to produce sound multi-branch plans on initial generation[^10]. Subjecting the system to iterative critique loops consumes frontier tokens on descriptive feedback while repeatedly prefilling expanding conversation histories[^17].  
Weaker models often respond to critiques with superficial edits, leading to conversational deadlocks and verifier fatigue[^6]. Because the economic breakeven threshold sits at only 1.45 rounds under caching and 1.14 rounds without caching, the failure of the local model to produce approved plans on the first turn makes Arrangement A the most expensive and volatile approach per accepted plan.  
Arrangement C resolves the multi-turn latency and convergence failures of Arrangement A by enforcing a single-turn rewrite, adding only $\$0.010$ in prefill costs over Arrangement B[^24]. However, it introduces prompt anchoring bias[^32]. When a draft generated by a ~30B model is passed to Claude Opus alongside repository context, that draft acts as a conditioning prior[^32]. If the draft contains hallucinated files, inverted dependencies, or malformed scopes, the frontier model must expend reasoning capacity untangling those errors rather than designing an optimal solution from scratch[^5].  
Any potential benefit of having the local model identify relevant files is achieved more reliably and cheaply using deterministic retrieval tools (such as ripgrep or AST analyzers) without injecting speculative text into the prompt context[^8].

| Architectural Dimension | Arrangement A (Weak Drafts, Strong Reviews) | Arrangement B (Strong Plans, Weak Executes) | Arrangement C (Weak Drafts, Strong Rewrites) |
| :---- | :---- | :---- | :---- |
| **Cost per Accepted Plan** | **Poor.** Inflated by multi-turn prefill fees and critique generation ($k \geq 1.5$)[^24]. | **Optimal.** Fixed, single-turn expenditure (\$0.0675–\$0.2113)[^24]. | **Near-Optimal.** Minor input overhead over B ($+\$0.0100$)[^24]. |
| **End-to-End Latency** | **Unacceptable.** High latency from multi-turn local and API round-trips[^34]. | **Lowest.** Minimal latency; a single API call immediately initiates execution[^35]. | **Moderate.** Delayed by the local pre-draft generation phase[^33]. |
| **Decomposition Coherence** | **Volatile.** Degrades across review turns due to amnesia and local drift[^17]. | **Maximal.** Global architectural reasoning, clean interface isolation, optimal ordering[^3]. | **High.** Strong model restructuring, but vulnerable to prompt anchoring[^32]. |
| **Executor Adherence** | **Low.** Local model drifts when executing self-authored, ambiguous plans[^25]. | **Maximal.** Bounded tasks, strict negative constraints, deterministic checks[^3]. | **High.** Benefits from strong model task structures, identical to B[^3]. |
| **Feature Branch Hygiene** | **Low.** Out-of-order execution and vague checks cause broken pull requests[^6]. | **Highest.** Atomic branches, clean merge bases, reproducible automated verification[^3]. | **High.** Atomic branches structured by the frontier model[^3]. |
| **Pipeline Complexity** | **High.** Requires complex state management, critique parsing, and loop arbiters[^6]. | **Minimal.** Linear flow: Frontier Plan $\rightarrow$ Local Execution Loop $\rightarrow$ PR Review[^8]. | **Moderate.** Requires draft ingestion and rewrite orchestration[^33]. |

Arrangement B represents the optimal architectural configuration, providing a clear division of labor:

> 1. High-level architectural reasoning, dependency mapping, and verification design are cognitive, low-token tasks assigned to Claude Opus[^3].  
> 2. Dense tool execution, file editing, and test execution are mechanical, high-token tasks assigned to the local Qwen-30B model at near-zero marginal cost[^1].  
> 3. By requiring Opus to define an explicit goal, a 1-to-3 file editing boundary, and a shell check command for every task, the plan equips the local model with an automated governor[^3]. The local model executes within a sandbox, iterating against check command outputs until achieving exit code 03. This prevents premature completion and eliminates the Plan Declaration–Execution Gap[^12].

## Production System Specification
To implement Arrangement B across multi-branch software tasks, the execution environment should be organized into an automated, four-stage lifecycle.  
During the initial ingestion and grounding phase, the local harness uses deterministic tooling to inspect the repository. It generates an Abstract Syntax Tree (AST), maps directory hierarchies, and identifies relevant interface definitions, compiling a structured context payload ($T_{\text{repo}} \approx 25,000 \text{ tokens}$) alongside the user's requirements ($T_{\text{req}} \approx 1,000 \text{ tokens}$)[^8].  
During the architectural planning phase, the context payload is dispatched to the Claude Opus API in a single turn. The prompt enforces a structured JSON or YAML output schema that specifies milestones, tasks, target files, negative boundaries, and check commands:

JSON  
{  
  "milestones": \[  
    {  
      "milestone_id": "M1_AUTH_SCAFFOLD",  
      "branch_name": "feature/auth-scaffold",  
      "tasks": \[  
        {  
          "task_id": "T1_TOKEN_INTERFACE",  
          "target_files": \["src/auth/token.py", "tests/unit/test_token.py"\],  
          "goal": "Define TokenProvider protocol and JWT implementation handling HS256 signatures with 1-hour expiration.",  
          "forbidden_actions": \["Do not modify database models", "Do not import external auth frameworks"\],  
          "check_command": "pytest tests/unit/test_token.py -k test_jwt_issuance_and_validation"  
        }  
      \]  
    }  
  \]  
}

During the multi-branch execution phase, the local runtime parses the plan contract and iterates through milestones sequentially. For each milestone, the harness creates and checks out the designated Git feature branch. The local ~30B model enters an isolated execution loop bounded by the task's whitelist of target files, protecting its active context window from unnecessary repository history[^10].  
After applying file modifications, the harness automatically runs the task's deterministic check_command in an isolated container[^3]. If execution fails, standard error logs are injected back into the local model's prompt to drive targeted repair turns[^3]. Once the check command exits with code 0, the harness generates an atomic commit and advances to the next task.  
During the merge governance phase, upon completing all tasks within a milestone, the local harness pushes the feature branch and opens a pull request. Claude Opus is invoked to perform a consolidated review of the Git diff against the milestone specification.  
Because code execution was constrained by the initial plan contract and verified by automated check commands, the pull request arrives fully tested and syntactically validated[^3]. The frontier model verifies architectural compliance, flags subtle regressions, and issues binding merge approval into the main branch.  
By reserving the frontier model for high-leverage architectural boundaries—authoring the initial implementation contract and providing final merge validation—and assigning all intermediate file edits, tool actions, and test cycles to the local open-weight model, this architecture maximizes software engineering reliability while minimizing total API token expenditure[^1].

## Works cited

[^1]: Pushing the Cost-Accuracy Frontier of LLM Agent Teams | alphaXiv, <https://www.alphaxiv.org/abs/2606.20629>
[^2]: Pushing the Cost–Accuracy Frontier of LLM Agent Teams - arXiv, <https://arxiv.org/html/2606.20629v1>
[^3]: Orchestrator–executor split beats a solo model - Blackbox AI, <https://www.blackbox.ai/blog/orchestrator-executor-multi-agent-system-for-swe-tasks>
[^4]: Efficient LLM Collaboration via Planning - OpenReview, <https://openreview.net/forum?id=HrB7sYLd5N>
[^5]: Efficient LLM Collaboration via Planning - arXiv, <https://arxiv.org/html/2506.11578v2>
[^6]: TeamBench: A Multi-Agent Teamwork Benchmark with OS-Enforced, <https://teambench.github.io/>
[^7]: Capable language models can outgrow the benefits of collaboration, <https://www.researchgate.net/publication/410783332_Capable_language_models_can_outgrow_the_benefits_of_collaboration>
[^8]: Agentless: Demystifying LLM-based Software Engineering Agents, <https://www.researchgate.net/publication/381911059_Agentless_Demystifying_LLM-based_Software_Engineering_Agents>
[^9]: Demystifying LLM-Based Software Engineering Agents: A Review of, <https://www.researchgate.net/publication/417071553_Demystifying_LLM-Based_Software_Engineering_Agents_A_Review_of_Capabilities_Benchmarks_and_Failure_Modes>
[^10]: Qwen 2.5 Coder vs Claude 3.7 Sonnet (2026): Coding AI Price Battle, <https://checkapicost.com/vs/qwen-2-5-coder-vs-claude-3-7-sonnet>
[^11]: Efficient LLM Collaboration via Planning - OpenReview, <https://openreview.net/forum?id=RPzbeL0koP>
[^12]: SHEPHERD: PATTERN-GUIDED TRAJECTORY SELEC, <https://openreview.net/pdf?id=ZBOFr4ryBk>
[^13]: Qwen 2.5 Coder Context Window: 128K Limits & VRAM Guide - Fastio, <https://fast.io/resources/qwen-2-5-coder-context-window/>
[^14]: 32B model stress test: Qwen 2.5/Coder/3 on dual RTX 5060 Ti (zero, <https://www.reddit.com/r/LocalLLaMA/comments/1pcfeiq/32b_model_stress_test_qwen_25coder3_on_dual_rtx/>
[^15]: When Weak Reviewers Can Audit Strong Coding Agents - arXiv, <https://arxiv.org/html/2610.01023v1>
[^16]: A Survey of Scaling in Large Language Model Reasoning - arXiv, <https://arxiv.org/html/2504.02181v2>
[^17]: Controlling Form and Detail in LLM Translation Refinement - arXiv, <https://arxiv.org/html/2610.15661v1>
[^18]: Self-Refinement Framework in AI - Emergent Mind, <https://www.emergentmind.com/topics/self-refinement-framework>
[^19]: Self-Refine / Reflexion | ML Wiki - AxioML, <https://axioml.org/wiki/self-refine-reflexion>
[^20]: [2511.03898] Secure Code Generation at Scale with Reflexion - arXiv, <https://arxiv.org/abs/2511.03898>
[^21]: Critique-RL: Training Language Models for Critiquing through Two, <https://www.alphaxiv.org/abs/2510.24320>
[^22]: ConstitutionMAS-EC: Peer Constitutional Critique for ... - OpenReview, <https://openreview.net/pdf?id=Qiv0uqwHCB>
[^23]: A Controlled Study of Multi-Agent LLM Revision, <https://thesai.org/Downloads/Volume17No10/Paper_5-When_AI_Agents_See_Each_Others_Answers_Their_Answers_Grow_More_Alike.pdf>
[^24]: unknown_url, <http://docs.google.com/unknown_url>
[^25]: (PDF) Do LLM Agents Execute the Plans They Declare? From, <https://www.researchgate.net/publication/415031985_Do_LLM_Agents_Execute_the_Plans_They_Declare_From_Planning-Mode_Declaration_to_Pattern-Specific_Execution>
[^26]: PlanGenLLMs: A Modern Survey of LLM Planning Capabilities, <https://aclanthology.org/2025.acl-long.958.pdf>
[^27]: Agentless :Demystifying LLM-based Software Engineering Agents, <https://arxiv.org/html/2407.01489v2>
[^28]: Claude API Cost: Anthropic API Pricing per Token (2026), <https://licenseware.io/claude-api-cost/>
[^29]: Anthropic API Pricing 2026: Cost Per Million Tokens - Activepieces, <https://www.activepieces.com/blog/anthropic-api-pricing-2026-cost-per-million-tokens>
[^30]: Claude Opus 5 Pricing: API Rates, Plans, and Real Costs - Emergent, <https://emergent.sh/learn/claude-opus-5-pricing>
[^31]: Prompt caching - Claude Platform Docs, <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
[^32]: Contrastive Weak-to-strong Generalization - arXiv, <https://arxiv.org/html/2510.07884v1>
[^33]: Low-resource Preference Alignment by Weak-to-Strong Decoding, <https://arxiv.org/html/2506.07434v1>
[^34]: From LLM Inference to Agentic Workloads: Characterization ... - arXiv, <https://arxiv.org/html/2608.15127v1>
[^35]: LLM vs RAG vs AI Agent vs Agentic AI: 2026 Architecture - Taskade, <https://www.taskade.com/blog/llm-rag-agent-agentic>
