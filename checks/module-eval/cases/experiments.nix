# Cases for modules/experiments.nix (spec §4, §4.1, §5.1), and the host's
# combination of M2–M4's components.
{
  lib,
  hm,
  self,
  expect,
  version,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; ex: experiments options, null = not enabled; more: other
  # programs.piEconomics options.
  eval = dir: ex: more:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (ex != null) {experiments = {enable = true;} // ex;}
        // more;
    };
  sorted = lib.sort lib.lessThan;
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  units = cfg: lib.attrNames cfg.systemd.user.services ++ lib.attrNames cfg.systemd.user.timers;
  bare = hm.evalBare {};
  # The actor in the registry, as pi-setup's bridge puts it there.
  withActor = {extensions.actor-subagents = import ../fixtures/actor-entry.nix;};
  warning = "pi-economics: experiments without actor-subagents in the registry (pi-setup's programs.pi.actorSubagents) loses arm inheritance by children (it reads spawn events from __subagentsApi_v1)";
in {
  # (M4.13) Off by default: no registry entry, no file.
  experiments-off = let
    c = eval ".pi/agent" null {};
  in
    holds "no registry entry" (!(pe c).extensions ? experiments)
    ++ eq "home.file targets" (targets c) (targets bare);

  # (M4.13) On, with the actor in the registry (no warning): the registry entry, main
  # session only, its link following agentDir; no timer (the host's
  # checks/pi-extensions.nix:264-269).
  experiments-defaults = lib.concatMap (dir: let
    c = eval dir {} withActor;
    e = (pe c).extensions.experiments;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).experiments.package}";
      input = null;
      forChildren = false;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/experiments/index.ts" (toString e.checkPath))
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ holds "link target (${dir})" (lib.elem "${dir}/extensions/experiments" (targets c))
    ++ eq "systemd user units (${dir})" (units c) (units bare)
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M4.13) The package is the flake's, under the name the host's
  # checks/pi-extensions.nix:150 matches in the link target.
  experiments-package = let
    x = (pe (eval ".pi/agent" {} {})).experiments;
  in
    eq "drvPath" x.package.drvPath self.packages.x86_64-linux.experiments.drvPath
    ++ eq "name" x.package.name "pi-experiments-${version}";

  # (M4.13; N4, spec D15) Files: the link and the settings file, the
  # extension's opt-in, with `mode` explicit while settings = {} (given settings are
  # written as given: experiments-settings).
  experiments-files = lib.concatMap (dir: let
    c = eval dir {} {};
    f = fileAt "${dir}/experiments/settings.json" c;
  in
    eq "home.file targets (${dir})" (sorted (targets c))
    (sorted (targets bare ++ ["${dir}/extensions/experiments" "${dir}/experiments/settings.json"]))
    ++ eq "settings file (${dir})" (
      if f == null
      then null
      else builtins.fromJSON f.text
    ) {mode = "explore";})
  dirs;

  # (M4.14) settings: written as given (the host's check value,
  # checks/pi-extensions.nix:262).
  experiments-settings = lib.concatMap (dir: let
    s = {minExplore = 0.15;};
    f = fileAt "${dir}/experiments/settings.json" (eval dir {settings = s;} {});
  in
    eq "settings file (${dir})" (
      if f == null
      then null
      else builtins.fromJSON f.text
    )
    s)
  dirs;

  # (M4.15) Alone, without the actor: one warning, no assertion.
  experiments-warning = let
    c = eval ".pi/agent" {} {};
  in
    eq "new warnings" (lib.subtractLists bare.warnings c.warnings) [warning]
    ++ eq "failed assertions" (failed "" c) [];

  # (M4.16) The host's combination from W3 on (spec §9.1): M2–M4's extension
  # components, piSettings off (the host's own script runs until W6). Children
  # load cache-lifecycle and token-meter, not experiments: the list pi-setup's
  # bridge writes into the actor's settings file (host pi-extensions.nix:389-390);
  # the file is pi-setup's (router-extraction design §7.2).
  cache-experiments-host-like = let
    c = hm.eval {
      programs.piEconomics = {
        inherit (withActor) extensions;
        tokenMeter.enable = true;
        cacheLifecycle.enable = true;
        experiments.enable = true;
        piSettings.enable = false;
      };
    };
    kids = ["/home/u/.pi/agent/extensions/cache-lifecycle" "/home/u/.pi/agent/extensions/token-meter"];
  in
    eq "childExtensions" (pe c).childExtensions kids
    ++ eq "no actor-subagents/settings.json here" (fileAt ".pi/agent/actor-subagents/settings.json" c) null
    ++ eq "links" (sorted (lib.filter (lib.hasPrefix ".pi/agent/extensions/") (targets c)))
    (map (n: ".pi/agent/extensions/${n}") ["actor-subagents" "cache-lifecycle" "experiments" "token-meter"])
    ++ holds "no piSettingsMigrate entry" (!(c.home.activation ? piSettingsMigrate))
    ++ eq "failed assertions" (failed "" c) []
    ++ eq "warnings" c.warnings bare.warnings;
}
