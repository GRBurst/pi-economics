# The session-entry contract (redesign §7.4 "Contract tests per add-on", M7c): the experiments package's real engine
# code and a fixture extension that adopts a recorded session entry the way infinite-context does
# (entry-ext/index.ts) run in one fake runtime (the package's own test fakes stand in for pi, like log-contract's).
# The consumer's extension is a neutral stand-in: the repository names only the extensions it ships.
{
  lib,
  runCommand,
  nodejs,
}: let
  own = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ./contract.test.ts
      ./entry-ext
      ../../packages/experiments
    ];
  };
in
  runCommand "check-session-entry-contract" {nativeBuildInputs = [nodejs];} ''
    set -euo pipefail
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"
    tree=$TMPDIR/tree
    cp -r ${own} "$tree"
    chmod -R u+w "$tree"
    cd "$tree/checks/session-entry-contract"
    node --test --experimental-strip-types --no-warnings contract.test.ts
    touch "$out"
  ''
