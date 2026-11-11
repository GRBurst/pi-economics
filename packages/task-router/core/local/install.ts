// The main session's hints (design §3.1.1, §3.1.2, §3.1.4; plan S12): the router records the main session's tool calls, runs
// the pure detectors after every result and turn, and appends the fixed hint texts to the tool result of the call that
// tripped (the pattern of core/fresh.ts). Trips found at `turn_end` wait for the next result (plan D17). Every handler is
// total (AC-H5): `tool_call` never returns a value (pi blocks on a throw), and a failure is reported once and passes the
// result through unchanged.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ApiEvent, SubagentsApiV1 } from "../api.ts";
import type { ForcePort } from "../forceinstall.ts";
import type { createOutcomeLog } from "../log.ts";
import type { RouterSettings } from "../types.ts";
import { createBranchStore } from "./branches.ts";
import { startBranchTool } from "./branchtool.ts";
import type { RouterTool } from "./branchtool.ts";
import { createGit, gitRunner } from "./git.ts";
import type { Git } from "./git.ts";
import { block, createHintEngine } from "./hints.ts";
import type { Delivery } from "./hints.ts";
import { activeSet, componentOn } from "./mode.ts";
import { gitGuard } from "./childguards.ts";
import type { Guard } from "../toolguard.ts";
import { inside, refreshAbandoned, refreshFacts, writeGuard } from "./worktree.ts";
import { BUDGET_TYPE, budgetOf, createOverseer } from "./overseer.ts";
import { createApprovals, requestMergeTool } from "./merge.ts";
import { runCheck } from "../gate.ts";
import type { Runner } from "../gate.ts";
import { tmpdir } from "node:os";
import type { FixerPort } from "./merge.ts";
import { STEER_RECORDS, STEER_TYPE, cmdOf, createSteer } from "./steer.ts";
import type { Budget, Tickets } from "./overseer.ts";
import { callKey, callTrips, changed, checkPassed, contextSoft, contextStall, errSig, normOf, overSize, push, riskGlobsOf } from "./tripwires.ts";
import type { CallRecord, Trip } from "./tripwires.ts";

type Pi = {
  on(name: string, handler: (e: any, ctx: any) => unknown): void; appendEntry?(customType: string, data: unknown): void;
  sendMessage?(message: { customType: string; content: string; display: boolean }, options?: { deliverAs?: "steer" }): void;
  registerTool?(tool: RouterTool): void;
};
export type LocalDeps = {
  settings: RouterSettings; log: Pick<ReturnType<typeof createOutcomeLog>, "hint" | "review">; isChild(ctx: any): boolean; sessionId(): string | undefined;
  /** The overseer's ports (plan S20): the actor API, the shell's tickets, random hex, the clock and its poll sleep. */
  api(): SubagentsApiV1 | undefined; tickets: Tickets; hex(bytes: number): string; now(): number; sleep(ms: number): Promise<void>;
  /** The router's spawn policy is registered (review F1). */
  policyOn(): boolean;
  /** The force override: the fixer runs under it (D47). */
  force?: ForcePort;
  /** The merge checks' runner (default: runCheck); a test seam. */
  run?: Runner;
  /** The git port (default: the real one); a test seam. */
  git?: Git;
  /** After every budget change and rebuild (the status line, design §2.5). */
  onBudget?(): void;
  /** A file's hash; undefined when it cannot be read (§3.1.4). Default: sha256 of its bytes. */
  hash?(abs: string): string | undefined;
  /** The call detectors (a test seam, AC-H5). */
  detect?: typeof callTrips;
  /** The status suffix (plan Q5): the trip of the last hint, undefined at the next progress. */
  onTrip?(trip: Trip | undefined): void;
};

const WRITERS = new Set(["edit", "write"]);
export const fileHash = (abs: string): string | undefined => {
  try { return createHash("sha256").update(readFileSync(abs)).digest("hex"); } catch { return undefined; }
};
/** A call a tool made through `ctx.executeTool` (pi docs/extensions.md): its result reaches only the calling tool, so it is
 *  neither recorded nor annotated, and it consumes nothing queued (L3 follow-up). */
const nested = (e: any): boolean => typeof e?.parentToolCallId === "string";
const textOf = (content: unknown): string =>
  Array.isArray(content) ? content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n") : "";

