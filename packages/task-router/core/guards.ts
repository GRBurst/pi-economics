// Runaway and context guards (spec §5.2.7): one notice per threshold and child, sent to the child's parent.
import type { ApiEvent } from "./api.ts";
import { routeMember } from "./members.ts";
import type { PolicyDeps } from "./policy.ts";

export function createGuards(d: PolicyDeps) {
  const seen = new Map<string, { requests: number; told: Set<string> }>();
  return (e: ApiEvent): void => {
    if (e.type === "kill") return void seen.delete(e.name);
    if (e.type !== "turn") return;
    const c = d.children.get(e.name);
    if (!c) return;
    const st = seen.get(e.name) ?? { requests: 0, told: new Set<string>() };
    seen.set(e.name, st);
    st.requests++;
    const info = d.api()?.list().find((a) => a.name === e.name);
    const window = routeMember(d.settings.models, c.route)!.contextWindow;
    const ctx = info?.contextTokens ?? 0;
    const notes: [string, boolean, string][] = [
      ["requests", st.requests > d.settings.runaway.requests, `has made ${st.requests} requests (limit ${d.settings.runaway.requests}); check it is not looping`],
      ["usd", (info?.costUsd ?? 0) > d.settings.runaway.usd, `has cost $${(info?.costUsd ?? 0).toFixed(2)} (limit $${d.settings.runaway.usd}); check it is not looping`],
      ["context", ctx > d.settings.contextGuard * window,
        `context ${Math.round(ctx / 1000)}k is ${Math.round((100 * ctx) / window)} % of its ${Math.round(window / 1000)}k window; hand the rest of the task to a fresh agent with a handoff`],
    ];
    for (const [key, hit, text] of notes) {
      if (!hit || st.told.has(key)) continue;
      st.told.add(key);
      void d.api()?.send(c.parent, `[router] ${e.name} ${text}.`, "router");
    }
  };
}
