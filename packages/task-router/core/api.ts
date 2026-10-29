// Types of the actor-subagents API (plan S6, patch api.ts) as the router sees it. Types only: erased at load time.
import type { ThinkingLevel } from "./types.ts";

export type SpawnArgs = { name: string; systemPrompt: string; message: string; model?: string; thinkingLevel?: ThinkingLevel; task?: unknown };
export type Caller = { name: string; sessionId: string; model: string; thinkingLevel: ThinkingLevel | undefined; policyMeta?: unknown; cwd: string };
export type PolicyResult =
  | { model: string; thinkingLevel: ThinkingLevel; briefAppend?: string; tools?: string[]; meta?: unknown; toolGuard?: (toolName: string, input: unknown) => string | undefined }
  | { reject: string };
export type SpawnPolicy = (a: SpawnArgs, c: Caller) => PolicyResult | Promise<PolicyResult>;
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
}
