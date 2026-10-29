// FROZEN ORACLE — copy of core/types.ts at d79921d, imports rewritten; never edit (spec §8.2; plan T0.3).
// Shared types of the router core (plan S7). Types only: erased at load time.
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export type Kind = string; // a profile name; built-ins: scout mechanical implement debug-design review plan
export type Tier = "qwen" | "T1" | "T2";
export type Importance = "normal" | "high" | "critical";

export type Profile = {
  tier?: Tier;
  minTier?: Tier;
  tools: "all" | "read-only" | "read-only+files";
  skills: string[];
  report: "default" | "answer" | "plan" | "review";
};

export type T0 = {
  bounded: boolean;
  specified: boolean;
  verifiable: boolean;
  lowRisk: boolean;
  small: boolean;
  linear: boolean;
};
export type T2 =
  | "open-design"
  | "interface-change"
  | "security"
  | "concurrency"
  | "migration-destructive"
  | "repo-wide"
  | "unknown-root-cause";

export type Card = {
  kind: Kind;
  files: string[];
  check?: string;
  acceptance: string[];
  t0: T0;
  t2: T2[];
  importance?: "high" | "critical";
  attemptOf?: string;
  failure?: string;
  skills?: string[];
  /** Working directory of the task: files and check resolve against it (absolute or `~/…`; default the caller's cwd). */
  cwd?: string;
  /** Task id this card reviews (a spot-check review, T5.22). */
  reviewOf?: string;
};

export type Leg = { tier: Tier; effort: ThinkingLevel };
export type Base = "qwen" | "qwen-draft" | "T1" | "T2";
/** `assigned`/`routeBase` (T5.21): who chose the worker tier and the tier the router computed before randomization. */
export type Plan = { worker: Leg; review?: Leg; base: Base; importance: Importance; reasons: string[]; assigned?: "router" | "random"; routeBase?: Tier };

export type RouterSettings = {
  t0Limits: { files: number; tokens: number };
  models: { qwenLocal: string; qwenCloud: string; T1: string; T2: string };
  localHealthUrl: string;
  cloudDailyCap: number;
  queueMaxSec: number;
  checkTimeoutSec: number;
  runaway: { requests: number; usd: number };
  contextGuard: number;
  contextWindow: { qwen: number; T1: number; T2: number };
  freshOnCold: { mode: string; minTokens: number };
  maxBurstTurns: number;
  riskGlobs: string[];
  riskKeywords: string[];
  t2Keywords: Partial<Record<T2, string[]>>;
  pathRules: { glob: string; level: Importance }[];
  profiles: Record<string, Profile>;
  /** nudge "off" also switches the handoff lever off (no "start immediately" line in child briefs). */
  /** rule "on" adds the orchestrator rule to the main session's card section (flag `delegationRule`). */
  delegation: { nudge: string; afterCalls: number; tools: string[]; rule: string };
  routing: boolean;
  verifyGate: boolean;
  autoEscalate: boolean;
  /** Task-level randomization (T5.21): a Qwen worker goes to T1 with probability `share`. */
  randomize: { enabled: boolean; share: number };
  /** Spot-check reviews (T5.22): an accepted verdict asks for a fresh review with probability `share`. */
  spotCheck: { enabled: boolean; share: number };
};
