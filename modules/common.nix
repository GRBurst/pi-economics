# Shared by every component (spec §4, §5.1, §5.4):
#  - agentDir: pi's agent directory, relative to home;
#  - extensions: the extension registry, rendered as links and existence
#    assertions (childExtensions follows in M2, with actorSubagents);
#  - piSettings: leaf edits of pi's mutable settings.json, contributed per
#    component under ops.<contributor> and run by one activation entry.
{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.programs.piEconomics;
in {
  options.programs.piEconomics = {
    # (M0.7)
    agentDir = lib.mkOption {
      type = lib.types.strMatching "[^/](.*[^/])?";
      default = ".pi/agent";
      description = ''
        pi's agent directory, relative to home, without a leading or trailing
        slash. pi's PI_CODING_AGENT_DIR is not modelled: a host that moves the
        agent directory sets this option.
      '';
    };
  };

  config = {};
}
