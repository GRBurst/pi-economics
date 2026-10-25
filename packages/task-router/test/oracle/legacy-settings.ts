// FROZEN ORACLE — copy of core/settings.ts at d79921d, imports rewritten; never edit (spec §8.2; plan T0.3).
// Settings live in <agentDir>/task-router/settings.json. Every key has a
// default, so the extension runs with no file at all (plain `pi install`).
import { readFileSync } from "node:fs";
import type { RouterSettings } from "./legacy-types.ts";

export type Settings = RouterSettings;

export function defaults(): Settings {
  return {
    // T0.3 pilot: Qwen xhigh passed 13–14-file mechanical changes; it failed on
    // long-horizon cross-module work (peak ≥ 200k), not on file count.
    t0Limits: { files: 10, tokens: 150000 },
    models: {
      qwenLocal: "llama/qwen3.8",
      qwenCloud: "openrouter/qwen/qwen3.8-27b:free",
      T1: "anthropic/claude-sonnet-5-5",
      T2: "anthropic/claude-opus-5-5",
    },
    localHealthUrl: "http://earth:11545",
    cloudDailyCap: 950,
    queueMaxSec: 120,
    checkTimeoutSec: 900,
    runaway: { requests: 150, usd: 10 },
    contextGuard: 0.5,
    // Tokens per tier (Qwen 262K; Sonnet/Opus assumed 200K, the conservative standard window).
    contextWindow: { qwen: 262144, T1: 1000000, T2: 1000000 },
    freshOnCold: { mode: "advise", minTokens: 150000 },
    maxBurstTurns: 1,
    riskGlobs: ["**/auth/**", "**/*crypt*", "**/*migrat*", "**/secrets/**"],
    // Case-insensitive substrings of file names, check and acceptance text.
    // riskKeywords only clear lowRisk; a t2Keywords match also forces T2.
    riskKeywords: ["password", "credential", "secret", "migrat", "encrypt", "sudo", "production", "deploy", "delete"],
    t2Keywords: {
      security: ["authentication", "authorization", "privilege escalation", "sandbox escape", "csrf", "xss", "sql injection"],
      concurrency: ["race condition", "deadlock", "mutex", "thread-safe"],
      "migration-destructive": ["drop table", "rm -rf", "force push", "irreversible", "destructive"],
      "repo-wide": ["repo-wide", "repository-wide", "whole repo", "every file", "all files"],
      "interface-change": ["breaking change", "public api", "schema change"],
      "unknown-root-cause": ["unknown root cause", "root cause unknown"],
      "open-design": ["open design question"],
    },
    pathRules: [],
    profiles: {},
    // Inline mechanical calls (no spawn, no user input) before the main session is reminded to delegate (T5.19).
    // rule "on": the card section opens with the orchestrator rule (T8.9; the experiments factor delegationRule switches it).
    delegation: { nudge: "on", afterCalls: 6, tools: ["edit", "write", "bash", "grep", "find", "read"], rule: "off" },
    routing: true,
    verifyGate: true,
    autoEscalate: true,
    // T5.21/T5.22: off by default; the user's Home Manager config switches them on.
    randomize: { enabled: false, share: 0.2 },
    spotCheck: { enabled: false, share: 0.1 },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// Known keys of the right type override; objects merge recursively, except an
// empty-object default (`profiles`), whose keys are open.
function merge(base: Record<string, unknown>, raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    const b = base[k];
    if (!(k in base)) continue;
    if (isObj(b) && isObj(v)) out[k] = Object.keys(b).length === 0 ? v : merge(b, v);
    else if (Array.isArray(b) ? Array.isArray(v) : typeof v === typeof b) out[k] = v;
  }
  return out;
}

/** Missing or invalid file → defaults(). */
export function loadSettings(file: string): Settings {
  const base = defaults();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return base;
  }
  return isObj(raw) ? (merge(base as unknown as Record<string, unknown>, raw) as unknown as Settings) : base;
}
