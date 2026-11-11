// The main session's hints (design §3.1.1, §3.1.2, §3.1.4; plan S12): the router records the main session's tool calls, runs
// the pure detectors after every result and turn, and appends the fixed hint texts to the tool result of the call that
// tripped (the pattern of core/fresh.ts). Trips found at `turn_end` wait for the next result (plan D17). Every handler is
// total (AC-H5): `tool_call` never returns a value (pi blocks on a throw), and a failure is reported once and passes the
// result through unchanged.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { createOutcomeLog } from "../log.ts";
import type { RouterSettings } from "../types.ts";
import { block, createHintEngine } from "./hints.ts";
import type { Delivery } from "./hints.ts";
import { componentOn } from "./mode.ts";
import { callKey, callTrips, changed, contextSoft, contextStall, errSig, push, riskGlobsOf } from "./tripwires.ts";
import type { CallRecord, Trip } from "./tripwires.ts";

type Pi = { on(name: string, handler: (e: any, ctx: any) => unknown): void };
export type LocalDeps = {
  settings: RouterSettings; log: Pick<ReturnType<typeof createOutcomeLog>, "hint">; isChild(ctx: any): boolean; sessionId(): string | undefined;
  /** A file's hash; undefined when it cannot be read (§3.1.4). Default: sha256 of its bytes. */
  hash?(abs: string): string | undefined;
  /** The call detectors (a test seam, AC-H5). */
  detect?: typeof callTrips;
  /** The status suffix (plan Q5): the trip of the last hint, undefined at the next progress. */
  onTrip?(trip: Trip | undefined): void;
};

const WRITERS = new Set(["edit", "write"]);
export const fileHash = (abs: string): string | undefined => {
  try { return createHash("sha256").update(readFileSync(abs)).digest("hex"); } catch { return undefined; }
};
/** A call a tool made through `ctx.executeTool` (pi docs/extensions.md): its result reaches only the calling tool, so it is
 *  neither recorded nor annotated, and it consumes nothing queued (L3 follow-up). */
const nested = (e: any): boolean => typeof e?.parentToolCallId === "string";
const textOf = (content: unknown): string =>
  Array.isArray(content) ? content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n") : "";

/** No-op unless hints are on (`hints.enabled`: "on", or "auto" in local mode). */
export function installLocal(pi: Pi, d: LocalDeps): void {
  const s = d.settings, h = s.hints;
  if (!componentOn(s, "hints")) return;
  const hash = d.hash ?? fileHash, detect = d.detect ?? callTrips;
  const engine = createHintEngine(h, s.plans);
  const globs = riskGlobsOf(s), seen = new Set<string>();
  const pending = new Map<string, Omit<CallRecord, "turn">>(); // toolCallId → the call's record so far
  let ring: CallRecord[] = [], queue: Delivery[] = [];
  let turn = 0, call = 0, armed = true, stall = 0, progressed = false, shown = false, warned = false;
  const safe = <T>(f: () => T): T | undefined => {
    try { return f(); } catch (err) {
      if (!warned) { warned = true; console.warn(`task-router: hint engine: ${(err as Error)?.message ?? String(err)}`); }
      return undefined;
    }
  };
  const soft = (ctx: any): Trip[] => {
    const r = contextSoft(armed, ctx?.getContextUsage?.()?.tokens, h);
    armed = r.armed;
    return r.fire ? ["context-soft"] : [];
  };
  pi.on("tool_call", (e, ctx) => {
    safe(() => {
      if (d.isChild(ctx) || typeof e?.toolCallId !== "string" || nested(e)) return;
      const tool = String(e.toolName), isWrite = WRITERS.has(tool), p = e.input?.path;
      const path = isWrite && typeof p === "string" ? resolve(ctx?.cwd ?? process.cwd(), p) : undefined;
      pending.set(e.toolCallId, { tool, key: callKey(tool, e.input), isWrite, path, hashBefore: path === undefined ? undefined : hash(path) });
    });
    return undefined;
  });
  pi.on("tool_result", (e, ctx) => safe(() => {
    if (d.isChild(ctx) || nested(e)) return undefined;
    const rec = pending.get(e?.toolCallId);
    pending.delete(e?.toolCallId);
    const out = queue;
    queue = [];
    const trips: Trip[] = [];
    if (rec) {
      call += 1;
      const isError = e.isError === true;
      const r: CallRecord = { ...rec, turn, isError, errSig: isError ? errSig(textOf(e.content)) : undefined,
        hashAfter: rec.path === undefined ? undefined : hash(rec.path) };
      ring = push(ring, r, h);
      if (changed(r)) { // progress (plan D15): the persistence counts, the stall and the status suffix reset
        engine.progress();
        stall = 0;
        progressed = true;
        if (shown) { shown = false; d.onTrip?.(undefined); }
      }
      const cwd = ctx?.cwd ?? process.cwd();
      trips.push(...detect(ring, h, { globs, seen, rel: (x) => relative(cwd, x) }));
      if (trips.includes("risky-path") && r.path !== undefined) seen.add(r.path); // once per path
    }
    trips.push(...soft(ctx));
    out.push(...engine.detected(trips, call));
    if (!out.length) return undefined;
    for (const x of out) d.log.hint("main", x.trip, x.stage, x.n, d.sessionId());
    shown = true;
    d.onTrip?.(out[out.length - 1].trip);
    return { content: [...(Array.isArray(e.content) ? e.content : []), ...out.map((x) => ({ type: "text", text: block(x.trip, x.n, x.text) }))] };
  }));
  pi.on("turn_end", (_e, ctx) => {
    safe(() => {
      if (d.isChild(ctx)) return;
      turn += 1;
      const st = contextStall(stall, progressed, ctx?.getContextUsage?.()?.percent, h);
      stall = st.stall;
      progressed = false;
      const trips = [...soft(ctx), ...(st.fire ? ["context-stall" as const] : [])];
      if (trips.length) queue.push(...engine.detected(trips, call));
    });
    return undefined;
  });
}
