// Identity shim: workaround for a pi bug (seen in pi 1.0.0; drop once fixed upstream).
//
// pi's CacheWarmer keeps a warm run only while every object in
// agent.state.messages is identical (===) to the one sent with the request.
// pi rebuilds that array from sessionManager.buildSessionProjection() at turn
// boundaries, and the projection creates a NEW object for each custom_message
// (also branch_summary, compaction, edited) entry. A delivered custom message
// (subagent mail, a child's first task, extension nudges) is also stored as
// fields while the live object stays in state. Either way the run stops with
// "conversation context changed" before cache_warming_decision fires, and the
// session never warms again.
//
// The shim wraps buildSessionProjection on the session manager instance:
// an entry whose projected messages are content-equal to the previous
// projection keeps the previous objects, and the first projection of a
// delivered custom message reuses the live object seen at message_end.
// Feature-detected: without buildSessionProjection, or with a projection
// shape it does not recognise, it does nothing.

type Projection = { entries: Array<{ sourceEntry: object; messages: unknown[] }>; messages: unknown[] };
type Memo = { key: string; messages: unknown[] };
type State = { memo: WeakMap<object, Memo>; live: Map<string, unknown> };

const LIVE_CAP = 32; // delivered-but-not-yet-projected custom messages kept per session
const states = new WeakMap<object, State>();
const wrapped = new WeakSet<object>();

function stateOf(sm: object): State {
  let s = states.get(sm);
  if (!s) states.set(sm, (s = { memo: new WeakMap(), live: new Map() }));
  return s;
}

const liveKey = (m: any) => JSON.stringify([m.customType, m.content, m.display, m.details]);
const sameRefs = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function isProjection(p: any): p is Projection {
  if (!p || !Array.isArray(p.entries) || !Array.isArray(p.messages)) return false;
  let i = 0;
  for (const e of p.entries) {
    if (!e || typeof e.sourceEntry !== "object" || e.sourceEntry === null || !Array.isArray(e.messages)) return false;
    for (const m of e.messages) if (p.messages[i++] !== m) return false;
  }
  return i === p.messages.length;
}

function stabilize(p: Projection, s: State): Projection {
  let changed = false;
  for (const e of p.entries) {
    const src: any = e.sourceEntry;
    if (src.type === "message" && e.messages.length === 1 && e.messages[0] === src.message) continue;
    const prev = s.memo.get(src);
    if (prev && sameRefs(prev.messages, e.messages)) continue;
    const key = JSON.stringify(e.messages);
    if (prev && prev.key === key) {
      e.messages = prev.messages;
      changed = true;
      continue;
    }
    const m: any = e.messages.length === 1 ? e.messages[0] : undefined;
    if (m?.role === "custom") {
      const lk = liveKey(m);
      if (s.live.has(lk)) {
        e.messages = [s.live.get(lk)];
        s.live.delete(lk);
        changed = true;
      }
    }
    s.memo.set(src, { key, messages: e.messages });
  }
  if (changed) p.messages = p.entries.flatMap((e) => e.messages);
  return p;
}

/** Wrap sm.buildSessionProjection (own property on the instance). */
export function wrapProjection(sm: any): "installed" | "already" | "absent" {
  if (!sm || typeof sm.buildSessionProjection !== "function") return "absent";
  if (wrapped.has(sm)) return "already";
  wrapped.add(sm);
  const s = stateOf(sm);
  const orig = sm.buildSessionProjection.bind(sm);
  sm.buildSessionProjection = (...args: unknown[]) => {
    const p = orig(...args);
    return isProjection(p) ? stabilize(p, s) : p;
  };
  return "installed";
}

type PiLike = { on(name: string, handler: (event: any, ctx: any) => unknown): void };

/** Hook registration; `enabled` is the identityShim setting. */
export function registerIdentityShim(pi: PiLike, enabled: boolean): void {
  if (!enabled) return;
  pi.on("session_start", (_e, ctx) => {
    wrapProjection(ctx?.sessionManager);
  });
  pi.on("message_end", (e, ctx) => {
    const m = e?.message, sm = ctx?.sessionManager;
    if (m?.role !== "custom" || !sm || typeof sm !== "object") return;
    const live = stateOf(sm).live;
    live.set(liveKey(m), m);
    if (live.size > LIVE_CAP) live.delete(live.keys().next().value as string);
  });
}
