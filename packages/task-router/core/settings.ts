// Settings live in <agentDir>/task-router/settings.json. Every key has a
// default, so the extension runs with no file at all (plain `pi install`).
import { readFileSync } from "node:fs";
import { EFFORTS, effortRank, enabled } from "./members.ts";
import type { Cell, Member, Profile, Rows, RouterSettings } from "./types.ts";

export type Settings = RouterSettings;

/** Built-in profiles (spec §4.3): the requirement each kind carries. */
export const BUILTIN_PROFILES: Record<string, Profile> = {
  scout: { ability: "read", minLevel: 2, tools: "read-only", skills: [], report: "answer" },
  mechanical: { tools: "all", skills: [], report: "default" },
  implement: { tools: "all", skills: [], report: "default" },
  "debug-design": { minLevel: 1, tools: "all", skills: ["systematic-debugging"], report: "default" },
  review: { ability: "read", table: "review", minLevel: 2, tools: "read-only", skills: ["code-reviewer"], report: "review" },
  plan: { level: "top", tools: "read-only+files", skills: ["tdd-implementation-planner"], report: "plan" },
};

export function defaults(): Settings {
  return {
    // T0.3 pilot: Qwen xhigh passed 13–14-file mechanical changes; it failed on
    // long-horizon cross-module work (peak ≥ 200k), not on file count.
    t0Limits: { files: 10, tokens: 150000 },
    // Members (spec §4.2); `model: ""` = the member does not exist. Windows in tokens (Qwen 262K; Sonnet/Opus assumed 1M).
    // Cloud `order: -1`: the free cloud sorts before local at equal cost (today's chain, spec §5.3).
    models: {
      "qwen-local": {
        model: "llama/qwen3.8", tier: "qwen", route: "local", abilities: { write: 0, read: 0 }, efforts: ["xhigh"],
        contextWindow: 262144, cost: 0, order: 0, slots: 1, health: "http://earth:11545",
      },
      "qwen-cloud": {
        // D3 (spec §4.9, MP2): the free cloud slot is empty by default; a file that sets its model makes it an ordinary
        // member after local (order 1). The rollback (test/fixtures/today-config.json) names the free model, order −1.
        model: "", tier: "qwen", route: "cloud", abilities: { write: 0, read: 0 }, efforts: ["xhigh"],
        contextWindow: 262144, cost: 0, order: 1, slots: 2, dailyCap: 950,
      },
      haiku: { model: "", tier: "haiku", route: "haiku", abilities: { write: 0, read: 1 }, efforts: ["medium", "high"], contextWindow: 1000000, cost: 1, order: 0 },
      sonnet: { model: "anthropic/claude-sonnet-5-5", tier: "T1", route: "T1", abilities: { write: 1, read: 2 }, efforts: ["high", "xhigh"], contextWindow: 1000000, cost: 3, order: 0 },
      opus: { model: "anthropic/claude-opus-5-5", tier: "T2", route: "T2", abilities: { write: 2, read: 3 }, efforts: ["high", "xhigh"], contextWindow: 1000000, cost: 5, order: 0 },
    },
    // Today's tier table per write level (spec §4.4): level 0 = Qwen, 1 = T1, 2 = T2; read rows per level of the read scale.
    importanceTable: {
      write: {
        "0": row(C(0, 0), C(0, 0, 1, 0), C(1, 0, 2, 0)),
        "1": row(C(1, 0), C(1, 1), C(2, 1)),
        "2": row(C(2, 0), C(2, 1), C(2, 1, 2, 1)),
      },
      read: readRows(C(2, 1)), // D12 (OD13): a critical read-2 task runs at W2
      review: readRows(C(3, 1)), // a review keeps today's row 2 critical (spec §4.4)
    },
    readOnlyReview: "effort-step", // D1 (RD4): a read-only profile at critical raises its worker instead of a review
    contextFit: 0,
    queueMaxSec: 120,
    checkTimeoutSec: 900,
    runaway: { requests: 150, usd: 10 },
    contextGuard: 0.5,
    freshOnCold: { mode: "advise", minTokens: 150000 },
    maxBurstTurns: 1,
    riskGlobs: ["**/auth/**", "**/*crypt*", "**/*migrat*", "**/secrets/**"],
    // Case-insensitive substrings of file names, check and acceptance text.
    // riskKeywords only clear lowRisk; a t2Keywords match also forces T2.
    riskKeywords: ["password", "credential", "secret", "migrat", "encrypt", "sudo", "production", "deploy", "delete"],
    t2Keywords: {
      security: ["authentication", "authorization", "privilege escalation", "sandbox escape", "csrf", "xss", "sql injection"],
      concurrency: ["race condition", "deadlock", "mutex", "thread-safe"],
      "migration-destructive": ["drop table", "rm -rf", "force push", "irreversible", "destructive"],
      "repo-wide": ["repo-wide", "repository-wide", "whole repo", "every file", "all files"],
      "interface-change": ["breaking change", "public api", "schema change"],
      "unknown-root-cause": ["unknown root cause", "root cause unknown"],
      "open-design": ["open design question"],
    },
    pathRules: [],
    profiles: {},
    // Inline mechanical calls (no spawn, no user input) before the main session is reminded to delegate (T5.19).
    // rule "on": the card section opens with the orchestrator rule (T8.9; the experiments factor delegationRule switches it).
    delegation: { nudge: "on", afterCalls: 6, tools: ["edit", "write", "bash", "grep", "find", "read"], rule: "off" },
    routing: true,
    verifyGate: true,
    autoEscalate: true,
    // T5.21/T5.22: off by default; the user's Home Manager config switches them on.
    randomize: { enabled: false, share: 0.2 },
    spotCheck: { enabled: false, share: 0.1 },
  };
}

