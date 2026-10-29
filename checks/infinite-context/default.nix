# Runs the tests of the PATCHED pi-infinite-context (the exact source
# ~/.pi/agent/extensions/infinite-context links to). A patch that no longer
# applies fails this build in applyPatches.
#
# Every upstream test but settings.test.ts imports fast-check or pi's packages,
# which come from `npm ci` and are not in the sandbox, so what runs is:
#  - upstream's settings.test.ts (the patch extends settings.ts and keeps it green),
#  - the patches' own test files: nudge.test.ts (per-model thresholds), settings.test.ts
#    (the strict reminders and fold-hint keys), fold-hint.test.ts, resync.test.ts;
#    settings.ts, nudge.ts, fold-hint.ts, robust.ts, forest.ts and tool-units.ts are kept
#    free of pi imports (type-only ones are erased) for exactly this reason,
#  - overlay-foreign.test.ts: upstream's overlay.ts against what the question extension
#    does to a request (a foreign toolResult), the behaviour the former local
#    foreign-messages patch provided,
#  - integration.test.ts: index.ts driven through its event handlers (reminders per model,
#    fold hint, fold_timing section, settings record and warning, handoff instead of the raw
#    transcript) with stand-ins for pi's `getAgentDir`, `sessionEntryToContextMessages` and
#    typebox (./stubs); the stand-ins carry no behaviour the tests are about.
{
  pkgs,
  src,
}:
pkgs.runCommand "pi-infinite-context-tests" {nativeBuildInputs = [pkgs.nodejs];} ''
  cp -r ${src} work
  chmod -R u+w work
  cd work
  mkdir -p node_modules/@earendil-works
  cp -r ${./stubs/pi-coding-agent} node_modules/@earendil-works/pi-coding-agent
  cp -r ${./stubs/typebox} node_modules/typebox
  cd extensions/infinite-context
  cp ${./overlay-foreign.test.ts} overlay-foreign.test.ts
  cp ${./integration.test.ts} integration.test.ts
  export HOME=$TMPDIR/home
  mkdir -p "$HOME"
  node --test --experimental-strip-types \
    settings.test.ts nudge.test.ts fold-hint.test.ts resync.test.ts \
    overlay-foreign.test.ts integration.test.ts

  # index.ts must plan reminders through the model-aware schedule, not upstream's
  # window-only one, and must read the settings file the Home Manager module writes.
  grep -q 'planNudge(tokens, window, settings, lastNudgedBand, continuing, ctx.model)' index.ts
  grep -q 'nudgeSchedule(window, settings, ctx.model)' index.ts
  grep -q 'join(getAgentDir(), "infinite-context", "settings.json")' index.ts
  # Folds that cannot be applied must abort the request (handoff notice),
  # never fall back to the raw transcript: every failure path of the
  # context hook goes through abortRequest.
  test "$(grep -c 'abortRequest(' index.ts)" -ge 3
  grep -q 'ctx.abort()' index.ts
  grep -q 'foldHint(' index.ts
  # The saved-folds flag is set before the branch check, so a branch that upstream refuses
  # (corrupted file, native compaction) still counts as holding its folds.
  test "$(grep -n 'foldsSaved = snapshotHasFolds(' index.ts | head -1 | cut -d: -f1)" -lt \
       "$(grep -n 'assertSupportedBranch(entries)' index.ts | head -1 | cut -d: -f1)"
  # The foldHint factor of the experiments package: its process-global flag, own setting as default.
  grep -q 'foldHintMode(' index.ts
  grep -q '__piExperimentsApi_v1' index.ts
  # cache-aware also sets the fold_timing prompt section (as task-router does for task_cards), once-resolved and constant (byte-stable).
  grep -q 'before_agent_start' index.ts
  grep -q 'systemPromptOptions' index.ts
  if grep -q 'return { systemPrompt' index.ts; then
    echo "index.ts must not replace the whole system prompt" >&2
    exit 1
  fi
  grep -q 'createFoldTiming(' index.ts
  grep -q 'foldTiming.reset()' index.ts
  # The overlay is upstream's, matching the projection as an ordered subsequence; the
  # local align.ts of the former foreign-messages patch must not come back beside it.
  if [ -e align.ts ]; then
    echo "align.ts: the foreign-messages patch is dropped, upstream's overlay.ts covers it" >&2
    exit 1
  fi
  touch $out
''
