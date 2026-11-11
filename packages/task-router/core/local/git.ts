// Git for local mode (design §3.3; plan S21): an argv runner and the port the worktree, merge and plan code talk to. Every
// method is total: a failing command is a value (`undefined`, `false`, `{ok: false}`), never an exception.
import { spawn } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type GitOut = { exit: number; out: string; err: string; timedOut: boolean };
export type GitRun = (args: string[], cwd: string, timeoutMs: number, opts?: { stdin?: string; env?: Record<string, string> }) => Promise<GitOut>;

const OUT_MAX = 4_000_000, ERR_MAX = 8192;
/** `spawn(file, args)` in `cwd`, in its own process group; the group is killed on timeout (exit 124); a spawn error (no such
 *  binary or directory) is exit 127 with the error text in `err` (as `runCheck`). Stdin is closed unless `opts.stdin` is given,
 *  so a command that would wait for input sees its end. `env` is laid over the process environment; no prompt ever waits. */
export const gitRunner = (file = "git", env: Record<string, string> = {}): GitRun => (args, cwd, timeoutMs, opts = {}) =>
  new Promise((done) => {
    const p = spawn(file, args, {
      cwd, detached: true, stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", ...env, ...opts.env },
    });
    let out = "", err = "", timedOut = false, settled = false;
    const finish = (r: GitOut): void => { if (!settled) { settled = true; clearTimeout(timer); done(r); } };
    p.stdout!.on("data", (b: Buffer) => { if (out.length < OUT_MAX) out += b; });
    p.stderr!.on("data", (b: Buffer) => { err = (err + b).slice(-ERR_MAX); });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-p.pid!, "SIGKILL"); } catch { p.kill("SIGKILL"); } }, timeoutMs);
    p.on("error", (e) => finish({ exit: 127, out, err: String(e), timedOut: false }));
    p.on("close", (code) => finish({ exit: timedOut ? 124 : (code ?? 1), out, err, timedOut }));
    if (opts.stdin !== undefined) { p.stdin!.on("error", () => undefined); p.stdin!.end(opts.stdin); }
  });

