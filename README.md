# pi-economics

The [pi](https://github.com/earendil-works/pi) coding agent's token-economics
stack as Home Manager components: a meter that logs every provider request, a
task router that picks the cheapest member that can do a job, prompt-cache and
context-window management, online experiments, retries, and a bench to measure
all of it on your own work. Each component is an option under
`programs.piEconomics` and is off until you enable it (the `piSettings`
migration of pi's `settings.json` is the one default-on switch, see
Requirements).

## Components

| Option | What it does |
|---|---|
| `actorSubagents` | pi-actor-subagents with two patches (child prompt, spawn policy); the base for the router and the meter's child accounting |
| `tokenMeter` | one JSON line per provider request (tokens, cost, quota headers, retries; no prompt text); `meter-report` and `pi-analyse` |
| `analysisSkill` | an agent skill that runs `pi-analyse` and proposes decisions from the logs |
| `cacheLifecycle` | elides stale tool results and thinking after the prompt cache expired; cache warming |
| `experiments` | one fractional-factorial arm per main session, recorded for the reports |
| `taskRouter` | routes subagent spawns by task card to the cheapest capable member (local, free-cloud, Haiku, Sonnet, …) |
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
