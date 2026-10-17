# Cases for modules/actor-subagents.nix and the registry's childExtensions
# (spec §4, §4.1, §5.1).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  fx = ../fixtures;
  # Two children, out of name order, and one entry withheld from them.
  registry = {
    zeta = {
      path = fx + "/ext-a";
      forChildren = true;
      description = "fixture zeta";
    };
    alpha = {
      path = fx + "/ext-b";
      forChildren = true;
      description = "fixture alpha";
    };
    mid = {
      path = fx + "/ext-a";
      forChildren = false;
      description = "fixture mid";
    };
  };
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; as: actorSubagents options, null = not enabled.
  eval = dir: as:
    hm.eval {
      programs.piEconomics =
        {
          agentDir = dir;
          extensions = registry;
        }
        // lib.optionalAttrs (as != null) {actorSubagents = {enable = true;} // as;};
    };
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  # The text of the file at target, null when there is none.
  textAt = target: cfg: let
    fs = lib.filter (f: f.target == target) (lib.attrValues cfg.home.file);
  in
    if fs == []
    then null
    else (lib.head fs).text;
  settingsText = dir: textAt "${dir}/actor-subagents/settings.json";
  bare = hm.evalBare {};
in {
  # (M2.5) The registry's children: link paths of the forChildren entries,
  # sorted by name, whether or not actorSubagents is enabled.
  child-extensions = lib.concatMap (dir: let
    c = eval dir null;
    kids = (pe c).childExtensions;
  in
    eq "childExtensions (${dir})" kids ["/home/u/${dir}/extensions/alpha" "/home/u/${dir}/extensions/zeta"]
    ++ holds "every child is a link the registry renders (${dir})"
    (lib.all (p: lib.elem p (map (t: "${c.home.homeDirectory}/${t}") (targets c))) kids)
    ++ eq "names from the last path component (${dir})" (map (p: lib.last (lib.splitString "/" p)) kids) ["alpha" "zeta"])
  dirs;
}
