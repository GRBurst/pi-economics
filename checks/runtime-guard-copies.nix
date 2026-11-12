# The runtime helpers are one file, copied byte-identical into the own
# packages (spec D7, AC8): each package builds from its own directory, so a
# shared directory would break the per-component builds. token-meter's copy
# is the reference (its tests stand for all; router-extraction design §7.3).
#
# The claim channel is a wire protocol shared with the task router's package,
# which keeps its own copy of the helpers (router-extraction design §8.5): the
# line declaring it must stand verbatim in the reference and in the
# pi-task-router input's copy.
{
  pkgs,
  self,
  # The router's package directory (a store path).
  router,
}:
pkgs.runCommand "runtime-guard-copies" {nativeBuildInputs = [pkgs.diffutils pkgs.gnugrep];} ''
  ref=${self}/packages/token-meter/core/runtime-guard.ts
  for c in experiments cache-lifecycle; do
    cmp "$ref" ${self}/packages/$c/core/runtime-guard.ts || {
      echo "runtime-guard-copies: packages/$c/core/runtime-guard.ts is not token-meter's copy" >&2
      exit 1
    }
  done
  line='const CHANNEL = "pi-economics:claim:v1";'
  for f in "$ref" ${router}/core/runtime-guard.ts; do
    grep -Fxq "$line" "$f" || {
      echo "runtime-guard-copies: $f lacks the line $line (the claim channel shared with pi-task-router)" >&2
      exit 1
    }
  done
  touch $out
''
