# The log contract, part 1 (spec §8.1; part 2 is module-eval's
# analysis-skill-contract): contract.ts runs every log writer's real code path
# (token-meter, task-router, cache-lifecycle, experiments; each package's own
# test fakes stand in for pi) into one agent dir, then requires
# `pi-analyse --check` to pass, every line to carry the current schema version
# and every report section to have data.
{
  lib,
  runCommand,
  nodejs,
}: let
  src = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ./contract.ts
      ../../packages/token-meter
      ../../packages/task-router
      ../../packages/cache-lifecycle
      ../../packages/experiments
    ];
  };
in
  runCommand "check-log-contract" {nativeBuildInputs = [nodejs];} ''
    set -euo pipefail
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"
    node --experimental-strip-types --no-warnings ${src}/checks/log-contract/contract.ts "$TMPDIR/work"
    touch "$out"
  ''
