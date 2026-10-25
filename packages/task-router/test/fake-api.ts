// In-memory stand-in for globalThis.__subagentsApi_v1 (core/api.ts): records retune/send, lets tests emit engine events.
import type { AgentInfo, ApiEvent, SpawnPolicy, SubagentsApiV1 } from "../core/api.ts";

export function fakeApi() {
  let policy: SpawnPolicy | undefined;
  const listeners: Array<(e: ApiEvent) => void> = [];
  const retunes: Array<{ name: string; model?: string; thinkingLevel?: string }> = [];
  const sent: Array<{ to: string; text: string; from?: string }> = [];
  const agents: AgentInfo[] = [];
  const api: SubagentsApiV1 = {
    version: 1,
    registerSpawnPolicy(fn) {
      if (policy) throw new Error("a spawn policy is already registered");
      policy = fn;
      return () => { if (policy === fn) policy = undefined; };
    },
    subscribe(l) { listeners.push(l); return () => { listeners.splice(listeners.indexOf(l), 1); }; },
    async retune(name, t) { retunes.push({ name, ...t }); },
    async send(to, text, from) { sent.push({ to, text, from }); },
    list: () => agents,
  };
  const caller = { name: "main", sessionId: "s-main", model: "anthropic/claude-opus-5-5", thinkingLevel: "high" as const, cwd: "/work" };
  return {
    api, retunes, sent, agents,
    emit(e: ApiEvent) { for (const l of [...listeners]) l(e); },
    /** Run the registered policy like the spawner would. */
    spawn: (args: Partial<Parameters<SpawnPolicy>[0]> & { name: string }, c: Partial<typeof caller> & { policyMeta?: unknown } = {}) =>
      policy!({ systemPrompt: "sys", message: "do it", ...args }, { ...caller, ...c }),
    hasPolicy: () => policy !== undefined,
  };
}
