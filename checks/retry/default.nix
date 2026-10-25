# Runs the upstream vitest suite of the PATCHED pi-retry (the exact source
# ~/.pi/agent/extensions/pi-retry links to). A patch that no longer applies
# fails this build in applyPatches; a patch that applies but breaks the
# extension fails the suite.
#
# Unlike the other pi extension checks this needs an npm closure: upstream's
# tests use vitest and import pi's own packages (AgentSession, Agent), which
# exist only inside the pi binary. They come from the shared npm lock
# (checks/npm, spec §3), upstream's devDependencies; bump it together with
# the input pi-retry.
{
  pkgs,
  src,
  nodeModules,
}:
pkgs.runCommand "pi-retry-tests" {nativeBuildInputs = [pkgs.nodejs];} ''
  cp -r ${src} work
  chmod -R u+w work
  cd work
  ln -s ${nodeModules}/node_modules node_modules
  export HOME=$TMPDIR/home
  mkdir -p "$HOME"
  node node_modules/vitest/vitest.mjs run

  # The free-cap patch's own test must be part of what ran. Print/json
  # sessions retry inline upstream (prompt-scoped sessions, formerly a local
  # patch); keep that route pinned, `pi -p` had no retry at all without it.
  grep -q 'daily free cap is not retried' __tests__/unit/error-patterns.test.ts
  grep -q 'prompt-scoped ordinary sessions' __tests__/integration/native-child-lifecycle.test.ts
  grep -q 'isPromptScopedMode(ctx.mode)' retry.ts
  grep -q 'openrouter_free_tier_daily' src/error-patterns.ts
  touch $out
''
