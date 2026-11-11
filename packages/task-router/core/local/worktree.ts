// Worktrees and branches (design §3.3; plan S22, S23): names, directories and containment (pure); `startBranch` and the write
// guard follow in later tasks.
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const SLUG = /^[a-z0-9-]{1,40}$/;
/** `<prefix><slug>`, or `<prefix><plan>/<id>` for a unit of a plan (design §3.3.1). */
export const branchName = (prefix: string, u: { slug: string } | { plan: string; id: string }): string =>
  "slug" in u ? prefix + u.slug : `${prefix}${u.plan}/${u.id}`;
/** The worktree of `branch` (design §3.3.1, plan D36): `root` with `{repo}` replaced by the repository's directory name, a
 *  relative root resolved against the repository root, then the branch name with `/` → `--`. Two branches share a directory
 *  only when a name part holds `--` (`lm/p--m` and `lm/p/m`); git refuses the second `worktree add`. */
export const worktreeDir = (root: string, repo: string, branch: string): string =>
  join(resolve(repo, root.replaceAll("{repo}", basename(repo))), branch.replaceAll("/", "--"));
/** `p` is `dir` or below it (compared as paths, not as strings: `/r/xy` is not inside `/r/x`). */
export const inside = (p: string, dir: string): boolean => {
  const r = relative(dir, p);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
