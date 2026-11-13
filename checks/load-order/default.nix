# Load order (redesign §7.6, G6) under real pi 1.4, offline: pi-economics'
# components start before every other extension that is not built in. The
# agent directory Home Manager renders with every component on, pi-setup's
# actor and a probe (./probe) as registry entries, each home.file under it
# linked as Home Manager links it; besides, the probe as an extension
# auto-discovered in <agentDir>/extensions (named to sort first), as an
# installed package, and as an entry the owner listed in settings.json's
# `extensions` before the activation entry ran (after `-builtin:mcp`). Then
# the settings script, as the activation entry runs it, and `pi -p x`.
# Asserted from pi's PI_TIMING=1 factory lines (pi 1.4's startup timings, as
# checks/pi-package reads them: the extensions in load order) and from the
# probes, each of which records which guarded component had started before it.
# Then a child: the actor's settings file lists the module's childExtensions,
# as pi-setup's actor module writes it from its economics bridge; a second
# `pi -p x`, against a fake model, spawns one child through the actor, and
# the probe in the child (the registry's a-reg, sorted first by name) records
# the guarded components the child loads (token-meter, cache-lifecycle) as
# started before it. pi prints no startup timings for a child.
{
  lib,
  pkgs,
  hm,
  # pi-setup's patched actor-subagents as a registry entry (checks/default.nix).
  actorEntry,
}: let
  dir = ".pi/agent";
  components = ["experiments" "token-meter" "cache-lifecycle" "infinite-context"];
  c = hm.eval {
    programs.piEconomics = {
      agentDir = dir;
      tokenMeter.enable = true;
      cacheLifecycle.enable = true;
      experiments.enable = true;
      infiniteContext.enable = true;
      extensions.actor-subagents = actorEntry;
      # Sorts before the components by name.
      extensions.a-reg = {
        path = ./probe;
        forChildren = true;
        description = "the load-order probe";
      };
    };
  };
  pe = c.programs.piEconomics;
  links =
    lib.concatMapStrings (f: ''
      mkdir -p "$HOME/$(dirname ${lib.escapeShellArg f.target})"
      ln -s ${f.source} "$HOME/"${lib.escapeShellArg f.target}
    '')
    (lib.filter (f: lib.hasPrefix "${dir}/" f.target) (lib.attrValues c.home.file));
