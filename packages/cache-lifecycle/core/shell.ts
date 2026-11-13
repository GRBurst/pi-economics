// Wires the pure cores to pi's hooks. Everything pi-specific lives here.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isCold } from "./cold.ts";
import { planMasks, type Include, type MaskSet } from "./mask.ts";
import { applyMasks, entriesOf } from "./messages.ts";
import { registerIdentityShim } from "./identity.ts";
import { LEVERS, LEVERS_QUERY, type Levers, type LeversQuery, type SubagentsApiV1 } from "./api.ts";
import { actorMissing, hasSubagentsApiV1, warnOnce } from "./runtime-guard.ts";
import { applyTtl } from "./ttl.ts";
import { decideWarm } from "./warm.ts";
import type { Settings } from "./settings.ts";

type Ctx = { sessionManager: { getSessionId(): string; getBranch(): unknown[] }; hasUI?: boolean; ui?: { notify?(text: string, level: "warning"): void } };
export type PiLike = {
  on(name: string, handler: (event: any, ctx: Ctx) => unknown): void;
  appendEntry(customType: string, data: unknown): void;
  /** pi.events: emit runs the handlers synchronously; `on` returns the unsubscribe. */
  events: { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: any) => unknown): () => void };
};

export type Deps = {
  settings: Settings;
  /** pi's agent dir; when set, a `context_peek` call after masking is logged to <agentDir>/guards/events.jsonl (experiments guard). */
  agentDir?: string;
  now?: () => number;
  /** The actor-subagents API; default `globalThis.__subagentsApi_v1`. */
  api?: () => Pick<SubagentsApiV1, "list" | "subscribe"> | undefined;
};


const MASKS = "cache-lifecycle/masks";
const MIN = 60_000;
const WARM_CAP_MS = 60 * MIN;
const levels: Record<Settings["maskOnCold"], Include[]> = { off: [], tools: ["tools"], "tools+thinking": ["tools", "thinking"] };

