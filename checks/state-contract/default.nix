# state.json, the file between the analyser and the engine (redesign M5c, T5c.9): token-meter's writer (core/arms.ts
# nextState, behind pi-analyse --apply and meter-report --posterior) puts each v2 design's kill switch and posterior
# under `designs.<design id>.<stratum>`, where experiments' reader (core/assign.ts designState) looks for them.
# Packages import no other, so the check loads both sources side by side and feeds the writer's output to the reader.
{
  lib,
  pkgs,
}: let
  packages = ../../packages;
  src = lib.fileset.toSource {
    root = packages;
    fileset = lib.fileset.unions [
      (packages + "/experiments/core")
      (packages + "/token-meter/core")
    ];
  };
in
  pkgs.runCommand "state-contract" {nativeBuildInputs = [pkgs.nodejs];} ''
    export HOME=$TMPDIR/home
    mkdir -p "$HOME" work
    cp -r ${src}/. work/
    chmod -R u+w work
    cp ${./contract.test.ts} work/contract.test.ts
    echo '{"type": "module"}' > work/package.json
    cd work
    node --test --experimental-strip-types contract.test.ts
    touch $out
  ''
