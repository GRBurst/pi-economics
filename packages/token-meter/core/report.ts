// Pure aggregation + markdown rendering for the meter log (bin/meter-report.ts does the I/O).
export type Row = { key: string; requests: number; input: number; cacheRead: number; cacheWrite: number;
  output: number; costUsd: number; errors: number; warming: number; warmingCostUsd: number };
export type Regression =
  | { ok: true; hours: number; read: number; write: number; output: number }
  | { ok: false; hours: number };
export type Aggregate = { byDay: Row[]; bySession: Row[]; byModel: Row[]; total: Row; rewriteShare: number; regression: Regression };

const MIN_HOURS = 24;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const emptyRow = (key: string): Row => ({ key, requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
  costUsd: 0, errors: 0, warming: 0, warmingCostUsd: 0 });

function add(r: Row, l: any): void {
  if (l.kind === "warming") {
    r.warming += 1;
    r.warmingCostUsd += num(l.costUsd);
    return;
  }
  r.requests += 1;
  r.input += num(l.input);
  r.cacheRead += num(l.cacheRead);
  r.cacheWrite += num(l.cacheWrite);
  r.output += num(l.output);
  r.costUsd += num(l.costUsd);
  if (l.status === "error") r.errors += 1;
}

function group(lines: any[], keyOf: (l: any) => string): Row[] {
  const rows = new Map<string, Row>();
  for (const l of lines) {
    const k = keyOf(l);
    let r = rows.get(k);
    if (!r) rows.set(k, (r = emptyRow(k)));
    add(r, l);
  }
  return [...rows.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Lines are usable if they carry a string ts and sessionId; `from`/`to` are inclusive UTC days. */
export function aggregate(all: any[], range: { from?: string; to?: string } = {}): Aggregate {
  const lines = all
    .filter((l) => l && typeof l.ts === "string" && typeof l.sessionId === "string")
    .filter((l) => (range.from === undefined || l.ts.slice(0, 10) >= range.from) && (range.to === undefined || l.ts.slice(0, 10) <= range.to))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const total = emptyRow("total");
  for (const l of lines) add(total, l);

  // rewrite share: cacheWrite of every request but a session's first, over all cacheWrite
  const seen = new Set<string>();
  let after = 0;
  for (const l of lines) {
    if (l.kind === "warming") continue;
    if (seen.has(l.sessionId)) after += num(l.cacheWrite);
    else seen.add(l.sessionId);
  }
  return {
    byDay: group(lines, (l) => l.ts.slice(0, 10)),
    bySession: group(lines, (l) => l.sessionId),
    byModel: group(lines, (l) => String(l.model)),
    total,
    rewriteShare: total.cacheWrite > 0 ? after / total.cacheWrite : 0,
    regression: quotaRegression(lines),
  };
}

/**
 * Least squares (no intercept) of the hourly 5h-quota increase (percentage points) on the hour's
 * cacheRead / cacheWrite / output tokens. An hour is usable with ≥ 2 q5h samples in one quota window.
 * Needs ≥ 24 usable hours.
 */
export function quotaRegression(all: any[]): Regression {
  const hours = new Map<string, any[]>();
  for (const l of all) {
    if (!l || typeof l.ts !== "string") continue;
    const h = l.ts.slice(0, 13);
    hours.set(h, [...(hours.get(h) ?? []), l]);
  }
  const X: number[][] = [];
  const y: number[] = [];
  for (const ls of hours.values()) {
    ls.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const qs = ls.filter((l) => typeof l.q5h === "number");
    if (qs.length < 2 || qs.some((l) => l.q5hReset !== qs[0].q5hReset)) continue;
    const req = ls.filter((l) => l.kind !== "warming");
    X.push([0, 1, 2].map((i) => req.reduce((s, l) => s + num(l[["cacheRead", "cacheWrite", "output"][i]]), 0)));
    y.push(qs[qs.length - 1].q5h - qs[0].q5h);
  }
  if (X.length < MIN_HOURS) return { ok: false, hours: X.length };
  // normal equations A b = c, solved by Gaussian elimination with partial pivoting
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, r) => s + r[i] * r[j], 0)).concat(X.reduce((s, r, k) => s + r[i] * y[k], 0)));
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return { ok: false, hours: X.length };
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  return { ok: true, hours: X.length, read: A[0][3] / A[0][0], write: A[1][3] / A[1][1], output: A[2][3] / A[2][2] };
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(4));

function table(title: string, rows: Row[]): string {
  const head = `| ${title} | requests | input | cacheRead | cacheWrite | output | costUsd | errors | warming | warmingCostUsd |`;
  const sep = "|" + " --- |".repeat(10);
  const body = rows.map((r) => `| ${r.key} | ${[r.requests, r.input, r.cacheRead, r.cacheWrite, r.output, r.costUsd, r.errors, r.warming, r.warmingCostUsd].map(fmt).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

export function render(a: Aggregate): string {
  const reg = a.regression;
  const regLine = reg.ok
    ? `quota regression: ${reg.hours} h; 5h-quota points per 1M tokens: cacheRead ${(reg.read * 1e6).toFixed(2)}, cacheWrite ${(reg.write * 1e6).toFixed(2)}, output ${(reg.output * 1e6).toFixed(2)}`
    : `quota regression: insufficient data (${reg.hours} h)`;
  return [
    "## Per day", table("day", a.byDay),
    "## Per session", table("session", a.bySession),
    "## Per model", table("model", a.byModel),
    "## Total", table("all", [a.total]),
    `rewrite share: ${(a.rewriteShare * 100).toFixed(1)}%`,
    regLine,
  ].join("\n\n") + "\n";
}
