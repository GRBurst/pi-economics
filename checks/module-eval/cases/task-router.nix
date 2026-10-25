# Cases for modules/task-router.nix (spec §4, §4.1, §5.1, §6.2).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  # tr: taskRouter options, null = not enabled; more: other options.
  eval = dir: tr: more:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (tr != null) {taskRouter = {enable = true;} // tr;}
        // more;
    };
  withActor = {actorSubagents.enable = true;};
  sorted = lib.sort lib.lessThan;
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  bare = hm.evalBare {};
  message = "pi-economics: taskRouter requires actorSubagents with passthru.spawnPolicyApi >= 1 (the router registers through registerSpawnPolicy, and shell.ts swallows its absence: without the patched build the router does nothing)";
in {
  # (M5.8) Off by default: no registry entry, no file.
  task-router-off = let
    c = eval ".pi/agent" null {};
  in
    holds "no registry entry" (!(pe c).extensions ? task-router)
    ++ eq "home.file targets" (targets c) (targets bare);

  # (M5.8) On, with actorSubagents: the entry (main session only), the link
  # following agentDir, the flake's package, no settings file.
  task-router-defaults = lib.concatMap (dir: let
    c = eval dir {} withActor;
    e = (pe c).extensions.task-router;
    actorOnly = hm.eval {programs.piEconomics = {agentDir = dir;} // withActor;};
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).taskRouter.package}";
      input = null;
      forChildren = false;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/task-router/index.ts" (toString e.checkPath))
    ++ eq "children (${dir})" (lib.filter (lib.hasSuffix "/task-router") (pe c).childExtensions) []
    ++ eq "home.file targets (${dir})" (sorted (targets c)) (sorted (targets actorOnly ++ ["${dir}/extensions/task-router"]))
    ++ eq "drvPath (${dir})" (pe c).taskRouter.package.drvPath self.packages.x86_64-linux.task-router.drvPath
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings actorOnly.warnings)
  dirs;
}
