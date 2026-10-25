// Failover (spec §4.8, §4.9): a terminal provider error moves the child to a free member of its leg on another provider, without
// waiting; OpenRouter's free-tier daily cap blocks the erroring member at once and moves every child on it. Attempts are not spent.
import type { ApiEvent } from "./api.ts";
import { FREE_CAP_PROVIDER, freeCapHit } from "./freecap.ts";
import { effortAt, named, providerOf } from "./members.ts";
import type { Named } from "./members.ts";
import type { Child, PolicyDeps } from "./policy.ts";
import { PENDING_MS, memberState } from "./policy.ts";

export function createFailover(d: PolicyDeps & { log: { reroute(taskId: string, from: string, to: string, reason: string): void } }) {
  /** The first of the child's candidates (`Child.failover`) that is enabled, on another provider than the failed member, and free
   *  now; none → the child stays. The effort: the target's at the leg's step. */
  const move = async (name: string, c: Child, reason: string): Promise<void> => {
    const api = d.api();
    if (!api) return;
    const failed = d.settings.models[c.member];
    const cands = c.failover.map((n) => named(d.settings.models, n)).filter((m): m is Named =>
      !!m && m.model !== "" && m.name !== c.member && providerOf(m) !== providerOf(failed));
    const health = await Promise.all(cands.map((m) => (m.health ? d.probe(m.health) : Promise.resolve(undefined))));
    const now = d.now(), listed = new Map(api.list().map((a) => [a.name, a.state]));
    const t = cands.find((m, i) => memberState(d, m, listed, now, health[i]).free); // no wait
    if (!t) return;
    const effort = effortAt(t, c.plan.worker.step);
    try {
      await api.retune(name, { model: t.model, thinkingLevel: effort });
      await api.send(name, "continue", "router");
    } catch (e) {
      return void console.warn(`task-router: reroute of ${name} failed: ${(e as Error).message}`);
    }
    d.log.reroute(name, c.route, t.route, reason);
    Object.assign(c, { member: t.name, route: t.route, model: t.model, effort, reservedUntil: d.now() + PENDING_MS });
  };
  return (e: ApiEvent): void => {
    if (e.type !== "error") return;
    const c = d.children.get(e.name);
    if (!c) return;
    const cap = freeCapHit(e.reason, d.now());
    void (async () => {
      if (cap) {
        const member = c.member, m = named(d.settings.models, member);
        if (!m || providerOf(m) !== FREE_CAP_PROVIDER) return; // the text is OpenRouter's; on another member it is stale (r2, L2)
        d.blocks.set(member, cap.until);
        for (const n of new Set([e.name, ...d.children.keys()])) { // the erroring child first
          const x = d.children.get(n);
          if (x?.member === member) await move(n, x, "free-cap");
        }
      } else if (d.settings.autoEscalate) await move(e.name, c, `error: ${e.reason.slice(0, 80)}`);
    })();
  };
}
