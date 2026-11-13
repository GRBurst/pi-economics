# The licence (spec §8.3): LICENSE is MIT, every package declares MIT, and
# NOTICE has a section per patched upstream (patches/<input>) and none for an
# upstream this flake no longer patches, and each patches/<input>/LICENSE
# carries the upstream's MIT permission notice. Every `Licence text: <path>`
# line of NOTICE names a file with that notice, one of them checks/npm/LICENSE:
# the checks' npm lock is a third party's manifest (NOTICE; redesign P17).
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
  sections = map (lib.removePrefix "## ") (lib.filter (lib.hasPrefix "## ") notice);
  permission = "Permission is hereby granted";
  # The path of each `Licence text: <path> …` line.
  cited = map (l: lib.head (lib.splitString " " (lib.removePrefix "Licence text: " l))) (lib.filter (lib.hasPrefix "Licence text: ") notice);
  citedFailure = p:
    if !has "/${p}"
    then ["NOTICE: licence text ${p} missing"]
    else lib.optional (lib.filter (l: lib.hasPrefix permission l) (lines (root + "/${p}")) == []) "${p}: no MIT permission notice";
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
    ++ map (s: "NOTICE: section '## ${s}' has no patches/${s}") (lib.filter (s: !lib.elem s patched) sections)
    ++ lib.concatMap licenseFailure patched
    ++ lib.concatMap citedFailure cited
    ++ lib.optional (!lib.elem "checks/npm/LICENSE" cited) "NOTICE: no 'Licence text: checks/npm/LICENSE' line (the npm lock is a third party's manifest)";
in
  pkgs.runCommand "license" {
    report = lib.concatStringsSep "\n" failures;
    passAsFile = ["report"];
  } ''
    if [ -s "$reportPath" ]; then cat "$reportPath" >&2; echo >&2; exit 1; fi
    echo "license: MIT, ${toString (lib.length jsons)} packages, ${toString (lib.length patched)} upstreams in NOTICE"
    touch $out
  ''
