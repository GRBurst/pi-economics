// Minimal stand-in for pi's ExtensionAPI: records handlers, lets tests fire events.
type Handler = (e: any, ctx: any) => unknown;

export function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, Array<(d: any) => void>>();
  return {
    pi: {
      on(name: string, h: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), h]); },
      // pi 1.4's bus: emit runs the handlers synchronously; `on` returns the unsubscribe.
      events: {
        on(name: string, h: (d: any) => void) {
          bus.set(name, [...(bus.get(name) ?? []), h]);
          return () => void bus.set(name, (bus.get(name) ?? []).filter((x) => x !== h));
        },
        emit(name: string, d: unknown) { for (const h of bus.get(name) ?? []) h(d); },
      },
    },
    fire(name: string, e: unknown, ctx: unknown) { for (const h of handlers.get(name) ?? []) h(e, ctx); },
    /** Like fire; returns what each handler returned. */
    fireAll(name: string, e: unknown, ctx: unknown) { return (handlers.get(name) ?? []).map((h) => h(e, ctx)); },
    handlerCount: () => handlers.size,
  };
}

export type CtxOpts = {
  file?: string; entries?: unknown[];
  /** the session branch (sessionManager.getBranch()); default: the entries */
  branch?: unknown[];
  cwd?: string; trusted?: boolean; model?: { provider: string; id: string };
};

/** A mutable ctx: tests change `opts` (model, branch) between events. */
export function fakeCtx(sessionId: string, opts: CtxOpts = {}) {
  return {
    mode: "interactive",
    get cwd() { return opts.cwd ?? "/nonexistent"; },
    get model() { return opts.model; },
    isProjectTrusted: () => opts.trusted ?? false,
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => opts.file,
      getEntries: () => opts.entries ?? [],
      getBranch: () => opts.branch ?? opts.entries ?? [],
    },
  };
}
