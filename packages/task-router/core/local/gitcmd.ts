// The git command classifier (design §3.4.5, LD8; plan S24, D43): pure. A shell command string is split into simple commands
// (`segments`), the git calls among them are found with their directories (`gitCalls`), and `classify` decides from the
// directories' current branches, which the caller resolves (`gitDirs` → `branchOf`). The shell grammar is approximated for
// what can move a ref: quotes, escapes, operators, groups, redirections, heredocs, comments, substitutions and `-c` strings.
// What it cannot read (a computed word, nesting deeper than 2) is unknown or throws; `safeClassify` turns a throw into a block
// for a command with a `git` token and an allow for every other (LD8).
import { basename, isAbsolute, relative, resolve } from "node:path";

/** Stands for the computed part of a word (a variable, a substitution, `~`): `a$X` is `a` + DYN. The classifier cannot read it. */
export const DYN = "\u0000";
const dyn = (w: string): boolean => w.includes(DYN);
/** One simple command: its words and the directory it runs in (undefined: unknown, e.g. after `cd $X`). */
export type Seg = { argv: string[]; dir: string | undefined };

// ── lexer ──
type Word = { t: "w"; v: string; subs: string[] };
type Op = { t: "op"; v: string };
/** A redirection's target: no word of the command, but its substitutions run. */
type Redir = { t: "r"; subs: string[] };
type Tok = Word | Op | Redir;

const SPACE = new Set([" ", "\t"]);
const META = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")", "<", ">"]);
const NAME = /[A-Za-z0-9_]/;
const SPECIAL = new Set(["?", "#", "@", "*", "!", "$", "-"]);

