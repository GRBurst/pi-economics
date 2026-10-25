# The router's golden test (spec §6.3): the decisions of packages/task-router
# equal the ones recorded from the host's R' in golden.txt (comment lines
# aside), and with the free-cloud slot empty no Qwen-chain decision takes the
# cloud route or waits (spec §6.1 P2). golden.txt is written by hand with
# generate.ts, once per deliberate behaviour change (plan M5, Task M5.4).
{
  runCommand,
  nodejs,
  diffutils,
}:
runCommand "check-router-golden" {nativeBuildInputs = [nodejs diffutils];} ''
  set -euo pipefail
  { grep -v '^#' ${./golden.txt} || true; } > want.txt
  if grep -E '^chain empty-slot .*( cloud:| wait)' want.txt >&2; then
    echo "router-golden: an empty free-cloud slot is routed to or waited for" >&2
    exit 1
  fi
  export HOME=$TMPDIR/home
  mkdir -p "$HOME"
  node --experimental-strip-types --no-warnings ${./generate.ts} ${../../packages/task-router} > got.txt
  if ! diff -u want.txt got.txt > diff.txt; then
    echo "router-golden: decisions differ from R' ($(grep -c '^[-+][a-z]' diff.txt) lines); the first 40:" >&2
    head -n 40 diff.txt >&2
    exit 1
  fi
  touch "$out"
''
