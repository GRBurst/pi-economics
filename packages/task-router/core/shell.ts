// All extension logic, free of pi imports so it runs under node's test runner with test/fake-pi.ts.
// Outcome log, `task_verdict`, the spawn policy and the guards that watch the swarm.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ApiEvent, SubagentsApiV1 } from "./api.ts";
import { createProbes } from "./health.ts";
import type { FetchLike } from "./health.ts";
import { createMemberCounter } from "./counter.ts";
import { installEffortGuard } from "./effort.ts";
import { createFailover } from "./failover.ts";
import { withFlags } from "./flags.ts";
import { installFreshOnCold } from "./fresh.ts";
import { describeForce } from "./force.ts";
import { installForce } from "./forceinstall.ts";
import type { ForcePi } from "./forceinstall.ts";
import { installNudge } from "./nudge.ts";
import type { NudgePi } from "./nudge.ts";
import { createGate, runCheck } from "./gate.ts";
import type { Runner } from "./gate.ts";
import { createGuards } from "./guards.ts";
import { createOutcomeLog } from "./log.ts";
import { cardSection, localSection } from "./prompt.ts";
import { isLocal, statusText } from "./local/mode.ts";
import { installLocal } from "./local/install.ts";
import { createChildTrips } from "./local/childtrips.ts";
import { createTickets } from "./local/overseer.ts";
import type { LocalDeps } from "./local/install.ts";
import type { Trip } from "./local/tripwires.ts";
import { enabled } from "./members.ts";
import { createPolicy } from "./policy.ts";
import { spotCheckDue, spotCheckText } from "./spotcheck.ts";
import type { Child, PolicyDeps } from "./policy.ts";
import type { SkillPort } from "./profile.ts";
import type { ThinkingLevel } from "./types.ts";
import type { FsPort } from "./verify.ts";
import { outcomeFile, serializeEvent } from "./outcome.ts";
import type { OutcomeEvent } from "./outcome.ts";
import { UNROUTED_CARD, unroutedPlan } from "./unrouted.ts";
import { actorMissing, hasSubagentsApiV1, warnOnce } from "./runtime-guard.ts";
import { defaults } from "./settings.ts";
import type { Settings } from "./settings.ts";

export type ToolResult = { content: { type: "text"; text: string }[]; details: unknown; isError?: boolean };
export type PiLike = NudgePi & ForcePi & {
  on(name: string, handler: (e: any, ctx: any) => unknown): void;
  registerTool(tool: {
    name: string; label: string; description: string; parameters: unknown;
    execute(id: string, params: any, signal: unknown, onUpdate: unknown, ctx: any): Promise<ToolResult>;
  }): void;
  events?: { on(name: string, handler: (d: any) => void): void };
  getThinkingLevel?(): ThinkingLevel;
  setThinkingLevel?(level: ThinkingLevel): void;
};
/** What the task-router reads of the experiments package's globalThis.__piExperimentsApi_v1; the type check compares it with the provider's ExperimentsApiV1 (spec §5.3). */
export type ExperimentsApi = { flag(n: string, d: string, s?: string): string; armFor?(s: string): { id?: string } | undefined };
export type Deps = {
  agentDir: string; now?: () => Date; settings?: Settings;
  /** What the settings loader found wrong (spec §5.4); reported once by the shell (T1.8). */
  problems?: string[];
  /** The actor-subagents API; default `globalThis.__subagentsApi_v1`. */
  api?: () => SubagentsApiV1 | undefined;
  fetch?: FetchLike; fs?: FsPort; sleep?: (ms: number) => Promise<void>; run?: Runner;
  /** Random source for randomize / spot checks (default Math.random); home dir for `~` in a card cwd (default os.homedir()). */
  rng?: () => number; home?: string;
  /** The hint engine's file hash and call detectors (test seams, plan S12). */
  hash?: LocalDeps["hash"]; detect?: LocalDeps["detect"];
};

