// Test doubles of what experiments uses of pi: event handlers, commands, pi.appendEntry and pi.events.
import { EventEmitter } from "node:events";

/** pi 1.4's createEventBus: emit is synchronous; each handler is wrapped async and its errors are logged, not thrown. */
export function bus() {
  const e = new EventEmitter();
  return {
    emit: (channel: string, data: unknown) => void e.emit(channel, data),
    on: (channel: string, h: (d: any) => unknown) => {
      const safe = async (d: unknown) => { try { await h(d); } catch { /* logged by pi */ } };
      e.on(channel, safe);
      return () => void e.off(channel, safe);
    },
  };
}

export type Entry = { type: "custom"; customType: string; data?: unknown };

/** A fake ExtensionAPI: `entries` collects pi.appendEntry calls (the session's custom entries). */
export function fakePi() {
  const handlers = new Map<string, Array<(e: any, ctx: any) => unknown>>();
  const commands: string[] = [];
  const entries: Entry[] = [];
  const events = bus();
  const pi = {
    on: (n: string, h: any) => void handlers.set(n, [...(handlers.get(n) ?? []), h]),
    registerCommand: (n: string) => void commands.push(n),
    appendEntry: (customType: string, data?: unknown) => void entries.push({ type: "custom", customType, data }),
    events,
  };
  const fire = (name: string, e: unknown, ctx: unknown) => (handlers.get(name) ?? []).forEach((h) => h(e, ctx));
  return { pi, handlers, commands, entries, events, fire };
}

/**
 * pi 1.4 across /reload: one bus per ResourceLoader (kept), a new runtime per reload; the old runtime's pi.events
 * wrapper throws once invalidated (assertActive). `actor` is the actor's process-global engine: listeners called in
 * a plain loop (its Engine.emit), so a listener's exception reaches the emitter.
 */
export function reloadWorld() {
  const raw = bus();
  const listeners = new Set<(e: any) => void>();
  const actor = { version: 1, list: (): any[] => [], subscribe: (l: (e: any) => void) => (listeners.add(l), () => void listeners.delete(l)) };
  const runtime = () => {
    let stale = false;
    const handlers = new Map<string, Array<(e: any, ctx: any) => unknown>>();
    const pi = {
      on: (n: string, h: any) => void handlers.set(n, [...(handlers.get(n) ?? []), h]),
      registerCommand: () => {},
      appendEntry: () => {},
      events: {
        emit: (c: string, d: unknown) => {
          if (stale) throw new Error("This extension ctx is stale after session replacement or reload");
          raw.emit(c, d);
        },
        on: (c: string, h: (d: any) => unknown) => raw.on(c, h),
      },
    };
    const fire = (n: string, e: unknown, ctx: unknown) => (handlers.get(n) ?? []).forEach((h) => h(e, ctx));
    return { pi, fire, invalidate: () => void (stale = true) };
  };
  const spawn = (e: unknown) => { for (const l of [...listeners]) l(e); };
  return { raw, actor, listeners, runtime, spawn };
}
