# Context folding in long sessions

Field notes on folding context well when pi's context window nears its limit,
distilled from one session that processed two ~15-page Deep Research reports
against a 262k window. This is operational knowledge about the
`context_*` tools of the `infinite-context` component (module contract:
[`pi-economics.md`](pi-economics.md), component docs:
[`pi-token-economics.md`](pi-token-economics.md)); the component docs say what
the extension is, this file says how to drive it.

Observed behaviours below were seen in that session (pi 1.4.0, patched
infinite-context); where a cause is guessed it is marked **inference**.

## The tools

| Tool | Role |
|---|---|
| `context_map` | List the ordered roots, or one fold's direct children: `[#id] <role> ~<tokens> · <preview>` per message, `fold <N> msgs` per fold. Previews shrink to fit; tokens are omitted when pi keeps the item out of context. |
| `context_peek` | Read one original message's text or one fold's summary without changing context. 1-based line window (default 100, max 2000); the result reports total lines, so you can page. |
| `context_search` | Case-insensitive JavaScript regex over every original message and every fold summary. At most 5 matching lines per item and 50 per pattern. |
| `context_fold` | Wrap one or more contiguous root ranges in new folds. Each item: `{from, to?, summary}`. All-or-nothing per call. Tool calls and their results are indivisible. |

## What a fold is

A fold is a projection, not a deletion. The folded originals stay reachable:
`context_peek` and `context_search` answer for them by id. A fold is itself a
root, so a later fold can wrap it — the earlier fold and its summary become
children, unchanged. That is also the repair path for a bad fold: fold a range
from the bad fold's id to where you actually meant to end, and the mistake is
kept as history under the corrected projection.

## Mechanics that bite

- **`to` defaults to `from`.** An item without `to` folds exactly one message
  ("fold 1 msgs" in the response) and frees almost nothing — while the fold's
  summary *adds* tokens. Omitting `to` on four items once grew the context
  (197k → 225k) instead of shrinking it. Always pass both ends.
- **Range starts: use user, custom, toolResult, or fold ids.** Every range
  that started at an assistant message was rejected with `"…is not a root"` —
  even when `context_map` listed that id as a root. **Inference:** an
  assistant message carrying tool calls forms an indivisible pair with its
  results, and a range start is only valid at a foldable boundary. Ranges
  started at user, custom, toolResult and fold ids all worked; the end (`to`)
  accepted every role.
- **Do not orphan a call.** Starting a range at a `toolResult` is accepted,
  but the paired assistant call is left outside the fold — and that orphan
  then fails to fold on its own (`"not a root"`; `context_peek` says "not in
  the archive on this branch"). It stays in context for the whole session.
  Prefer a start that includes both halves of each pair.
- **Re-map right before folding.** Fold responses return new fold ids, and
  your next call must use current ids. A stale id fails loudly ("is not a
  root"), so the cost of re-mapping is small.
- **Do not fold an in-flight pair.** The call you are answering (and its
  not-yet-arrived result) cannot be part of a range.

## Writing the summary

The summary is all the model sees of the range afterwards; the originals are
recoverable only through ids. Keep it a pointer plus payload:

- **Keep verbatim:** file paths, exact commands, error messages, decisions
  with their rationale, open loops, key numbers, and the distinctive phrases
  you would later pass to `context_search`.
- **Drop:** raw tool output, verbose logs, dead ends — but keep the dead end's
  one-line lesson (a wrong fold batch and its fix are exactly this).
- **Mark state:** `DONE, closed` / `IN PROGRESS — the active task`, and for
  the active task a numbered remaining-steps list. The next session should be
  continuable from the summary alone.

## When, and how big

A fold rewrites the cached prompt prefix from the fold point on. Folding the
current tail right after a phase completes is cheap; folding an old range
while the cache is warm is expensive. The component's cost-aware fold hint
states the trade ("cache is cold: folding is free now").

- Fold at phase boundaries: finished exploration, finished debugging,
  implemented-and-verified work, and large tool results once you have
  processed them.
- Batch disjoint ranges into one call: each item re-writes the cached prefix,
  so a batch should free a meaningful total (≳ 15k tokens) to be worth the
  rewrite.
- **Verify the response.** It reports `freed ~N tokens`. If N is far below
  the sum of the folded ranges' `~tokens` estimates, something was
  mis-specified (usually a missing `to`): re-map and refold from the bad
  fold's id.

## Recovering content

- `context_search` with a distinctive exact phrase locates archived text and
  returns stable ids.
- `context_peek <id>` then reads it back line by line. In the session behind
  this file, the full text of a ~160-line research prompt was recovered from
  a folded assistant message this way (the fold's summary only recorded the
  id and the prompt's opening sentence).
- A fold's *summary* is itself peek-able, which is how you re-read your own
  earlier projections.

## What stays live

The floor a session can fold down to: the original user request(s), the
active task's state (a fresh fold with its remaining steps), and the last
few exchanges. Everything older is fair game. In the session behind this
file the floor was ~174k of 262k after three fold batches (146.4k + 91.4k +
47.7k freed); the remainder was exactly that floor.

## The session, in numbers

| Event | Context |
|---|---|
| First fold reminder (75%) | ~197k / 262k |
| Fold batch with `to` omitted on all items | grew to ~225k |
| Refold of the same ranges, `to` supplied | freed 146.4k |
| Verification-phase fold (two ranges) | freed 91.4k |
| Final fold (three ranges, this doc written after) | freed 47.7k; floor ~174k |

The same session orphaned one assistant message (mid-pair start) and recovered
its content's only consumer by `context_search` + `context_peek` — both
incidents are the source of the rules above.
