# Research for local mode

Gemini Deep Research reports (prompts in `prompts.md`, raw exports in `originals/`, cleanup in `cleanup.md`), gathered while designing local mode: a local
Qwen orchestrates and implements, and Claude models are called on request,
with Opus as an overseer. They were exported to Markdown and cleaned
(formula images transcribed to inline LaTeX, citations turned into
footnotes); the text is otherwise Gemini's.

**Read them as general advice only.** Many numbers are unsourced or
invented, several citations do not match their claims, and many sources are
vendor or personal blogs. Check a claim against its source before a design
decision rests on it.

| Report | Question |
|---|---|
| `llm-routing-for-coding-agents.md` | Open-weight routing models, and whether one can run on a CPU |
| `local-model-coding-orchestration-research.md` | Can a small local model orchestrate and escalate to frontier models? |
| `strong-model-oversight-for-agents.md` | When and how a strong model oversees a weaker orchestrator |
| `two-tier-agent-planning-architecture.md` | Who writes the plan: the local model or Opus |
| `agentic-plan-and-code-sizing.md` | Task, milestone and diff sizes; the plan as external memory; replanning |
| `frontier-model-plan-review-protocol.md` | How Opus reviews a plan: input, checks, verdict format |

## Known problems

- `two-tier-agent-planning-architecture.md`: the formulas behind lines 93 and
  111 show a minus where the stated results need a plus; kept as exported.
- Spot checks of five load-bearing sources of the last three reports: all
  exist; the diff-size result (arXiv 2606.15689, review F1 0.657 below 10
  changed lines, 0.043 above 150) matches but tested Sonnet and Haiku, not
  Opus; AgentCARD (arXiv 2606.20629) supports heterogeneous teams but not the
  report's 36% inversion figure; the COPE abstract (arXiv 2506.11578) does not
  support "a weaker plan degrades the executor"; the plan-review blog's
  anecdote (11 of 12 models approved a check aimed at the wrong module)
  matches, its precision and recall tables do not exist in the source.
- No source compares a plan written by the local model and reviewed by Opus
  with a plan written by Opus.

## Findings

- `findings-routing-orchestration-oversight.md`: the first three reports, and what local mode took from them.
- `findings-plan-authorship.md`: the last three, on who writes the plan, with spot checks of their sources.
