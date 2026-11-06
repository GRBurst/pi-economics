# The runtime helpers are one file, copied byte-identical into the four own
# packages (spec D7, AC8): each package builds from its own directory, so a
# shared directory would break the per-component builds. task-router's copy
# is the reference (its tests stand for all four).
{
  pkgs,
  self,
}:
pkgs.runCommand "runtime-guard-copies" {nativeBuildInputs = [pkgs.diffutils];} ''
  ref=${self}/packages/task-router/core/runtime-guard.ts
  for c in token-meter experiments cache-lifecycle; do
    cmp "$ref" ${self}/packages/$c/core/runtime-guard.ts || {
      echo "runtime-guard-copies: packages/$c/core/runtime-guard.ts is not task-router's copy" >&2
      exit 1
    }
  done
  touch $out
''
