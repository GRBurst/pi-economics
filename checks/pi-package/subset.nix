# The README's subset (AC4, plan T6.1): the filter of ./subset.json, the
# object form of a `packages` entry, narrows the installed package to two
# extensions, token-meter and cache-lifecycle. The fixture's `source` is the
# README's install line; the check installs the local copy and swaps only the
# source, so every other key of the entry is the README's. Loaded = pi
# printed the extension's factory line (offline `pi -p` fires no message_end,
# so token-meter writes no meter line); a component that did not load prints
# nothing, not even its warning: cache-lifecycle's actor warning, once, shows
# that the listed copy is bound, and experiments (its opt-in file written)
# would warn and assign an arm were it loaded.
{installed}:
installed {
  name = "pi-install-subset";
  before = ''
    # the opt-in file: were experiments loaded, it would assign an arm and write assignments.jsonl
    mkdir -p "$PI_CODING_AGENT_DIR/experiments"
    echo '{"mode": "explore"}' >"$PI_CODING_AGENT_DIR/experiments/settings.json"
    jq --slurpfile f ${./subset.json} '.packages = [{source: "../../../pkg"} + ($f[0] | del(.source))]' \
      "$PI_CODING_AGENT_DIR/settings.json" >settings.new
    cp settings.new "$PI_CODING_AGENT_DIR/settings.json"
  '';
  after = ''
    loaded "$PWD/pkg/packages/token-meter/index.ts" || fail "token-meter did not load"
    loaded "$PWD/pkg/packages/cache-lifecycle/index.ts" || fail "cache-lifecycle did not load"
    # every other manifest extension is filtered out
    while IFS= read -r p; do
      if loaded "$PWD/pkg/''${p#./}"; then fail "$p loaded although the filter leaves it out"; fi
    done < <(jq -r --slurpfile f ${./subset.json} '.pi.extensions[] | select((ltrimstr("./")) as $p | $f[0].extensions | index($p) | not)' pkg/package.json)
    [ "$(grep -cF 'cache-lifecycle: needs pi-actor-subagents' run.all)" = 1 ] || fail "not exactly one cache-lifecycle warning"
    if grep -qF 'experiments: needs' run.all; then fail "experiments warned although it is filtered out"; fi
    [ ! -e "$PI_CODING_AGENT_DIR/experiments/assignments.jsonl" ] || fail "experiments assigned an arm"
  '';
}
