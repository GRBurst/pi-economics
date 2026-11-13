# Dependency direction (redesign G5, M5b.2): pi-economics reads and sets the
# levers of its targets; a patched upstream never reads pi-economics. No file
# under patches/ names pi-economics' former process-global API or one of its
# channels and entries (`pi-economics:`); fixed strings, no regex.
{pkgs}:
pkgs.runCommand "dependency-direction" {nativeBuildInputs = [pkgs.gnugrep];} ''
  hits=$(grep -rlF -e '__piExperimentsApi' -e 'pi-economics:' ${../../patches} || true)
  if [ -n "$hits" ]; then
    echo "dependency-direction: a patched upstream reads pi-economics (redesign G5); remove the reference from:" >&2
    echo "$hits" >&2
    exit 1
  fi
  touch $out
''
