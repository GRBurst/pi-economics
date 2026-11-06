# The package next to the patched actor (AC5, plan T3.6): with
# __subagentsApi_v1 loaded, after the package in load order, no component
# warns and the router registers task_verdict at session_start (the probe,
# ./probe.ts, lists the tools at session_shutdown).
{
  installed,
  # The patched pi-actor-subagents (the flake's package); a copy is installed.
  actor,
}:
installed {
  name = "pi-install-actor";
  before = ''
    cp -r ${actor} actor
    chmod -R u+w actor
    pi install ./actor >actor.log 2>&1 || { cat actor.log >&2; fail "pi install ./actor failed"; }
  '';
  runArgs = "-e ${./probe.ts}";
  after = ''
    loaded "$PWD/actor/extensions/actor-subagents/index.ts" || fail "the actor did not load"
    if grep -qF 'needs pi-actor-subagents' run.all; then fail "a component misses the actor's API"; fi
    [ -f probe.json ] || fail "the probe wrote nothing"
    jq -e '.tools | index("task_verdict") != null' probe.json >/dev/null || fail "no task_verdict among the tools: $(cat probe.json)"
    jq -e '.active | index("task_verdict") != null' probe.json >/dev/null || fail "task_verdict is registered but not active: $(cat probe.json)"
  '';
}
