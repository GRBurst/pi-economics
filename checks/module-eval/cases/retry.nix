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
  # (order, key, op, path) of every op, in the order the program runs them.
  sequence = cfg: map (o: "${toString o.order}:${o.key}:${o.op}:${lib.concatStringsSep "." o.path}") (pe cfg).piSettings.sortedOps;
  bare = hm.evalBare {};
  # The actor in the registry, as pi-setup's bridge puts it there.
  asOn = {extensions.actor-subagents = import ../fixtures/actor-entry.nix;};
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

  # (M6.12) With the actor in the registry: today's ops; with the host's op the program
  # is the one pi-settings-migrate compares with the legacy script.
  retry-pisettings = let
    c = eval ".pi/agent" {} asOn;
    withHost = eval ".pi/agent" {} (asOn // {piSettings.ops.host = today.withoutWarming.host;});
    todays = hm.eval {programs.piEconomics.piSettings.ops = today.withoutWarming;};
  in
    eq "ops" (pe c).piSettings.ops {retry = withOrder today.withoutWarming.retry;}
    ++ eq "program with the host's op" (pe withHost).piSettings.program (pe todays).piSettings.program
    ++ holds "activation entry piSettingsMigrate" (c.home.activation ? piSettingsMigrate);

  # (M6.12) Without the actor: the two removals, no child rule, no
  # warning (spec §4.1).
  retry-alone = let
    c = eval ".pi/agent" {} {};
  in
    eq "ops" (pe c).piSettings.ops {retry = withOrder (lib.take 2 today.withoutWarming.retry);}
    ++ eq "warnings" c.warnings bare.warnings
    ++ eq "failed assertions" (failed "" c) [];

  # (M6.13) settings: one set per leaf under piRetry at order 500, before
  # every order-1000 op (the host's and the child rule); a list is one leaf.
  retry-settings = let
    c = eval ".pi/agent" {
      settings = {
        maxDelayMs = 60000;
        subagents = {
          enabled = true;
          match.systemPromptRegex = [{pattern = "x";}];
        };
      };
    } (asOn // {piSettings.ops.host = today.withoutWarming.host;});
    sets = lib.filter (o: o.op == "set") (pe c).piSettings.ops.retry;
  in
    eq "sequence" (sequence c) [
      "500:retry:set:piRetry.maxDelayMs"
      "500:retry:set:piRetry.subagents.enabled"
      "500:retry:set:piRetry.subagents.match.systemPromptRegex"
      "1000:host:removeWhere:packages"
      "1000:retry:removeWhere:packages"
      "1000:retry:removeWhere:packages"
      "1000:retry:ensureContains:piRetry.subagents.match.systemPromptRegex"
    ]
    ++ eq "values" (map (o: o.value) sets) [60000 true [{pattern = "x";}]];

  # (P.2, review-m6 Low) An empty set below settings is an error naming its
  # path; leaves beside it are fine.
  retry-settings-empty-attr = let
    c = eval ".pi/agent" {
      settings = {
        maxDelayMs = 1;
        subagents = {};
        a.b = {};
      };
    } {};
    ok = eval ".pi/agent" {settings = {subagents.enabled = true;};} {};
  in
    eq "failed" (failed "pi-economics: retry.settings" c) [
      "pi-economics: retry.settings.a.b is an empty attribute set; it sets nothing (give it a leaf or remove it)"
      "pi-economics: retry.settings.subagents is an empty attribute set; it sets nothing (give it a leaf or remove it)"
    ]
    ++ eq "no failure without an empty set" (failed "pi-economics: retry.settings" ok) [];

  # (M6.15) The host's combination of M2-M6 from W5 on (spec §9.1): the
  # flake's children (the list pi-setup's bridge writes into the actor's
  # settings file), no activation entry while the host's script runs.
  m6-host-like = let
    c = hm.eval {
      programs.piEconomics = {
        inherit (asOn) extensions;
        tokenMeter.enable = true;
        cacheLifecycle.enable = true;
        experiments.enable = true;
        infiniteContext.enable = true;
        retry.enable = true;
        piSettings.enable = false;
      };
    };
    childNames = map baseNameOf c.programs.piEconomics.childExtensions;
  in
    eq "children" childNames ["cache-lifecycle" "infinite-context" "pi-retry" "token-meter"]
    ++ holds "no activation entry" (!(c.home.activation ? piSettingsMigrate))
    ++ eq "failed assertions" (failed "" c) []
    ++ eq "warnings" c.warnings bare.warnings;
}
