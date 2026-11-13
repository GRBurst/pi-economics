import { test } from "node:test";
import assert from "node:assert/strict";
import { errorKindOf } from "../core/errorkind.ts";

// Error messages as pi 1.4 hands them to message_end (SDK error text: status, then the provider's body).
const ANTHROPIC_OVERFLOW = '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 213462 tokens > 200000 maximum"},"request_id":"req_x"}';
const LLAMA_OVERFLOW = "400 the request exceeds the available context size, try increasing it";

test("errorKindOf: context overflow (Anthropic 400, llama.cpp, OpenAI-style, Anthropic 413)", () => {
  for (const m of [ANTHROPIC_OVERFLOW, LLAMA_OVERFLOW,
    "400 This model's maximum context length is 131072 tokens. However, you requested 140000 tokens.",
    '400 {"error":{"code":"context_length_exceeded"}}', "Your input exceeds the context window of this model",
    '413 {"type":"error","error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
    "Prompt too long", "PROMPT IS TOO LONG"]) assert.equal(errorKindOf("error", m), "context_overflow", m);
});

test("errorKindOf: rate limit by status 429 (given or the message's leading code) or by text; it wins over overflow words", () => {
  assert.equal(errorKindOf(429, ""), "rate_limit");
  for (const m of ['429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}',
    '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', "Rate limit reached", "You exceeded your current quota",
    "Too Many Requests", "429: daily cap", "429 your context window rate"]) assert.equal(errorKindOf("error", m), "rate_limit", m);
});

test("errorKindOf: anything else is other", () => {
  for (const m of ["500 Internal server error", "terminated", "", "fetch failed", "4290 tokens", "context"]) assert.equal(errorKindOf("error", m), "other", m);
  assert.equal(errorKindOf(500, "boom"), "other");
});
