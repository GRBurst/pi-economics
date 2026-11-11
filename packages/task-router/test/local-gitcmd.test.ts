// Local mode L6.T1–T2 (design §3.4.5, AC-M1, LD8; plan S24, D43): the git command classifier. T1: splitting a shell command
// into simple commands with their directories, and the git calls among them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DYN, gitCalls, gitDirs, segments } from "../core/local/gitcmd.ts";

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
