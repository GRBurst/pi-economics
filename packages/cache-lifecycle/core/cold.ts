// Prompt-cache expiry: a cache written at `lastRequestAt` is gone `ttlMs` later.

/** True when the cache of the last request has expired. Never requested (fresh or resumed session) counts as cold. */
export function isCold(lastRequestAt: number | undefined, now: number, ttlMs: number): boolean {
  return lastRequestAt === undefined || now - lastRequestAt >= ttlMs;
}
