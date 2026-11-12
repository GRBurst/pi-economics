# The package next to the patched actor (AC5, plan T3.6): with
# __subagentsApi_v1 loaded, after the package in load order, every manifest
# extension loads and no component warns that it misses the actor's API.
{
  installed,
  # The patched pi-actor-subagents (the pi-setup input's package); a copy is installed.
  actor,
}:
installed {
  name = "pi-install-actor";
  before = ''
    cp -r ${actor} actor
    chmod -R u+w actor
    pi install ./actor >actor.log 2>&1 || { cat actor.log >&2; fail "pi install ./actor failed"; }
  '';
  after = ''
    loaded "$PWD/actor/extensions/actor-subagents/index.ts" || fail "the actor did not load"
    while IFS= read -r p; do
      loaded "$PWD/pkg/''${p#./}" || fail "the extension $p did not load"
    done < <(jq -r '.pi.extensions[]' pkg/package.json)
    if grep -qF 'needs pi-actor-subagents' run.all; then fail "a component misses the actor's API"; fi
  '';
}
