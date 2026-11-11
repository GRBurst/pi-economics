// The router's branches (design §3.0.2, §3.3; plan S22, D37–D39): one record per (repository, branch), kept in memory and
// appended to the session as `task-router/branch` entries at every change, rebuilt at `session_start`.
export const BRANCH_TYPE = "task-router/branch";
export const BRANCH_STATES = ["active", "merged", "abandoned", "fixer", "blocked"] as const;
export type BranchState = (typeof BRANCH_STATES)[number];
/** `plan`: set for a plan-bound branch (L7); `rejections`: merge reviews that asked for changes; `fixerRuns`/`fixer`: the fixer
 *  rounds spent and the running fixer's name (L6); `goal`/`check`: the merge review's goal and the branch check (D37);
 *  `handmade`: a branch the router did not make (D40) that a merge review rejected: its counts only, never active, never cleaned
 *  up (review F8). */
export type BranchRecord = {
  repo: string; branch: string; worktree: string; base: string; plan?: { slug: string; id: string }; state: BranchState;
  rejections: number; fixerRuns: number; fixer?: string; goal?: string; check?: string; handmade?: true;
};
/** Facts the synchronous guards read (D39): refreshed by `start_branch`, `request_merge` and at `session_start`, per repository:
 *  the main checkout's directory (the worktree that has a main branch checked out) and every registered worktree. */
export type BranchFacts = { mainCheckout: Map<string, string>; worktrees: Map<string, string[]> };
export type BranchStore = {
  /** Every record, in the order its (repository, branch) was first put. */
  all(): BranchRecord[];
  get(repo: string, branch: string): BranchRecord | undefined;
  /** Memory, then one `task-router/branch` entry; the record becomes the newest (start_branch: the active one, D38). */
  put(r: BranchRecord): void;
  /** As `put`, but an existing record keeps its place in the order (review F8: a rejection, a fixer's start, its report or death
   *  do not change which branch is active); its entry carries `keep: true`, so a rebuild agrees. */
  update(r: BranchRecord): void;
  /** D38: the newest-put record whose state is `active`; never a hand-made one (review F8). */
  active(): BranchRecord | undefined;
  /** The newest-put record whose state is one of `states` (request_merge without a branch: the active one, else one a fixer owns
   *  or one that is blocked, so its answer names the state). */
  latest(states: readonly BranchState[]): BranchRecord | undefined;
  /** Replaces everything with what the session entries (in order) say; entries that are not well-formed are ignored. */
  rebuild(entries: readonly unknown[]): void;
  facts: BranchFacts;
};

const isStr = (x: unknown): x is string => typeof x === "string";
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
/** A record as stored, or undefined when a field is missing or of the wrong type. */
export function readRecord(x: unknown): BranchRecord | undefined {
  const r = x as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || !isStr(r.repo) || !isStr(r.branch) || !isStr(r.worktree) || !isStr(r.base)) return undefined;
  if (!BRANCH_STATES.includes(r.state as BranchState) || !isCount(r.rejections) || !isCount(r.fixerRuns)) return undefined;
  const p = r.plan as { slug?: unknown; id?: unknown } | undefined;
  if (r.plan !== undefined && !(p && isStr(p.slug) && isStr(p.id))) return undefined;
  for (const k of ["fixer", "goal", "check"]) if (r[k] !== undefined && !isStr(r[k])) return undefined;
  if (r.handmade !== undefined && r.handmade !== true) return undefined;
  const { keep: _order, ...rec } = structuredClone(r);
  return rec as BranchRecord;
}

const keyOf = (repo: string, branch: string): string => `${repo}\0${branch}`;
export function createBranchStore(append: (customType: string, data: unknown) => void): BranchStore {
  const records = new Map<string, { r: BranchRecord; seq: number }>();
  let seq = 0;
  const latest = (states: readonly BranchState[]): BranchRecord | undefined => {
    let best: { r: BranchRecord; seq: number } | undefined;
    for (const x of records.values()) if (states.includes(x.r.state) && !x.r.handmade && (!best || x.seq > best.seq)) best = x;
    return best && structuredClone(best.r);
  };
  const set = (r: BranchRecord, keep = false): void => {
    const k = keyOf(r.repo, r.branch), old = records.get(k);
    records.set(k, { r: structuredClone(r), seq: keep && old ? old.seq : ++seq });
  };
  return {
    all: () => [...records.values()].map((x) => structuredClone(x.r)),
    get: (repo, branch) => { const x = records.get(keyOf(repo, branch)); return x && structuredClone(x.r); },
    put(r) { set(r); append(BRANCH_TYPE, structuredClone(r)); },
    update(r) { set(r, true); append(BRANCH_TYPE, { ...structuredClone(r), keep: true }); },
    active: () => latest(["active"]),
    latest,
    rebuild(entries) {
      records.clear();
      seq = 0;
      for (const e of entries) {
        const x = e as { customType?: unknown; data?: unknown } | null;
        if (!x || x.customType !== BRANCH_TYPE) continue;
        const r = readRecord(x.data);
        if (r) set(r, (x.data as { keep?: unknown }).keep === true);
      }
    },
    facts: { mainCheckout: new Map(), worktrees: new Map() },
  };
}
