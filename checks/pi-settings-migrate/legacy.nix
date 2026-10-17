# Test oracle, not used by the module: the host's
# modules/home-manager/features/ai/pi-settings-migrate.nix at f6a3c81, lines
# 32-97 verbatim (its header comment left out). Do not edit.
{
  pkgs,
  lib,
}: let
  stalePackages = [
    "git:github.com/fdietze/pi-claude-auth@main"
    "https://github.com/monotykamary/pi-retry"
    "git:github.com/monotykamary/pi-retry"
  ];

  # pi-retry rule objects (config.ts): `pattern` and optional `flags`, never a
  # bare string. Anchored with `^` and flag `m` so only a prompt that starts a
  # line with the actor-subagents preamble matches, not one that quotes it.
  childRule = {
    pattern = ''^You were spawned by "'';
    flags = "m";
  };
in
  pkgs.writeShellApplication {
    name = "pi-settings-migrate";
    runtimeInputs = [pkgs.jq pkgs.coreutils];
    text = ''
      f=''${1:?usage: pi-settings-migrate <settings.json> [idle]}
      warming=''${2:-}
      stale=${lib.escapeShellArg (builtins.toJSON stalePackages)}
      rule=${lib.escapeShellArg (builtins.toJSON childRule)}

      [ -e "$f" ] || exit 0

      tmp=$(mktemp "$f.XXXXXX")
      trap 'rm -f "$tmp"' EXIT

      # shellcheck disable=SC2016 # jq variables, not shell ones
      if ! jq --argjson stale "$stale" --argjson rule "$rule" --arg warming "$warming" '
        def drop_stale:
          if (.packages | type) == "array"
          then .packages |= map(select(. as $p | any($stale[]; . == $p) | not))
          else . end;
        def ensure_rule:
          if ((.piRetry // {}) | type) == "object"
            and ((.piRetry.subagents // {}) | type) == "object"
            and ((.piRetry.subagents.match // {}) | type) == "object"
            and ((.piRetry.subagents.match.systemPromptRegex // []) | type) == "array"
          then .piRetry.subagents.match.systemPromptRegex |=
            ((. // []) | if any(.[]; . == $rule) then . else . + [$rule] end)
          else . end;
        def ensure_warming:
          if ($warming == "idle") and (.cacheWarming != "idle")
          then .cacheWarming = "idle"
          else . end;
        drop_stale | ensure_rule | ensure_warming
      ' "$f" >"$tmp" 2>/dev/null; then
        exit 0
      fi

      # Equal as JSON: keep the owners' bytes.
      if jq -e -n --slurpfile a "$f" --slurpfile b "$tmp" '$a == $b' >/dev/null; then
        exit 0
      fi

      chmod --reference="$f" "$tmp"
      mv -f "$tmp" "$f"
      trap - EXIT
      echo "pi-settings-migrate: migrated $f" >&2
    '';
  }
