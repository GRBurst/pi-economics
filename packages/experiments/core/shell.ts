// All extension logic, free of pi imports so it runs under node's test runner.
// The v2 engine (redesign §7.3): at a main session's first session_start, the stratum its model matches and, when
// eligible, an arm of that stratum's design (explore: permuted blocks; exploit: Thompson per design and stratum), kept
// for the whole session (ITT: a later model switch changes nothing). The assignment goes to
// <agentDir>/experiments/assignments.jsonl (v2), to the session as the custom entry ENTRY (a resumed branch reuses it),
// to pi-economics' add-ons on the internal channel (core/channel.ts), never on globalThis (M5b.2, G5). The add-ons
// (addons/) set and read back the levers of the session's factors. A child runs its root's arm: experiments loads in
// the child too (pi.events is per runtime, the actor builds a child without the parent's bus) and, in child mode,
// derives the child's assignment from the root's row and serves it on the child's own bus.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { designState, draw, eligibleFor, parseBlocks, stratumOf, type AssignmentV2, type BlockState } from "./assign.ts";
import { CACHE_LIFECYCLE } from "../addons/cache-lifecycle.ts";
import { piProcessLevers } from "../addons/pi-process.ts";
import { IC_TARGET, IC_TOOL, infiniteContext, parseIcRules, type IcRules } from "../addons/infinite-context.ts";
import { createRegistry, sessionLevers } from "../addons/registry.ts";
import type { Lever, ModelRef, SessionCtx } from "../addons/types.ts";
import { publish, serve, type Assigned, type Bus, type Levers } from "./channel.ts";
import { designFor, type Design, type Level } from "./design.ts";
import { V4_FACTORS, defaults, loadOptIn, parseStrata, readPlans, type Settings } from "./settings.ts";
import { actorMissing, hasSubagentsApiV1, warnOnce } from "./runtime-guard.ts";

