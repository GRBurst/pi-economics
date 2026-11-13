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
import { SCHEMA_VERSION as METER_VERSION } from "../../packages/token-meter/core/line.ts";
import { REASONS as CONTRACT_REASONS, ROLES as CONTRACT_ROLES, TRIGGERS as CONTRACT_TRIGGERS, TRIPS as CONTRACT_TRIPS } from "../../packages/token-meter/core/contract.ts";
import { BRANCH_TYPE } from "../../packages/task-router/core/local/branches.ts";
import { REASONS } from "../../packages/task-router/core/local/merge.ts";
import { TRIGGERS } from "../../packages/task-router/core/local/plan.ts";
import { PLAN_TYPE } from "../../packages/task-router/core/local/plans.ts";
import { ROLES } from "../../packages/task-router/core/local/overseer.ts";
import { TRIPS } from "../../packages/task-router/core/local/tripwires.ts";
import { fakeCtx as meterCtx, fakePi as meterPi } from "../../packages/token-meter/test/fake-pi.ts";
import { harness, card } from "../../packages/task-router/test/harness.ts";
import { fakeGit } from "../../packages/task-router/test/fake-git.ts";
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
tr.f.fire("session_start", {}, {}); // task_verdict is registered at the first session_start with the actor's API (plan T3.1)
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
  const ctx = meterCtx(sid, { ...(parent ? { file: `/sessions/subagents/${parent}/${sid}.jsonl` } : {}), model: { provider: "anthropic", id: model } });
  meter.fire("before_agent_start", { type: "before_agent_start", prompt: "go", systemPrompt: "s" }, ctx); // a levers line at the session's first start (M3b)
  meter.fire("context", { type: "context", messages: [] }, ctx); // the agent loop's hook before the session's own send
  meter.fire("context_with_system", { type: "context_with_system", messages: [{ role: "system", content: "s", timestamp: 0 }] }, ctx); // systemHash (M3b)
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
  // pi's own compaction (no infinite-context here): its summary request shows only as session_compact (M3b)
  meter.fire("session_compact", { type: "session_compact", fromExtension: false, reason: "threshold", compactionEntry: { type: "compaction", summary: "s", firstKeptEntryId: "e", tokensBefore: 22_510,
    usage: { input: 20_000, output: 300, cacheRead: 0, cacheWrite: 0, totalTokens: 20_300, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 } } } },
    meterCtx(sid, { model: { provider: "anthropic", id: "claude-opus-5-5" } }));
  tick();
  // task-router: a forced spawn (`/force` for the next one: set, used, expired), the child's session id, its check and the verdict
  tr.clock.t = clock.t;
  const registry = { find: (p: string, id: string) => ({ provider: p, id }), getAvailable: () => [] };
  await tr.f.commands.get("force")!.handler("sonnet high next:1", { modelRegistry: registry, ui: { notify: () => {} } });
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
  // task-router in local mode (design §3.1, §3.2): the main session repeats one call five times → a hint in the third result,
  // a steer overseer at the fifth (the API extension): its ticket spawn line, and a review line once the fake child submits.
  const local = harness({ agentDir, settings: { mode: "local" }, apiExt: true });
  local.clock.t = clock.t;
  local.hooks.onSleep = () => {
    const p = local.a.apiSpawns.at(-1)?.policy as { childTools?: { execute(x: unknown): Promise<unknown> }[] } | undefined;
    void p?.childTools?.[0]?.execute({ verdict: "REVISE", summary: "s", findings: [
      { id: "F1", category: "approach", target: "a.ts", defect: "d", evidence: "e", fix: "f", blocking: true }] });
  };
  const lctx = { sessionManager: { getSessionId: () => sid }, cwd: work, getContextUsage: () => ({ tokens: 1000, percent: 10 }) };
  local.f.fire("session_start", {}, lctx);
  for (let i = 0; i < 5; i++) {
    local.f.fire("tool_call", { toolName: "read", toolCallId: `r${i}`, input: { path: "a.ts" } }, lctx);
    local.f.fire("tool_result", { toolName: "read", toolCallId: `r${i}`, input: { path: "a.ts" }, content: [{ type: "text", text: "a" }], isError: false }, lctx);
  }
  for (let i = 0; i < 20; i++) await settle();
  assert.equal(local.f.sent.length, 1, "the steer message");
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

