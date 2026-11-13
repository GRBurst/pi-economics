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
