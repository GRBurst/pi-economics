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
  # (M5.12) The router's keys that say which models exist and where to reach
  # them (spec §7), in R's schema and in the legacy forms its loader still
  # maps (core/settings.ts); `contextFit` too, since the context filter picks
  # among the models by it (plan router-g3-g7, D15).
  routerModelKeys = ["models" "queueMaxSec" "contextFit" "localHealthUrl" "cloudDailyCap" "contextWindow"];
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

    # (M1.6)
    workDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Checkouts and caches (`PI_BENCH_WORK`). `null` exports nothing: the
        bench then uses `$XDG_RUNTIME_DIR/pi/tmp/bench`, or `/tmp/pi/tmp/bench`
        without `XDG_RUNTIME_DIR`.
      '';
    };

    # (M1.7)
    extensions = lib.mkOption {
      type = lib.types.attrsOf lib.types.path;
      default = {};
      example = lib.literalExpression ''{ claude-auth = "''${pi-claude-auth}"; }'';
      description = ''
        The extensions a bench arm loads, by the name the arm uses. Data, not
        the registry: the arms load extensions the registry does not hold, and
        leave out some it does. Exported as a directory of links
        (`PI_BENCH_EXT_DIR`). Defined by default, one `mkDefault` each, for the
        flake's packages the bench loads by name: `actor-subagents`,
        `infinite-context`, `pi-retry`, `task-router`, `token-meter`. A definition adds names
        or replaces one; `lib.mkForce {}` exports nothing, and the bench then
        looks the names up in `~/.pi/agent/extensions`.
      '';
    };

    # (M1.8)
    router = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      description = ''
        The base of the `task-router/settings.json` an orchestrator arm writes;
        the arm's own keys (`routing`, `delegation`, `t0Limits`) are merged over
        it as `lib.recursiveUpdate` does. Exported as a JSON file
        (`PI_BENCH_ROUTER`, made with `builtins.toFile`, so no value may carry
        a store path's context); `{}` exports nothing, and an arm's file is the
        arm's keys alone.
        While taskRouter is enabled it is defined, one `mkDefault` per key, as
        the keys of taskRouter.settings that name the models and where to reach
        them (`models`, `queueMaxSec`, `contextFit`, `localHealthUrl`,
        `cloudDailyCap`, `contextWindow`) with `randomize.enabled` and
        `spotCheck.enabled` forced to `false`.
      '';
    };

    # (M1.6)
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
    # (M6.14) The flake's packages that the bench loads by name (spec §7), one
    # mkDefault definition each: a host adds its own extensions beside them
    # (claude-auth, web-search) and may replace one by name.
    programs.piEconomics.bench.extensions = lib.mapAttrs (_: lib.mkDefault) {
      actor-subagents = "${pe.actorSubagents.package}/extensions/actor-subagents";
      infinite-context = "${pe.infiniteContext.package}/extensions/infinite-context";
      pi-retry = "${pe.retry.package}";
      token-meter = "${pe.tokenMeter.package}";
      task-router = "${pe.taskRouter.package}"; # (M5.13)
    };
    # (M5.12) The arms run on the models the host configures, never with its
    # randomization or spot checks (spec §7).
    programs.piEconomics.bench.router = lib.mkIf pe.taskRouter.enable (lib.mapAttrs (_: lib.mkDefault) (lib.recursiveUpdate
      (lib.filterAttrs (n: _: lib.elem n routerModelKeys) pe.taskRouter.settings)
      {
        randomize.enabled = false;
        spotCheck.enabled = false;
      }));
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
      // lib.optionalAttrs (cfg.router != {}) {
        PI_BENCH_ROUTER = builtins.toFile "pi-bench-router.json" (builtins.toJSON cfg.router);
      }
      // lib.optionalAttrs (cfg.agentsBaseline != null) {PI_BENCH_AGENTS_OFF = cfg.agentsBaseline;};
  };
}
