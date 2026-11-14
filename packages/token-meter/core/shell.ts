// All extension logic, free of pi imports so it runs under node's test runner with test/fake-pi.ts.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { effectiveSettings, extensionLevers } from "./effective-settings.ts";
import { LEVERS, LEVERS_QUERY, type Bus, type Levers, type LeversQuery } from "./channel.ts";
import { leverViolations, leversLine, serializeLevers, type LeverId, type LeverState } from "./levers.ts";
import { systemHash } from "./system-hash.ts";
import { Joiner } from "./join.ts";
import { errorKindOf } from "./errorkind.ts";
import { buildLine, monthFile, serialize } from "./line.ts";
import type { LineInput, Usage } from "./line.ts";
import { billingOf } from "./plans.ts";
import type { Snapshot } from "./ratelimit.ts";
import { defaults } from "./settings.ts";
import type { Settings } from "./settings.ts";

/** What the meter uses of pi's ExtensionAPI: event handlers, and pi.events for pi-economics' internal channel (M5b.2;
 * D19's retry events are gone). */
export type PiLike = { on(name: string, handler: (e: any, ctx: any) => unknown): void; events: Bus };
export type Deps = {
  agentDir: string;
  now?: () => Date;
  settings?: Settings;
  /** The environment pi reads (PI_CACHE_RETENTION); default: process.env. */
  env?: Record<string, string | undefined>;
};

/** pi usage → meter usage (cost.total → costUsd; pi 1.4's `cacheWrite1h` only where the provider reports it). */
function mapUsage(u: any): Usage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const out: Usage = { input: u.input ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0, output: u.output ?? 0 };
  if (typeof u.reasoning === "number") out.reasoning = u.reasoning;
  if (typeof u.cacheWrite1h === "number") out.cacheWrite1h = u.cacheWrite1h;
  if (typeof u.cost?.total === "number") out.costUsd = u.cost.total;
  return out;
}

const time = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN);

/** A JSON settings file, or undefined when missing or unreadable (the levers then show pi's defaults). */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function parentOf(file: unknown): string | undefined {
  if (typeof file !== "string") return undefined;
  // the actor's layout: <sessionDir>/subagents/<parent>/<file> (review n1: the directory that holds the file, not a higher one)
  return /[\\/]subagents[\\/]([^\\/]+)[\\/][^\\/]+$/.exec(file)?.[1];
}

