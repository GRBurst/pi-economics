// All extension logic, free of pi imports so it runs under node's test runner with test/fake-pi.ts.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Joiner } from "./join.ts";
import { errorKindOf } from "./errorkind.ts";
import { buildLine, monthFile, serialize } from "./line.ts";
import type { LineInput, Usage } from "./line.ts";
import { billingOf } from "./plans.ts";
import type { Snapshot } from "./ratelimit.ts";
import { defaults } from "./settings.ts";
import type { Settings } from "./settings.ts";

export type PiLike = {
  on(name: string, handler: (e: any, ctx: any) => unknown): void;
  events?: { on(name: string, handler: (d: any) => void): void };
};
export type Deps = {
  agentDir: string;
  now?: () => Date;
  settings?: Settings;
  /** Experiment arm id of a session, resolved at line time; default: `__piExperimentsApi_v1.armFor(sid)?.id`. */
  arm?: (sessionId: string) => string | undefined;
};

/** What token-meter reads of the experiments package's globalThis.__piExperimentsApi_v1; the type check compares it with the provider's ExperimentsApiV1 (spec §5.3). */
export type ExperimentsApi = { armFor?(s: string): { id?: string } | undefined };

/** The experiments package is optional and never imported: its process-global API, or nothing. */
const experimentArm = (sid: string): string | undefined =>
  (globalThis as { __piExperimentsApi_v1?: ExperimentsApi }).__piExperimentsApi_v1?.armFor?.(sid)?.id;

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

function parentOf(file: unknown): string | undefined {
  if (typeof file !== "string") return undefined;
  return /[\\/]subagents[\\/]([^\\/]+)[\\/]/.exec(file)?.[1];
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
  // D19, P18: pi's native retry. A failed attempt (error message_end, not a context overflow) waits in `failedAt`
  // until the session's next send, which is its retry when nothing came between (pi resends after a backoff with no
  // message in between; a settled run or a new message means no retry follows). `retryWait` holds that send's wait.
  const failedAt = new Map<string, number>();
  const retryWait = new Map<string, number>();
  const madeDirs = new Set<string>();
  let warned = false;

  const write = (input: LineInput): void => {
    try {
      const line = buildLine({ ...input, billing: billingOf(settings.plans, input.provider) });
      if (!settings.rawRatelimit) delete line.rawRatelimit;
      const file = monthFile(deps.agentDir, input.now, settings.dir);
      if (!madeDirs.has(dirname(file))) {
        mkdirSync(dirname(file), { recursive: true });
        madeDirs.add(dirname(file));
      }
      appendFileSync(file, serialize(line));
    } catch (err) {
      if (!warned) {
        warned = true;
        console.error("token-meter: cannot write meter line:", err instanceof Error ? err.message : err);
      }
    }
  };

  const common = (sid: string, ctx: any) => {
    const input: Pick<LineInput, "sessionId" | "parentSessionId" | "arm"> = { sessionId: sid };
    const parent = parentOf(safe(() => ctx.sessionManager.getSessionFile()));
    if (parent !== undefined) input.parentSessionId = parent;
    const arm = safe(() => (deps.arm ?? experimentArm)(sid));
    if (arm !== undefined) input.arm = arm;
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

  pi.on("context", (_e, ctx) => {
    const sid = sidOf(ctx);
    if (sid !== undefined) turnSend.add(sid); // returns nothing: the messages stay as they are
  });
  pi.on("before_provider_request", (_e, ctx) => {
    const sid = sidOf(ctx);
    if (sid !== undefined && turnSend.delete(sid) && !streaming.has(sid)) {
      const t = now().getTime(), failed = failedAt.get(sid);
      sentAt.set(sid, t);
      firstEvent.delete(sid);
      failedAt.delete(sid);
      if (failed === undefined) retryWait.delete(sid);
      else retryWait.set(sid, Math.max(0, t - failed));
    }
    flushWarming(ctx); // returns nothing: the payload stays as it is
  });
  pi.on("provider_stream_event", (_e, ctx) => {
    const sid = sidOf(ctx);
    if (sid !== undefined && sentAt.has(sid) && !firstEvent.has(sid)) firstEvent.set(sid, now().getTime());
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
    if (sent !== undefined) input.durationMs = Math.max(0, end.getTime() - sent);
    if (sent !== undefined && first !== undefined) input.ttftMs = Math.max(0, first - sent);
    if (typeof m.thinkingLevel === "string") input.effort = m.thinkingLevel;
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

function safe<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}