const VERDICTS = ["accepted", "partial", "rejected"] as const;
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], details: {}, ...(isError ? { isError } : {}) });

export function install(pi: PiLike, deps: Deps) {
  const own = deps.settings ?? defaults();
  // routing / verifyGate / autoEscalate / freshOnCold come from the experiments arm when that package is loaded.
  let sessionId: string | undefined;
  const settings = withFlags(own, (name, def) =>
    (globalThis as { __piExperimentsApi_v1?: ExperimentsApi }).__piExperimentsApi_v1?.flag(name, def, sessionId) ?? def);
  const armOf = (sid: string): string | undefined =>
    (globalThis as { __piExperimentsApi_v1?: ExperimentsApi }).__piExperimentsApi_v1?.armFor?.(sid)?.id;
  const track = (ctx: any): void => { sessionId = ctx?.sessionManager?.getSessionId?.() ?? sessionId; };
  const now = deps.now ?? (() => new Date());
  const made = new Set<string>();
  const append = (e: OutcomeEvent): void => {
    try {
      const file = outcomeFile(deps.agentDir, now());
      if (!made.has(dirname(file))) { mkdirSync(dirname(file), { recursive: true }); made.add(dirname(file)); }
      appendFileSync(file, serializeEvent(e));
    } catch (err) {
      console.warn(`task-router: outcome log write failed: ${(err as Error).message}`);
    }
  };
  const log = createOutcomeLog({ append, now });

  const nowMs = () => now().getTime();
  const api = deps.api ?? (() => (globalThis as { __subagentsApi_v1?: SubagentsApiV1 }).__subagentsApi_v1);
  // A routed child's tripwires (design §3.1.3): the policy composes their guard in local mode with hints on.
  const childTrips = createChildTrips({ settings, api, log });
  const children = new Map<string, Child>();
  const tickets = createTickets((bytes) => randomBytes(bytes).toString("hex"));
  let skills: Array<{ name: string; filePath: string; baseDir: string }> = [];
  const skillPort: SkillPort = { find: (n) => skills.find((x) => x.name === n), read: (path) => readFileSync(path, "utf8") };
  const counter = createMemberCounter(join(deps.agentDir, "task-router", "member-count.json"), now);
  // The force override (design §3.6): `/force` and the settings force; the policy reads its port (plan D7).
  const force = installForce(pi, { settings, log, onChange: (ctx) => { ui = ctx?.ui ?? ui; render(); } });
  const pd: PolicyDeps = {
    settings, api, children, attempts: new Map(), now: nowMs, skills: () => skillPort,
    rng: deps.rng ?? Math.random, home: deps.home ?? homedir(),
    fs: deps.fs ?? { exists: existsSync, size: (p) => statSync(p).size, isDir: (p) => existsSync(p) && statSync(p).isDirectory() },
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    probe: createProbes({ fetch: deps.fetch ?? (globalThis.fetch as unknown as FetchLike), now: nowMs }), counter, blocks: new Map(),
    force: force.port, childGuard: (child, parent) => childTrips.guard(child, parent), tickets,
  };
  const policy = createPolicy(pd);
  const failover = createFailover({ ...pd, log });
  const guards = createGuards(pd);
  const gate = createGate({ ...pd, log, run: deps.run ?? runCheck });
  const onEvent = (e: ApiEvent): void => {
    const c = children.get((e as { name?: string }).name ?? "");
    // D26: the router's own child (an overseer, a fixer) is no entry of `children`; its line has no verdict slot.
    const t = e.type === "spawn" ? tickets.owner(e.name) : undefined;
    if (e.type === "spawn" && t) {
      log.ticketSpawn({ taskId: e.name, role: t.role, member: t.member, tier: settings.models[t.member]?.tier ?? "?", model: t.model, effort: t.effort,
        sessionId: e.childSessionId, parentSessionId: t.parentSession });
    }
    if (e.type === "spawn" && c) {
      log.spawn({ taskId: e.name, card: c.card, plan: c.plan, start: c.start, arm: armOf(c.parentSession), sessionId: e.childSessionId, parentSessionId: c.parentSession, unresolved: c.unresolved, forced: c.forced });
      if (c.esc) { // from the attempt state (D9): the failed attempt's entry may be gone (killed), its ranMember is not
        // An unknown attempt (RG6): its stand-in member is the new plan's, not where it ran, so the line names no `from` side.
        const ran = c.esc.known ? settings.models[c.esc.ranMember] : undefined, to = settings.models[c.start.member];
        log.escalate(e.name, ran?.route ?? "?", to?.route ?? "?", c.card.attemptOf, {
          fromModel: ran?.model, toModel: c.start.model, ability: c.plan.ability, ...(c.esc.known ? { fromLevel: c.esc.fromLevel } : {}),
          toLevel: c.esc.toLevel,
        });
      }
    }
    if (e.type === "spawn" && !c && !t && !settings.routing && e.name !== "main") { // nothing routed it, but the outcome log still knows the child
      const agents = api()?.list() ?? [];
      const kid = agents.find((a) => a.name === e.name);
      const parentSession = agents.find((a) => a.name === e.parent)?.sessionId;
      if (kid) log.spawn({ taskId: e.name, card: UNROUTED_CARD, plan: unroutedPlan(kid, settings), arm: parentSession && armOf(parentSession), sessionId: e.childSessionId, parentSessionId: parentSession });
    }
    if (e.type === "turn" && c && settings.models[c.member]?.dailyCap !== undefined) counter.bump(c.member); // one request per turn, 429 retries included
    failover(e);
    gate(e);
    guards(e);
    if (e.type === "kill") { log.killed(e.name); children.delete(e.name); childTrips.forget(e.name); }
  };
  // The API may appear after this extension loads (load order), so connect at install and again at session_start.
  // Nothing is printed here: install runs at session_start, with the TUI up, so a console write would land in it.
  // The failure waits for the session_start handler, which tells it through the UI (or the console without one).
  let off: (() => void)[] = [];
  let connectError: string | undefined;
  const connect = (): void => {
    const a = api();
    if (off.length || !hasSubagentsApiV1(a)) return;
    try { off = [a.registerSpawnPolicy(policy), a.subscribe(onEvent)]; connectError = undefined; } catch (err) { connectError = (err as Error).message; }
  };
  connect();
  const problems = deps.problems ?? [];
  // Registered once, at the first session_start with the API (pi supports tools registered after load).
  const verdictTool: Parameters<PiLike["registerTool"]>[0] = {
    name: "task_verdict",
    label: "Task verdict",
    description: "Record your judgement of a subagent's result before you kill it: accepted, partial or rejected. A child killed without a verdict is logged as unjudged.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the subagent." },
        verdict: { type: "string", enum: [...VERDICTS] },
        note: { type: "string", description: "Optional one-line reason." },
      },
      required: ["name", "verdict"],
    },
    async execute(_id, p) {
      if (!VERDICTS.includes(p?.verdict)) return text(`verdict must be one of ${VERDICTS.join(", ")}`, true);
      const name = String(p.name);
      const card = children.get(name)?.card;
      if (!log.verdict(name, p.verdict, typeof p.note === "string" ? p.note : undefined, card?.reviewOf)) return text(`unknown task "${p.name}": no spawn logged for it`, true);
      const done = `verdict ${p.verdict} recorded for ${p.name}`;
      // T5.22: the caller of task_verdict is the parent that accepted, so the instruction goes into this result (no extra turn).
      if (!spotCheckDue(card, p.verdict, settings.spotCheck, pd.rng)) return text(done);
      log.spotcheck(name);
      return text(`${done}\n${spotCheckText(name)}`);
    },
  };
  let verdictRegistered = false;
  const registerVerdict = (): void => {
    if (verdictRegistered) return;
    verdictRegistered = true;
    pi.registerTool(verdictTool);
  };
  // Routing needs the actor's spawn-policy API (spec D5). Every factory runs before the first session_start, so the
  // check there is load-order independent; until then (and without the API) the router is off.
  let active = false;
  let told = false;
  // The status line (design §2.5, OQ12): local mode, and an active force (plan Q4); default mode without a force never touches
  // it. A force can change outside an event with a ctx (a forced spawn counts down), so the last UI and main model are kept.
  const localModels = enabled(settings.models).filter((m) => m.route === "local").map((m) => m.model);
  let ui: any, main: string | undefined, shown = false, hint: Trip | undefined;
  const render = (): void => {
    const f = force.port.active();
    const t = statusText({ local: isLocal(settings), main, localModels, force: f && describeForce(f), hint });
    if (t !== undefined) { ui?.setStatus?.("task-router", t); shown = true; }
    else if (shown) { ui?.setStatus?.("task-router", undefined); shown = false; }
  };
  const showStatus = (ctx: any, model: any): void => {
    ui = ctx?.ui ?? ui;
    main = typeof model?.provider === "string" && typeof model?.id === "string" ? `${model.provider}/${model.id}` : undefined;
    render();
  };
  pi.on("session_start", (_e, ctx) => {
    track(ctx);
    force.start(ctx, problems); // plan D8: its problem joins the one notification below
    showStatus(ctx, ctx?.model);
    active = hasSubagentsApiV1(api());
    if (active) { connect(); registerVerdict(); }
    else warnOnce(ctx, "actor:task-router", actorMissing("task-router", "task-router routing is off (no task_verdict, no task_cards, no nudge); the effort guard and fresh-on-cold stay on"));
    if (connectError !== undefined) warnOnce(ctx, "spawn-policy:task-router", `task-router: no spawn policy: ${connectError}`);
    if (told || !problems.length) return;
    told = true;
    if (ctx?.hasUI && ctx.ui?.notify) ctx.ui.notify(`task-router settings: ${problems.join("; ")}`, "warning");
    else for (const p of problems) console.warn(`task-router: ${p}`);
  });
  if (isLocal(settings)) pi.on("model_select", (e, ctx) => { showStatus(ctx, e?.model); });
  pi.on("session_shutdown", () => { off.forEach((f) => f()); off = []; });
  installEffortGuard(pi, settings.maxBurstTurns);
  installFreshOnCold(pi, { settings, api, now: nowMs });
  // The router is a main-session extension; the child check keeps the nudge out of a child that loads it anyway.
  const isChild = (ctx: any): boolean => {
    const sid = ctx?.sessionManager?.getSessionId?.() ?? sessionId;
    return !!sid && (api()?.list() ?? []).some((a) => a.sessionId === sid && a.name !== "main");
  };
  // LD3 (design §2.4): local mode replaces the nudge with hints; its steer messages would interrupt a local main mid-task.
  installNudge(pi, { settings, isChild, enabled: () => active && !isLocal(settings) });
  // Hints (design §3.1, plan S12): in local mode, or anywhere with hints "on"; the status line names the last hint (plan Q5).
  installLocal(pi, { settings, log, isChild, sessionId: () => sessionId, hash: deps.hash, detect: deps.detect, onTrip: (t) => { hint = t; render(); } });
  pi.on("before_agent_start", (e, ctx) => {
    track(ctx);
    skills = e.systemPromptOptions?.skills ?? skills;
    const sections = e.systemPromptOptions?.sections;
    if (!sections) return;
    if (!active) { delete sections.task_cards; return; }
    // A child inherits its parent's arm, so the delegationRule flag reads "on" there too: the rule is the main session's.
    // Local mode (design §2.3, LD3): the main gets the local section and never the rule, whatever the arm says; a child that
    // loads the router anyway keeps today's section without the rule (plan D5).
    const local = isLocal(settings), child = isChild(ctx);
    if (settings.routing) sections.task_cards = local && !child ? localSection(settings) : cardSection(settings, !local && settings.delegation.rule === "on" && !child);
    else delete sections.task_cards;
  });

  return { log, settings, tickets };
}
