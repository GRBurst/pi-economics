# How the reports were cleaned

The eight reports were exported from Gemini Deep Research as Markdown. The raw exports are in `originals/`; the
cleaned versions next to this file. The future tool for this job is specified in
`../prompts/research-cleanup-tool.md`.

## What was changed

- The embedded PNG images (`![][imageN]`, `[imageN]: <data:image/png;base64,...>`) are inline math formulas.
  Each was read by eye and transcribed to inline LaTeX (`$...$`); the data URIs were removed.
  Exception: batch 3's two reports (23 images) were transcribed by OCR
  (tesseract over ImageMagick preprocessed renders), because this session's
  model has no vision; the doubts it left are listed under open points.
- Citation numbers glued to words ("models3.") became footnotes `[^3]`; `[cite: 5, 11]` became `[^5][^11]`.
  Version numbers that swallowed a citation were split by hand ("Apache 2.014" → `Apache 2.0[^14]`, "CC BY
  4.03" → `CC BY 4.0[^3]`, "Claude Opus 4.83" → `Claude Opus 4.8[^3]`); names with digits (Qwen3, GPT-5, R1,
  v3, INT8, F1, SWE-bench Verified) were kept; batch 3 extended the keep list with NVFP4, Q4_K_M, NL2Repo,
  GSM8K, o1, qwen3, URL hashes and issue numbers.
- The two batch-3 reports cited differently from batches 1–2:
  `autonomous-merge-pipeline-size-limits.md` glues numbers to words, cleaned with the same pass after five
  hand-split fusions ("relative to Opus 518." → `Opus 5[^18].`, "Terminal-Bench 2.14." → `2.1[^4].`,
  "2.19." → `2.1[^9].` twice, "4.016." → `4.0[^16].`, "arXiv:2610.3350927" → `arXiv:2610.33509[^27]`);
  `coding-agent-loop-harness-research.md` puts the number after a claim-type tag (`[Peer-Reviewed]11`),
  converted only where the line ends in such a tag. Its untagged `[Inference]` and a stray
  "64.0% pass rate 1" (an Aider-post footnote-marker artifact) were kept, the prose otherwise unchanged.
- `#### **Works cited**` with `> n. Title, [url](url)` became `## Works cited` with `[^n]: Title, <url>`.
- Markdown escapes (`\- \+ \~ \. \: \= \!`, `\_`) removed, bold removed from headings, `$` before digits
  escaped as `\$`, blank-line runs collapsed. The prose is otherwise unchanged (checked by a word-level diff
  against the originals).

## Scripts

`cleanup/clean-batch1.mjs` (the first three reports), `cleanup/clean-batch2.mjs` (the middle three) and
`cleanup/clean-batch3.mjs` (the last two) did the work. Each holds its batch's formula transcriptions and
expects the original export file names (title with spaces, `.md`) in its working directory (batches 2 and 3:
the directory given as its argument). They are kept as provenance, not as a reusable tool.

## Results and open points

| Report | References | Cited |
|---|---|---|
| `llm-routing-for-coding-agents.md` | 50 | 30 |
| `local-model-coding-orchestration-research.md` | 51 | 33 |
| `strong-model-oversight-for-agents.md` | 45 | 27 |
| `two-tier-agent-planning-architecture.md` | 35 | 35 |
| `agentic-plan-and-code-sizing.md` | 58 | 58 |
| `frontier-model-plan-review-protocol.md` | 40 | 40 |
| `coding-agent-loop-harness-research.md` | 47 | 28 |
| `autonomous-merge-pipeline-size-limits.md` | 39 | 24 |

No footnote is dangling. Uncited references are Gemini's, left in place. The load-bearing sources of the two
batch-3 reports have not been spot-checked yet; the spot-check bullet in the README covers only the three
plan-authorship reports.

Transcribed literally although doubtful:

1. `frontier-model-plan-review-protocol.md`, line 19 (Post-Release row): `$60.0\times-100.0\times+$`; the
   trailing `+` is uncertain.
2. `two-tier-agent-planning-architecture.md`, line 93, `C_{A,1,cached}`: the image shows `− 600·$25.00`, but
   the stated value \$0.1863 needs `+`.
3. `two-tier-agent-planning-architecture.md`, line 111, `k_breakeven` (cached): the image shows `1.0 −`, but
   the stated ≈1.45 needs `+`.
4. `agentic-plan-and-code-sizing.md`, line 37: `p_success(agent, t) = σ(β(log h_agent − log t))`, read by eye;
   the sentence supports it.
5. `autonomous-merge-pipeline-size-limits.md`, the display cost formula `C*_merge(S)`: OCR of a 620×87 px
   render; the grouping of the `(1 − P_correct)` factor and the subscript of the last term are uncertain.
6. `autonomous-merge-pipeline-size-limits.md`, the size-cap cells `$\le 30$ files`, `$\le 2{,}000$ lines` and
   `$\le 50$`: OCR read `≤` and the prose supports it, but `≤` versus `<` is not certain.
7. `autonomous-merge-pipeline-size-limits.md`, the Haiku price cell: the raw cell ends "tokens) $0.01 Cache
   Reads" with no closing `$` after `100k`; the transcription adds it.

Not fixable without the sources: titles Gemini truncated in the reference lists; one reference in
`two-tier-agent-planning-architecture.md` (24) points to `http://docs.google.com/unknown_url`. One stray
`\<` escape is left in `two-tier-agent-planning-architecture.md`.
