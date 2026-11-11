// Git for local mode (design §3.3; plan S21): an argv runner and the port the worktree, merge and plan code talk to. Every
// method is total: a failing command is a value (`undefined`, `false`, `{ok: false}`), never an exception.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
};

const SHORT_MS = 5000;
export function createGit(run: GitRun): Git {
  const line = async (args: string[], cwd: string): Promise<string | undefined> => {
    const r = await run(args, cwd, SHORT_MS);
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
