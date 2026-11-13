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
      # (redesign M5b.2) Children load it too: in child mode it derives the
      # child's assignment from the root's row and serves it on the child's bus.
      forChildren = true;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/experiments/index.ts" (toString e.checkPath))
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ holds "link target (${dir})" (lib.elem "${dir}/pi-economics/extensions/experiments" (targets c))
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
    (sorted (targets bare ++ ["${dir}/pi-economics/extensions/experiments" "${dir}/experiments/settings.json"]))
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

  # (redesign M5a T5a.6) A stratum's design has at most six factors (the
  # generator table of packages/experiments/core/design.ts).
  experiments-strata-seven = let
    factor = n: {
      name = "f${toString n}";
      lever = "t.lever${toString n}";
      levels = ["a" "b"];
    };
    withFactors = k:
      eval ".pi/agent" {
        settings.strata = {
          cloud = {
            match.billing = ["api"];
            factors = map factor (lib.range 1 k);
          };
          local.factors = [];
        };
      }
      withActor;
  in
    eq "seven factors" (failed "pi-economics:" (withFactors 7)) ["pi-economics: experiments stratum cloud has more than 6 factors"]
    ++ eq "six factors" (failed "pi-economics:" (withFactors 6)) [];

  # (redesign M5a T5a.7) Two-level factors only (redesign §7.2).
  experiments-strata-three-levels = let
    withLevels = levels:
      eval ".pi/agent" {
        settings.strata.cloud.factors = [
          {
            name = "ttl";
            lever = "cache-lifecycle.mainCacheTtl";
            inherit levels;
          }
          {
            name = "one";
            lever = "t.lever";
            levels = lib.take 1 levels;
          }
          {
            name = "two";
            lever = "t.other";
            levels = ["a" "b"];
          }
        ];
      }
      withActor;
  in
    eq "three levels and one level" (failed "pi-economics:" (withLevels ["5m" "1h" "2h"])) [
      "pi-economics: experiments factor one in stratum cloud needs exactly two levels"
      "pi-economics: experiments factor ttl in stratum cloud needs exactly two levels"
    ]
    ++ eq "only the one-level factor" (failed "pi-economics:" (withLevels ["5m" "1h"])) [
      "pi-economics: experiments factor one in stratum cloud needs exactly two levels"
    ];

  # (redesign M5a review) Two equal levels, no levels or a non-list are not two
  # levels; a factor whose name is no string still gets the message.
  experiments-strata-bad-levels = let
    c =
      eval ".pi/agent" {
        settings.strata = {
          cloud.factors = [
            {
              name = "same";
              lever = "t.a";
              levels = ["a" "a"];
            }
            {
              name = "none";
              lever = "t.b";
            }
            {
              name = "text";
              lever = "t.c";
              levels = "ab";
            }
            {
              name = "ok";
              lever = "t.d";
              levels = ["a" "b"];
            }
          ];
          named.factors = [
            {
              name = {x = 1;};
              lever = "t.e";
              levels = ["a"];
            }
          ];
        };
      }
      withActor;
  in
    eq "equal, missing and non-list levels; a set as name" (failed "pi-economics:" c) [
      "pi-economics: experiments factor ? in stratum named needs exactly two levels"
      "pi-economics: experiments factor none in stratum cloud needs exactly two levels"
      "pi-economics: experiments factor same in stratum cloud needs exactly two levels"
      "pi-economics: experiments factor text in stratum cloud needs exactly two levels"
    ];

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
    kids = map (n: "/home/u/.pi/agent/pi-economics/extensions/${n}") ["experiments" "token-meter" "cache-lifecycle"];
  in
    eq "childExtensions" (pe c).childExtensions kids
    ++ eq "no actor-subagents/settings.json here" (fileAt ".pi/agent/actor-subagents/settings.json" c) null
    ++ eq "links" (sorted (lib.filter (lib.hasPrefix ".pi/agent/pi-economics/extensions/") (targets c)))
    (map (n: ".pi/agent/pi-economics/extensions/${n}") ["actor-subagents" "cache-lifecycle" "experiments" "token-meter"])
    ++ holds "no piSettingsMigrate entry" (!(c.home.activation ? piSettingsMigrate))
    ++ eq "failed assertions" (failed "" c) []
    # (M6) The registry is no longer auto-discovered: one warning.
    ++ eq "new warnings" (lib.subtractLists bare.warnings c.warnings) ["pi-economics: piSettings.enable is false, so nothing lists the registry in settings.json's `extensions`, and pi does not auto-discover its links in .pi/agent/pi-economics/extensions: put programs.piEconomics.loadOrder at the front of `extensions` yourself"];

  # (redesign M5b.1, review m3) The v1 engine's keys: one warning naming
  # those set; none without them.
  experiments-legacy-keys = let
    new = s: lib.subtractLists bare.warnings (eval ".pi/agent" {settings = s;} withActor).warnings;
    tail = "(the v1 engine's): its factors come from settings.strata (default: one stratum per billing class); baseline only labels the analyses of v1–v4 designs";
  in
    eq "factors, maxArms, baseline" (new {
      factors = [];
      maxArms = 8;
      baseline = "---";
      mode = "explore";
    }) ["pi-economics: experiments ignores settings.factors, settings.maxArms, settings.baseline ${tail}"]
    ++ eq "maxArms alone" (new {maxArms = 4;}) ["pi-economics: experiments ignores settings.maxArms ${tail}"]
    ++ eq "none" (new {
      mode = "exploit";
      strata = {};
    }) []
    ++ eq "default" (new {}) [];
}
