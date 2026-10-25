// The free tier's daily cap (spec §4.8, §4.9): OpenRouter's error text and when the cap lifts. Pure.

/** The provider whose error text `freeCapHit` matches: a fact of the pattern, not a setting. */
export const FREE_CAP_PROVIDER = "openrouter";

const DAY_MS = 86_400_000;

/** OpenRouter free-tier daily cap in an error text → when it lifts; ordinary 429s → null (pi-retry keeps retrying). */
export function freeCapHit(errorMessage: string, now: number): { until: number } | null {
  if (!/free-models-per-day|openrouter_free_tier_daily/.test(errorMessage)) return null;
  const reset = Number(/"X-RateLimit-Reset"\s*:\s*"?(\d+)/i.exec(errorMessage)?.[1]);
  return { until: reset > now ? reset : (Math.floor(now / DAY_MS) + 1) * DAY_MS };
}
