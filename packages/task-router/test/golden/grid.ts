// The input space of the golden grid (spec §8.2): 146,880 plan cases and 470,016 explicit cases. The counts are criteria.
import type { Importance, T0, ThinkingLevel } from "../../core/types.ts";

export const K = ["bounded", "specified", "verifiable", "lowRisk", "small", "linear"] as const;
export const BUILT = ["scout", "mechanical", "implement", "debug-design", "review", "plan"];
const P = (o: object) => ({ tools: "all", skills: [], report: "default", ...o });
export type Variant = { name: "v1" | "v2"; profiles: Record<string, object>; kinds: string[] };
export const VARIANTS: Variant[] = [
  {
    name: "v1",
    profiles: { ro: P({ tools: "read-only" }), pq: P({ tier: "qwen" }), p1: P({ tier: "T1" }), p2: P({ tier: "T2" }), m1: P({ minTier: "T1" }) },
    kinds: [...BUILT, "ro", "pq", "p1", "p2", "m1"],
  },
  { name: "v2", profiles: { scout: { tier: "qwen" }, review: { tier: "T1" }, "debug-design": { minTier: "T2" } }, kinds: BUILT },
];
export type T2Mode = "none" | "t2" | "force";
export type Rnd = "off" | "hit" | "miss";
export type Seq = 0 | 1 | 2 | 3 | "t2add";
export type First = { kind: string; bits: number; t0: T0; t2m: T2Mode; imp: Importance };
export type Case = First & { rnd: Rnd; seq: Seq };
export function* firsts(v: Variant): Generator<First> {
  for (const kind of v.kinds)
    for (let bits = 0; bits < 64; bits++)
      for (const t2m of ["none", "t2", "force"] as const)
        for (const imp of ["normal", "high", "critical"] as const)
          yield { kind, bits, t0: Object.fromEntries(K.map((k, i) => [k, !(bits & (1 << i))])) as T0, t2m, imp };
}
export const RNDS: Rnd[] = ["off", "hit", "miss"];
export const SEQS: Seq[] = [0, 1, 2, 3, "t2add"];
export const MODELS = {
  local: "llama/qwen3.8",
  free: "openrouter/qwen/qwen3.8-27b:free",
  haiku: "anthropic/claude-haiku-5-5",
  sonnet: "anthropic/claude-sonnet-5-5",
  opus: "anthropic/claude-opus-5-5",
};
export const MODS = [undefined, MODELS.local, MODELS.free, MODELS.haiku, MODELS.sonnet, MODELS.opus];
export const EFFS: (ThinkingLevel | undefined)[] = [undefined, "off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** One routed spawn as the oracle sees it: "base/workerTier/workerEffort/reviewTier/reviewEffort" or "REJECT". */
export interface Router {
  /** Labels of the attempt sequence, joined " | ": spawn i has `attemptOf` = spawn i−1; "t2add" = two spawns, the second with a t2 trigger. */
  seq(v: Variant, c: Case): string;
  /** The first plan (rnd off, seq 0, fresh state) and an explicit model/effort: "tier/effort" or "REJECT". */
  explicit(v: Variant, c: First, model?: string, effort?: ThinkingLevel): string;
}
/** Per-spawn inputs of a sequence, shared by the oracle and the SUT drivers. */
export function* spawns(c: Case): Generator<{ id: string; attemptOf?: string; t2: boolean }> {
  const n = c.seq === "t2add" ? 1 : c.seq;
  for (let i = 0; i <= n; i++) yield { id: `t${i}`, ...(i ? { attemptOf: `t${i - 1}` } : {}), t2: c.t2m === "t2" || (c.seq === "t2add" && i === 1) };
}
/** The random draw of a case: hit → 0, miss → 0.99 (rnd "off" disables randomization instead). */
export const drawOf = (r: Rnd): number => (r === "hit" ? 0 : 0.99);