const C = (wl: number, ws: number, rl?: number, rs = 0): Cell =>
  ({ worker: { level: wl, step: ws }, ...(rl === undefined ? {} : { review: { level: rl, step: rs } }) });
const row = (normal: Cell, high: Cell, critical: Cell) => ({ normal, high, critical });
const readRows = (row2critical: Cell): Rows => ({
  "0": row(C(0, 0), C(0, 0, 2, 0), C(2, 0, 3, 0)),
  "1": row(C(1, 0), C(1, 1), C(2, 0, 3, 0)),
  "2": row(C(2, 0), C(2, 1), row2critical),
  "3": row(C(3, 0), C(3, 1), C(3, 1, 3, 1)),
});

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// Known keys of the right type override; objects merge recursively, except an
// empty-object default (`profiles`), whose keys are open.
function merge(base: Record<string, unknown>, raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    const b = base[k];
    if (!(k in base)) continue;
    if (isObj(b) && isObj(v)) out[k] = Object.keys(b).length === 0 ? v : merge(b, v);
    else if (Array.isArray(b) ? Array.isArray(v) : typeof v === typeof b) out[k] = v;
  }
  return out;
}

const typeName = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "an array" : `a ${typeof v}`);

const LEGACY_MODELS: [string, string][] = [["qwenLocal", "qwen-local"], ["qwenCloud", "qwen-cloud"], ["T1", "sonnet"], ["T2", "opus"]];
const LEGACY_WINDOWS: [string, string[]][] = [["qwen", ["qwen-local", "qwen-cloud"]], ["T1", ["sonnet"]], ["T2", ["opus"]]];

function setLegacy(r: Record<string, unknown>, from: string, member: string, field: string, value: unknown, problems: string[]): void {
  const models = (r.models = isObj(r.models) ? r.models : {}) as Record<string, unknown>;
  const m = (models[member] = isObj(models[member]) ? models[member] : {}) as Record<string, unknown>;
  const to = `models.${member}.${field}`;
  if (field in m) problems.push(`legacy key ${from} ignored: ${to} is set`);
  else { m[field] = value; problems.push(`legacy key ${from} mapped to ${to}`); }
}

