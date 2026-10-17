// All extension logic, free of pi imports so it runs under node's test runner with test/fake-pi.ts.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Joiner } from "./join.ts";
import { buildLine, monthFile, serialize } from "./line.ts";
import type { LineInput, Usage } from "./line.ts";
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

/** The experiments package is optional and never imported: its process-global API, or nothing. */
const experimentArm = (sid: string): string | undefined =>
  (globalThis as { __piExperimentsApi_v1?: { armFor?(s: string): { id?: string } | undefined } }).__piExperimentsApi_v1?.armFor?.(sid)?.id;

/** pi usage → meter usage (cost.total → costUsd). */
function mapUsage(u: any): Usage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const out: Usage = { input: u.input ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0, output: u.output ?? 0 };
  if (typeof u.reasoning === "number") out.reasoning = u.reasoning;
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
  const pending = new Map<string, Snapshot>(); // mirrors the Joiner's snapshots, so flushing never steals retries
  const lastModel = new Map<string, { provider: string; model: string }>();
  const madeDirs = new Set<string>();
  let warned = false;
  let retrySession: string | undefined;

  const write = (input: LineInput): void => {
    try {
      const line = buildLine(input);
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

  const flushWarming = (ctx: any): void => {
    const sid = sidOf(ctx);
    const snap = sid === undefined ? undefined : pending.get(sid);
    if (sid === undefined || !snap) return;
    pending.delete(sid);
    const taken = joiner.take(sid);
    const entries: any[] = safe(() => ctx.sessionManager.getEntries()) ?? [];
    const warm = [...entries].reverse().find((e) => e?.type === "usage" && e.kind === "cache_warm" && time(e.timestamp) >= snap.at);
    const who = (typeof warm?.provider === "string" && typeof warm?.model === "string" ? warm : undefined) ?? lastModel.get(sid) ?? { provider: "unknown", model: "unknown" };
    // D5: this flush runs late (next before_provider_request / agent_settled /
    // session_shutdown), so the line's ts is the warm RESPONSE time (snap.at),
    // not the flush time.
    const input: LineInput = { ...common(sid, ctx), now: new Date(snap.at), provider: who.provider, model: who.model, kind: "warming",
      status: snap.status, retries: taken.retries, retryWaitMs: taken.retryWaitMs, snap };
    const usage = mapUsage(warm?.usage);
    if (usage) input.usage = usage;
    write(input);
  };

  pi.on("session_start", (_e, ctx) => {
    retrySession = sidOf(ctx);
  });
  pi.on("before_provider_request", (_e, ctx) => flushWarming(ctx));
  pi.on("agent_settled", (_e, ctx) => flushWarming(ctx));
  pi.on("session_shutdown", (_e, ctx) => flushWarming(ctx));

  pi.on("after_provider_response", (e, ctx) => {
    const sid = sidOf(ctx);
    if (sid === undefined) return;
    retrySession ??= sid;
    const snap: Snapshot = { status: e?.status, headers: e?.headers ?? {}, at: now().getTime() };
    pending.set(sid, snap);
    joiner.onResponse(sid, snap);
  });

  pi.on("message_end", (e, ctx) => {
    const m = e?.message;
    if (m?.role !== "assistant") return;
    const sid = sidOf(ctx);
    if (sid === undefined) return;
    retrySession ??= sid;
    pending.delete(sid);
    // D8: pi-retry's `completed` lands AFTER the retried request's message_end,
    // so close the open episodes on this non-error end — the line that actually
    // waited for them. Error ends keep them open; the late `completed`/`cancelled`
    // for closed ids is ignored by the Joiner.
    if (m.stopReason !== "error") joiner.closeOpen(sid, now().getTime());
    const taken = joiner.take(sid);
    lastModel.set(sid, { provider: String(m.provider ?? "unknown"), model: String(m.model ?? "unknown") });
    const input: LineInput = { ...common(sid, ctx), now: now(), provider: lastModel.get(sid)!.provider,
      model: lastModel.get(sid)!.model, kind: "turn", status: 200, retries: taken.retries, retryWaitMs: taken.retryWaitMs };
    if (typeof m.thinkingLevel === "string") input.effort = m.thinkingLevel;
    if (m.stopReason === "error") {
      input.status = "error";
      if (typeof m.errorMessage === "string") input.errorMessage = m.errorMessage;
    } else {
      const usage = mapUsage(m.usage);
      if (usage) input.usage = usage;
      if (taken.snap) { input.snap = taken.snap; input.status = taken.snap.status; }
    }
    write(input);
  });

  // D1: pi-retry emits NUMERIC retryIds (emitRetryLifecycleEvent(event, retryId: number));
  // accept number | string -- the key only needs to pair start with end.
  const retry = (kind: "start" | "end") => (d: any) => {
    const id = d?.retryId;
    if (retrySession === undefined || (typeof id !== "string" && typeof id !== "number")) return;
    const key = String(id);
    if (kind === "start") joiner.onRetryStart(retrySession, key, now().getTime());
    else joiner.onRetryEnd(retrySession, key, now().getTime());
  };
  pi.events?.on("pi-retry:started", retry("start"));
  pi.events?.on("pi-retry:completed", retry("end"));
  pi.events?.on("pi-retry:cancelled", retry("end"));
}

function safe<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}
