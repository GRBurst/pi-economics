// Force override (design §3.6, LD4, LD11): the user's `/force` and the settings `force`. Pure: the command's grammar, model
// references, the session entry (design §3.0.2) with its `next:N` countdown, and the precedence of the two sources.
import { EFFORTS, enabled } from "./members.ts";
import type { Member, ThinkingLevel } from "./types.ts";

/** The customType of the session entries (`pi.appendEntry`), rebuilt from the branch at session_start. */
export const FORCE_TYPE = "task-router/force";
export type ForceCmd = { op: "show" } | { op: "off" } | { op: "usage" }
  | { op: "set"; ref: string; effort?: ThinkingLevel; scope: "session" | "next"; n?: number };
export type ForceEntry = { model: string; thinkingLevel?: ThinkingLevel; scope: "session" | "next"; remaining?: number; source: "command" }
  | { cleared: true };
export type ActiveForce = { model: string; thinkingLevel?: ThinkingLevel; source: "command" | "settings"; remaining?: number };

const NEXT = /^next:([1-9][0-9]*)$/;
const isEffort = (t: string | undefined): t is ThinkingLevel => EFFORTS.includes(t as ThinkingLevel);

/** `/force <model> [effort] [next[:N] | session]`, `/force off`, `/force` (design §3.6.1): the effort and the scope in that
 *  order, each at most once; `next` = `next:1`; the scope defaults to `session`. Anything else is a usage error. */
export function parseForce(args: string): ForceCmd {
  const ts = args.trim().split(/\s+/).filter(Boolean);
  if (ts.length === 0) return { op: "show" };
  if (ts.length === 1 && ts[0] === "off") return { op: "off" };
  const [ref, ...rest] = ts;
  const effort = isEffort(rest[0]) ? rest.shift() as ThinkingLevel : undefined;
  const scope = rest.shift();
  if (rest.length) return { op: "usage" };
  const n = scope === "next" ? 1 : scope !== undefined ? Number(NEXT.exec(scope)?.[1] ?? NaN) : NaN;
  if (scope !== undefined && scope !== "session" && !Number.isInteger(n)) return { op: "usage" };
  return { op: "set", ref, ...(effort ? { effort } : {}), ...(Number.isInteger(n) ? { scope: "next" as const, n } : { scope: "session" as const }) };
}

/** A member name maps to its model (a blank member is unknown); otherwise `provider/id`, split at the first "/", is what the
 *  registry `find`s (design §3.6.2). undefined = unknown. */
export function resolveRef(ref: string, models: Record<string, Member>, find: (p: string, id: string) => unknown): string | undefined {
  if (Object.hasOwn(models, ref)) return enabled(models).find((m) => m.name === ref)?.model;
  const at = ref.indexOf("/");
  if (at <= 0 || at === ref.length - 1) return undefined;
  return find(ref.slice(0, at), ref.slice(at + 1)) ? ref : undefined;
}

const isEntry = (d: any): d is ForceEntry =>
  d?.cleared === true || (typeof d?.model === "string" && d.model !== "" && (d.scope === "session" || d.scope === "next") && d.source === "command"
    && (d.thinkingLevel === undefined || isEffort(d.thinkingLevel)) && (d.remaining === undefined || Number.isInteger(d.remaining)));

/** The last entry of type FORCE_TYPE on the branch, else undefined; a malformed last entry is no force. */
export function rebuild(branch: readonly unknown[]): ForceEntry | undefined {
  const last = branch.filter((e: any) => e?.type === "custom" && e.customType === FORCE_TYPE).at(-1) as { data?: unknown } | undefined;
  if (!isEntry(last?.data)) return undefined;
  return (last.data as { cleared?: true }).cleared ? { cleared: true } : (last.data as ForceEntry);
}

const live = (e: ForceEntry | undefined): e is Exclude<ForceEntry, { cleared: true }> =>
  e !== undefined && !("cleared" in e) && (e.scope === "session" || (e.remaining ?? 0) > 0);

/** The command force while it lasts (scope session, or next with remaining > 0), else the settings force (design §3.6.1). */
export function effective(cmd: ForceEntry | undefined, fromSettings: ActiveForce | undefined): ActiveForce | undefined {
  if (!live(cmd)) return fromSettings;
  return { model: cmd.model, ...(cmd.thinkingLevel ? { thinkingLevel: cmd.thinkingLevel } : {}), source: "command",
    ...(cmd.scope === "next" ? { remaining: cmd.remaining } : {}) };
}

/** One forced spawn on the command force: next → remaining − 1; at 0 the entry becomes {cleared: true} and expired = true. */
export function consume(cmd: ForceEntry | undefined): { next: ForceEntry | undefined; expired: boolean } {
  if (!live(cmd) || cmd.scope !== "next") return { next: cmd, expired: false };
  const remaining = (cmd.remaining ?? 0) - 1;
  return remaining > 0 ? { next: { ...cmd, remaining }, expired: false } : { next: { cleared: true }, expired: true };
}

export const describeForce = (f: ActiveForce): string =>
  `force ${f.model}${f.thinkingLevel ? ` ${f.thinkingLevel}` : ""}${f.remaining !== undefined ? ` (${f.remaining} left)` : ""}`;

/** A forced spawn its member cannot take (`cause`: "down", "no free slot after N s"), with how to end the force (L8: the explicit
 *  model's "leave `model` unset" does not apply). `/force off` does not end a settings force: the router falls back to it. */
export const forceRejection = (f: ActiveForce, cause: string): string => f.source === "command"
  ? `force ${f.model} (/force): ${cause}; \`/force off\` clears it`
  : `force ${f.model} (settings \`force.model\`): ${cause}; an empty \`force.model\` in the task-router settings clears it, \`/force <model>\` overrides it for this session`;
