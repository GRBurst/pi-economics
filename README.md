# pi-economics

The [pi](https://github.com/earendil-works/pi) coding agent's token-economics
stack as Home Manager components: a meter that logs every provider request,
prompt-cache and context-window management, online experiments, retries, and a
bench to measure all of it on your own work. Scope: a purely exploratory
framework ([docs/scope.md](docs/scope.md)). The task router that picks the
cheapest member that can do a job, with its local mode and research, is a flake
of its own, [pi-task-router](https://github.com/GRBurst/pi-task-router)
(`programs.piTaskRouter`; a definition of the former
`programs.piEconomics.taskRouter` fails with that pointer). The patched
pi-actor-subagents that two components use is
[pi-setup](https://github.com/GRBurst/pi-setup)'s
(`programs.pi.actorSubagents`; the former
`programs.piEconomics.actorSubagents` fails likewise). Each component is
an option under `programs.piEconomics` and is off until you enable it (the
`piSettings` migration of pi's `settings.json` is the one default-on switch,
see Requirements).

## Components

| Option | What it does |
|---|---|
| `tokenMeter` | one JSON line per provider request (tokens, cost, quota headers, retries; no prompt text); `meter-report` and `pi-analyse` |
| `analysisSkill` | an agent skill that runs `pi-analyse` and proposes decisions from the logs |
| `cacheLifecycle` | elides stale tool results and thinking after the prompt cache expired; cache warming |
| `experiments` | one fractional-factorial arm per main session, recorded for the reports |
| `infiniteContext` | pi-infinite-context with two patches: absolute fold-reminder thresholds, a cost-aware fold hint |
| `retry` | pi-retry with a patch for OpenRouter's daily free-tier cap |
| `bench` | `pi-bench` and `bench-report`: arms, blind judges, bootstrap reports |
| `piSettings` | idempotent edits of pi's mutable `settings.json` that the components contribute |

Every option, its default and its effect: [`docs/pi-economics.md`](docs/pi-economics.md).
What is logged and measured, and how to run the reports and the bench:
[`docs/pi-token-economics.md`](docs/pi-token-economics.md); the log formats:
[`packages/token-meter/LOGS.md`](packages/token-meter/LOGS.md).

## Use

Add the flake as an input and let it follow your `nixpkgs` and `home-manager`
(its two patched upstreams are `flake = false` inputs; the patches apply to
the revisions in this flake's `flake.lock`, so let them follow another
revision of yours only if the patches still apply):

```nix
inputs = {
  nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  home-manager = {
    url = "github:nix-community/home-manager";
    inputs.nixpkgs.follows = "nixpkgs";
  };
  pi-economics = {
    url = "github:GRBurst/pi-economics";
    inputs.nixpkgs.follows = "nixpkgs";
    inputs.home-manager.follows = "home-manager";
  };
};
```

Import `inputs.pi-economics.homeModules.default` in your Home Manager
configuration (for example `home-manager.sharedModules =
[inputs.pi-economics.homeModules.default];`) and enable what you want:

<!-- checked: checks/module-eval/fixtures/readme-example.nix -->
```nix
{
  programs.piEconomics = {
    # Children are metered and kept warm when pi-setup's patched
    # actor-subagents (programs.pi.actorSubagents) is in the registry.
    tokenMeter.enable = true;
    cacheLifecycle.enable = true;
  };
}
```

The agent directory defaults to `~/.pi/agent`;
`programs.piEconomics.agentDir` moves it.

The patched actor-subagents comes from pi-setup: its `homeModules.default`
with `programs.pi.actorSubagents.enable = true`, and its economics bridge
`homeModules.piEconomics`, which forwards `programs.pi.extensions` (the
actor's entry included) to `programs.piEconomics.extensions` and hands the
children's list (`childExtensions`) back to the actor's settings file. The
components see the actor when `programs.piEconomics.extensions` has an entry
`actor-subagents`; without one, `cacheLifecycle` and `experiments` warn and
`retry` adds no child rule.

## Without Nix

The repository is also a pi package: the three own extensions (token meter,
experiments, cache lifecycle) and the analysis skill, without Home Manager.
The task router is a package of its own,
[pi-task-router](https://github.com/GRBurst/pi-task-router).

```sh
pi install git:github.com/GRBurst/pi-economics@v0.2.0
```

Nix only: `bench`, the `piSettings` migration, the Home Manager options and
the patched upstreams (below).

### Prerequisites

Two components use the subagent runner pi-actor-subagents through its
spawn-policy API, in part. Install the upstreams you want
yourself; their sources are in [`NOTICE`](NOTICE). pi-economics warns once when
it misses the API and switches off only what needs it.

| Package | Used by | Without it |
|---|---|---|
| pi-actor-subagents | used by `cache-lifecycle`, `experiments` | cache lifecycle does not keep sessions waiting on children warm; experiments children do not inherit an arm. Patched build via pi-setup's Nix module (programs.pi.actorSubagents); upstream support pending. |
| pi-infinite-context | optional | the upstream's fold reminders work as they are; the per-model reminder thresholds and the cost-aware fold hint come only with the patched build via the pi-economics Nix modules (upstream support pending for that part). |
| pi-retry | optional | the meter's retry accounting works with the upstream (it reads its `pi-retry:*` events); the handling of OpenRouter's daily free cap (that 429 is not retried) comes only with the patched build via the pi-economics Nix modules (upstream support pending for that part). |

### Experiments are opt-in

`experiments` does nothing until `<agentDir>/experiments/settings.json` exists
(`~/.pi/agent/experiments/settings.json` by default). With the file, each main
session gets an arm and `experiments/assignments.jsonl` is written. The
smallest file:

```json
{ "mode": "explore" }
```

### Load a subset

Use pi's object form of a `packages` entry in `~/.pi/agent/settings.json`, or
`pi config`. This entry loads two of the three extensions:

<!-- checked: checks/pi-package/subset.json -->
```json
{
  "source": "git:github.com/GRBurst/pi-economics@v0.2.0",
  "extensions": [
    "packages/token-meter/index.ts",
    "packages/cache-lifecycle/index.ts"
  ]
}
```

### Settings worth knowing

- `cacheLifecycle` decides pi's idle cache warming only while pi's own
  `settings.json` says `"cacheWarming": "idle"` (pi's default is `streaming`).
- Children loaded by pi-actor-subagents load none of these extensions unless its
  `<agentDir>/actor-subagents/settings.json` lists them in `childExtensions`:

  ```json
  {"childExtensions": ["~/.pi/agent/git/github.com/GRBurst/pi-economics/packages/token-meter/index.ts"]}
  ```

  pi expands a leading `~` in these paths (they reach its resource loader as
  extension sources).

### The commands

`meter-report` and `pi-analyse` are `bin` entries. Install them from the clone
pi made, as a directory (npm links it, so Node's type stripping works):

```sh
npm install -g ~/.pi/agent/git/github.com/GRBurst/pi-economics
```

`npx` and `npm install -g github:…` copy the files under `node_modules`, where
Node refuses to strip types (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`,
measured with Node 24). Without the install, run
`node --experimental-strip-types --no-warnings <clone>/packages/token-meter/bin/pi-analyse.ts`.

### Together with the Nix modules

When two copies of a component are loaded, the first one pi starts runs and
the other stays inert. This holds for the package next to the Nix modules and
for the package in two scopes; a copy that pi loads and then leaves out (a
user-scope package that a project entry replaces) takes no part. The inert
copy says so once at start (`pi-economics: <component> is loaded
twice`). Keep one: `pi remove <source>`, or switch the component off in Nix. The
analysis skill is then loaded twice as well:
pi reports a name collision for `pi-token-economics-analysis` and keeps one of them.

The guard needs both copies at this version or later. A Nix input older than
the package makes no claim: both copies then run, the meter logs every request
twice, and nothing is said. Remove one of them.

## Requirements

Home Manager on Linux (the checks run on `x86_64-linux`) and the pi coding
agent: the checks build and test against pi 1.3.0 (`checks/npm`), the
components declare `>=1.0.0`, and pi-setup's patched actor-subagents assumes
pi 1.2.0 or later. Nothing is installed or patched globally: each component is linked
into `<agentDir>/extensions`.

`piSettings` is on by default and edits pi's mutable
`<agentDir>/settings.json` idempotently, but only for the components you
enable: `retry` removes the `pi-retry` package entries that `pi install` wrote
and sets the `piRetry` keys you give it; `cacheLifecycle` sets
`cacheWarming` to `"idle"` in an existing file. `programs.piEconomics.piSettings.enable = false`
switches all of it off.

## Development

`AGENTS.md` has the commands: one capped `nix build` per check, never
`nix flake check` without a memory cap, Alejandra for formatting. Every change
starts with a failing check.

Comments cite the design record and the milestone plans (`spec §n`, `HS §n`
for another design record, decisions `D…`, success criteria `SC…`, tasks `T…`,
`M…`, plans by name), review ids (`review-…`, `R…`) and commit hashes other
than the upstreams' (7 to 40 hex digits: the author's system configuration or
this repository's earlier history). They were written while the components
moved out of the author's system configuration and are kept there, not in this
repository; the citations are provenance, not required reading. The module
contract is `docs/pi-economics.md`.

## Licence

MIT, see [`LICENSE`](LICENSE). Three components build patched copies of
upstream extensions; their authors and licences are in [`NOTICE`](NOTICE).
