// All extension logic, free of pi imports so it runs under node's test runner.
// The v2 engine (redesign §7.3): at a main session's first session_start, the stratum its model matches and, when
// eligible, an arm of that stratum's design (explore: permuted blocks; exploit: Thompson per design and stratum), kept
// for the whole session (ITT: a later model switch changes nothing). The assignment goes to
// <agentDir>/experiments/assignments.jsonl (v2), to the session as the custom entry ENTRY (a resumed branch reuses it),
// to pi-economics' add-ons on the internal channel (core/channel.ts) and, until M5b.2, to the process-global API.
// Children inherit via spawn events; a RESUMED child (whose spawn event was lost to the process restart) re-derives the
// arm from its session file layout on lookup.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApi, type ApiArm } from "./api.ts";
import { designState, draw, eligibleFor, stratumOf, type AssignmentV2, type BlockState } from "./assign.ts";
import { publish, serve, type Assigned, type Bus } from "./channel.ts";
import { designFor, type Design } from "./design.ts";
import { V4_FACTORS, defaults, loadOptIn, parseStrata, readPlans, type Settings } from "./settings.ts";
import { actorMissing, hasSubagentsApiV1, warnOnce } from "./runtime-guard.ts";

export type PiLike = {
  on(name: string, handler: (e: any, ctx: any) => unknown): void;
  registerCommand(name: string, command: { description: string; handler: (args: string, ctx: any) => unknown }): void;
  appendEntry(customType: string, data?: unknown): void;
  events: Bus;
};
/** The part of the actor-subagents API this package reads (own copy: packages do not import each other); the type check compares it with the provider's SubagentsApiV1 (spec §5.3). */
export type SubagentsApi = {
  list(): Array<{ name: string; sessionId: string }>;
  subscribe(l: (e: { type: string; parent?: string; childSessionId?: string }) => void): () => void;
};
/** `settings`: given (tests), else read from <agentDir>/experiments/settings.json, whose absence leaves the extension inert (spec D15). */
export type Deps = { agentDir: string; settings?: Settings; rng?: () => number; api?: () => SubagentsApi | undefined };

/** The custom entry (data: Assigned) the engine appends to a main session; a resumed or reloaded branch reuses it. */
export const ENTRY = "pi-economics:assignment";

/**
 * A row of assignments.jsonl. v2 (AssignmentV2) since M5b.1. Before it (no `v`, or v 1) the v1 engine's: `arm`, `flags`
 * by factor name and `design` ("v2", "v3", "v4"; absent on v1 lines). A resumed session keeps whatever its row says.
 */
type Row = Partial<AssignmentV2> & { sessionId: string; v?: number; arm?: string; flags?: Record<string, string> };

const readJson = (file: string): unknown => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
};
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const safe = <T>(f: () => T): T | undefined => {
  try { return f(); } catch { return undefined; }
};

/** The fields of an AssignmentV2 the add-ons see, in its key order; absent ones stay absent. */
function assignedOf(r: Partial<AssignmentV2> & { sessionId: string; eligible: boolean }): Assigned {
  const a: Assigned = { sessionId: r.sessionId, eligible: r.eligible };
  if (r.parentSessionId !== undefined) a.parentSessionId = r.parentSessionId;
  if (r.design !== undefined) a.design = r.design;
  if (r.stratum !== undefined) a.stratum = r.stratum;
  if (r.arm !== undefined) a.arm = r.arm;
  if (r.factors !== undefined) a.factors = r.factors;
  return a;
}

/** The global API's view of an Assigned: its levels as strings, keyed by the lever's name (cache-lifecycle reads `flag("mainCacheTtl")`). */
function apiArm(a: Assigned): ApiArm | undefined {
  if (a.arm === undefined) return undefined;
  const flags = Object.fromEntries(Object.values(a.factors ?? {}).map((f) => [f.lever.slice(f.lever.indexOf(".") + 1), String(f.assigned)]));
  return { id: a.arm, flags, ...(a.design !== undefined ? { design: a.design } : {}), ...(a.stratum !== undefined ? { stratum: a.stratum } : {}) };
}

