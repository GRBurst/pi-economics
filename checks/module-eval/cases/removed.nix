# Options that left this flake (modules/removed.nix; router-extraction design
# §7.3, Q4): each is a hidden stub that, when defined, fails one assertion
# naming the new home and does nothing else. A definition under `lib.mkIf
# false` is none: pi-setup's economics bridge before the router left wrote the
# router's settings only while a local health URL was set, and evaluates
# without one.
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
  message = "pi-economics: programs.piEconomics.taskRouter moved to the pi-task-router flake (programs.piTaskRouter)";
  # The bridge's router part (pi-setup `main`, modules/home-manager/economics-bridge.nix), the URL as an argument.
  oldBridge = url: {lib, ...}: {
    config = lib.mkMerge [
      (lib.mkIf (url != null) {
        programs.piEconomics.taskRouter.settings.models.qwen-local.health = url;
      })
    ];
  };
  defined = {
    enable = {enable = true;};
    off = {enable = false;};
    nested = {settings.models.qwen-local.health = "http://localhost:11545";};
    bare-value = true;
  };
  one = what: d: let
    c = hm.eval {programs.piEconomics.taskRouter = d;};
  in
    eq "defined (${what}): the one failure" (safe (failed "pi-economics:" c)) [message]
    ++ eq "defined (${what}): no registry entry" (safe (lib.attrNames (pe c).extensions)) (lib.attrNames (pe bare).extensions)
    ++ eq "defined (${what}): no file" (safe (lib.attrNames c.home.file)) (lib.attrNames bare.home.file);
  visible = safe ((hm.options {}).programs.piEconomics.taskRouter.visible or null);
in {
  removed-task-router =
    lib.concatLists (lib.mapAttrsToList one defined)
    ++ eq "the old bridge with a URL: the one failure" (safe (failed "pi-economics:" (hm.eval (oldBridge "http://localhost:11545")))) [message]
    ++ eq "the old bridge without a URL: no failure" (safe (failed "" (hm.eval (oldBridge null)))) []
    ++ eq "not defined: no failure" (safe (failed "" bare)) []
    ++ holds "hidden from the option docs" (visible == false);
}