export function install(pi: PiLike, deps: Deps): void {
  const settings = deps.settings ?? defaults();
  if (!settings.enabled) return;
  const now = deps.now ?? (() => new Date());
  const joiner = new Joiner();
  // pi 1.4's CacheWarmer can send a warm WHILE a long turn streams (its timer runs
  // from the turn's request start). A turn's own response always precedes its
  // assistant message_start, so between message_start and message_end every
  // response is a warm's: it waits in `warms`, never in the Joiner.
  const streaming = new Set<string>();
  const warms = new Map<string, Snapshot>();
  const lastModel = new Map<string, { provider: string; model: string }>();
  // A session's own request runs the agent loop's `context` hook just before its before_provider_request (pi 1.4
  // sdk.js transformContext); a warm (pi's CacheWarmer replays the request straight to the provider) and a
  // compaction request do not. Only such a turn send times a request or ends a retry wait.
  const turnSend = new Set<string>();
  // P7: when the session's request was sent (its last turn send), for the active time `durationMs` of its message_end.
  const sentAt = new Map<string, number>();
  /** The first provider_stream_event after that send (`ttftMs`). */
  const firstEvent = new Map<string, number>();
  /** M8: llama.cpp's `timings` of the request's last stream event that carried usable ones (`promptMs`, `genMs`, `cacheN`, `promptN`). */
  const timings = new Map<string, Timings>();
  // D19, P18: pi's native retry. A failed attempt (error message_end, not a context overflow) waits in `failedAt`
  // until the session's next send, which is its retry when nothing came between (pi resends after a backoff with no
  // message in between; a settled run or a new message means no retry follows). `retryWait` holds that send's wait.
  const failedAt = new Map<string, number>();
  const retryWait = new Map<string, number>();
  // M3b: the system state of the session's last own send (context_with_system, which pi 1.4 runs for those only),
  // for its message_end (`systemHash`, the analyser's `prefix` cause).
  const sysHash = new Map<string, string>();
  const madeDirs = new Set<string>();
  const warned = new Set<string>(); // once per kind of line: a levers failure must not hide a request line failure

  const env = deps.env ?? process.env;
  /** Per session, the last levers line written (without its ts): a new one only on change. */
  const leversSeen = new Map<string, string>();
  /** Per session, what its last prompt's levers line read of pi's settings, the branch and the session file (a
   * publication reuses it). */
  const leversBase = new Map<string, { parent?: string; levers: Record<LeverId, LeverState> }>();

  const warn = (err: unknown, what = "meter"): void => {
    if (!warned.has(what)) {
      warned.add(what);
      console.error(`token-meter: cannot write ${what} line:`, err instanceof Error ? err.message : err);
    }
  };
  const append = (at: Date, text: string): void => {
    const file = monthFile(deps.agentDir, at, settings.dir);
    if (!madeDirs.has(dirname(file))) {
      mkdirSync(dirname(file), { recursive: true });
      madeDirs.add(dirname(file));
    }
    appendFileSync(file, text);
  };
  const write = (input: LineInput): void => {
    try {
      const line = buildLine({ ...input, billing: billingOf(settings.plans, input.provider) });
      if (!settings.rawRatelimit) delete line.rawRatelimit;
      append(input.now, serialize(line));
    } catch (err) {
      warn(err);
    }
  };

  /**
   * The session's Levers from pi-economics' experiments engine (optional, never imported): its answer on the internal
   * channel (redesign §7.7), or undefined (no engine in this runtime, or a session it does not know).
   */
  const assignedOf = (sid: string): Levers | undefined =>
    safe(() => {
      let answer: Levers | undefined;
      const q: LeversQuery = { sessionId: sid, reply: (a) => void (answer ??= a) };
      pi.events.emit(LEVERS_QUERY, q);
      return answer;
    });

  /** The session's arm and, iff the assignment names them, its design and stratum (M3a T3a.9; M5b.1 carry-over 1: a v2
   * arm id alone may read as v4). */
  const experiment = (a: Levers | undefined): { arm: string; design?: string; stratum?: string } | undefined => {
    if (typeof a?.arm !== "string") return undefined;
    return { arm: a.arm, ...(typeof a.design === "string" ? { design: a.design } : {}), ...(typeof a.stratum === "string" ? { stratum: a.stratum } : {}) };
  };

  /** The session file names a child's parent; an in-memory child's comes from its assignment (M5b.2). */
  const parentFrom = (ctx: any, a: Levers | undefined): string | undefined =>
    parentOf(safe(() => ctx.sessionManager.getSessionFile())) ?? (typeof a?.parentSessionId === "string" ? a.parentSessionId : undefined);

  const common = (sid: string, ctx: any) => {
    const input: Pick<LineInput, "sessionId" | "parentSessionId" | "arm" | "design"> = { sessionId: sid };
    const a = assignedOf(sid);
    const parent = parentFrom(ctx, a);
    if (parent !== undefined) input.parentSessionId = parent;
    const exp = experiment(a);
    if (exp?.arm !== undefined) input.arm = exp.arm;
    if (exp?.design !== undefined) input.design = exp.design;
    return input;
  };

  const sidOf = (ctx: any): string | undefined => safe(() => ctx.sessionManager.getSessionId());

  /** A warm is never resent by pi's session retry: its line carries no `retries`/`retryWaitMs` (not observed). */
  const writeWarming = (sid: string, ctx: any, snap: Snapshot): void => {
    const entries: any[] = safe(() => ctx.sessionManager.getEntries()) ?? [];
    const warm = [...entries].reverse().find((e) => e?.type === "usage" && e.kind === "cache_warm" && time(e.timestamp) >= snap.at);
    const who = (typeof warm?.provider === "string" && typeof warm?.model === "string" ? warm : undefined) ?? lastModel.get(sid) ?? { provider: "unknown", model: "unknown" };
    // D5: this flush runs late (next before_provider_request / agent_settled /
    // session_shutdown), so the line's ts is the warm RESPONSE time (snap.at),
    // not the flush time.
    const input: LineInput = { ...common(sid, ctx), now: new Date(snap.at), provider: who.provider, model: who.model, kind: "warming",
      status: snap.status, snap };
    const usage = mapUsage(warm?.usage);
    if (usage) input.usage = usage;
    write(input);
  };

  const flushWarming = (ctx: any): void => {
    const sid = sidOf(ctx);
    if (sid === undefined) return;
    const warmSnap = warms.get(sid);
    if (warmSnap) {
      warms.delete(sid);
      writeWarming(sid, ctx, warmSnap);
    }
    if (streaming.has(sid)) return; // a streaming turn's own response stays for its message_end
    const { snap } = joiner.take(sid);
    if (snap) writeWarming(sid, ctx, snap);
  };

  // M3b (design §5.3, §8.1): the session's effective pi settings as levers, at its first prompt and again whenever
  // one changes (settings files, the model's per-model levers, the assignment or a lever's read-back). M5b.2: the
  // engine's lever states (`s: "pe"`, `a`, `rb`, `tier`) join pi's settings, and `eligible` is the engine's (a main
  // session that is an experiment unit; a child, with its root's eligibility, never is).
  // Review m2: an engine state that breaks the levers rules (a stratum level that is no level name, as `a`) is dropped
  // alone, with one warning per lever id; the line keeps pi's settings, the arm and the other states.
  const droppedStates = new Set<string>();
  const engineStates = (raw: unknown): Record<string, LeverState> => {
    const out: Record<string, LeverState> = {};
    if (raw === null || typeof raw !== "object") return out;
    for (const [id, st] of Object.entries(raw as Record<string, unknown>)) {
      const bad = st !== null && typeof st === "object" ? leverViolations(st as LeverState) : ["not a state object"];
      if (bad.length === 0) out[id] = st as LeverState;
      else if (!droppedStates.has(id)) {
        droppedStates.add(id);
        console.error(`token-meter: drops the experiments engine's state of ${id} from the levers line: ${bad.join("; ")}`);
      }
    }
    return out;
  };
  /**
   * The engine's states over the meter's own observations (pi's settings, an extension's evidence): a state the meter
   * observed differently is what ran, so the observation wins; the engine's assignment stays visible as `a`, `refused`
   * (or `confirmed` pe when the observation equals `a`). A state of an id the meter did not observe stands as the engine gave it.
   */
  const joinStates = (observed: Record<LeverId, LeverState>, engine: Record<string, LeverState>): Record<LeverId, LeverState> => {
    const out: Record<LeverId, LeverState> = { ...observed };
    for (const [id, e] of Object.entries(engine)) {
      const o = observed[id];
      if (o === undefined || o.v === e.v) out[id] = e;
      else if (e.a === undefined) out[id] = o;
      else out[id] = { ...(o.v === e.a ? { v: o.v, s: "pe" as const, a: e.a, rb: "confirmed" as const } : { v: o.v, s: o.s, a: e.a, rb: "refused" as const }), ...(e.tier === undefined ? {} : { tier: e.tier }) };
    }
    return out;
  };
  const writeLevers = (sid: string, a: Levers | undefined): void => {
    const base = leversBase.get(sid)!;
    const exp = experiment(a);
    const parentSessionId = base.parent ?? (typeof a?.parentSessionId === "string" ? a.parentSessionId : undefined);
    const at = now();
    const line = leversLine({
      ts: at.toISOString(), sessionId: sid, ...(parentSessionId === undefined ? {} : { parentSessionId }),
      ...(exp === undefined ? {} : { arm: exp.arm }), ...(exp?.design === undefined ? {} : { design: exp.design }),
      eligible: a?.eligible === true && parentSessionId === undefined,
      ...(exp?.stratum === undefined ? {} : { stratum: exp.stratum }),
      levers: joinStates(base.levers, engineStates(a?.levers)),
    });
    const key = JSON.stringify({ ...line, ts: undefined });
    if (leversSeen.get(sid) === key) return;
    append(at, serializeLevers(line));
    leversSeen.set(sid, key);
  };
  // A read-back the engine publishes later (a response confirming a TTL) is a change of the session's levers.
  pi.events.on(LEVERS, (a: Levers) => {
    if (typeof a?.sessionId !== "string" || !leversBase.has(a.sessionId)) return;
    try {
      writeLevers(a.sessionId, a);
    } catch (err) {
      warn(err, "levers");
    }
  });
  pi.on("before_agent_start", (_e, ctx) => {
    const sid = sidOf(ctx);
    if (sid === undefined) return;
    try {
      const model = safe(() => ctx.model);
      const cwd = safe(() => ctx.cwd);
      const project = typeof cwd === "string" && safe(() => ctx.isProjectTrusted()) === true ? readJson(join(cwd, ".pi", "settings.json")) : undefined;
      const levers = effectiveSettings(readJson(join(deps.agentDir, "settings.json")), project, {
        model: typeof model?.provider === "string" && typeof model?.id === "string" ? `${model.provider}/${model.id}` : undefined,
        cacheRetention: env.PI_CACHE_RETENTION,
      });
      const branch = safe(() => ctx.sessionManager.getBranch());
      Object.assign(levers, extensionLevers(Array.isArray(branch) ? branch : []));
      const parent = parentOf(safe(() => ctx.sessionManager.getSessionFile()));
      leversBase.set(sid, { ...(parent === undefined ? {} : { parent }), levers });
      writeLevers(sid, assignedOf(sid));
    } catch (err) {
      warn(err, "levers");
    }
  });

  // M3b (design §8.1, plan D5): pi 1.4 compact() calls the session model outside the agent loop (no provider
  // request/response or message_end events), so session_compact is the one sign of that request: one line from the
  // entry usage, no timing or retries (not observed). An extension summary may use any model: unknown.
  pi.on("session_compact", (e, ctx) => {
    const sid = sidOf(ctx);
    const usage = mapUsage(e?.compactionEntry?.usage);
    if (sid === undefined || !usage) return;
    const model = e?.fromExtension === true ? undefined : safe(() => ctx.model);
    const known = typeof model?.provider === "string" && typeof model?.id === "string";
    write({ ...common(sid, ctx), now: now(), provider: known ? model.provider : "unknown", model: known ? model.id : "unknown",
      kind: "compaction", status: 200, usage });
  });

  pi.on("context", (_e, ctx) => {
    const sid = sidOf(ctx);
    if (sid !== undefined) turnSend.add(sid); // returns nothing: the messages stay as they are
  });
  pi.on("context_with_system", (e, ctx) => {
    const sid = sidOf(ctx);
    if (sid === undefined) return;
    const h = safe(() => systemHash(e?.messages));
    if (h === undefined) sysHash.delete(sid);
    else sysHash.set(sid, h); // returns nothing: the transcript stays as it is
  });
  pi.on("before_provider_request", (_e, ctx) => {
    const sid = sidOf(ctx);
    if (sid !== undefined && turnSend.delete(sid) && !streaming.has(sid)) {
      const t = now().getTime(), failed = failedAt.get(sid);
      sentAt.set(sid, t);
      firstEvent.delete(sid);
      timings.delete(sid);
      failedAt.delete(sid);
      if (failed === undefined) retryWait.delete(sid);
      else retryWait.set(sid, Math.max(0, t - failed));
    }
    flushWarming(ctx); // returns nothing: the payload stays as it is
  });
  pi.on("provider_stream_event", (e, ctx) => {
    const sid = sidOf(ctx);
    if (sid !== undefined && sentAt.has(sid) && !firstEvent.has(sid)) firstEvent.set(sid, now().getTime());
    const t = sid !== undefined && sentAt.has(sid) ? timingsOf(e?.data) : undefined;
    if (sid !== undefined && t) timings.set(sid, t);
  });
  pi.on("agent_settled", (_e, ctx) => {
    const sid = sidOf(ctx);
    if (sid !== undefined) failedAt.delete(sid); // the run ended: no retry follows
    flushWarming(ctx);
  });
  pi.on("session_shutdown", (_e, ctx) => flushWarming(ctx));

  pi.on("after_provider_response", (e, ctx) => {
    const sid = sidOf(ctx);
    if (sid === undefined) return;
    const snap: Snapshot = { status: e?.status, headers: e?.headers ?? {}, at: now().getTime() };
    if (streaming.has(sid)) {
      warms.set(sid, snap);
      return;
    }
    joiner.onResponse(sid, snap);
  });

  pi.on("message_start", (e, ctx) => {
    if (e?.message?.role !== "assistant") return;
    const sid = sidOf(ctx);
    if (sid !== undefined) streaming.add(sid);
  });

  pi.on("message_end", (e, ctx) => {
    const m = e?.message;
    const sid = sidOf(ctx);
    if (sid === undefined) return;
    if (m?.role !== "assistant") {
      failedAt.delete(sid); // a user, custom or tool message starts other work: the next send is no retry
      return;
    }
    streaming.delete(sid);
    turnSend.delete(sid); // a request that failed before its send leaves no mark for the next send
    const taken = joiner.take(sid);
    lastModel.set(sid, { provider: String(m.provider ?? "unknown"), model: String(m.model ?? "unknown") });
    const end = now();
    const wait = retryWait.get(sid);
    retryWait.delete(sid);
    const input: LineInput = { ...common(sid, ctx), now: end, provider: lastModel.get(sid)!.provider,
      model: lastModel.get(sid)!.model, kind: "turn", status: 200, retries: wait === undefined ? 0 : 1, retryWaitMs: wait ?? 0 };
    const sent = sentAt.get(sid), first = firstEvent.get(sid);
    sentAt.delete(sid);
    firstEvent.delete(sid);
    const tm = timings.get(sid);
    timings.delete(sid);
    if (tm) Object.assign(input, tm);
    if (sent !== undefined) input.durationMs = Math.max(0, end.getTime() - sent);
    if (sent !== undefined && first !== undefined) input.ttftMs = Math.max(0, first - sent);
    if (typeof m.thinkingLevel === "string") input.effort = m.thinkingLevel;
    const h = sysHash.get(sid);
    sysHash.delete(sid);
    if (h !== undefined) input.systemHash = h;
    if (m.stopReason === "error") {
      input.status = "error";
      if (typeof m.errorMessage === "string") input.errorMessage = m.errorMessage;
      // pi never retries a context overflow (it compacts instead): that resend is no retry.
      if (errorKindOf(input.errorMessage ?? "", input.provider) === "context_overflow") failedAt.delete(sid);
      else failedAt.set(sid, end.getTime());
    } else {
      const usage = mapUsage(m.usage);
      if (usage) input.usage = usage;
      if (taken.snap) { input.snap = taken.snap; input.status = taken.snap.status; }
    }
    write(input);
  });
}

type Timings = Pick<LineInput, "promptMs" | "genMs" | "cacheN" | "promptN">;

/** The whole non-negative numbers of a llama.cpp `timings` object (a stream chunk's top-level field) the line keeps; undefined when it has none. */
function timingsOf(data: unknown): Timings | undefined {
  const t = (data as { timings?: Record<string, unknown> } | null | undefined)?.timings;
  if (t === null || typeof t !== "object") return undefined;
  const out: Timings = {};
  for (const [from, to] of [["prompt_ms", "promptMs"], ["predicted_ms", "genMs"], ["cache_n", "cacheN"], ["prompt_n", "promptN"]] as const) {
    const v = t[from];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[to] = Math.round(v);
  }
  return Object.keys(out).length ? out : undefined;
}

function safe<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}
