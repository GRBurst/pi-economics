// Local mode L6.T1–T2 (design §3.4.5, AC-M1, LD8; plan S24, D43): the git command classifier. T1: splitting a shell command
// into simple commands with their directories, and the git calls among them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DYN, MERGE_REASON, UNCLASSIFIED, UNKNOWN_DIR, classify, gitCalls, gitDirs, safeClassify, segments } from "../core/local/gitcmd.ts";

const W = "/w";
const argvs = (cmd: string, cwd = W) => segments(cmd, cwd).map((s) => s.argv);
const calls = (cmd: string, cwd = W) => gitCalls(cmd, cwd).map((c) => [c.dir, c.sub, ...c.args]);

test("segments: a simple command and its directory", () => {
  assert.deepEqual(segments("git status", W), [{ argv: ["git", "status"], dir: W }]);
  assert.deepEqual(segments("", W), []);
  assert.deepEqual(segments("  \n ", W), []);
});

test("segments: quotes keep operators literal; escapes and line continuations", () => {
  assert.deepEqual(argvs("echo 'a;b' \"a&&b\" a\\;b"), [["echo", "a;b", "a&&b", "a;b"]]);
  assert.deepEqual(argvs("echo 'it''s' \"x\\\"y\" \"\\$z\""), [["echo", "its", "x\"y", "$z"]]);
  assert.deepEqual(argvs("git push \\\n  origin main"), [["git", "push", "origin", "main"]]);
  assert.deepEqual(argvs("echo a\"b c\"d"), [["echo", "ab cd"]]);
});

test("segments: every operator splits (; && || | |& & newline), and ( ) group", () => {
  assert.deepEqual(argvs("a; b && c || d | e & f\ng |& h"), [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]]);
  assert.deepEqual(argvs("(a; b) && { c; }"), [["a"], ["b"], ["c"]]);
  assert.deepEqual(argvs("a;;b"), [["a"], ["b"]]);
});

test("segments: redirections and their targets are no words; `2>&1` is no background operator", () => {
  assert.deepEqual(argvs("git push 2>&1 | tee log"), [["git", "push"], ["tee", "log"]]);
  assert.deepEqual(argvs("git log > out.txt; git status &>/dev/null; cat <in >>out 2> err"), [["git", "log"], ["git", "status"], ["cat"]]);
  assert.deepEqual(argvs("git log >&2 && x"), [["git", "log"], ["x"]]);
});

test("segments: a comment ends at the line's end; # inside a word or quotes is no comment", () => {
  assert.deepEqual(argvs("git status # && git push origin main\ngit log"), [["git", "status"], ["git", "log"]]);
  assert.deepEqual(argvs("echo a#b '#c'"), [["echo", "a#b", "#c"]]);
});

test("segments: a heredoc's body is no command", () => {
  assert.deepEqual(argvs("cat > f <<'EOF'\ngit push origin main\nEOF\ngit status"), [["cat"], ["git", "status"]]);
  assert.deepEqual(argvs("cat <<-X && git log\n\tgit commit\n\tX\n"), [["cat"], ["git", "log"]]);
});

test("segments: $(…), backticks and <(…) run first; their word is computed (DYN)", () => {
  assert.deepEqual(argvs("echo $(git rev-parse HEAD)"), [["git", "rev-parse", "HEAD"], ["echo", DYN]]);
  assert.deepEqual(argvs("echo `git status`"), [["git", "status"], ["echo", DYN]]);
  assert.deepEqual(argvs("git commit -m \"$(cat msg)\""), [["cat", "msg"], ["git", "commit", "-m", DYN]]);
  assert.deepEqual(argvs("diff <(git show a:f) f"), [["git", "show", "a:f"], ["diff", DYN, "f"]]);
  assert.deepEqual(argvs("echo $(echo $(git log))"), [["git", "log"], ["echo", DYN], ["echo", DYN]]);
  assert.deepEqual(argvs("echo $((1 + 2)) $X ${Y} ~/a a$X-b $'x'"), [["echo", DYN, DYN, DYN, `${DYN}/a`, `a${DYN}-b`, DYN]]);
});

