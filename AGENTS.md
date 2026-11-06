# pi-economics: rules for agents

The pi coding agent's token-economics stack as Home Manager components
(`programs.piEconomics.*`). Module contract: `docs/pi-economics.md`.
Markdown lives under `docs/`, except this file and `README.md`.

Comments cite the design record and the milestone plans (`spec §n`, decisions
`D…`, tasks `T…`, `M…`, plans by name). They were written while the components
moved out of the author's system configuration and are kept there, not in this
repository; the citations are provenance, not required reading. This
repository holds no plans; the author keeps them with their system
configuration.

## Commands

If a sandbox denies `~/.cache/nix`, point `XDG_CACHE_HOME` and
`XDG_DATA_HOME` at a writable cache directory before running `nix`.

The flake is read through git, so Nix sees only files in the index:
`git add` a new file before building.

Checks, one capped `nix build` each; never `nix flake check` without a memory cap:

    F=git+file://$PWD o=(--option eval-cache false) cap=$((20 * 1024 * 1024))
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
- Checks match rendered text with `lib.hasPrefix`, `lib.hasSuffix`,
  `lib.splitString "\n"` or `builtins.replaceStrings [x] [""] t != t` (an infix
  test without a regex), never with `builtins.match` or `lib.hasInfix` on a
  large text (`hasInfix` is `builtins.match ".*x.*"`: a backtracking regex that
  can hang evaluation or overflow the stack; it is fine for a short string).
- Every assertion's message starts with `pi-economics:` and has a negative
  case in `checks/module-eval/cases/`.
- No import-from-derivation: assertions probe source paths (`checkPath`),
  checks read option values.
- The leak check scans every tracked file, without exclusion: no e-mail
  addresses (any case), home paths of named users (`/home/<name>`, quoted or
  not), `git+ssh` URLs, private (RFC 1918) or Tailscale (CGNAT /10)
  addresses, LAN host URLs (`http://<one-label host>`, not `localhost`) or
  names under `.local`, `.lan`, `.home.arpa`, `.ts.net`; a worktree's `.git`
  file is skipped.
  Fixtures use the user `u` and hosts `localhost`, `*.invalid` or one letter.
- `checks/pi-settings-migrate/legacy.nix` is the author's former script, kept
  verbatim as a test oracle, but for one example package name (below). Do
  not edit it otherwise.
- Name only the extensions this repository ships. A consumer's own (a
  provider login, a search tool) appear in docs, option texts and tests
  under neutral names (`auth-ext`, `search-ext`, `my-login`,
  `git:github.com/example/pi-auth@main`); the `boundary` check fails on the
  names of particular setups (its term list in `checks/boundary/`), outside
  `NOTICE`, `LICENSE` and `patches/<input>/LICENSE` (it scans contents, binary ones too, and file and
  directory names, in the spellings `x-y`, `x_y`, `xy`).
- A consumer's copy of a cross-extension API type gets an `iface.compare`
  check in `checks/default.nix` (spec §5.3); its sources hold no
  `tsconfig.json`.
- Patched upstreams: `patches/<input>/`, file names as the original system configuration had them;
  the module reads the input through its internal `src` option. Each
  `patches/<input>/` holds the upstream's `LICENSE` (the `license` check);
  the patch lists in the package files are explicit, so it is not a patch.
- `flake.lock` changes only when a task needs it.
- The root `package.json` (the pi package manifest) is written only by
  `nix run .#render` and compared by `render-package`; never edit it by hand.
  Its `bin` files carry the pinned shebang and mode 755 (`pi-package-manifest`).
- The four `packages/<c>/core/runtime-guard.ts` are identical copies of
  task-router's (`runtime-guard-copies`): change one, `cp` it to the others.
  Each `index.ts` wraps its body in `guardSingleCopy`; a component that needs
  the actor's API decides at `session_start`, never at load.
- The package checks (`checks/pi-package/`) run pi 1.4 offline and find loaded
  extensions by its `PI_TIMING=1` factory lines (undocumented, pinned to the
  locked pi); `pi -p` fires no `message_end`, so it writes no meter line.
- README's "Without Nix" is checked by the module-eval case `readme-package`
  (install line = manifest version, the subset block = `checks/pi-package/subset.json`).
