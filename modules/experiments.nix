# The online experiment (spec §2, §4): one fractional-factorial arm per main
# session (explore/exploit assignment), recorded in
# <agentDir>/experiments/assignments.jsonl and published as
# globalThis.__piExperimentsApi_v1, whose factor flags cache-lifecycle,
# token-meter, the task router and infinite-context read. Main session only:
# children inherit their parent's arm from actor-subagents' spawn events. No
# timer: the posterior update and the kill switch (token-meter's
# `meter-report --arms --posterior`) run on demand.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.experiments;
in {
  options.programs.piEconomics.experiments = {
    enable = lib.mkEnableOption "the pi experiments extension (one fractional-factorial arm per main session; explore/exploit assignment, spawn inheritance for children)";

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
        Written to `<agentDir>/experiments/settings.json` when non-empty.
        Every key has a default in the package's core/settings.ts (`mode`,
        `factors`, `maxArms`, `minExplore`, `baseline`, `guards`,
        `correctionRegex`), so `{}` writes no file.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # (M4.13) Main session only: one arm per main session; children inherit
    # the parent's arm instead of drawing their own.
    programs.piEconomics.extensions.experiments = {
      path = "${cfg.package}";
      checkPath = ../packages/experiments/index.ts;
      forChildren = false;
      description = "One fractional-factorial arm per main session (explore/exploit assignment); children inherit the parent's arm, other extensions read the factor flags.";
    };

    # (M4.14) Literal text (spec §4).
    home.file."${pe.agentDir}/experiments/settings.json" =
      lib.mkIf (cfg.settings != {}) {text = builtins.toJSON cfg.settings;};

    # (M4.15) A soft dependency (spec §4.1): shell.ts tolerates a missing API.
    warnings = lib.optional (!pe.actorSubagents.enable) "pi-economics: experiments without actorSubagents loses arm inheritance by children (it reads spawn events from __subagentsApi_v1)";
  };
}