test("segments: bash|sh|zsh -c recurse to depth 2; depth 3 is unknown (throws)", () => {
  assert.deepEqual(segments("bash -c 'cd x && git status'", W), [
    { argv: ["bash", "-c", "cd x && git status"], dir: W }, { argv: ["cd", "x"], dir: W }, { argv: ["git", "status"], dir: "/w/x" }]);
  assert.deepEqual(argvs("sh -lc 'git log'").at(-1), ["git", "log"]);
  assert.deepEqual(argvs("zsh -o pipefail -c 'git log'").at(-1), ["git", "log"]);
  assert.deepEqual(argvs("bash -c \"bash -c 'git status'\"").at(-1), ["git", "status"]);
  assert.throws(() => segments("bash -c \"bash -c \\\"bash -c 'git status'\\\"\"", W), /deeper than 2/);
  assert.throws(() => segments("bash -c \"$CMD\"", W), /computed/);
  assert.deepEqual(argvs("eval 'git push origin main'").at(-1), ["git", "push", "origin", "main"]);
});

test("segments: a literal cd moves the rest of the chain; ( ), | and & keep it local", () => {
  const dirs = (cmd: string, cwd = W) => segments(cmd, cwd).filter((s) => s.argv[0] === "git").map((s) => s.dir);
  assert.deepEqual(dirs("cd /a && git status; git log"), ["/a", "/a"]);
  assert.deepEqual(dirs("cd a/b; git status"), ["/w/a/b"]);
  assert.deepEqual(dirs("cd .. && git status", "/w/x"), ["/w"]);
  assert.deepEqual(dirs("(cd /a && git status); git log"), ["/a", W]);
  assert.deepEqual(dirs("cd /a | cat; git status"), [W]);
  assert.deepEqual(dirs("cd /a & git status"), [W]);
  assert.deepEqual(dirs("cd /a && git status & git log"), ["/a", W]);
  assert.deepEqual(dirs("{ cd /a; git status; }; git log"), ["/a", "/a"]);
  assert.deepEqual(dirs("pushd /a && git status"), ["/a"]);
  assert.deepEqual(dirs("cd $X && git status"), [undefined]);
  assert.deepEqual(dirs("cd ~/x && git status; cd - && git log; cd && git show"), [undefined, undefined, undefined]);
  assert.deepEqual(dirs("cd -P /a && git status"), ["/a"]);
  assert.deepEqual(dirs("echo $(cd /a && git status); git log"), ["/a", W]);
});

test("segments: an unbalanced quote or substitution throws", () => {
  for (const cmd of ["echo 'a", "echo \"a", "echo $(a", "echo `a", "(a", "a)"]) assert.throws(() => segments(cmd, W), /cannot parse/, cmd);
});

