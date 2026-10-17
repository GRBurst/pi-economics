// Pure: maps anthropic-ratelimit-* response headers to quota fields.
export type Snapshot = { status: number; headers: Record<string, string>; at: number };
export type Quota = { q5h?: number; q5hReset?: string; q7d?: number; q7dReset?: string;
  overage?: string; claim?: string; fallback?: string; raw: Record<string, string> };

const PREFIX = "anthropic-ratelimit-";
const U = PREFIX + "unified-";
const NUM = /^\d+(\.\d+)?$/;

/** "0.09" → 9 (percent, 2 decimals); malformed → undefined. */
function percent(v: string | undefined): number | undefined {
  if (v === undefined || !NUM.test(v)) return undefined;
  const n = Number(v) * 100;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/** epoch seconds → ISO; malformed or out of range → undefined. */
function iso(v: string | undefined): string | undefined {
  if (v === undefined || !NUM.test(v)) return undefined;
  const d = new Date(Number(v) * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseRatelimit(h: Record<string, string>): Quota {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) {
    const key = String(k).toLowerCase();
    if (key.startsWith(PREFIX) && typeof v === "string") raw[key] = v;
  }
  const q: Quota = { raw };
  const set = <K extends keyof Quota>(k: K, v: Quota[K] | undefined) => {
    if (v !== undefined) q[k] = v;
  };
  set("q5h", percent(raw[U + "5h-utilization"]));
  set("q5hReset", iso(raw[U + "5h-reset"]));
  set("q7d", percent(raw[U + "7d-utilization"]));
  set("q7dReset", iso(raw[U + "7d-reset"]));
  set("overage", raw[U + "overage-status"]);
  set("claim", raw[U + "representative-claim"]);
  set("fallback", raw[U + "fallback-percentage"]);
  return q;
}
