// Usage: node --experimental-strip-types meter-report.ts [--dir <meterDir>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//        meter-report.ts --arms [--posterior] [--agent-dir <dir>]   per-arm experiment analysis; --posterior also
//        writes <agentDir>/experiments/state.json (posterior rewards, kill-switch arms) atomically.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { armStats, nextState, renderArms } from "../core/arms.ts";
import { acceptance, killSwitch, signals } from "../core/guards.ts";
import { aggregate, render } from "../core/report.ts";
import { taskCosts } from "../core/tasks.ts";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const agentDir = opt("--agent-dir") ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const dir = opt("--dir") ?? join(agentDir, "meter");

/** Every parsable line of every *.jsonl in `d` (missing dir → none; torn or foreign lines are skipped). */
function readLines(d: string): any[] {
  const out: unknown[] = [];
  let names: string[] = [];
  try { names = readdirSync(d).filter((n) => n.endsWith(".jsonl")).sort(); } catch { /* no such log */ }
  for (const f of names) {
    for (const raw of readFileSync(join(d, f), "utf8").split("\n")) {
      if (!raw.trim()) continue;
      try { out.push(JSON.parse(raw)); } catch { /* skip */ }
    }
  }
  return out;
}
const readJson = (file: string): any => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; } };

if (args.includes("--arms") || args.includes("--posterior")) {
  const exp = join(agentDir, "experiments");
  const settings = readJson(join(exp, "settings.json"));
  const flags: Record<string, Record<string, string>> = {};
  for (const r of readLines(exp)) if (typeof r?.arm === "string" && r.flags) flags[r.arm] = r.flags;
  const meter = readLines(dir);
  const outcomes = readLines(join(agentDir, "task-router", "outcomes"));
  const stats = armStats(meter, { flags });
  const acc = acceptance(outcomes);
  // Own defaults for experiments' `guards` (a package cannot import another's settings).
  const g = settings?.guards ?? {};
  const limits = { minSessions: g.minSessions ?? 10, threshold: g.threshold ?? 0.2, peekThreshold: g.peekThreshold ?? 1, correctionThreshold: g.correctionThreshold ?? 1, ratingThreshold: g.ratingThreshold ?? 0.5 };
  const sig = signals(readLines(join(agentDir, "guards")));
  const baseline = settings?.baseline ?? stats.find((s) => /^-+$/.test(s.arm))?.arm ?? "";
  const reasons = killSwitch(stats, acc, limits, baseline, sig);
  if (args.includes("--arms")) process.stdout.write(renderArms(stats, acc, reasons, sig, taskCosts(meter, outcomes)));
  if (args.includes("--posterior")) {
    const file = join(exp, "state.json");
    mkdirSync(exp, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(nextState(readJson(file), stats, reasons), null, 2) + "\n");
    renameSync(tmp, file);
    if (!args.includes("--arms")) process.stdout.write(`state.json: ${stats.length} arms, ${Object.keys(reasons).length} newly disabled\n`);
  }
} else {
  process.stdout.write(render(aggregate(readLines(dir), { from: opt("--from"), to: opt("--to") })));
}
