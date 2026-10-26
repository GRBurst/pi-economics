// Failover (spec §4.8, §4.9): a terminal provider error moves the child to a free member of its leg on another provider, without
// waiting; OpenRouter's free-tier daily cap blocks the erroring member at once and moves every child on it. Attempts are not spent.
import type { ApiEvent } from "./api.ts";
import { FREE_CAP_PROVIDER, freeCapHit } from "./freecap.ts";
import { effortAt, named, providerOf } from "./members.ts";
import type { Named } from "./members.ts";
import type { Child, PolicyDeps } from "./policy.ts";
import { PENDING_MS, memberState } from "./policy.ts";

export function createFailover(d: PolicyDeps & {
  log: { reroute(taskId: string, from: string, to: string, reason: string, fromModel?: string, toModel?: string): void };
}) {
  /** The first of the child's candidates (`Child.failover`) that is enabled, on another provider than the failed member, and free
   *  now; none → the child stays. The effort: the target's at the leg's step. The entry moves to the target in the pick's
   *  synchronous step, before `retune` (RD5, AC3): a spawn during the await sees the target taken; a throw restores it.
   *  `prev` is the pending marker: while a move is in flight, a further error is the old provider's and starts none. */
  const move = async (name: string, c: Child, reason: string): Promise<void> => {
    const api = d.api();
    if (!api) return;
    const failed = d.settings.models[c.member];
    const cands = c.failover.map((n) => named(d.settings.models, n)).filter((m): m is Named =>
      !!m && m.model !== "" && m.name !== c.member && providerOf(m) !== providerOf(failed));
    const health = await Promise.all(cands.map((m) => (m.health ? d.probe(m.health) : Promise.resolve(undefined))));
    // ---- synchronous: pick and rewrite the entry before any await (RD5) ----
    if (c.prev) return;
    const now = d.now(), listed = new Map(api.list().map((a) => [a.name, a.state]));
    const t = cands.find((m, i) => memberState(d, m, listed, now, health[i]).free); // no wait
    if (!t) return;
    const prev = { member: c.member, route: c.route, model: c.model, effort: c.effort, reservedUntil: c.reservedUntil };
    const effort = effortAt(t, c.plan.worker.step);
    Object.assign(c, { member: t.name, route: t.route, model: t.model, effort, reservedUntil: now + PENDING_MS, prev });
    try {
      await api.retune(name, { model: t.model, thinkingLevel: effort });
      await api.send(name, "continue", "router");
    } catch (e) {
      Object.assign(c, prev); delete c.prev; // the target's slot is free again
      return void console.warn(`task-router: reroute of ${name} failed: ${(e as Error).message}`);
    }
    delete c.prev;
    d.log.reroute(name, prev.route, t.route, reason, prev.model, t.model);
    const st = d.attempts.get(name);
    if (st) st.ranMember = t.name; // the attempt now runs here (D9)
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