class Lex {
  i = 0;
  toks: Tok[] = [];
  private heredocs: { delim: string; tabs: boolean }[] = [];
  readonly s: string;
  constructor(s: string) { this.s = s; }
  private fail(why: string): never { throw new Error(`cannot parse the command: ${why}`); }
  /** Tokens up to the end, or (`close`) up to an unmatched `)`, whose index is `this.i` afterwards. */
  run(close = false): Tok[] {
    const s = this.s;
    let parens = 0;
    while (this.i < s.length) {
      const c = s[this.i]!;
      if (SPACE.has(c)) { this.i++; continue; }
      if (c === "\\" && s[this.i + 1] === "\n") { this.i += 2; continue; }
      if (c === "\n") { this.i++; this.op("\n"); this.bodies(); continue; }
      if (c === "#") { while (this.i < s.length && s[this.i] !== "\n") this.i++; continue; }
      if (c === ")") {
        if (close && parens === 0) return this.toks;
        parens--;
        this.i++;
        this.op(")");
        continue;
      }
      if (c === "(") { parens++; this.i++; this.op("("); continue; }
      const two = s.slice(this.i, this.i + 2);
      if (two === "&>") { this.i += s[this.i + 2] === ">" ? 3 : 2; this.redirect(); continue; }
      if (two === "&&" || two === "||" || two === "|&" || two === ";;") { this.i += 2; this.op(two === "|&" ? "|" : two === ";;" ? ";" : two); continue; }
      if (c === ";" || c === "&" || c === "|") { this.i++; this.op(c); continue; }
      if ((c === "<" || c === ">") && s[this.i + 1] !== "(") { this.redirOp(); continue; }
      this.word();
    }
    if (close) this.fail("an unclosed $(");
    return this.toks;
  }
  private op(v: string): void { this.toks.push({ t: "op", v }); }
  /** At `<` or `>` (fd digits were taken as a word and are dropped by `word`). */
  private redirOp(): void {
    const s = this.s, ops = ["<<<", "<<-", "<<", ">>", ">|", ">&", "<&", "<>", "<", ">"];
    const op = ops.find((o) => s.startsWith(o, this.i))!;
    this.i += op.length;
    if (op === "<<" || op === "<<-") {
      while (SPACE.has(s[this.i] ?? "")) this.i++;
      const w = this.readWord();
      this.heredocs.push({ delim: w.raw.replace(/['"\\]/g, ""), tabs: op === "<<-" });
      return;
    }
    this.redirect();
  }
  /** The target word of a redirection. */
  private redirect(): void {
    while (SPACE.has(this.s[this.i] ?? "")) this.i++;
    if (this.i >= this.s.length || META.has(this.s[this.i]!)) this.fail("a redirection without a target");
    this.toks.push({ t: "r", subs: this.readWord().subs });
  }
  /** After a newline: the pending heredocs' bodies, line by line up to each delimiter. */
  private bodies(): void {
    for (const h of this.heredocs.splice(0)) {
      for (;;) {
        if (this.i >= this.s.length) return;
        const end = this.s.indexOf("\n", this.i), line = this.s.slice(this.i, end < 0 ? undefined : end);
        this.i = end < 0 ? this.s.length : end + 1;
        if ((h.tabs ? line.replace(/^\t+/, "") : line) === h.delim) break;
      }
    }
  }
  private word(): void {
    const w = this.readWord();
    // `2>&1`: digits right before a redirection are its file descriptor, no word
    if (/^\d+$/.test(w.raw) && (this.s[this.i] === "<" || this.s[this.i] === ">") && this.s[this.i + 1] !== "(") return;
    this.toks.push({ t: "w", v: w.v, subs: w.subs });
  }
  /** One word: its value (DYN for computed parts), its raw text and the command texts of its substitutions. */
  private readWord(): { v: string; raw: string; subs: string[] } {
    const s = this.s, from = this.i, subs: string[] = [];
    let v = "";
    if (s[this.i] === "~") { v += DYN; this.i++; while (this.i < s.length && !META.has(s[this.i]!) && s[this.i] !== "/") this.i++; }
    while (this.i < s.length) {
      const c = s[this.i]!;
      if (META.has(c)) {
        if ((c === "<" || c === ">") && s[this.i + 1] === "(" && this.i === from) { this.i += 2; subs.push(this.paren()); v += DYN; continue; }
        break;
      }
      if (c === "\\") { if (s[this.i + 1] !== "\n") v += s[this.i + 1] ?? ""; this.i += 2; continue; }
      if (c === "'") {
        const end = s.indexOf("'", this.i + 1);
        if (end < 0) this.fail("an unclosed '");
        v += s.slice(this.i + 1, end);
        this.i = end + 1;
        continue;
      }
      if (c === '"') { this.i++; v += this.dquote(subs); continue; }
      if (c === "`") { subs.push(this.backtick()); v += DYN; continue; }
      if (c === "$") { const d = this.dollar(subs); if (d !== undefined) { v += d; continue; } }
      v += c;
      this.i++;
    }
    return { v, raw: s.slice(from, this.i), subs };
  }
  /** Inside "…" from after the opening quote; returns the value. */
  private dquote(subs: string[]): string {
    const s = this.s;
    let v = "";
    while (this.i < s.length) {
      const c = s[this.i]!;
      if (c === '"') { this.i++; return v; }
      if (c === "\\") {
        const n = s[this.i + 1];
        if (n === "\n") { this.i += 2; continue; }
        if (n === "$" || n === "`" || n === '"' || n === "\\") { v += n; this.i += 2; continue; }
        v += c;
        this.i++;
        continue;
      }
      if (c === "`") { subs.push(this.backtick()); v += DYN; continue; }
      if (c === "$") { const d = this.dollar(subs, true); if (d !== undefined) { v += d; continue; } }
      v += c;
      this.i++;
    }
    this.fail('an unclosed "');
  }
  /** At `$`: an expansion's value (DYN) with `this.i` past it, or undefined for a literal `$`. */
  private dollar(subs: string[], quoted = false): string | undefined {
    const s = this.s, n = s[this.i + 1] ?? "";
    if (s.startsWith("$((", this.i)) { this.i += 3; this.arith(); return DYN; }
    if (n === "(") { this.i += 2; subs.push(this.paren()); return DYN; }
    if (n === "{") {
      const end = s.indexOf("}", this.i + 2);
      if (end < 0) this.fail("an unclosed ${");
      this.i = end + 1;
      return DYN;
    }
    if (!quoted && (n === "'" || n === '"')) {
      if (n === '"') { this.i += 2; this.dquote(subs); return DYN; }
      let j = this.i + 2;
      while (j < s.length && s[j] !== "'") j += s[j] === "\\" ? 2 : 1;
      if (j >= s.length) this.fail("an unclosed $'");
      this.i = j + 1;
      return DYN;
    }
    if (NAME.test(n)) { this.i += 1; while (this.i < s.length && NAME.test(s[this.i]!)) this.i++; return DYN; }
    if (SPECIAL.has(n)) { this.i += 2; return DYN; }
    return undefined;
  }
  /** From after `$(` (or `<(`): the inner command's text, `this.i` past the closing `)`. */
  private paren(): string {
    const inner = new Lex(this.s);
    inner.i = this.i;
    inner.run(true);
    const text = this.s.slice(this.i, inner.i);
    this.i = inner.i + 1;
    return text;
  }
  /** From after `$((`: skips to the matching `))`. */
  private arith(): void {
    let depth = 0;
    while (this.i < this.s.length) {
      const c = this.s[this.i]!;
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) {
          if (this.s[this.i + 1] !== ")") this.fail("an unclosed $((");
          this.i += 2;
          return;
        }
        depth--;
      }
      this.i++;
    }
    this.fail("an unclosed $((");
  }
  /** At a backtick: the inner command's text (escapes \` \\ \$ undone), `this.i` past the closing one. */
  private backtick(): string {
    const s = this.s;
    let j = this.i + 1, text = "";
    while (j < s.length && s[j] !== "`") {
      if (s[j] === "\\" && (s[j + 1] === "`" || s[j + 1] === "\\" || s[j + 1] === "$")) { text += s[j + 1]; j += 2; continue; }
      text += s[j];
      j++;
    }
    if (j >= s.length) this.fail("an unclosed `");
    this.i = j + 1;
    return text;
  }
}

// ── simple commands ──
/** Reserved words that may start a command; they are dropped. */
const KEYWORDS = new Set(["{", "}", "!", "if", "then", "else", "elif", "fi", "do", "done", "while", "until"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Wrappers that run their argument command (design §3.4.5, and a few more that do the same), with the options that take a
 *  value; `dir`: the options that change the directory; `skip`: positional words before the command (timeout's duration). */
const WRAPPERS: Record<string, { arg?: string[]; dir?: string[]; skip?: number }> = {
  env: { arg: ["-u", "--unset", "-C", "--chdir"], dir: ["-C", "--chdir"] },
  command: {}, nohup: {}, exec: { arg: ["-a"] },
  nice: { arg: ["-n", "--adjustment"] },
  time: { arg: ["-f", "--format", "-o", "--output"] },
  sudo: { arg: ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "-T", "--user", "--group", "--chdir", "--host", "--prompt"], dir: ["-D", "--chdir"] },
  xargs: { arg: ["-n", "-I", "-i", "-d", "-L", "-l", "-P", "-a", "-E", "-e", "-s", "--max-args", "--delimiter", "--max-lines", "--max-procs", "--arg-file"] },
  timeout: { arg: ["-s", "-k", "--signal", "--kill-after"], skip: 1 },
  stdbuf: { arg: ["-i", "-o", "-e"] },
  ionice: { arg: ["-c", "-n", "-p", "-P", "-u"] },
};
const at = (dir: string | undefined, t: string): string | undefined =>
  dyn(t) ? undefined : isAbsolute(t) ? resolve(t) : dir === undefined ? undefined : resolve(dir, t);

/** The command a simple command runs: assignments and wrappers stripped (git's environment variables and `env -C`, `sudo -D`
 *  change the directory), xargs' input as one computed word. An empty `argv`: nothing runs (`command -v`). */
export function unwrap(argv0: readonly string[], dir0: string | undefined): { argv: string[]; dir: string | undefined } {
  let argv = [...argv0], dir = dir0;
  for (;;) {
    while (argv.length && ASSIGN.test(argv[0]!)) {
      if (/^GIT_(DIR|WORK_TREE)=/.test(argv[0]!)) dir = undefined;
      argv.shift();
    }
    const w = WRAPPERS[basename(argv[0] ?? "")];
    if (!w || dyn(argv[0]!)) return { argv, dir };
    const name = basename(argv[0]!);
    let i = 1;
    while (i < argv.length && argv[i]!.startsWith("-") && argv[i] !== "-") {
      const o = argv[i]!;
      if (o === "--") { i++; break; }
      if (name === "command" && (o === "-v" || o === "-V")) return { argv: [], dir };
      if (name === "env" && (o === "-S" || o.startsWith("--split-string"))) throw new Error("cannot parse the command: env -S");
      const eq = o.indexOf("="), key = o.startsWith("--") && eq > 0 ? o.slice(0, eq) : o;
      if (w.dir?.includes(key)) dir = at(dir, eq > 0 && o.startsWith("--") ? o.slice(eq + 1) : argv[i + 1] ?? DYN);
      i += w.arg?.includes(o) ? 2 : 1;
    }
    i += w.skip ?? 0;
    argv = argv.slice(i);
    if (name === "xargs") argv.push(DYN);
  }
}

/** Splits `cmd` into simple commands with their directories (design §3.4.5): on unquoted `;`, `&&`, `||`, `|`, `&` and newlines;
 *  into `$(…)`, backticks, `<(…)` and the string of `bash|sh|zsh -c` or `eval`, up to depth 2 (deeper throws). A literal `cd`
 *  moves the rest of its list; one in a pipeline or a `( )` group, or before `&`, does not. Throws on what it cannot parse. */
export function segments(cmd: string, cwd: string | undefined, depth = 0): Seg[] {
  const toks = new Lex(cmd).run();
  const out: Seg[] = [];
  const nest = (text: string, dir: string | undefined): Seg[] => {
    if (depth + 1 > 2) throw new Error("cannot parse the command: nested deeper than 2");
    return segments(text, dir, depth + 1);
  };
  let dir = cwd, listStart = cwd, prevPipe = false;
  const stack: { dir: string | undefined; listStart: string | undefined }[] = [];
  let words: Word[] = [], subs: string[] = [];
  const finish = (next: string | undefined): void => {
    for (const t of subs) out.push(...nest(t, dir));
    let argv = words.map((w) => w.v);
    while (argv.length && KEYWORDS.has(argv[0]!)) argv = argv.slice(1);
    const inPipe = prevPipe || next === "|";
    words = [];
    subs = [];
    if (!argv.length) return;
    out.push({ argv, dir });
    const u = unwrap(argv, dir), name = basename(u.argv[0] ?? "");
    if (SHELLS.has(name)) {
      const c = shellString(u.argv);
      if (c !== undefined) {
        if (dyn(c)) throw new Error("cannot parse the command: a computed -c string");
        out.push(...nest(c, u.dir));
      }
    } else if (name === "eval") {
      const text = u.argv.slice(1).join(" ");
      if (dyn(text)) throw new Error("cannot parse the command: a computed eval");
      out.push(...nest(text, u.dir));
    } else if ((name === "cd" || name === "pushd" || name === "popd") && !inPipe) dir = cdTarget(name, u.argv, u.dir);
  };
  for (const t of toks) {
    if (t.t === "w") { words.push(t); subs.push(...t.subs); continue; }
    if (t.t === "r") { subs.push(...t.subs); continue; }
    if (t.v === "(") { finish(undefined); stack.push({ dir, listStart }); listStart = dir; prevPipe = false; continue; }
    if (t.v === ")") {
      finish(undefined);
      const top = stack.pop();
      if (!top) throw new Error("cannot parse the command: an unmatched )");
      ({ dir, listStart } = top);
      prevPipe = false;
      continue;
    }
    finish(t.v);
    if (t.v === "&") dir = listStart; // a background list runs in a subshell
    if (t.v === "&" || t.v === ";" || t.v === "\n") listStart = dir;
    prevPipe = t.v === "|";
  }
  finish(undefined);
  if (stack.length) throw new Error("cannot parse the command: an unclosed (");
  return out;
}
/** `bash -lc 'x'`: the string a shell's `-c` runs, or undefined (a script, stdin). */
function shellString(argv: readonly string[]): string | undefined {
  let c = false;
  for (let i = 1; i < argv.length; i++) {
    const w = argv[i]!;
    if (w === "--") return c ? argv[i + 1] : undefined;
    if (w === "-o" || w === "+o" || w === "-O" || w === "+O" || w === "--rcfile" || w === "--init-file") { i++; continue; }
    if (w.startsWith("--")) continue;
    if (w.startsWith("-") || w.startsWith("+")) { if (w.startsWith("-") && w.includes("c")) c = true; continue; }
    return c ? w : undefined;
  }
  return undefined;
}
/** The directory after `cd`/`pushd`/`popd`; `cd` alone (home), `cd -`, `popd` and a computed target are unknown. */
function cdTarget(name: string, argv: readonly string[], dir: string | undefined): string | undefined {
  if (name === "popd") return undefined;
  const args = argv.slice(1).filter((a, i, xs) => !(/^-[LPe@]+$/.test(a) && xs.slice(0, i).every((b) => /^-[LPe@]+$/.test(b))));
  const t = args[0] === "--" ? args[1] : args[0];
  if (t === undefined || t === "-" || /^[+-]\d+$/.test(t)) return undefined;
  return at(dir, t);
}

// ── git calls ──
export type GitCall = { dir: string | undefined; sub: string; args: string[] };
/** Git's global options that take a value as the next word. */
const GIT_ARG = new Set(["-c", "--namespace", "--super-prefix", "--config-env", "--list-cmds", "--exec-path"]);
/** The git calls of `cmd` (design §3.4.5): wrappers and assignments stripped; `-C <dir>` (relative to the call's directory,
 *  repeatable) and `-c k=v` read; `--git-dir`/`--work-tree` (and GIT_DIR, GIT_WORK_TREE) make the directory unknown. */
export function gitCalls(cmd: string, cwd: string): GitCall[] {
  const out: GitCall[] = [];
  for (const s of segments(cmd, cwd)) {
    const u = unwrap(s.argv, s.dir), a = u.argv;
    if (!a.length || dyn(a[0]!) || basename(a[0]!) !== "git") continue;
    let dir = u.dir, i = 1;
    while (i < a.length) {
      const w = a[i]!;
      if (w === "-C") { dir = a[i + 1] === undefined ? undefined : at(dir, a[i + 1]!); i += 2; continue; }
      if (w === "--git-dir" || w === "--work-tree") { dir = undefined; i += 2; continue; }
      if (w.startsWith("--git-dir=") || w.startsWith("--work-tree=")) { dir = undefined; i++; continue; }
      if (GIT_ARG.has(w)) { i += 2; continue; }
      if (w.startsWith("-")) { i++; continue; }
      break;
    }
    if (i >= a.length) continue; // `git --version`: no subcommand
    out.push({ dir, sub: a[i]!, args: a.slice(i + 1) });
  }
  return out;
}
/** The directories whose current branch `classify` needs (D43), once each. */
export const gitDirs = (cmd: string, cwd: string): string[] => [...new Set(gitCalls(cmd, cwd).flatMap((c) => (c.dir ? [c.dir] : [])))];

// ── classification (design §3.4.5) ──
export const MERGE_REASON = (main: string): string => `merging into ${main} goes through request_merge`;
export const UNKNOWN_DIR = "cannot tell the branch; run git with a literal -C <worktree>";
export const UNCLASSIFIED = "router could not classify this git command; split it";
type Branch = string | undefined | "unknown";
/** The subcommands that write the current branch (design §3.4.5). */
const ON_CURRENT = new Set(["merge", "pull", "rebase", "cherry-pick", "revert", "am", "commit", "reset"]);
/** Per subcommand, the options whose value is the next word (so it is no positional). */
const VALUED: Record<string, string[]> = {
  push: ["-o", "--push-option", "--repo", "--receive-pack", "--exec"],
  fetch: ["--depth", "--deepen", "--shallow-since", "--shallow-exclude", "-j", "--jobs", "--upload-pack", "-o", "--server-option", "--negotiation-tip", "--refmap"],
  rebase: ["--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec", "-C"],
  branch: ["-u", "--set-upstream-to", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--sort", "--format"],
  checkout: ["-b", "-B", "--orphan", "--conflict", "--pathspec-from-file"],
  switch: ["-c", "-C", "--create", "--force-create", "--orphan", "--conflict"],
  "update-ref": ["-m"],
};
/** The subcommands whose words after `--` are paths (review F1); for every other the words after `--` are still refs and refspecs. */
const PATHS_AFTER_DASHES = new Set(["checkout", "restore", "reset"]);
/** The words that are no option and no option's value; for a path subcommand everything after `--` (`rest`) separately, for any
 *  other the words after `--` are positionals too (`git push origin -- HEAD:main` pushes to main; review F1). */
function positionals(sub: string, args: readonly string[]): { pos: string[]; rest: string[] | undefined } {
  const valued = VALUED[sub] ?? [], pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    if (w === "--") return PATHS_AFTER_DASHES.has(sub) ? { pos, rest: args.slice(i + 1) } : { pos: [...pos, ...args.slice(i + 1)], rest: undefined };
    if (w.startsWith("-") && w !== "-") { if (valued.includes(w)) i++; continue; }
    pos.push(w);
  }
  return { pos, rest: undefined };
}
/** A short-option cluster (`-fD`) or a long option names `flag`. */
const has = (args: readonly string[], short: string, long: string[] = []): boolean =>
  args.some((a) => long.includes(a.split("=")[0]!) || (short !== "" && /^-[A-Za-z]+$/.test(a) && a.includes(short)));
/** The value of the first of `opts` (`-B x`, `--force-create=x`), or undefined. */
function valueOf(args: readonly string[], opts: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (opts.includes(a)) return args[i + 1] ?? "";
    const eq = a.indexOf("=");
    if (eq > 0 && opts.includes(a.slice(0, eq))) return a.slice(eq + 1);
  }
  return undefined;
}
const short = (ref: string): string => ref.replace(/^refs\/heads\//, "");
/** A push or fetch destination as git resolves it (review F1): `+` dropped, `refs/heads/x` and `heads/x` name the branch x. */
const dstBranch = (ref: string): string => ref.replace(/^\+/, "").replace(/^(refs\/)?heads\//, "");
/** A push or fetch destination writes a main branch: a main by name, or a pattern (`*`) under the branches. A destination still
 *  under `refs/` after `dstBranch` (`refs/remotes/…`, `refs/tags/…`) is no branch. */
const hitsMain = (dst: string, mains: readonly string[]): boolean => {
  const b = dstBranch(dst);
  return !b.startsWith("refs/") && (b.includes("*") || mains.includes(b));
};

/** One git call's verdict given its directory's current branch `cur`. */
function rule(c: GitCall, cur: Branch, mains: readonly string[]): string | undefined {
  const isMain = (b: Branch): b is string => b !== undefined && b !== "unknown" && mains.includes(b);
  /** A ref the call names: a main blocks, a computed one cannot be read. */
  const named = (ref: string): string | undefined => (dyn(ref) ? UNCLASSIFIED : mains.includes(short(ref)) ? MERGE_REASON(short(ref)) : undefined);
  /** The call writes the current branch. */
  const current = (): string | undefined => (cur === "unknown" ? UNKNOWN_DIR : isMain(cur) ? MERGE_REASON(cur) : undefined);
  const first = (...xs: (string | undefined)[]): string | undefined => xs.find((x) => x !== undefined);
  const { sub, args } = c;
  if (dyn(sub)) return UNCLASSIFIED;
  const { pos } = positionals(sub, args);
  const mainOf = (dst: string): string => { const b = dstBranch(dst); return mains.includes(b) ? b : mains[0] ?? "main"; };
  /** A fetch refspec `src:dst` writes dst: into a main ref (any spelling, or a pattern over the branches) it is a merge; a
   *  computed refspec may name one. */
  const fetched = (): string | undefined => pos.slice(1).some(dyn) ? UNCLASSIFIED : first(...pos.filter((r) => !dyn(r) && r.includes(":"))
    .map((r) => { const d = r.slice(r.lastIndexOf(":") + 1); return hitsMain(d, mains) ? MERGE_REASON(mainOf(d)) : undefined; }));
  switch (sub) {
    case "filter-branch": return MERGE_REASON(mains[0] ?? "main");
    case "fetch": return fetched();
    case "pull": return first(fetched(), current());
    case "rebase": return first(pos[1] !== undefined ? named(pos[1]) : undefined, current());
    case "push": {
      if (has(args, "", ["--all", "--mirror", "--branches"])) return MERGE_REASON(mains[0] ?? "main");
      const specs = pos.slice(1);
      if (!specs.length) return has(args, "", ["--tags"]) ? undefined : current();
      for (const r of specs) {
        if (dyn(r)) return UNCLASSIFIED;
        const x = r.replace(/^\+/, ""), dst = x.includes(":") ? x.slice(x.lastIndexOf(":") + 1) : x;
        const why = dst.includes("*") ? MERGE_REASON(mains[0] ?? "main") : dst === "HEAD" || dst === "@" ? current()
          : hitsMain(dst, mains) ? MERGE_REASON(mainOf(dst)) : undefined;
        if (why !== undefined) return why;
      }
      return undefined;
    }
    case "branch": {
      if (!has(args, "f", ["--force"]) && !has(args, "M") && !has(args, "m", ["--move"]) && !has(args, "D") && !has(args, "d", ["--delete"])
        && !has(args, "c", ["--copy"]) && !has(args, "C")) return undefined;
      const renames = has(args, "m", ["--move"]) || has(args, "M") || has(args, "c", ["--copy"]) || has(args, "C");
      return first(...pos.map(named), renames && pos.length === 1 ? current() : undefined);
    }
    case "checkout": { const b = valueOf(args, ["-B"]); return b === undefined ? undefined : named(b); }
    case "switch": { const b = valueOf(args, ["-C", "--force-create"]); return b === undefined ? undefined : named(b); }
    case "update-ref": {
      if (args.includes("--stdin")) return UNCLASSIFIED;
      const ref = pos[0];
      if (ref === undefined) return undefined;
      return ref === "HEAD" && !args.includes("--no-deref") ? current() : named(ref);
    }
    default: return ON_CURRENT.has(sub) ? current() : undefined;
  }
}
/** The branch of a directory after a `checkout` or `switch` there: the new branch, a main, detached; a word that may be a branch
 *  or a path leaves a main checkout unknown (main may stay checked out). */
function after(c: GitCall, cur: Branch, mains: readonly string[]): Branch {
  const created = valueOf(c.args, c.sub === "switch" ? ["-c", "-C", "--create", "--force-create", "--orphan"] : ["-b", "-B", "--orphan"]);
  if (created !== undefined) return dyn(created) ? "unknown" : created;
  if (c.args.includes("--detach") || (c.sub === "switch" && c.args.includes("-d"))) return undefined;
  const { pos, rest } = positionals(c.sub, c.args);
  if (c.sub === "checkout" && rest !== undefined) return cur; // `checkout [x] -- paths`: files only
  const p = pos[0];
  if (p === undefined) return cur;
  if (dyn(p) || p === "-" || p.includes("@{")) return "unknown";
  if (mains.includes(p)) return p;
  if (c.sub === "switch") return p;
  return cur === "unknown" || (cur !== undefined && mains.includes(cur)) ? "unknown" : cur;
}

/** undefined = allow; a string = the block reason (design §3.4.5). `branches`: directory → its current branch (undefined:
 *  detached or none; "unknown": git could not tell in time); a directory not in it is unknown. A `checkout`/`switch` earlier in
 *  the command changes the branch for the later calls in its directory (and below it). */
export function classify(cmd: string, cwd: string, mains: readonly string[], branches: ReadonlyMap<string, Branch>): string | undefined {
  const moved: [string, Branch][] = [];
  const cur = (dir: string | undefined): Branch => {
    if (dir === undefined) return "unknown";
    const m = moved.filter(([d]) => inside(dir, d)).sort((a, b) => b[0].length - a[0].length)[0];
    return m ? m[1] : branches.has(dir) ? branches.get(dir) : "unknown";
  };
  for (const c of gitCalls(cmd, cwd)) {
    const b = cur(c.dir), why = rule(c, b, mains);
    if (why !== undefined) return why;
    if (c.dir !== undefined && (c.sub === "checkout" || c.sub === "switch")) moved.push([c.dir, after(c, b, mains)]);
  }
  return undefined;
}
const inside = (p: string, dir: string): boolean => { const r = relative(dir, p); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };
/** A `git` word in the command text (not `.git`, `gitk` or `git-lfs`). */
export const hasGitToken = (cmd: string): boolean => /(^|[^A-Za-z0-9_.-])git($|[^A-Za-z0-9_-])/.test(cmd);
/** LD8: an exception allows a command with no `git` token and blocks every other with `UNCLASSIFIED`. */
export function safeClassify(...a: Parameters<typeof classify>): string | undefined {
  try { return classify(...a); } catch { return hasGitToken(a[0]) ? UNCLASSIFIED : undefined; }
}
/** The git guard of one command (design §3.4.5, D43): the branch of every directory a git call runs in through `branchOf` (the
 *  port's 2 s timeout answers "unknown"; a port that fails is an unknown directory too), then `safeClassify`. Synchronous when
 *  no directory is needed (a command without git calls), so a plain command waits for nothing. Total. */
export function guardGit(cmd: string, cwd: string, mains: readonly string[], branchOf: (dir: string) => Promise<Branch>):
  string | undefined | Promise<string | undefined> {
  let dirs: string[];
  try { dirs = gitDirs(cmd, cwd); } catch { return hasGitToken(cmd) ? UNCLASSIFIED : undefined; }
  if (!dirs.length) return safeClassify(cmd, cwd, mains, new Map());
  const read = (dir: string): Promise<[string, Branch]> =>
    Promise.resolve().then(() => branchOf(dir)).then((b): [string, Branch] => [dir, b], (): [string, Branch] => [dir, "unknown"]);
  return Promise.all(dirs.map(read)).then((xs) => safeClassify(cmd, cwd, mains, new Map(xs)), () => UNCLASSIFIED);
}
