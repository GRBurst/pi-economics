# The bench (spec §7): pi-bench and bench-report on PATH, configured through
# session variables. Every option at its empty default exports nothing, and the
# bench keeps its own default for it (packages/bench/src/config.ts).
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.bench;
  agentSrc = "${config.home.homeDirectory}/${pe.agentDir}";
in {
  options.programs.piEconomics.bench = {
    enable = lib.mkEnableOption "the pi-bench harness (pi-bench, bench-report)";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/bench/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/bench/package.nix { }";
      description = "The bench; its tests run when it builds.";
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "${agentSrc}/bench";
      defaultText = lib.literalExpression ''"''${config.home.homeDirectory}/''${config.programs.piEconomics.agentDir}/bench"'';
      description = "Tasks, runs, judgements and reports (`PI_BENCH_DATA`).";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [cfg.package];
    home.sessionVariables = {
      PI_BENCH_DATA = cfg.dataDir;
      # Credentials, model definitions, the infinite-context settings and the
      # two AGENTS.md defaults come from here (spec §7, "Agent source").
      PI_BENCH_AGENT_SRC = agentSrc;
    };
  };
}
