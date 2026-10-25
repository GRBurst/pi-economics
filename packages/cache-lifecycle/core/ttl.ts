// Cache TTL: every cache_control breakpoint of a request payload gets the same ttl
// (Anthropic requires longer-lived breakpoints to precede shorter ones, so all or none).

/** Copy of `payload` with `cache_control.ttl = ttl` wherever a breakpoint is set. */
export function applyTtl(payload: unknown, ttl: "5m" | "1h"): unknown {
  if (Array.isArray(payload)) return payload.map((v) => applyTtl(v, ttl));
  if (payload === null || typeof payload !== "object") return payload;
  return Object.fromEntries(
    Object.entries(payload).map(([k, v]) => [k, k === "cache_control" && v !== null && typeof v === "object" ? { ...v, ttl } : applyTtl(v, ttl)]),
  );
}
