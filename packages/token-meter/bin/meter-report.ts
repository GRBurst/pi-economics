#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Usage: node --experimental-strip-types meter-report.ts [--dir <meterDir>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//        meter-report.ts --arms [--posterior] [--agent-dir <dir>]   per-arm experiment analysis; --posterior also
//        writes <agentDir>/experiments/state.json (posterior rewards, kill-switch arms) atomically: the v1
//        engine's designs flat, the v2 engine's per design and stratum under `designs.<id>.<stratum>` (T5c.9).
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { armStats, nextState, renderArms, V2_SCOPE } from "../core/arms.ts";
import { acceptance, killSwitch, signals, withSpawnArms } from "../core/guards.ts";
import { aggregate, render } from "../core/report.ts";
import { taskCosts } from "../core/tasks.ts";
import { isRequestLine } from "../core/analyse/logs.ts";
import { rowsBySession } from "../core/analyse/designs.ts";
import { experiment } from "../core/analyse/experiment.ts";
import { guards } from "../core/analyse/guards.ts";

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
  const all = readLines(dir).filter(isRequestLine); // levers lines record settings, no request
  const rows = readLines(exp);
  const outcomes = withSpawnArms(readLines(join(agentDir, "task-router", "outcomes")), all, rows); // spawn arms joined (M5b.2)
  // The v2 engine's roots are analysed per design and stratum (below); the flat tables are the v1–v4 designs'.
  const v2Roots = new Set(rows.filter((r) => r?.v === 2 && typeof r.sessionId === "string").map((r) => r.sessionId as string));
  const meter = all.filter((l) => !v2Roots.has(l.parentSessionId ?? l.sessionId));
  const stats = armStats(meter, { flags });
  const acc = acceptance(outcomes);
  // Own defaults for experiments' `guards` (a package cannot import another's settings).
  const g = settings?.guards ?? {};
  const limits = { minSessions: g.minSessions ?? 10, threshold: g.threshold ?? 0.2, peekThreshold: g.peekThreshold ?? 1, correctionThreshold: g.correctionThreshold ?? 1, ratingThreshold: g.ratingThreshold ?? 0.5 };
  const sig = signals(readLines(join(agentDir, "guards")));
  const baseline = settings?.baseline ?? stats.find((s) => /^-+$/.test(s.arm))?.arm ?? "";
  const reasons = killSwitch(stats, acc, limits, baseline, sig);
  const v2 = guards(experiment(all, rows, settings), outcomes, readLines(join(agentDir, "guards")), settings, rowsBySession(rows)).perStratum;
  if (args.includes("--arms")) {
    process.stdout.write(renderArms(stats, acc, reasons, sig, taskCosts(meter, outcomes), !v2.length));
    for (const x of v2) process.stdout.write(`\n### design ${x.design} stratum ${x.stratum} (baseline \`${x.baseline}\`)\n\n${renderArms(x.arms, x.acc, x.kill, x.sig, {}, false)}`);
    if (v2.length) process.stdout.write(`\n${V2_SCOPE}\n`);
  }
  if (args.includes("--posterior")) {
    const file = join(exp, "state.json");
    mkdirSync(exp, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(nextState(readJson(file), stats, reasons, v2), null, 2) + "\n");
    renameSync(tmp, file);
    if (!args.includes("--arms")) process.stdout.write(`state.json: ${stats.length} arms, ${Object.keys(reasons).length} newly disabled; ${v2.length} design/stratum pair(s) of the v2 engine, ${v2.reduce((n, x) => n + Object.keys(x.kill).length, 0)} newly disabled\n${V2_SCOPE}\n`);
  }
} else {
  process.stdout.write(render(aggregate(readLines(dir), { from: opt("--from"), to: opt("--to") })));
}
