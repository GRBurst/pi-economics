# The router's golden test (spec §6.3): the decisions of packages/task-router
# equal the ones recorded in golden.txt (comment lines aside; R' = the host's
# 566fd0d, re-recorded per deliberate behaviour change), and with the free-cloud
# slot empty no selection picks it and the cloud's state changes no decision
# (spec §6.1 P2, an invariance; a wait for the local slot is allowed). golden.txt
# is written by hand with generate.ts (plan router-g3-g7, D6).
{
  runCommand,
  nodejs,
  diffutils,
}: let
  # The fixtures whose free-cloud slot is empty (plan router-g3-g7, D7).
  fixtures = "empty-slot";
in
  runCommand "check-router-golden" {nativeBuildInputs = [nodejs diffutils];} ''
    set -euo pipefail
    { grep -v '^#' ${./golden.txt} || true; } > want.txt
    # P2 (spec §6.1) / MP2: with the free-cloud slot empty, no selection picks it and the
    # cloud's state changes no decision (a wait for the local slot is allowed, HS D5).
    for fx in ${fixtures}; do
      grep "^select $fx " want.txt > sel.txt || true
      n=$(wc -l < sel.txt)
      [ "$n" -eq 48 ] || { echo "router-golden: select $fx: expected 48 lines, got $n" >&2; exit 1; }
      if grep ' qwen-cloud:' sel.txt >&2; then echo "router-golden: an empty free-cloud slot is picked ($fx)" >&2; exit 1; fi
      if ! awk '{ v = $6 " " $7; if (($3 in seen) && seen[$3] != v) bad = 1; seen[$3] = v } END { exit bad }' sel.txt; then
        echo "router-golden: with the free-cloud slot empty, the cloud's state changes a decision ($fx)" >&2; exit 1
      fi
    done
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"
    node --experimental-strip-types --no-warnings ${./generate.ts} ${../../packages/task-router} > got.txt
    if ! diff -u want.txt got.txt > diff.txt; then
      echo "router-golden: decisions differ from golden.txt ($(grep -c '^[-+][a-z]' diff.txt) lines); the first 40:" >&2
      head -n 40 diff.txt >&2
      exit 1
    fi
    touch "$out"
  ''
