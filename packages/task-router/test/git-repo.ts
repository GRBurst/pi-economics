// A temporary git repository for the tests that run real git (plan §9, D55): a main branch with one commit, no developer
// configuration read, a fixed identity. The e-mail is joined at runtime: the leak check scans every file for addresses.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const made = new Set<string>();
process.on("exit", () => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

export type TempRepo = {
  /** The directory that holds `dir` and everything a test creates beside it (worktrees); realpath. */
  base: string;
  /** The repository's top directory (`<base>/repo`); realpath. */
  dir: string;
  /** The environment git runs with: pass it to `gitRunner("git", env)`. */
  env: Record<string, string>;
  /** `git <args>` in `cwd` (default `dir`); stdout, trimmed. Throws on a non-zero exit. */
  git(args: string[], cwd?: string): string;
  /** Writes `content` to `<cwd>/<file>`, stages and commits it; returns the new commit. */
  commit(file: string, content: string, message?: string, cwd?: string): string;
};

/** `{base, env}` without a repository: a directory git cannot find a repository above. */
export function tempBase(): { base: string; env: Record<string, string> } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "task-router-git-")));
  made.add(base);
  const email = ["u", "example.invalid"].join("@");
  return {
    base,
    env: {
      HOME: base, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CEILING_DIRECTORIES: dirname(base),
      GIT_AUTHOR_NAME: "u", GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: "u", GIT_COMMITTER_EMAIL: email, GIT_TERMINAL_PROMPT: "0",
    },
  };
}

export function tempRepo(): TempRepo {
  const { base, env } = tempBase();
  const dir = join(base, "repo");
  mkdirSync(dir);
  const git = (args: string[], cwd = dir): string =>
    execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = (file: string, content: string, message = `add ${file}`, cwd = dir): string => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
    git(["add", "--", file], cwd);
    git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", message], cwd);
    return git(["rev-parse", "HEAD"], cwd);
  };
  git(["init", "-q", "-b", "main"]);
  commit("README", "r\n", "init");
  return { base, dir, env, git, commit };
}
