// spec §8.1 `log-contract`: the logs pi writes carry everything
// `pi-analyse` needs. Every writer runs its REAL code path (each package's own test fakes stand
// in for pi and the subagents API) into one agent dir; then `pi-analyse --check` must pass and a
// full analysis must render every section with data. Dropping a required field in any writer
// (planted P31) turns this red and names the field.
//
// usage: node --experimental-strip-types contract.ts <workdir>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { install as installMeter } from "../../packages/token-meter/core/shell.ts";
import { fakeCtx as meterCtx, fakePi as meterPi } from "../../packages/token-meter/test/fake-pi.ts";
import { harness, card } from "../../packages/task-router/test/harness.ts";
import { install as installCache } from "../../packages/cache-lifecycle/core/shell.ts";
import { defaults as cacheDefaults } from "../../packages/cache-lifecycle/core/settings.ts";
import { fakeCtx as cacheCtx, fakePi as cachePi } from "../../packages/cache-lifecycle/test/fake-pi.ts";
import { asst, tool, user } from "../../packages/cache-lifecycle/test/msgs.ts";
import { install as installExperiments } from "../../packages/experiments/core/shell.ts";
import { defaults as expDefaults } from "../../packages/experiments/core/settings.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const BIN = resolve(here, "../../packages/token-meter/bin/pi-analyse.ts");
const work = resolve(process.argv[2] ?? "pi-log-contract.out");
const agentDir = join(work, "agent");
mkdirSync(agentDir, { recursive: true });

const MIN = 60_000;
const P = "anthropic-ratelimit-";
// experiments stamps assignments and guards with the real clock; the other writers follow it so
// every line lies after its session's assignment (the arm rule of the contract applies to them).
const clock = { t: Date.now() + MIN };
const tick = (m = 2) => (clock.t += m * MIN);
const settle = () => new Promise((r) => setImmediate(r));

// --- experiments: assignment rows, correction + rating guards, arm inheritance via spawn events
const tr = harness({ agentDir, extra: { run: async () => ({ exit: 0, output: "ok\n", timedOut: false }) } as never });
const exp = { handlers: new Map<string, Array<(e: any, ctx: any) => unknown>>(), commands: new Map<string, any>() };
installExperiments(
  { on: (n: string, h: any) => void exp.handlers.set(n, [...(exp.handlers.get(n) ?? []), h]), registerCommand: (n: string, c: any) => void exp.commands.set(n, c) },
  { agentDir, settings: expDefaults(), rng: () => 0.5, api: () => tr.a.api as never },
);
const expCtx = (sid: string) => ({ sessionManager: { getSessionId: () => sid }, ui: { notify: () => {} } });
const expFire = (n: string, e: unknown, sid: string) => (exp.handlers.get(n) ?? []).forEach((h) => h(e, expCtx(sid)));

// --- token-meter: turns with usage and quota headers; a child's session file names its parent
const meter = meterPi();
installMeter(meter.pi, { agentDir, now: () => new Date(clock.t) });
let q5h = 10;
function turn(sid: string, parent?: string, model = "claude-opus-5-5", usd = 0.4): void {
  const ctx = meterCtx(sid, parent ? { file: `/sessions/subagents/${parent}/${sid}.jsonl` } : {});
  meter.fire("before_provider_request", {}, ctx);
  meter.fire("after_provider_response", { type: "after_provider_response", status: 200,
    headers: { [P + "unified-5h-utilization"]: String(q5h++ / 100), [P + "unified-7d-utilization"]: "0.2" } }, ctx);
  meter.fire("message_end", { type: "message_end", message: { role: "assistant", provider: "anthropic", model, stopReason: "stop", thinkingLevel: "high",
    usage: { input: 10, output: 500, cacheRead: 20_000, cacheWrite: 2_000, totalTokens: 22_510, reasoning: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usd } } } }, ctx);
  tick();
}

// --- cache-lifecycle: a cold context masks old tool output, then context_peek → peek-after-mask
const cache = cachePi();
installCache(cache.pi as never, { agentDir, settings: { ...cacheDefaults(), maskOnCold: "tools", protectedTailTokens: 3000 }, now: () => clock.t, api: () => undefined });
const big = "x".repeat(12000);
const coldMessages = () => [
  user("go"), asst("r1", [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }]), tool("c1", "bash", big),
  asst("r2", [{ type: "toolCall", id: "c2", name: "read", arguments: {} }]), tool("c2", "read", big),
  asst("r3", [{ type: "text", text: "ok" }]),
];

