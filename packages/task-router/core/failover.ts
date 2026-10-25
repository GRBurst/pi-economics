// Failover (spec §5.2.6, R6): a terminal provider error moves the child to the next route; the OpenRouter
// free-tier daily cap blocks the free cloud at once and moves every cloud child. Attempts are not spent.
import type { ApiEvent } from "./api.ts";
import { freeCapHit } from "./chain.ts";
import { routeMember } from "./members.ts";
import type { Child, Leg, PolicyDeps } from "./policy.ts";
import { resolveLeg } from "./policy.ts";

type Target = Omit<Leg, "why">;

export function createFailover(d: PolicyDeps & { log: { reroute(taskId: string, from: string, to: string, reason: string): void } }) {
  const m = d.settings.models;
  const move = async (name: string, c: Child, to: Target, reason: string): Promise<void> => {
    const api = d.api();
    if (!api) return;
    try {
      await api.retune(name, { model: to.model, thinkingLevel: to.effort });
      await api.send(name, "continue", "router");
    } catch (e) {
      return void console.warn(`task-router: reroute of ${name} failed: ${(e as Error).message}`);
    }
    d.log.reroute(name, c.route, to.route, reason);
    Object.assign(c, { member: to.member, model: to.model, route: to.route, effort: to.effort });
  };
  /** Next route after an ordinary failure: local → free cloud (if open) → Sonnet; Sonnet and Opus have none (same provider, more quota). */
  const next = async (c: Child): Promise<Target | undefined> => {
    if (c.route === "T1" || c.route === "T2") return undefined;
    const cloud = c.route === "local" ? await resolveLeg(d, { tier: "qwen", effort: c.effort }, { failover: true }) : undefined;
    if (cloud?.route === "cloud") return cloud;
    const t1 = routeMember(m, "T1");
    return t1 ? { member: t1.name, model: t1.model, route: "T1", effort: "high" } : undefined; // a blank Sonnet: nothing to move to
  };
  return (e: ApiEvent): void => {
    if (e.type !== "error") return;
    const c = d.children.get(e.name);
    if (!c) return;
    const cap = freeCapHit(e.reason, d.now());
    void (async () => {
      try {
        if (cap) {
          d.blocks.set(c.member, cap.until);
          for (const n of new Set([e.name, ...d.children.keys()])) { // the erroring child first
            const x = d.children.get(n);
            if (x?.route === "cloud") await move(n, x, await resolveLeg(d, { tier: "qwen", effort: x.effort }), "free-cap");
          }
        } else if (d.settings.autoEscalate) {
          const to = await next(c);
          if (to) await move(e.name, c, to, `error: ${e.reason.slice(0, 80)}`);
        }
      } catch (err) { // a blank member the move needs (NotConfigured): the child stays where it is
        console.warn(`task-router: reroute after "${e.reason.slice(0, 60)}" skipped: ${(err as Error).message}`);
      }
    })();
  };
}
