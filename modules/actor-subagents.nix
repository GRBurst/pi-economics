# pi-actor-subagents (spec §2, §4): background agents spawned and supervised
# from a pi session. The upstream extension with three local patches
# (packages/actor-subagents/package.nix), linked through the registry, and its
# settings file, the one place children's extensions are named.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.actorSubagents;
in {
  options.programs.piEconomics.actorSubagents = {
    enable = lib.mkEnableOption "pi-actor-subagents, background agents spawned and supervised from a pi session";

    src = lib.mkOption {
      type = lib.types.path;
      internal = true;
      description = ''
        The unpatched upstream source. The flake's homeModules.default sets it
        from its input `pi-actor-subagents`; the registry's existence assertion
        probes it.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/actor-subagents/package.nix {inherit (cfg) src;};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/actor-subagents/package.nix { src = <input pi-actor-subagents>; }";
      description = ''
        The patched extension source (`extensions/actor-subagents`).
        `passthru.spawnPolicyApi` is the version of `globalThis.__subagentsApi_v1`
        it provides (1: the spawn-policy patch); taskRouter requires it.
      '';
    };

    # (M2.8)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {
        maxAgents = 4;
        errorNoticeGraceMs = 0;
      };
      description = ''
        Merged into `<agentDir>/actor-subagents/settings.json`, which the
        extension reads on every spawn (upstream keys: `maxAgents`,
        `maxSpawnDepth`, `errorNoticeGraceMs`). `childExtensions` is rendered
        from the registry (`extensions.<name>.forChildren`) and must not be set
        here: doing so is an assertion error.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # The registry owns childExtensions (spec §4): no silent override.
    assertions = [
      {
        assertion = !(cfg.settings ? childExtensions);
        message = "pi-economics: programs.piEconomics.actorSubagents.settings.childExtensions is set; the registry owns that key (extensions.<name>.forChildren).";
      }
    ];

    programs.piEconomics.extensions.actor-subagents = {
      path = "${cfg.package}/extensions/actor-subagents";
      checkPath = "${cfg.src}/extensions/actor-subagents/index.ts";
      input = "pi-actor-subagents";
      # Withheld from children on upstream's advice: children already receive
      # the orchestration tools through pi's customTools, and loading the
      # extension again would put the swarm UI and status panel into headless
      # children.
      forChildren = false;
      description = "Spawns and supervises background agents from the session, with a live status panel: spawn_subagent, send_message, set_agent_model, list_agents, kill_agent, agent_history, set_status, resume_agents, plus the /agents* commands. Swarms persist beside the main session.";
    };

    # (M2.7, M2.8) One writer (spec §5.1). Literal text, so checks read it with
    # fromJSON (spec §4). The registry's childExtensions on the right: the
    # registry owns that key.
    home.file."${pe.agentDir}/actor-subagents/settings.json".text =
      builtins.toJSON (lib.recursiveUpdate cfg.settings {inherit (pe) childExtensions;});
  };
}
