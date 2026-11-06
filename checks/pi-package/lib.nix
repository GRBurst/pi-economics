# The package checks' shared prelude (plan §10.3): the repository copied to
# ./pkg and installed with `pi install ./pkg` offline into a fresh agent
# directory (no settings files), the settings entry and `pi list` checked,
# then `pi -p x` run up to the missing model key, without a load error.
# PI_TIMING=1 makes pi print `<path> factory: <n>ms` for every extension whose
# factory returned (pi 1.4's startup timings, not a documented interface; a
# pi update that drops them fails `loaded`, it never passes silently).
{
  pkgs,
  lib,
  self,
}: {
  # name: the check; before: shell lines between the install and the run;
  # runArgs: more `pi -p` arguments; after: assertions on run.all ($rc, the
  # agent dir). `fail <text>` reports and exits; `loaded <path>` holds when
  # pi printed that extension's factory line.
  installed = {
    name,
    before ? "",
    runArgs ? "",
    after,
  }:
    pkgs.runCommand name {nativeBuildInputs = [pkgs.pi-coding-agent pkgs.jq pkgs.coreutils pkgs.gnugrep pkgs.findutils];} ''
      export HOME=$PWD/home PI_CODING_AGENT_DIR=$PWD/home/.pi/agent PI_OFFLINE=1 PI_TIMING=1 PROBE_OUT=$PWD/probe.json
      mkdir -p "$PI_CODING_AGENT_DIR"
      fail() {
        echo ${lib.escapeShellArg name}": $*" >&2
        if [ -f run.all ]; then cat run.all >&2; fi
        exit 1
      }
      # pi 1.4 prints its startup timings (PI_TIMING=1) as a block; without it every `loaded` would misreport "did not load"
      timings() { grep -qF "Startup Timings: extensions" run.all || fail "pi printed no PI_TIMING block: the factory-line marker is pi 1.4's (did pkgs.pi-coding-agent move?)"; }
      loaded() { grep -F "$1" run.all | grep -qF ' factory: '; }
      cp -r ${self} pkg
      chmod -R u+w pkg
      # pi skips a missing manifest path silently: every one must exist in the tree pi loads
      while IFS= read -r p; do
        [ -f "pkg/$p" ] || fail "manifest path $p is missing in the installed tree"
      done < <(jq -r '.pi.extensions[]' pkg/package.json)
      pi install ./pkg >install.log 2>&1 || { cat install.log >&2; fail "pi install failed"; }
      # the relative spelling of the entry, as pi writes it
      jq -e '.packages == ["../../../pkg"]' "$PI_CODING_AGENT_DIR/settings.json" >/dev/null \
        || fail "unexpected settings.json: $(cat "$PI_CODING_AGENT_DIR/settings.json")"
      pi list >list.out 2>&1
      grep -qF "$PWD/pkg" list.out || fail "pi list does not name the package: $(cat list.out)"
      ${before}
      rc=0
      pi -p x --no-session ${runArgs} </dev/null >run.out 2>run.err || rc=$?
      cat run.out run.err >run.all
      grep -qF 'No API key found' run.all || fail "pi did not reach the model call"
      [ "$rc" = 1 ] || fail "pi -p exited $rc, expected 1"
      # `! grep` is exempt from errexit: use `if`
      if grep -qF 'Failed to load extension' run.all; then fail "an extension failed to load"; fi
      # an install runs at session_start (runtime-guard.ts): its throw prints `Extension error (<path>): ...`, not a load error
      if grep -qF 'Extension error' run.all; then fail "an extension's install threw"; fi
      timings
      ${after}
      echo "pi -p output:"
      grep -vF ' factory: ' run.all || true
      touch $out
    '';
}
