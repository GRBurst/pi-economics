// Member server probes (spec §5.2.6): /health = up, /slots?fail_on_no_slot=1 → 503 busy; 404/501 unknown = free.
export type Health = { up: boolean; busy: boolean };
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number }>;

/** Cached for `ttlMs` (default 30 s); each request times out after `timeoutMs` (default 5 s); errors count as down. */
function createProbe(d: { fetch: FetchLike; url: string; now: () => number; ttlMs?: number; timeoutMs?: number }): () => Promise<Health> {
  let cached: { at: number; value: Promise<Health> } | undefined;
  const status = async (path: string) => {
    try { return (await d.fetch(d.url + path, { signal: AbortSignal.timeout(d.timeoutMs ?? 5000) })).status; } catch { return 0; }
  };
  const probe = async (): Promise<Health> => {
    const up = (await status("/health")) === 200;
    return { up, busy: up && (await status("/slots?fail_on_no_slot=1")) === 503 };
  };
  return () => {
    if (!cached || d.now() - cached.at >= (d.ttlMs ?? 30_000)) cached = { at: d.now(), value: probe() };
    return cached.value;
  };
}

/** The probes of every member with a `health` URL: one cached `createProbe` per URL (T3.3). */
export function createProbes(d: { fetch: FetchLike; now: () => number; ttlMs?: number; timeoutMs?: number }): (url: string) => Promise<Health> {
  const probes = new Map<string, () => Promise<Health>>();
  return (url) => {
    if (!probes.has(url)) probes.set(url, createProbe({ ...d, url }));
    return probes.get(url)!();
  };
}
