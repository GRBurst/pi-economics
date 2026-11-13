# Options that left this flake (router-extraction design §7.3, Q4; `retry`:
# redesign D19, P16). Each is a hidden stub: defined, it fails one assertion
# naming the new home or the replacement, and it does nothing else. A
# definition under `lib.mkIf false` is none, so a consumer's guarded leftover
# (pi-setup's economics bridge before the router left, without a local health
# URL) still evaluates.
{
  lib,
  options,
  ...
}: let
  removed = {
    taskRouter = "pi-economics: programs.piEconomics.taskRouter moved to the pi-task-router flake (programs.piTaskRouter)";
    actorSubagents = "pi-economics: programs.piEconomics.actorSubagents moved to pi-setup (programs.pi.actorSubagents)";
    # pi-retry served OpenRouter's free tier, which is gone; pi retries
    # transient errors itself.
    retry = "pi-economics: programs.piEconomics.retry was removed; pi's native retry (settings retry.*) handles transient errors";
  };
in {
  options.programs.piEconomics = lib.mapAttrs (_: message:
    lib.mkOption {
      type = lib.types.anything;
      visible = false;
      description = message;
    })
  removed;

  config.assertions =
    lib.mapAttrsToList (name: message: {
      # Reads whether the option is defined, never its value.
      assertion = !options.programs.piEconomics.${name}.isDefined;
      inherit message;
    })
    removed;
}
