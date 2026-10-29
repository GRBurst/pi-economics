// Verify gate (spec §5.2.7): when a child that has a `check` reports to its parent and settles, the router runs the
// check itself and sends the parent the exit code and the output tail, so "done" is never taken on the child's word.
import { spawn } from "node:child_process";
import type { ApiEvent } from "./api.ts";
import type { PolicyDeps } from "./policy.ts";

export type CheckResult = { exit: number; output: string; timedOut: boolean };
export type Runner = (cmd: string, cwd: string, timeoutMs: number) => Promise<CheckResult>;

/** `bash -lc cmd` in its own process group; the group is killed on timeout (exit 124). Output = stdout+stderr, last 20 kB. */
export const runCheck: Runner = (cmd, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const p = spawn("bash", ["-lc", cmd], { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let output = "";
    let timedOut = false;
    const add = (b: Buffer) => { output = (output + b).slice(-20_000); };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-p.pid!, "SIGKILL"); } catch { p.kill("SIGKILL"); } }, timeoutMs);
    p.on("error", (e) => { clearTimeout(timer); resolve({ exit: 127, output: String(e), timedOut: false }); });
    p.on("close", (code) => { clearTimeout(timer); resolve({ exit: timedOut ? 124 : (code ?? 1), output, timedOut }); });
  });

const TAIL_LINES = 40;
const IDLE_POLLS = 60;
const POLL_MS = 2000;

export function createGate(d: PolicyDeps & { run: Runner; log: { check(taskId: string, exit: number, ms: number): void } }) {
  const running = new Set<string>();
  const idle = async (name: string): Promise<boolean> => {
    for (let i = 0; i < IDLE_POLLS; i++) {
      const st = d.api()?.list().find((a) => a.name === name)?.state;
      if (st === undefined) return false; // gone
      if (st === "idle") return true;
      await d.sleep(POLL_MS);
    }
    return false;
  };
  return (e: ApiEvent): void => {
    if (e.type !== "route" || !d.settings.verifyGate) return;
    const c = d.children.get(e.from);
    const check = c?.card.check?.trim();
    if (!c || !check || e.to !== c.parent || running.has(e.from)) return;
    running.add(e.from);
    void (async () => {
      try {
        if (!(await idle(e.from))) return;
        const t0 = d.now();
        const r = await d.run(check, c.cwd, d.settings.checkTimeoutSec * 1000);
        d.log.check(e.from, r.exit, d.now() - t0);
        const tail = r.output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
        const head = `[verify] ${e.from}: \`${check}\` ${r.timedOut ? `timed out after ${d.settings.checkTimeoutSec} s (exit ${r.exit})` : `exit ${r.exit}`}`;
        await d.api()?.send(c.parent, tail ? `${head}\n${tail}` : head, "router");
      } catch (err) {
        console.warn(`task-router: verify gate for ${e.from} failed: ${(err as Error).message}`);
      } finally {
        running.delete(e.from);
      }
    })();
  };
}
