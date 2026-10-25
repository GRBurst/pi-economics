// Fresh on cold (spec §5.3): a message to an idle child whose cache is cold and whose context is big re-reads
// all of it at the uncached price. advise: the send goes through and the result carries a note; enforce: blocked.
import type { AgentInfo, SubagentsApiV1 } from "./api.ts";
import type { RouterSettings } from "./types.ts";

const CACHE_TTL_MS = 5 * 60_000;

type Pi = { on(name: string, handler: (e: any, ctx: any) => unknown): void };

export function installFreshOnCold(pi: Pi, d: { settings: RouterSettings; api: () => SubagentsApiV1 | undefined; now: () => number }): void {
  const notes = new Map<string, string>(); // toolCallId → note for the result
  const cold = (a: AgentInfo) =>
    a.state === "idle" && (a.contextTokens ?? 0) >= d.settings.freshOnCold.minTokens && d.now() - (a.lastRequestAt ?? 0) >= CACHE_TTL_MS;
  pi.on("tool_call", (e) => {
    const mode = d.settings.freshOnCold.mode;
    if (e.toolName !== "send_message" || (mode !== "advise" && mode !== "enforce") || !Array.isArray(e.input?.to)) return undefined;
    const hits = (d.api()?.list() ?? []).filter((a) => e.input.to.includes(a.name) && cold(a));
    if (!hits.length) return undefined;
    const who = hits.map((a) => `${a.name} (cache cold, idle ${Math.round((d.now() - (a.lastRequestAt ?? 0)) / 60_000)} min, context ${Math.round((a.contextTokens ?? 0) / 1000)}k)`).join(", ");
    if (mode === "advise") {
      notes.set(e.toolCallId, `[router] ${who}: this message re-reads the whole context at the uncached price. Prefer a fresh agent with a short handoff (state, files, next step).`);
      return undefined;
    }
    return { block: true, reason: `${who}: a message re-reads the whole context at the uncached price. Spawn a fresh agent with a short handoff (state, files, next step) instead of messaging it.` };
  });
  pi.on("tool_result", (e) => {
    const note = notes.get(e.toolCallId);
    if (note === undefined) return undefined;
    notes.delete(e.toolCallId);
    return { content: [...(e.content ?? []), { type: "text", text: note }] };
  });
}
