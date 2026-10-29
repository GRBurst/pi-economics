# The boundary check: this repository names only the extensions it ships. A
# consumer's own extensions (a provider login, a search tool) are the
# consumer's business: it defines them in `bench.extensions` and lists them in
# `bench.baseExtensions` and `bench.orchExtensions`, and nothing here may name
# them. Fixed strings, case-insensitive, over every file's content (binary
# files too) and every file and directory name, except the upstream provenance
# (`NOTICE`, `LICENSE`, `patches/<input>/LICENSE`) and this directory, whose
# term list is the one place that has to name them. The list holds the names of
# public extensions only; the names of the privately sourced ones are held, and
# scanned for in this source, by the consumer that has them.
{
  lib,
  pkgs,
}: let
  # Public extensions of particular setups this repository does not ship, as
  # words: each is spelled with a hyphen, an underscore or none (the scan
  # ignores case, so none also covers camelCase). `claude auth` with a space
  # is prose and passes.
  words = [["claude" "auth"] ["session" "name"]];
  terms = lib.concatMap (w: map (sep: lib.concatStringsSep sep w) ["-" "_" ""]) words;
  termArgs = lib.concatMapStringsSep " " (t: "-e ${lib.escapeShellArg t}") terms;
in rec {
  scanner = pkgs.writeShellApplication {
    name = "pi-economics-boundary-scan";
    runtimeInputs = [pkgs.gnugrep pkgs.findutils pkgs.coreutils];
    text = ''
      root=''${1:?usage: pi-economics-boundary-scan <dir>}
      if [ -z "$(find "$root" -type f -print -quit)" ]; then
        echo "pi-economics-boundary-scan: no files under $root" >&2
        exit 2
      fi
      # Skipped: the top-level NOTICE and LICENSE, each upstream's LICENSE
      # under patches/, and this check's own directory.
      skipped='NOTICE|LICENSE|patches/[^/]+/LICENSE|checks/boundary(/[^:]*)?'
      rc=0
      # -a: a binary file is searched as text, not reported on stderr.
      hits=$(cd "$root" && grep -rnaiF --exclude-dir=.git --exclude=.git \
        ${termArgs} \
        -- . | tr -d '\000') || rc=$?
      case $rc in
        0 | 1) ;;
        *)
          echo "pi-economics-boundary-scan: grep failed ($rc)" >&2
          exit 2
          ;;
      esac
      hits=$(printf '%s\n' "$hits" | grep -vE "^\./($skipped):" | grep -v '^$' || true)
      # The names of files and directories (find's own output, not the content).
      rc=0
      names=$(cd "$root" && find . -path ./.git -prune -o -print | grep -iF \
        ${termArgs}) || rc=$?
      case $rc in
        0 | 1) ;;
        *)
          echo "pi-economics-boundary-scan: name scan failed ($rc)" >&2
          exit 2
          ;;
      esac
      names=$(printf '%s\n' "$names" | grep -vE "^\./($skipped)$" | grep -v '^$' | sed 's/$/ (name)/' || true)
      hits=$(printf '%s\n%s\n' "$hits" "$names" | grep -v '^$' || true)
      if [ -n "$hits" ]; then
        printf '%s\n' "$hits"
        echo "pi-economics-boundary-scan: an extension this repository does not ship is named (lines above)" >&2
        exit 1
      fi
    '';
  };

  check = src:
    pkgs.runCommand "boundary" {} ''
      ${lib.getExe scanner} ${src}
      touch $out
    '';

  # A hit in each scanned kind of place fails (content, binary content, a file
  # or directory name, a patch); the same text in the excluded places passes;
  # an empty tree is an error.
  selftest = pkgs.runCommand "boundary-selftest" {} ''
    set -euo pipefail
    scan=${lib.getExe scanner}
    # hit <path> <content>: a file with that content; hit_bin: the text between
    # NULs (a binary file); hit_name <path>: an empty file of that name.
    expect_hit() {
      local d=$1 st=0
      $scan "$d" >/dev/null 2>&1 || st=$?
      [ "$st" -eq 1 ] || { echo "FAIL hit $2: exit $st, want 1" >&2; exit 1; }
      echo "ok hit $2"
    }
    hit() {
      local d
      d=$(mktemp -d)
      mkdir -p "$d/$(dirname "$1")"
      printf '%s\n' "$2" >"$d/$1"
      expect_hit "$d" "$1: $2"
    }
    hit_bin() {
      local d
      d=$(mktemp -d)
      mkdir -p "$d/$(dirname "$1")"
      printf 'x\000%s\000y\n' "$2" >"$d/$1"
      expect_hit "$d" "$1 (binary): $2"
    }
    hit_name() {
      local d
      d=$(mktemp -d)
      mkdir -p "$d/$(dirname "$1")"
      : >"$d/$1"
      expect_hit "$d" "name $1"
    }
    ${lib.concatMapStringsSep "\n" (t: "hit docs/x.md ${lib.escapeShellArg "loads ${t}"}") terms}
    hit README.md "load CLAUDE-AUTH first"
    hit README.md "load ClaudeAuth first"
    hit modules/bench.nix 'example = "git:github.com/someone/pi-claude-auth@main";'
    hit packages/bench/src/config.ts '["infinite-context", "claude_auth"]'
    hit packages/bench/src/config.ts 'const claudeAuth = 1;'
    hit checks/x/corpus.json '{"packages":["session-name"]}'
    hit .hidden 'claude-auth'
    hit docs/NOTICE 'claude-auth'
    hit packages/bench/LICENSE 'claude-auth'
    hit x/patches/y 'claude-auth'
    hit patches/up/x.patch '+ childExtensions: ["claude-auth"]'
    hit patches/up/LICENSE.patch 'claude-auth'
    hit_bin data/blob.bin claude-auth
    hit_name extensions/claude-auth/index.ts
    hit_name docs/claudeAuth.md
    hit_name docs/session_name/notes.txt
    hit_name patches/up/claude-auth.patch

    mkdir near
    printf '%s\n' 'auth-ext' 'search-ext' 'question' 'claude auth' 'claude-aut' 'session name' 'sessions' >near/f.txt
    printf 'x\000%s\000y\n' 'claude-aut' >near/blob.bin
    : >near/claude.txt
    : >near/auth-ext.md
    mkdir near/auth
    : >near/auth/session.ts
    $scan near || { echo "FAIL near misses rejected" >&2; exit 1; }
    echo "near misses: pass"

    mkdir -p excl/patches/up excl/checks/boundary excl/.git excl/docs
    for f in NOTICE LICENSE patches/up/LICENSE checks/boundary/default.nix .git/HEAD; do
      printf '%s\n' 'claude-auth session-name' >"excl/$f"
    done
    printf '%s\n' clean >excl/docs/ok.md
    $scan excl || { echo "FAIL provenance and the term list must be skipped" >&2; exit 1; }
    echo "excluded places: pass"

    mkdir empty
    st=0
    $scan empty 2>/dev/null || st=$?
    [ "$st" -eq 2 ] || { echo "FAIL empty tree: exit $st, want 2" >&2; exit 1; }
    echo "empty tree: exit 2"
    touch $out
  '';
}
