// Per-arm analysis of the meter log for the experiments package (spec §5.6.2, §5.6.3). Pure; bin/meter-report.ts does the I/O.
// Unit of analysis = one root session (a main session with all its children), the random effect of the design.
export type Ev = { n: number; meanCost: number };
export type ArmStat = { arm: string; units: number; costUsd: number; activeHours: number; costPerHour: number;
  ci: [number, number]; sd: number; coldResume: Ev; fold: Ev;
  /** Account quota used per active hour (percentage points of the 5 h / 7 d window; 1 % steps), NaN without readings. */
  q5hPerHour: number; q7dPerHour: number };

const MIN = 60_000;
const IDLE_MS = 30 * MIN; // a gap longer than this is idle, not activity
export const MIN_HOURS = 0.05; // units with less activity make $/h meaningless
const N_AFTER = 3; // requests whose cost an event is charged with
const FOLD_SHRINK = 0.8; // a warm turn whose context fell below this share of the previous one is a fold
const BOOT = 1000;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ctx = (l: any): number => num(l.input) + num(l.cacheRead) + num(l.cacheWrite);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Unit = { cost: number; hours: number; q5h?: number; q7d?: number };
const rate = (us: Unit[]): number => us.reduce((s, u) => s + u.cost, 0) / us.reduce((s, u) => s + u.hours, 0);

/** Percentile bootstrap (resampling units, fixed seed) of the ratio of sums. */
function bootstrap(us: Unit[]): { ci: [number, number]; sd: number } {
  const rng = mulberry32(1);
  const draws = Array.from({ length: BOOT }, () => rate(us.map(() => us[Math.floor(rng() * us.length)]))).sort((a, b) => a - b);
  const mean = draws.reduce((s, x) => s + x, 0) / BOOT;
  return { ci: [draws[Math.floor(0.025 * BOOT)], draws[Math.floor(0.975 * BOOT) - 1]], sd: Math.sqrt(draws.reduce((s, x) => s + (x - mean) ** 2, 0) / BOOT) };
}

/** Quota attributed to every root, and the global rise it was split from. */
export type QuotaAttribution = { total: number; perRoot: Map<string, number> };
export type QuotaKey = "q5h" | "q7d";
const rootOf = (l: any): string => l.parentSessionId ?? l.sessionId;

/**
 * The account's quota is shared by every session, so it is attributed once, from one global timeline, never per root: the non-warming
 * requests of all roots sorted by time; each rise between consecutive readings (same reset window, less than 30 min apart) is split
 * between the roots that made requests in (previous reading, this reading], proportional to their costUsd there (equally when all
 * cost 0). Σ over roots = `total` = the rise of the account seen between pi requests.
 * A rise is measured against the window's running maximum, not the previous reading: parallel sessions log interleaved, slightly stale
 * readings (4, 5, 4, 5 is one point). Warming requests are not activity. A root without readings is in the map only if it made requests
 * while the quota rose.
 */
export function attributeQuota(all: any[], key: QuotaKey): QuotaAttribution {
  const t = (l: any): number => Date.parse(l.ts);
  const reqs = all.filter((l) => l && typeof l.ts === "string" && !Number.isNaN(t(l)) && typeof l.sessionId === "string" && l.kind !== "warming").sort((a, b) => t(a) - t(b));
  const perRoot = new Map<string, number>();
  const top = new Map<unknown, number>(); // reset window → highest reading so far
  let total = 0;
  let prev = -1; // index of the previous reading
  reqs.forEach((l, i) => {
    if (typeof l[key] !== "number" || !Number.isFinite(l[key])) return;
    const reset = l[`${key}Reset`];
    const seen = top.get(reset);
    const p = reqs[prev];
    const step = seen !== undefined && p && p[`${key}Reset`] === reset && t(l) - t(p) < IDLE_MS ? Math.max(0, l[key] - seen) : 0;
    if (step > 0) {
      let lo = prev + 1, hi = i;
      while (lo < reqs.length && t(reqs[lo]) <= t(p)) lo++; // requests at the previous reading's instant came before it
      while (hi + 1 < reqs.length && t(reqs[hi + 1]) <= t(l)) hi++; // and those at this instant belong to it
      if (lo > hi) for (lo = i; lo > 0 && t(reqs[lo - 1]) >= t(l); lo--); // both readings at one instant: that instant
      const cost = new Map<string, number>();
      for (const x of reqs.slice(lo, hi + 1)) cost.set(rootOf(x), (cost.get(rootOf(x)) ?? 0) + Math.max(0, num(x.costUsd)));
      const paid = [...cost.values()].reduce((s, c) => s + c, 0);
      for (const [root, c] of cost) perRoot.set(root, (perRoot.get(root) ?? 0) + step * (paid > 0 ? c / paid : 1 / cost.size));
      total += step;
    }
    top.set(reset, Math.max(seen ?? -Infinity, l[key]));
    prev = i;
  });
  return { total, perRoot };
}

