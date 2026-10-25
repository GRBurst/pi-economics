// Counter of requests to the free cloud tier, per UTC day, in <agentDir>/task-router/cloud-count.json
// ({"2026-10-02": 12}). A lower bound: the account cap is shared with the user's own sessions; `freeCapHit` is authoritative.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function createCloudCounter(file: string, now: () => Date) {
  const day = () => now().toISOString().slice(0, 10);
  const today = (): number => {
    try { return Number(JSON.parse(readFileSync(file, "utf8"))[day()]) || 0; } catch { return 0; }
  };
  return {
    today,
    /** One request. Re-reads the file first so concurrent pi sessions do not overwrite each other; older days are dropped. */
    bump(): void {
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ [day()]: today() + 1 }));
      } catch (err) {
        console.warn(`task-router: cloud count write failed: ${(err as Error).message}`);
      }
    },
  };
}