/** Spec §5.4 rows 1–6: the pre-member keys move onto their members; the new key wins when both are set. */
function mapLegacyModels(r: Record<string, unknown>, problems: string[]): void {
  const wrong = (key: string, want: string, v: unknown): void => void problems.push(`legacy key ${key} ignored: expected ${want}, got ${typeName(v)}`);
  if (isObj(r.models)) for (const [old, member] of LEGACY_MODELS) {
    const v = r.models[old];
    if (v === undefined) continue;
    delete r.models[old];
    if (typeof v === "string") setLegacy(r, `models.${old}`, member, "model", v, problems);
    else wrong(`models.${old}`, "a string", v);
  }
  if (r.localHealthUrl !== undefined) {
    if (typeof r.localHealthUrl === "string") setLegacy(r, "localHealthUrl", "qwen-local", "health", r.localHealthUrl, problems);
    else wrong("localHealthUrl", "a string", r.localHealthUrl);
  }
  if (r.cloudDailyCap !== undefined) {
    if (typeof r.cloudDailyCap === "number") setLegacy(r, "cloudDailyCap", "qwen-cloud", "dailyCap", r.cloudDailyCap, problems);
    else wrong("cloudDailyCap", "a number", r.cloudDailyCap);
  }
  if (isObj(r.contextWindow)) for (const [tier, members] of LEGACY_WINDOWS) {
    const v = r.contextWindow[tier];
    if (v === undefined) continue;
    if (typeof v === "number") for (const m of members) setLegacy(r, `contextWindow.${tier}`, m, "contextWindow", v, problems);
    else wrong(`contextWindow.${tier}`, "a number", v);
  }
  else if (r.contextWindow !== undefined) wrong("contextWindow", "an object", r.contextWindow);
  delete r.localHealthUrl; delete r.cloudDailyCap; delete r.contextWindow;
}

/** Spec §5.4 row 7: tier/minTier → level/minLevel = the lowest level on the profile's ability of the enabled members with that
 *  tier label; the new key wins when both are set; a label no enabled member carries is dropped. The legacy field is deleted. */
function mapLegacyProfiles(s: Settings, raw: Record<string, unknown>, problems: string[]): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  for (const [kind, p] of Object.entries(raw)) {
    if (!isObj(p)) { problems.push(`profiles.${kind}: not an object; ignored`); continue; }
    const q: Record<string, unknown> = { ...p };
    const a = (typeof q.ability === "string" ? q.ability : BUILTIN_PROFILES[kind]?.ability) ?? "write";
    for (const [old, now] of [["tier", "level"], ["minTier", "minLevel"]] as const) {
      if (q[old] === undefined) continue;
      const from = `profiles.${kind}.${old}`, to = `profiles.${kind}.${now}`;
      const ls = enabled(s.models).filter((m) => m.tier === q[old] && m.abilities[a] !== undefined).map((m) => m.abilities[a]);
      if (q[now] !== undefined) problems.push(`legacy key ${from} ignored: ${to} is set`);
      else if (!ls.length) problems.push(`legacy key ${from} dropped: no enabled member has tier ${String(q[old])}`);
      else { q[now] = Math.min(...ls); problems.push(`legacy key ${from} mapped to ${to}`); }
      delete q[old];
    }
    out[kind] = q as unknown as Profile;
  }
  return out;
}

/** A known member merges field by field; a new key is taken as given (validated in T1.7). */
function mergeModels(base: Record<string, Member>, raw: unknown, problems: string[]): Record<string, Member> {
  const out = structuredClone(base);
  if (raw === undefined) return out;
  if (!isObj(raw)) { problems.push("models: not an object; defaults used"); return out; }
  for (const [k, v] of Object.entries(raw)) {
    if (!isObj(v)) { problems.push(`models.${k}: not an object; ignored`); continue; }
    out[k] = (k in base ? { ...base[k], ...v } : v) as Member;
  }
  return out;
}

/** A known table merges per row and importance; a given cell replaces the default cell whole; a new table is taken as given. */
function mergeTables(base: Record<string, Rows>, raw: unknown, problems: string[]): Record<string, Rows> {
  const out = structuredClone(base);
  if (raw === undefined) return out;
  if (!isObj(raw)) { problems.push("importanceTable: not an object; defaults used"); return out; }
  for (const [t, rows] of Object.entries(raw)) {
    if (!isObj(rows)) { problems.push(`importanceTable.${t}: not an object; ignored`); continue; }
    if (!(t in base)) { out[t] = rows as Rows; continue; }
    for (const [l, cells] of Object.entries(rows)) {
      if (!isObj(cells)) { problems.push(`importanceTable.${t}.${l}: not an object; ignored`); continue; }
      out[t][l] = { ...(out[t][l] ?? {}), ...cells } as Rows[string];
    }
  }
  return out;
}