// --- task-router's merge gate (design §3.4, plan D57: this check has no git, so the fake one): a first `bash` result records
// main, one merged and one refused request_merge (merge lines), main moved by hand, then a `bash` result (a gatebypass line).
{
  const fg = fakeGit({ repos: [{ root: "/r" }] });
  const gate = harness({ agentDir, settings: { mode: "local" }, apiExt: true,
    extra: { git: fg.git, run: async () => ({ exit: 0, output: "ok\n", timedOut: false }) } as never });
  gate.clock.t = clock.t;
  gate.hooks.onSleep = () => {
    const p = gate.a.apiSpawns.at(-1)?.policy as { childTools?: { execute(x: unknown): Promise<unknown> }[] } | undefined;
    void p?.childTools?.[0]?.execute({ verdict: "APPROVE", summary: "s", findings: [] });
  };
  const gctx = { sessionManager: { getSessionId: () => "contract-gate", getBranch: () => [] }, cwd: "/r", hasUI: true,
    ui: { notify: () => {}, setStatus: () => {} } };
  gate.f.fire("session_start", {}, gctx);
  const bash = async (id: string): Promise<void> => {
    gate.f.fire("tool_call", { toolName: "bash", toolCallId: id, input: { command: "true" } }, gctx);
    gate.f.fire("tool_result", { toolName: "bash", toolCallId: id, input: { command: "true" }, content: [], isError: false }, gctx);
    await gate.router.settled();
  };
  await bash("g1");
  const started = await gate.f.callTool("start_branch", { slug: "contract", goal: "g", check: "true" }, gctx);
  assert.ok(!started.isError, `start_branch: ${JSON.stringify(started.details)}`);
  fg.commit(started.details.worktree);
  fg.diffs.set("/r", "diff --git a/f b/f\n+f"); // the review reads a diff (an empty one with changes fails closed: review F9)
  const merged = await gate.f.callTool("request_merge", { summary: "s" }, gctx);
  assert.equal(merged.details.status, "merged", JSON.stringify(merged.details));
  const refused = await gate.f.callTool("request_merge", { branch: "main" }, gctx);
  assert.equal(refused.details.status, "refused", JSON.stringify(refused.details));
  fg.repos.get("/r")!.refs.set("main", "b".repeat(40));
  await bash("g2");
  clock.t = Math.max(clock.t, gate.clock.t);
}

// --- task-router's plans (design §3.5.5): a session holding an approved plan and its task's branch; a write outside the task's
// files is blocked and opens a non-whitelisted trigger (a plan line).
{
  const fg = fakeGit({ repos: [{ root: "/q" }] });
  const wt = "/q.worktrees/lm--p--M1.T1";
  await fg.git.worktreeAdd("/q", wt, "lm/p/M1.T1", "main");
  const plan = { slug: "p", repo: "/q", file: "docs/plans/p.md", skeletonHash: "a".repeat(64), approvedBy: "rv-1", triggers: [] };
  const branch = { repo: "/q", branch: "lm/p/M1.T1", worktree: wt, base: "b".repeat(40), plan: { slug: "p", id: "M1.T1" }, state: "active",
    rejections: 0, fixerRuns: 0, goal: "g", check: "true", files: ["src/a.ts"] };
  const planned = harness({ agentDir, settings: { mode: "local" }, extra: { git: fg.git } as never });
  planned.clock.t = clock.t;
  const pctx = { sessionManager: { getSessionId: () => "contract-plan", getBranch: () => [
    { type: "custom", customType: PLAN_TYPE, data: plan }, { type: "custom", customType: BRANCH_TYPE, data: branch }] }, cwd: "/q" };
  planned.f.fire("session_start", {}, pctx);
  await planned.router.settled();
  const blocked = await Promise.all(planned.f.fire("tool_call", { toolName: "write", toolCallId: "w1", input: { path: `${wt}/src/c.ts`, content: "x" } }, pctx));
  assert.ok(blocked.some((b) => (b as { block?: boolean } | undefined)?.block), "the whitelist guard blocks");
}

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
// The meter writes line v2 (M3a, design §5.2); the other logs are at v1.
const CURRENT: Record<string, number> = { meter: METER_VERSION, outcomes: 1, assignments: 1, guards: 1 };
for (const [name, lines] of Object.entries(logs)) {
  if (lines.length === 0) failures.push(`${name}: the writer produced no lines`);
  const old = lines.filter((l) => l.v !== CURRENT[name]);
  if (old.length) failures.push(`${name}: ${old.length} line(s) without schema version v=${CURRENT[name]}, e.g. ${JSON.stringify(old[0]).slice(0, 200)}`);
}
for (const e of ["spawn", "check", "verdict", "reroute", "escalate", "force", "hint", "review", "merge", "gatebypass", "plan"]) if (!logs.outcomes.some((l) => l.event === e)) failures.push(`outcomes: no ${e} event`);
if (!logs.outcomes.some((l) => l.event === "spawn" && l.ticket === "steer")) failures.push("outcomes: no ticket spawn line");
// The contract keeps literal copies of the router's enums (token-meter imports nothing of the router): the overseer roles, the trips
// and the merge reasons.
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
if (!same(CONTRACT_ROLES, ROLES)) failures.push(`contract ROLES ${JSON.stringify(CONTRACT_ROLES)} differ from the router's ${JSON.stringify(ROLES)}`);
if (!same(CONTRACT_TRIPS, TRIPS)) failures.push(`contract TRIPS ${JSON.stringify(CONTRACT_TRIPS)} differ from the router's ${JSON.stringify(TRIPS)}`);
if (!same(CONTRACT_REASONS, REASONS)) failures.push(`contract REASONS ${JSON.stringify(CONTRACT_REASONS)} differ from the router's ${JSON.stringify(REASONS)}`);
if (!same(CONTRACT_TRIGGERS, TRIGGERS)) failures.push(`contract TRIGGERS ${JSON.stringify(CONTRACT_TRIGGERS)} differ from the router's ${JSON.stringify(TRIGGERS)}`);
// M3b: levers lines (before_agent_start), a compaction line (session_compact), systemHash on turn lines (context_with_system)
for (const k of ["turn", "levers", "compaction"]) if (!logs.meter.some((l) => l.kind === k)) failures.push(`meter: no kind ${k} line`);
if (!logs.meter.some((l) => typeof l.systemHash === "string")) failures.push("meter: no turn line with a systemHash");
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
  for (const h of ["## Budget", "## Fleet", "## Cache", "## Levers", "## Experiments", "## Router", "## Guards", "## Data quality"]) {
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
