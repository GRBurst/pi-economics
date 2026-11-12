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
  # The consumer's own extensions, by the options that list them and the
  # variables they are exported as (comma-separated, so a name has no comma; the
  # bench trims each entry, so none has white space either).
  nameLists = {
    baseExtensions = "PI_BENCH_BASE_EXTENSIONS";
    orchExtensions = "PI_BENCH_ORCH_EXTENSIONS";
  };
  nameList = lib.types.listOf (lib.types.strMatching "[^,[:space:]]+");
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
      example = lib.literalExpression ''{ my-login = "''${my-login-extension}/src"; }'';
      description = ''
        The extensions a bench arm loads, by the name the arm uses. Data, not
        the registry: the arms load extensions the registry does not hold, and
        leave out some it does. Exported as a directory of links
        (`PI_BENCH_EXT_DIR`). Defined by default, one `mkDefault` each, for the
        flake's packages the bench loads by name: `actor-subagents`,
        `infinite-context`, `pi-retry`, `task-router`, `token-meter`. A definition adds names
        or replaces one; `lib.mkForce {}` exports nothing, and the bench then
        looks the names up in `~/.pi/agent/extensions`.
        A name missing here fails its arm at run time (the link does not
        exist): your own extensions, named in `baseExtensions`,
        `orchExtensions` or an arm of `<data>/arms.json`, need a definition
        here.
      '';
    };

    baseExtensions = lib.mkOption {
      type = nameList;
      default = [];
      example = ["my-login"];
      description = ''
        Names from `extensions` that every run loads: every arm, the
        factor arms' children, every judge (the children of the smoke arm `orch`
        use the live agent directory's settings instead). The arms name only this
        flake's extensions; your own come in here, such as your provider login
        extension, if your pi needs one (the bench does not check: an arm
        without it runs as your pi does without it). Loaded first, before an
        arm's own names; each name once.
        Exported comma-separated (`PI_BENCH_BASE_EXTENSIONS`); `[]` exports
        nothing. Each name must be defined in `extensions` (an assertion),
        unless `extensions` is empty and the names resolve in
        `~/.pi/agent/extensions`.
      '';
    };

    orchExtensions = lib.mkOption {
      type = nameList;
      default = [];
      example = ["my-search"];
      description = ''
        Names from `extensions` that the orchestrator factor arms (the arms
        with factors, `orch-<signs>`) and their children load as well, after
        the base extensions and the orchestrator's own list; never the print
        arms, the smoke arm `orch` or the judges. For your own tools the
        orchestrator's setup has and a single-agent arm should not, such as a
        search tool. Each name once. Exported comma-separated
        (`PI_BENCH_ORCH_EXTENSIONS`); `[]` exports nothing. Each name must be
        defined in `extensions`, as for `baseExtensions`.
      '';
    };

    # (M1.8)
    router = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      description = ''
        An override of the base of the `task-router/settings.json` an
        orchestrator arm writes. The bench reads that base at run time from the
        live router settings (`<agent source>/task-router/settings.json`): the
        keys that name the models and where to reach them (`models`,
        `queueMaxSec`, `contextFit`, `localHealthUrl`, `cloudDailyCap`,
        `contextWindow`), with `randomize.enabled` and `spotCheck.enabled` set
        to `false`; without that file the base is empty. This override is
        merged over the base, and the arm's own keys (`routing`, `delegation`,
        `t0Limits`) over both, as `lib.recursiveUpdate` does: a definition of
        one leaf (`router.models.<m>.model`) replaces that leaf only.
        Exported as a JSON file (`PI_BENCH_ROUTER`, made with `builtins.toFile`,
        so no value may carry a store path's context); `{}` exports nothing.
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
    # A listed name has no link to load unless `extensions` defines it; with
    # no link farm the bench looks the names up in ~/.pi/agent/extensions,
    # which evaluation cannot see.
    assertions =
      lib.mapAttrsToList (opt: _: let
        missing = lib.filter (n: !(cfg.extensions ? ${n})) cfg.${opt};
      in {
        assertion = cfg.extensions == {} || missing == [];
        message = "pi-economics: programs.piEconomics.bench.${opt} names ${lib.concatStringsSep ", " missing}, which programs.piEconomics.bench.extensions does not define (the runs load each from the link of that name: define it there or leave it out)";
      })
      nameLists;
    # (M6.14) The flake's packages that the bench loads by name (spec §7), one
    # mkDefault definition each: a consumer adds its own extensions beside them
    # (for `baseExtensions`, `orchExtensions`) and may replace one by name.
    programs.piEconomics.bench.extensions = lib.mapAttrs (_: lib.mkDefault) {
      actor-subagents = "${pe.actorSubagents.package}/extensions/actor-subagents";
      infinite-context = "${pe.infiniteContext.package}/extensions/infinite-context";
      pi-retry = "${pe.retry.package}";
      token-meter = "${pe.tokenMeter.package}";
      task-router = "${pe.taskRouter.package}"; # (M5.13)
    };
    home.sessionVariables =
      {
        PI_BENCH_DATA = cfg.dataDir;
        # Credentials, model definitions, the infinite-context settings and the
        # two AGENTS.md defaults come from here (spec §7, "Agent source").
        PI_BENCH_AGENT_SRC = agentSrc;
      }
      // lib.optionalAttrs (cfg.workDir != null) {PI_BENCH_WORK = cfg.workDir;}
      // lib.concatMapAttrs (opt: var: lib.optionalAttrs (cfg.${opt} != []) {${var} = lib.concatStringsSep "," cfg.${opt};}) nameLists
      // lib.optionalAttrs (cfg.extensions != {}) {
        PI_BENCH_EXT_DIR = "${pkgs.linkFarm "pi-bench-extensions" cfg.extensions}";
      }
      // lib.optionalAttrs (cfg.router != {}) {
        PI_BENCH_ROUTER = builtins.toFile "pi-bench-router.json" (builtins.toJSON cfg.router);
      }
      // lib.optionalAttrs (cfg.agentsBaseline != null) {PI_BENCH_AGENTS_OFF = cfg.agentsBaseline;};
  };
}