async function mainSession(sid: string, child: string, usd: number): Promise<void> {
  expFire("session_start", {}, sid);
  tr.clock.t = clock.t;
  for (let i = 0; i < 6; i++) turn(sid, undefined, undefined, usd);
  // task-router: a routed spawn, the child's session id, its check and the verdict
  tr.clock.t = clock.t;
  const r = await tr.a.spawn({ name: child, task: card() }, { sessionId: sid });
  assert.ok(!("reject" in r), `${child}: spawn rejected`);
  tr.a.emit({ type: "spawn", name: child, by: "main", parent: "main", childSessionId: child, ts: clock.t });
  for (let i = 0; i < 4; i++) turn(child, sid, "qwen3-coder");
  tr.a.agents.splice(0, tr.a.agents.length, { name: child, parent: "main", sessionId: child, model: "x", thinkingLevel: "xhigh", state: "idle" } as never);
  tr.clock.t = clock.t;
  tr.a.emit({ type: "route", from: child, to: "main", preview: "done", buffered: false, ts: clock.t });
  await settle(); await settle();
  tr.clock.t = clock.t;
  const v = await tr.f.callTool("task_verdict", { name: child, verdict: "accepted", note: "contract" });
  assert.ok(!v.isError, `${child}: task_verdict failed`);
  // a failover (an engine error on a routed child → reroute) and a re-spawn with attemptOf (→ escalate), real path
  const fail = `${child}-fail`, again = `${child}-again`;
  tr.clock.t = clock.t;
  assert.ok(!("reject" in await tr.a.spawn({ name: fail, task: card() }, { sessionId: sid })), `${fail}: spawn rejected`);
  tr.a.emit({ type: "spawn", name: fail, by: "main", parent: "main", childSessionId: fail, ts: clock.t });
  tr.a.emit({ type: "error", name: fail, reason: "500 upstream", ts: clock.t });
  await settle(); await settle();
  tr.clock.t = clock.t;
  assert.ok(!("reject" in await tr.a.spawn({ name: again, task: card({ attemptOf: fail }) }, { sessionId: sid })), `${again}: spawn rejected`);
  tr.a.emit({ type: "spawn", name: again, by: "main", parent: "main", childSessionId: again, ts: clock.t });
  // guards
  expFire("message_end", { message: { role: "assistant" } }, sid);
  expFire("input", { text: "No, that's wrong, revert it", source: "interactive" }, sid);
  const ctx = cacheCtx(sid);
  cache.fire("session_start", { reason: "startup" }, ctx);
  cache.call("context", { messages: coldMessages() }, ctx);
  tick(1);
  cache.fire("tool_call", { toolName: "context_peek", toolCallId: "p1", input: { id: "x" } }, ctx);
  for (let i = 0; i < 4; i++) turn(sid, undefined, undefined, usd);
  exp.commands.get("rate").handler("4", expCtx(sid));
  tick(45); // next session after the 30-min idle cut
}

await mainSession("contract-main-1", "contract-child-1", 0.4);
await mainSession("contract-main-2", "contract-child-2", 0.25);

// --- every log exists, every line carries the current schema version
const jsonl = (file: string): any[] => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const dirLines = (dir: string): any[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => jsonl(join(dir, f))) : []);
const logs: Record<string, any[]> = {
  meter: dirLines(join(agentDir, "meter")),
  outcomes: dirLines(join(agentDir, "task-router", "outcomes")),
  assignments: dirLines(join(agentDir, "experiments")),
  guards: dirLines(join(agentDir, "guards")),
};
const failures: string[] = [];
for (const [name, lines] of Object.entries(logs)) {
  if (lines.length === 0) failures.push(`${name}: the writer produced no lines`);
  const old = lines.filter((l) => l.v !== 1);
  if (old.length) failures.push(`${name}: ${old.length} line(s) without schema version v=1, e.g. ${JSON.stringify(old[0]).slice(0, 200)}`);
}
for (const e of ["spawn", "check", "verdict", "reroute", "escalate"]) if (!logs.outcomes.some((l) => l.event === e)) failures.push(`outcomes: no ${e} event`);
for (const e of ["correction", "rating", "peek-after-mask"]) if (!logs.guards.some((l) => l.event === e)) failures.push(`guards: no ${e} event`);

// --- pi-analyse --check over the produced lines, then the full analysis
const run = (args: string[]): { code: number; out: string } => {
  try {
    return { code: 0, out: execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", BIN, "--agent-dir", agentDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};
const chk = run(["--check"]);
if (chk.code !== 0) failures.push(`pi-analyse --check exit ${chk.code}:\n${chk.out}`);
const reports = join(work, "reports");
const full = run(["--out", reports]);
if (full.code !== 0) failures.push(`pi-analyse exit ${full.code}:\n${full.out}`);
// <YYYY-MM-DD>-<HHMM>-analysis.{md,json} (UTC time of the run): runs of one day must not overwrite each other
const REPORT = /^\d{4}-\d{2}-\d{2}-\d{4}-analysis\.(md|json)$/;
const md = existsSync(reports) ? readdirSync(reports).find((f) => REPORT.test(f) && f.endsWith(".md")) : undefined;
if (!md) failures.push("pi-analyse wrote no <YYYY-MM-DD>-<HHMM>-analysis.md");
else {
  const text = readFileSync(join(reports, md), "utf8");
  const json = readdirSync(reports).some((f) => REPORT.test(f) && f.endsWith(".json"));
  if (!json) failures.push("pi-analyse wrote no <YYYY-MM-DD>-<HHMM>-analysis.json");
  for (const h of ["## Cost", "## Experiment", "## Delegation & routing", "## Guards", "## Data quality"]) {
    const at = text.indexOf(`\n${h}\n`);
    if (at < 0) { failures.push(`report: section "${h}" missing`); continue; }
    const body = text.slice(at + h.length + 2).split(/\n## /)[0];
    if (!body.trim() || body.includes("_no data in the period_")) failures.push(`report: section "${h}" has no data:\n${body.slice(0, 300)}`);
  }
}

if (failures.length) {
  console.error(`pi-log-contract: FAILED\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`pi-log-contract: ok (${Object.entries(logs).map(([k, v]) => `${k} ${v.length}`).join(", ")}); ${chk.out.trim()}`);
