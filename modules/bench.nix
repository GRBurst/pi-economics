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

    workDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Checkouts and caches (`PI_BENCH_WORK`). `null` exports nothing: the
        bench then uses `$XDG_RUNTIME_DIR/pi/tmp/bench`, or `/tmp/pi/tmp/bench`
        without `XDG_RUNTIME_DIR`.
      '';
    };

    extensions = lib.mkOption {
      type = lib.types.attrsOf lib.types.path;
      default = {};
      example = lib.literalExpression ''{ claude-auth = "''${pi-claude-auth}"; }'';
      description = ''
        The extensions a bench arm loads, by the name the arm uses. Data, not
        the registry: the arms load extensions the registry does not hold, and
        leave out some it does. Exported as a directory of links
        (`PI_BENCH_EXT_DIR`); `{}` exports nothing, and the bench looks the
        names up in `~/.pi/agent/extensions`.
      '';
    };

    agentsBaseline = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        The AGENTS.md of the arms without routing (`PI_BENCH_AGENTS_OFF`).
        `null` exports nothing: the bench then uses its default under the agent
        source.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [cfg.package];
    home.sessionVariables =
      {
        PI_BENCH_DATA = cfg.dataDir;
        # Credentials, model definitions, the infinite-context settings and the
        # two AGENTS.md defaults come from here (spec §7, "Agent source").
        PI_BENCH_AGENT_SRC = agentSrc;
      }
      // lib.optionalAttrs (cfg.workDir != null) {PI_BENCH_WORK = cfg.workDir;}
      // lib.optionalAttrs (cfg.extensions != {}) {
        PI_BENCH_EXT_DIR = "${pkgs.linkFarm "pi-bench-extensions" cfg.extensions}";
      }
      // lib.optionalAttrs (cfg.agentsBaseline != null) {PI_BENCH_AGENTS_OFF = cfg.agentsBaseline;};
  };
}
