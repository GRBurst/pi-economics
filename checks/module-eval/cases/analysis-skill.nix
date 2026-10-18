# Cases for modules/analysis-skill.nix (spec §4, §4.1).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  source = builtins.readFile (self + "/skills/pi-token-economics-analysis/SKILL.md");
  # dir: agentDir; meter: whether tokenMeter is enabled too.
  eval = dir: meter:
    hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        analysisSkill.enable = true;
        tokenMeter.enable = meter;
      };
    };
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  bare = hm.evalBare {};
  message = "pi-economics: analysisSkill requires tokenMeter (the skill runs pi-analyse and reads LOGS.md, which tokenMeter installs)";
in {
  # (M3.7) Off by default: no path, nothing rendered.
  analysis-skill-off = let
    c = hm.eval {};
  in
    eq "path" (pe c).analysisSkill.path null
    ++ eq "home.file targets" (targets c) (targets bare);

  # (M3.7) The text names the agent dir: every ~/.pi/agent becomes
  # ~/<agentDir>, and nothing else changes.
  analysis-skill-text = lib.concatMap (dir: let
    a = (pe (eval dir true)).analysisSkill;
  in
    holds "names ~/${dir}/LOGS.md" (lib.hasInfix "~/${dir}/LOGS.md" a.text)
    ++ holds "no other agent dir (${dir})" (dir == ".pi/agent" || !lib.hasInfix ".pi/agent" a.text)
    ++ eq "the rest unchanged (${dir})" (builtins.replaceStrings ["~/${dir}"] ["~/.pi/agent"] a.text) source
    ++ holds "frontmatter name (${dir})" (lib.elem "name: pi-token-economics-analysis" (lib.splitString "\n" a.text))
    ++ eq "path (${dir})" a.path "${a.package}"
    ++ eq "no file of its own (${dir})" (lib.sort lib.lessThan (targets (eval dir true)))
    (lib.sort lib.lessThan (targets (hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        tokenMeter.enable = true;
      };
    }))))
  dirs;

  # (M3.7) With the default agentDir the text is the source, byte for byte.
  analysis-skill-today = eq "text" (pe (eval ".pi/agent" true)).analysisSkill.text source;

  # (M3.8) The hard dependency (spec §4.1).
  analysis-skill-requires-meter =
    eq "without tokenMeter" (failed "pi-economics:" (eval ".pi/agent" false)) [message]
    ++ eq "with tokenMeter" (failed "" (eval ".pi/agent" true)) [];
}
