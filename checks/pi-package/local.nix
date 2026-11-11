# Local mode under real pi (plan L4.T17, design §3.0.4): with
# {"mode":"local"} in the router's settings and the patched actor
# (spawnPolicyApi 2, the spawn-api patch) installed after the package, the
# router finds `api.spawn` and `api.kill` at session_start (no warning) and
# registers task_verdict and, with worktrees on (L5), start_branch, with the
# merge gate on (L6), request_merge, with plans on (L7), plan_request and
# amend_plan (the probe, ./probe.ts, lists the tools at session_shutdown). A
# control run without the actor prints the warning: the settings file is read,
# so the warning's absence above means something.
{
  installed,
  # The patched pi-actor-subagents (the flake's package); a copy is installed.
  actor,
}:
installed {
  name = "pi-install-local";
  before = ''
    cp -r ${actor} actor
    chmod -R u+w actor
    pi install ./actor >actor.log 2>&1 || { cat actor.log >&2; fail "pi install ./actor failed"; }
    mkdir -p "$PI_CODING_AGENT_DIR/task-router"
    echo '{"mode":"local"}' >"$PI_CODING_AGENT_DIR/task-router/settings.json"
  '';
  runArgs = "-e ${./probe.ts}";
  after = ''
    loaded "$PWD/actor/extensions/actor-subagents/index.ts" || fail "the actor did not load"
    if grep -qF 'spawnPolicyApi' run.all; then fail "the router misses the actor's spawn API"; fi
    if grep -qF 'needs pi-actor-subagents' run.all; then fail "a component misses the actor's API"; fi
    [ -f probe.json ] || fail "the probe wrote nothing"
    jq -e '.tools | index("task_verdict") != null' probe.json >/dev/null || fail "no task_verdict among the tools: $(cat probe.json)"
    jq -e '.tools | index("start_branch") != null' probe.json >/dev/null || fail "no start_branch among the tools: $(cat probe.json)"
    jq -e '.tools | index("request_merge") != null' probe.json >/dev/null || fail "no request_merge among the tools: $(cat probe.json)"
    jq -e '.tools | index("plan_request") != null' probe.json >/dev/null || fail "no plan_request among the tools: $(cat probe.json)"
    jq -e '.tools | index("amend_plan") != null' probe.json >/dev/null || fail "no amend_plan among the tools: $(cat probe.json)"
    pi remove ./actor >remove.log 2>&1 || { cat remove.log >&2; fail "pi remove ./actor failed"; }
    pi -p x --no-session </dev/null >control.all 2>&1 || true
    grep -qF 'task-router: local mode needs actor-subagents with spawnPolicyApi' control.all \
      || fail "control: no spawn-API warning without the actor (settings not read?): $(cat control.all)"
  '';
}
