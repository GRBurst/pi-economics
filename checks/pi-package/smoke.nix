# The repository installs as a pi package and starts (AC1): `pi install ./pkg`
# offline into a fresh agent directory, and `pi -p x` loads every manifest
# extension up to the missing model key.
{installed}:
installed {
  name = "pi-install-smoke";
  after = ''
    while IFS= read -r p; do
      loaded "$PWD/pkg/''${p#./}" || fail "the extension $p did not load"
    done < <(jq -r '.pi.extensions[]' pkg/package.json)
    # experiments assigns an arm without a settings file (T3.5 flips this line, spec D15)
    [ -e "$PI_CODING_AGENT_DIR/experiments/assignments.jsonl" ] || fail "experiments wrote no assignments.jsonl"
  '';
}
