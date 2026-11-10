// Minimal stand-in for pi's ExtensionAPI: records handlers and tools, lets tests fire events and call tools.
import type { ThinkingLevel } from "../core/types.ts";
type Handler = (e: any, ctx: any) => unknown;
type Tool = { name: string; description: string; parameters: any; execute: (id: string, params: any, signal: unknown, onUpdate: unknown, ctx: any) => Promise<any> };
type Command = { description?: string; handler: (args: string, ctx: any) => unknown };

export function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, Array<(d: any) => void>>();
  const tools = new Map<string, Tool>();
  const sent: Array<{ msg: any; opts: any }> = [];
  const thinking = { level: "high", sets: [] as string[] };
  const commands = new Map<string, Command>();
  const entries: Array<{ type: string; data: unknown }> = [];
  return {
    thinking,
    sent,
    commands,
    entries,
    pi: {
      getThinkingLevel: () => thinking.level as ThinkingLevel,
      setThinkingLevel(l: string) { thinking.level = l; thinking.sets.push(l); },
      on(name: string, h: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), h]); },
      sendMessage(msg: any, opts: any) { sent.push({ msg, opts }); },
      registerTool(t: Tool) { tools.set(t.name, t); },
      registerCommand(name: string, c: Command) { commands.set(name, c); },
      appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
      events: { on(name: string, h: (d: any) => void) { bus.set(name, [...(bus.get(name) ?? []), h]); } },
    },
    tools,
    /** The names of every `pi.on` registration, sorted, one per handler (a multiset). */
    hookNames: (): string[] => [...handlers.entries()].flatMap(([n, hs]) => hs.map(() => n)).sort(),
    /** Calls every handler; returns their results in order. */
    fire(name: string, e: unknown, ctx: unknown) { return (handlers.get(name) ?? []).map((h) => h(e, ctx)); },
    emit(name: string, d: unknown) { for (const h of bus.get(name) ?? []) h(d); },
    callTool(name: string, params: unknown, ctx: unknown = {}) {
      const t = tools.get(name);
      if (!t) throw new Error(`no tool ${name}`);
      return t.execute("call-1", params, undefined, undefined, ctx);
    },
  };
}
