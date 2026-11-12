# The Nix route under real pi (AC15): the agent directory Home Manager
# renders for the home-files fixture (every component on) with the patched
# actor and the task router as pi-setup and the router's flake add them
# (registry entries of the pi-setup and pi-task-router inputs' packages;
# router-extraction design §7.3), each
# `home.file` under it linked as Home Manager links it, then `pi -p x` offline
# with the probe (./probe.ts). Every registry entry loads (pi prints each
# extension's factory under PI_TIMING=1; a factory that throws prints none),
# no load error, no duplicate or missing-actor warning of pi-economics or of
# the router (whose copy of the runtime guard shares the claim channel), the
# router's tool task_verdict exists, and experiments assigns an arm from the
# settings file the module writes (N4).
{
  lib,
  pkgs,
  hm,
  # pi-setup's patched actor-subagents as a registry entry (checks/default.nix).
  actorEntry,
  # The task router: its package (`package`) and its source tree (`src`),
  # which the existence assertion probes (a source path, not the build
  # output: no import-from-derivation).
  router,
}: let
  dir = ".pi/agent";
  # The home-files fixture's options for the default agentDir.
  c = hm.eval {
    programs.piEconomics = {
      agentDir = dir;
      tokenMeter.enable = true;
      analysisSkill.enable = true;
      cacheLifecycle.enable = true;
      experiments.enable = true;
      infiniteContext = {
        enable = true;
        reminders = {
          overrides."example/model-a" = {
            startTokens = 200000;
            everyTokens = 50000;
          };
          prices."example/model-a" = {
            w = 5;
            r = 0.2;
          };
        };
      };
      retry.enable = true;
      extensions.actor-subagents = actorEntry;
      extensions.task-router = {
        path = "${router.package}";
        checkPath = "${router.src}/packages/task-router/index.ts";
        forChildren = false;
        description = "the task router (pi-task-router)";
      };
    };
  };
  files = lib.filter (f: lib.hasPrefix "${dir}/" f.target) (lib.attrValues c.home.file);
  links =
    lib.concatMapStrings (f: ''
      mkdir -p "$HOME/$(dirname ${lib.escapeShellArg f.target})"
      ln -s ${f.source} "$HOME/"${lib.escapeShellArg f.target}
    '')
    files;
  names = lib.attrNames c.programs.piEconomics.extensions;
in
  pkgs.runCommand "nix-route-smoke" {nativeBuildInputs = [pkgs.pi-coding-agent pkgs.jq pkgs.coreutils pkgs.gnugrep];} ''
    export HOME=$PWD/home PI_CODING_AGENT_DIR=$PWD/home/${dir} PI_OFFLINE=1 PI_TIMING=1 PROBE_OUT=$PWD/probe.json
    ${links}
    fail() {
      echo "nix-route-smoke: $*" >&2
      cat run.all >&2
      exit 1
    }
    rc=0
    pi -p x --no-session -e ${./probe.ts} </dev/null >run.out 2>run.err || rc=$?
    cat run.out run.err >run.all
    grep -qF 'No API key found' run.all || fail "pi did not reach the model call"
    [ "$rc" = 1 ] || fail "pi -p exited $rc, expected 1"
    # `! grep` is exempt from errexit: use `if`
    if grep -qF 'Failed to load extension' run.all; then fail "an extension failed to load"; fi
    # an install runs at session_start (runtime-guard.ts): its throw prints `Extension error (<path>): ...`, not a load error
    if grep -qF 'Extension error' run.all; then fail "an extension's install threw"; fi
    grep -qF "Startup Timings: extensions" run.all || fail "pi printed no PI_TIMING block: the factory-line marker is pi 1.4's (did pkgs.pi-coding-agent move?)"
    if grep -qF 'loaded twice' run.all; then fail "a pi-economics component is loaded twice"; fi
    if grep -qF 'needs pi-actor-subagents' run.all; then fail "a component misses the actor's API"; fi
    for n in ${lib.escapeShellArgs names}; do
      grep -F "$PI_CODING_AGENT_DIR/extensions/$n/" run.all | grep -qF ' factory: ' || fail "the extension $n did not load"
    done
    [ -f probe.json ] || fail "the probe wrote nothing"
    jq -e '.tools | index("task_verdict") != null' probe.json >/dev/null || fail "no task_verdict among the tools: $(cat probe.json)"
    jq -e '.active | index("task_verdict") != null' probe.json >/dev/null || fail "task_verdict is registered but not active: $(cat probe.json)"
    echo "loaded: ${toString names}"
    # N4 (spec D15): the module writes experiments' opt-in file, so experiments assigns under the Nix route
    [ -e "$PI_CODING_AGENT_DIR/experiments/settings.json" ] || fail "no experiments/settings.json under the Nix route"
    [ -e "$PI_CODING_AGENT_DIR/experiments/assignments.jsonl" ] || fail "experiments assigned no arm under the Nix route"
    touch $out
  ''
