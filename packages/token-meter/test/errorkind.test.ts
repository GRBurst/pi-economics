import { test } from "node:test";
import assert from "node:assert/strict";
import { errorKindOf } from "../core/errorkind.ts";

// Error messages as pi 1.4 hands them to message_end (SDK error text: status, then the provider's body).
// `context_overflow` must equal pi-ai 1.4's isContextOverflow: pi compacts instead of retrying exactly then.
const TABLE: [message: string, kind: string, provider?: string][] = [
  // overflow, one per provider family pi-ai names
  ['400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 213462 tokens > 200000 maximum"}}', "context_overflow"],
  ['413 {"type":"error","error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}', "context_overflow"],
  ["413", "context_overflow"],
  ["Mistral API error (413): payload too large", "context_overflow"],
  ["400 the request exceeds the available context size, try increasing it", "context_overflow"],
  ["Your input exceeds the context window of this model", "context_overflow"],
  ["400 This model's maximum context length is 131072 tokens. However, you requested 140000 tokens.", "context_overflow"],
  ['400 {"error":{"code":"context_length_exceeded"}}', "context_overflow"],
  ["input is too long for requested model", "context_overflow"],
  ["Please reduce the length of the messages or completion", "context_overflow"],
  ["prompt token count of 140000 exceeds the limit of 128000", "context_overflow"],
  ["too many tokens", "context_overflow"],
  ["token limit exceeded", "context_overflow"],
  ["Prompt too long", "context_overflow"],
  ["PROMPT IS TOO LONG", "context_overflow"],
  ["400 status code (no body)", "context_overflow", "cerebras"],
  // pi-ai's NON_OVERFLOW_PATTERNS come first: throttling and rate-limit texts are never an overflow
  ["Throttling error: Too many tokens, please wait before trying again.", "rate_limit"],
  ["Too many requests: too many tokens", "rate_limit"],
  ["Rate limit reached: token limit exceeded", "rate_limit"],
  ["Service unavailable: prompt is too long", "other"],
  // rate limit: a leading 429 or the rate-limit texts
  ['429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}', "rate_limit"],
  ["429: daily cap", "rate_limit"],
  ["429 your context window rate", "rate_limit"],
  ["429 You exceeded your current quota", "rate_limit"],
  ["Too Many Requests", "rate_limit"],
  // broader words pi does not take as overflow or as a rate limit
  ['529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', "other"],
  ["Your context window is 200000 tokens", "other"],
  ["context size", "other"],
  ["maximum context", "other"],
  ["You exceeded your current quota", "other"],
  ["400 status code (no body)", "other"],
  ["500 Internal server error", "other"],
  ["terminated", "other"],
  ["", "other"],
  ["fetch failed", "other"],
  ["4290 tokens", "other"],
];

test("errorKindOf: pi-ai 1.4's overflow decision (NON_OVERFLOW first), then rate limits, else other", () => {
  for (const [m, kind, provider] of TABLE) assert.equal(errorKindOf(m, provider), kind, `${provider ?? ""} ${m}`);
});
