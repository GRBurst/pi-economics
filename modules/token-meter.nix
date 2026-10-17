# The token meter (spec §2, §4): one JSONL line per provider request (tokens,
# cost, quota) under <agentDir>/meter, loaded into children too; the reports
# meter-report and pi-analyse on PATH, and LOGS.md, the manual of every log
# pi-analyse reads.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.tokenMeter;
in {
  options.programs.piEconomics.tokenMeter = {
    enable = lib.mkEnableOption "the pi token-meter extension (per-request token, cost and quota log) and its reports";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/token-meter/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/token-meter/package.nix { }";
      description = ''
        The extension (package.json, index.ts, core/, LOGS.md); its tests run
        when it builds. `passthru.report` and `passthru.analyse` are the
        commands put on PATH (`meter-report`, `pi-analyse`).
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # (M3.3) Loaded into children too: their requests are what the meter is for.
    programs.piEconomics.extensions.token-meter = {
      path = "${cfg.package}";
      # The source, not the package: probing a build output would be
      # import-from-derivation.
      checkPath = ../packages/token-meter/index.ts;
      forChildren = true;
      description = "Appends one JSONL line per provider request (tokens, cost, quota headers, retries) to <agentDir>/meter/YYYY-MM.jsonl; no prompt or response text.";
    };

    # (M3.4)
    home.packages = [cfg.package.report cfg.package.analyse];
    home.file."${pe.agentDir}/LOGS.md".source = "${cfg.package}/LOGS.md";
  };
}
