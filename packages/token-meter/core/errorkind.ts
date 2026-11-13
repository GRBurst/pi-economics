// Pure: the semantic class of a failed request (meter line v2 `errorKind`, design §5.2); `errorClass` keeps the HTTP code.
// A context overflow is a failed turn (an outcome, design §7.5) and never a retry; pi does not retry it either.
export type ErrorKind = "context_overflow" | "rate_limit" | "other";

// Case-insensitive, first match. Rate limits first, as pi-ai's own overflow detection excludes them
// (utils/overflow.ts NON_OVERFLOW_PATTERNS): a throttling text may mention tokens or context.
const RATE_LIMIT = /rate.?limit|too many requests|quota|overloaded/i;
const CONTEXT_OVERFLOW =
  /prompt (is )?too long|request_too_large|context.?length|context_length_exceeded|maximum context|exceeds? the (available )?context|context (size|window)/i;

/** `status`: the HTTP status, or "error" when only the message is known (its leading 3-digit code counts as the status). */
export function errorKindOf(status: number | "error", message: string): ErrorKind {
  const code = typeof status === "number" ? status : Number(/^\s*(\d{3})(?!\d)/.exec(message)?.[1]);
  if (code === 429 || RATE_LIMIT.test(message)) return "rate_limit";
  if (CONTEXT_OVERFLOW.test(message)) return "context_overflow";
  return "other";
}
