// Minimal stand-in for pi's ExtensionAPI: records handlers, lets tests fire events.
type Handler = (e: any, ctx: any) => unknown;

export function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, Array<(d: any) => void>>();
  return {
    pi: {
      on(name: string, h: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), h]); },
      events: { on(name: string, h: (d: any) => void) { bus.set(name, [...(bus.get(name) ?? []), h]); } },
    },
    fire(name: string, e: unknown, ctx: unknown) { for (const h of handlers.get(name) ?? []) h(e, ctx); },
    emit(name: string, d: unknown) { for (const h of bus.get(name) ?? []) h(d); },
    handlerCount: () => handlers.size + bus.size,
  };
}

export function fakeCtx(sessionId: string, opts: { file?: string; entries?: unknown[] } = {}) {
  return {
    mode: "interactive",
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => opts.file,
      getEntries: () => opts.entries ?? [],
    },
  };
}
