# Runs the tests of the PATCHED pi-infinite-context (the exact source
# ~/.pi/agent/pi-economics/extensions/infinite-context links to). A patch that no longer
# applies fails this build in applyPatches.
#
# Two runs:
#  - upstream's suite with the patch's own tests (settings.test.ts: rules per provider or
#    model, per-rule ranges, the record's `rule`; index.test.ts: a model switch records
#    the new settings, a seeded record keeps its draw), with pi's packages from the shared
#    lock (../npm). Every test file that imports fast-check (not in that lock) is left out:
#    archive-properties, forest and nudge (nudge.ts is upstream's, unpatched).
#  - this repository's tests, with stand-ins for pi's `getAgentDir`,
#    `sessionEntryToContextMessages` and typebox (./stubs; they carry no behaviour the
#    tests are about): overlay-foreign.test.ts (upstream's overlay.ts against what the
#    question extension does to a request, a foreign toolResult) and integration.test.ts
#    (index.ts reads the file the Home Manager module writes, and a settings record
#    pi-economics appends before the session starts holds the branch's draw).
{
  pkgs,
  src,
  nodeModules,
}:
pkgs.runCommand "pi-infinite-context-tests" {nativeBuildInputs = [pkgs.nodejs pkgs.gnugrep];} ''
  export HOME=$TMPDIR/home
  mkdir -p "$HOME"

  cp -r ${src} suite
  chmod -R u+w suite
  ln -s ${nodeModules}/node_modules suite/node_modules
  (
    cd suite/extensions/infinite-context
    mapfile -t tests < <(grep -L 'from "fast-check"' *.test.ts)
    for t in settings.test.ts index.test.ts; do
      printf '%s\n' "''${tests[@]}" | grep -qx "$t" || { echo "$t is not run" >&2; exit 1; }
    done
    node --test --experimental-strip-types "''${tests[@]}"
  )

  cp -r ${src} work
  chmod -R u+w work
  cd work
  mkdir -p node_modules/@earendil-works
  cp -r ${./stubs/pi-coding-agent} node_modules/@earendil-works/pi-coding-agent
  cp -r ${./stubs/typebox} node_modules/typebox
  cd extensions/infinite-context
  # The cache patch is gone: upstream rejected the fold hint (PR #7), and an
  # extension never reads pi-economics' experiments API.
  if grep -l '__piExperimentsApi_v1' *.ts; then
    echo "infinite-context must not read __piExperimentsApi_v1" >&2
    exit 1
  fi
  if [ -e fold-hint.ts ]; then
    echo "fold-hint.ts: the cache patch is dropped" >&2
    exit 1
  fi
  cp ${./overlay-foreign.test.ts} overlay-foreign.test.ts
  cp ${./integration.test.ts} integration.test.ts
  node --test --experimental-strip-types overlay-foreign.test.ts integration.test.ts

  # index.ts must read the settings file the Home Manager module writes.
  grep -q 'join(getAgentDir(), "infinite-context", "settings.json")' index.ts
  # The overlay is upstream's, matching the projection as an ordered subsequence; the
  # local align.ts of the former foreign-messages patch must not come back beside it.
  if [ -e align.ts ]; then
    echo "align.ts: the foreign-messages patch is dropped, upstream's overlay.ts covers it" >&2
    exit 1
  fi
  touch $out
''