in
  pkgs.runCommand "load-order" {nativeBuildInputs = [pkgs.pi-coding-agent pkgs.jq pkgs.coreutils pkgs.gnugrep];} ''
    set -euo pipefail
    export HOME=$PWD/home PI_CODING_AGENT_DIR=$PWD/home/${dir} PI_OFFLINE=1 PI_TIMING=1 PROBE_OUT=$PWD/probe.jsonl
    agent=$PI_CODING_AGENT_DIR
    fail() {
      echo "load-order: $*" >&2
      if [ -f run.all ]; then cat run.all >&2; fi
      if [ -f probe.jsonl ]; then cat probe.jsonl >&2; fi
      exit 1
    }
    ${links}
    mkdir -p "$agent/extensions/aa-disc" mine pkg-ext/extensions
    cp ${./probe/index.ts} "$agent/extensions/aa-disc/index.ts"
    cp ${./probe/index.ts} mine/index.ts
    cp ${./probe/index.ts} pkg-ext/extensions/index.ts
    printf '{"name":"pkg-ext","version":"0.0.0","pi":{"extensions":["./extensions/index.ts"]}}\n' >pkg-ext/package.json
    pi install ./pkg-ext >install.log 2>&1 || { cat install.log >&2; fail "pi install failed"; }
    jq --arg mine "$PWD/mine" '.extensions = ["-builtin:mcp", $mine]' "$agent/settings.json" >s.json
    mv s.json "$agent/settings.json"
    ${lib.getExe pe.piSettings.package} "$agent/settings.json"
    # What the script wrote is home-files' to check; this check asserts what pi does with it.
    echo "settings.json extensions: $(jq -c .extensions "$agent/settings.json")"

    rc=0
    pi -p x --no-session </dev/null >run.out 2>run.err || rc=$?
    cat run.out run.err >run.all
    grep -qF 'No API key found' run.all || fail "pi did not reach the model call"
    [ "$rc" = 1 ] || fail "pi -p exited $rc, expected 1"
    if grep -qF 'Failed to load extension' run.all; then fail "an extension failed to load"; fi
    if grep -qF 'Extension error' run.all; then fail "an extension's session_start threw"; fi
    grep -qF "Startup Timings: extensions" run.all || fail "pi printed no PI_TIMING block: the factory-line marker is pi 1.4's (did pkgs.pi-coding-agent move?)"

    # The factory lines in load order, built-ins left out.
    grep -F ' factory: ' run.all | sed 's/^ *//; s/ factory: .*//' | grep -v '^builtin:' >order.txt
    pos() { grep -nF "$1" order.txt | head -1 | cut -d: -f1; }
    last=0
    for n in ${lib.escapeShellArgs components}; do
      p=$(pos "$agent/pi-economics/extensions/$n/") || true
      [ -n "$p" ] || fail "the component $n did not load"
      [ "$p" -gt "$last" ] || fail "the component $n loaded out of the order ${toString components}"
      last=$p
    done
    for o in "$agent/pi-economics/extensions/actor-subagents/" "$agent/pi-economics/extensions/a-reg/" "$agent/extensions/aa-disc/" "$PWD/mine/" "$PWD/pkg-ext/"; do
      p=$(pos "$o") || true
      [ -n "$p" ] || fail "$o did not load"
    done
    others=$(grep -vcF "$agent/pi-economics/extensions/" order.txt || true)
    [ "$others" -ge 3 ] || fail "expected the auto-discovered, the owner's and the package's probe besides the registry"
    first=$(grep -nvF -e "$agent/pi-economics/extensions/experiments/" -e "$agent/pi-economics/extensions/token-meter/" \
      -e "$agent/pi-economics/extensions/cache-lifecycle/" -e "$agent/pi-economics/extensions/infinite-context/" order.txt | head -1 | cut -d: -f1)
    [ "$first" -gt "$last" ] || fail "$(sed -n "''${first}p" order.txt) loaded before a pi-economics component"

    # Every probe's session_start ran after the guarded components'.
    [ "$(wc -l <probe.jsonl)" = 4 ] || fail "expected four probe records"
    jq -se 'all(.claimed == ["experiments", "token-meter", "cache-lifecycle"])' probe.jsonl >/dev/null \
      || fail "a probe started before a guarded component: $(cat probe.jsonl)"
    echo "load order:"
    cat order.txt

    # The child.
    mkdir -p "$agent/actor-subagents"
    jq -n --argjson ce ${lib.escapeShellArg (builtins.toJSON pe.childExtensions)} \
      --arg from ${lib.escapeShellArg c.home.homeDirectory} --arg to "$HOME" \
      '{childExtensions: ($ce | map($to + ltrimstr($from)))}' >"$agent/actor-subagents/settings.json"
    echo "childExtensions: $(jq -c .childExtensions "$agent/actor-subagents/settings.json")"
    # A model the actor can name; nothing listens on port 9.
    printf '%s\n' '{"providers":{"fake":{"baseUrl":"http://localhost:9/v1","api":"openai-completions","apiKey":"x","models":[{"id":"m"}]}}}' >"$agent/models.json"
    export PROBE_OUT=$PWD/child.jsonl SPAWN_CHILD=1
    rm -f run.all probe.jsonl
    timeout 120 pi -p x --no-session </dev/null >child.out 2>child.err || true
    cat child.out child.err child.jsonl >run.all 2>/dev/null || true
    if grep -qF 'Failed to load extension' run.all; then fail "an extension failed to load"; fi
    if grep -qF 'Extension error' run.all; then fail "an extension's session_start threw"; fi
    sid=$(jq -sr '[.[] | select(.spawn.ok) | .spawn.sessionId] | if length == 1 then .[0] else empty end' child.jsonl) \
      || fail "no record in the probe's output"
    [ -n "$sid" ] || fail "the actor spawned no child"
    # The child loads the link's target.
    areg=$(readlink -f "$agent/pi-economics/extensions/a-reg")/index.ts
    jq -se --arg sid "$sid" --arg areg "$areg" '[.[] | select(.sid == $sid)] | length == 1 and .[0].name == $areg' child.jsonl >/dev/null \
      || fail "expected one probe record in the child, the registry's a-reg"
    jq -se --arg sid "$sid" '.[] | select(.sid == $sid) | .claimed == ["token-meter", "cache-lifecycle"]' child.jsonl >/dev/null \
      || fail "in the child, the probe started before a guarded component"
    touch $out
  ''
