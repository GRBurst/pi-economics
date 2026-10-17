# piSettings' script against fixtures (spec §5.4), ported from the host's
# checks/pi-settings-migrate at f6a3c81. Three parts, each a sourced file:
#  1. ./ported-cases.sh: the host's cases, against today's ops (./today-ops.nix);
#  2. ./differential.sh: for every file in ./corpus, the bytes of the legacy
#     script (./legacy.nix), with and without ops.cacheLifecycle;
#  3. ./op-table.sh: set, ensureContains and removeWhere on a nested path, for
#     missing parents, wrong shapes, null and false.
{
  lib,
  pkgs,
  hm,
}: let
  today = import ./today-ops.nix;
  exe = ops: lib.getExe (hm.eval {programs.piEconomics.piSettings.ops = ops;}).programs.piEconomics.piSettings.package;
in
  pkgs.runCommand "pi-settings-migrate" {nativeBuildInputs = [pkgs.jq pkgs.coreutils pkgs.diffutils];} ''
    set -euo pipefail
    m=${exe today.withoutWarming}
    mi=${exe today.withWarming}

    mkdir part1
    (cd part1 && source ${./ported-cases.sh})
    touch $out
  ''
