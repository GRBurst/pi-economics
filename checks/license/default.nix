# The licence (spec §8.3): LICENSE is MIT, every package declares MIT, and
# NOTICE has a section per patched upstream (patches/<input>), and each
# patches/<input>/LICENSE carries the upstream's MIT permission notice.
{
  lib,
  pkgs,
}: let
  root = ../..;
  lines = f: lib.splitString "\n" (builtins.readFile f);
  has = p: builtins.pathExists (root + p);
  pkgDirs = lib.attrNames (lib.filterAttrs (_: t: t == "directory") (builtins.readDir (root + "/packages")));
  jsons = lib.filter (d: has "/packages/${d}/package.json") pkgDirs;
  licenseOf = d: (builtins.fromJSON (builtins.readFile (root + "/packages/${d}/package.json"))).license or null;
  patched = lib.attrNames (builtins.readDir (root + "/patches"));
  notice = lib.optionals (has "/NOTICE") (lines (root + "/NOTICE"));
  permission = "Permission is hereby granted";
  licenseFailure = d:
    if !has "/patches/${d}/LICENSE"
    then ["patches/${d}/LICENSE missing"]
    else lib.optional (lib.filter (l: lib.hasPrefix permission l) (lines (root + "/patches/${d}/LICENSE")) == []) "patches/${d}/LICENSE: no MIT permission notice";
  failures =
    lib.optional (!has "/LICENSE") "LICENSE missing"
    ++ lib.optional (has "/LICENSE" && lib.head (lines (root + "/LICENSE")) != "MIT License") "LICENSE: line 1 is not 'MIT License'"
    ++ lib.optional (jsons == []) "no packages/*/package.json found"
    ++ map (d: "packages/${d}/package.json: license ${builtins.toJSON (licenseOf d)}, want \"MIT\"") (lib.filter (d: licenseOf d != "MIT") jsons)
    ++ lib.optional (!has "/NOTICE") "NOTICE missing"
    ++ map (d: "NOTICE: no section for patches/${d} (a line '## ${d}')") (lib.filter (d: !lib.elem "## ${d}" notice) patched)
    ++ lib.concatMap licenseFailure patched;
in
  pkgs.runCommand "license" {
    report = lib.concatStringsSep "\n" failures;
    passAsFile = ["report"];
  } ''
    if [ -s "$reportPath" ]; then cat "$reportPath" >&2; echo >&2; exit 1; fi
    echo "license: MIT, ${toString (lib.length jsons)} packages, ${toString (lib.length patched)} upstreams in NOTICE"
    touch $out
  ''