/** Both windows' attribution of `lines` (compute it over EVERY line, not one arm's: the quota is account-wide). */
export const quotaAttribution = (lines: any[]): Record<QuotaKey, QuotaAttribution> => ({ q5h: attributeQuota(lines, "q5h"), q7d: attributeQuota(lines, "q7d") });
const perHour = (us: Unit[], key: "q5h" | "q7d"): number => {
  const m = us.filter((u) => u[key] !== undefined);
  return m.length ? m.reduce((s, u) => s + u[key]!, 0) / m.reduce((s, u) => s + u.hours, 0) : NaN;
};

/** A root session (a main session with all its children): cost incl. warming, active hours (gaps between non-warming requests under 30 min), quota points used. */
export type RootUnit = { root: string; arm: string; cost: number; hours: number; q5h?: number; q7d?: number };

/**
 * One unit per root (parentSessionId ?? sessionId) of the lines with a string ts and sessionId; `arm` is the first line's ("" without).
 * `q5h`/`q7d` = the root's share of the account's quota (attributeQuota) over `quota` (default: attributed over `all`); undefined when
 * the root has no reading and made no request while the quota rose.
 */
export function rootUnits(all: any[], quota: Record<QuotaKey, QuotaAttribution> = quotaAttribution(all)): RootUnit[] {
  const t = (l: any): number => Date.parse(l.ts);
  const lines = all.filter((l) => l && typeof l.ts === "string" && !Number.isNaN(t(l)) && typeof l.sessionId === "string").sort((a, b) => t(a) - t(b));
  const groups = new Map<string, any[]>();
  for (const l of lines) { const k = l.parentSessionId ?? l.sessionId; groups.set(k, [...(groups.get(k) ?? []), l]); }
  return [...groups].map(([root, us]) => {
    const share = (turns: any[], key: QuotaKey): number | undefined =>
      turns.some((l) => typeof l[key] === "number") || quota[key].perRoot.has(root) ? quota[key].perRoot.get(root) ?? 0 : undefined;
    const turns = us.filter((l) => l.kind !== "warming");
    const hours = turns.reduce((s, l, i) => s + (i && t(l) - t(turns[i - 1]) < IDLE_MS ? t(l) - t(turns[i - 1]) : 0), 0) / (60 * MIN);
    return { root, arm: typeof us[0].arm === "string" ? us[0].arm : "", cost: us.reduce((s, l) => s + num(l.costUsd), 0), hours, q5h: share(turns, "q5h"), q7d: share(turns, "q7d") };
  });
}

const ev = (costs: number[]): Ev => ({ n: costs.length, meanCost: costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : 0 });

/** `flags`: arm id → factor values (assignments.jsonl); only `mainCacheTtl` is read, for the cold-resume TTL of main sessions. `quota`: attribution over all lines, when `all` is a subset (an arm, a design). */
export function armStats(all: any[], opt: { flags?: Record<string, Record<string, string>>; quota?: Record<QuotaKey, QuotaAttribution> } = {}): ArmStat[] {
  const quota = opt.quota ?? quotaAttribution(all); // over every line, before the arm filter
  const t = (l: any): number => Date.parse(l.ts);
  const lines = all.filter((l) => l && typeof l.ts === "string" && !Number.isNaN(t(l)) && typeof l.sessionId === "string" && typeof l.arm === "string" && l.arm).sort((a, b) => t(a) - t(b));
  const group = <K>(key: (l: any) => K): Map<K, any[]> => lines.reduce((m, l) => m.set(key(l), [...(m.get(key(l)) ?? []), l]), new Map<K, any[]>());
  const arms = new Map<string, { units: Unit[]; cost: number; cold: number[]; fold: number[] }>();
  const slot = (arm: string) => arms.get(arm) ?? arms.set(arm, { units: [], cost: 0, cold: [], fold: [] }).get(arm)!;

  for (const u of rootUnits(lines, quota)) {
    const a = slot(u.arm);
    a.cost += u.cost;
    if (u.hours >= MIN_HOURS) a.units.push({ cost: u.cost, hours: u.hours, q5h: u.q5h, q7d: u.q7d });
  }
  for (const ss of group((l) => l.sessionId).values()) {
    const ttl = (ss[0].parentSessionId === undefined && opt.flags?.[ss[0].arm]?.mainCacheTtl === "1h" ? 60 : 5) * MIN;
    const turns = ss.filter((l) => l.kind !== "warming");
    turns.forEach((l, i) => {
      const prev = ss[ss.indexOf(l) - 1];
      const window = turns.slice(i, i + N_AFTER);
      if (!prev || window.length < N_AFTER) return;
      const cost = window.reduce((s, x) => s + num(x.costUsd), 0);
      if (t(l) - t(prev) >= ttl) slot(l.arm).cold.push(cost);
      else if (i && ctx(l) < FOLD_SHRINK * ctx(turns[i - 1])) slot(l.arm).fold.push(cost);
    });
  }
  return [...arms].sort(([a], [b]) => (a < b ? -1 : 1)).map(([arm, a]) => {
    const costPerHour = a.units.length ? rate(a.units) : NaN;
    const b = a.units.length > 1 ? bootstrap(a.units) : { ci: [costPerHour, costPerHour] as [number, number], sd: 0 };
    return { arm, units: a.units.length, costUsd: a.cost, activeHours: a.units.reduce((s, u) => s + u.hours, 0), costPerHour, ...b, coldResume: ev(a.cold), fold: ev(a.fold), q5hPerHour: perHour(a.units, "q5h"), q7dPerHour: perHour(a.units, "q7d") };
  });
}

