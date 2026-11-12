# The repository installs as a pi package and starts (AC1): `pi install ./pkg`
# offline into a fresh agent directory, and `pi -p x` loads every manifest
# extension up to the missing model key; experiments stays inert without its
# settings file, cache-lifecycle warns once that the actor's API is missing,
# and nothing of the task router appears (it is the pi-task-router package's;
# router-extraction design §7.3).
{installed}:
installed {
  name = "pi-install-smoke";
  after = ''
    while IFS= read -r p; do
      loaded "$PWD/pkg/''${p#./}" || fail "the extension $p did not load"
    done < <(jq -r '.pi.extensions[]' pkg/package.json)
    # experiments is inert without its settings file (spec D15): no arm, no warning
    [ ! -e "$PI_CODING_AGENT_DIR/experiments/assignments.jsonl" ] || fail "experiments assigned an arm without its settings file"
    if grep -qF 'experiments: needs' run.all; then fail "experiments warned without its settings file"; fi
    # without the actor's API cache-lifecycle says so, once (spec D5, §4.2)
    [ "$(grep -cF 'cache-lifecycle: needs pi-actor-subagents' run.all)" = 1 ] || fail "not exactly one cache-lifecycle warning"
    if grep -qF 'task-router' run.all; then fail "the package loads a task router"; fi
  '';
}
