# Runs the upstream test suite of the PATCHED pi-actor-subagents (the exact
# source ~/.pi/agent/extensions/actor-subagents links to). A patch that no
# longer applies fails this build in applyPatches; a patch that applies but
# breaks the extension fails the suite.
#
# pi loads the extension uncompiled with type stripping, so node's own test
# runner is the whole toolchain. One upstream test file is left out:
# agent-tools.test.ts imports @earendil-works/pi-coding-agent, a peer
# dependency that only exists inside pi.
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
  find . -name '*.test.ts' ! -name agent-tools.test.ts -print0 \
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
  # route spawns through its policy and send child-error notices through the grace gate.
  for t in api spawn-policy spawn-wording error-notice-gate settings-grace usage-line tool-guard; do
    test -f "$t.test.ts"
  done
  grep -q 'installApi(' index.ts
  grep -q '__subagentsApi_v1' api.ts
  grep -q 'spawnPolicy: () => api.spawnPolicy()' index.ts
  grep -q 'errorGate.onEngineEvent(e)' index.ts
  grep -q 'toolGuardExtensions(spec.toolGuard)' index.ts
  grep -q 'childToolAllowlist(spec.tools, customTools)' index.ts
  if grep -q 'notifyParentOfError(e)' index.ts; then
    echo "index.ts still notifies the parent of every child error without the grace gate" >&2
    exit 1
  fi

  # The first-turn patch's test must be part of what ran, and index.ts must hand a child's
  # messages to the sender that delivers the first one through prompt(). A direct
  # sendCustomMessage({triggerTurn:true}) on an idle session skips before_agent_start and the
  # system prompt / tool loadout.
  test -f first-turn.test.ts
  grep -q 'createAgentMessageSender(session)' index.ts
  grep -q 'sendAgentMessage,' index.ts
  grep -q 'target.sendUserMessage(' first-turn.ts
  if grep -q 'session.sendCustomMessage(toCustomAgentMessage' index.ts; then
    echo "index.ts delivers a child's first message with sendCustomMessage, which skips the loadout" >&2
    exit 1
  fi
  touch $out
''
