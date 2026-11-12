# pi-economics

The [pi](https://github.com/earendil-works/pi) coding agent's token-economics
stack as Home Manager components: a meter that logs every provider request, a
task router that picks the cheapest member that can do a job, prompt-cache and
context-window management, online experiments, retries, and a bench to measure
all of it on your own work. Scope: a purely exploratory framework — the model
router (`taskRouter`, including local mode) is slated to be extracted into a
separate plugin, and the research cleanup tool into its own repository
([docs/scope.md](docs/scope.md)). Each component is an option under
`programs.piEconomics` and is off until you enable it (the `piSettings`
migration of pi's `settings.json` is the one default-on switch, see
Requirements).

## Components

| Option | What it does |
|---|---|
| `actorSubagents` | pi-actor-subagents with three patches (child prompt, spawn policy, spawn API); the base for the router and the meter's child accounting |
| `tokenMeter` | one JSON line per provider request (tokens, cost, quota headers, retries; no prompt text); `meter-report` and `pi-analyse` |
| `analysisSkill` | an agent skill that runs `pi-analyse` and proposes decisions from the logs |
| `cacheLifecycle` | elides stale tool results and thinking after the prompt cache expired; cache warming |
| `experiments` | one fractional-factorial arm per main session, recorded for the reports |
| `taskRouter` | routes subagent spawns by task card to the cheapest capable member (local, free-cloud, Haiku, Sonnet, …); `/force` fixes the model; local mode, for a main session on a local model: hints, an Opus overseer, worktree branches, a merge gate and plans; slated to be extracted into a separate plugin ([docs/scope.md](docs/scope.md)) |
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
(its three patched upstreams are `flake = false` inputs; the patches apply to
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
    # The patched subagent runner; the router and the meter hook into it.
    actorSubagents.enable = true;
    tokenMeter.enable = true;
    taskRouter = {
      enable = true;
      # Optional: a local model server, with a pi provider named `llama` in
      # your models.json. Without one answering on `health`, the router
      # routes on to the next member.
      settings.models."qwen-local" = {
        model = "llama/qwen3.8";
        health = "http://localhost:11545";
      };
    };
  };
}
```

`taskRouter` needs `actorSubagents` (an assertion says so). The agent
directory defaults to `~/.pi/agent`; `programs.piEconomics.agentDir` moves it.

## Without Nix

The repository is also a pi package: the four own extensions (token meter,
experiments, cache lifecycle, task router) and the analysis skill, without
Home Manager.

```sh
pi install git:github.com/GRBurst/pi-economics@v0.1.2
```

Nix only: `bench`, the `piSettings` migration, the Home Manager options and
the patched upstreams (below).

### Prerequisites

The task router and, in part, two other components use the subagent runner
pi-actor-subagents through its spawn-policy API. Install the upstreams you want
yourself; their sources are in [`NOTICE`](NOTICE). pi-economics warns once when
it misses the API and switches off only what needs it.

| Package | Used by | Without it |
|---|---|---|
| pi-actor-subagents | required by `task-router`; used by `cache-lifecycle`, `experiments` | the router is off (no `task_verdict`, no task cards, no nudge; its effort guard stays on); cache lifecycle does not keep sessions waiting on children warm; experiments children do not inherit an arm. The router's local mode needs the actor's spawn API (the third patch): with an actor that lacks it, local mode warns once, refuses every merge and offers no plans. Patched build via the pi-economics Nix modules; upstream support pending. |
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
`pi config`. This entry loads two of the four extensions:

<!-- checked: checks/pi-package/subset.json -->
```json
{
  "source": "git:github.com/GRBurst/pi-economics@v0.1.2",
  "extensions": [
    "packages/token-meter/index.ts",
    "packages/task-router/index.ts"
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
components declare `>=1.0.0`, and the patched actor-subagents assumes pi 1.2.0
or later. Nothing is installed or patched globally: each component is linked
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
