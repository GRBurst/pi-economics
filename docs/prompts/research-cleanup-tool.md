# Prompt: a cleanup tool for Gemini Deep Research exports

Hand the block below to a coding agent. Replace `<TARGET_DIR>` first. This
repository is not a good home for the tool: its scope is pi's token economics,
and every tracked file here passes its leak and boundary checks. A small tools
repository or `~/.local/share/gdr-clean` works.

---

```
Build a small command-line tool, `gdr-clean`, that cleans Markdown files exported
from Gemini Deep Research ("Export to Docs", then downloaded as Markdown). Put it
in <TARGET_DIR>. Use Node.js (>= 22) with no npm dependencies; ImageMagick
(`magick`) is optional. Write tests first (node:test), with small synthetic
fixtures that exercise every rule below.

## The input format (observed on six exports)

- Line endings may be CRLF.
- Inline math is exported as images: the body uses `![][imageN]`, and the end of
  the file holds definitions `[imageN]: <data:image/png;base64,...>`. They are
  formulas (for example tau, N >= 2, a weighted sum of scores, a SHA256 hash
  expression), not decoration, so they must become LaTeX, not be deleted.
- Citations are digits glued to the preceding word or punctuation, before
  punctuation, a space, `|` or the end of the line: `models3.`, `cost12,`,
  `latency)4 `, `90%7`. A few appear as `[cite: 5, 11]`.
- The reference list starts at `#### **Works cited**`; each entry is
  `> n. Title, [https\://example.org/x](https://example.org/x)`. Titles are
  sometimes truncated by Gemini; leave them as they are.
- Markdown escapes everywhere: `\- \+ \~ \. \: \= \!` and `word\_word`.
- Headings are bold: `## **Title**`.
- Currency like `$5.99` would be parsed as math by renderers.

## What the tool does

Two phases, because the formula images need eyes (a vision model or a human),
and the tool itself stays deterministic:

1. `gdr-clean extract <file.md>...`
   - Decodes every image to `<stem>.images/imageN.png`.
   - Writes `<stem>.math.json`: `{"1": "", "2": "", ...}`, each entry with the
     sentence around its use as a `context` hint (for example
     `{"1": {"latex": "", "context": "... the threshold ![][image1] is ..."}}`).
   - If `magick` exists, also writes `<stem>.images/sheet.png`, a labelled
     montage of all images at a legible scale, so a vision model can transcribe
     them all from one picture.
   - Prints what is left to fill.
2. `gdr-clean apply <file.md>...` (in place; `--dry-run` prints a diff)
   - Refuses to run while any formula in `<stem>.math.json` is empty, and
     names the missing ones.
   - Replaces `![][imageN]` with `$<latex>$` and deletes the data-URI lines.
   - Turns glued citations into footnotes `[^n]`, only for 1 <= n <= the number
     of references; never inside `$...$` math.
   - Converts `[cite: a, b]` to `[^a][^b]`.
   - Rewrites the reference list to `## Works cited` with
     `[^n]: Title, <url>` lines (unescaping the title).
   - Removes the Markdown escapes, the bold in headings, and runs of 3+ blank
     lines; escapes `$` before a digit as `\$` outside math.
   - Writes a report (stdout, and `--report <file>` as JSON) per file:
     references, cited ids, uncited ids, dangling citations (must be none),
     ambiguous cases (below), and a word-level check that the prose is unchanged
     apart from the rules above.
   - Is idempotent: a second run changes nothing; an already-cleaned file is
     detected and skipped.

## Ambiguous digits: never guess

Digits glued to a word are sometimes part of the name: `Qwen3`, `GPT-5`, `R1`,
`v3`, `INT8`, `AVX2`, `DDR5`, `FP32`, `SHA256`, `4o`. And a version number can
swallow a citation: `Apache 2.014 ` is `Apache 2.0` + citation 14,
`CC BY 4.03 ` is `CC BY 4.0` + citation 3, `Claude Opus 4.83` is `Opus 4.8` + 3.

- Keep a built-in allowlist of name tokens (the list above) and make it
  extendable with `--keep <token>` or a `gdr-clean.json` next to the files.
- A decimal followed by more digits (`\d+\.\d{2,}`) is never converted
  automatically; it is listed in the report with its line number and the
  candidate split, and is applied only through an overrides file
  (`<stem>.overrides.json`: `{"Apache 2.014 ": "Apache 2.0[^14] "}`).
- Any other glued number whose word is not a known name but looks like one
  (letters and digits mixed, such as `Llama3`) is reported as ambiguous too.

## Done means

- Tests pass and cover each rule, including idempotence, the refusal on
  missing formulas, the ambiguity report, and no conversion inside math.
- On a real export: no `data:image` and no `![][image` left, no dangling
  footnote, no `> n.` reference line left, and the prose check passes.
- A README with the two-phase workflow, including the instruction for the
  vision step: "Read `<stem>.images/sheet.png`, fill `<stem>.math.json` with
  inline LaTeX, using each entry's context to resolve ambiguity."
```
