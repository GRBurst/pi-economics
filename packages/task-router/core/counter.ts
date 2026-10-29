// Requests per member per UTC day, for members with a dailyCap: <agentDir>/task-router/member-count.json,
// {"2026-10-02": {"qwen-cloud": 12}}. A lower bound: an account cap is shared with the user's own sessions; `freeCapHit` is authoritative.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export type MemberCounter = { today(member: string): number; bump(member: string): void };

export function createMemberCounter(file: string, now: () => Date): MemberCounter {
  const day = () => now().toISOString().slice(0, 10);
  const read = (): Record<string, unknown> => {
    try { const j = JSON.parse(readFileSync(file, "utf8")); return isObj(j?.[day()]) ? j[day()] : {}; } catch { return {}; }
  };
  return {
    today: (member) => Number(read()[member]) || 0,
    /** One request. Re-reads the file first so concurrent pi sessions do not overwrite each other; older days are dropped. */
    bump(member) {
      try {
        mkdirSync(dirname(file), { recursive: true });
        const t = read();
        writeFileSync(file, JSON.stringify({ [day()]: { ...t, [member]: (Number(t[member]) || 0) + 1 } }));
      } catch (err) {
        console.warn(`task-router: member count write failed: ${(err as Error).message}`);
      }
    },
  };
}
