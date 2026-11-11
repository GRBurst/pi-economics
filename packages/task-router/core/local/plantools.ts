// Local mode L7.T17 (design §3.5.2, §3.5.4; plan D48, D49): the `plan_request` and `amend_plan` tools of the main session. The
// logic is `planRequest`/`amendPlan` (planflow.ts); this is the tools' shape: the schemas, the input check, and the result as
// text plus `details`. `submit_plan` is the plan author's child tool (planflow.ts `planSubmit`), never registered here.
import { type RouterTool, errorReply } from "./branchtool.ts";
import { amendPlan, type AmendInput, type AmendResult, type PlanInput, type PlanPorts, planRequest, type PlanResult } from "./planflow.ts";
import { check, type Schema } from "./schema.ts";

/** Design §3.5.2, verbatim. */
export const PLAN_REQUEST_SCHEMA = {
  type: "object", additionalProperties: false, required: ["slug", "request", "acceptance", "files"],
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
    request: { type: "string", maxLength: 2000, description: "digest of the user's request" },
    acceptance: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", maxLength: 200 } },
    files: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
    symbols: { type: "array", maxItems: 40, items: { type: "string", maxLength: 80 } },
  },
} as const satisfies Schema;
/** Design §3.5.4, verbatim. */
export const AMEND_PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["slug", "trigger", "changes", "reason"],
  properties: {
    slug: { type: "string" },
    trigger: { type: "object", required: ["id"], properties: {
      id: { type: "string", description: "an open trigger id, or \"new\"" },
      kind: { enum: ["interface-break"] },
      evidenceCommand: { type: "string", maxLength: 300 } } },
    changes: { type: "array", minItems: 1, maxItems: 8, items: {
      type: "object", required: ["op"], properties: {
        op: { enum: ["add", "replace", "remove"] },
        id: { type: "string" }, after: { type: "string" },
        task: { type: "object", description: "a task object exactly as in submit_plan's tasks items" } } } },
    reason: { type: "string", maxLength: 500 },
  },
} as const satisfies Schema;

/** The result as the model reads it: `status: <s> (<reason>)`, the detail, then one line per finding. */
export const planText = (r: Pick<AmendResult, "status" | "reason" | "detail" | "findings"> | PlanResult): string =>
  [`status: ${r.status}${r.reason ? ` (${r.reason})` : ""}`, r.detail, ...(("findings" in r && r.findings) || [])].join("\n");

type Flow<I, R extends { status: string }> = (p: PlanPorts, input: I, cwd: string) => Promise<R>;
/** One tool: invalid input is refused before anything runs; `isError` only for that and `status: "error"` (D48). */
function planTool<I, R extends PlanResult | AmendResult>(name: string, label: string, description: string, schema: Schema, flow: Flow<I, R>,
  ports: (signal: AbortSignal | undefined) => PlanPorts, ready: () => Promise<void>): RouterTool {
  return {
    name, label, description, parameters: schema,
    async execute(_id, params, signal, _update, ctx) {
      const bad = check(schema, params);
      if (bad.length) return errorReply(`invalid input: ${bad.join("; ")}`);
      await ready(); // the session_start work (branches, plans, facts) comes first
      const sig = signal instanceof AbortSignal ? signal : undefined;
      const r = await flow(ports(sig), params as I, typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd());
      return { content: [{ type: "text", text: planText(r) }], details: r, ...(r.status === "error" && { isError: true }) };
    },
  };
}

export const planRequestTool = (ports: (signal: AbortSignal | undefined) => PlanPorts, ready: () => Promise<void> = async () => undefined): RouterTool =>
  planTool<PlanInput, PlanResult>("plan_request", "Plan request",
    "Plan a request that needs more than one branch: name the files and symbols it touches; the router checks they exist, an "
    + "author writes the plan's tasks with their checks, and the plan file is committed on the main branch. Then start its "
    + "first task with start_branch {plan: {slug, id}}.", PLAN_REQUEST_SCHEMA, planRequest, ports, ready);

export const amendPlanTool = (ports: (signal: AbortSignal | undefined) => PlanPorts, ready: () => Promise<void> = async () => undefined): RouterTool =>
  planTool<AmendInput, AmendResult>("amend_plan", "Amend plan",
    "Change an approved plan while a replan trigger is open (the router names it; an interface-break you open with trigger id "
    + "\"new\" and a failing evidenceCommand): add, replace or remove tasks; a reviewer approves or rejects the amendment.",
    AMEND_PLAN_SCHEMA, amendPlan, ports, ready);
