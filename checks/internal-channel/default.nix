# The internal channel (redesign §7.7, M5b.2): pi-economics' engine (experiments) hands each session's assignment and
# its levers' states to the add-ons on pi.events, never through a globalThis API. Packages do not import each other,
# so each reader keeps its own copy of the payload it reads (token-meter core/channel.ts and core/levers.ts,
# cache-lifecycle core/api.ts); compare.ts holds the copies to the engine's types and names, type-checked by the
# type check's runner (same flags, same lock).
{
  lib,
  pkgs,
  typecheck,
}: let
  packages = ../../packages;
  sources = lib.fileset.toSource {
    root = packages;
    fileset = lib.fileset.unions [
      (packages + "/experiments/core")
      (packages + "/experiments/addons")
      # core/settings.ts and core/assign.ts import its types (`import type`, plan P22).
      (packages + "/token-meter/core/plans.ts")
      (packages + "/token-meter/core/channel.ts")
      (packages + "/token-meter/core/levers.ts")
      (packages + "/cache-lifecycle/core/api.ts")
    ];
  };
  src = pkgs.runCommand "internal-channel-src" {} ''
    mkdir -p $out
    cp -r ${sources}/. $out/
    chmod -R u+w $out
    echo '{"type": "module"}' > $out/package.json
    cp ${./compare.ts} $out/compare.ts
  '';
in
  typecheck.typecheck {
    name = "internal-channel";
    inherit src;
  }
