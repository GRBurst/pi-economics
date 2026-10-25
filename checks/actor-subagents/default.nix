# Runs the upstream test suite of the PATCHED pi-actor-subagents (the exact
# source ~/.pi/agent/extensions/actor-subagents links to). A patch that no
# longer applies fails this build in applyPatches; a patch that applies but
# breaks the extension fails the suite.
#
# pi loads the extension uncompiled with type stripping, so node's own test
# runner is the whole toolchain. Upstream test files that import pi's peer
# dependencies (@earendil-works/pi-{ai,tui,coding-agent}, which only exist
# inside pi) are left out: agent-tools, panel and the pi-*.test.ts contract
# tests against the installed pi.
{
  pkgs,
  src,
}:
pkgs.runCommand "pi-actor-subagents-tests" {nativeBuildInputs = [pkgs.nodejs];} ''
  cp -r ${src} work
  chmod -R u+w work
  cd work/extensions/actor-subagents
  export HOME=$TMPDIR/home
  mkdir -p "$HOME"
  find . -name '*.test.ts' ! -name agent-tools.test.ts ! -name panel.test.ts ! -name 'pi-*.test.ts' -print0 \
    | xargs -0 node --test --experimental-strip-types

  # The patch's own test must be part of what ran, and index.ts must build the
  # child prompt through it rather than through a full override, which is what
  # drops pi's tool and rules sections.
  grep -q 'childPromptOptions' child-prompt.test.ts
  grep -q 'childPromptOptions(' index.ts
  if grep -q 'systemPromptOverride:' index.ts; then
    echo "index.ts still replaces the child's whole system prompt" >&2
    exit 1
  fi

  # The spawn-policy patch's tests must be part of what ran, and index.ts must publish the API,
  # route spawns through its policy and hold a child's error notice back in the grace gate.
  for t in api spawn-policy spawn-wording error-notice-gate settings-grace usage-line tool-guard; do
    test -f "$t.test.ts"
  done
  grep -q 'installApi(' index.ts
  grep -q '__subagentsApi_v1' api.ts
  grep -q 'spawnPolicy: () => api.spawnPolicy()' index.ts
  grep -q 'errorGate.onEngineEvent(e)' index.ts
  grep -q 'toolGuardExtensions(spec.toolGuard)' index.ts
  grep -q 'childToolAllowlist(spec.tools, customTools)' index.ts
  # Upstream's engine routes a terminal child error to its parent itself (Engine.announce); the
  # gate only works if the engine defers that to it and the gate hands the error back.
  grep -q 'engine.deferErrorNotices = true' index.ts
  grep -q 'engine.announceError(name, reason)' index.ts
  grep -q 'if (!this.deferErrorNotices) this.announceError' engine.ts
  if grep -q 'engine.subscribe(() => updateStatus())' index.ts; then
    echo "index.ts feeds engine events to the roster without the error-notice gate" >&2
    exit 1
  fi

  touch $out
''
