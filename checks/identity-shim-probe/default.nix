# The identityShim probe (redesign D14; M10 T10.7, T10.8): ./probe.ts drives
# one AgentSession of the pinned pi (pkgs.pi-coding-agent) offline with
# cache-lifecycle's shim off and one with it on. Holds while pi still shows the
# pi 1.0.0 behaviour the shim works around (packages/cache-lifecycle/core/identity.ts):
# without the shim, the warmer's run of a request that held a custom message
# ends with "conversation context changed" once pi rebuilds its context from
# the session projection; with the shim it stays scheduled. When a pi update
# fixes that (without the shim the run stays scheduled), this check fails and
# names it: the shim may then go (a hidden stub in modules/removed.nix, as
# `retry`). Any other outcome, a hung probe included, fails as inconclusive.
{pkgs}: let
  pi = "${pkgs.pi-coding-agent}/lib/node_modules/pi-monorepo";
in
  pkgs.runCommand "identity-shim-probe" {nativeBuildInputs = [pkgs.nodejs pkgs.jq pkgs.coreutils];} ''
    export HOME=$PWD/home TMPDIR=$PWD/tmp PI_OFFLINE=1
    mkdir -p "$HOME" "$TMPDIR"
    fail() {
      echo "identity-shim-probe: $*" >&2
      jq . probe.json >&2 || cat probe.json >&2
      exit 1
    }
    rc=0
    timeout -k 10 120 node --experimental-strip-types ${./probe.ts} ${pi} ${../../packages/cache-lifecycle/core/identity.ts} >probe.json || rc=$?
    if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then fail "probe inconclusive: probe.ts timed out after 120 s (a pi API change?)"; fi
    [ "$rc" = 0 ] || fail "probe inconclusive: probe.ts exited $rc"
    jq -c . probe.json
    jq -e '.without.afterMail.state == "scheduled" and .with.afterMail.state == "scheduled"' probe.json >/dev/null ||
      fail "probe inconclusive: the warmer did not keep a run after the mail's turn (the probe's precondition)"
    if ! jq -e '.without.afterNote == {state: "inactive", reason: "conversation context changed"}' probe.json >/dev/null; then
      if jq -e '.without.afterNote.state == "scheduled"' probe.json >/dev/null; then
        fail "pi $(jq -r .version probe.json) keeps the warmer's run without the shim: identityShim may go (redesign D14)"
      fi
      fail "probe inconclusive: without the shim the warmer's status after the note is $(jq -c .without.afterNote probe.json), neither the pi 1.0.0 behaviour nor a kept run"
    fi
    jq -e '.with.afterNote.state == "scheduled"' probe.json >/dev/null ||
      fail "with the shim the warmer's run still ends after the note"
    touch $out
  ''
