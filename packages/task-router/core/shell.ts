// All extension logic, free of pi imports so it runs under node's test runner with test/fake-pi.ts.
// Outcome log, `task_verdict`, the spawn policy and the guards that watch the swarm.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
import { installNudge } from "./nudge.ts";
import type { NudgePi } from "./nudge.ts";
import { createGate, runCheck } from "./gate.ts";
import type { Runner } from "./gate.ts";
import { createGuards } from "./guards.ts";
import { createOutcomeLog } from "./log.ts";
import { cardSection } from "./prompt.ts";
import { createPolicy } from "./policy.ts";
import { spotCheckDue, spotCheckText } from "./spotcheck.ts";
import type { Child, PolicyDeps } from "./policy.ts";
import type { SkillPort } from "./profile.ts";
import type { ThinkingLevel } from "./types.ts";
import type { FsPort } from "./verify.ts";
import { outcomeFile, serializeEvent } from "./outcome.ts";
import type { OutcomeEvent } from "./outcome.ts";
import { UNROUTED_CARD, unroutedPlan } from "./unrouted.ts";
import { defaults } from "./settings.ts";
import type { Settings } from "./settings.ts";

export type ToolResult = { content: { type: "text"; text: string }[]; details: unknown; isError?: boolean };
export type PiLike = NudgePi & {
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
  const children = new Map<string, Child>();
  let skills: Array<{ name: string; filePath: string; baseDir: string }> = [];
  const skillPort: SkillPort = { find: (n) => skills.find((x) => x.name === n), read: (path) => readFileSync(path, "utf8") };
  const counter = createMemberCounter(join(deps.agentDir, "task-router", "member-count.json"), now);
  const pd: PolicyDeps = {
    settings, api, children, attempts: new Map(), now: nowMs, skills: () => skillPort,
    rng: deps.rng ?? Math.random, home: deps.home ?? homedir(),
    fs: deps.fs ?? { exists: existsSync, size: (p) => statSync(p).size, isDir: (p) => existsSync(p) && statSync(p).isDirectory() },
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    probe: createProbes({ fetch: deps.fetch ?? (globalThis.fetch as unknown as FetchLike), now: nowMs }), counter, blocks: new Map(),
  };
  const policy = createPolicy(pd);
  const failover = createFailover({ ...pd, log });
  const guards = createGuards(pd);
  const gate = createGate({ ...pd, log, run: deps.run ?? runCheck });
  const onEvent = (e: ApiEvent): void => {
    const c = children.get((e as { name?: string }).name ?? "");
    if (e.type === "spawn" && c) {
      log.spawn({ taskId: e.name, card: c.card, plan: c.plan, start: c.start, arm: armOf(c.parentSession), sessionId: e.childSessionId, parentSessionId: c.parentSession, unresolved: c.unresolved });
      if (c.esc) { // from the attempt state (D9): the failed attempt's entry may be gone (killed), its ranMember is not
        const ran = settings.models[c.esc.ranMember], to = settings.models[c.start.member];
        log.escalate(e.name, ran?.route ?? "?", to?.route ?? "?", c.card.attemptOf, {
          fromModel: ran?.model, toModel: c.start.model, ability: c.plan.ability, fromLevel: c.esc.fromLevel, toLevel: c.esc.toLevel,
        });
      }
    }
    if (e.type === "spawn" && !c && !settings.routing && e.name !== "main") { // nothing routed it, but the outcome log still knows the child
      const agents = api()?.list() ?? [];
      const kid = agents.find((a) => a.name === e.name);
      const parentSession = agents.find((a) => a.name === e.parent)?.sessionId;
      if (kid) log.spawn({ taskId: e.name, card: UNROUTED_CARD, plan: unroutedPlan(kid, settings), arm: parentSession && armOf(parentSession), sessionId: e.childSessionId, parentSessionId: parentSession });
    }
    if (e.type === "turn" && c && settings.models[c.member]?.dailyCap !== undefined) counter.bump(c.member); // one request per turn, 429 retries included
    failover(e);
    gate(e);
    guards(e);
    if (e.type === "kill") { log.killed(e.name); children.delete(e.name); }
  };
  // The API may appear after this extension loads (load order), so connect at install and again at session_start.
  let off: (() => void)[] = [];
  const connect = (): void => {
    const a = api();
    if (off.length || !a) return;
    try { off = [a.registerSpawnPolicy(policy), a.subscribe(onEvent)]; } catch (err) { console.warn(`task-router: no spawn policy: ${(err as Error).message}`); }
  };
  connect();
  const problems = deps.problems ?? [];
  for (const p of problems) console.warn(`task-router: ${p}`);
  let told = false;
  pi.on("session_start", (_e, ctx) => {
    track(ctx); connect();
    if (told || !problems.length) return;
    told = true;
    ctx?.ui?.notify?.(`task-router settings: ${problems.join("; ")}`, "warning");
  });
  pi.on("session_shutdown", () => { off.forEach((f) => f()); off = []; });
  installEffortGuard(pi, settings.maxBurstTurns);
  installFreshOnCold(pi, { settings, api, now: nowMs });
  // The router is a main-session extension; the child check keeps the nudge out of a child that loads it anyway.
  const isChild = (ctx: any): boolean => {
    const sid = ctx?.sessionManager?.getSessionId?.() ?? sessionId;
    return !!sid && (api()?.list() ?? []).some((a) => a.sessionId === sid && a.name !== "main");
  };
  installNudge(pi, { settings, isChild });
  pi.on("before_agent_start", (e, ctx) => {
    track(ctx);
    skills = e.systemPromptOptions?.skills ?? skills;
    const sections = e.systemPromptOptions?.sections;
    if (!sections) return;
    // A child inherits its parent's arm, so the delegationRule flag reads "on" there too: the rule is the main session's.
    if (settings.routing) sections.task_cards = cardSection(settings, settings.delegation.rule === "on" && !isChild(ctx));
    else delete sections.task_cards;
  });

  pi.registerTool({
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
  });
  return { log, settings };
}