/** State.posterior for the experiments package: `mean` is a REWARD (assign takes the argmax), so −$ per active hour. */
export function posterior(stats: ArmStat[]): Record<string, { mean: number; sd: number }> {
  return Object.fromEntries(stats.filter((s) => s.units >= 2).map((s) => [s.arm, { mean: -s.costPerHour, sd: s.sd }]));
}

const f2 = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : "–");
const evs = (e: Ev): string => (e.n ? `${f2(e.meanCost)} (${e.n})` : "–");

type Acc = Record<string, { accepted: number; judged: number }>;
type Sig = Record<string, { peeks: number; corrections: number; ratings: number[] }>;

/** One column per entry; quota is the account's, in 1 % steps (coarse for short units); the guards columns come from guards/events.jsonl (per unit; rating = mean). */
export function renderArms(stats: ArmStat[], acc: Acc, reasons: Record<string, string>, sig: Sig = {}, perTask: Record<string, { perAccepted: number }> = {}): string {
  const per = (s: ArmStat, k: "peeks" | "corrections") => (s.units ? f2((sig[s.arm]?.[k] ?? 0) / s.units) : "–");
  const rating = (s: ArmStat) => { const r = sig[s.arm]?.ratings ?? []; return r.length ? (r.reduce((x, y) => x + y, 0) / r.length).toFixed(1) : "–"; };
  const cols: Array<[string, (s: ArmStat) => string]> = [
    ["arm", (s) => s.arm], ["units", (s) => String(s.units)], ["active h", (s) => f2(s.activeHours)], ["costUsd", (s) => f2(s.costUsd)], ["$/h", (s) => f2(s.costPerHour)],
    ["95% CI", (s) => `${f2(s.ci[0])} – ${f2(s.ci[1])}`], ["cold resume $ (n)", (s) => evs(s.coldResume)], ["fold $ (n)", (s) => evs(s.fold)],
    ["accepted", (s) => (acc[s.arm] ? `${acc[s.arm].accepted}/${acc[s.arm].judged}` : "–")],
    ["$/accepted task", (s) => f2(perTask[s.arm]?.perAccepted ?? NaN)], ["q5h %/h", (s) => f2(s.q5hPerHour)], ["q7d %/h", (s) => f2(s.q7dPerHour)],
    ["peeks/s", (s) => per(s, "peeks")], ["corr/s", (s) => per(s, "corrections")], ["rating", rating],
  ];
  const rows = stats.map((s) => `| ${cols.map(([, f]) => f(s)).join(" | ")} |`);
  return [`| ${cols.map(([h]) => h).join(" | ")} |`, "|" + " --- |".repeat(cols.length), ...rows, ...Object.entries(reasons).map(([a, r]) => `\ndisabled ${a}: ${r}`)].join("\n") + "\n";
}

/** The experiments package's state.json: fresh posterior; disabled arms stay disabled (re-enable by editing the file). */
export function nextState(old: any, stats: ArmStat[], reasons: Record<string, string>): { disabled: string[]; posterior: ReturnType<typeof posterior>; reasons: Record<string, string> } {
  const kept = Array.isArray(old?.disabled) ? old.disabled.filter((x: unknown) => typeof x === "string") : [];
  return { disabled: [...new Set([...kept, ...Object.keys(reasons)])], posterior: posterior(stats), reasons: { ...(old?.reasons ?? {}), ...reasons } };
}
