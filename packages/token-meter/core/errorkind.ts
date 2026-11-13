// Pure: the semantic class of a failed request (meter line v2 `errorKind`, design §5.2); `errorClass` keeps the HTTP code.
// A context overflow is a failed turn (an outcome, design §7.5) and never a retry: pi compacts instead of retrying it,
// so the overflow decision is pi's own, mirrored verbatim below.
export type ErrorKind = "context_overflow" | "rate_limit" | "other";

// pi-ai 1.4.0 (@earendil-works/pi-ai, src/utils/overflow.ts; dist/utils/overflow.js of pi-coding-agent 1.4.0):
// OVERFLOW_PATTERNS, CEREBRAS_BODYLESS_OVERFLOW_PATTERN and NON_OVERFLOW_PATTERNS, verbatim. Update with pi.
const OVERFLOW_PATTERNS = [
  /prompt (?:is )?too long/i,
  /prompt exceeds max length/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /range of input length should be/i,
  /context[_ ]length[_ ]exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /^(?:[\w -]+ API error \(413\):|413(?:\s|:|$))/i,
];
const CEREBRAS_BODYLESS_OVERFLOW_PATTERN = /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i;
const NON_OVERFLOW_PATTERNS = [/^(Throttling error|Service unavailable):/i, /rate limit/i, /too many requests/i];

/** pi-ai's isContextOverflow for an error message (its first case; the silent overflows of a successful stop are no errors). */
function isContextOverflow(message: string, provider?: string): boolean {
  if (NON_OVERFLOW_PATTERNS.some((p) => p.test(message))) return false;
  return OVERFLOW_PATTERNS.some((p) => p.test(message)) ||
    (provider === "cerebras" && CEREBRAS_BODYLESS_OVERFLOW_PATTERN.test(message));
}

// The meter's own class (pi has none): a leading 429 (pi's error text starts with the status), or the throttling
// and rate-limit texts of NON_OVERFLOW_PATTERNS. Asked only after pi's overflow decision, which already excludes them.
const RATE_LIMIT = [/^\s*429(?!\d)/, /^Throttling error:/i, /rate.?limit/i, /too many requests/i];

/** `message`: the error message of the failed request; `provider`: its pi provider (pi-ai keys one rule on it). */
export function errorKindOf(message: string, provider?: string): ErrorKind {
  if (isContextOverflow(message, provider)) return "context_overflow";
  if (RATE_LIMIT.some((p) => p.test(message))) return "rate_limit";
  return "other";
}
