# How the reports were cleaned

The six reports were exported from Gemini Deep Research as Markdown. The raw exports are in `originals/`; the
cleaned versions next to this file. The future tool for this job is specified in
`../prompts/research-cleanup-tool.md`.

## What was changed

- The embedded PNG images (`![][imageN]`, `[imageN]: <data:image/png;base64,...>`) are inline math formulas.
  Each was read by eye and transcribed to inline LaTeX (`$...$`); the data URIs were removed.
- Citation numbers glued to words ("models3.") became footnotes `[^3]`; `[cite: 5, 11]` became `[^5][^11]`.
  Version numbers that swallowed a citation were split by hand ("Apache 2.014" → `Apache 2.0[^14]`, "CC BY
  4.03" → `CC BY 4.0[^3]`, "Claude Opus 4.83" → `Claude Opus 4.8[^3]`); names with digits (Qwen3, GPT-5, R1,
  v3, INT8, F1, SWE-bench Verified) were kept.
- `#### **Works cited**` with `> n. Title, [url](url)` became `## Works cited` with `[^n]: Title, <url>`.
- Markdown escapes (`\- \+ \~ \. \: \= \!`, `\_`) removed, bold removed from headings, `$` before digits
  escaped as `\$`, blank-line runs collapsed. The prose is otherwise unchanged (checked by a word-level diff
  against the originals).

## Scripts

`cleanup/clean-batch1.mjs` (the first three reports) and `cleanup/clean-batch2.mjs` (the last three) did the
work. Each holds its batch's formula transcriptions and expects the original export file names (title with
spaces, `.md`) in its working directory (batch 2: the directory given as its argument). They are kept as
provenance, not as a reusable tool.

## Results and open points

| Report | References | Cited |
|---|---|---|
| `llm-routing-for-coding-agents.md` | 50 | 30 |
| `local-model-coding-orchestration-research.md` | 51 | 33 |
| `strong-model-oversight-for-agents.md` | 45 | 27 |
| `two-tier-agent-planning-architecture.md` | 35 | 35 |
| `agentic-plan-and-code-sizing.md` | 58 | 58 |
| `frontier-model-plan-review-protocol.md` | 40 | 40 |

No footnote is dangling. Uncited references are Gemini's, left in place.

Transcribed literally although doubtful:

1. `frontier-model-plan-review-protocol.md`, line 19 (Post-Release row): `$60.0\times-100.0\times+$`; the
   trailing `+` is uncertain.
2. `two-tier-agent-planning-architecture.md`, line 93, `C_{A,1,cached}`: the image shows `− 600·$25.00`, but
   the stated value \$0.1863 needs `+`.
3. `two-tier-agent-planning-architecture.md`, line 111, `k_breakeven` (cached): the image shows `1.0 −`, but
   the stated ≈1.45 needs `+`.
4. `agentic-plan-and-code-sizing.md`, line 37: `p_success(agent, t) = σ(β(log h_agent − log t))`, read by eye;
   the sentence supports it.

Not fixable without the sources: titles Gemini truncated in the reference lists; one reference in
`two-tier-agent-planning-architecture.md` (24) points to `http://docs.google.com/unknown_url`. One stray
`\<` escape is left in `two-tier-agent-planning-architecture.md`.
