# The online experiment (spec §2, §4): one fractional-factorial arm per main
# session (explore/exploit assignment), recorded in
# <agentDir>/experiments/assignments.jsonl and handed to pi-economics' own
# add-ons on its internal channel (pi.events; redesign §7.7, M5b.2: no
# globalThis API). Design v4's factors (warmPolicy, mainCacheTtl, maskOnCold)
# are cache-lifecycle's levers; token-meter records the arm and the levers'
# read-back; the task router's levers are no factors any more: it randomizes
# itself. Children load it too (child mode): a child never draws, it runs its
# root's arm, derived from the root's row and served on the child's own bus.
# No timer: the posterior update and the kill switch (token-meter's
# `meter-report --arms --posterior`) run on demand.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.experiments;
  # The actor is there when the registry holds it (router-extraction design
  # §7.3): pi-setup's patched actor, forwarded by its economics
  # bridge, or any entry of that name.
  hasActor = pe.extensions ? actor-subagents;
  # (redesign M5a) The factor lists of settings.strata, by stratum. The
  # settings are free-form JSON: anything but a list counts as no factors here
  # (core/settings.ts reads the file at run time).
  factorsOf = s: let
    fs = s.factors or [];
  in
    if lib.isList fs
    then fs
    else [];
  strata = let
    given = cfg.settings.strata or {};
  in
    lib.mapAttrs (_: factorsOf) (
      if lib.isAttrs given
      then given
      else {}
    );
  legacyKeys = lib.filter (k: cfg.settings ? ${k}) ["factors" "maxArms" "baseline"];
in {
  options.programs.piEconomics.experiments = {
    enable = lib.mkEnableOption "the pi experiments extension (one fractional-factorial arm per main session; explore/exploit assignment; a child runtime runs its root's arm)";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/experiments/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/experiments/package.nix { }";
      description = "The extension (package.json, index.ts, core/); its tests run when it builds.";
    };

    # (M4.14)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {
        mode = "explore";
        minExplore = 0.15;
      };
      description = ''
        Written to `<agentDir>/experiments/settings.json` as given; `{}`
        writes `{"mode": "explore"}`. The file is the extension's opt-in:
        without it the extension stays inert (no arm, no factor change), so
        it is written whenever the component is enabled. Every key it lacks
        has a default in the package's core/settings.ts (`mode`, `minExplore`,
        `strata`, `guards`, `correctionRegex`); `strata` defaults to one stratum
        per billing class of `tokenMeter.plans` (and `api`). The v1 engine's
        `factors`, `maxArms` and `baseline` are not applied (a warning names
        them); `baseline` still labels the analyses of v1–v4 designs.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # (M4.13) One arm per main session. (redesign M5b.2) Children load it too:
    # pi.events is per runtime and the actor builds a child without the
    # parent's bus, so the child's own copy derives the root's arm (child
    # mode, no draw) and serves it to the add-ons in the child.
    programs.piEconomics.extensions.experiments = {
      path = "${cfg.package}";
      checkPath = ../packages/experiments/index.ts;
      forChildren = true;
      description = "One fractional-factorial arm per main session (explore/exploit assignment); children run their root's arm; pi-economics' add-ons read and read back its levers on the internal channel.";
    };

    # (M4.14) Literal text (spec §4). N4: always written, the extension's
    # opt-in (package spec D15); `mode` explicit when nothing is given.
    home.file."${pe.agentDir}/experiments/settings.json".text = builtins.toJSON (
      if cfg.settings == {}
      then {mode = "explore";}
      else cfg.settings
    );

    # (redesign M5a) A stratum's design is the full 2^k factorial or a
    # fraction from the generator table of core/design.ts, which ends at six;
    # its factors have two different levels each (redesign §7.2).
    assertions = lib.concatLists (lib.mapAttrsToList (name: fs:
      [
        {
          assertion = lib.length fs <= 6;
          message = "pi-economics: experiments stratum ${name} has more than 6 factors";
        }
      ]
      ++ map (f: {
        assertion = lib.isList (f.levels or null) && lib.length f.levels == 2 && lib.elemAt f.levels 0 != lib.elemAt f.levels 1;
        message = "pi-economics: experiments factor ${
          if lib.isString (f.name or null)
          then f.name
          else "?"
        } in stratum ${name} needs exactly two levels";
      })
      fs)
    strata);

    # (M4.15) A soft dependency (spec §4.1): shell.ts tolerates a missing API.
    warnings =
      lib.optional (!hasActor) "pi-economics: experiments without actor-subagents in the registry (pi-setup's programs.pi.actorSubagents) does not recognise in-memory children (it reads the actor's agent list from __subagentsApi_v1; children with a session file still run their root's arm)"
      # (redesign M5b.1, review m3) The v1 engine's keys, set on purpose:
      # its factors are no longer drawn (the package warns too).
      ++ lib.optional (legacyKeys != []) "pi-economics: experiments ignores ${lib.concatMapStringsSep ", " (k: "settings.${k}") legacyKeys} (the v1 engine's): its factors come from settings.strata (default: one stratum per billing class); baseline only labels the analyses of v1–v4 designs";
  };
}
