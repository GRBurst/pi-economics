# The CLIs of the package (AC9, plan T5.1): `npm install -g <the package
# directory>` offline links the two `bin` entries (a local directory is
# symlinked, so node's type stripping works: its realpath is outside
# node_modules). The sandbox has no /usr/bin/env, so the CLIs run through an
# explicit node; the shipped first line is checked as text. A copy under
# node_modules fails as the README says (pinned to the locked nodejs).
{
  pkgs,
  self,
}:
pkgs.runCommand "bins-smoke" {nativeBuildInputs = [pkgs.nodejs pkgs.jq pkgs.coreutils pkgs.gnugrep];} ''
  export HOME=$PWD/home npm_config_cache=$PWD/npmcache
  mkdir -p "$HOME" agent/meter
  cp -r ${self} pkg
  chmod -R u+w pkg
  fail() {
    echo "bins-smoke: $*" >&2
    exit 1
  }
  for f in meter-report pi-analyse; do
    jq -e --arg f "$f" '.bin[$f] == "./packages/token-meter/bin/\($f).ts"' pkg/package.json >/dev/null || fail "package.json has no bin entry for $f"
  done
  npm install -g --offline --prefix "$PWD/g" ./pkg >npm.log 2>&1 || { cat npm.log >&2; fail "npm install -g failed"; }
  # the shipped first line, as text (the sandbox has no /usr/bin/env to run it)
  for f in meter-report pi-analyse; do
    [ "$(head -n1 pkg/packages/token-meter/bin/$f.ts)" = '#!/usr/bin/env -S node --experimental-strip-types --no-warnings' ] || fail "the shebang of $f"
  done
  run() { node --experimental-strip-types --no-warnings "$@"; }
  run g/bin/meter-report --dir agent/meter >mr.out 2>&1 || { cat mr.out >&2; fail "meter-report failed"; }
  rc=0
  run g/bin/pi-analyse --check --agent-dir "$PWD/agent" >pa.out 2>&1 || rc=$?
  # an empty agent dir has nothing to complain about: 0, and 1 (a SyntaxError on a missing export) is a broken CLI
  case $rc in 0) ;; *) cat pa.out >&2; fail "pi-analyse exited $rc" ;; esac
  if grep -qF 'ERR_' pa.out; then cat pa.out >&2; fail "pi-analyse hit a node error"; fi
  # README's statement (E20): a copy under node_modules cannot run
  mkdir -p nm/node_modules
  cp -r pkg nm/node_modules/pi-economics
  if node --experimental-strip-types nm/node_modules/pi-economics/packages/token-meter/bin/pi-analyse.ts 2>nm.err; then fail "a copy under node_modules ran"; fi
  grep -qF ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING nm.err || { cat nm.err >&2; fail "unexpected failure under node_modules"; }
  touch $out
''
