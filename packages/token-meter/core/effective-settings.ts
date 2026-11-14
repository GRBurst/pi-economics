// The effective pi settings as levers (design §8.1, s = "fixed"): pure over the parsed global
// (<agentDir>/settings.json) and project (<cwd>/.pi/settings.json, trusted projects only) files.
// Follows pi 1.4's settings manager (docs/settings.md): objects merge deeply, the project winning per key;
// `defaultTools` lists of only +name/-name modify the inherited selection; `cacheWarming` is global only;
// compaction tokens resolve model override → ordinary setting → default after the merge. Each file is migrated first
// (`websockets` → `transport`, `retry.maxDelayMs` → `retry.provider.maxRetryDelayMs`) and `httpIdleTimeoutMs` is parsed as pi does.
// A value of the wrong type or outside its levels leaves its lever out (unknown), except `cacheWarming`,
// which pi reads as "streaming".
import type { LeverId, LeverState, Value } from "./levers.ts";

type Obj = Record<string, unknown>;
export type SettingsEnv = {
  /** "<provider>/<modelId>" of the session's model: per-model compaction tokens and thinking level */
  model?: string;
  /** PI_CACHE_RETENTION */
  cacheRetention?: string;
};

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 16384 } as const;
/** pi's built-in tool names plus the two built-in extensions' inactive tools (docs/settings.md). */
const TOOLS = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls", "codemode", "tool_search"] as const;
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];

const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const bool = (x: unknown): x is boolean => typeof x === "boolean";
const oneOf = (...levels: string[]) => (x: unknown): x is string => typeof x === "string" && levels.includes(x);

function merge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(base[k]) && isObj(v) ? merge(base[k] as Obj, v) : v;
  }
  return out;
}

const isModifier = (e: unknown) => typeof e === "string" && (e.startsWith("+") || e.startsWith("-"));

function mergeTools(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (!Array.isArray(base) || !Array.isArray(over) || !over.every(isModifier)) return over;
  return [...base, ...over];
}

function resolveTools(entries: string[]): string[] {
  const plain = entries.filter((e) => !isModifier(e));
  const tools = [...(plain.length > 0 || entries.length === 0 ? plain : DEFAULT_TOOLS)];
  for (const e of entries) {
    if (!isModifier(e)) continue;
    const name = e.slice(1), i = tools.indexOf(name);
    if (e.startsWith("+") && i === -1 && name) tools.push(name);
    else if (e.startsWith("-") && i !== -1) tools.splice(i, 1);
  }
  return tools;
}

/** pi 1.4 SettingsManager.migrateSettings, applied to each file before the merge (the levers' keys only); never changes `o`. */
function migrate(o: Obj): Obj {
  const out: Obj = { ...o };
  if (!("transport" in out) && typeof out.websockets === "boolean") {
    out.transport = out.websockets ? "websocket" : "sse";
    delete out.websockets;
  }
  if (isObj(out.retry)) {
    const retry: Obj = { ...out.retry };
    const provider = typeof retry.provider === "object" && retry.provider !== null ? retry.provider as Obj : undefined;
    if (typeof retry.maxDelayMs === "number" && (provider?.maxRetryDelayMs === undefined || provider?.maxRetryDelayMs === null))
      retry.provider = { ...(provider ?? {}), maxRetryDelayMs: retry.maxDelayMs };
    delete retry.maxDelayMs;
    out.retry = retry;
  }
  return out;
}

/** pi 1.4 parseHttpIdleTimeoutMs: a number or numeric string ≥ 0, floored; "disabled" = 0; else undefined (pi throws). */
function httpIdle(x: unknown): number | undefined {
  if (typeof x === "string") {
    const s = x.trim();
    if (s.toLowerCase() === "disabled") return 0;
    return s.length === 0 ? undefined : httpIdle(Number(s));
  }
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : undefined;
}

const at = (o: Obj, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o);

/** Every lever id the observer can report, in line order. */
export const LEVER_IDS: readonly LeverId[] = [
  "pi.cacheWarming", "pi.promptCache",
  "pi.compaction.enabled", "pi.compaction.reserveTokens", "pi.compaction.keepRecentTokens",
  "pi.branchSummary.reserveTokens", "pi.branchSummary.skipPrompt",
  "pi.codemode.mode", "pi.codemode.inlineBudget", "pi.transport",
  "pi.retry.enabled", "pi.retry.maxRetries", "pi.retry.baseDelayMs", "pi.retry.maxAgentDelayMs",
  "pi.retry.provider.timeoutMs", "pi.retry.provider.maxRetries", "pi.retry.provider.maxRetryDelayMs",
  "pi.images.autoResize", "pi.images.blockImages",
  ...Object.keys(BUDGETS).map((l) => `pi.thinkingBudgets.${l}`),
  "pi.defaultThinkingLevel",
  ...TOOLS.map((t) => `pi.defaultTools.${t}`),
];