test("gitCalls: wrappers, assignments and keywords are stripped; git's own -C and -c are read", () => {
  assert.deepEqual(calls("VAR=1 env nice git push"), [[W, "push"]]);
  assert.deepEqual(calls("cd /a && git -C b status"), [["/a/b", "status"]]);
  assert.deepEqual(calls("git -C ../b status", "/w/a"), [["/w/b", "status"]]);
  assert.deepEqual(calls("git -C /a -C b log"), [["/a/b", "log"]]);
  assert.deepEqual(calls("git -c user.name=u -C /a commit -m x"), [["/a", "commit", "-m", "x"]]);
  assert.deepEqual(calls("git --no-pager -p log --oneline"), [[W, "log", "--oneline"]]);
  assert.deepEqual(calls("git --git-dir=/x/.git status; git --work-tree /y log"), [[undefined, "status"], [undefined, "log"]]);
  assert.deepEqual(calls("git -C \"$WT\" commit"), [[undefined, "commit"]]);
  assert.deepEqual(calls("/usr/bin/git status; \\git log; \"git\" show"), [[W, "status"], [W, "log"], [W, "show"]]);
  assert.deepEqual(calls("timeout -k 5 30 git push; exec git commit; sudo -u u git pull; command git fetch; nohup git am p; time -p git log; nice -n 5 git log; stdbuf -oL git log"),
    [[W, "push"], [W, "commit"], [W, "pull"], [W, "fetch"], [W, "am", "p"], [W, "log"], [W, "log"], [W, "log"]]);
  assert.deepEqual(calls("env -i -u X -C /a FOO=x git status"), [["/a", "status"]]);
  assert.deepEqual(calls("GIT_DIR=/o/.git git commit; env GIT_WORK_TREE=/o git commit; X=$(pwd) git log"), [[undefined, "commit"], [undefined, "commit"], [W, "log"]]);
  assert.deepEqual(calls("if true; then git commit; fi; while x; do git log; done; ! git diff"), [[W, "commit"], [W, "log"], [W, "diff"]]);
  assert.deepEqual(calls("echo main | xargs -n 1 git push origin"), [[W, "push", "origin", DYN]]);
  assert.deepEqual(calls("command -v git; git --version; gitk; git-lfs push; ls .git"), []);
});

test("gitDirs: the known directories of the git calls, once each", () => {
  assert.deepEqual(gitDirs("git status && git -C /a log && cd /a && git diff; cd $X && git log", W), [W, "/a"]);
  assert.deepEqual(gitDirs("echo hi", W), []);
});

// ── T2: classification (AC-M1) ──
const MAIN_DIR = "/r/x", WT = "/r/x.worktrees/lm--x";
const BR = new Map<string, string | undefined | "unknown">([[MAIN_DIR, "main"], [WT, "lm/x"], ["/r/detached", undefined], ["/r/slow", "unknown"]]);
const MAINS = ["main", "master"];
const cls = (cmd: string, cwd = WT) => classify(cmd, cwd, MAINS, BR);

/** The main-branch writes of design §3.4.5, each as a git argument string run on main. */
const BLOCK_FORMS = ["push origin main", "push origin HEAD:main", "push origin +x:refs/heads/main", "push --all", "push --mirror",
  "push --delete origin main", "push", "merge x", "pull", "rebase x", "cherry-pick c", "revert c", "am p", "commit -m x",
  "reset --hard x", "branch -f main x", "branch -D main", "checkout -B main", "switch -C main", "update-ref refs/heads/main x",
  "filter-branch --tree-filter t HEAD"];
/** Each form × direct (cwd on main), -C, cd &&, bash -c, $(…). */
const contexts = (f: string, on: string, off: string): [string, string][] => [
  [`git ${f}`, on], [`git -C ${on} ${f}`, off], [`cd ${on} && git ${f}`, off], [`bash -c 'git ${f}'`, on], [`echo $(git ${f})`, on]];
/** Review F1: forms that name a main ref, so they move it from any branch: the words after `--` (git still reads them as refs
 *  and refspecs), and every spelling of a branch ref (`heads/main`, `refs/heads/main`, `+main`, `HEAD:main`, `:main`, …). */
const NAMED_FORMS = ["push origin -- HEAD:main", "push -- origin lm/x:main", "push origin --force -- HEAD:main", "push origin lm/x:heads/main",
  "push origin heads/main", "push origin refs/heads/main", "push origin +main", "push origin +HEAD:main", "push origin :main",
  "push origin :heads/main", "push origin x:refs/heads/main", "push origin main", "push origin -- main",
  "update-ref -- refs/heads/main HEAD", "update-ref refs/heads/main HEAD", "update-ref -d -- refs/heads/main",
  "branch -f -- main HEAD", "branch -D -- main", "branch -M -- lm/x main",
  "fetch -- . HEAD:main", "fetch . lm/x:heads/main", "fetch . lm/x:refs/heads/main", "fetch . +lm/x:main", "fetch origin +refs/heads/*:refs/heads/*",
  "pull -- . lm/x:main", "rebase -- lm/y main"];