export function install(pi: PiLike, deps: Deps): void {
  // Opt-in (spec D15): without the settings file no arm, no API, no hook, no assignments.jsonl, no warning.
  const settings = deps.settings ?? loadOptIn(join(deps.agentDir, "experiments", "settings.json"));
  if (settings === undefined) { // an API an earlier runtime of this process published (the file was deleted, then /reload) must not outlive the opt-out
    delete (globalThis as { __piExperimentsApi_v1?: unknown }).__piExperimentsApi_v1;
    return;
  }
  const dir = join(deps.agentDir, "experiments");
  const plans = readPlans(join(deps.agentDir, "token-meter", "settings.json"));
  const { strata, warnings } = parseStrata(settings.strata, plans, V4_FACTORS);
  const designs = new Map<string, Design>(Object.entries(strata).map(([name, s]) => [name, designFor(name, s)]));
  const rng = deps.rng ?? Math.random;
  const subagents = deps.api ?? (() => (globalThis as { __subagentsApi_v1?: SubagentsApi }).__subagentsApi_v1);
  let main: string | undefined;
  let sessionDir: string | undefined;
  // Own copy of token-meter's parentSessionId rule (packages do not import each other): the parent
  // is the first `…/subagents/<parent>/` segment of the session file path. Resumed children live in
  // <sessionDir>/subagents/<parent>/*_<child>.jsonl; a file without such a segment is a root session.
  const parentOf = (file: string): string | undefined => /[\\/]subagents[\\/]([^\\/]+)[\\/]/.exec(file)?.[1];
  const resolveParent = (sid: string): string | undefined => {
    if (sessionDir === undefined) return undefined;
    const sub = join(sessionDir, "subagents");
    let dirs: string[];
    try { dirs = readdirSync(sub); } catch { return undefined; }
    for (const d of dirs) {
      const dir = join(sub, d);
      let files: string[];
      try { files = readdirSync(dir); } catch { continue; }
      const hit = files.find((f) => f.endsWith(`_${sid}.jsonl`));
      if (hit !== undefined) return parentOf(join(dir, hit));
    }
    return undefined;
  };
  const { api, assign: remember } = createApi(() => main, resolveParent);
  (globalThis as { __piExperimentsApi_v1?: unknown }).__piExperimentsApi_v1 = api;

  /** Every session's Assigned this runtime knows (mains, and children from their spawn events). */
  const known = new Map<string, Assigned>();
  /** A child's Assigned is its parent's but for sessionId and parentSessionId. */
  const childOf = (p: Assigned, sessionId: string, parentSessionId: string): Assigned => ({ ...p, sessionId, parentSessionId });
  /** Known, or (a resumed child) derived from the parent its session file names, up to an assigned root; cached. */
  const lookup = (sid: string, depth = 0): Assigned | undefined => {
    const hit = known.get(sid);
    if (hit !== undefined || depth >= 64) return hit;
    const parent = resolveParent(sid);
    const p = parent === undefined || parent === sid ? undefined : lookup(parent, depth + 1);
    if (p === undefined) return undefined;
    const a = childOf(p, sid, parent!);
    known.set(sid, a);
    return a;
  };
  serve(pi.events, (sid) => lookup(sid));
  const adopt = (a: Assigned, legacy?: ApiArm): void => {
    known.set(a.sessionId, a);
    const arm = legacy ?? apiArm(a);
    if (arm !== undefined) remember(a.sessionId, arm);
    publish(pi.events, a);
  };

  const rows = (): Row[] => {
    try {
      return readFileSync(join(dir, "assignments.jsonl"), "utf8").split("\n").flatMap((l) => {
        try { const r = JSON.parse(l); return isRecord(r) && typeof r.sessionId === "string" ? [r as Row] : []; } catch { return []; }
      });
    } catch { return []; }
  };
  /** A session's row: v2 → its Assigned; a v1 engine's row → its arm, flags and design (the API keeps serving them). */
  const fromRow = (r: Row): { a: Assigned; legacy?: ApiArm } | undefined => {
    if (r.v === 2) return typeof r.eligible === "boolean" ? { a: assignedOf(r as Row & { eligible: boolean }) } : undefined;
    if (typeof r.arm !== "string" || !isRecord(r.flags)) return undefined;
    const design = typeof r.design === "string" ? { design: r.design } : {};
    return { a: { sessionId: r.sessionId, eligible: true, arm: r.arm, ...design }, legacy: { id: r.arm, flags: r.flags, ...design } };
  };
  /** Atomically (a reader never sees half a file); two processes drawing at once may each take the same arm (a slight imbalance, never a wrong arm). */
  const writeBlocks = (b: BlockState): void => {
    const file = join(dir, "blocks.json");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(b) + "\n");
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.warn(`experiments: cannot record the explore blocks: ${(err as Error).message}`);
    }
  };
  /** A new main's assignment: its stratum, and an arm when eligible (none left enabled: ineligible). */
  const assignNew = (sid: string, model: unknown): AssignmentV2 => {
    const m = isRecord(model) && typeof model.provider === "string" && typeof model.id === "string" ? model : undefined;
    const stratum = m === undefined ? undefined : stratumOf(strata, plans, m.provider as string, m.id as string);
    const d = stratum === undefined ? undefined : designs.get(stratum);
    let arm: string | undefined;
    if (d !== undefined && settings.mode !== "off" && eligibleFor(false, stratum, settings.mode)) {
      const raw = readJson(join(dir, "blocks.json"));
      const blocks: BlockState = isRecord(raw) ? (raw as BlockState) : {};
      const r = draw(settings.mode, d, blocks, designState(readJson(join(dir, "state.json")), d), rng, settings.minExplore);
      arm = r.arm;
      if (r.blocks !== blocks) writeBlocks(r.blocks);
    }
    const levels = d?.arms.find((a) => a.name === arm)?.levels;
    return {
      v: 2, ts: new Date().toISOString(), sessionId: sid,
      ...(d !== undefined ? { design: d.id } : {}),
      mode: settings.mode,
      eligible: levels !== undefined,
      ...(stratum !== undefined ? { stratum } : {}),
      ...(levels !== undefined ? { arm, factors: Object.fromEntries(d!.factors.map((f) => [f.name, { lever: f.lever, assigned: levels[f.name] }])) } : {}),
    };
  };

  let off: (() => void) | undefined;
  const connect = (): void => {
    const a = subagents();
    if (off || !a) return;
    off = a.subscribe((e) => {
      if (e.type !== "spawn" || !e.childSessionId || main === undefined) return;
      const parent = a.list().find((x) => x.name === e.parent)?.sessionId ?? main;
      api.inherit(e.childSessionId, parent);
      const p = lookup(parent);
      if (p === undefined) return;
      const c = childOf(p, e.childSessionId, parent);
      known.set(c.sessionId, c);
      publish(pi.events, c);
    });
  };
  connect();

  // Guards: corrections and the end-of-session rating go to <agentDir>/guards/events.jsonl; only the fact, never text.
  const logGuard = (sessionId: string, event: string, value?: number): void => {
    try {
      mkdirSync(join(deps.agentDir, "guards"), { recursive: true });
      appendFileSync(join(deps.agentDir, "guards", "events.jsonl"), JSON.stringify({ v: 1, ts: new Date().toISOString(), sessionId, arm: api.armFor(sessionId)?.id, event, ...(value === undefined ? {} : { value }) }) + "\n");
    } catch (err) {
      console.warn(`experiments: cannot record a guard event: ${(err as Error).message}`);
    }
  };
  const lastRole = new Map<string, string>();
  let correction: RegExp;
  try { correction = new RegExp(settings.correctionRegex, "i"); } catch { correction = new RegExp(defaults().correctionRegex, "i"); }
  pi.on("message_end", (e, ctx) => void lastRole.set(ctx.sessionManager.getSessionId(), e.message?.role));
  pi.on("input", (e, ctx) => {
    const sid = ctx.sessionManager.getSessionId() as string;
    if (e.source !== "extension" && lastRole.get(sid) === "assistant" && correction.test(e.text ?? "")) logGuard(sid, "correction");
    return undefined;
  });
  pi.registerCommand("rate", {
    description: "Rate this session 1-5 (an experiment guard)",
    handler: (args, ctx) => {
      const n = /^\s*([1-5])\s*$/.exec(args ?? "")?.[1];
      if (!n) return void ctx.ui.notify("usage: /rate 1-5", "warning");
      logGuard(ctx.sessionManager.getSessionId(), "rating", Number(n));
      ctx.ui.notify(`rated ${n}/5`, "info");
    },
  });

  pi.on("session_start", (_e, ctx) => {
    connect();
    // spec D5: without the patched actor only the children's inheritance is off; the main session is assigned as before.
    if (!hasSubagentsApiV1(subagents())) warnOnce(ctx, "actor:experiments", actorMissing("experiments", "child agents do not inherit their parent's arm"));
    for (const w of warnings) warnOnce(ctx, `experiments:${w}`, w); // a dropped stratum (parseStrata says why)
    main = ctx.sessionManager.getSessionId() as string;
    sessionDir = safe(() => ctx.sessionManager.getSessionDir() as string | undefined);
    // A child's runtime (experiments among the actor's childExtensions): never drawn, no row; its arm is its parent's.
    const file = safe(() => ctx.sessionManager.getSessionFile() as string | undefined);
    if (typeof file === "string" && parentOf(file) !== undefined) return;
    const prior = rows().find((r) => r.sessionId === main);
    const resumed = prior && fromRow(prior);
    if (resumed) return adopt(resumed.a, resumed.legacy);
    const row = assignNew(main, safe(() => ctx.model));
    const a = assignedOf(row);
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "assignments.jsonl"), JSON.stringify(row) + "\n");
    } catch (err) {
      console.warn(`experiments: cannot record the assignment: ${(err as Error).message}`);
    }
    pi.appendEntry(ENTRY, a);
    adopt(a);
  });
}
