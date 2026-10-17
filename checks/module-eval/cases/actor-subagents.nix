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

  # (M2.6) Off by default: no registry entry, no link.
  actor-subagents-off = let
    c = eval ".pi/agent" null;
  in
    holds "no registry entry" (!(pe c).extensions ? actor-subagents)
    ++ holds "no link" (!lib.elem ".pi/agent/extensions/actor-subagents" (targets c));

  # (M2.6) On: the registry entry and its link, following agentDir.
  actor-subagents-defaults = lib.concatMap (dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        actorSubagents.enable = true;
      };
    };
    a = (pe c).actorSubagents;
    e = (pe c).extensions.actor-subagents;
  in
    eq "registry entry (${dir})" {inherit (e) path checkPath input forChildren;} {
      path = "${a.package}/extensions/actor-subagents";
      checkPath = "${a.src}/extensions/actor-subagents/index.ts";
      input = "pi-actor-subagents";
      forChildren = false;
    }
    ++ holds "link target (${dir})" (lib.elem "${dir}/extensions/actor-subagents" (targets c))
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M2.6) The package is the flake's, and carries the spawn-policy API version
  # that taskRouter's assertion reads (spec §4.1).
  actor-subagents-package = let
    a = (pe (eval ".pi/agent" {})).actorSubagents;
  in
    eq "drvPath" a.package.drvPath self.packages.x86_64-linux.actor-subagents.drvPath
    ++ eq "spawnPolicyApi" (a.package.passthru.spawnPolicyApi or 0) 1;

  # (M2.6) The existence assertion probes the unpatched source and names the input.
  actor-subagents-missing = let
    c = eval ".pi/agent" {src = fx + "/ext-a";};
  in
    eq "failed assertions" (failed "pi-economics:" c) [
      "pi-economics: extension 'actor-subagents' not found at ${(pe c).extensions.actor-subagents.checkPath}; the pi-actor-subagents input may have renamed or removed it."
    ];

  # (M2.7) The settings file: written only while enabled, next to the link;
  # with no child registered, an empty list.
  actor-subagents-files =
    lib.concatMap (dir: let
      c = hm.eval {
        programs.piEconomics = {
          agentDir = dir;
          actorSubagents.enable = true;
        };
      };
    in
      eq "home.file targets (${dir})" (lib.sort lib.lessThan (targets c))
      (lib.sort lib.lessThan (targets bare ++ ["${dir}/extensions/actor-subagents" "${dir}/actor-subagents/settings.json"]))
      ++ eq "settings file (${dir})" (settingsText dir c) ''{"childExtensions":[]}'')
    dirs
    ++ eq "settings file while off" (settingsText ".pi/agent" (eval ".pi/agent" null)) null;

  # (M2.7) Today's file (host pi-extensions.nix:389-390): builtins.toJSON of
  # { childExtensions = <the children's link paths>; } and no other key.
  actor-subagents-today = let
    c = eval ".pi/agent" {};
    text = settingsText ".pi/agent" c;
  in
    eq "settings file" text (builtins.toJSON {childExtensions = (pe c).childExtensions;})
    ++ eq "keys" (
      if text == null
      then null
      else lib.attrNames (builtins.fromJSON text)
    ) ["childExtensions"];
}
