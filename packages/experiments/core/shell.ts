// All extension logic, free of pi imports so it runs under node's test runner.
// One arm per main session: assigned at session_start (sticky per session id), recorded in
// <agentDir>/experiments/assignments.jsonl, published as the global API; children inherit via
// spawn events, and a RESUMED child (whose spawn event was lost to the process restart) re-derives
// the arm from its session file layout on lookup.
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createApi } from "./api.ts";
import { assign, type State } from "./assign.ts";
import { design, type Arm } from "./design.ts";
import { defaults, type Settings } from "./settings.ts";

export type PiLike = {
  on(name: string, handler: (e: any, ctx: any) => unknown): void;
  registerCommand(name: string, command: { description: string; handler: (args: string, ctx: any) => unknown }): void;
};
/** The part of the actor-subagents API this package reads (own copy: packages do not import each other); the type check compares it with the provider's SubagentsApiV1 (spec §5.3). */
export type SubagentsApi = {
  list(): Array<{ name: string; sessionId: string }>;
  subscribe(l: (e: { type: string; parent?: string; childSessionId?: string }) => void): () => void;
};
export type Deps = { agentDir: string; settings?: Settings; rng?: () => number; api?: () => SubagentsApi | undefined };
/**
 * `design` is absent on v1 lines (five factors, 5-char arm ids); v2 = six factors, 2^(6-2); v3 (T8.10) = the same factors and arms as v2,
 * but foldHint = cache-aware now adds a paragraph to the system prompt, so v2 and v3 sessions must never be pooled. New assignments are v3;
 * a resumed session finds its row and keeps the design (and arm) it was assigned under.
 */
type Row = { sessionId: string; arm: string; design?: string; flags?: Record<string, string> };
const DESIGN = "v3";

const readJson = (file: string): unknown => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
};

export function install(pi: PiLike, deps: Deps): void {
  const settings = deps.settings ?? defaults();
  const dir = join(deps.agentDir, "experiments");
  const arms = design(settings.factors, settings.maxArms);
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

  const rows = (): Row[] => {
    try {
      return readFileSync(join(dir, "assignments.jsonl"), "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l) as Row]; } catch { return []; } });
    } catch { return []; }
  };
  const state = (done: Row[]): State => {
    const raw = readJson(join(dir, "state.json")) as Partial<State> | undefined;
    const counts: Record<string, number> = {};
    for (const r of done) if (r.design === DESIGN) counts[r.arm] = (counts[r.arm] ?? 0) + 1; // v1/v2 rows are another experiment: they do not balance this one
    return { counts, disabled: Array.isArray(raw?.disabled) ? raw.disabled : [], ...(raw?.posterior && typeof raw.posterior === "object" ? { posterior: raw.posterior } : {}) };
  };

  let off: (() => void) | undefined;
  const connect = (): void => {
    const a = subagents();
    if (off || !a) return;
    off = a.subscribe((e) => {
      if (e.type !== "spawn" || !e.childSessionId || main === undefined) return;
      api.inherit(e.childSessionId, a.list().find((x) => x.name === e.parent)?.sessionId ?? main);
    });
  };
  connect();

  // Guards (spec §5.6.3, T8.7): corrections and the end-of-session rating go to <agentDir>/guards/events.jsonl; only the fact, never text.
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
    main = ctx.sessionManager.getSessionId() as string;
    try { sessionDir = ctx.sessionManager.getSessionDir() as string | undefined; } catch { sessionDir = undefined; }
    const done = rows();
    const prior = done.find((r) => r.sessionId === main);
    // A prior row whose arm is not in the current design (a v1 session) keeps the arm and flags it was run with.
    const recorded = (r: Row): Arm | undefined => (r.flags && typeof r.flags === "object" ? { id: r.arm, flags: r.flags } : undefined);
    const arm: Arm = (prior && (arms.find((a) => a.id === prior.arm) ?? recorded(prior))) || assign(settings.mode, arms, state(done), rng, settings.minExplore, settings.baseline);
    remember(main, arm);
    if (prior) return;
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "assignments.jsonl"), JSON.stringify({ v: 1, ts: new Date().toISOString(), sessionId: main, arm: arm.id, design: DESIGN, mode: settings.mode, flags: arm.flags }) + "\n");
    } catch (err) {
      console.warn(`experiments: cannot record the assignment: ${(err as Error).message}`);
    }
  });
}
