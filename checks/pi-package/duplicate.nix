# The duplicate guard (AC7, plan T4.1): the package installed AND every own
# component linked into the auto-discovered <agentDir>/extensions/<c>, as the
# Nix route linked it before M6 (a built package: a different path, the same
# component). The first copy
# pi starts wins; each other copy stays inert and says so once. The analysis
# skill is duplicated the same way: pi's loader reports a collision (`pi -p`
# prints no skill diagnostics, so ./skill-collision.mjs asks the loader).
{
  lib,
  pkgs,
  installed,
  self,
  own,
}:
installed {
  name = "pi-install-duplicate";
  before = ''
    mkdir -p "$PI_CODING_AGENT_DIR/extensions" "$PI_CODING_AGENT_DIR/skills"
    ${lib.concatMapStrings (c: ''
        ln -s ${self.packages.${pkgs.stdenv.hostPlatform.system}.${c}} "$PI_CODING_AGENT_DIR/extensions/${c}"
      '')
      own}
    ln -s ${self}/skills/pi-token-economics-analysis "$PI_CODING_AGENT_DIR/skills/pi-token-economics-analysis"
  '';
  after = ''
    for c in ${lib.escapeShellArgs own}; do
      [ "$(grep -cF "pi-economics: $c is loaded twice" run.all)" = 1 ] || fail "$c: not exactly one 'loaded twice' line"
    done
    # the winner is bound, not only a loser that said so: its actor warning (one per process) prints from a bound copy alone
    for c in cache-lifecycle; do
      [ "$(grep -cF "$c: needs pi-actor-subagents" run.all)" = 1 ] || fail "$c: not exactly one bound copy (its actor warning appears $(grep -cF "$c: needs pi-actor-subagents" run.all) times)"
    done
    if grep -qF 'conflicts with' run.all; then fail "pi reports a tool or flag conflict between the copies"; fi
    ${pkgs.nodejs}/bin/node ${./skill-collision.mjs} ${pkgs.pi-coding-agent}/lib/node_modules/pi-monorepo/dist/index.js "$PI_CODING_AGENT_DIR" "$PWD/pkg/skills" >skills.out \
      || fail "the skill loader failed"
    [ "$(grep -cxF 'collision: name "pi-token-economics-analysis" collision' skills.out)" = 1 ] || fail "no pi collision for the duplicate skill: $(cat skills.out)"
  '';
}
