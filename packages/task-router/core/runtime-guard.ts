// Runtime helpers shared by the four pi-economics extensions (identical copies; checks/runtime-guard-copies.nix).
// The provider check (spec D5), the once-per-process warning, and the single-copy claim on pi.events (spec D6): made at session_start, not at load.
export type Component = "token-meter" | "experiments" | "cache-lifecycle" | "task-router";
/** What the components check of actor-subagents' globalThis.__subagentsApi_v1; the type check compares it with the provider's SubagentsApiV1 (spec §5.3). */
export type SubagentsApiShape = { version: 1; registerSpawnPolicy(...a: any[]): unknown; subscribe(...a: any[]): unknown; list(): unknown; send(...a: any[]): unknown };
type Ctx = { hasUI?: boolean; ui?: { notify?(text: string, level: "warning"): void } };
type Bus = { emit(channel: string, data: unknown): void; on(channel: string, h: (d: any) => void): () => void };

const OPTION: Record<Component, string> = { "token-meter": "tokenMeter", experiments: "experiments", "cache-lifecycle": "cacheLifecycle", "task-router": "taskRouter" };
const KEYS = ["registerSpawnPolicy", "subscribe", "list", "send"] as const;

/** The patched actor's API, version 1, with the functions the components call. */
export const hasSubagentsApiV1 = (a: unknown): a is SubagentsApiShape =>
  typeof a === "object" && a !== null && (a as { version?: unknown }).version === 1 &&
  KEYS.every((k) => typeof (a as Record<string, unknown>)[k] === "function");

export const actorMissing = (c: Component, consequence: string): string =>
  `${c}: needs pi-actor-subagents with the spawn-policy API (__subagentsApi_v1), which is not loaded; ${consequence}. ` +
  "Get the patched build via the pi-economics Nix modules; upstream support pending.";

export const loadedTwice = (c: Component, owner: string, path: string): string =>
  `pi-economics: ${c} is loaded twice (${owner} and ${path}); this copy stays inert. ` +
  `Keep one: remove the pi package (pi remove <source>) or disable programs.piEconomics.${OPTION[c]} in Nix.`;

/** Once per process and key (globalThis, so a /reload does not repeat it): a UI notification, else console.warn. */
export function warnOnce(ctx: Ctx | undefined, key: string, text: string): void {
  const g = globalThis as { __piEconomicsWarned_v1?: Set<string> };
  const seen = (g.__piEconomicsWarned_v1 ??= new Set());
  if (seen.has(key)) return;
  seen.add(key);
  if (ctx?.hasUI && ctx.ui?.notify) ctx.ui.notify(text, "warning");
  else console.warn(text);
}

const CHANNEL = "pi-economics:claim:v1";
type Claim = { component: Component; path: string; owner?: string };

/**
 * Claims `component` on the runtime's bus. `emit` is synchronous: an earlier copy's listener fills `owner` before it
 * returns (never for its own path, so one file loaded twice is no duplicate). The first copy keeps a listener until
 * `release` (pi also drops it on reload, when it invalidates the old runtime's subscriptions).
 */
export function claimSingleCopy(events: Bus, component: Component, path: string):
  { first: true; release: () => void } | { first: false; owner: string } {
  const probe: Claim = { component, path };
  events.emit(CHANNEL, probe);
  if (probe.owner !== undefined) return { first: false, owner: probe.owner };
  const release = events.on(CHANNEL, (d: Claim) => {
    if (d.component === component && d.path !== path && d.owner === undefined) d.owner = path;
  });
  return { first: true, release };
}

type Handler = (e: any, ctx: Ctx) => unknown;
type PiLike = { events: Bus; on(ev: "session_start" | "session_shutdown", h: Handler): unknown };

/**
 * The single-copy guard of an extension's factory (spec D6). Nothing is claimed or installed at load: pi may load a
 * copy and then leave it out of the final extension set (a user-scope package loaded before the project is trusted,
 * dropped once a project entry replaces it), and a claim made at load would keep a copy that never starts from
 * silencing the one that does. Only a copy in the final set gets `session_start`; the first to get it claims the
 * component and runs `install`, a later copy installs nothing and warns once. `install` gets a view of `pi` whose
 * `on("session_start")` is held and run by this guard right after it (pi snapshots its handlers per emit, so one
 * registered during the emit would be missed); every other member is pi's own. An instance decides once: pi builds new
 * ones for a reload, a new, resumed or forked session and a child.
 */
export function guardSingleCopy<P extends PiLike>(pi: P, component: Component, path: string, install: (pi: P) => void): void {
  let claim: ReturnType<typeof claimSingleCopy> | undefined;
  let owner: string | undefined;
  let failed = false;
  const started: Handler[] = [];
  const view = new Proxy(pi, {
    get(target, key) {
      if (key !== "on") return Reflect.get(target, key);
      return (ev: string, h: Handler) => {
        if (ev !== "session_start") return (target as { on(ev: string, h: Handler): unknown }).on(ev, h);
        started.push(h);
        return () => void (started.includes(h) && started.splice(started.indexOf(h), 1));
      };
    },
  });
  pi.on("session_start", async (e, ctx) => {
    if (claim === undefined) {
      claim = claimSingleCopy(pi.events, component, path);
      if (claim.first) {
        try { install(view); } catch (err) { failed = true; claim.release(); throw err; }
      } else owner = claim.owner;
    }
    if (owner !== undefined) return warnOnce(ctx, `twice:${component}:${path}`, loadedTwice(component, owner, path));
    if (failed) return;
    let error: { err: unknown } | undefined;
    for (const h of [...started]) {
      try { await h(e, ctx); } catch (err) { error ??= { err }; }
    }
    if (error) throw error.err;
  });
  pi.on("session_shutdown", () => void (claim?.first && claim.release()));
}
