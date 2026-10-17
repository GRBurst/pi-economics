# pi-economics

Home Manager components for the pi coding agent's token economics, under
`programs.piEconomics`. Import `homeModules.default`: it brings every
component and the shared options below. Design and milestones:
`docs/specs/2026-10-12-pi-economics-design.md`; one plan per milestone in
`docs/plans/`.

## Shared options (`modules/common.nix`)

### `agentDir`

pi's agent directory, relative to home; default `.pi/agent`. pi's
`PI_CODING_AGENT_DIR` is not modelled: a host that moves the agent directory
sets this option.

### `extensions` (the registry)

`extensions.<name> = { path; checkPath ? path; input ? null; forChildren; description; }`.

- Each entry is linked as `<agentDir>/extensions/<name>` → `path`. Home
  Manager rejects a second link of the same name.
- An assertion requires `checkPath` to exist. For a patched source, point it
  at the unpatched input's entry file (probing a build output would be
  import-from-derivation); its message names `input`.
- `forChildren` selects the extensions actor-subagents children load
  (`childExtensions`, rendered with the `actorSubagents` component).

### `piSettings`

Edits of pi's mutable `settings.json`, run by one activation entry,
`piSettingsMigrate`.

- `enable` (default `true`): while `false`, no entry is rendered.
- `file` (default `<agentDir>/settings.json`): absolute, or relative to home.
- `after`: entries to run after, besides `writeBoundary`.
- `ops.<contributor>`: a list of `{ op; path; value; order ? 1000; }`. Each
  component writes under its own name; a host uses a key of its own.
  `path` is a list of object keys, never a dotted string, never empty.

| `op` | Effect | Missing parents | Other shape on the path |
|---|---|---|---|
| `set` | the leaf becomes `value` | created | op skipped |
| `ensureContains` | appends `value` unless an equal element exists | created, then `[]` | op skipped |
| `removeWhere` | removes the elements equal to `value` | op skipped | op skipped |

- `null` on the way or at the leaf counts as missing, except for
  `removeWhere`, which skips the op. `false` at the leaf of `ensureContains`
  counts as missing too.
- `false` on the way aborts the whole program: the file stays untouched.
- Order: by `order`, then contributor key, then position in the list.
- The entry runs only when `enable` is `true` and at least one op exists. It
  does nothing on an absent file, never fails the activation, and rewrites
  the file only when its JSON changes.

## Components

### `bench` (`modules/bench.nix`)

pi-bench (`packages/bench`, its own `README.md`): `pi-bench` and
`bench-report` on `PATH`, configured through session variables. Every option
at its empty default exports nothing, and the bench keeps its own default.

| Option | Default | Exported as |
|---|---|---|
| `enable` | `false` | — |
| `package` | the flake's `packages/bench` | `home.packages` |
| `dataDir` | `<home>/<agentDir>/bench` | `PI_BENCH_DATA` |
| (agent source) | `<home>/<agentDir>`, not an option | `PI_BENCH_AGENT_SRC` |
| `workDir` | `null` (the bench: `$XDG_RUNTIME_DIR/pi/tmp/bench`) | `PI_BENCH_WORK` |
| `extensions` | `{}` (the bench: `~/.pi/agent/extensions`) | `PI_BENCH_EXT_DIR`, a `linkFarm` of name → path |
| `router` | `{}` (an arm's file: its own keys) | `PI_BENCH_ROUTER`, a JSON file; an orch arm merges its `routing`, `delegation`, `t0Limits` over it as `lib.recursiveUpdate` does |
| `agentsBaseline` | `null` (the bench: `<agent source>/notes/…`) | `PI_BENCH_AGENTS_OFF` |

## Checks

| Check | Covers |
|---|---|
| `module-eval` | Home Manager evaluations: exports, options, registry, piSettings rendering, assertions with their negative cases |
| `pi-settings-migrate` | the piSettings script: the ported cases, bytes equal to the former script, the op table |
| `npm-deps` | the shared npm lock (`checks/npm`) installs the declared toolchain |
| `typecheck-harness` | the `tsc` runner accepts and rejects what it must |
| `bench` | the bench's own tests (`node --test`), run when its code builds |
| `typecheck-bench` | `tsc --strict` over the bench |
| `leak`, `leak-selftest` | no e-mail addresses, named home paths, `git+ssh` URLs or private addresses in tracked files |

How to run them: `AGENTS.md`, "Commands".