const BLOCK = [...BLOCK_FORMS.flatMap((f) => contexts(f, MAIN_DIR, WT)), ...NAMED_FORMS.flatMap((f) => contexts(f, WT, MAIN_DIR))];
/** The same subcommands on the branch lm/x, read-only forms, and commands without git. */
const ALLOW_FORMS = ["push origin lm/x", "push origin HEAD:lm/x", "push origin +x:refs/heads/lm/x", "push", "push -u origin HEAD",
  "merge main", "pull", "pull --rebase origin main", "rebase main", "cherry-pick c", "revert c", "am p", "commit -m x",
  "reset --hard main", "branch -f lm/y x", "branch -D lm/y", "branch -d lm/x", "checkout -B lm/y", "switch -C lm/y",
  "update-ref refs/heads/lm/y x", "status", "log --oneline", "diff main...HEAD", "show HEAD", "fetch", "fetch origin", "stash",
  "add -A", "checkout lm/y", "switch lm/y", "worktree list", "branch", "tag v1", "rev-parse HEAD", "push --tags",
  "branch -dr origin/main", "checkout -- a.ts", "push origin -- lm/x", "push origin -- HEAD:lm/y", "branch -D -- lm/y", "log -- main",
  "checkout lm/y -- a.ts", "diff main -- a.ts", "fetch origin -- main:refs/remotes/origin/main", "push origin main:lm/y",
  "fetch origin +refs/heads/*:refs/remotes/origin/*"];
const ALLOW: [string, string][] = [
  ...ALLOW_FORMS.flatMap((f) => contexts(f, WT, MAIN_DIR)),
  ...["status", "log", "diff", "show HEAD", "fetch origin", "branch -a", "stash list", "push origin lm/x"].map((f): [string, string] => [`git ${f}`, MAIN_DIR]),
  ...["ls", "npm test", "echo git push origin main", "grep -r 'git push origin main' docs", "cat .git/HEAD", "gitk", "make && ./run"]
    .map((c): [string, string] => [c, MAIN_DIR]),
];

test("AC-M1 block corpus: every main-branch write is blocked, the reason names request_merge (X25)", () => {
  assert.ok(BLOCK.length >= 40, `${BLOCK.length} forms`);
  for (const [cmd, cwd] of BLOCK) assert.equal(cls(cmd, cwd), MERGE_REASON("main"), `${cmd} (cwd ${cwd})`);
  for (const [cmd, cwd] of BLOCK) assert.match(cls(cmd, cwd)!, /request_merge/);
});

test("AC-M1 allow corpus: the same subcommands on a branch, read-only git and other commands pass", () => {
  assert.ok(ALLOW.length >= 40, `${ALLOW.length} forms`);
  for (const [cmd, cwd] of ALLOW) assert.equal(cls(cmd, cwd), undefined, `${cmd} (cwd ${cwd})`);
});

test("classify: the main named is the one in the reason; master is a main too", () => {
  assert.equal(cls("git push origin master"), MERGE_REASON("master"));
  assert.equal(cls("git push origin lm/x:refs/heads/master"), MERGE_REASON("master"));
  assert.equal(classify("git commit -m x", "/m", MAINS, new Map([["/m", "master"]])), MERGE_REASON("master"));
  assert.equal(cls("git branch -m main old; git branch -M lm/x main"), MERGE_REASON("main"));
  assert.equal(cls("git branch -m old", MAIN_DIR), MERGE_REASON("main"), "-m with one name renames the current branch");
  assert.equal(cls("git rebase main main"), MERGE_REASON("main"), "rebase <upstream> <branch> checks out <branch>");
  assert.equal(cls("git push origin :main; git push origin 'refs/heads/*:refs/heads/*'"), MERGE_REASON("main"));
  assert.equal(cls("git update-ref -d refs/heads/main; git update-ref HEAD x", WT), MERGE_REASON("main"));
  assert.equal(cls("git update-ref HEAD x", MAIN_DIR), MERGE_REASON("main"));
});