export type PiLike = {
  on(name: string, handler: (e: any, ctx: any) => unknown): void;
  registerCommand(name: string, command: { description: string; handler: (args: string, ctx: any) => unknown }): void;
  appendEntry(customType: string, data?: unknown): void;
  events: Bus;
  /** pi 1.4: every registered tool; absent in a host without it (no target is then detected by its tools). */
  getAllTools?(): Array<{ name?: unknown }>;
};
/** The part of the actor-subagents API this package reads (own copy: packages do not import each other); the type check compares it with the provider's SubagentsApiV1 (spec §5.3). */
export type SubagentsApi = {
  list(): Array<{ name: string; sessionId: string }>;
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
const isLevel = (v: unknown): boolean => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
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

export function install(pi: PiLike, deps: Deps): void {
  // Opt-in (spec D15): without the settings file no arm, no answer on the channel, no hook, no assignments.jsonl, no warning.
  const settings = deps.settings ?? loadOptIn(join(deps.agentDir, "experiments", "settings.json"));
  if (settings === undefined) return;
  const dir = join(deps.agentDir, "experiments");
  const plans = readPlans(join(deps.agentDir, "token-meter", "settings.json"));
  const { strata, warnings } = parseStrata(settings.strata, plans, V4_FACTORS);
  const designs = new Map<string, Design>(Object.entries(strata).map(([name, s]) => [name, designFor(name, s)]));
  const rng = deps.rng ?? Math.random;
  const subagents = deps.api ?? (() => (globalThis as { __subagentsApi_v1?: SubagentsApi }).__subagentsApi_v1);
  // Own copy of token-meter's parentSessionId rule (packages do not import each other): the parent
  // is <parent> when the session file lies in `…/subagents/<parent>/` (the actor's layout; review n1: that directory, not a
  // higher one); a file elsewhere is a root session's.
  const parentOf = (file: string): string | undefined => /[\\/]subagents[\\/]([^\\/]+)[\\/][^\\/]+$/.exec(file)?.[1];

  /** The Assigned of this runtime's session (a runtime serves one session; a new, resumed or forked one is a new runtime). */
  const known = new Map<string, Assigned>();
  /** A child's Assigned is its parent's but for sessionId and parentSessionId. */
  const childOf = (p: Assigned, sessionId: string, parentSessionId: string): Assigned => ({ ...p, sessionId, parentSessionId });
  /**
   * Child mode: this runtime is a child's (experiments among the actor's childExtensions, its own bus); `root` is the
   * main session whose row it runs. It never draws, writes no row or entry and logs no guard: its Assigned is derived
   * from the root's row once, at session_start (the root's row precedes every child of it).
   */
  let child: { sid: string; root: string } | undefined;
  /**
   * The root a session runs under, or undefined for a main. A session file decides by its place (the actor keeps every
   * child, nested ones too, in <sessionDir>/subagents/<root>/); an in-memory session (no file) is a child when the
   * actor lists it, or reserves a record for the child it is creating (sessionId "": its session_start runs inside the
   * actor's createSession), beside a main record of another session. The actor binds every child headless, so an
   * in-memory session with a UI is a main (review m1: an interactive --no-session main starting while the actor still
   * lists the previous main and a reservation). Residual, bounded by the actor's shutdownAll: a headless main in that
   * window reads as a child, an in-memory child whose reservation is gone as a main (pi-setup backlog: the reservation
   * carries the child's sessionId before its extensions are bound).
   */
  const rootOf = (sid: string, file: string | undefined, hasUI: unknown): string | undefined => {
    if (typeof file === "string") return parentOf(file);
    if (hasUI === true) return undefined;
    const agents = safe(() => subagents()?.list()) ?? [];
    const root = agents.find((x) => x.name === "main")?.sessionId;
    if (!root || root === sid) return undefined;
    return agents.some((x) => x.name !== "main" && (x.sessionId === sid || x.sessionId === "")) ? root : undefined;
  };
  const deriveChild = (c: { sid: string; root: string }): Assigned | undefined => {
    const r = rows().find((x) => x.sessionId === c.root);
    const p = r === undefined ? undefined : fromRow(r);
    return p === undefined ? undefined : childOf(p, c.sid, c.root);
  };
  const lookup = (sid: string): Assigned | undefined => known.get(sid);
  // The add-ons (§7.4): a session's levers start when their target first asks the channel; their read-back states ride
  // on every publication and answer.
  // infinite-context reads its settings file once, when it loads; the engine reads the rules once too (at the first use, the
  // session's start), so a file rewritten mid-session is the next session's and never makes a switch a refusal.
  const icFile = join(deps.agentDir, "infinite-context", "settings.json");
  let icRules: IcRules | undefined;
  const readIcRules = (): IcRules => (icRules ??= parseIcRules(safe(() => readFileSync(icFile, "utf8"))));
  // pi's process levers read back from the settings files (the project's under the checkout the session runs in).
  // What pi merges (the project's settings only when the project is trusted, as pi and token-meter do) and the model whose
  // per-model compaction tokens apply: noted from the session's context at session_start and before each read-back.
  let cwd = process.cwd();
  let trusted = false;
  let model: string | undefined;
  const noteEnv = (ctx: any): void => {
    cwd = safe(() => ctx.cwd as string | undefined) ?? cwd;
    trusted = safe(() => ctx.isProjectTrusted() as unknown) === true;
    const m = safe(() => ctx.model as { provider?: unknown; id?: unknown } | undefined);
    model = typeof m?.provider === "string" && typeof m?.id === "string" ? `${m.provider}/${m.id}` : undefined;
  };
  const registry = createRegistry([...CACHE_LIFECYCLE, ...infiniteContext(readIcRules), ...piProcessLevers(() => ({
    global: readJson(join(deps.agentDir, "settings.json")),
    project: trusted ? readJson(join(cwd, ".pi", "settings.json")) : undefined,
    model,
  }))]);
  const tracked = new Map<string, ReturnType<typeof sessionLevers>>();
  /** What a session offers its add-ons now: its current model, its branch and its entry writer (seed tier, §7.4). */
  const live = new Map<string, { model?: ModelRef; branch: () => readonly unknown[] }>();
  const modelOf = (m: unknown): ModelRef | undefined => (isRecord(m) ? { ...(typeof m.provider === "string" ? { provider: m.provider } : {}), ...(typeof m.id === "string" ? { id: m.id } : {}) } : undefined);
  const sessionOf = (sid: string, event?: unknown): SessionCtx => {
    const l = live.get(sid);
    return { sessionId: sid, ...(event === undefined ? {} : { event }), ...(l?.model === undefined ? {} : { model: l.model }), ...(l === undefined ? {} : { branch: l.branch }), appendEntry: (t, d) => pi.appendEntry(t, d) };
  };
  const watch = (sid: string, ctx: any): void => {
    const sm = safe(() => ctx.sessionManager);
    const model = modelOf(safe(() => ctx.model));
    live.set(sid, { ...(model === undefined ? {} : { model }), branch: () => safe(() => sm.getBranch() as unknown[]) ?? [] });
  };
  /** A factor's levels in the design the session was assigned (another design under the same stratum: just its own). */
  const levelsOf = (a: Assigned) => (name: string): readonly Level[] => {
    const d = a.stratum === undefined ? undefined : designs.get(a.stratum);
    const spec = d?.id === a.design ? d?.factors.find((f) => f.name === name) : undefined;
    return spec?.levels ?? (a.factors?.[name] === undefined ? [] : [a.factors[name].assigned]);
  };
  const trackerOf = (a: Assigned) => {
    let t = tracked.get(a.sessionId);
    if (t === undefined) {
      t = sessionLevers(registry, a, { child: a.parentSessionId !== undefined }, levelsOf(a), () => sessionOf(a.sessionId));
      tracked.set(a.sessionId, t);
      t.refresh();
    }
    return t;
  };
  const leversOf = (sid: string): Levers | undefined => {
    const a = lookup(sid);
    return a === undefined ? undefined : { ...a, levers: trackerOf(a).states() };
  };
  // A publication's listener may ask (a target loading) and so change the state mid-publication: the change goes out
  // after it, so every listener's last payload is the current state.
  const pending = new Set<string>();
  let flushing = false;
  const announce = (sid: string): void => {
    pending.add(sid);
    if (flushing) return;
    flushing = true;
    try {
      for (const s of pending) {
        pending.delete(s);
        const l = leversOf(s);
        if (l !== undefined) publish(pi.events, l);
      }
    } finally {
      flushing = false;
    }
  };
  /** A target is loaded (it asked the channel, or pi lists its tool): its levers start in every session already tracked. */
  const loaded = (target: string): void => {
    if (registry.load(target)) for (const [s, t] of tracked) if (t.refresh()) announce(s);
  };
  serve(pi.events, (sid, target) => {
    if (target !== undefined) loaded(target);
    return leversOf(sid);
  });
  const observeAt = (at: Lever["readBackAt"], e: unknown, ctx: any): void => {
    noteEnv(ctx);
    const sid = safe(() => ctx.sessionManager.getSessionId() as string);
    const t = sid === undefined ? undefined : tracked.get(sid);
    if (t?.observe(at, sessionOf(sid!, e))) announce(sid!);
  };
  // A model switch: the levers that follow the model (the seed of a range lever) are set again before the extensions after
  // this one (load order: experiments first) see the switch. `live.model` is the model they were last set for; an event that
  // names it again (pi's "restore") changes nothing.
  pi.on("model_select", (e, ctx) => {
    const sid = safe(() => ctx.sessionManager.getSessionId() as string);
    const l = sid === undefined ? undefined : live.get(sid);
    const model = modelOf(e?.model);
    if (sid === undefined || l === undefined || model === undefined) return;
    if (l.model?.provider === model.provider && l.model?.id === model.id) return;
    live.set(sid, { ...l, model });
    if (tracked.get(sid)?.modelChanged()) announce(sid);
  });
  pi.on("before_agent_start", (e, ctx) => void observeAt("before_agent_start", e, ctx));
  const adopt = (a: Assigned): void => {
    known.set(a.sessionId, a);
    announce(a.sessionId);
  };

  const rows = (): Row[] => {
    try {
      return readFileSync(join(dir, "assignments.jsonl"), "utf8").split("\n").flatMap((l) => {
        try { const r = JSON.parse(l); return isRecord(r) && typeof r.sessionId === "string" ? [r as Row] : []; } catch { return []; }
      });
    } catch { return []; }
  };
  /** A session's row: v2 → its Assigned; a v1 engine's row → its arm, design and flags (as factors). */
  const fromRow = (r: Row): Assigned | undefined => {
    if (r.v === 2) return typeof r.eligible === "boolean" ? assignedOf(r as Row & { eligible: boolean }) : undefined;
    if (typeof r.arm !== "string" || !isRecord(r.flags)) return undefined;
    const design = typeof r.design === "string" ? { design: r.design } : {};
    // Its flags by factor name as factors over the v4 levers (an add-on reads factors; a flag of no v4 factor reached no reader).
    const factors = Object.fromEntries(V4_FACTORS.flatMap((f) => (typeof r.flags![f.name] === "string" ? [[f.name, { lever: f.lever, assigned: r.flags![f.name] }]] : [])));
    return { sessionId: r.sessionId, eligible: true, ...design, arm: r.arm, factors };
  };
  /** The last ENTRY on the branch that is this session's (a well-formed Assigned). */
  const fromBranch = (branch: unknown, sid: string): Assigned | undefined => {
    if (!Array.isArray(branch)) return undefined;
    for (const e of [...branch].reverse()) {
      const d = isRecord(e) && e.type === "custom" && e.customType === ENTRY ? e.data : undefined;
      if (isRecord(d) && d.sessionId === sid && typeof d.eligible === "boolean" && (d.arm === undefined || typeof d.arm === "string") && (d.factors === undefined || isRecord(d.factors))) return assignedOf(d as Assigned);
    }
    return undefined;
  };
  /** Atomically through this writer's own temporary file (a reader never sees half a file, review m1); two processes drawing
   * at once may each take the same arm (a slight imbalance, never a wrong arm). */
  const writeBlocks = (b: BlockState): void => {
    const file = join(dir, "blocks.json");
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(tmp, JSON.stringify(b) + "\n");
      renameSync(tmp, file);
    } catch (err) {
      console.warn(`experiments: cannot record the explore blocks: ${(err as Error).message}`);
    }
  };
  /**
   * The bench's assignment (<agentDir>/experiments/assignment.json, v 1, §10): the run's arm, adopted instead of a draw
   * whatever the mode. A file that is no such assignment is named once and ignored (the session is drawn as usual).
   */
  const fromFile = (sid: string, ctx: Parameters<typeof warnOnce>[0]): AssignmentV2 | undefined => {
    const file = join(dir, "assignment.json");
    let f: unknown;
    try {
      f = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined; // no file: a drawn session
      f = undefined; // unreadable or unparseable: named below
    }
    const ok = isRecord(f) && f.v === 1 && typeof f.design === "string" && f.stratum === "bench" && typeof f.arm === "string"
      && isRecord(f.factors) && Object.values(f.factors).every((x) => isRecord(x) && typeof x.lever === "string" && isLevel(x.assigned));
    if (!ok) { warnOnce(ctx, "experiments:assignment-file", `experiments: ignores ${file}: not a v 1 bench assignment (design, stratum "bench", arm, factors of lever and assigned level)`); return undefined; }
    const a = f as { design: string; stratum: string; arm: string; factors: AssignmentV2["factors"] };
    return { v: 2, ts: new Date().toISOString(), sessionId: sid, design: a.design, mode: settings.mode, eligible: true, stratum: a.stratum, arm: a.arm, factors: a.factors };
  };
  /** A new main's assignment: its stratum, and an arm when eligible (none left enabled: ineligible). */
  const assignNew = (sid: string, model: unknown, ctx: Parameters<typeof warnOnce>[0]): AssignmentV2 => {
    const given = fromFile(sid, ctx);
    if (given !== undefined) return given;
    const m = isRecord(model) && typeof model.provider === "string" && typeof model.id === "string" ? model : undefined;
    const stratum = m === undefined ? undefined : stratumOf(strata, plans, m.provider as string, m.id as string);
    const d = stratum === undefined ? undefined : designs.get(stratum);
    let arm: string | undefined;
    if (d !== undefined && settings.mode !== "off" && eligibleFor(false, stratum, settings.mode)) {
      const { blocks, bad } = parseBlocks(readJson(join(dir, "blocks.json")));
      if (bad) warnOnce(ctx, "experiments:blocks", `experiments: blocks.json in ${dir} held a malformed explore block; it is rebuilt`);
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

  // Guards: corrections and the end-of-session rating go to <agentDir>/guards/events.jsonl; only the fact, never text.
  const logGuard = (sessionId: string, event: string, value?: number): void => {
    if (child !== undefined) return; // a guard is the main session's user's (a child's input is its parent's message)
    try {
      mkdirSync(join(deps.agentDir, "guards"), { recursive: true });
      const a = lookup(sessionId);
      // The design id rides along (carry-over 1): a v2 arm id alone may look like a v1-engine one.
      appendFileSync(join(deps.agentDir, "guards", "events.jsonl"), JSON.stringify({ v: 1, ts: new Date().toISOString(), sessionId, arm: a?.arm, ...(a?.arm === undefined || a.design === undefined ? {} : { design: a.design }), event, ...(value === undefined ? {} : { value }) }) + "\n");
    } catch (err) {
      console.warn(`experiments: cannot record a guard event: ${(err as Error).message}`);
    }
  };
  const lastRole = new Map<string, string>();
  let correction: RegExp;
  try { correction = new RegExp(settings.correctionRegex, "i"); } catch { correction = new RegExp(defaults().correctionRegex, "i"); }
  pi.on("message_end", (e, ctx) => {
    lastRole.set(ctx.sessionManager.getSessionId(), e.message?.role);
    observeAt("message_end", e, ctx);
  });
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
    // spec D5: without the patched actor only the children's inheritance is off; the main session is assigned as before.
    if (!hasSubagentsApiV1(subagents())) warnOnce(ctx, "actor:experiments", actorMissing("experiments", "in-memory child agents are not recognised (children with a session file still run their root's arm)"));
    for (const w of warnings) warnOnce(ctx, `experiments:${w}`, w); // a dropped stratum (parseStrata says why)
    if (settings.legacy?.length) warnOnce(ctx, "experiments:legacy", `experiments: ignores the settings ${settings.legacy.join(", ")} (the v1 engine's): its factors come from strata (default: one stratum per billing class); baseline only labels the analyses of v1–v4 designs`);
    const main = ctx.sessionManager.getSessionId() as string;
    noteEnv(ctx);
    watch(main, ctx);
    // An extension that does not know pi-economics cannot ask the channel: its tools show it is loaded (§7.4).
    // pi 1.4's getAllTools lists every registered tool; where it is absent (or throws) no target is detected by its tools.
    const tools = safe(() => pi.getAllTools?.());
    if (Array.isArray(tools) && tools.some((t) => t?.name === IC_TOOL)) loaded(IC_TARGET);
    // A child's runtime (experiments among the actor's childExtensions): never drawn, no row; its arm is its root's.
    const file = safe(() => ctx.sessionManager.getSessionFile() as string | undefined);
    const root = rootOf(main, file, safe(() => ctx.hasUI));
    child = root === undefined ? undefined : { sid: main, root };
    if (child !== undefined) {
      const a = deriveChild(child);
      return a === undefined ? undefined : adopt(a);
    }
    // Resumed or reloaded: the branch's own entry (a fork's names the session it was forked from: a new unit), else the
    // session's row (a v1 engine's included).
    const entry = fromBranch(safe(() => ctx.sessionManager.getBranch()), main);
    if (entry !== undefined) return adopt(entry);
    const prior = rows().find((r) => r.sessionId === main);
    const resumed = prior && fromRow(prior);
    if (resumed) return adopt(resumed);
    const row = assignNew(main, safe(() => ctx.model), ctx);
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
