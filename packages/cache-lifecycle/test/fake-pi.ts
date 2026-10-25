// Minimal stand-in for pi's ExtensionAPI: records handlers, lets tests fire events.
type Handler = (e: any, ctx: any) => unknown;

export function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, Array<(d: any) => void>>();
  const appended: Array<{ type: string; data: unknown }> = [];
  return {
    pi: {
      on(name: string, h: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), h]); },
      appendEntry(type: string, data: unknown) { appended.push({ type, data }); },
      events: { on(name: string, h: (d: any) => void) { bus.set(name, [...(bus.get(name) ?? []), h]); } },
    },
    fire(name: string, e: unknown, ctx: unknown) { for (const h of handlers.get(name) ?? []) h(e, ctx); },
    /** Like fire, but returns the last handler result that is not undefined. */
    call(name: string, e: unknown, ctx: unknown) { return (handlers.get(name) ?? []).map((h) => h(e, ctx)).filter((r) => r !== undefined).pop(); },
    appended,
    emit(name: string, d: unknown) { for (const h of bus.get(name) ?? []) h(d); },
    handlerCount: () => handlers.size + bus.size,
    handlerNames: () => [...handlers.keys()].sort(),
  };
}

export function fakeCtx(sessionId: string, opts: { file?: string; entries?: unknown[] } = {}) {
  return {
    mode: "interactive",
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => opts.file,
      getEntries: () => opts.entries ?? [],
      getBranch: () => opts.entries ?? [],
    },
  };
}
