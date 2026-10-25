// Usage: pi-analyse [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--agent-dir P] [--out DIR] [--check] [--apply]
// On-demand analysis of pi's own logs (fields in <agentDir>/LOGS.md). Writes <out>/<YYYY-MM-DD>-<HHMM>-analysis.md
// and .json (UTC time of the run; default out: <agentDir>/reports). --check only checks the data contract for the period and
// exits 1 when a required field is missing. --apply also writes the kill-switch arms and the posterior to
// <agentDir>/experiments/state.json (atomically); without it nothing outside <out> is written.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { analyse, applyKill, inPeriod, renderAnalysis, reportName, type FileInfo, type LogName, type Logs } from "../core/analyse.ts";
import { check, renderProblems } from "../core/contract.ts";
import { loadSettings } from "../core/settings.ts";

const USAGE = "usage: pi-analyse [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--agent-dir P] [--out DIR] [--check] [--apply]\n";
const args = process.argv.slice(2);
const FLAGS = ["--check", "--apply"];
const VALUED = ["--since", "--until", "--agent-dir", "--out"];
const opt: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  if (FLAGS.includes(args[i])) continue;
  if (VALUED.includes(args[i]) && args[i + 1] !== undefined) { opt[args[i]] = args[++i]; continue; }
  process.stderr.write(`pi-analyse: unknown argument ${args[i]}\n${USAGE}`);
  process.exit(2);
}
for (const k of ["--since", "--until"]) {
  if (opt[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opt[k])) {
    process.stderr.write(`pi-analyse: ${k} wants a UTC day YYYY-MM-DD, got ${opt[k]}\n${USAGE}`);
    process.exit(2);
  }
}
const agentDir = opt["--agent-dir"] ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const period = { since: opt["--since"], until: opt["--until"] };

const files: FileInfo[] = [];
/** Every parsable line of `file`, or of every *.jsonl in the directory `path` (missing → none; torn lines are counted). */
function read(log: LogName, path: string): any[] {
  let names: string[] = [];
  try { names = statSync(path).isDirectory() ? readdirSync(path).filter((n) => n.endsWith(".jsonl")).sort().map((n) => join(path, n)) : [path]; } catch { /* no such log */ }
  const out: unknown[] = [];
  for (const file of names) {
    const info = { log, file, lines: 0, unparsable: 0 };
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      info.lines += 1;
      try { out.push(JSON.parse(raw)); } catch { info.unparsable += 1; }
    }
    files.push(info);
  }
  return out;
}
const readJson = (file: string): any => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; } };

const meterDir = loadSettings(join(agentDir, "token-meter", "settings.json")).dir;
const logs: Logs = {
  meter: read("meter", isAbsolute(meterDir) ? meterDir : join(agentDir, meterDir)),
  outcomes: read("outcomes", join(agentDir, "task-router", "outcomes")),
  assignments: read("assignments", join(agentDir, "experiments", "assignments.jsonl")),
  guards: read("guards", join(agentDir, "guards")),
  files,
  expSettings: readJson(join(agentDir, "experiments", "settings.json")),
  routerSettings: readJson(join(agentDir, "task-router", "settings.json")),
};

if (args.includes("--check")) {
  const p = inPeriod(logs, period);
  const assignments = inPeriod({ ...logs, guards: logs.assignments }, period).guards;
  const problems = check({ ...p, assignments }, logs);
  process.stdout.write(renderProblems(problems));
  process.exit(problems.length ? 1 : 0);
}

const writeAtomic = (file: string, body: string) => {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file);
};
const now = new Date();
const a = analyse(logs, period);
const out = opt["--out"] ?? join(agentDir, "reports");
mkdirSync(out, { recursive: true });
const base = join(out, reportName(now));
writeAtomic(`${base}.md`, renderAnalysis(a, now));
writeAtomic(`${base}.json`, JSON.stringify({ generated: now.toISOString(), ...a }, null, 2) + "\n");
process.stdout.write(`${base}.md\n${base}.json\n$${a.cost.totalUsd.toFixed(2)} over ${a.cost.activeHours.toFixed(1)} active h; ${a.quality.problems.length} contract problem(s); kill switch: ${Object.keys(a.guards.kill).join(", ") || "none"}\n`);
if (args.includes("--apply")) {
  const exp = join(agentDir, "experiments");
  mkdirSync(exp, { recursive: true });
  const file = join(exp, "state.json");
  const next = applyKill(readJson(file), a);
  writeAtomic(file, JSON.stringify(next, null, 2) + "\n");
  process.stdout.write(`${file}: disabled: ${next.disabled.join(", ") || "none"}\n`);
}
