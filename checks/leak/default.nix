# The in-flake leak check (spec §8.3): generic patterns only, because a
# literal term list in a public repository would itself be the leak.
{
  lib,
  pkgs,
}: rec {
  scanner = pkgs.writeShellApplication {
    name = "pi-economics-leak-scan";
    runtimeInputs = [pkgs.gnugrep pkgs.findutils pkgs.coreutils];
    text = ''
      root=''${1:?usage: pi-economics-leak-scan <dir>}
      if [ -z "$(find "$root" -type f -print -quit)" ]; then
        echo "pi-economics-leak-scan: no files under $root" >&2
        exit 2
      fi
      status=0
      scan() {
        local rc=0
        grep -rnE -- "$2" "$root" || rc=$?
        case $rc in
          0)
            echo "pi-economics-leak-scan: $1 found (lines above)" >&2
            status=1
            ;;
          1) ;;
          *)
            echo "pi-economics-leak-scan: grep failed ($rc) on the $1 pattern" >&2
            exit 2
            ;;
        esac
      }
      scan "e-mail address" '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}'
      # A named user's home: more than one character, so /home/u/ passes.
      scan "home path" '/home/[A-Za-z_][A-Za-z0-9._-]+/'
      scan "git+ssh URL" 'git\+ssh://'
      # RFC 1918, full dotted quads only (a version such as 10.2 passes);
      # loopback is not a private network.
      scan "RFC 1918 address" '\b10(\.[0-9]{1,3}){3}\b'
      scan "RFC 1918 address" '\b172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}\b'
      scan "RFC 1918 address" '\b192\.168(\.[0-9]{1,3}){2}\b'
      exit "$status"
    '';
  };

  check = src:
    pkgs.runCommand "leak" {} ''
      ${lib.getExe scanner} ${src}
      touch $out
    '';

  # The hits are assembled at run time, so this file itself stays clean.
  selftest = pkgs.runCommand "leak-selftest" {nativeBuildInputs = [pkgs.gnugrep];} ''
    set -euo pipefail
    scan=${lib.getExe scanner}
    hit() {
      local d out st=0
      d=$(mktemp -d)
      printf '%s\n' "$2" >"$d/f.txt"
      out=$($scan "$d" 2>&1) || st=$?
      [ "$st" -eq 1 ] || { echo "FAIL hit '$2': exit $st, want 1" >&2; exit 1; }
      grep -qF -- "$1 found" <<<"$out" || { echo "FAIL hit '$2': not reported as $1" >&2; echo "$out" >&2; exit 1; }
      echo "ok hit $1: $2"
    }
    hit "e-mail address" "$(printf '%s@%s' someone example.org)"
    hit "home path" "$(printf '/%s/%s/x' home alice)"
    hit "home path" "$(printf '/%s/%s/x' home ab)"
    hit "git+ssh URL" "$(printf 'git+%s://host/repo' ssh)"
    hit "RFC 1918 address" "$(printf '%s.%s.%s.%s' 10 1 2 3)"
    hit "RFC 1918 address" "$(printf '%s.%s.%s.%s' 172 16 0 1)"
    hit "RFC 1918 address" "$(printf '%s.%s.%s.%s' 172 31 255 255)"
    hit "RFC 1918 address" "$(printf '%s.%s.%s.%s' 192 168 1 1)"

    mkdir near
    printf '%s\n' '/home/u/x' '127.0.0.1' 'version 10.2' 'v10.2.3' '172.15.0.1' '172.32.0.1' \
      '192.169.1.1' 'user@localhost' 'git+https://host/repo' >near/f.txt
    $scan near || { echo "FAIL near misses rejected" >&2; exit 1; }
    echo "near misses: pass"

    mkdir empty
    st=0
    $scan empty 2>/dev/null || st=$?
    [ "$st" -eq 2 ] || { echo "FAIL empty tree: exit $st, want 2" >&2; exit 1; }
    echo "empty tree: exit 2"
    touch $out
  '';
}
