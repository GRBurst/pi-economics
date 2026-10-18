# The agent skill pi-token-economics-analysis (spec §2, §4.1): instructions
# that drive pi-analyse and read LOGS.md. The component writes no file; it
# exports `path`, a skill directory the consumer links into its skills
# directories. Its text names the agent dir, substituted from agentDir.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.analysisSkill;
  source = builtins.readFile ../skills/pi-token-economics-analysis/SKILL.md;
in {
  options.programs.piEconomics.analysisSkill = {
    enable = lib.mkEnableOption "the agent skill pi-token-economics-analysis (requires tokenMeter)";

    text = lib.mkOption {
      type = lib.types.str;
      readOnly = true;
      internal = true;
      description = "SKILL.md as rendered: every `~/.pi/agent` replaced by `~/<agentDir>` (read by the checks).";
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeTextFile {
        name = "pi-token-economics-analysis";
        destination = "/SKILL.md";
        inherit (cfg) text;
      };
      defaultText = lib.literalExpression ''pkgs.writeTextFile { name = "pi-token-economics-analysis"; destination = "/SKILL.md"; text = <SKILL.md for agentDir>; }'';
      description = "The skill directory (SKILL.md at its root).";
    };

    path = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      readOnly = true;
      description = ''
        The skill directory to link as `<skills dir>/pi-token-economics-analysis`
        (the frontmatter `name`), or `null` while the component is disabled.
      '';
    };
  };

  config = {
    programs.piEconomics.analysisSkill = {
      text = builtins.replaceStrings ["~/.pi/agent"] ["~/${pe.agentDir}"] source;
      path =
        if cfg.enable
        then "${cfg.package}"
        else null;
    };
  };
}
