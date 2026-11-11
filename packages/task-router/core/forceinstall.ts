// Force override, the pi side (design §3.6, plan S6): the `/force` command, its session entries (design §3.0.2), the settings
// force resolved at session_start, and the port the spawn policy reads. The policy has no ctx, so this owns the state (plan D7).
import { FORCE_TYPE, consume, describeForce, effective, parseForce, rebuild, resolveRef } from "./force.ts";
import type { ActiveForce, ForceEntry } from "./force.ts";
import type { createOutcomeLog } from "./log.ts";
import type { RouterSettings } from "./types.ts";

/** What this file needs of pi's ExtensionAPI; both optional, so a host without them still loads the router. */
export type ForcePi = {
  registerCommand?(name: string, c: { description?: string; handler(args: string, ctx: any): unknown }): void;
  appendEntry?(customType: string, data: unknown): void;
};
/** `active`: the force a routed spawn runs under now; `used`: a spawn ran under it (a `next:N` command force counts down);
 *  `underneath`: the settings force, which applies again once a command force over it ends (spot-check F9). */
export type ForcePort = { active(): ActiveForce | undefined; used(taskId: string): void; underneath?(): ActiveForce | undefined };

const USAGE = "usage: /force <model> [effort] [next[:N] | session] | /force off | /force";
const NOT_FORCED = "overseer reviews are not forced (they use overseer.*)";
const AVAILABLE = 10;

const notify = (ctx: any, text: string, level: "info" | "warning" | "error"): void => { ctx?.ui?.notify?.(text, level); };
/** The registry's `find`, total: no registry or a throw is "unknown". */
const finder = (ctx: any) => (p: string, id: string): unknown => {
  try { return ctx?.modelRegistry?.find?.(p, id); } catch { return undefined; }
};
/** The first models the registry offers, `provider/id` (plan X11: `getAvailable` is optional; anything else lists none). */
function available(ctx: any): string[] {
  let xs: unknown;
  try { xs = ctx?.modelRegistry?.getAvailable?.(); } catch { xs = undefined; }
  if (!Array.isArray(xs)) return [];
  return xs.slice(0, AVAILABLE).map((m) => (typeof m === "string" ? m : `${m?.provider}/${m?.id}`));
}

/** `onChange(ctx)`: the force changed; the shell re-renders the status line (with this ctx's UI when given). */
export function installForce(pi: ForcePi, d: {
  settings: RouterSettings; log: Pick<ReturnType<typeof createOutcomeLog>, "force">; onChange(ctx?: any): void;
}) {
  let cmd: ForceEntry | undefined;
  let fromSettings: ActiveForce | undefined;
  let resolved = false;
  const active = (): ActiveForce | undefined => effective(cmd, fromSettings);
  const store = (e: ForceEntry): void => {
    cmd = e;
    pi.appendEntry?.(FORCE_TYPE, e);
  };
  /** Q6 (plan D12): with routing off nothing is forced; the user is told. */
  const routingNote = (): string => (d.settings.routing ? "" : "; routing is off, so no spawn is forced");

  const handler = (args: string, ctx: any): void => {
    const c = parseForce(String(args ?? ""));
    if (c.op === "show") {
      const f = active();
      return notify(ctx, f ? `task-router: ${describeForce(f)} (${f.source})${routingNote()}` : "task-router: no force; routing decides", "info");
    }
    if (c.op === "usage") {
      d.log.force({ action: "rejected", source: "command", reason: "usage" });
      return notify(ctx, USAGE, "warning");
    }
    if (c.op === "off") {
      store({ cleared: true });
      d.log.force({ action: "clear", source: "command" });
      d.onChange(ctx);
      return notify(ctx, `task-router: force cleared${fromSettings ? `; the settings ${describeForce(fromSettings)} applies` : ""}`, "info");
    }
    const model = resolveRef(c.ref, d.settings.models, finder(ctx));
    if (model === undefined) {
      d.log.force({ action: "rejected", source: "command", model: c.ref, reason: "unknown-model" });
      const list = available(ctx);
      return notify(ctx, `task-router: /force: unknown model ${c.ref}; available: ${list.length ? list.join(", ") : "(none listed)"}`, "error");
    }
    store({ model, ...(c.effort ? { thinkingLevel: c.effort } : {}), scope: c.scope, ...(c.scope === "next" ? { remaining: c.n } : {}), source: "command" });
    d.log.force({ action: "set", source: "command", model, effort: c.effort });
    d.onChange(ctx);
    const what = describeForce({ model, thinkingLevel: c.effort, source: "command" });
    const scope = c.scope === "session" ? "the session" : c.n === 1 ? "the next spawn" : `the next ${c.n} spawns`;
    notify(ctx, `task-router: ${what} for ${scope}; ${NOT_FORCED}${routingNote()}`, "info");
  };
  // Plan D6: registered at install, inside the guarded body, with or without the actor's API.
  pi.registerCommand?.("force", { description: "Force the model (and effort) of routed spawns: /force <model> [effort] [next[:N] | session], /force off, /force", handler });

  const used = (): void => {
    const f = active();
    if (!f) return;
    d.log.force({ action: "used", source: f.source, model: f.model, effort: f.thinkingLevel });
    if (f.source !== "command") return;
    const r = consume(cmd);
    if (r.next === cmd || r.next === undefined) return;
    store(r.next);
    if (r.expired) d.log.force({ action: "expired", source: "command", model: f.model, effort: f.thinkingLevel });
    d.onChange();
  };

  return {
    port: { active, used, underneath: () => fromSettings } as ForcePort,
    /** In the shell's session_start handler, before the problems notification (plan D8): rebuild the command force from the
     *  branch; once per process resolve the settings force (unresolvable → a problem and a rejected line, inactive). */
    start(ctx: any, problems: string[]): void {
      let branch: unknown[] = [];
      try { branch = ctx?.sessionManager?.getBranch?.() ?? []; } catch { branch = []; }
      cmd = rebuild(Array.isArray(branch) ? branch : []);
      if (resolved) return;
      resolved = true;
      const ref = d.settings.force.model;
      if (ref === "") return;
      const model = resolveRef(ref, d.settings.models, finder(ctx));
      if (model === undefined) {
        problems.push(`force.model: unknown model ${ref}; the settings force is inactive`);
        d.log.force({ action: "rejected", source: "settings", model: ref, reason: "unknown-model" });
        return;
      }
      const effort = d.settings.force.thinkingLevel;
      fromSettings = { model, ...(effort ? { thinkingLevel: effort } : {}), source: "settings" };
    },
  };
}