export function install(pi: PiLike, deps: Deps) {
  registerIdentityShim(pi, deps.settings.identityShim);
  const now = deps.now ?? Date.now;
  const { settings } = deps;
  const api = deps.api ?? (() => (globalThis as { __subagentsApi_v1?: SubagentsApiV1 }).__subagentsApi_v1);
  // The one seam for the factors the experiments package switches: the level its engine assigned the session, read from
  // the internal channel (redesign §7.7) as the lever target, else the own setting. Asking as the target is what makes
  // the engine set and record these levers (§7.4: a lever of a target that is not loaded stays inert).
  const TARGET = "cache-lifecycle";
  const assigned = (sid: string): Levers | undefined => {
    let answer: Levers | undefined;
    const q: LeversQuery = { sessionId: sid, target: TARGET, reply: (a) => void (answer ??= a) };
    pi.events.emit(LEVERS_QUERY, q);
    return answer;
  };
  // An engine that starts after this extension publishes the assignment first: ask then, so its levers start at once.
  pi.events.on(LEVERS, (l: Levers) => {
    if (Object.values(l?.factors ?? {}).some((f) => f.lever.startsWith(`${TARGET}.`))) assigned(l.sessionId);
  });
  const flag = (name: "warmPolicy" | "mainCacheTtl" | "maskOnCold", sid: string): string => {
    const own = settings[name];
    const f = Object.values(assigned(sid)?.factors ?? {}).find((x) => x.lever === `${TARGET}.${name}`);
    const v = f === undefined ? own : String(f.assigned);
    // The factor's "on" level: the own masking level, or tools+thinking when that is off.
    return name === "maskOnCold" && v === "on" ? (own === "off" ? "tools+thinking" : own) : v;
  };
  // actor-subagents' list() carries a `main` record with the main session id
  // (the name is unique -- the singleton is added before any child can spawn),
  // and it is not a child. Excluded here and in the warming decision below.
  // An in-process child's own runtime knows it from its Assigned before the actor attaches it (redesign M5b.2).
  const isChild = (sid: string) => (api()?.list().some((a) => a.name !== "main" && a.sessionId === sid) ?? false) || assigned(sid)?.parentSessionId !== undefined;
  const ttlFor = (sid: string) => (!isChild(sid) && flag("mainCacheTtl", sid) === "1h" ? "1h" : "5m");
  const lastRequest = new Map<string, number>();
  const masks = new Map<string, MaskSet>();

  /** Union of the id deltas persisted on the session branch. */
  const rebuild = (ctx: Ctx): MaskSet => {
    const ids = ctx.sessionManager.getBranch().flatMap((e: any) => (e.type === "custom" && e.customType === MASKS ? e.data?.ids ?? [] : []));
    masks.set(ctx.sessionManager.getSessionId(), new Set(ids));
    return masks.get(ctx.sessionManager.getSessionId())!;
  };

  pi.on("session_start", (_e, ctx) => {
    rebuild(ctx);
    assigned(ctx.sessionManager.getSessionId());
    // spec D5: without the patched actor only the warming of sessions that wait on children is off (below).
    if (!hasSubagentsApiV1(api())) warnOnce(ctx, "actor:cache-lifecycle", actorMissing("cache-lifecycle", "sessions waiting on their children are not kept warm"));
  });

  // Warming pings are provider responses too: they refresh the cache, so they count.
  pi.on("after_provider_response", (e, ctx) => {
    if (e.status >= 200 && e.status < 300) lastRequest.set(ctx.sessionManager.getSessionId(), now());
  });

  // Warming. Idle time counts from the last real message; a warm ping has no message_end.
  const lastMessage = new Map<string, number>();
  pi.on("message_end", (_e, ctx) => void lastMessage.set(ctx.sessionManager.getSessionId(), now()));
  // A child awaits a reply from its last outgoing message until something is routed to it.
  const awaiting = new Set<string>();
  let subscribedTo: unknown;
  const track = (a: NonNullable<ReturnType<typeof api>>) => {
    if (subscribedTo === a) return;
    subscribedTo = a;
    a.subscribe((ev) => {
      if (ev.type === "route" && "from" in ev) {
        awaiting.add(ev.from);
        if (!ev.buffered) awaiting.delete(ev.to);
      }
      if (ev.type === "kill" && "name" in ev) awaiting.delete(ev.name);
    });
  };
  pi.on("cache_warming_decision", (_e, ctx) => {
    const a = api();
    const sid = ctx.sessionManager.getSessionId();
    if (!a || flag("warmPolicy", sid) === "native") return undefined;
    track(a);
    const agents = a.list();
    const children = agents.filter((x) => x.name !== "main"); // main is not a child (above)
    const self = children.find((x) => x.sessionId === sid);
    const action = decideWarm({
      role: self ? "child" : "main",
      runningChildren: children.filter((x) => x.state === "running").length,
      awaitingReply: self !== undefined && awaiting.has(self.name),
      finished: self?.state === "paused",
      idleMs: now() - (lastMessage.get(sid) ?? now()),
      capMs: WARM_CAP_MS,
    });
    return action && { action };
  });

  pi.on("context", (e, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    const include = levels[flag("maskOnCold", sid) as Settings["maskOnCold"]] ?? [];
    if (!include.length) return undefined;
    const existing = masks.get(sid) ?? rebuild(ctx);
    let current = existing;
    if (isCold(lastRequest.get(sid), now(), ttlFor(sid) === "1h" ? 60 * MIN : 5 * MIN)) {
      current = planMasks(entriesOf(e.messages), existing, settings.protectedTailTokens, include);
      const added = [...current].filter((id) => !existing.has(id));
      if (added.length) {
        masks.set(sid, current);
        pi.appendEntry(MASKS, { ids: added, at: now() });
      }
    }
    return current.size ? { messages: applyMasks(e.messages, current) } : undefined;
  });

  // Guard: a model that peeks after masking may be missing what was elided. Only the fact is logged, never arguments.
  pi.on("tool_call", (e, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    if (!deps.agentDir || e.toolName !== "context_peek" || !masks.get(sid)?.size) return undefined;
    try {
      const { arm, design } = assigned(sid) ?? {};
      mkdirSync(join(deps.agentDir, "guards"), { recursive: true });
      // The design id rides along, as on experiments' guard lines (a v2 arm id alone may look like a v1-engine one).
      appendFileSync(join(deps.agentDir, "guards", "events.jsonl"), JSON.stringify({ v: 1, ts: new Date(now()).toISOString(), sessionId: sid, ...(arm ? { arm } : {}), ...(arm && design ? { design } : {}), event: "peek-after-mask" }) + "\n");
    } catch { /* a guard log must never block the tool */ }
    return undefined;
  });

  pi.on("before_provider_request", (e, ctx) => {
    const ttl = ttlFor(ctx.sessionManager.getSessionId());
    return ttl === "1h" ? applyTtl(e.payload, ttl) : undefined;
  });

  return { lastRequestAt: (sessionId: string) => lastRequest.get(sessionId) };
}
