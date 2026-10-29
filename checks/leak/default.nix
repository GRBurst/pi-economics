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
        grep -rnE ''${3:+-i} --exclude-dir=.git --exclude=.git -- "$2" "$root" || rc=$?
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
      scan "e-mail address" '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
      # A named user's home, quoted or not: more than one character, so /home/u passes.
      scan "home path" '/home/[A-Za-z_][A-Za-z0-9._-]+'
      scan "git+ssh URL" 'git\+ssh://'
      # RFC 1918, full dotted quads only (a version such as 10.2 passes);
      # loopback is not a private network.
      scan "RFC 1918 address" '\b10(\.[0-9]{1,3}){3}\b'
      scan "RFC 1918 address" '\b172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}\b'
      scan "RFC 1918 address" '\b192\.168(\.[0-9]{1,3}){2}\b'
      # Tailscale's CGNAT range (a /10 from the 64 block of the 100 network).
      scan "CGNAT address" '\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])(\.[0-9]{1,3}){2}\b'
      # A name under a LAN-only suffix (mDNS, router domains, Tailscale).
      scan "LAN host name" '(https?|wss?)://[^/ "]*\.(local|lan|home\.arpa|ts\.net)\b' i
      # A URL whose host is one bare label of two or more characters other
      # than localhost names a machine on a private network (one-letter test
      # hosts such as http://h:1 pass, as /home/u/ does).
      lan='(https?|wss?)://[A-Za-z][A-Za-z0-9-]+(:[0-9]+)?([^A-Za-z0-9.:-]|$)'
      rc=0
      hits=$(grep -rnoiE --exclude-dir=.git --exclude=.git -- "$lan" "$root") || rc=$?
      case $rc in
        0 | 1) ;;
        *)
          echo "pi-economics-leak-scan: grep failed ($rc) on the LAN host URL pattern" >&2
          exit 2
          ;;
      esac
      hits=$(printf '%s\n' "$hits" | grep -viE '://localhost([^A-Za-z0-9.-]|$)' | grep -v '^$' || true)
      if [ -n "$hits" ]; then
        printf '%s\n' "$hits"
        echo "pi-economics-leak-scan: LAN host URL found (lines above)" >&2
        status=1
      fi
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
    hit "LAN host URL" "$(printf 'http://%s:%s/health' myhost 8080)"
    hit "LAN host URL" "$(printf '"https://%s"' nas)"
    hit "LAN host URL" "$(printf 'see http://%s' boxname)"
    hit "e-mail address" "$(printf '%s@%s' Someone Example.ORG)"
    hit "home path" "$(printf 'dir = "/%s/%s";' home alice)"
    hit "home path" "$(printf 'cd /%s/%s' home alice)"
    hit "LAN host name" "$(printf 'http://%s.%s:8080/x' nas local)"
    hit "LAN host name" "$(printf 'https://%s.%s/' router lan)"
    hit "LAN host name" "$(printf 'http://%s.%s' box home.arpa)"
    hit "LAN host name" "$(printf 'http://%s.%s' host.tail1234 ts.net)"
    hit "LAN host name" "$(printf 'HTTP://%s.%s/' NAS LOCAL)"
    hit "LAN host URL" "$(printf 'HTTP://%s/' nas)"
    hit "LAN host URL" "$(printf 'ws://%s:1/' box)"
    hit "CGNAT address" "$(printf 'http://%s.%s.%s.%s:11545' 100 101 102 103)"
    hit "CGNAT address" "$(printf '%s.%s.%s.%s' 100 64 0 1)"
    hit "CGNAT address" "$(printf '%s.%s.%s.%s' 100 127 255 255)"

    mkdir near
    printf '%s\n' '/home/u/x' '127.0.0.1' 'version 10.2' 'v10.2.3' '172.15.0.1' '172.32.0.1' \
      '192.169.1.1' 'user@localhost' 'git+https://h/repo' 'http://localhost:11545/health' \
      'http://h:1' 'http://local.invalid:11545' 'https://github.com/x/y' 'http://127.0.0.1:8080' \
      '/home/u' '/home' 'x@y.1' '100.63.255.255' '100.128.0.1' 'v100.64' 'http://example.com/a.locally' 'http://x.localhost/' 'http://x.lanes/' 'https://tsnet.dev/' 'ws://localhost:1/' 'HTTP://LOCALHOST:1/' 'http://a.b.arpa' \
      'git+https://h/repo' >near/f.txt
    $scan near || { echo "FAIL near misses rejected" >&2; exit 1; }
    echo "near misses: pass"

    # A `path:` flake source copy includes .git/, whose logs hold addresses.
    mkdir -p withgit/.git/logs
    printf '%s\n' 'clean' >withgit/f.txt
    printf '%s\n' "$(printf '0 1 A <%s@%s> 1 +0000' someone example.org)" >withgit/.git/logs/HEAD
    $scan withgit || { echo "FAIL .git/ must be skipped" >&2; exit 1; }
    echo ".git skipped: pass"

    # A worktree's .git is a file: gitdir: <absolute path>.
    mkdir wtgit
    printf '%s\n' 'clean' >wtgit/f.txt
    printf 'gitdir: /%s/%s/repo/.git/worktrees/w\n' home alice >wtgit/.git
    $scan wtgit || { echo "FAIL a .git file must be skipped" >&2; exit 1; }
    echo ".git file skipped: pass"

    mkdir empty
    st=0
    $scan empty 2>/dev/null || st=$?
    [ "$st" -eq 2 ] || { echo "FAIL empty tree: exit $st, want 2" >&2; exit 1; }
    echo "empty tree: exit 2"
    touch $out
  '';
}
