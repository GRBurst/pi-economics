# Findings: routing, local orchestration, oversight

Sources: `llm-routing-for-coding-agents.md`, `local-model-coding-orchestration-research.md`,
`strong-model-oversight-for-agents.md` (prompts 1–3 in `prompts.md`). Extracted while cleaning them; general
direction only, numbers as the reports give them, not checked against their sources.

## Routing models (`llm-routing-for-coding-agents.md`)

- Do not replace the rule-based card router with a learned router. Chat-trained routers (RouteLLM,
  Arch-Router) do not transfer to coding subtasks; the main model routing itself is poorly calibrated and
  costs time on the single local slot.
- Optional later: a small CPU encoder for the residual ambiguous cards, escalating one level when unsure.
  Candidates the report names: Switchcraft (66M DistilBERT, CC BY 4.0, Microsoft Research, May 2026), NVIDIA
  prompt-task-and-complexity-classifier (86M DeBERTa, 512-token limit), Arch-Router-1.5B (150–320 ms on CPU,
  Katanemo license).
- Verification cascades (try cheap, verify, escalate) beat static routing (+14% on SWE-bench, as reported).
- Adapting a router from our own logs: kNN or ridge regression over card embeddings, from 250–1,500 logged
  outcomes.

## Local orchestration (`local-model-coding-orchestration-research.md`)

- The positive results are structured pipelines, not freely prompted orchestration:
  - AI21: an open model explores, results are filtered, one Opus call writes the patch: 80.8% on SWE-bench Pro
    at \$5.99 against solo Opus 4.8 at \$18.28.
  - Fireworks: an open worker (GLM-5.2/Kimi) plus one read-only Opus advisor review at the end: 59 → 66%;
    matches Opus on Terminal-Bench 2.1 at half the cost. An added planning advisor call doubled cost without
    gain.
  - ToolOrchestra's Orchestrator-8B is RL-trained; prompted Qwen3-8B/32B as a router delegated 73% to GPT-5.
- Failure modes of a prompted ~30B orchestrator: over-delegation, under-delegation and patch thrashing,
  premature completion (false success), tool-schema drift, context rot.
- Escalation signals, best first: verifier/check results; state churn (same file edited 3× in 4 turns,
  duplicate commands); a learned trajectory monitor; logprobs; self-consistency. Self-assessed confidence has
  negative utility.
- Limits for a local ~30B model (report's figures): effective context ~32k, degradation after 15–20 turns,
  4 or more files → escalate.
- Recommended: a deterministic harness that enforces escalation gates (reproduction stall at 8 turns, two
  consecutive verification failures, churn, 4+ files); structured task cards as the delegation interface,
  no transcript handoff; Haiku for syntax and compiler fixes, Sonnet as the default escalation, Opus for
  multi-file or architecture work or after Sonnet fails (under 5–10% of calls); compaction every 4 turns;
  static prompt prefixes.

## Oversight (`strong-model-oversight-for-agents.md`)

- Trigger events, best value first: (1) the completion claim before commit (binding gate, approval token);
  (2) consecutive check or test failures (advisory steering); (3) a high-risk domain (binding
  authorization); (4) plan inception (advisory; risk of anchoring on hints); (5) looping, handled by
  deterministic tripwires in the harness, Opus only if it persists.
- Tripwires: the same tool-call hash 3 times; 4 writes with no change to the tree; an A→B→A→B pattern;
  stderr similarity ≥ 0.92 twice; context above 85% with no progress for 25 or more turns.
- Overseer input per trigger: diff, tests and spec (4–12k tokens) at completion; stderr, the focal diff and
  the hypothesis (2–5k) at failures; never the full transcript.
- Weak models ignore advisory critique (sycophancy, the adherence–resolution gap), so the gates that matter
  are binding and mechanical. "Steer, don't solve": the overseer has no write tools, returns a typed JSON
  verdict, and code blocks in its answer are rejected.
- Opera (Mei et al., Oct 2026): persistent corrective notes with release audits, Qwen3.8-27B +8.9 pp on
  DeepSWE.

## Taken into the local-mode design so far

- The router keeps its rules; the local model chooses by writing cards, the router adds hints from what it
  measures (check failures, retries, risky paths, churn, context size).
- Small increments on feature branches in worktrees; one binding Opus review before each merge (diff, check
  output, the plan section), not before every commit; merges only through the gate.
- Plans for requests larger than one branch (milestones → tasks; a milestone or a task is one branch), with
  one binding Opus plan review and delta reviews of later amendments. Who writes the plan is open; see
  `findings-plan-authorship.md`.
