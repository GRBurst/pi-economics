// Shared types of the router core (plan S7). Types only: erased at load time.
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export type Kind = string; // a profile name; built-ins: scout mechanical implement debug-design review plan
export type Importance = "normal" | "high" | "critical";

/** A profile's requirement (spec §4.3): `ability` (default write), `table` (default the ability's), a pin `level` or a floor `minLevel`. */
export type Profile = {
  ability?: Ability;
  table?: string;
  level?: number | "top";
  minLevel?: number;
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

/** What a card needs (spec §4.3): a level on an ability's scale; `draft` = write 0 with one soft miss; `pinned` = the profile's `level`. */
export type Requirement = { ability: Ability; level: number; draft: boolean; pinned: boolean; reasons: string[] };
/** A leg of the importance table: a level on the ability's scale and a step on the member's effort ladder (spec §4.4). */
export type Leg = { level: number; step: number };
export type Cell = { worker: Leg; review?: Leg };
export type Rows = Record<string /* level */, Record<Importance, Cell>>;
/** A plan leg resolved to its planned member (labels for the log and the brief). */
export type PlanLeg = Leg & { member: string; model: string; tier: string; effort: ThinkingLevel };
/** A routed plan (spec §4.4): the requirement, its legs resolved to their planned members, the log's labels.
 *  `assigned`/`routeBase` (T5.21): who chose the worker and the tier the router computed before randomization. */
export type Plan = {
  ability: Ability; level: number; draft?: true; worker: PlanLeg; review?: PlanLeg;
  base: string; importance: Importance; reasons: string[]; assigned?: "router" | "random"; routeBase?: string;
};
/** What `spawnEvent` reads; a routed Plan and the unrouted stand-in both satisfy it. */
export type LoggedPlan = {
  worker: { tier: string; effort: ThinkingLevel; level?: number }; review?: { tier: string; effort: ThinkingLevel; level?: number };
  base: string; importance: Importance; reasons: string[]; assigned?: "router" | "random"; routeBase?: string;
  ability?: Ability; level?: number; draft?: true;
};
/** What a routed child started on (spec §6.4, AC4): its member and model, the effort it started at, the time it waited. */
export type Start = { member: string; model: string; effort: ThinkingLevel; waitMs: number };

export type RouterSettings = {
  t0Limits: { files: number; tokens: number };
  models: Record<string, Member>;
  /** Importance table per name (a profile's `table`, else its ability): level → importance → cell (spec §4.4). */
  importanceTable: Record<string, Rows>;
  /** Read-only profiles at critical: "effort-step" raises the worker instead of adding a review (the default since T5.3, D1). */
  readOnlyReview: "effort-step" | "review";
  /** Share of a member's window the files may fill; 0 = the context filter is off (T5.6). */
  contextFit: number;
  queueMaxSec: number;
  checkTimeoutSec: number;
  runaway: { requests: number; usd: number };
  contextGuard: number;
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

export type Ability = string; // built-in scales: "write", "read"
/** A routable model and its facts (spec §4.2). `model: ""` = empty: the member does not exist (MP2). */
export type Member = {
  model: string; tier: string; route: string; provider?: string;
  abilities: Record<Ability, number>; efforts: ThinkingLevel[]; contextWindow: number; cost: number;
  order?: number; slots?: number; health?: string; dailyCap?: number;
};
