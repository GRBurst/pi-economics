# Cases for modules/token-meter.nix (spec §4, §4.1, §5.1).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; tm: tokenMeter options, null = not enabled.
  eval = dir: tm:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (tm != null) {tokenMeter = {enable = true;} // tm;};
    };
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  packages = cfg: map toString cfg.home.packages;
  bare = hm.evalBare {};
in {
  # (M3.3) Off by default: no registry entry, no file, no package.
  token-meter-off = let
    c = eval ".pi/agent" null;
  in
    holds "no registry entry" (!(pe c).extensions ? token-meter)
    ++ eq "home.file targets" (targets c) (targets bare)
    ++ eq "home.packages" (packages c) (packages bare);

  # (M3.3) On: the registry entry, loaded into children, its link following
  # agentDir; the existence probe reads the source, so evaluation builds nothing.
  token-meter-defaults = lib.concatMap (dir: let
    c = eval dir {};
    t = (pe c).tokenMeter;
    e = (pe c).extensions.token-meter;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${t.package}";
      input = null;
      forChildren = true;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/token-meter/index.ts" (toString e.checkPath))
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ holds "link target (${dir})" (lib.elem "${dir}/extensions/token-meter" (targets c))
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M3.3) The package is the flake's, under the name the host's
  # checks/pi-extensions.nix:141 matches in the link target.
  token-meter-package = let
    t = (pe (eval ".pi/agent" {})).tokenMeter;
  in
    eq "drvPath" t.package.drvPath self.packages.x86_64-linux.token-meter.drvPath
    ++ eq "name" t.package.name "pi-token-meter-0.1.0";

  # (M3.4) Files and commands: the link and LOGS.md under agentDir, the two
  # reports on PATH, no settings file while settings = {}.
  token-meter-files = lib.concatMap (dir: let
    c = eval dir {};
    t = (pe c).tokenMeter;
    logs = fileAt "${dir}/LOGS.md" c;
  in
    eq "home.file targets (${dir})" (lib.sort lib.lessThan (targets c))
    (lib.sort lib.lessThan (targets bare ++ ["${dir}/extensions/token-meter" "${dir}/LOGS.md"]))
    ++ eq "LOGS.md source (${dir})" (
      if logs == null
      then null
      else toString logs.source
    ) "${t.package}/LOGS.md"
    ++ eq "home.packages (${dir})" (lib.subtractLists (packages bare) (packages c)) (map toString [t.package.report t.package.analyse])
    ++ eq "commands (${dir})" (map (p: p.meta.mainProgram) [t.package.report t.package.analyse]) ["meter-report" "pi-analyse"])
  dirs;

  # (M3.5) settings: written as given, under agentDir, only when non-empty.
  token-meter-settings = lib.concatMap (dir: let
    s = {
      dir = "m";
      rawRatelimit = false;
    };
    f = fileAt "${dir}/token-meter/settings.json" (eval dir {settings = s;});
  in
    eq "settings file (${dir})" (
      if f == null
      then null
      else builtins.fromJSON f.text
    )
    s)
  dirs;
}