export type Git = {
  /** The repository's root (D35), the same for every worktree of it; undefined outside a repository. */
  root(dir: string): Promise<string | undefined>;
  /** The top directory of the checkout that holds `dir` (a worktree has its own); undefined outside one. */
  top(dir: string): Promise<string | undefined>;
  branchOf(dir: string): Promise<string | undefined | "unknown">;
  worktrees(repo: string): Promise<Wt[]>;
  sha(repo: string, ref: string): Promise<string | undefined>;
  worktreeAdd(repo: string, dir: string, branch: string, base: string): Promise<Res>;
  /** `git worktree remove`; `force`: also a tree with changes or untracked files (the red run's temporary worktree). */
  worktreeRemove(repo: string, dir: string, force?: boolean): Promise<Res>;
  /** `git branch -d` (refuses a branch with unmerged commits); `force`: `-D`. */
  branchDelete(repo: string, branch: string, force?: boolean): Promise<Res>;
  dirty(dir: string): Promise<boolean>;
  /** The changes of the worktree `dir` against `base`: staged, unstaged and committed ones (`git diff --numstat base`) plus the
   *  untracked files, whose lines are counted through the file system (D42). Failing or timing out (5 s) gives []. */
  diffStat(dir: string, base: string): Promise<Stat>;
  /** `git diff a [b]` in `dir` as text, cut to `maxLines` lines (the last says how many more); `b` undefined = the working tree,
   *  whose untracked files follow as one `untracked file <path> (<n> lines)` line each. Failing or timing out (5 s) gives "". */
  diff(dir: string, a: string, b: string | undefined, maxLines: number): Promise<string>;
  // ── merging (L6, design §3.4.2; plan S21) ──
  /** `a` is `b` or an ancestor of it; false when git cannot tell (an unknown ref). */
  isAncestor(repo: string, a: string, b: string): Promise<boolean>;
  /** `git diff --numstat a...b`: the changes of `b` since its merge base with `a`; undefined when git fails (fail closed). */
  numstat(repo: string, a: string, b: string): Promise<Stat | undefined>;
  /** A commit's tree; undefined for an unknown commit. */
  tree(repo: string, commit: string): Promise<string | undefined>;
  /** `git worktree add --detach dir commit` (the red run's temporary worktree). */
  worktreeAddDetached(repo: string, dir: string, commit: string): Promise<Res>;
  /** `git merge --ff-only commit` in `dir` (the checkout that has the main branch); never a merge commit (LD7). */
  ffMerge(dir: string, commit: string): Promise<Res>;
  /** `git update-ref ref next prev`: moves `ref` only from `prev`. */
  updateRef(repo: string, ref: string, next: string, prev: string): Promise<Res>;
  /** `git push remote branch`. */
  push(repo: string, remote: string, branch: string): Promise<Res>;
  // ── plans (L7, design §3.5.2; plan S21, D50) ──
  /** The ones among `files` (relative to `repo`) whose working copy holds `word` as a whole word (`git grep -w -F`). */
  grepWord(repo: string, word: string, files: string[]): Promise<string[]>;
  /** The first `n` tracked paths (`git ls-files`); [] when git fails. */
  lsFiles(repo: string, n: number): Promise<string[]>;
  /** D50: a commit on `parent` whose tree is `parent`'s with `path` set to `content`, built in a temporary index (plumbing),
   *  so the main checkout's index and files are never touched; no ref moves. `out` = the new commit. */
  commitFile(repo: string, parent: string, path: string, content: string, message: string): Promise<Res>;
  /** The content of the file `path` at `rev` (a commit or branch; `git cat-file blob`); undefined for an unknown rev or path. */
  show(repo: string, rev: string, path: string): Promise<string | undefined>;
};
/** A command that either gave its stdout or failed with the tail of its stderr (2048 characters). */
export type Res = { ok: true; out: string } | { ok: false; err: string };

const SHORT_MS = 5000, BRANCH_MS = 2000, ADD_MS = 60_000, ERR_TAIL = 2048, STAT_MS = 5000;
/** The lines of an untracked file (D42): 0 for a binary file (a NUL byte), one that is no regular file (a symlink) or one over
 *  4 MB; a last line without a newline counts. It still counts as a file. */
const MAX_UNTRACKED = 4 * 1024 * 1024;
function untrackedLines(file: string): number {
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_UNTRACKED) return 0;
    const b = readFileSync(file);
    if (b.includes(0)) return 0;
    let n = 0;
    for (const c of b) if (c === 10) n++;
    return b.length > 0 && b[b.length - 1] !== 10 ? n + 1 : n;
  } catch { return 0; }
}
/** stdout on exit 0, else the tail of stderr (a timeout and a silent failure get a sentence). */
const res = (r: GitOut): Res =>
  r.exit === 0 ? { ok: true, out: r.out.trim() } : { ok: false, err: r.timedOut ? "git timed out" : r.err.trim().slice(-ERR_TAIL) || `git exited ${r.exit}` };
