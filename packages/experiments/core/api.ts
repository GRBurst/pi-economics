// The process-global experiments API: other extensions reach it only through
// `globalThis.__piExperimentsApi_v1?.flag(name, ownSetting, sessionId)`.
import type { Arm } from "./design.ts";

export interface ExperimentsApiV1 {
  version: 1;
  armFor(sessionId: string): Arm | undefined;
  /** The arm's value for factor `name`; `def` (the caller's own setting) when no arm or factor applies. */
  flag(name: string, def: string, sessionId?: string): string;
  /** `child` shares the arm of `parent` (children do not get an assignment of their own). */
  inherit(child: string, parent: string): void;
}

const MAX_DEPTH = 64;

/**
 * `mainSession` is the session `flag` falls back to when called without a session id.
 * `resolveParent` maps a session id to the parent derived from its session FILE path (the
 * `…/subagents/<parent>/…` rule token-meter uses for `parentSessionId`; the caller copies it,
 * packages do not import each other). It is the fallback for sessions whose in-memory
 * inheritance was lost — e.g. a RESUMED child whose spawn event fired before this process's
 * session started: the arm is then re-derived from the parent's assignment, up to the root,
 * and cached. Root sessions without an assignment stay unknown.
 */
export function createApi(
  mainSession: () => string | undefined,
  resolveParent?: (sessionId: string) => string | undefined,
) {
  const assigned = new Map<string, Arm>();
  const parents = new Map<string, string>();
  const walk = (start: string): Arm | undefined => {
    let sid: string | undefined = start;
    for (let i = 0; sid !== undefined && i < MAX_DEPTH; i++, sid = parents.get(sid)) {
      const arm = assigned.get(sid);
      if (arm) return arm;
    }
    return undefined;
  };
  const armFor = (sessionId: string): Arm | undefined => {
    const direct = walk(sessionId);
    if (direct !== undefined) return direct;
    if (resolveParent === undefined) return undefined;
    const seen = new Set<string>([sessionId]);
    let sid: string | undefined = sessionId;
    for (let i = 0; sid !== undefined && i < MAX_DEPTH; i++) {
      const parent = resolveParent(sid);
      if (parent === undefined || parent === sid || seen.has(parent)) return undefined; // a root (or a loop) without an assignment
      seen.add(parent);
      parents.set(sid, parent); // remember the link, so later walks of `sid` find it in memory
      const arm = walk(parent);
      if (arm !== undefined) {
        assigned.set(sessionId, arm); // cache the resolution itself
        return arm;
      }
      sid = parent; // not in memory: climb further from the parent
    }
    return undefined;
  };
  const api: ExperimentsApiV1 = {
    version: 1,
    armFor,
    flag(name, def, sessionId = mainSession()) {
      return (sessionId === undefined ? undefined : armFor(sessionId)?.flags[name]) ?? def;
    },
    inherit: (child, parent) => void parents.set(child, parent),
  };
  return { api, assign: (sessionId: string, arm: Arm): void => void assigned.set(sessionId, arm) };
}
