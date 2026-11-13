// Minimal stand-in for pi's ExtensionAPI: records handlers, lets tests fire events.
type Handler = (e: any, ctx: any) => unknown;

export function fakePi() {
  const handlers = new Map<string, Handler[]>();
  return {
    pi: {
      on(name: string, h: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), h]); },
    },
    fire(name: string, e: unknown, ctx: unknown) { for (const h of handlers.get(name) ?? []) h(e, ctx); },
    /** Like fire; returns what each handler returned. */
    fireAll(name: string, e: unknown, ctx: unknown) { return (handlers.get(name) ?? []).map((h) => h(e, ctx)); },
    handlerCount: () => handlers.size,
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