export function createGit(run: GitRun): Git {
  const line = async (args: string[], cwd: string, ms = SHORT_MS): Promise<string | undefined> => {
    const r = await run(args, cwd, ms);
    const t = r.out.trim();
    return r.exit === 0 && t !== "" ? t : undefined;
  };
  const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
  return {
    async root(dir) {
      const c = await line(["rev-parse", "--git-common-dir"], dir);
      if (c === undefined) return undefined;
      return repoRootOf(real(resolve(dir, c)));
    },
    async top(dir) {
      const t = await line(["rev-parse", "--show-toplevel"], dir);
      return t === undefined ? undefined : real(t);
    },
    async branchOf(dir) {
      const r = await run(["symbolic-ref", "--short", "-q", "HEAD"], dir, BRANCH_MS);
      if (r.exit === 0 && r.out.trim() !== "") return r.out.trim();
      return r.exit === 1 && !r.timedOut ? undefined : "unknown"; // exit 1: HEAD is detached; anything else: cannot tell
    },
    async worktrees(repo) {
      const r = await run(["worktree", "list", "--porcelain"], repo, SHORT_MS);
      return r.exit === 0 ? parseWorktrees(r.out) : [];
    },
    sha: (repo, ref) => line(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repo),
    async worktreeAdd(repo, dir, branch, base) { return res(await run(["worktree", "add", "-q", "-b", branch, dir, base], repo, ADD_MS)); },
    async worktreeRemove(repo, dir, force = false) { return res(await run(["worktree", "remove", ...(force ? ["--force"] : []), dir], repo, ADD_MS)); },
    async branchDelete(repo, branch, force = false) { return res(await run(["branch", force ? "-D" : "-d", branch], repo, SHORT_MS)); },
    async diffStat(dir, base) {
      try {
        const diff = await run(["-c", "core.quotepath=off", "diff", "--numstat", "--no-renames", base, "--"], dir, STAT_MS);
        const others = await run(["ls-files", "--others", "--exclude-standard", "-z"], dir, STAT_MS);
        if (diff.exit !== 0 || others.exit !== 0) return [];
        return [...parseNumstat(diff.out), ...others.out.split("\0").filter((p) => p !== "").map((p) => ({ path: p, added: untrackedLines(join(dir, p)), deleted: 0 }))];
      } catch { return []; }
    },
    async diff(dir, a, b, maxLines) {
      try {
        const d = await run(["-c", "core.quotepath=off", "diff", "--no-color", "--no-ext-diff", "--no-renames", ...(b === undefined ? [a] : [a, b]), "--"], dir, STAT_MS);
        if (d.exit !== 0) return "";
        const lines = d.out.split("\n");
        if (lines.at(-1) === "") lines.pop();
        if (b === undefined) {
          const others = await run(["ls-files", "--others", "--exclude-standard", "-z"], dir, STAT_MS);
          if (others.exit === 0) for (const p of others.out.split("\0").filter((x) => x !== "")) lines.push(`untracked file ${p} (${untrackedLines(join(dir, p))} lines)`);
        }
        return (lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `… ${lines.length - (maxLines - 1)} more lines`] : lines).join("\n");
      } catch { return ""; }
    },
    async isAncestor(repo, a, b) { const r = await run(["merge-base", "--is-ancestor", a, b], repo, SHORT_MS); return r.exit === 0; },
    async numstat(repo, a, b) {
      const r = await run(["-c", "core.quotepath=off", "diff", "--numstat", "--no-renames", `${a}...${b}`, "--"], repo, STAT_MS);
      return r.exit === 0 ? parseNumstat(r.out) : undefined;
    },
    tree: (repo, commit) => line(["rev-parse", "--verify", "--quiet", `${commit}^{tree}`], repo),
    async worktreeAddDetached(repo, dir, commit) { return res(await run(["worktree", "add", "-q", "--detach", dir, commit], repo, ADD_MS)); },
    async ffMerge(dir, commit) { return res(await run(["merge", "--ff-only", "-q", commit], dir, ADD_MS)); },
    async updateRef(repo, ref, next, prev) { return res(await run(["update-ref", ref, next, prev], repo, SHORT_MS)); },
    async push(repo, remote, branch) { return res(await run(["push", "-q", remote, branch], repo, ADD_MS)); },
    async grepWord(repo, word, files) {
      if (!files.length) return [];
      const r = await run(["-c", "core.quotepath=off", "grep", "-l", "-w", "-F", "-e", word, "--", ...files], repo, STAT_MS);
      return r.exit === 0 ? r.out.split("\n").filter((p) => p !== "") : [];
    },
    async lsFiles(repo, n) {
      const r = await run(["ls-files", "-z"], repo, STAT_MS);
      return r.exit === 0 ? r.out.split("\0").filter((p) => p !== "").slice(0, n) : [];
    },
    async show(repo, rev, path) {
      const r = await run(["cat-file", "blob", `${rev}:${path}`], repo, STAT_MS);
      return r.exit === 0 ? r.out : undefined;
    },
    async commitFile(repo, parent, path, content, message) {
      let tmp: string | undefined;
      try {
        tmp = mkdtempSync(join(tmpdir(), "task-router-index-"));
        const env = { GIT_INDEX_FILE: join(tmp, "index") };
        const read = res(await run(["read-tree", parent], repo, SHORT_MS, { env }));
        if (!read.ok) return read;
        const blob = res(await run(["hash-object", "-w", "--stdin"], repo, SHORT_MS, { stdin: content }));
        if (!blob.ok) return blob;
        const add = res(await run(["update-index", "--add", "--cacheinfo", `100644,${blob.out},${path}`], repo, SHORT_MS, { env }));
        if (!add.ok) return add;
        const tree = res(await run(["write-tree"], repo, SHORT_MS, { env }));
        if (!tree.ok) return tree;
        return res(await run(["commit-tree", tree.out, "-p", parent, "-m", message], repo, SHORT_MS));
      } catch (e) {
        return { ok: false, err: String(e) };
      } finally {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
      }
    },
    async dirty(dir) {
      const r = await run(["status", "--porcelain"], dir, ADD_MS);
      return r.exit !== 0 || r.out.trim() !== ""; // a status that fails counts as dirty: nothing is removed or merged on it
    },
  };
}

