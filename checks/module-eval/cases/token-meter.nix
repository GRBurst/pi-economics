# Cases for modules/token-meter.nix (spec §4, §4.1, §5.1).
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
    ++ eq "name" t.package.name "pi-token-meter-${version}";

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

  # (M3a T3a.1) plans: rendered into settings.json next to `settings`, `rate`
  # only when set, `per` defaulted; no plans and no settings write no file.
  token-meter-plans = let
    plans = {
      p-sub = {
        billing = "subscription";
        windows = ["5h" "7d"];
      };
      p-local = {
        billing = "local";
        rate = {
          amount = 0.13;
          currency = "EUR";
        };
      };
      p-free.billing = "free";
    };
    json = tm: let
      f = fileAt ".pi/agent/token-meter/settings.json" (eval ".pi/agent" tm);
    in
      if f == null
      then null
      else builtins.fromJSON f.text;
  in
    eq "plans only" (json {inherit plans;}) {
      plans = {
        p-sub = {
          billing = "subscription";
          windows = ["5h" "7d"];
        };
        p-local = {
          billing = "local";
          windows = [];
          rate = {
            amount = 0.13;
            currency = "EUR";
            per = "hour";
          };
        };
        p-free = {
          billing = "free";
          windows = [];
        };
      };
    }
    ++ eq "plans next to settings" (json {
      plans.p-free.billing = "free";
      settings.dir = "m";
    }) {
      dir = "m";
      plans.p-free = {
        billing = "free";
        windows = [];
      };
    }
    ++ eq "no plans, no settings: no file" (json {}) null
    ++ eq "failed assertions" (failed "" (eval ".pi/agent" {inherit plans;})) [];

  # (M3a T3a.2) A rate prices a local provider's active time: on any other
  # billing class it is an error naming the provider; local with a rate holds.
  token-meter-plans-rate = let
    rate = {
      amount = 1;
      currency = "USD";
    };
    msg = name: "pi-economics: tokenMeter.plans.${name}.rate is set but its billing is not \"local\"";
    bad = plans: failed "pi-economics:" (eval ".pi/agent" {inherit plans;});
  in
    eq "api with a rate" (bad {
      p-api = {
        billing = "api";
        inherit rate;
      };
    }) [(msg "p-api")]
    ++ eq "subscription with a rate, local fine" (bad {
      p-sub = {
        billing = "subscription";
        inherit rate;
      };
      p-local = {
        billing = "local";
        inherit rate;
      };
    }) [(msg "p-sub")]
    ++ eq "local with a rate" (bad {
      p-local = {
        billing = "local";
        inherit rate;
      };
    }) [];

  # (M3.6) With the actor in the registry, children load the meter: the list
  # pi-setup's bridge writes into actor-subagents/settings.json (host
  # pi-extensions.nix:389-390) names it; the file is pi-setup's
  # (router-extraction design §7.2).
  token-meter-children = let
    c = hm.eval {
      programs.piEconomics = {
        tokenMeter.enable = true;
        extensions.actor-subagents = import ../fixtures/actor-entry.nix;
      };
    };
  in
    eq "childExtensions" (pe c).childExtensions ["/home/u/.pi/agent/extensions/token-meter"]
    ++ eq "no actor-subagents/settings.json here" (fileAt ".pi/agent/actor-subagents/settings.json" c) null;
}