export function effectiveSettings(global: unknown, project: unknown, env: SettingsEnv = {}): Record<LeverId, LeverState> {
  const g = isObj(global) ? migrate(global) : {};
  const p = isObj(project) ? migrate(project) : {};
  const m = merge(g, p);
  const tools = mergeTools(g.defaultTools, p.defaultTools);
  const out: Record<LeverId, LeverState> = {};
  const put = (id: LeverId, v: Value | undefined) => { if (v !== undefined) out[id] = { v, s: "fixed" }; };
  /** the merged value at `path` if valid, the default if unset, else unknown */
  const read = (path: string, ok: (x: unknown) => x is Value, dflt: Value): Value | undefined => {
    const x = at(m, path);
    return x === undefined ? dflt : ok(x) ? x : undefined;
  };

  put("pi.cacheWarming", oneOf("off", "streaming", "idle")(g.cacheWarming) ? g.cacheWarming as string : "streaming");
  put("pi.promptCache", env.cacheRetention === "long" ? "long" : "short");

  put("pi.compaction.enabled", read("compaction.enabled", bool, true));
  /** the entry for the session's model in the per-model map at `path` */
  const byModel = (path: string): unknown => {
    const o = at(m, path);
    return env.model !== undefined && isObj(o) ? o[env.model] : undefined;
  };
  const override = byModel("compaction.modelOverrides");
  for (const [field, dflt] of [["reserveTokens", 16384], ["keepRecentTokens", 20000]] as const) {
    if (override !== undefined && !isObj(override)) continue; // pi throws: unknown
    const o = isObj(override) ? override[field] : undefined;
    if (o !== undefined) put(`pi.compaction.${field}`, count(o) ? o : undefined);
    else put(`pi.compaction.${field}`, read(`compaction.${field}`, count, dflt));
  }

  put("pi.branchSummary.reserveTokens", read("branchSummary.reserveTokens", count, 16384));
  put("pi.branchSummary.skipPrompt", read("branchSummary.skipPrompt", bool, false));
  put("pi.codemode.mode", read("codemode.mode", oneOf("on", "only"), "on"));
  put("pi.codemode.inlineBudget", read("codemode.inlineBudget", count, 3000));
  put("pi.transport", read("transport", oneOf("auto", "sse", "websocket", "websocket-cached"), "auto"));

  put("pi.retry.enabled", read("retry.enabled", bool, true));
  put("pi.retry.maxRetries", read("retry.maxRetries", count, 3));
  put("pi.retry.baseDelayMs", read("retry.baseDelayMs", count, 2000));
  put("pi.retry.maxAgentDelayMs", read("retry.maxAgentDelayMs", count, 60000));
  // pi: getHttpIdleTimeoutMs (default 300000; 0 = disabled → 2147483647 ms per request), unless retry.provider.timeoutMs is set
  const rawIdle = at(m, "httpIdleTimeoutMs");
  const parsedIdle = rawIdle === undefined ? 300000 : httpIdle(rawIdle);
  const idle = parsedIdle === 0 ? 2147483647 : parsedIdle;
  put("pi.retry.provider.timeoutMs", at(m, "retry.provider.timeoutMs") === undefined ? idle : read("retry.provider.timeoutMs", count, 0));
  put("pi.retry.provider.maxRetries", read("retry.provider.maxRetries", count, 0));
  put("pi.retry.provider.maxRetryDelayMs", read("retry.provider.maxRetryDelayMs", count, 60000));

  put("pi.images.autoResize", read("images.autoResize", bool, true));
  put("pi.images.blockImages", read("images.blockImages", bool, false));
  for (const [level, dflt] of Object.entries(BUDGETS)) put(`pi.thinkingBudgets.${level}`, read(`thinkingBudgets.${level}`, count, dflt));

  const perModel = byModel("modelThinkingLevels");
  put("pi.defaultThinkingLevel", perModel !== undefined
    ? (oneOf(...THINKING)(perModel) ? perModel : undefined)
    : read("defaultThinkingLevel", oneOf(...THINKING), "medium"));

  if (tools === undefined || (Array.isArray(tools) && tools.every((t) => typeof t === "string"))) {
    const on = tools === undefined ? DEFAULT_TOOLS : resolveTools(tools as string[]);
    for (const t of TOOLS) put(`pi.defaultTools.${t}`, on.includes(t));
  }
  return out;
}

/** infinite-context's record of its settings: on the branch whenever IC runs in the session (it appends one at session_start). */
const IC_SETTINGS = "infinite-context:settings";

/**
 * The levers an extension decides, from the session branch (design §5.3, `s: "ext"`): with infinite-context loaded,
 * pi.compaction.enabled = false (IC cancels every session_before_compact, D18); the other pi.compaction.* levers stay
 * recorded but are inert, and the analyser does not read them.
 */
export function extensionLevers(branch: readonly unknown[]): Record<LeverId, LeverState> {
  const records = branch.filter((e): e is Record<string, unknown> => isObj(e) && e.type === "custom" && e.customType === IC_SETTINGS);
  if (records.length === 0) return {};
  const out: Record<LeverId, LeverState> = { "pi.compaction.enabled": { v: false, s: "ext" } };
  // The limit the extension holds (its latest well-formed record): drawn by it from a rule's range (ext), else a number the
  // configuration fixed (fixed). Only where no pi-economics factor is on the lever: the engine's own state replaces this one.
  const own = records.map((r) => r.data).reverse().find((d): d is Record<string, unknown> => isObj(d) && typeof d.nudgeAtTokens === "number" && Number.isFinite(d.nudgeAtTokens));
  if (own !== undefined) out[IC_NUDGE] = { v: own.nudgeAtTokens as number, s: own.nudgeAtTokensRange === undefined ? "fixed" : "ext" };
  return out;
}
/** The lever of infinite-context's limit (the engine's add-on has the same id). */
export const IC_NUDGE = "infinite-context.nudgeAtTokens";