export type Wt = { dir: string; branch?: string; head: string; bare?: true; locked?: true; prunable?: true };
export type Stat = { path: string; added: number; deleted: number }[];
/** The repository key (plan D35): the directory that holds the git directory, else (a bare repository) the common directory. */
export const repoRootOf = (commonDir: string): string => (commonDir.endsWith("/.git") ? dirname(commonDir) : commonDir);
/** `git worktree list --porcelain`: blocks separated by a blank line; a bare repository has no HEAD (`head: ""`), a detached
 *  one no branch; `locked` and `prunable` carry an optional reason that is dropped. Paths with a newline are not supported. */
export function parseWorktrees(porcelain: string): Wt[] {
  const out: Wt[] = [];
  for (const block of porcelain.split("\n\n")) {
    const lines = block.split("\n").filter((l) => l !== "");
    const first = lines[0];
    if (first === undefined || !first.startsWith("worktree ")) continue;
    const wt: Wt = { dir: first.slice("worktree ".length), head: "" };
    for (const l of lines.slice(1)) {
      if (l.startsWith("HEAD ")) wt.head = l.slice(5);
      else if (l.startsWith("branch ")) wt.branch = l.slice(7).replace(/^refs\/heads\//, "");
      else if (l === "bare") wt.bare = true;
      else if (l === "locked" || l.startsWith("locked ")) wt.locked = true;
      else if (l === "prunable" || l.startsWith("prunable ")) wt.prunable = true;
    }
    out.push(wt);
  }
  return out;
}
/** `git diff --numstat` lines (`<added>\t<deleted>\t<path>`); a binary file (`-\t-`) counts as a file with 0/0; a rename
 *  (`a => b`, `dir/{a => b}/f`) names the new path. Lines of another shape are dropped. */
export function parseNumstat(text: string): Stat {
  const out: Stat = [];
  for (const l of text.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
    if (!m) continue;
    out.push({ path: renamedTo(m[3]!), added: m[1] === "-" ? 0 : Number(m[1]), deleted: m[2] === "-" ? 0 : Number(m[2]) });
  }
  return out;
}
const renamedTo = (p: string): string => {
  const b = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(p);
  if (b) {
    const joined = `${b[1]}${b[3]}${b[4]}`.replace(/\/{2,}/g, "/");
    return b[1] === "" && b[3] === "" ? joined.replace(/^\//, "") : joined;
  }
  const i = p.indexOf(" => ");
  return i < 0 ? p : p.slice(i + 4);
};
