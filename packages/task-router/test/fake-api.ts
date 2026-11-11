// In-memory stand-in for globalThis.__subagentsApi_v1 (core/api.ts): records retune/send, lets tests emit engine events.
// `ext` (local mode L4.T7, opt-in): the spawn-api patch's `spawn`/`kill` (spawnPolicyApi 2) as well.
import type { AgentInfo, ApiEvent, PolicyResult, SpawnArgs, SpawnPolicy, SpawnResult, SubagentsApiV1 } from "../core/api.ts";

export type ApiSpawn = { args: SpawnArgs; opts?: { by?: string; quiet?: boolean }; result: SpawnResult; policy?: PolicyResult };

export function fakeApi(o: { ext?: boolean } = {}) {
  let policy: SpawnPolicy | undefined;
  const listeners: Array<(e: ApiEvent) => void> = [];
  const retunes: Array<{ name: string; model?: string; thinkingLevel?: string }> = [];
  const sent: Array<{ to: string; text: string; from?: string }> = [];
  const agents: AgentInfo[] = [];
  const apiSpawns: ApiSpawn[] = [];
  const killed: string[] = [];
  /** `retune` awaits `gate` when a test sets it (a slow retune), then throws `fail` when set (T3.7).
   *  `spawnGate`: `api.spawn` awaits it before running the policy; `spawnFail`: `api.spawn` resolves `{ok: false}` with it. */
  const control: { gate?: Promise<void>; fail?: Error; spawnGate?: Promise<void>; spawnFail?: string } = {};
  const emit = (e: ApiEvent) => { for (const l of [...listeners]) l(e); };
  const caller = { name: "main", sessionId: "s-main", model: "anthropic/claude-opus-5-5", thinkingLevel: "high" as const, cwd: "/work" };
  const api: SubagentsApiV1 = {
    version: 1,
    registerSpawnPolicy(fn) {
      if (policy) throw new Error("a spawn policy is already registered");
      policy = fn;
      return () => { if (policy === fn) policy = undefined; };
    },
    subscribe(l) { listeners.push(l); return () => { listeners.splice(listeners.indexOf(l), 1); }; },
    async retune(name, t) {
      await control.gate;
      if (control.fail) throw control.fail;
      retunes.push({ name, ...t });
    },
    async send(to, text, from) { sent.push({ to, text, from }); },
    list: () => agents,
    ...(o.ext && {
      async spawn(args: SpawnArgs, opts?: { by?: string; quiet?: boolean }): Promise<SpawnResult> {
        await control.spawnGate;
        const by = opts?.by ?? "main";
        // The spawner reserves the name before it asks the policy (spawner.ts): a duplicate never reaches the policy.
        if (agents.some((a) => a.name === args.name)) {
          const result: SpawnResult = { ok: false, reason: `agent "${args.name}" already exists` };
          apiSpawns.push({ args, opts, result });
          return result;
        }
        const p = policy ? await policy(args, { ...caller, name: by }) : { model: args.model ?? caller.model, thinkingLevel: args.thinkingLevel ?? caller.thinkingLevel };
        const result: SpawnResult = control.spawnFail !== undefined ? { ok: false, reason: control.spawnFail }
          : "reject" in p ? { ok: false, reason: p.reject }
          : { ok: true, name: args.name, sessionId: `s-${args.name}` };
        apiSpawns.push({ args, opts, result, policy: p });
        if (result.ok && !("reject" in p)) {
          agents.push({ name: args.name, parent: by, sessionId: result.sessionId, model: p.model, thinkingLevel: p.thinkingLevel, state: "idle", policyMeta: p.meta });
          emit({ type: "spawn", name: args.name, by, parent: by, childSessionId: result.sessionId, ts: 0 });
        }
        return result;
      },
      async kill(names: string[]): Promise<string[]> {
        const gone = names.filter((n) => agents.some((a) => a.name === n));
        for (const n of gone) {
          killed.push(n);
          agents.splice(agents.findIndex((a) => a.name === n), 1);
          emit({ type: "kill", name: n, ts: 0 });
        }
        return gone;
      },
    }),
  };
  return {
    api, retunes, sent, agents, control, apiSpawns, killed, emit,
    /** Run the registered policy like the spawner would. */
    spawn: (args: Partial<Parameters<SpawnPolicy>[0]> & { name: string }, c: Partial<typeof caller> & { policyMeta?: unknown } = {}) =>
      policy!({ systemPrompt: "sys", message: "do it", ...args }, { ...caller, ...c }),
    hasPolicy: () => policy !== undefined,
  };
}
