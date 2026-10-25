# Cases for modules/cache-lifecycle.nix (spec §4, §4.1, §5.1, §5.4).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  today = import ../../pi-settings-migrate/today-ops.nix;
  # dir: agentDir; cl: cacheLifecycle options, null = not enabled; more: other
  # programs.piEconomics options.
  eval = dir: cl: more:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (cl != null) {cacheLifecycle = {enable = true;} // cl;}
        // more;
    };
  sorted = lib.sort lib.lessThan;
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  bare = hm.evalBare {};
  warning = "pi-economics: cacheLifecycle without actorSubagents loses warming while a session waits on its children (the warm policy reads __subagentsApi_v1)";
in {
  # (M4.9) Off by default: no registry entry, no file, no op.
  cache-lifecycle-off = let
    c = eval ".pi/agent" null {};
  in
    holds "no registry entry" (!(pe c).extensions ? cache-lifecycle)
    ++ eq "home.file targets" (targets c) (targets bare)
    ++ eq "piSettings ops" (pe c).piSettings.ops {};

  # (M4.9) On, with actorSubagents (no warning): the registry entry, loaded
  # into children, its link following agentDir; the existence probe reads the
  # source, so evaluation builds nothing.
  cache-lifecycle-defaults = lib.concatMap (dir: let
    c = eval dir {} {actorSubagents.enable = true;};
    e = (pe c).extensions.cache-lifecycle;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).cacheLifecycle.package}";
      input = null;
      forChildren = true;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/cache-lifecycle/index.ts" (toString e.checkPath))
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ holds "link target (${dir})" (lib.elem "${dir}/extensions/cache-lifecycle" (targets c))
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M4.9) The package is the flake's, under the name the host's
  # checks/pi-extensions.nix:147 matches in the link target.
  cache-lifecycle-package = let
    cl = (pe (eval ".pi/agent" {} {})).cacheLifecycle;
  in
    eq "drvPath" cl.package.drvPath self.packages.x86_64-linux.cache-lifecycle.drvPath
    ++ eq "name" cl.package.name "pi-cache-lifecycle-0.1.0";

  # (M4.9) Files: the link only; no settings file while settings = {}.
  cache-lifecycle-files = lib.concatMap (dir:
    eq "home.file targets (${dir})" (sorted (targets (eval dir {} {})))
    (sorted (targets bare ++ ["${dir}/extensions/cache-lifecycle"])))
  dirs;
}
