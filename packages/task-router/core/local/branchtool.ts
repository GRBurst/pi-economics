// The `start_branch` tool (design §3.3.2; plan D48): the main session's way to a worktree. The logic is `startBranch`; this is
// the tool's shape: the schema, and the result as text plus `details`.
import type { RouterSettings } from "../types.ts";
import type { BranchStore } from "./branches.ts";
import type { Git } from "./git.ts";
import { startBranch } from "./worktree.ts";

export type ToolReply = { content: { type: "text"; text: string }[]; details: unknown; isError?: boolean };
export type RouterTool = {
  name: string; label: string; description: string; parameters: unknown;
  execute(id: string, params: any, signal: unknown, onUpdate: unknown, ctx: any): Promise<ToolReply>;
};
/** Design §3.3.2, verbatim. */
export const START_BRANCH_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
    plan: { type: "object", required: ["slug", "id"], properties: { slug: { type: "string" }, id: { type: "string" } } },
    goal: { type: "string", maxLength: 300 },
    check: { type: "string", maxLength: 300 },
    repo: { type: "string", description: "absolute path; default: the session cwd's repository" },
  },
};

/** The error shape of D48: the reason as text, `{status: "error", reason}` as details, `isError`. */
export const errorReply = (reason: string): ToolReply => ({ content: [{ type: "text", text: reason }], details: { status: "error", reason }, isError: true });

export function startBranchTool(d: { git: Git; store: BranchStore; settings: RouterSettings }): RouterTool {
  return {
    name: "start_branch",
    label: "Start branch",
    description: "Start a branch for a code change: makes a git worktree on a new branch from the main branch and returns its directory; "
      + "it becomes the active worktree. Give a slug, a goal and the check command that proves the change. The same slug again re-activates the branch.",
    parameters: START_BRANCH_SCHEMA,
    async execute(_id, params, _signal, _update, ctx) {
      const res = await startBranch(d, params, typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd());
      if (!res.ok) return errorReply(res.errors.join("; "));
      return { content: [{ type: "text", text: JSON.stringify(res.value) }], details: res.value };
    },
  };
}
