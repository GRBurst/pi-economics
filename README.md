# pi-economics

The [pi](https://github.com/earendil-works/pi) coding agent's token-economics
stack as Home Manager components: a meter that logs every provider request in
the unit that binds your setup (subscription quota, API-equivalent dollars,
local machine time), per-session online experiments over pi's own settings and
the extensions you run, prompt-cache and context-window management, and a
bench to measure all of it on your own work. Scope: a purely exploratory
framework ([docs/scope.md](docs/scope.md)). The task router that picks the
cheapest member that can do a job, with its local mode and research, is a flake
of its own, [pi-task-router](https://github.com/GRBurst/pi-task-router)
(`programs.piTaskRouter`; a definition of the former
`programs.piEconomics.taskRouter` fails with that pointer). The patched
pi-actor-subagents that two components use is
[pi-setup](https://github.com/GRBurst/pi-setup)'s
(`programs.pi.actorSubagents`; the former
`programs.piEconomics.actorSubagents` fails likewise). The former `retry`
component is gone: pi's native retry (its `retry.*` settings) handles
transient errors, and a definition of `programs.piEconomics.retry` fails
saying so. Waiting out a quota window is the job of the quota waiter, an
extension of its own that is not part of this repository or of 0.3.0; metering
its waits ships after 0.3.0. Each component is
an option under `programs.piEconomics` and is off until you enable it (the
`piSettings` migration of pi's `settings.json` is the one default-on switch,
see Requirements).

## Components

| Option | What it does |
|---|---|
| `tokenMeter` | one JSON line per provider request (tokens, cost, billing class, timing, quota headers, retries; no prompt text) and the value and source of every lever in force; `meter-report` and `pi-analyse`, whose report opens with the budget (quota windows, calibration, spend, local cost) |
| `analysisSkill` | an agent skill that runs `pi-analyse` and proposes decisions from the logs |
| `cacheLifecycle` | elides stale tool results and thinking after the prompt cache expired; cache warming |
| `experiments` | one randomized arm per main session, per setup (stratum) with its own objective; assigns levers through add-ons and reads each back (confirmed, refused or unverified) |
| `infiniteContext` | pi-infinite-context with one patch: fold-reminder limits (a number or a range) per provider or model |
| `bench` | `pi-bench` and `bench-report`: arms, blind judges, bootstrap reports, process-scope pi levers |
| `piSettings` | idempotent edits of pi's mutable `settings.json` that the components contribute, among them the load order (the components start first) |

Every option, its default and its effect: [`docs/pi-economics.md`](docs/pi-economics.md).
What is logged and measured, and how to run the reports and the bench:
[`docs/pi-token-economics.md`](docs/pi-token-economics.md); the log formats:
[`packages/token-meter/LOGS.md`](packages/token-meter/LOGS.md).

## Use

Add the flake as an input and let it follow your `nixpkgs` and `home-manager`
(its one patched upstream, pi-infinite-context, is a `flake = false` input; the
patch applies to the revision in this flake's `flake.lock`, so let it follow
another revision of yours only if the patch still applies; the inputs
`pi-setup` and `pi-task-router` serve its checks only):

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
actor's entry included) and `programs.pi.agentDir` to
`programs.piEconomics.extensions` and `agentDir` and hands the
children's list (`childExtensions`) back to the actor's settings file (a
pi-setup that does not forward a moved `agentDir` leaves the components out of
it). The components see the actor when `programs.piEconomics.extensions` has an entry
`actor-subagents`; without one, `cacheLifecycle` and `experiments` warn.

## Upgrading to 0.3.0

0.3.0 redesigns the measurement core; what a consumer of 0.2.0 meets:

- **Meter lines are v2** (billing class, timing, per-request retries, `levers`
  lines, compaction lines); the readers still read v0 to v2. Set
  `tokenMeter.plans` (a provider's billing class, quota windows, a local
  provider's hourly `rate`) and, for money in two currencies,
  `tokenMeter.currencyRates`: without a plan every provider counts as `api`
  and the report says so.
- **The experiment has strata**: one design and one objective per setup. The
  default cloud strata keep the three cache-lifecycle factors (the former design
  v4); the default `local` stratum draws infinite-context's fold-reminder limit,
  and only for a model whose reminder rule has a range. The v1 engine's
  `factors`, `maxArms` and `baseline` settings are not applied. The global
  `__piExperimentsApi_v1` is removed (extensions get their levers on an internal
  channel), and `experiments` loads in children too.
- **`infiniteContext.reminders`** takes `nudgeAtTokens` (a number or a range)
  and `nudgeAtPercent` per provider or model; `startTokens`, `everyTokens`,
  `prices`, `cacheTtlMinutes` and `foldHint` of the earlier patch are gone (a
  definition is an unknown option).
- **`programs.piEconomics.retry` is removed** (a definition fails: pi's native
  `retry.*` settings handle transient errors); `taskRouter` and
  `actorSubagents` moved in 0.2.0. A leftover `piRetry` key in `settings.json`
  does nothing and can be deleted.
- **Load order**: the components start before every other extension that is not
  built in; with `piSettings.enable = false` list `loadOrder` yourself.

Every option and what a removed one says: [`docs/pi-economics.md`](docs/pi-economics.md).

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
| pi-actor-subagents | used by `cache-lifecycle`, `experiments` | cache lifecycle does not keep sessions waiting on children warm; experiments does not recognise in-memory children (children with a session file still run their root's arm). Patched build via pi-setup's Nix module (programs.pi.actorSubagents); upstream support pending. |
| pi-infinite-context | optional | the upstream's fold reminders work as they are; the reminder limits per provider or model come only with the patched build via the pi-economics Nix modules (upstream support pending for that part). |

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

### Load order

pi starts the extensions that `settings.json` lists in `extensions` and those
in `<agentDir>/extensions` before any package's, and packages in the order of
`packages`. `pi install` appends to that list: move the pi-economics entry
first in `packages`, and its components start before other packages'
extensions. Before extensions outside packages only the Nix modules put them.

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
agent: the checks type-check against pi 1.3.0's packages (`checks/npm`) and
load pi 1.4 offline, the components declare `>=1.0.0`, and pi-setup's patched
actor-subagents assumes pi 1.2.0 or later. Nothing is installed or patched globally: each component is linked
into `<agentDir>/pi-economics/extensions`, a directory pi does not discover,
and the `piSettings` entry puts the links at the front of `<agentDir>/settings.json`'s
`extensions`: pi starts pi-economics' components before every other extension
of the user scope that is not built in (`experiments`, `token-meter`,
`cache-lifecycle`, `infinite-context`, then the registry's other entries by
name; a trusted project's extensions and `pi -e` still start first), and the
actor's children get them in the same order.

`piSettings` is on by default and edits pi's mutable
`<agentDir>/settings.json` idempotently, creating it if absent: the registry
at the front of `extensions` and, with `cacheLifecycle`, `cacheWarming` set
to `"idle"`.
`programs.piEconomics.piSettings.enable = false` switches all of it off; the
components then load only once you put `programs.piEconomics.loadOrder` at the
front of `extensions` yourself (a warning says so).

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

MIT, see [`LICENSE`](LICENSE). One component builds a patched copy of an upstream extension; its author and
licence are in [`NOTICE`](NOTICE).
