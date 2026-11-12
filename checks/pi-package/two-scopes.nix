# The package in two scopes of one project (AC7, review M1): the user's
# `pi install` entry and a project `.pi/settings.json`. pi starts such a
# project twice: a bootstrap pass loads the user-scope extensions before the
# project is trusted, then the final set (the project's packages first, then
# the user's) is built, and a bootstrap extension that is not in it is dropped
# without a word. Exactly one copy of every component must be bound: the one
# that really starts. The actor warning of cache-lifecycle prints once only
# from a bound copy (one per process).
#   replaced: the project entry takes the user's package out of the final set
#             (an empty filter), next to a second copy of it at another path;
#   both:     a second copy at another path joins the user's in the final set.
{
  lib,
  installed,
  own,
  variant,
}: let
  projectPackages = {
    replaced = ''[{source: $a, extensions: []}, $b]'';
    both = ''[$b]'';
  };
  twice = {
    replaced = 0;
    both = 1;
  };
in
  installed {
    name = "pi-install-scope-${variant}";
    before = ''
      cp -r pkg pkgB
      chmod -R u+w pkgB
      # the project must be trusted for its packages to load; only the agent directory's settings can say so
      jq '. + {defaultProjectTrust: "always"}' "$PI_CODING_AGENT_DIR/settings.json" >settings.new
      mv settings.new "$PI_CODING_AGENT_DIR/settings.json"
      mkdir -p .pi
      jq -n --arg a "$PWD/pkg" --arg b "$PWD/pkgB" '{packages: ${projectPackages.${variant}}}' >.pi/settings.json
    '';
    after = ''
      for c in ${lib.escapeShellArgs own}; do
        # the plant: pi's pre-trust pass loads the user's copy, whether or not the final set keeps it; without it M1 is not tested
        loaded "$PWD/pkg/packages/$c/index.ts" || fail "$c: pi did not load the user's copy (the pre-trust pass this check plants)"
        loaded "$PWD/pkgB/packages/$c/index.ts" || fail "$c: the project's copy did not load"
        [ "$(grep -cF "pi-economics: $c is loaded twice" run.all)" = ${toString twice.${variant}} ] \
          || fail "$c: expected ${toString twice.${variant}} 'loaded twice' line(s), got $(grep -cF "pi-economics: $c is loaded twice" run.all)"
      done
      for c in cache-lifecycle; do
        [ "$(grep -cF "$c: needs pi-actor-subagents" run.all)" = 1 ] \
          || fail "$c: not exactly one bound copy (its actor warning appears $(grep -cF "$c: needs pi-actor-subagents" run.all) times)"
      done
    '';
  }
