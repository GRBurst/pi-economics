# The log contract, part 1 (spec §8.1; part 2 is module-eval's
# analysis-skill-contract): contract.ts runs every log writer's real code path
# (token-meter, task-router, cache-lifecycle, experiments; each package's own
# test fakes stand in for pi) into one agent dir, then requires
# `pi-analyse --check` to pass, every line to carry the current schema version
# and every report section to have data.
#
# The router is the pi-task-router input's (router-extraction design §7.3,
# §8.6): its `packages/task-router` is copied next to this repository's
# packages, so contract.ts's relative imports read the router's real writer,
# enums and test harness.
{
  lib,
  runCommand,
  nodejs,
  # The router's package directory (a store path).
  router,
}: let
  own = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ./contract.ts
      ../../packages/token-meter
      ../../packages/cache-lifecycle
      ../../packages/experiments
    ];
  };
in
  runCommand "check-log-contract" {nativeBuildInputs = [nodejs];} ''
    set -euo pipefail
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"
    tree=$TMPDIR/tree
    cp -r ${own} "$tree"
    chmod -R u+w "$tree"
    cp -r ${router} "$tree/packages/task-router"
    node --experimental-strip-types --no-warnings "$tree/checks/log-contract/contract.ts" "$TMPDIR/work"
    touch "$out"
  ''
