// The router's golden decisions (spec §6.3): R''s planSpawn over the golden grid (test/golden/grid.ts) and the selection's
// 96 states through resolveLeg (`select` lines, picks by member), under two settings: R''s defaults and EMPTY_SLOT (every
// member's model set, the free cloud empty). Usage: node --experimental-strip-types generate.ts <task-router dir>  > decisions (stdout).
// Run by hand once on a host checkout at R' (header added by the caller); checks/router-golden runs it on packages/task-router.
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? ".");
const grid = await import(join(dir, "test/golden/grid.ts"));
const { sutSpawn } = await import(join(dir, "test/golden/sut.ts"));
const { parseSettings } = await import(join(dir, "core/settings.ts"));
const { resolveLeg } = await import(join(dir, "core/policy.ts"));

/** Every member's model set to a neutral name, the free cloud empty (spec §6.1 P1, P2). */
export const EMPTY_SLOT = {
  models: {
    "qwen-local": { model: "local/qwen", health: "http://local.invalid:11545" },
    "qwen-cloud": { model: "" },
    haiku: { model: "api/haiku" },
    sonnet: { model: "api/sonnet" },
    opus: { model: "api/opus" },
  },
};
const FIXTURES: [string, Record<string, unknown>][] = [["defaults", {}], ["empty-slot", EMPTY_SLOT]];
const out: string[] = [];
const id = (n: number, w: number) => n.toString(36).padStart(w, "0");

/** Interns rows of labels; grid lines carry one id per t0 vector (64), rows are listed after their grid. */
function section(name: string, lines: [string, string[]][]): void {
  const rows = new Map<string, number>();
  for (const [, rs] of lines) for (const r of rs) if (!rows.has(r)) rows.set(r, rows.size);
  const w = Math.max(1, Math.ceil(Math.log(rows.size + 1) / Math.log(36)));
  for (const [key, rs] of lines) out.push(`${name} ${key} ${rs.map((r) => id(rows.get(r)!, w)).join("")}`);
  for (const [r, n] of rows) out.push(`${name}-row ${id(n, w)} ${r}`);
}

for (const [fx, raw] of FIXTURES) {
  const cache = new Map<string, unknown>();
  const settings = (v: { name: string; profiles: object }, rnd: boolean) => {
    const k = `${v.name} ${rnd}`;
    if (!cache.has(k)) cache.set(k, parseSettings({ ...structuredClone(raw), profiles: v.profiles, randomize: { enabled: rnd, share: 0.5 } }).settings);
    return cache.get(k);
  };
  const model = (m: string | undefined) => (fx === "defaults" || m === undefined ? m : ({ [grid.MODELS.local]: "local/qwen", [grid.MODELS.haiku]: "api/haiku", [grid.MODELS.sonnet]: "api/sonnet", [grid.MODELS.opus]: "api/opus" } as Record<string, string>)[m] ?? m);
  const plan: [string, string[]][] = [], expl: [string, string[]][] = [];
  let nPlan = 0, nExpl = 0;
  for (const v of grid.VARIANTS) {
    const byKey = new Map<string, { p: string[]; e: string[] }>();
    for (const f of grid.firsts(v)) {
      const key = `${fx} ${v.name} ${f.kind} ${f.t2m} ${f.imp}`;
      if (!byKey.has(key)) byKey.set(key, { p: [], e: [] });
      const row = byKey.get(key)!;
      const p: string[] = [];
      for (const rnd of grid.RNDS) for (const seq of grid.SEQS) {
        nPlan++;
        const ctx = { settings: settings(v, rnd !== "off"), attempts: new Map() };
        p.push([...grid.spawns({ ...f, rnd, seq })].map((sp: { id: string; attemptOf?: string; t2: boolean }) => sutSpawn(ctx, { taskId: sp.id, kind: f.kind, t0: f.t0, t2: sp.t2, force: f.t2m === "force", need: 0, imp: f.imp, draw: rnd === "hit", ...(sp.attemptOf ? { attemptOf: sp.attemptOf } : {}) }).label).join(" | "));
      }
      row.p.push(p.join(" ; "));
      const e: string[] = [];
      for (const m of grid.MODS) for (const ef of grid.EFFS) {
        nExpl++;
        const ctx = { settings: settings(v, false), attempts: new Map() };
        const mm = model(m);
        e.push(sutSpawn(ctx, { taskId: "t0", kind: f.kind, t0: f.t0, t2: f.t2m === "t2", force: f.t2m === "force", need: 0, imp: f.imp, draw: false, ...(mm !== undefined ? { model: mm } : {}), ...(ef !== undefined ? { effort: ef } : {}) }).start ?? "REJECT");
      }
      row.e.push(e.join(" "));
    }
    for (const [k, r] of byKey) { plan.push([k, r.p]); expl.push([k, r.e]); }
  }
  out.push(`count ${fx} plan ${nPlan} explicit ${nExpl}`);
  section("plan", plan);
  section("explicit", expl);
  // The selection: 4 local × 4 cloud running × 3 cloud states × {before, after the queue deadline}. Picks name the member.
  const s = parseSettings(structuredClone(raw)).settings;
  const NOW = 1_000_000;
  class Wait extends Error {}
  const memberOf = (model: string): string =>
    Object.entries(s.models).find(([, m]: [string, any]) => m.model === model)?.[0] ?? `?${model}`;
  for (const local of ["up", "busy", "own", "down"]) for (const cr of [0, 1, 2, 3]) for (const cloud of ["open", "blocked", "capped"]) {
    const picks: string[] = [];
    for (const expired of [false, true]) {
      const children = new Map<string, unknown>();
      const add = (route: string, n: number) => { for (let i = 0; i < n; i++) children.set(`${route}${i}`, { route, at: NOW }); };
      add("local", local === "own" ? 1 : 0); add("cloud", cr);
      let now = NOW;
      const cap = s.models["qwen-cloud"].dailyCap ?? 0;
      const d = {
        settings: s, children, now: () => now,
        api: () => ({ list: () => [...children.keys()].map((name) => ({ name, state: "running" })) }),
        probe: async () => ({ up: local === "up" || local === "own", busy: local === "busy" }),
        cloud: { today: () => (cloud === "capped" ? cap : 0), blockedUntil: () => (cloud === "blocked" ? NOW + 1 : undefined), block() {} },
        sleep: async (ms: number) => { if (!expired) throw new Wait(); now += ms + s.queueMaxSec * 1000; },
      };
      try { const r = await resolveLeg(d, { tier: "qwen", effort: "xhigh" }); picks.push(`${memberOf(r.model)}:${r.model}:${r.effort}`); }
      catch (e) { if (e instanceof Wait) picks.push("wait"); else throw e; }
    }
    out.push(`select ${fx} local=${local} cloudRunning=${cr} cloud=${cloud} ${picks.join(" ")}`);
  }
}
process.stdout.write(out.join("\n") + "\n");
