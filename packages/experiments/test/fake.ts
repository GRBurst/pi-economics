// Test doubles of what experiments uses of pi: event handlers, commands, pi.appendEntry, pi.events and the session
// control the control-tier add-ons use (thinking level, active tools).
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

/**
 * A fake of pi's session control: the thinking level and the active tools. As in pi 1.4 a name that is no registered tool
 * is ignored by setActiveTools (so is a name in `ignore`: a registered tool pi will not activate), and `clamp` stands for
 * a model that cannot take the level asked for. `calls` records every setter call.
 */
export function fakeControl(o: { level?: string; active?: string[]; all?: string[]; clamp?: (level: string) => string; ignore?: string[] } = {}) {
  const all = o.all ?? ["read", "bash", "edit", "codemode"];
  const state = { level: o.level ?? "medium", active: o.active ?? ["read", "bash"], calls: [] as string[] };
  const control = {
    getThinkingLevel: () => state.level,
    setThinkingLevel: (level: string) => {
      state.calls.push(`thinking:${level}`);
      state.level = o.clamp?.(level) ?? level;
    },
    getActiveTools: () => [...state.active],
    setActiveTools: (names: string[]) => {
      state.calls.push(`tools:${names.join(",")}`);
      state.active = names.filter((n) => all.includes(n) && !o.ignore?.includes(n)); // `ignore`: registered tools pi will not activate
    },
    getAllTools: () => all.map((name) => ({ name })),
    getCommands: () => [] as Array<{ name: string }>,
  };
  return { control, state };
}

/** A fake ExtensionAPI: `entries` collects pi.appendEntry calls (the session's custom entries); `control` is the session control's state. */
export function fakePi(controlOptions?: Parameters<typeof fakeControl>[0], initialEntries: Entry[] = []) {
  const handlers = new Map<string, Array<(e: any, ctx: any) => unknown>>();
  const commands: string[] = [];
  const entries: Entry[] = [...initialEntries]; // the branch a resumed or reloaded runtime finds
  const events = bus();
  const { control: api, state: control } = fakeControl(controlOptions);
  const pi = {
    ...api,
    on: (n: string, h: any) => void handlers.set(n, [...(handlers.get(n) ?? []), h]),
    registerCommand: (n: string) => void commands.push(n),
    getCommands: () => commands.map((name) => ({ name })),
    appendEntry: (customType: string, data?: unknown) => void entries.push({ type: "custom", customType, data }),
    events,
  };
  const fire = (name: string, e: unknown, ctx: unknown) => (handlers.get(name) ?? []).forEach((h) => h(e, ctx));
  return { pi, handlers, commands, entries, events, fire, control };
}