test("classify: fetch and pull into a main ref are merges too", () => {
  assert.equal(cls("git fetch . lm/x:main"), MERGE_REASON("main"));
  assert.equal(cls("git fetch origin +main:refs/heads/main"), MERGE_REASON("main"));
  assert.equal(cls("git pull . lm/x:main"), MERGE_REASON("main"));
  assert.equal(cls("git fetch origin main:refs/remotes/origin/main; git fetch https://h.invalid/x.git"), undefined);
});

test("classify: a checkout or switch earlier in the command changes the branch for later calls in that directory", () => {
  assert.equal(cls("git checkout main && git merge lm/x"), MERGE_REASON("main"));
  assert.equal(cls("git switch main; git commit -m x"), MERGE_REASON("main"));
  assert.equal(cls("cd /r/x.worktrees/lm--x/src && git checkout main && git commit"), MERGE_REASON("main"));
  assert.equal(cls("git checkout lm/y && git commit -m x"), undefined);
  assert.equal(cls("git checkout -- a.ts && git commit -m x"), undefined);
  assert.equal(cls("git checkout -b lm/z main && git commit -m x"), undefined);
  assert.equal(cls("git checkout lm/y && git commit -m x", MAIN_DIR), UNKNOWN_DIR, "a branch or a path: main may stay");
  assert.equal(cls("git checkout - && git commit -m x"), UNKNOWN_DIR);
  assert.equal(cls("git checkout --detach && git commit -m x", MAIN_DIR), undefined);
  assert.equal(cls("git -C /r/x checkout lm/y; git commit -m x"), undefined, "another directory");
});

test("classify: an unknown directory blocks the current-branch subcommands with UNKNOWN_DIR; named refs still decide", () => {
  for (const cmd of ["cd $X && git commit", "git -C \"$W\" merge x", "git --git-dir=/o/.git reset --hard", "cd $X && git push", "git -C /nowhere commit"])
    assert.equal(cls(cmd), UNKNOWN_DIR, cmd);
  assert.equal(cls("git commit -m x", "/r/slow"), UNKNOWN_DIR, "branchOf timed out");
  assert.equal(cls("cd $X && git push origin main"), MERGE_REASON("main"));
  assert.equal(cls("cd $X && git push origin lm/x; cd $X && git status"), undefined);
  assert.equal(cls("git commit -m x; git push", "/r/detached"), undefined, "a detached HEAD moves no branch");
});

test("classify: a computed ref or subcommand is UNCLASSIFIED", () => {
  for (const cmd of ["git push origin $B", "git push origin HEAD:$(cat b)", "git branch -D $B", "git checkout -B \"$B\"", "git $SUB x",
    "git update-ref --stdin", "echo main | xargs git push origin", "git fetch . \"$R\"", "git fetch -- . $R", "git pull origin $B"])
    assert.equal(cls(cmd), UNCLASSIFIED, cmd);
});

test("safeClassify (LD8): a command that cannot be parsed is blocked when it has a git token, else allowed", () => {
  assert.equal(safeClassify("git commit -m 'unclosed", WT, MAINS, BR), UNCLASSIFIED);
  assert.equal(safeClassify("echo 'unclosed", WT, MAINS, BR), undefined);
  assert.equal(safeClassify("bash -c \"$CMD\"", WT, MAINS, BR), undefined);
  assert.equal(safeClassify("bash -c \"$CMD\" && /usr/bin/git log", WT, MAINS, BR), UNCLASSIFIED);
  assert.equal(safeClassify("env -S 'git push' x", WT, MAINS, BR), UNCLASSIFIED);
  assert.equal(safeClassify("cat .git/x 'y", WT, MAINS, BR), undefined, ".git is no git token");
  assert.equal(safeClassify("git push origin main", WT, MAINS, BR), MERGE_REASON("main"));
});
