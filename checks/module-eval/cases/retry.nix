# Cases for modules/retry.nix (spec §4, §4.1, §5.1, §5.4).
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
  # The op submodule's default, so module values compare with the fixture.
  withOrder = map (op: {order = 1000;} // op);
  # dir: agentDir; rt: retry options, null = not enabled; more: other
  # programs.piEconomics options.
  eval = dir: rt: more:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (rt != null) {retry = {enable = true;} // rt;}
        // more;
    };
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  bare = hm.evalBare {};
  asOn = {actorSubagents.enable = true;};
in {
  # (M6.11) Off by default: no registry entry, no file, no op.
  retry-off = let
    c = eval ".pi/agent" null {};
  in
    holds "no registry entry" (!(pe c).extensions ? pi-retry)
    ++ eq "home.file targets" (targets c) (targets bare)
    ++ eq "piSettings ops" (pe c).piSettings.ops {};

  # (M6.11) On: the registry entry (the whole repository, loaded into
  # children), its link following agentDir, and no file of its own.
  retry-defaults = lib.concatMap (dir: let
    c = eval dir {} asOn;
    e = (pe c).extensions.pi-retry;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).retry.package}";
      input = "pi-retry";
      forChildren = true;
    }
    ++ eq "checkPath (${dir})" (toString e.checkPath) "${self.inputs.pi-retry}/retry.ts"
    ++ eq "new home.file targets (${dir})" (lib.subtractLists (targets (eval dir null asOn)) (targets c)) ["${dir}/extensions/pi-retry"]
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M6.11) The package is the flake's, under the host's derivation name.
  retry-package = let
    rt = (pe (eval ".pi/agent" {} {})).retry;
  in
    eq "drvPath" rt.package.drvPath self.packages.x86_64-linux.retry.drvPath
    ++ eq "name" rt.package.name "pi-retry-patched";

  # (M6.12) With actorSubagents: today's ops; with the host's op the program
  # is the one pi-settings-migrate compares with the legacy script.
  retry-pisettings = let
    c = eval ".pi/agent" {} asOn;
    withHost = eval ".pi/agent" {} (asOn // {piSettings.ops.host = today.withoutWarming.host;});
    todays = hm.eval {programs.piEconomics.piSettings.ops = today.withoutWarming;};
  in
    eq "ops" (pe c).piSettings.ops {retry = withOrder today.withoutWarming.retry;}
    ++ eq "program with the host's op" (pe withHost).piSettings.program (pe todays).piSettings.program
    ++ holds "activation entry piSettingsMigrate" (c.home.activation ? piSettingsMigrate);

  # (M6.12) Without actorSubagents: the two removals, no child rule, no
  # warning (spec §4.1).
  retry-alone = let
    c = eval ".pi/agent" {} {};
  in
    eq "ops" (pe c).piSettings.ops {retry = withOrder (lib.take 2 today.withoutWarming.retry);}
    ++ eq "warnings" c.warnings bare.warnings
    ++ eq "failed assertions" (failed "" c) [];
}