const isInt = (v: unknown, min: number): boolean => Number.isInteger(v) && (v as number) >= min;
function memberProblem(m: Record<string, unknown>): string | undefined {
  if (typeof m.model !== "string") return "model must be a string";
  if (m.model === "") return undefined;
  if (typeof m.tier !== "string" || !m.tier || typeof m.route !== "string" || !m.route) return "tier and route must be non-empty strings";
  if (!isObj(m.abilities) || !Object.values(m.abilities).every((l) => isInt(l, 0))) return "abilities must be non-negative integers";
  const e = m.efforts;
  if (!Array.isArray(e) || !e.length || !e.every((x, i) => EFFORTS.includes(x) && x !== "max" && (i === 0 || effortRank(x) > effortRank(e[i - 1]))))
    return "efforts must be a non-empty, strictly ascending ladder without max";
  if (!(typeof m.contextWindow === "number" && m.contextWindow > 0)) return "contextWindow must be > 0";
  if (!(typeof m.cost === "number" && m.cost >= 0)) return "cost must be ≥ 0";
  if (m.order !== undefined && typeof m.order !== "number") return "order must be a number";
  if (m.slots !== undefined && !isInt(m.slots, 1)) return "slots must be a positive integer";
  if (m.dailyCap !== undefined && !isInt(m.dailyCap, 0)) return "dailyCap must be a non-negative integer (0 = never selected)";
  for (const k of ["health", "provider"]) if (m[k] !== undefined && typeof m[k] !== "string") return `${k} must be a string`;
  return undefined;
}

type Obj = Record<string, unknown>;
const IMPS = ["normal", "high", "critical"] as const;
const topRow = (rows: Obj): number => Math.max(-1, ...Object.keys(rows).filter((k) => /^(0|[1-9][0-9]*)$/.test(k)).map(Number));
const tops = (s: Settings, a: string): number[] => enabled(s.models).filter((m) => m.abilities[a] !== undefined).map((m) => m.abilities[a]);
const topOf = (s: Settings, a: string): number => Math.max(-1, ...tops(s, a));

/** A profile as planning sees it (spec §4.3): its ability (an override served by no enabled member falls back), its table (an
 *  override naming no table falls back; an ability without a table falls back to the built-in's). */
function effective(s: Settings, k: string): { a: string; t: string; okAbility: boolean; okTable: boolean } {
  const o = (s.profiles[k] ?? {}) as Obj, b = BUILTIN_PROFILES[k] ?? ({} as Partial<Profile>);
  const okTable = o.table === undefined || (typeof o.table === "string" && o.table in s.importanceTable);
  const own = okTable && typeof o.table === "string" ? o.table : undefined;
  // An override of the ability brings that ability's table, not the built-in's (spec S1; review G2 m3; `profileFor` alike).
  const tableFor = (a: string): string => own ?? (a !== b.ability ? a : b.table ?? a);
  const served = typeof o.ability === "string" && tops(s, o.ability).length > 0;
  const okAbility = o.ability === undefined || (served && tableFor(o.ability as string) in s.importanceTable);
  const a = (okAbility && typeof o.ability === "string" ? o.ability : b.ability) ?? "write";
  return { a, t: tableFor(a), okAbility, okTable };
}

/** top(a) as a profile planning on table `t` sees it: capped by the table's top row (review G2 M2 (b); `capToTable`). */
const topIn = (s: Settings, a: string, t: string): number =>
  Math.min(topOf(s, a), t in s.importanceTable ? topRow(s.importanceTable[t] as unknown as Obj) : Infinity);
const PLAN_TIME = "at plan time a review leg above the top is lowered to it, a worker leg above it rejects its spawn";

/** Rule 3: rows 0..top, three cells each, legs with integer level and step ≥ 0, worker ≥ its row, legs ≤ top, worker
 *  (level, step) non-decreasing from normal to critical. */
