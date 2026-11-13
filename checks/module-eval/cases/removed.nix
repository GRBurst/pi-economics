# Options that left this flake (modules/removed.nix; router-extraction design
# §7.3, Q4): each is a hidden stub that, when defined, fails one assertion
# naming the new home and does nothing else. A definition under `lib.mkIf
# false` is none: pi-setup's economics bridge before the router left wrote the
# router's settings only while a local health URL was set, and evaluates
# without one; a consumer's guarded leftover of the actor evaluates alike.
# `retry` left the flake (redesign D19, P16): pi's native retry replaces it.
{
  lib,
  hm,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  # A value, or a marker when evaluating it fails (a case reports, never aborts the check).
  safe = v: let
    r = builtins.tryEval (builtins.deepSeq v v);
  in
    if r.success
    then r.value
    else "<evaluation failed>";
  bare = hm.eval {};
  messages = {
    taskRouter = "pi-economics: programs.piEconomics.taskRouter moved to the pi-task-router flake (programs.piTaskRouter)";
    actorSubagents = "pi-economics: programs.piEconomics.actorSubagents moved to pi-setup (programs.pi.actorSubagents)";
    retry = "pi-economics: programs.piEconomics.retry was removed; pi's native retry (settings retry.*) handles transient errors";
  };
  # The bridge's router part (pi-setup `main`, modules/home-manager/economics-bridge.nix), the URL as an argument.
  oldBridge = url: {lib, ...}: {
    config = lib.mkMerge [
      (lib.mkIf (url != null) {
        programs.piEconomics.taskRouter.settings.models.qwen-local.health = url;
      })
    ];
  };
  # A consumer's actor definition under a condition.
  guardedActor = cond: {lib, ...}: {
    config = lib.mkIf cond {programs.piEconomics.actorSubagents.enable = true;};
  };
  defined = {
    taskRouter = {
      enable = {enable = true;};
      off = {enable = false;};
      nested = {settings.models.qwen-local.health = "http://localhost:11545";};
      bare-value = true;
    };
    actorSubagents = {
      enable = {enable = true;};
      off = {enable = false;};
      nested = {settings.maxAgents = 4;};
      bare-value = true;
    };
    retry = {
      enable = {enable = true;};
      off = {enable = false;};
      nested = {settings.baseDelayMs = 2000;};
      bare-value = true;
    };
  };
  one = name: what: d: let
    c = hm.eval {programs.piEconomics.${name} = d;};
  in
    eq "defined (${what}): the one failure" (safe (failed "pi-economics:" c)) [messages.${name}]
    ++ eq "defined (${what}): no registry entry" (safe (lib.attrNames (pe c).extensions)) (lib.attrNames (pe bare).extensions)
    ++ eq "defined (${what}): no file" (safe (lib.attrNames c.home.file)) (lib.attrNames bare.home.file);
  stub = name:
    lib.concatLists (lib.mapAttrsToList (one name) defined.${name})
    ++ holds "hidden from the option docs" (safe ((hm.options {}).programs.piEconomics.${name}.visible or null) == false);
in {
  removed-task-router =
    stub "taskRouter"
    ++ eq "the old bridge with a URL: the one failure" (safe (failed "pi-economics:" (hm.eval (oldBridge "http://localhost:11545")))) [messages.taskRouter]
    ++ eq "the old bridge without a URL: no failure" (safe (failed "" (hm.eval (oldBridge null)))) []
    ++ eq "not defined: no failure" (safe (failed "" bare)) [];

  removed-actor-subagents =
    stub "actorSubagents"
    ++ eq "a guarded definition, condition true: the one failure" (safe (failed "pi-economics:" (hm.eval (guardedActor true)))) [messages.actorSubagents]
    ++ eq "a guarded definition, condition false: no failure" (safe (failed "" (hm.eval (guardedActor false)))) [];

  removed-retry = stub "retry";
}
