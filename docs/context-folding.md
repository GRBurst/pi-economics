# Context folding in long sessions

Field notes on folding context well when pi's context window nears its limit,
distilled from one session that processed two ~15-page Deep Research reports
against a 262k window. This is operational knowledge about the
`context_*` tools of the `infinite-context` component (module contract:
[`pi-economics.md`](pi-economics.md), component docs:
[`pi-token-economics.md`](pi-token-economics.md)); the component docs say what
the extension is, this file says how to drive it.

Observed behaviours below were seen in that session (pi 1.4.0,
infinite-context at upstream 494df9d with pi-economics 0.3.1's reminders
patch); where a cause is guessed it is marked **inference**. Since 0.3.2 the
extension is upstream 0c7f021, unpatched; where its tools changed since the
session, the text says so.

## The tools

| Tool | Role |
|---|---|
| `context_map` | List the ordered roots (no id, or an empty one), or one fold's direct children, a tool call with its results as one line: `<id> <role> <tokens> <preview>` per message, `<id> call <tokens> <preview>` per tool call with its results, `<id> fold <tokens> <summary preview>` per fold; `not live` instead of tokens when pi keeps the item out of context. The running tool call is not listed; previews shrink to fit. (Until upstream f7d598d the map had one line per message, with `[#…]` ids.) |
| `context_peek` | Read one original message's text (a call id reads the call with its results) or one fold's summary without changing context; assistant thinking is left out. 1-based line window (default 100, max 2000); the result reports total lines, so you can page. |
| `context_search` | Case-insensitive JavaScript regex over every original message and every fold summary, without assistant thinking and the running call. At most 5 matching lines per item and 50 per pattern. |
| `context_fold` | Wrap one or more contiguous root ranges in new folds. Each item: `{from, to, summary}`, `to` required (`from = to` for one root, also to revise a fold's summary). All-or-nothing per call. Tool calls and their results are indivisible. An id that exists nowhere is reported as unknown, one inside a fold as already folded, with a pointer to the map. |

## What a fold is

A fold is a projection, not a deletion. The folded originals stay reachable:
`context_peek` and `context_search` answer for them by id. A fold is itself a
root, so a later fold can wrap it — the earlier fold and its summary become
children, unchanged. That is also the repair path for a bad fold: fold a range
from the bad fold's id to where you actually meant to end, and the mistake is
kept as history under the corrected projection.

## Mechanics that bite

- **Pass the range's real end.** `to` is required since upstream 9f74dda. In
  the session a missing `to` used to fold exactly one message ("fold 1 msgs"
  in the response), freeing almost nothing — while the fold's summary *adds*
  tokens. Omitting `to` on four items once grew the context (197k → 225k)
  instead of shrinking it. A `to` equal to `from` still folds one root: use
  it for that, or to revise a fold's summary.
- **Take range ids from the current map.** With the earlier map (one line per
  message), every range that started at an assistant message was rejected
  with `"…is not a root"` — even when `context_map` listed that id as a root;
  ranges started at user, custom, toolResult and fold ids all worked, and the
  end (`to`) accepted every role. **Inference:** an assistant message carrying
  tool calls forms an indivisible unit with its results, and a range start is
  only valid at a foldable boundary. Upstream's map now lists such a unit as
  one `call` line (f7d598d), so the ids it lists are those boundaries.
- **Do not orphan a call** (seen with the earlier map, which listed a result
  on its own line). Starting a range at a `toolResult` is accepted,
  but the paired assistant call is left outside the fold — and that orphan
  then fails to fold on its own (`"not a root"`; `context_peek` says "not in
  the archive on this branch"). It stays in context for the whole session.
  Prefer a start that includes both halves of each pair.
- **A range boundary must not split a tool unit, even between sibling
  results** (seen with the earlier map; ranges between the current map's ids
  keep units whole). When one assistant message issues several tool calls, *all* of
  its results belong to one indivisible unit. Ending range A at the first
  result and starting range B at a sibling result of the same call message
  is rejected: `Items 1 and 2 overlap after tool-unit expansion (roots
  "…".."…" and "…".."…"). Combine them into one item.` The error prints the
  *expanded* ranges, so you can see exactly where they touch. Fix: move the
  boundary to after the unit's last result, or combine the two items into
  one range (a single item from the first start to the later end).
- **Re-map right before folding.** Fold responses return new fold ids, and
  your next call must use current ids. A stale id fails loudly (since
  0c7f021 an id inside a fold says it is already folded and points to the
  map), so the cost of re-mapping is small.
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
while the cache is warm is expensive. Upstream's fold rule, sent with every
reminder, asks for a fold once it can free about 35 % of the tokens in
context: a fold costs about ten reads of the whole context, so one that frees
35 % repays itself after about 30 turns (the session behind this file ran on
an earlier rule of about 30 %).

- Fold at phase boundaries: finished exploration, finished debugging,
  implemented-and-verified work, and large tool results once you have
  processed them.
- Batch disjoint ranges into one call: each item re-writes the cached prefix,
  so a batch should free a meaningful total (≳ 15k tokens) to be worth the
  rewrite.
- **Verify the response.** It reports `freed ~N tokens`. If N is far below
  the sum of the folded ranges' `~tokens` estimates, something was
  mis-specified (in the session, a missing `to`; now, a `to` that is not the
  end you meant): re-map and refold from the bad fold's id.

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

## Follow-up session (next day, same conversation)

The conversation had grown to 169 roots; one two-item call freed 160.1k
(≈ 75k per item, so the per-item cache rewrite cost is real). One new
incident: the sibling-result overlap above — a range ended at one of two
`request_merge` results issued by the same assistant message, and the next
range started at the sibling; combining the two items into one range (user-id
start to later end) fixed it. Also confirmed again: a range `to` at an
assistant message is accepted, and a fold of a *custom* message (a system
notice) is a valid single-root fold.