function tableProblem(rows: Obj, a: string, top: number): string | undefined {
  for (let l = 0; l <= top; l++) {
    const row = rows[String(l)];
    if (!isObj(row)) return `row ${l} missing`;
    let prev: { level: number; step: number } | undefined;
    for (const imp of IMPS) {
      const cell = row[imp];
      if (!isObj(cell) || !isObj(cell.worker)) return `row ${l}.${imp}: cell missing`;
      for (const leg of ["worker", "review"] as const) {
        const g = cell[leg];
        if (g === undefined) continue;
        if (!isObj(g) || !isInt(g.level, 0) || !isInt(g.step, 0)) return `row ${l}.${imp}.${leg}: level and step must be non-negative integers`;
        if ((g.level as number) > top) return `row ${l}.${imp}.${leg}: level ${g.level} above the top ${top} of ${a}`;
      }
      const w = cell.worker as { level: number; step: number };
      if (w.level < l) return `row ${l}.${imp}.worker: level ${w.level} below its row`;
      if (prev && (w.level < prev.level || (w.level === prev.level && w.step < prev.step))) return `row ${l}: worker decreases from normal to critical`;
      prev = w;
    }
  }
  return undefined;
}

/** Rules 2–4 (T2.11; review G2 M1, M2 (b)). The cap is per table and taken at plan time (`capToTable`): a member level above a
 *  table's top row is reported here, never lowered. Configured tables in use are checked against top(a) as their profiles see it
 *  (`topIn`); a bad one gets its default (or is dropped), and a dropped one can move a profile onto another table, so this repeats
 *  until nothing changes. The tables in use that are not configured (the defaults) and the built-in floors are checked too: they
 *  have no fallback, so they are reported with what planning does. Problems: caps, tables, defaults, profiles, built-in floors. */
function validatePlanning(s: Settings, base: Settings, problems: string[], raw: Obj): void {
  const configured = new Set(isObj(raw.importanceTable) ? Object.keys(raw.importanceTable) : []);
  const uses = (): Map<string, Set<string>> => { // table → the abilities of the profiles planning on it
    const u = new Map<string, Set<string>>();
    for (const k of new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(s.profiles)])) {
      const { a, t } = effective(s, k);
      if (t in s.importanceTable) u.set(t, new Set([...(u.get(t) ?? []), a]));
    }
    return u;
  };
  const tableLines: string[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const [t, as] of uses()) {
      if (!configured.has(t)) continue;
      const why = [...as].map((a) => tableProblem(s.importanceTable[t] as unknown as Obj, a, topIn(s, a, t))).find((w) => w !== undefined);
      if (why === undefined) continue;
      configured.delete(t); changed = true;
      if (t in base.importanceTable) { s.importanceTable[t] = structuredClone(base.importanceTable[t]); tableLines.push(`importanceTable.${t}: ${why}; default used`); }
      else { delete s.importanceTable[t]; tableLines.push(`importanceTable.${t}: ${why}; dropped`); }
    }
  }
  const capLines: string[] = [], defaultLines: string[] = [];
  for (const [t, as] of uses()) for (const a of as) {
    const rows = s.importanceTable[t] as unknown as Obj, max = topRow(rows);
    for (const [n, m] of Object.entries(s.models)) {
      if (m.model !== "" && m.abilities[a] > max)
        capLines.push(`models.${n}.abilities.${a} ${m.abilities[a]} capped to ${max} for importanceTable.${t} (plan time, the profiles using it)`);
    }
    const why = configured.has(t) ? undefined : tableProblem(rows, a, topIn(s, a, t));
    if (why !== undefined) defaultLines.push(`importanceTable.${t} (default): ${why}; ${PLAN_TIME}`);
  }
  problems.push(...capLines, ...tableLines, ...defaultLines);
  for (const [k, p] of Object.entries(s.profiles)) {
    const o = p as unknown as Obj, e = effective(s, k);
    const drop = (f: string, why: string) => { delete o[f]; problems.push(`profiles.${k}.${f}: ${why}; dropped`); };
    if (!e.okAbility) {
      const a = String(o.ability);
      drop("ability", tops(s, a).length ? `no importanceTable.${a}` : `no enabled member has ability ${a}`);
    }
    if (!e.okTable) drop("table", `no importanceTable.${String(o.table)}`);
    const f2 = effective(s, k), top = topIn(s, f2.a, f2.t);
    for (const f of ["level", "minLevel"]) {
      const v = o[f];
      if (v === undefined || (f === "level" && v === "top") || (isInt(v, 0) && (v as number) <= top)) continue;
      drop(f, `${JSON.stringify(v)} is not a level of ${f2.a} (0..${top})`);
    }
  }
  // Built-in floors (review G2 M1): a built-in level or minLevel no override replaces, above top(a) of the table its profile
  // plans on, makes planning reject the spawn (`planSpawn`), as the tier pipeline rejected a blank tier.
  for (const [k, b] of Object.entries(BUILTIN_PROFILES)) {
    const o = (s.profiles[k] ?? {}) as Obj, e = effective(s, k), top = topIn(s, e.a, e.t);
    if (top < 0) { problems.push(`profiles.${k}: no enabled member has ability ${e.a}; its spawns are rejected`); continue; }
    const pinned = (o.level ?? b.level) !== undefined;
    for (const f of ["level", "minLevel"] as const) {
      const v = b[f];
      if (o[f] !== undefined || typeof v !== "number" || v <= top || (f === "minLevel" && pinned)) continue;
      problems.push(`profiles.${k}.${f}: built-in ${v} above the top ${top} of ${e.a}; its spawns are rejected`);
    }
  }
}

