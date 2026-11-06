# The README's subset (AC4, plan T6.1): the filter of ./subset.json, the
# object form of a `packages` entry, narrows the installed package to two
# extensions. The fixture's `source` is the README's install line; the check
# installs the local copy and swaps only the source, so every other key of the
# entry is the README's. Loaded = pi printed the extension's factory line
# (offline `pi -p` fires no message_end, so token-meter writes no meter line);
# a component that did not load prints nothing, not even its warning.
{installed}:
installed {
  name = "pi-install-subset";
  before = ''
    jq --slurpfile f ${./subset.json} '.packages = [{source: "../../../pkg"} + ($f[0] | del(.source))]' \
      "$PI_CODING_AGENT_DIR/settings.json" >settings.new
    cp settings.new "$PI_CODING_AGENT_DIR/settings.json"
  '';
  after = ''
    loaded "$PWD/pkg/packages/token-meter/index.ts" || fail "token-meter did not load"
    loaded "$PWD/pkg/packages/task-router/index.ts" || fail "task-router did not load"
    for c in cache-lifecycle experiments; do
      if loaded "$PWD/pkg/packages/$c/index.ts"; then fail "$c loaded although the filter leaves it out"; fi
    done
    [ "$(grep -cF 'task-router: needs pi-actor-subagents' run.all)" = 1 ] || fail "not exactly one task-router warning"
    if grep -qF 'cache-lifecycle: needs' run.all; then fail "cache-lifecycle warned although it is filtered out"; fi
    [ ! -e "$PI_CODING_AGENT_DIR/experiments/assignments.jsonl" ] || fail "experiments assigned an arm"
  '';
}
