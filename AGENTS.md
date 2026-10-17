# pi-economics: rules for agents

The pi coding agent's token-economics stack as Home Manager components
(`programs.piEconomics.*`). Design: `docs/specs/2026-10-12-pi-economics-design.md`.
One TDD plan per milestone in `docs/plans/YYYY-MM-DD-<topic>-plan.md`, each
ending with `# Execution Record`. Module contract: `docs/pi-economics.md`.
Markdown lives under `docs/`, except this file and `README.md`.

## Commands

Nix state in the agents' sandbox:

    export XDG_CACHE_HOME=$HOME/.cache/pi/nixcache XDG_DATA_HOME=$HOME/.cache/pi/nixdata

The flake is read through git, so Nix sees only files in the index:
`git add` a new file before building.

Checks, one capped `nix build` each; never `nix flake check` without a memory cap:

    F=git+file://$HOME/projects/nix/pi-economics o=(--option eval-cache false) cap=$((20 * 1024 * 1024))
    names=$( (ulimit -v $cap && exec timeout -s KILL 300 nix eval --json "$F#checks.x86_64-linux" --apply builtins.attrNames "${o[@]}") ) &&
      names=$(jq -er '.[]' <<<"$names") || echo "LISTING FAILED"
    for c in $names; do
      (ulimit -v $cap && exec timeout -s KILL 900 nix build --no-link -L "$F#checks.x86_64-linux.$c" "${o[@]}") || echo "FAILED $c"
    done

Formatter: Alejandra. `nix build "$F#formatter.x86_64-linux" --no-link --print-out-paths`,
then `<out>/bin/alejandra <files>`.

Commits are unsigned: `git -c commit.gpgsign=false commit`.

## Rules

- Tests first: every change starts with a failing check; a new check is seen red once.
- Checks match rendered text with `lib.hasInfix`, `lib.hasPrefix` or
  `lib.splitString "\n"`, never with `builtins.match` (a backtracking regex
  that can hang evaluation).
- Every assertion's message starts with `pi-economics:` and has a negative
  case in `checks/module-eval/cases/`.
- No import-from-derivation: assertions probe source paths (`checkPath`),
  checks read option values.
- The leak check scans every tracked file outside `docs/specs/` and
  `docs/plans/`: no e-mail addresses, home paths of named users, `git+ssh`
  URLs or private (RFC 1918) addresses. Fixtures use the user `u`.
- `checks/pi-settings-migrate/legacy.nix` is the host's former script, kept
  verbatim as a test oracle. Do not edit it.
- A consumer's copy of a cross-extension API type gets an `iface.compare`
  check in `checks/default.nix` (spec §5.3); its sources hold no
  `tsconfig.json`.
- Patched upstreams: `patches/<input>/`, file names as the host had them;
  the module reads the input through its internal `src` option.
- `flake.lock` changes only when a task needs it.