/** Spec §5.4, in order: members (an invalid default member gets its default back, an invalid new one is dropped), then the cap,
 *  the tables and the profiles (`validatePlanning`). */
function validate(s: Settings, base: Settings, problems: string[], raw: Record<string, unknown>): void {
  for (const [name, m] of Object.entries(s.models)) {
    const why = memberProblem(m as unknown as Record<string, unknown>);
    if (why === undefined) continue;
    if (name in base.models) { s.models[name] = structuredClone(base.models[name]); problems.push(`models.${name}: ${why}; default kept`); }
    else { delete s.models[name]; problems.push(`models.${name}: ${why}; dropped`); }
  }
  const base2 = base as unknown as Record<string, unknown>;
  if ("readOnlyReview" in raw && raw.readOnlyReview !== "effort-step" && raw.readOnlyReview !== "review") {
    s.readOnlyReview = base2.readOnlyReview as Settings["readOnlyReview"];
    problems.push('readOnlyReview: must be "effort-step" or "review"; default kept');
  }
  if ("contextFit" in raw && !(typeof raw.contextFit === "number" && raw.contextFit >= 0 && raw.contextFit <= 1)) {
    s.contextFit = base2.contextFit as number;
    problems.push("contextFit: must be a number from 0 to 1; default kept");
  }
  validatePlanning(s, base, problems, raw);
}

export type Loaded = { settings: Settings; problems: string[] };

/** Missing file → defaults, no problem; unreadable JSON → defaults + one problem. */
export function loadSettingsReport(file: string): Loaded {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { settings: defaults(), problems: [] };
  }
  try {
    return parseSettings(JSON.parse(text));
  } catch (e) {
    return { settings: defaults(), problems: [`${file}: invalid JSON (${(e as Error).message}); defaults used`] };
  }
}

/** Today's signature, kept (plan r2, H1): tests and `portable.test.ts` call it unchanged; only `index.ts` reads the problems. */
export const loadSettings = (file: string): Settings => loadSettingsReport(file).settings;

/** Parsed settings file → settings and the problems found (spec §5.4). `undefined` is "no file": defaults, no problem. */
export function parseSettings(raw: unknown): Loaded {
  const base = defaults();
  if (!isObj(raw)) return { settings: base, problems: raw === undefined ? [] : ["settings: not a JSON object; defaults used"] };
  const problems: string[] = [];
  const r = structuredClone(raw) as Record<string, unknown>;
  mapLegacyModels(r, problems);
  const out = merge(base as unknown as Record<string, unknown>, r) as unknown as Settings;
  out.models = mergeModels(base.models, r.models, problems);
  out.importanceTable = mergeTables(base.importanceTable, r.importanceTable, problems);
  out.profiles = mapLegacyProfiles(out, isObj(r.profiles) ? r.profiles : {}, problems);
  validate(out, base, problems, r);
  return { settings: out, problems };
}
