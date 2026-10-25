# Every component together (spec §8.1): enabling them all renders the union of
# what each renders alone, with no failed assertion and no warning. A milestone
# adds its component to `components`.
{
  lib,
  hm,
  expect,
}: let
  inherit (expect) eq failed;
  components = ["bench" "actorSubagents" "tokenMeter" "analysisSkill"];
  with' = cs: hm.eval {programs.piEconomics = lib.genAttrs cs (_: {enable = true;});};
  set = l: lib.sort lib.lessThan (lib.unique l);
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  # hm-session-vars.sh is built from the session variables, compared below.
  packages = cfg: lib.filter (p: !lib.hasSuffix "-hm-session-vars.sh" p) (map toString cfg.home.packages);
  union = f: set (lib.concatMap (c: f (with' [c])) components);
  all = with' components;
in {
  components-together =
    eq "home.file targets" (set (targets all)) (union targets)
    ++ eq "home.packages" (set (packages all)) (union packages)
    ++ eq "session variables" all.home.sessionVariables (lib.foldl' (acc: c: acc // (with' [c]).home.sessionVariables) {} components)
    ++ eq "failed assertions" (failed "" all) []
    ++ eq "warnings" all.warnings (hm.evalBare {}).warnings;
}
