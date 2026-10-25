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

  # (M5.9) settings: written as given under agentDir (the host's check value,
  # checks/pi-extensions.nix:64); {} writes nothing.
  task-router-settings = lib.concatMap (dir: let
    s = {cloudDailyCap = 500;};
    f = fileAt "${dir}/task-router/settings.json" (eval dir {settings = s;} withActor);
  in
    eq "settings file (${dir})" (builtins.fromJSON f.text) s
    ++ eq "no file for {} (${dir})" (fileAt "${dir}/task-router/settings.json" (eval dir {} withActor)) null)
  dirs;

  # (M5.10) The hard dependency (spec §4.1), both halves.
  task-router-requires-actor-subagents =
    eq "assertions" (failed "pi-economics: taskRouter" (eval ".pi/agent" {} {})) [message];
  task-router-requires-spawn-policy-api = eq "assertions" (failed "pi-economics: taskRouter" (eval ".pi/agent" {} {
    actorSubagents = {
      enable = true;
      # A package without passthru.spawnPolicyApi (the router's own).
      package = self.packages.x86_64-linux.task-router;
    };
  })) [message];

  # (M5.14) The host's combination from W4 on (spec §9.1): M6's m6-host-like
  # (D16 there) plus taskRouter with the host's settings
  # (homes/pallon/default.nix:197-209). The router is main-session only, so the
  # children stay M6's four.
  m5-host-like = let
    host = {
      randomize = {
        enabled = true;
        share = 0.2;
      };
      spotCheck = {
        enabled = true;
        share = 0.1;
      };
    };
    c = hm.eval {
      programs.piEconomics = {
        actorSubagents.enable = true;
        tokenMeter.enable = true;
        cacheLifecycle.enable = true;
        experiments.enable = true;
        infiniteContext.enable = true;
        retry.enable = true;
        taskRouter = {
          enable = true;
          settings = host;
        };
        piSettings.enable = false;
      };
    };
  in
    eq "children" (map baseNameOf (builtins.fromJSON (fileAt ".pi/agent/actor-subagents/settings.json" c).text).childExtensions) ["cache-lifecycle" "infinite-context" "pi-retry" "token-meter"]
    ++ eq "links" (sorted (lib.filter (lib.hasPrefix ".pi/agent/extensions/") (targets c)))
    (map (n: ".pi/agent/extensions/${n}") ["actor-subagents" "cache-lifecycle" "experiments" "infinite-context" "pi-retry" "task-router" "token-meter"])
    ++ eq "task-router/settings.json" (builtins.fromJSON (fileAt ".pi/agent/task-router/settings.json" c).text) host
    ++ eq "failed assertions" (failed "" c) []
    ++ eq "warnings" c.warnings bare.warnings;
}
