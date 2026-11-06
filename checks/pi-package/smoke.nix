# The repository installs as a pi package and starts (AC1): `pi install ./pkg`
# offline into a fresh agent directory, and `pi -p x` loads every manifest
# extension up to the missing model key; experiments stays inert without its
# settings file.
{installed}:
installed {
  name = "pi-install-smoke";
  after = ''
    while IFS= read -r p; do
      loaded "$PWD/pkg/''${p#./}" || fail "the extension $p did not load"
    done < <(jq -r '.pi.extensions[]' pkg/package.json)
    # experiments is inert without its settings file (spec D15): no arm
    [ ! -e "$PI_CODING_AGENT_DIR/experiments/assignments.jsonl" ] || fail "experiments assigned an arm without its settings file"
  '';
}
