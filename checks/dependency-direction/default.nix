# Dependency direction (redesign G5, M5b.2): pi-economics reads and sets the
# levers of its targets; an extension never reads pi-economics. No file of the
# patched upstreams (patches/), of the built patched infinite-context (an
# add-on target) or of the patched actor names pi-economics' former
# process-global API or one of its channels and entries (`pi-economics:`);
# fixed strings, no regex. The task router stays out (review n2): it shares
# the claim channel `pi-economics:claim:v1` by design (runtime-guard-copies)
# and still holds its dead optional read of the removed global (its backlog).
{
  pkgs,
  # The sources to scan (store paths).
  sources,
}:
pkgs.runCommand "dependency-direction" {nativeBuildInputs = [pkgs.gnugrep];} ''
  hits=$(grep -rlF -e '__piExperimentsApi' -e 'pi-economics:' ${pkgs.lib.escapeShellArgs sources} || true)
  if [ -n "$hits" ]; then
    echo "dependency-direction: an extension reads pi-economics (redesign G5); remove the reference from:" >&2
    echo "$hits" >&2
    exit 1
  fi
  touch $out
''