/** The overseer and its budget (design §3.2, D30), the branches and `start_branch` (§3.3); `start` rebuilds the budget and the
 *  branches from the session branch (the shell's session_start). The hints are a no-op unless on (`hints.enabled`: "on", or "auto"
 *  in local mode); `start_branch` is registered when worktrees are on. */
export function installLocal(pi: Pi, d: LocalDeps) {
  const budget: Budget = { opusUsed: 0, steerUsed: 0 };
  /** The main session's cwd, the main checkout (LD14; L6 may take L5's repository root instead). */
  let base: string | undefined;
  const overseer = createOverseer({
    api: d.api, settings: d.settings, tickets: d.tickets, hex: d.hex, now: d.now, sleep: d.sleep, budget, log: d.log,
    policyOn: d.policyOn, force: d.force, warn: (text) => console.warn(text), base: () => base ?? process.cwd(),
    append: (type, data) => { pi.appendEntry?.(type, data); if (type === BUDGET_TYPE) d.onBudget?.(); },
  });
  const git = d.git ?? createGit(gitRunner());
  const branches = createBranchStore((type, data) => pi.appendEntry?.(type, data));
  /** Merge approvals (design §3.4.3), rebuilt from the session at `start`. */
  const approvals = createApprovals((type, data) => pi.appendEntry?.(type, data));
  let ready: Promise<void> = Promise.resolve(), sizing: Promise<void> | undefined;
  const handle = {
    overseer, budget, branches, approvals,
    start(ctx: any): void {
      if (typeof ctx?.cwd === "string") base = ctx.cwd;
      let branch: unknown;
      try { branch = ctx?.sessionManager?.getBranch?.(); } catch { branch = undefined; }
      const entries = Array.isArray(branch) ? branch : [];
      Object.assign(budget, budgetOf(entries));
      branches.rebuild(entries);
      approvals.rebuild(entries);
      // Off the event: branches whose worktree disappeared are abandoned (§3.3.4), then the guards' cached facts are refreshed for
      // every repository the session knows (plan D39). `start_branch` waits for it.
      const deps = { git, store: branches, settings: d.settings };
      ready = (async () => {
        await refreshAbandoned(deps);
        for (const repo of new Set(branches.all().map((r) => r.repo))) await refreshFacts(deps, repo);
      })().catch(() => undefined);
    },
    /** Resolves when the work `start` began has finished (a test seam, and what `start_branch` awaits). */
    ready: (): Promise<void> => ready,
    /** Resolves when no diff read is running or waiting (a test seam). */
    settled: async (): Promise<void> => { while (sizing) await sizing; await ready; },
    /** The git guard for a session in `cwd` (design §3.4.5) while the merge gate is on, else undefined: a routed child's. */
    /** Spawns the fixer (design §3.4.4). */
    fixer: ((x) => overseer.fixer({ ...x, toolGuard: handle.gitGuard(x.worktree) })) as FixerPort,
    /** The fixer's report (a route fixer→main) or its death (kill, error) gives the branch back (design §3.4.4); the router kills
     *  a fixer that reported (D46). Total. */
    onEvent(e: ApiEvent): void {
      try {
        const name = e.type === "route" ? (e.to === "main" ? e.from : undefined) : e.type === "kill" || e.type === "error" ? e.name : undefined;
        if (name === undefined) return;
        if (e.type === "kill" && d.tickets.owner(name)?.role === "fixer") d.tickets.forget(name);
        const rec = branches.all().find((r) => r.state === "fixer" && r.fixer === name);
        if (!rec) return;
        const { fixer: _gone, ...rest } = rec;
        branches.put({ ...rest, state: "active" });
        if (e.type === "route") void d.api()?.kill?.([name]).catch(() => []);
      } catch { /* an event handler never throws */ }
    },
    gitGuard: (cwd: string): Guard | undefined =>
      activeSet(d.settings).mergeGate ? gitGuard(d.settings.mergeGate.mainBranches, (dir) => git.branchOf(dir), cwd) : undefined,
  };
  const s = d.settings, h = s.hints;
  if (componentOn(s, "worktrees")) pi.registerTool?.(startBranchTool({ git, store: branches, settings: s }, () => ready));
  // request_merge (design §3.4.1) while the merge gate is active; one set of ports per call, with its AbortSignal (D49).
  if (activeSet(s).mergeGate) {
    pi.registerTool?.(requestMergeTool((signal) => ({ git, run: d.run ?? runCheck, overseer, branches, approvals, settings: s,
      append: (type, data) => pi.appendEntry?.(type, data), tmp: () => join(tmpdir(), `task-router-red-${d.hex(6)}`), fixer: handle.fixer,
      ...(signal && { signal }) }), () => ready));
  }
  // The main-checkout write guard (design §3.3.3). It blocks on purpose, so it is total itself: pi treats a throwing handler as a
  // block. Registered after the hint recorder's `tool_call` handler, so that call is recorded first.
  const guardWrites = (): void => {
    if (!componentOn(s, "worktrees")) return;
    let blocked = 0;
    pi.on("tool_call", (e, ctx) => {
      try {
        if (d.isChild(ctx)) return undefined;
        const tool = String(e?.toolName), active = branches.active();
        const reason = writeGuard({ tool, input: e?.input, cwd: ctx?.cwd ?? process.cwd(), active,
          mainCheckout: active && branches.facts.mainCheckout.get(active.repo), worktrees: (active && branches.facts.worktrees.get(active.repo)) ?? [],
          fixerDirs: branches.all().filter((r) => r.state === "fixer").map((r) => r.worktree) });
        if (reason === undefined) {
          if (WRITERS.has(tool)) blocked = 0; // the count is of blocks since the last write that passed
          return undefined;
        }
        d.log.hint("main", "outside-worktree", "hint", ++blocked, d.sessionId());
        return { block: true, reason };
      } catch { return undefined; }
    });
  };
  // The main session's git guard (design §3.4.5): `bash` and `powershell` calls that write a main branch are blocked. It fails
  // closed for git only (LD8): a handler that throws on a command with a git token blocks it.
  const guardMain = (): void => {
    if (!activeSet(s).mergeGate) return;
    const verdict = (why: string | undefined) => (why === undefined ? undefined : { block: true, reason: why });
    pi.on("tool_call", (e, ctx) => {
      let child = false;
      try { child = d.isChild(ctx); } catch { /* the main session's */ }
      if (child) return undefined;
      const r = handle.gitGuard(ctx?.cwd ?? process.cwd())!(String(e?.toolName), e?.input);
      return r instanceof Promise ? r.then(verdict) : verdict(r);
    });
  };
  if (!componentOn(s, "hints")) { guardWrites(); guardMain(); return handle; }
  // A persistent trip runs a steer overseer instead of the escalation block while one can run (design §3.1.2, AC-H4).
  const steer = createSteer({ settings: s, overseer, git,
    branch: () => { const a = branches.active(); return a && { worktree: a.worktree, base: a.base, goal: a.goal, check: a.check }; },
    send: (content) => pi.sendMessage?.({ customType: STEER_TYPE, content, display: true }, { deliverAs: "steer" }) });
  const hash = d.hash ?? fileHash, detect = d.detect ?? callTrips;
  const engine = createHintEngine(h, s.plans);
  const globs = riskGlobsOf(s), seen = new Set<string>();
  /** The command that proves the active branch (D41; a plan-bound branch carries its task's check the same way). */
  const activeChecks = (): string[] => { const c = branches.active()?.check; return c ? [c] : []; };
  const pending = new Map<string, Omit<CallRecord, "turn">>(); // toolCallId → the call's record so far
  let ring: CallRecord[] = [], queue: Delivery[] = [];
  let turn = 0, call = 0, armed = true, stall = 0, progressed = false, shown = false, warned = false;
  const safe = <T>(f: () => T): T | undefined => {
    try { return f(); } catch (err) {
      if (!warned) { warned = true; console.warn(`task-router: hint engine: ${(err as Error)?.message ?? String(err)}`); }
      return undefined;
    }
  };
  /** over-size (§3.1.1): the diff is a git process, so it is read off the event, one at a time (a write that comes meanwhile
   *  makes one more read), and its trip waits for the next result like a turn-end trip (plan D17). A timeout or a failure
   *  gives an empty diff: no trip (§3.1.4). */
  let again = false;
  const checkSize = (): void => {
    if (sizing) { again = true; return; }
    sizing = (async () => {
      do {
        again = false;
        const a = branches.active();
        if (!a) return;
        if (overSize(await git.diffStat(a.worktree, a.base), s.plans)) queue.push(...engine.detected(["over-size"], call));
      } while (again);
    })().catch(() => undefined).finally(() => { sizing = undefined; });
  };
  const soft = (ctx: any): Trip[] => {
    const r = contextSoft(armed, ctx?.getContextUsage?.()?.tokens, h);
    armed = r.armed;
    return r.fire ? ["context-soft"] : [];
  };
  pi.on("tool_call", (e, ctx) => {
    safe(() => {
      if (d.isChild(ctx) || typeof e?.toolCallId !== "string" || nested(e)) return;
      const tool = String(e.toolName), isWrite = WRITERS.has(tool), p = e.input?.path;
      const path = isWrite && typeof p === "string" ? resolve(ctx?.cwd ?? process.cwd(), p) : undefined;
      pending.set(e.toolCallId, { tool, key: callKey(tool, e.input), isWrite, path, hashBefore: path === undefined ? undefined : hash(path),
        cmd: cmdOf(tool, e.input), norm: normOf(tool, e.input) });
    });
    return undefined;
  });
  pi.on("tool_result", (e, ctx) => safe(() => {
    if (d.isChild(ctx) || nested(e)) return undefined;
    const rec = pending.get(e?.toolCallId);
    pending.delete(e?.toolCallId);
    const out = queue;
    queue = [];
    const trips: Trip[] = [];
    if (rec) {
      call += 1;
      const isError = e.isError === true;
      const r: CallRecord = { ...rec, turn, isError, errSig: isError ? errSig(textOf(e.content)) : undefined,
        hashAfter: rec.path === undefined ? undefined : hash(rec.path) };
      ring = push(ring, r, h);
      const active = branches.active();
      if (r.isWrite && !isError && r.path !== undefined && active && inside(r.path, active.worktree)) checkSize();
      const checks = activeChecks();
      if (changed(r) || checkPassed(r, checks)) { // progress (plan D15; a passing check, D41): the persistence counts, the stall and the status suffix reset
        engine.progress();
        stall = 0;
        progressed = true;
        if (shown) { shown = false; d.onTrip?.(undefined); }
      }
      const cwd = ctx?.cwd ?? process.cwd();
      trips.push(...detect(ring, h, { globs, seen, rel: (x) => relative(cwd, x), checks }));
      if (trips.includes("risky-path") && r.path !== undefined) seen.add(r.path); // once per path
    }
    trips.push(...soft(ctx));
    out.push(...engine.detected(trips, call));
    if (!out.length) return undefined;
    const cwd = ctx?.cwd ?? process.cwd(), blocks: string[] = [];
    for (const x of out) {
      d.log.hint("main", x.trip, x.stage, x.n, d.sessionId());
      // A path as the steer input shows it: relative to the active worktree when inside it, else to the session's cwd.
      const wt = branches.active()?.worktree;
      if (x.stage === "steer" && steer.available()) steer.start(x.trip, x.n, ring.slice(-STEER_RECORDS), cwd, (p) => relative(wt !== undefined && inside(p, wt) ? wt : cwd, p));
      else blocks.push(block(x.trip, x.n, x.text));
    }
    shown = true;
    d.onTrip?.(out[out.length - 1].trip);
    if (!blocks.length) return undefined;
    return { content: [...(Array.isArray(e.content) ? e.content : []), ...blocks.map((text) => ({ type: "text", text }))] };
  }));
  guardWrites();
  guardMain();
  pi.on("turn_end", (_e, ctx) => {
    safe(() => {
      if (d.isChild(ctx)) return;
      turn += 1;
      const st = contextStall(stall, progressed, ctx?.getContextUsage?.()?.percent, h);
      stall = st.stall;
      progressed = false;
      const trips = [...soft(ctx), ...(st.fire ? ["context-stall" as const] : [])];
      if (trips.length) queue.push(...engine.detected(trips, call));
    });
    return undefined;
  });
  return handle;
}
