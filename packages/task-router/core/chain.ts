// Qwen chain (spec §5.2.6, Decision 5): free cloud → local → cloud; caps 1 local + 2 cloud (3 cloud without local).
export type ChainState = {
  localRunning: number; cloudRunning: number; localAvailable: boolean;
  cloudToday: number; cloudDailyCap: number; cloudBlockedUntil?: number; now: number;
};
export type QwenPick = { route: "cloud" | "local" } | { route: "wait" } | { route: "sonnet"; reason: string };

export function pickQwen(s: ChainState): QwenPick {
  const localFree = s.localAvailable && s.localRunning === 0;
  const blocked = s.cloudBlockedUntil !== undefined && s.now < s.cloudBlockedUntil;
  if (blocked || s.cloudToday >= s.cloudDailyCap) {
    if (localFree) return { route: "local" };
    return { route: "sonnet", reason: blocked ? "free cloud blocked until its daily reset; local not free" : `cloud daily cap ${s.cloudDailyCap} reached; local not free` };
  }
  if (s.cloudRunning === 0) return { route: "cloud" };
  if (localFree) return { route: "local" };
  return s.cloudRunning < 2 + (s.localAvailable ? 0 : 1) ? { route: "cloud" } : { route: "wait" };
}

const DAY_MS = 86_400_000;

/** OpenRouter free-tier daily cap in an error text → when it lifts; ordinary 429s → null (pi-retry keeps retrying). */
export function freeCapHit(errorMessage: string, now: number): { until: number } | null {
  if (!/free-models-per-day|openrouter_free_tier_daily/.test(errorMessage)) return null;
  const reset = Number(/"X-RateLimit-Reset"\s*:\s*"?(\d+)/i.exec(errorMessage)?.[1]);
  return { until: reset > now ? reset : (Math.floor(now / DAY_MS) + 1) * DAY_MS };
}
