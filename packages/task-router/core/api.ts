// Types of the actor-subagents API (plan S6, patch api.ts) as the router sees it. Types only: erased at load time.
// spawn-api patch (spawnPolicyApi 2, plan S16): ChildTool, SpawnResult, PolicyResult.childTools/cwd, spawn?/kill?.
import type { Guard } from "./toolguard.ts";
import type { ThinkingLevel } from "./types.ts";

export type SpawnArgs = { name: string; systemPrompt: string; message: string; model?: string; thinkingLevel?: ThinkingLevel; task?: unknown };
export type Caller = { name: string; sessionId: string; model: string; thinkingLevel: ThinkingLevel | undefined; policyMeta?: unknown; cwd: string };
/** A tool given to one child only (spawn-api patch): `execute` receives the call's input object itself. */
export type ChildTool = {
  name: string; description: string; parameters: Record<string, unknown>;
  execute(input: unknown): Promise<{ text: string; isError?: boolean; terminate?: boolean }>;
};
export type PolicyResult =
  | { model: string; thinkingLevel: ThinkingLevel; briefAppend?: string; tools?: string[]; meta?: unknown; toolGuard?: Guard; childTools?: ChildTool[]; cwd?: string }
  | { reject: string };
export type SpawnPolicy = (a: SpawnArgs, c: Caller) => PolicyResult | Promise<PolicyResult>;
export type SpawnResult = { ok: true; name: string; sessionId: string } | { ok: false; reason: string };
export type AgentInfo = {
  name: string; parent: string; sessionId: string; model: string; thinkingLevel: ThinkingLevel | undefined;
  state: "running" | "idle" | "paused"; idleSinceMs?: number; lastRequestAt?: number; contextTokens?: number; costUsd?: number; policyMeta?: unknown;
};
export type ApiEvent =
  | { type: "spawn"; name: string; by: string; parent: string; childSessionId?: string; ts: number }
  | { type: "route"; from: string; to: string; preview: string; buffered: boolean; ts: number }
  | { type: "turn"; name: string; ts: number }
  | { type: "pause" | "resume"; names: string[]; ts: number }
  | { type: "kill"; name: string; ts: number }
  | { type: "error"; name: string; reason: string; ts: number };
export interface SubagentsApiV1 {
  version: 1;
  registerSpawnPolicy(fn: SpawnPolicy): () => void;
  subscribe(l: (e: ApiEvent) => void): () => void;
  retune(name: string, t: { model?: string; thinkingLevel?: ThinkingLevel }): Promise<void>;
  send(to: string, text: string, from?: string): Promise<void>;
  list(): AgentInfo[];
  /** spawnPolicyApi ≥ 2: spawn through the registered policy as `by` (default "main"); quiet: no notices, no roster entry, and
   *  no agent (its spawner included) may message or control the child: only the API and the user act on it (LD13). */
  spawn?(args: SpawnArgs, opts?: { by?: string; quiet?: boolean }): Promise<SpawnResult>;
  /** spawnPolicyApi ≥ 2: kill as the actor "api" (main's authority); resolves with the names taken down. */
  kill?(names: string[]): Promise<string[]>;
}
