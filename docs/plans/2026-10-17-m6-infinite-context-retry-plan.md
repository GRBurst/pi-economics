# M6 — `infiniteContext` and `retry`: TDD plan

Date: 2026-10-25 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 · Milestone: M6 (§9) · Base: this repository at the **planned end of M4** (plan `docs/plans/2026-10-17-m4-cache-experiments-plan.md`, `ed4a9eb`). While this plan was written M3 was finishing (HEAD `0b6cab3`, the implementer running its gate) and M4 had not started. M5 (taskRouter) is blocked on the host's router redesign; nothing here depends on it (§9: "M6 does not depend on M5 and may land first").

Source commit: host dotfiles **`4c714f0`** ("update nixos: update flakes, rebase patches, update configurations"; the owner's input and patch update). Drift checked while planning: `git dot diff --stat 4c714f0 3255db4 -- <every path below and every path M0–M4 moved>` is empty (host HEAD `3255db4`, 2026-10-25, task-router work only); `f6a3c81..4c714f0` leaves `ai/pi-extensions.nix`, `ai/pi-settings-migrate.nix`, `checks/pi-settings-migrate`, token-meter, cache-lifecycle, experiments and `pkgs/pi-bench` unchanged. Task M6.0 checks again. Paths, `ai` = `modules/home-manager/features/ai`, read with `h <path>` (= `git dot show 4c714f0:projects/nixos/new/<path>`):

- `ai/pi-actor-subagents.nix`, `ai/pi-actor-subagents-{child-prompt,spawn-policy}.patch` (`-first-turn.patch` deleted: pi 1.2.0 runs `before_agent_start` for extension-triggered runs; child-prompt is byte-equal to this flake's copy, spawn-policy is rebased), `checks/pi-actor-subagents/default.nix` (also leaves out `panel.test.ts` and `pi-*.test.ts`; new greps for the error-notice gate);
- `ai/pi-infinite-context.nix`, `ai/pi-infinite-context-{reminders,cache}.patch` (`-foreign-messages.patch` deleted: upstream `e6ff6803` matches the projection as an ordered subsequence); `checks/pi-infinite-context/{default.nix,integration.test.ts,overlay-foreign.test.ts,stubs/{pi-coding-agent,typebox}/{index.js,package.json}}`;
- `ai/pi-retry.nix`, `ai/pi-retry-free-cap.patch` (`-print-mode.patch` deleted: upstream 0.11.0 retries print/json sessions inline); `checks/pi-retry/{default.nix,package.json,package-lock.json}` (pi-retry 0.11.3; devDependencies `@earendil-works/pi-*` 1.3.0, `typescript` 6.0.3, `@types/node` 25.9.1, `vitest` 4.1.7; `npmDepsHash` `sha256-S8lO6fS9S3hRNlUdv7hztyfECeHBzeNArqaDjDQYqBE=`);
- `flake.lock` nodes this flake shares: `nixpkgs` (host node `nixpkgs_4`) `3ec636362e1816bc2f0888fa0fa2c69f1bc9e504`, `home-manager` `c216bf5a1f173b0481bd5c8c489ebe5595ecc68c`, `pi-actor-subagents` `822a228e4d6e494c98a6946c9cf812fdd0c96a9d`, `pi-infinite-context` `4c66601b71e629210cf1606f12526e6af5a8a8bf`, `pi-retry` `60a3b088145cf92dc6885f9fd8c785ed59a2b198`;
- read only: `ai/pi-extensions.nix` lines 42–56 (the two derivations), 82–88 and 134–144 (their registry entries), 240–256 (`reminderRule`, `renderRule`), 268–334 (`piContextReminders`), 392–413 (the settings file); `ai/pi-settings-migrate.nix`; `homes/pallon/default.nix` lines 28–54 (the host's reminder values); `docs/pi-token-economics.md` (the doc move, M6.D).

The host is **read-only** (another agent commits there with pathspecs): `git dot show`/`archive`/`diff` only.

## Motivation

§9 row M6: `infiniteContext` (the patched upstream and its reminder options) and `retry` (the patched upstream, its piSettings ops); the bench's `extensions` default from the packages. The host's two patched upstreams move into the flake as packages built from two new `flake = false` inputs, each with the host's check (§8.1: infinite-context's `node --test` over the patches' tests, an integration test and an overlay test; pi-retry's vitest suite on the shared npm lock), and each passes `tsc --strict`. `programs.piEconomics.infiniteContext` registers `infinite-context` (main sessions and children) and always writes `<agentDir>/infinite-context/settings.json` from the `reminders` options that replace the host's `piContextReminders` (§5.2), with `settings` merged into it by `lib.recursiveUpdate` (§4). `programs.piEconomics.retry` registers `pi-retry` (children too) and writes no file: it contributes `piSettings.ops.retry` — today's two stale-package removals, the child rule while `actorSubagents` is enabled (§4.1, no warning), and one `set` per leaf of `settings` under `piRetry` at order 500 (§5.4). The host changed the shared upstreams and the npm lock (pi 1.3.0) after M2 copied them, so group M6.0 first resyncs actorSubagents, the shared lock nodes and the npm lock to `4c714f0` (§9 "Drift"). The move is pure (§1): patches and checks are the host's bytes (one test line excepted, D5), the packages are the host's derivations on the host's nixpkgs, and with default options every file and op is today's.

## Approach

- **M6.0 resync** (drift, §9): the lock nodes `nixpkgs` and `home-manager` move to the host's revisions with `nix flake lock --override-input` (M0 D1); the shared npm lock (`checks/npm/{package.json,package-lock.json}`) becomes the host's `checks/pi-retry` pair at `4c714f0` with its hash; actorSubagents gets input `822a228`, the host's two patches, the host's check, and a package header without the first-turn bullet. The spawn-policy patch's new test adds `abortBash` to a fake typed `SessionLike`, which `tsc` rejects (TS2353); the flake's copy drops that line (D5). Every M0–M4 package's derivation then equals the host's at `4c714f0`.
- **Packages:** `packages/infinite-context/package.nix` and `packages/retry/package.nix` are the host's `ai/pi-infinite-context.nix` and `ai/pi-retry.nix` with the patch paths moved to `patches/pi-{infinite-context,retry}/` and `pkgs.applyPatches` taken as the argument `applyPatches` (M2's form). Flake inputs `pi-infinite-context`, `pi-retry` (`flake = false`, locked to the host's revisions), outputs `packages.x86_64-linux.{infinite-context,retry}`.
- **Checks:** `infinite-context` = the host's `checks/pi-infinite-context` (all files byte-equal) on the package; `retry` = the host's `checks/pi-retry/default.nix` with its private `nodeModules` replaced by the shared `npm.nodeModules` (the same derivation: same pname, source set and hash). `typecheck-infinite-context` over the patched `extensions/` without upstream's two fast-check tests, plus `package.json`; `typecheck-retry` over `retry.ts`, `src/` and `package.json` (D7, D8). No interface comparison (§5.3: the infinite-context patch is excluded; pi-retry exposes no API).
- **Modules:** `modules/infinite-context.nix` (S6): `enable`, `src` (internal, set by `homeModules.default` from the input, as actorSubagents, M2 Q3), `package`, `reminders.{prices,cacheTtlMinutes,foldHint,default,overrides}` (the host's options and descriptions), `settings`; the registry entry; the file `lib.recursiveUpdate (render reminders) settings`. `modules/retry.nix` (S7): `enable`, `src`, `package`, `settings`; the registry entry; `piSettings.ops.retry`.
- **Bench:** `bench.extensions` gets one `lib.mkDefault` definition per flake package the bench loads by name (`actor-subagents`, `infinite-context`, `pi-retry`, `token-meter`), so the host adds `claude-auth` and `web-search` at W without repeating them (D11). `bench-defaults` changes: `PI_BENCH_EXT_DIR` is now exported by default (§7).
- **Cases:** `checks/module-eval/cases/infinite-context.nix` (6) and `cases/retry.nix` (7, the host-like case included) (S8, S9), `bench-extensions-default` in `cases/bench.nix`, both components in `cases/together.nix`. `home-files` builds both extension directories, parses the rendered `infinite-context/settings.json` with the package's own `parseSettingsWithError`, and runs `ops.retry` through the activation's script (S10).
- **Doc move** (M6.D, movable): `docs/pi-token-economics.md` moves here, scrubbed, in the last of M5/M6 to land, before W (§2, M0 plan Q5).

## Decisions

| # | Choice | Why | Rejected |
|---|---|---|---|
| D1 | Source `4c714f0`; its drift into M0–M4's paths is ported first (group M6.0), each step with its check | §9 "Drift": a milestone starts from the host's current state; `4c714f0` dropped three patches (first-turn, foreign-messages, print-mode) that the spec's §2/§9 rows still name | Moving `f6a3c81`'s state: three dead patches, and pi-retry 0.10 against a host on 0.11.3 |
| D2 | Lock nodes `nixpkgs`, `home-manager` → the host's revisions, by `nix flake lock --override-input` (M0 D1); `{locked, original}` equal the host's | Every package and check derivation then is the host's at `4c714f0`; the host's `follows` changes nothing at W | Keeping `c59305b`: the moved packages' derivations would differ from the host's, and the purity comparisons (D6, D9) would not hold |
| D3 | Shared npm lock = the host's `checks/pi-retry/{package.json,package-lock.json}` at `4c714f0`, `npmDepsHash` `sha256-S8lO6fS9…`; `checks/npm/default.nix` keeps pname and source set | §3: one lock, pi-retry's; pi-retry's suite needs its own lock (vitest 4.1.7, pi 1.3.0); the derivation stays the host's `pi-retry-test-deps` | A second lock for pi-retry: §3 has one |
| D4 | actorSubagents: input `822a228`; the host's `child-prompt` (already byte-equal) and `spawn-policy` patches; `first-turn` deleted; `checks/actor-subagents/default.nix` = the host's `checks/pi-actor-subagents/default.nix`; package header without the first-turn bullet; `spawnPolicyApi` stays 1 | Drift (§9); the host's check now leaves out `panel.test.ts` and `pi-*.test.ts` (they import pi's peer packages) and pins the error-notice gate; `iface-subagents-bench-probe` stays green, so the API type is compatible | Keeping first-turn: it no longer applies, and pi 1.2.0 made it moot |
| D5 | `spawn-policy` patch copy, line 1358: `+\t};` → `+\t} as Partial<SessionLike> as SessionLike & { delivered: RoutedAgentMessage[] };` (the fake in `spawn-policy.test.ts`) | Under `tsc --strict` the fake carries `abortBash` and lacks `appendAgentMessage`, `isStreaming`, `getExtensionStatuses` after upstream's `SessionLike` changed (TS2353). Type-only, erased by `--experimental-strip-types`; one line, the hunk's line count unchanged; the double cast keeps the contextual type, so the fake's parameters stay typed | Deleting the `abortBash` line (seen: TS2322, the three missing members); `} as never` (seen: three TS7006, the contextual type is lost); completing the fake (a fixture change with behaviour); leaving `spawn-policy.test.ts` out of the type check (open question Q1) |
| D6 | `packages/{infinite-context,retry}/package.nix` = the host's `ai/pi-{infinite-context,retry}.nix`: `applyPatches` as an argument (M2's form), patch paths `../../patches/pi-<input>/<host name>`, a header without the host's document citations (§2) | Same names and bytes → the host's derivations (prototype: `i69aki1i…-pi-infinite-context-patched.drv`, `5jq7phiv…-pi-retry-patched.drv`) | `pkgs.applyPatches` with `{pkgs, src}`: M2 set the argument form |
| D7 | `typecheck-infinite-context` over `extensions/` without `archive-properties.test.ts`, `forest.test.ts`, plus `package.json`, without upstream's root `tsconfig.json` | Those two import `fast-check`, which the shared lock does not hold (TS2307) and which the check does not run either; root `tsconfig.json` → TS5112 (M2.2). Prototype: 0 errors | Adding `fast-check` to the shared lock: the lock is the host's pi-retry lock, byte for byte (D3) |
| D8 | `typecheck-retry` over `retry.ts`, `src/`, `package.json`; `__tests__/` and `vitest.config.ts` out | With `__tests__`: 3 errors, `child-retry.test.ts(58)` TS2345 (upstream's) and `error-patterns.test.ts(476,483)` TS2339 `errorMessage` (inside the free-cap patch's own test). The code pi loads is checked; vitest runs the tests | Fixing the tests: an upstream test hunk plus a patch edit (open question Q2) |
| D9 | `checks/infinite-context/**` = the host's `checks/pi-infinite-context/**` byte for byte; `checks/retry/default.nix` = the host's with its private `nodeModules` taken as an argument (`inherit (npm) nodeModules`) and its header pointing at `checks/npm` | The shared lock's derivation is the one the host builds privately (same pname, source set, hash), so the check's derivation stays the host's (prototype: `6wbdgsx5…`, `0jf9v492…`) | A second `buildNpmPackage` in `checks/retry`: the same derivation twice |
| D10 | Registry entries are the host's (`pi-extensions.nix:82-88,139-144`): `infinite-context` → `${package}/extensions/infinite-context`, `pi-retry` → `${package}`; `checkPath` on the unpatched input; `input` = the input name; `forChildren = true` for both; descriptions with `piContextReminders` → `infiniteContext.reminders` | §5.1; today's child set; the existence message names the input | `input = null` (M3–M4's in-tree packages): these come from inputs |
| D11 | `bench.extensions`: one `lib.mkDefault` definition per name in `modules/bench.nix`'s `config` — `actor-subagents`, `infinite-context`, `pi-retry`, `token-meter`, each the path its registry entry links; the option's `default` stays `{}` | §7 "after M6 its default covers the flake's own packages"; the names are the bench's `ORCH_EXTENSIONS`/`CHILD_EXTENSIONS` (`orch.ts:18-20`) that the flake builds (cache-lifecycle and experiments are not loaded by the bench); definitions merge per name, so the host adds `claude-auth` and `web-search` at W without repeating these and can replace one; `lib.mkForce {}` restores "export nothing" | The option's `default`: any host definition would replace it whole (open question Q3). Changing existing cases: `bench-defaults` gains `PI_BENCH_EXT_DIR`, `bench-extensions` expects the defaults plus its two (the behaviour §7 asks for) |
| D12 | `infiniteContext.reminders.*` = the host's `piContextReminders` options (types, defaults, examples; descriptions without host file names); the render is the host's (`pi-extensions.nix:397-413`); the file is `builtins.toJSON (lib.recursiveUpdate rendered settings)` | §5.2, §4 merge rule; with `settings = {}` the text is today's, `{"reminders":{"default":{},"overrides":{}}}` | `//`: a nested `settings.reminders` would drop the rendered siblings (planted red) |
| D13 | No Nix-side check of `infiniteContext.settings` keys; `home-files` runs the package's own `parseSettingsWithError` (`settings.ts`, imports only `node:util`) on the rendered file | The extension's schema is strict and has one owner; the check ties the render to it | A Nix list of allowed keys: a second schema that drifts |
| D14 | `ops.retry` = `[remove https…, remove git:…] ++ optional actorSubagents.enable childRule ++ leaves ["piRetry"] settings`; a leaf is any non-attrset value (lists included), each `{op = "set"; order = 500;}`; an empty attrset yields nothing | §5.4; settings ops last in the list keep today's ops' indices, and order 500 sorts them first anyway | A whole-object `set` (§5.4 forbids it) |
| D15 | No warning for `retry` without `actorSubagents`, none for `infiniteContext` | §4.1: both soft dependencies are unmarked (no *w*) | Warnings: §4.1 asks for none |
| D16 | `m6-host-like` (in `cases/retry.nix`): actorSubagents, tokenMeter, cacheLifecycle, experiments, infiniteContext, retry, `piSettings.enable = false` | §8.1 host-like combination; the host's state from W5 to W6 (§9.1): the flake's children are `cache-lifecycle`, `infinite-context`, `pi-retry`, `token-meter` | One case per pair |
| D17 | The doc move is task M6.D, executed in whichever of M5/M6 lands last (today M5 is blocked, so most likely M5 carries it); it is the last task before the close-out of that milestone and before W | §2, M0 plan Q5: the doc describes every component, the router included | Moving it in M6 regardless: the doc would describe a router the flake does not have |
| D18 | Code-comment citations (§2): the two package headers and `checks/retry`'s header are written without the host's documents; the patches and the copied checks' shell bodies stay byte-equal | §2 names code comments; editing a patch or a check body changes the host's derivation (D6, D9) | Re-pointing citations inside patches: their bytes would leave the host's |

## The gate

No principles document; the gate is §4's rules, §8's testing rules, `AGENTS.md` and the M0–M4 lessons.

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: every task has a RED; the green-first steps (lock moves, characterisations M6.15, M6.17) carry planted violations or a drift diff that is non-empty first |
| No `builtins.match` on generated text | PASS: `eq`, `holds`, `lib.hasSuffix`; `home-files` uses `jq -e` and node |
| Typed options; assertions for invariants | PASS: `enable`, `src` (internal), `package`, `reminders.*` (the host's types), `settings` (JSON object); no hard dependency (§4.1), so no assertion; no soft one marked *w*, so no warning (D15) |
| camelCase options, kebab-case directories (§4) | PASS: `infiniteContext`, `retry`; `packages/infinite-context`, `packages/retry`, `infinite-context/settings.json` |
| Settings files are literal text (§4) | PASS: `.text = builtins.toJSON …` |
| Merges with `lib.recursiveUpdate` (§4) | PASS: `infinite-context/settings.json` (D12); planted `//` turns `infinite-context-settings` red |
| Every assertion message `pi-economics:` with a negative case | N/A: no new assertion; the registry's existence assertion (M0) covers both entries |
| No import-from-derivation | PASS: `checkPath` on the inputs (`*-defaults` compare it with `self.inputs.<input>`), the file and ops read at evaluation |
| Contributor-keyed piSettings ops, today's order (§5.4) | PASS: key `retry`; `retry-pisettings` equals today's ops and program; `retry-settings` pins order 500 before 1000 |
| Scripts strict and dependency-explicit | PASS: `home-files` keeps `set -euo pipefail`, gains `pkgs.nodejs` |
| Alejandra on every changed `.nix` file | PASS: CLEAN steps; the prototype reformats `checks/retry/default.nix` (body de-indented) and `modules/bench.nix` |
| Markdown under `docs/` | PASS: `docs/pi-economics.md`; the doc move lands in `docs/` |
| `flake.lock` changes only as needed | PASS: two new inputs and three moved nodes, all equal to the host's (M6.1, M6.3, M6.4, M6.6) |
| Leak patterns (§8.3) | PASS: `leak` green in the prototype with both upstreams and the host's tests |
| Host read-only | PASS: `git dot show`/`archive`/`diff` only |
| Every check built with both `git+file://` and `path:` refs | PASS: M6.19 (prototype: all 19 checks green under both, on M3's state) |
| Pure move (§1) | PASS with one exception: package and check derivations of infinite-context and retry are the host's (D6, D9); actorSubagents' differs by D5's one type-only line (Q1); default files and ops are today's (M6.8, M6.12) |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION.

## Files to read first

Listed, not quoted; the tasks show only what changes.

- The spec: §1, §2 (rows `actorSubagents`, `infiniteContext`, `retry`; the documentation bullets), §3, §4 (rows `infiniteContext`, `retry`; Rules), §4.1 (soft dependencies), §5.1, §5.2, §5.3, §5.4 ("Order", "Today's sequence", "No whole-object set", "Component contributions"), §7 (`extensions`), §8.1, §8.3, §9 (row M6, "Drift"), §9.1 W5, W6.
- The M4 plan: "Interfaces M4 publishes", D9, D13, D14, D15, S6, S9, S10 and its Execution Record (the final case count, `home-files`, `together.nix`). The M2 plan: D3, D8, Q3, Q4, S1–S3. The M0 plan: D1 (lock), `today-ops.nix`, `pi-settings-migrate`.
- This repository at M4's end: `flake.nix`, `checks/default.nix`, `checks/npm/default.nix`, `checks/actor-subagents/default.nix`, `checks/typecheck/default.nix`, `checks/module-eval/{default.nix,expect.nix,cases/bench.nix,cases/cache-lifecycle.nix,cases/together.nix}`, `checks/home-files/default.nix`, `checks/pi-settings-migrate/today-ops.nix`, `modules/{common,bench,actor-subagents,default}.nix`, `packages/actor-subagents/package.nix`.
- Host at `4c714f0` (`h <path>`): the paths in "Source commit" above.
- The prototype diff `~/.cache/pi/m6plan/m6-prototype.diff` (on M3's state; lock, npm lock, patches and the copied tests left out).
- This plan's Snippets.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| `tsc --strict` via `typecheck-actor-subagents` and `iface-subagents-*` | from M6.3 | until D5: `extensions/actor-subagents/spawn-policy.test.ts:25:3 - error TS2353: Object literal may only specify known properties, and 'abortBash' does not exist in type 'SessionLike & { delivered: RoutedAgentMessage[]; }'.` |
| `tsc --strict` via every `typecheck-*` and `iface-*` | M6.2 (npm lock) | nothing new: prototype green for harness, bench, token-meter, actor-subagents (M2's state), iface-harness; previous prototype: cache-lifecycle only M4's two planned errors, experiments clean |
| `tsc --strict` via `typecheck-infinite-context` | from M6.5 | with the two fast-check tests: TS2307 `fast-check`, TS7006; later any implicit `any` |
| `tsc --strict` via `typecheck-retry` | from M6.7 | a planted TS2322 in `src/`; `__tests__` is out (D8) |
| Nix module system | `module-eval` | unknown options (each module task's RED), a non-positive threshold, a `foldHint` outside the enum, a non-object `settings` |
| shellcheck | — | N/A: no new script (`home-files` is a `runCommand`) |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package tests, patched upstreams (`actor-subagents`, `infinite-context`, `retry`) | the host's checks: actor-subagents' `node --test` suite (331 tests in the previous prototype); infinite-context's settings, nudge, fold-hint, resync, overlay-foreign, integration (59 tests) and the `index.ts` greps; pi-retry's vitest suite (300 tests in 10 files) and the free-cap greps | nodejs; the stubs; the shared lock for retry; seconds each |
| Type check (`typecheck-*`) | `--strict` over the copies of D5, D7, D8 | the shared lock; ~15 s, 0.25 GiB |
| Interface comparisons (`iface-*`) | unchanged; they re-run against the resynced actor-subagents | M2's harness |
| Module evaluation (`module-eval`) | both components off, on, package, files, today's default file, the reminder render, the merge, the registry entries, today's ops and program, the child rule's soft dependency, the settings leaves, the host-like combination, the bench's extension default, every component together | Home Manager; M4's final count + 14 cases (prototype on M3's state: 57) |
| Build check (`home-files`) | the extension directories pi loads, the rendered settings file through the extension's parser, `ops.retry` through the activation's script | ~10 s |
| piSettings script (`pi-settings-migrate`, M0) | today's ops incl. `retry`'s, byte-compared with the legacy script | unchanged; `retry-pisettings` ties the component to it |
| Leak (`leak`) | the copied checks and the patches | — |
| Log contract | N/A: M5 (§8.1) | — |
| Layer B, activation | N/A: W5, W6 (§9.1), owner steps | — |

## Scenario coverage

| Scenario (spec) | Check |
|---|---|
| §9 Drift: shared lock nodes equal the host's | M6.1 / M6.3 / M6.4 / M6.6 Step "lock" (`jq` diff, empty) |
| §3 shared npm lock = host's pi-retry lock | M6.2 (`cmp` with `h`), `npm-deps` |
| §2 actorSubagents with the host's patches | `actor-subagents` (the host's check), `typecheck-actor-subagents`, `iface-subagents-bench-probe` (M6.3) |
| §2/§8.1 infinite-context patched, its tests | `infinite-context` (M6.4) |
| §8.1 tsc per package | `typecheck-infinite-context` (M6.5), `typecheck-retry` (M6.7) |
| §2/§8.1 pi-retry patched, vitest suite from the shared lock | `retry` (M6.6) |
| §4 infiniteContext file always written; defaults = today's | `infinite-context-files` (M6.8); `home-files` (M6.16) |
| §5.1 registry entries, children, existence probe on the input | `infinite-context-defaults` (M6.8), `retry-defaults` (M6.11) |
| §5.2 reminder options render as `piContextReminders` | `infinite-context-reminders` (M6.9) |
| §4 merge with `recursiveUpdate`, user on the right | `infinite-context-settings` (M6.10) |
| §4 retry: ops only, no file | `retry-defaults` (M6.11) |
| §5.4 `ops.retry` = today's; program = today's | `retry-pisettings` (M6.12); `pi-settings-migrate` (M0) |
| §4.1 child rule only with actorSubagents, no warning | `retry-alone` (M6.12) |
| §5.4 settings → one `set` per leaf under `piRetry`, order 500 | `retry-settings` (M6.13) |
| §7 bench `extensions` default from the packages | `bench-extensions-default`, `bench-defaults`, `bench-extensions` (M6.14) |
| §8.1 host-like combination | `m6-host-like` (M6.15) |
| §8.1 every component together | `components-together` (M6.17) |
| §9.1 W5 "infinite-context/settings.json unchanged" | `infinite-context-files` (text literal), `infinite-context-reminders` (host's values) |
| §2 doc move | M6.D (in the last of M5/M6) |

## Properties

- P1 `∀ i ∈ {nixpkgs, home-manager, pi-actor-subagents, pi-infinite-context, pi-retry}: lock(i).{locked, original} = hostLock(i).{locked, original}` (jq over both locks).
- P2 `drv(packages.infinite-context) = drv(host piInfiniteContext)`, `drv(packages.retry) = drv(host piRetry)`, `drv(checks.{infinite-context,retry}) = drv(host checks.pi-{infinite-context,retry})` (M6.19, `h`-archived host tree; prefixes in D6, D9).
- P3 `∀ dir ∈ dirs: targets(on) = targets(bare) ∪ {dir/extensions/infinite-context, dir/infinite-context/settings.json}`.
- P4 `fromJSON(file(reminders = v, settings = s)) = recursiveUpdate (render v) s`, with `render` the host's; for `v = default, s = {}` the text is today's literal (the literal *is* W5's criterion).
- P5 `ops.retry(actorSubagents) = withOrder today.retry`; `ops.retry(¬actorSubagents) = take 2 (withOrder today.retry)`; `program(ops.retry ∪ host) = program(today)`.
- P6 `∀ leaf (p, v) of settings: {set, ["piRetry"] ++ p, v, 500} ∈ ops.retry` and in `sortedOps` every order-500 op precedes every order-1000 op.
- P7 `bench.extensions(default) = {n ↦ registry path of n | n ∈ {actor-subagents, infinite-context, pi-retry, token-meter}}`; a definition `{x = p}` yields `defaults // {x = p}`.
- P8 `parseSettingsWithError(rendered file).error = undefined` (home-files).

## Planted violations

| Check | Plant | Must FAIL with | Task |
|---|---|---|---|
| `actor-subagents` | keep the old input and patches under the new check | grep `engine.deferErrorNotices = true` exits 1 (natural red) | M6.3 [ ] |
| `typecheck-actor-subagents` | none (natural): the host's patch unchanged | TS2353 `abortBash` | M6.3 [ ] |
| `npm-deps` | the new files with the old hash | hash mismatch, `got: sha256-S8lO6fS9…` | M6.2 [ ] |
| `infinite-context` | drop `pi-infinite-context-cache.patch` from the list | node --test failures (seen in the prototype: `TypeError: Cannot read properties of undefined (reading 'content')`) | M6.4 [ ] |
| `typecheck-infinite-context` | keep the two fast-check tests | TS2307 `Cannot find module 'fast-check'` | M6.5 [ ] |
| `retry` | drop `pi-retry-free-cap.patch` | vitest fails to collect (seen: `Tests 0 passed (27)`) or the grep `openrouter_free_tier_daily` exits 1 | M6.6 [ ] |
| `typecheck-retry` | add `__tests__` to `retryTs` | 3 errors (D8) | M6.7 [ ] |
| `infinite-context-settings` | `//` for `lib.recursiveUpdate` | `merged (.pi/agent): expected …` (seen in the previous prototype) | M6.10 [ ] |
| `retry-alone` | the child rule without `lib.optional pe.actorSubagents.enable` | `ops: expected …` (seen in the previous prototype) | M6.12 [ ] |
| `retry-settings` | `order = 1000` in `leaves` | `sequence: expected [ "500:retry:set:…` | M6.13 [ ] |
| `bench-extensions-default` | drop `pi-retry` from the defaults | `extensions: expected …` | M6.14 [ ] |
| `m6-host-like` | `forChildren = false` for `pi-retry` | `children: expected …` | M6.15 [ ] |
| `home-files` | `infiniteContext.settings.bogus = 1` | `FAIL .pi/agent: infinite-context rejects its settings.json` (seen: `settings: unknown key "bogus"`) | M6.16 [ ] |
| `home-files` | a third package `"keep"` in the retry input that survives | `FAIL .pi/agent: settings.json after ops.retry` (seen) | M6.16 [ ] |
| `components-together` | `home.file."x".text = ""` under `retry`'s `mkIf` | `home.file targets: expected …` | M6.17 [ ] |

## Coverage gap

- **Real pi.** No check loads infinite-context or pi-retry into pi: the stubs stand in for pi's packages (infinite-context), vitest drives pi-retry against pi's npm packages, not the binary. W5 and W6 activations (owner steps) cover it, as for the host today.
- **The activation on the real file.** `home-files` runs the script on a scratch file; the activation line is M0's.
- **infinite-context's cast of `__piExperimentsApi_v1`** (`cache.patch`): excluded by §5.3; a renamed `foldHint` flag in experiments passes every check here.
- **Upstream's fast-check tests** (`archive-properties`, `forest`) and every upstream infinite-context test that imports pi: not run (the host's check runs the same subset).
- **pi-retry's test types** (D8) and `spawn-policy.test.ts`'s fake (D5): typed loosely or not at all.
- **The bench's arms with the default extensions**: no check runs an arm; `claude-auth` and `web-search` are missing from the default until the host sets them at W (D11).
- **The host's readers** (`eval-assertions.nix` child set, `checks/pi-extensions.nix`, the seed): W5/W6 re-point them; `m6-host-like` mirrors the child set.

## Environment (every step)

```sh
source ~/.cache/pi/m0env.sh      # XDG dirs, cd, F (git+file), o, cap, nb, ne, fmt, nbl
Fp=path:$HOME/projects/nix/pi-economics
nbp() { (ulimit -v $cap && exec timeout -s KILL 1500 nix build --no-link -L "$Fp#checks.x86_64-linux.$1" "${o[@]}"); }
h() { git dot show "4c714f0:projects/nixos/new/$1"; }          # the source commit (m0env's host() reads f6a3c81)
ai=modules/home-manager/features/ai
lockeq() { for i in "$@"; do diff <(h flake.lock | jq -S --arg i "$i" '.nodes[.nodes.root.inputs[$i]] | {locked, original}') \
  <(jq -S --arg i "$i" '.nodes[.nodes.root.inputs[$i]] | {locked, original}' flake.lock) >/dev/null && echo "$i: as the host" || echo "$i: DIFFERS"; done; }
flag() { while [ -e ~/.cache/pi/pluto-exec/owner-deploy.flag ]; do sleep 60; done; }   # before every build above 2 GiB
```

- `nb`/`nbp` are capped (`ulimit -v 20971520`, `timeout -s KILL`); never `nix flake check`. Run `flag` before `module-eval`, the full loop and lock operations.
- `git+file:` sees only indexed files: `git add` new files before `nb`/`ne`.
- `module-eval`'s derivation depends only on the failure report and the case count: a change that keeps both green and the count equal is a cached build (no log). `nbl module-eval` forces the log.
- Plain `git` here; `git dot` only to read the host. Commits unsigned. Undo a plant with `git checkout -- <file>` after staging the green state; never `git checkout HEAD -- <dir>` over new files.
- TypeScript edits keep each file's indentation (the patches use tabs).

## File structure

| File | Responsibility | Task |
|---|---|---|
| `flake.lock` | `nixpkgs`, `home-manager` (M6.1), `pi-actor-subagents` (M6.3), `pi-infinite-context` (M6.4), `pi-retry` (M6.6) at the host's revisions | M6.1, M6.3, M6.4, M6.6 |
| `checks/npm/{package.json,package-lock.json}`, `checks/npm/default.nix` | the host's pi-retry lock at `4c714f0`; hash; header `f6a3c81` → `4c714f0` | M6.2 |
| `checks/actor-subagents/default.nix` | the host's `checks/pi-actor-subagents/default.nix` at `4c714f0` | M6.3 |
| `patches/pi-actor-subagents/*` | spawn-policy = the host's + D5's line; first-turn deleted | M6.3 |
| `packages/actor-subagents/package.nix` | two patches, header (S5) | M6.3 |
| `flake.nix` | inputs `pi-infinite-context`, `pi-retry`; `packages.{infinite-context,retry}`; `homeModules.default` sets both `src` (S1) | M6.4, M6.6, M6.8, M6.11 |
| `patches/pi-infinite-context/pi-infinite-context-{reminders,cache}.patch`, `packages/infinite-context/package.nix` | the host's patches; the derivation (S3) | M6.4 |
| `checks/infinite-context/{default.nix,integration.test.ts,overlay-foreign.test.ts,stubs/**}` | the host's check, byte for byte | M6.4 |
| `patches/pi-retry/pi-retry-free-cap.patch`, `packages/retry/package.nix` | the host's patch; the derivation (S3) | M6.6 |
| `checks/retry/default.nix` | the host's check on the shared lock (S4) | M6.6 |
| `checks/default.nix` | `infiniteContext`, `infiniteContextTs`, `retry`, `retryTs`; checks `infinite-context`, `typecheck-infinite-context`, `retry`, `typecheck-retry` (S2) | M6.4–M6.7 |
| `modules/infinite-context.nix`, `modules/default.nix` | the component (S6) | M6.8–M6.10 |
| `checks/module-eval/cases/infinite-context.nix`, `checks/module-eval/default.nix` | 6 cases (S8); `caseFiles` | M6.8–M6.10 |
| `modules/retry.nix`, `modules/default.nix` | the component (S7) | M6.11–M6.13 |
| `checks/module-eval/cases/retry.nix` | 7 cases (S9) | M6.11–M6.13, M6.15 |
| `modules/bench.nix`, `checks/module-eval/cases/bench.nix` | the extension defaults; `bench-defaults`, `bench-extensions` changed, `bench-extensions-default` new (S10) | M6.14 |
| `checks/home-files/default.nix` | both extension directories, the parser, `ops.retry` (S11) | M6.16 |
| `checks/module-eval/cases/together.nix` | `components` += `infiniteContext`, `retry` | M6.17 |
| `docs/pi-economics.md` | component sections, checks, the resync (S12) | M6.18 |
| `docs/pi-token-economics.md` | the moved document (S13) | M6.D (movable) |

Interfaces M6 publishes: options `programs.piEconomics.infiniteContext.{enable, package, reminders.{prices, cacheTtlMinutes, foldHint, default, overrides}, settings}` (W5 re-points the host's `piContextReminders` values here, W7 adds Haiku, §5.2) and `programs.piEconomics.retry.{enable, package, settings}` (W6); `src` of both (internal); `piSettings.ops.retry`; registry entries `infinite-context`, `pi-retry` (`forChildren = true`); `packages.x86_64-linux.{infinite-context,retry}`; `bench.extensions` defaults for four names (M5 adds `task-router` the same way); `cases/together.nix` with eight components; the shared npm lock at pi 1.3.0.

---

## Tasks

| Task | Delivers | Commit |
|---|---|---|
| M6.0 | read; M4 landed; drift | — |
| **M6.0 resync** | | |
| M6.1 | lock nodes `nixpkgs`, `home-manager` = the host's | `m6.0: nixpkgs and home-manager at the host's 4c714f0` |
| M6.2 | shared npm lock = the host's pi-retry lock (pi 1.3.0) | `m6.0: shared npm lock at the host's 4c714f0` |
| M6.3 | actorSubagents at `822a228`: check, two patches, header, D5 | `m6.0(actor-subagents): resync to the host's 4c714f0` |
| **M6 proper** | | |
| M6.4 | infinite-context: input, patches, package, check | `m6: infinite-context package and check from the host` |
| M6.5 | `typecheck-infinite-context` | `m6(infinite-context): tsc --strict` |
| M6.6 | retry: input, patch, package, check | `m6: pi-retry package and check from the host` |
| M6.7 | `typecheck-retry` | `m6(retry): tsc --strict` |
| M6.8 | infiniteContext: `enable`, `src`, `package`, registry entry, the file | `m6(infinite-context): module, package, registry entry, settings file` |
| M6.9 | `reminders` options | `m6(infinite-context): reminder options` |
| M6.10 | `settings` merged | `m6(infinite-context): settings merged into the file` |
| M6.11 | retry: `enable`, `src`, `package`, registry entry | `m6(retry): module, package, registry entry` |
| M6.12 | `ops.retry`: today's ops, child rule with actorSubagents | `m6(retry): today's piSettings ops` |
| M6.13 | `settings` → leaves at order 500 | `m6(retry): settings as piRetry leaves` |
| M6.14 | bench `extensions` defaults | `m6(bench): extensions default from the packages` |
| M6.15 | the host's combination (characterisation) | `m6: the host's combination of M2–M6` |
| M6.16 | `home-files` for M6 | `m6: home-files builds the M6 sources` |
| M6.17 | every component together | `m6: infiniteContext and retry together with the rest` |
| M6.18 | docs | `m6: docs for infiniteContext and retry` |
| M6.D | **movable:** the doc move, in the last of M5/M6 to land | `m<5|6>: move docs/pi-token-economics.md` |
| M6.19 | gate, purity, Execution Record | `m6: execution record` |

Every task starts at `[ ]`. One failing check at a time; a task's commit holds only green checks.

### Task M6.0 — Read, M4 landed, drift

- [ ] **Step 1:** read "Files to read first".
- [ ] **Step 2:** M4 landed: `git log --oneline | grep -c '^.\{8\} m4'` ≥ 21 commits and M4's Execution Record closed; note M4's final module-eval count `N4`.
- [ ] **Step 3 (drift):** `cd ~/projects/nixos/new && git dot diff --stat 4c714f0 HEAD -- flake.lock $ai/pi-actor-subagents* $ai/pi-infinite-context* $ai/pi-retry* checks/pi-actor-subagents checks/pi-infinite-context checks/pi-retry $ai/pi-extensions.nix $ai/pi-settings-migrate.nix checks/pi-settings-migrate homes/pallon/default.nix docs/pi-token-economics.md pkgs/pi-bench $ai/extensions/{token-meter,cache-lifecycle,experiments}` — expected empty (2026-10-25). A non-empty diff in a moved path is ported first, each change with its test (§9), and the source commit of this plan moves to that commit (`h` and the revisions below follow it); record it.
- [ ] **Step 4:** `flag; nb module-eval` green at M4's end (baseline).

### Task M6.1 — `nixpkgs`, `home-manager` at the host's revisions

**Files:** `flake.lock`.

- [ ] **Step 1 (RED):** `lockeq nixpkgs home-manager` → `nixpkgs: DIFFERS`, `home-manager: DIFFERS`.
- [ ] **Step 2 (GREEN):** `flag;` then
  ```sh
  (ulimit -v $cap && timeout -s KILL 600 nix flake lock "${o[@]}" \
    --override-input nixpkgs github:nixos/nixpkgs/3ec636362e1816bc2f0888fa0fa2c69f1bc9e504 \
    --override-input home-manager github:nix-community/home-manager/c216bf5a1f173b0481bd5c8c489ebe5595ecc68c)
  lockeq nixpkgs home-manager pi-actor-subagents
  ```
  → `nixpkgs: as the host`, `home-manager: as the host` (`pi-actor-subagents: DIFFERS` until M6.3).
- [ ] **Step 3 (GREEN, every check):** the full loop of M6.19 Step 2 with `git+file:` only: every check green on the new nixpkgs (the prototype on M3's state: green). A red check here is drift of nixpkgs, not of the host: stop and report it.
- [ ] **Step 4 (CLEAN):** `fmt --check $(git ls-files '*.nix')` (the formatter moved with nixpkgs) → no file "Requires formatting"; if one does, reformat it in this commit and say so.
- [ ] Commit.

### Task M6.2 — Shared npm lock at pi 1.3.0

**Files:** `checks/npm/{package.json,package-lock.json,default.nix}`.

- [ ] **Step 1 (RED, drift):** `cmp <(h checks/pi-retry/package-lock.json) checks/npm/package-lock.json` → differs.
- [ ] **Step 2 (RED):** `h checks/pi-retry/package.json > checks/npm/package.json; h checks/pi-retry/package-lock.json > checks/npm/package-lock.json; git add checks/npm; nb npm-deps` → hash mismatch, `got: sha256-S8lO6fS9S3hRNlUdv7hztyfECeHBzeNArqaDjDQYqBE=`. [ ] red seen
- [ ] **Step 3 (GREEN):** `npmDepsHash = "sha256-S8lO6fS9S3hRNlUdv7hztyfECeHBzeNArqaDjDQYqBE=";`; header `f6a3c81` → `4c714f0` (S5). `nb npm-deps` green; then every `typecheck-*` and `iface-*` check green (prototype: harness, bench, token-meter, actor-subagents at M2's state, iface-harness, iface-subagents-bench-probe; the previous prototype: cache-lifecycle shows only M4's two planned errors, experiments clean — so after M4 all green).
- [ ] Commit.

### Task M6.3 — actorSubagents at the host's `4c714f0`

**Files:** `checks/actor-subagents/default.nix`, `patches/pi-actor-subagents/*`, `packages/actor-subagents/package.nix`, `flake.lock`.

- [ ] **Step 1 (RED):** `h checks/pi-actor-subagents/default.nix > checks/actor-subagents/default.nix; git add -A; nb actor-subagents` → fails (the old source lacks `engine.deferErrorNotices = true`). [ ] red seen
- [ ] **Step 2 (GREEN):**
  ```sh
  h $ai/pi-actor-subagents-spawn-policy.patch > patches/pi-actor-subagents/pi-actor-subagents-spawn-policy.patch
  cmp <(h $ai/pi-actor-subagents-child-prompt.patch) patches/pi-actor-subagents/pi-actor-subagents-child-prompt.patch
  git rm -q patches/pi-actor-subagents/pi-actor-subagents-first-turn.patch
  (ulimit -v $cap && timeout -s KILL 600 nix flake lock "${o[@]}" \
    --override-input pi-actor-subagents github:fdietze/pi-actor-subagents/822a228e4d6e494c98a6946c9cf812fdd0c96a9d)
  lockeq pi-actor-subagents
  ```
  and `package.nix` per S5 (two patches, the first-turn bullet gone, "three" → "two"). `nb actor-subagents` green (331 tests in the previous prototype).
- [ ] **Step 3 (RED):** `nb typecheck-actor-subagents` → `spawn-policy.test.ts:25:3 - error TS2353 … 'abortBash' …`. [ ] red seen
- [ ] **Step 4 (GREEN, D5):** `sed -n 1358p` of the spawn-policy patch is `+\t};`; replace it (S5). `nb typecheck-actor-subagents`, `nb iface-subagents-bench-probe`, `nb iface-subagents-cache-lifecycle`, `nb iface-subagents-experiments`, `nb actor-subagents` green.
- [ ] **Step 5 (purity):** `diff <(h $ai/pi-actor-subagents-spawn-policy.patch) patches/pi-actor-subagents/pi-actor-subagents-spawn-policy.patch` shows exactly line 1358. Note in the Execution Record that the package's derivation differs from the host's by this line (Q1).
- [ ] Commit.

### Task M6.4 — infinite-context: input, patches, package, check

**Files:** `flake.nix`, `flake.lock`, `patches/pi-infinite-context/*`, `packages/infinite-context/package.nix`, `checks/infinite-context/**`, `checks/default.nix`.

- [ ] **Step 1 (RED):** copy the check (`for f in default.nix integration.test.ts overlay-foreign.test.ts stubs/{pi-coding-agent,typebox}/{index.js,package.json}; do h checks/pi-infinite-context/$f > checks/infinite-context/$f; done`), add the `infiniteContext` binding and the check `infinite-context` (S2); `git add -A; nb infinite-context` → `attribute 'infinite-context' missing`. [ ] red seen
- [ ] **Step 2 (GREEN):** input and package (S1, S3), the two patches (`h $ai/pi-infinite-context-{reminders,cache}.patch`); lock with `--override-input pi-infinite-context github:fdietze/pi-infinite-context/4c66601b71e629210cf1606f12526e6af5a8a8bf`; `lockeq pi-infinite-context` → as the host. `nb infinite-context` green (59 tests).
- [ ] **Step 3 (planted):** drop the cache patch from `package.nix` → `nb infinite-context` FAILS (test failures). [ ] red seen. Restore.
- [ ] **Step 4 (purity):** `for f in …; do cmp <(h checks/pi-infinite-context/$f) checks/infinite-context/$f; done` silent; `drvPath` of `packages.x86_64-linux.infinite-context` begins `i69aki1i`, of `checks.x86_64-linux.infinite-context` `6wbdgsx5` (prototype; the host's, M6.19 Step 4).
- [ ] **Step 5 (CLEAN):** `fmt` on the new `.nix` files; `nb leak`.
- [ ] Commit.

### Task M6.5 — `typecheck-infinite-context`

**Files:** `checks/default.nix`.

- [ ] **Step 1 (RED):** `infiniteContextTs` without the `rm` line (S2) and the check `typecheck-infinite-context` → TS2307 `Cannot find module 'fast-check'` in `archive-properties.test.ts`, `forest.test.ts`. [ ] red seen
- [ ] **Step 2 (GREEN):** the `rm` line (D7). Green, 0 errors.
- [ ] Commit.

### Task M6.6 — retry: input, patch, package, check

**Files:** `flake.nix`, `flake.lock`, `patches/pi-retry/pi-retry-free-cap.patch`, `packages/retry/package.nix`, `checks/retry/default.nix`, `checks/default.nix`.

- [ ] **Step 1 (RED):** `checks/retry/default.nix` per S4; the `retry` binding and the check `retry` (S2) → `attribute 'retry' missing`. [ ] red seen
- [ ] **Step 2 (GREEN):** input and package (S1, S3), the patch; lock with `--override-input pi-retry github:monotykamary/pi-retry/60a3b088145cf92dc6885f9fd8c785ed59a2b198`; `lockeq pi-retry`. `nb retry` green (300 tests, 10 files).
- [ ] **Step 3 (planted):** drop the free-cap patch → FAILS. [ ] red seen. Restore.
- [ ] **Step 4 (purity):** `diff <(h checks/pi-retry/default.nix) checks/retry/default.nix` shows only the header lines, the `let … in` with `nodeModules` and the de-indent; `drvPath`s begin `5jq7phiv` (package) and `0jf9v492` (check).
- [ ] Commit.

### Task M6.7 — `typecheck-retry`

**Files:** `checks/default.nix`.

- [ ] **Step 1 (RED, planted):** `retryTs` with `${retry}/__tests__` also copied → 3 errors (D8). [ ] red seen
- [ ] **Step 2 (GREEN):** `retryTs` per S2. Green.
- [ ] Commit.

### Task M6.8 — infiniteContext: module, package, registry entry, file

**Files:** `modules/infinite-context.nix`, `modules/default.nix`, `flake.nix` (`homeModules.default`), `checks/module-eval/cases/infinite-context.nix`, `checks/module-eval/default.nix`.

- [ ] **Step 1 (RED):** the cases `infinite-context-{off,defaults,package,files}` (S8) and `caseFiles` entry → `nb module-eval` fails: `The option 'programs.piEconomics.infiniteContext' does not exist`. [ ] red seen
- [ ] **Step 2 (GREEN):** S6 without `reminders` and `settings` (`rendered` = `{reminders = {default = {}; overrides = {};};}` for now), `modules/default.nix` imports it, `homeModules.default` sets `infiniteContext.src` (S1). Green, `N4 + 4` cases.
- [ ] Commit.

### Task M6.9 — Reminder options

**Files:** `modules/infinite-context.nix`, `checks/module-eval/cases/infinite-context.nix`.

- [ ] **Step 1 (RED):** `infinite-context-reminders` (S8) → `The option 'programs.piEconomics.infiniteContext.reminders' does not exist`. [ ] red seen
- [ ] **Step 2 (GREEN):** `reminderRule`, `renderRule`, `rendered`, the `reminders` options (S6). Green.
- [ ] Commit.

### Task M6.10 — `settings` merged

- [ ] **Step 1 (RED):** `infinite-context-settings` (S8) → `The option '….infiniteContext.settings' does not exist`. [ ] red seen
- [ ] **Step 2 (GREEN):** `settings` and `lib.recursiveUpdate rendered cfg.settings` (S6). Green.
- [ ] **Step 3 (planted):** `rendered // cfg.settings` → FAIL `infinite-context-settings`. [ ] red seen. Restore.
- [ ] Commit.

### Task M6.11 — retry: module, package, registry entry

**Files:** `modules/retry.nix`, `modules/default.nix`, `flake.nix`, `checks/module-eval/cases/retry.nix`, `checks/module-eval/default.nix`.

- [ ] **Step 1 (RED):** `retry-{off,defaults,package}` (S9), `caseFiles` → `The option 'programs.piEconomics.retry' does not exist`. [ ] red seen
- [ ] **Step 2 (GREEN):** S7 without `ops` and `settings`; import; `homeModules.default` sets `retry.src`. Green.
- [ ] Commit.

### Task M6.12 — `ops.retry`: today's ops, the child rule with actorSubagents

- [ ] **Step 1 (RED):** `retry-pisettings`, `retry-alone` (S9) → `ops: expected { retry = [ … ]; }, got { }`. [ ] red seen
- [ ] **Step 2 (GREEN):** `removePackage` and `piSettings.ops.retry` without `leaves` (S7). Green.
- [ ] **Step 3 (planted):** the child rule unconditional → FAIL `retry-alone`. [ ] red seen. Restore.
- [ ] Commit.

### Task M6.13 — `settings` as `piRetry` leaves

- [ ] **Step 1 (RED):** `retry-settings` (S9) → `The option '….retry.settings' does not exist`. [ ] red seen
- [ ] **Step 2 (GREEN):** `settings`, `leaves` (S7). Green.
- [ ] **Step 3 (planted):** `order = 1000` in `leaves` → FAIL `retry-settings` (`sequence`). [ ] red seen. Restore.
- [ ] Commit.

### Task M6.14 — bench `extensions` default

**Files:** `modules/bench.nix`, `checks/module-eval/cases/bench.nix`.

- [ ] **Step 1 (RED):** `bench-extensions-default` and the changed `bench-defaults`, `bench-extensions` (S10) → `extensions: expected { actor-subagents = …; }, got { }` and the two changed cases fail on `PI_BENCH_EXT_DIR`. Existing cases change because §7 changes the default: `bench-defaults` now expects the variable, `bench-extensions` expects its two names added to the defaults. [ ] red seen
- [ ] **Step 2 (GREEN):** the `mapAttrs (_: lib.mkDefault)` definition and the option description (S10). Green.
- [ ] **Step 3 (planted):** drop `pi-retry` from the defaults → FAIL `bench-extensions-default`. [ ] red seen. Restore.
- [ ] Commit.

### Task M6.15 — The host's combination (characterisation)

- [ ] **Step 1 (GREEN-first):** `m6-host-like` (S9) → green at once (a characterisation of M2–M6).
- [ ] **Step 2 (planted):** `forChildren = false` in `modules/retry.nix` → FAIL `m6-host-like` (`children`). [ ] red seen. Restore.
- [ ] Commit.

### Task M6.16 — `home-files` for M6

**Files:** `checks/home-files/default.nix`.

- [ ] **Step 1 (RED):** the configuration gains `infiniteContext`, `retry` (S11) and the shell part; without `pkgs.nodejs` in `nativeBuildInputs` → `node: command not found`. [ ] red seen
- [ ] **Step 2 (GREEN):** `pkgs.nodejs`. `nb home-files` green.
- [ ] **Step 3 (planted):** `infiniteContext.settings.bogus = 1` → `FAIL .pi/agent: infinite-context rejects its settings.json` (`settings: unknown key "bogus"`); a third package `"keep"` in the scratch file → `FAIL .pi/agent: settings.json after ops.retry`. [ ] red seen ×2. Restore.
- [ ] Commit.

### Task M6.17 — Every component together

- [ ] **Step 1 (GREEN-first):** `components` += `"infiniteContext" "retry"` in `cases/together.nix` → green.
- [ ] **Step 2 (planted):** a file that only the combination renders: in `modules/retry.nix`, `config = lib.mkMerge [(lib.mkIf cfg.enable {…}) (lib.mkIf (cfg.enable && pe.infiniteContext.enable) {home.file."x".text = "";})]` → FAIL `components-together` (`home.file targets`). [ ] red seen. Restore.
- [ ] Commit.

### Task M6.18 — Docs

**Files:** `docs/pi-economics.md`.

- [ ] **Step 1:** sections `infiniteContext` and `retry` (options, files, ops, soft dependencies, checks), the bench default, the M6.0 resync (pi 1.3.0 lock; the three dropped patches and why: spec §2's and §9's patch lists name them, the code supersedes, S12). `nb leak`.
- [ ] Commit.

### Task M6.D — Movable: the doc move (in the last of M5/M6 to land, before W)

Executed in **this** milestone only if M5 has landed by the time M6.18 is committed; otherwise it is skipped here, marked "moved to M5" in the Execution Record, and M5's plan carries it verbatim as its last task before its close-out. Either way it lands before W0.

**Files:** `docs/pi-token-economics.md` (new), `docs/pi-economics.md` (link). `leakSrc` scans `docs/` outside `specs`/`plans` already.

- [ ] **Step 1 (drift):** `cd ~/projects/nixos/new && git dot diff --stat 4c714f0 HEAD -- docs/pi-token-economics.md` — port any change.
- [ ] **Step 2 (RED):** `h docs/pi-token-economics.md > docs/pi-token-economics.md`; the scrub probe `grep -nE 'earth|pallon|programs\.pi\.|modules/home-manager|pkgs/pi-bench|ai/pi-|2026-10-02|notes/' docs/pi-token-economics.md` lists lines (54, 62, …). `leak` stays green on it (generic patterns, §8.3: it would not catch these; the names are the publication check's, P). [ ] red seen
- [ ] **Step 3 (GREEN, scrub, S13):** the probe prints nothing; host paths re-pointed to this flake (`modules/home-manager/features/ai/extensions/<c>` → `packages/<c>`, `pkgs/pi-bench` → `packages/bench`, `ai/pi-*.nix` → `packages/<c>/package.nix` and `modules/<c>.nix`), the host's 2026-10-02 spec/plan and `~/.pi/agent/notes/…` citations dropped (§2), the host's names replaced by placeholders (`<host>`, `<user>`); settings tables re-pointed to `programs.piEconomics.*`. `nb leak` green.
- [ ] **Step 4:** `docs/pi-economics.md` links it. The host's pointer page is W's docs step (§9.1), not this task.
- [ ] Commit.

### Task M6.19 — Gate and Execution Record

- [ ] **Step 1:** `fmt --check $(git ls-files '*.nix')` clean.
- [ ] **Step 2 (every check, both refs):** `flag`; list the checks with `ne checks.x86_64-linux --apply builtins.attrNames --json` (a failed or empty listing is a failure) and build each, capped, with `nb` and with `nbp`; name every failure at the end.
- [ ] **Step 3:** `lockeq nixpkgs home-manager pi-actor-subagents pi-infinite-context pi-retry` → five times "as the host".
- [ ] **Step 4 (purity, P2):** `git dot archive 4c714f0 -- . | tar -x -C $TMPDIR/host` from `~/projects/nixos/new`, then compare, capped, `nix eval --raw path:$TMPDIR/host#checks.x86_64-linux.pi-{infinite-context,retry}.drvPath` with this flake's `checks.x86_64-linux.{infinite-context,retry}.drvPath` (equal), and the same for `pi-actor-subagents` (differs by D5 only). Above 2 GiB: `flag` first.
- [ ] **Step 5:** fill the Execution Record (per task: commit, red seen, deviations; the final case count; Q1–Q4 as answered).
- [ ] Commit.

## Snippets

Generated from the prototype (scratch clone of `0b6cab3`, M3's state; every check green under both refs). Where M4's end state differs, the snippet says so.

### S1 — `flake.nix` (diff against M4's end state; M4 does not touch it except `packages`)

```diff
@@ -12,12 +12,20 @@
       inputs.nixpkgs.follows = "nixpkgs";
     };
 
-    # A patched upstream (spec §3), locked to the host's revision; the host
-    # makes it follow its own input.
+    # The patched upstreams (spec §3), locked to the host's revisions; the host
+    # makes them follow its own inputs.
     pi-actor-subagents = {
       url = "github:fdietze/pi-actor-subagents";
       flake = false;
     };
+    pi-infinite-context = {
+      url = "github:fdietze/pi-infinite-context";
+      flake = false;
+    };
+    pi-retry = {
+      url = "github:monotykamary/pi-retry";
+      flake = false;
+    };
   };
 
   outputs = {
@@ -25,6 +33,8 @@
     nixpkgs,
     home-manager,
     pi-actor-subagents,
+    pi-infinite-context,
+    pi-retry,
   }: let
     system = "x86_64-linux";
     pkgs = nixpkgs.legacyPackages.${system};
@@ -34,8 +44,10 @@
     # common.nix, so every option a cross-component assertion reads exists.
     homeModules.default = {
       imports = [./modules];
-      # The upstream source the patched component builds from (spec §3).
+      # The upstream sources the patched components build from (spec §3).
       programs.piEconomics.actorSubagents.src = lib.mkDefault pi-actor-subagents;
+      programs.piEconomics.infiniteContext.src = lib.mkDefault pi-infinite-context;
+      programs.piEconomics.retry.src = lib.mkDefault pi-retry;
     };
 
     # One package per component (spec §3); the module's `package` default
@@ -44,6 +56,8 @@
       bench = pkgs.callPackage ./packages/bench/package.nix {};
       actor-subagents = pkgs.callPackage ./packages/actor-subagents/package.nix {src = pi-actor-subagents;};
       token-meter = pkgs.callPackage ./packages/token-meter/package.nix {};
+      infinite-context = pkgs.callPackage ./packages/infinite-context/package.nix {src = pi-infinite-context;};
+      retry = pkgs.callPackage ./packages/retry/package.nix {src = pi-retry;};
     };
 
     formatter.${system} = pkgs.alejandra;
```

### S2 — `checks/default.nix` (diff)

```diff
@@ -32,6 +32,24 @@
   '';
   # (M2.3)
   iface = import ./iface {inherit lib pkgs typecheck;};
+  # (M6.4) The patched pi-infinite-context, and its type-check copy: the
+  # extension without upstream's tsconfig.json (TS5112, M2.2) and without the
+  # two property tests that import fast-check, which the shared lock does not
+  # hold (the check does not run them either).
+  infiniteContext = self.packages.${pkgs.stdenv.hostPlatform.system}.infinite-context;
+  infiniteContextTs = pkgs.runCommand "infinite-context-ts" {} ''
+    mkdir $out
+    cp -r ${infiniteContext}/extensions ${infiniteContext}/package.json $out/
+    chmod -R u+w $out
+    rm $out/extensions/infinite-context/{archive-properties,forest}.test.ts
+  '';
+  # (M6.6) The patched pi-retry, and its type-check copy: the code pi loads
+  # (retry.ts, src/) with package.json; upstream's tsconfig.json and tests stay out (D8).
+  retry = self.packages.${pkgs.stdenv.hostPlatform.system}.retry;
+  retryTs = pkgs.runCommand "retry-ts" {} ''
+    mkdir $out
+    cp -r ${retry}/retry.ts ${retry}/src ${retry}/package.json $out/
+  '';
 in {
   leak = leakLib.check leakSrc;
   leak-selftest = leakLib.selftest;
@@ -74,4 +92,18 @@ in {
     src = ../packages/token-meter;
   };
   home-files = import ./home-files {inherit lib pkgs hm;};
+  # The patched upstreams' suites, with the host's checks (spec §8.1).
+  infinite-context = pkgs.callPackage ./infinite-context {src = infiniteContext;};
+  typecheck-infinite-context = typecheck.typecheck {
+    name = "infinite-context";
+    src = infiniteContextTs;
+  };
+  retry = pkgs.callPackage ./retry {
+    src = retry;
+    inherit (npm) nodeModules;
+  };
+  typecheck-retry = typecheck.typecheck {
+    name = "retry";
+    src = retryTs;
+  };
 }
```

### S3 — `packages/infinite-context/package.nix`, `packages/retry/package.nix`

```nix
# pi-infinite-context with two local patches, applied in this order (spec §2):
#
# - reminders: absolute fold-reminder thresholds per provider or model
#   (`reminders.default` / `reminders.overrides`, fields startTokens /
#   everyTokens: exact provider/modelId, then provider, then default), read
#   from getAgentDir()/infinite-context/settings.json, which
#   programs.piEconomics.infiniteContext writes. Without a rule the reminder
#   starts at 75% of the model window and repeats every 5% of it. The
#   `reminders` block and the cache patch's keys are strict: an invalid value
#   or an unknown key rejects the whole file with a session-start warning.
# - cache: a cost-aware fold hint (payoff in turns while the prompt cache is
#   warm, "folding is free" when cold; prices and TTL from the same file;
#   `foldHint = "fixed"` turns it off; the experiments flag `foldHint`
#   overrides it per session through __piExperimentsApi_v1, cast inline,
#   spec §5.3), a fold_timing prompt section, a re-sync of a snapshot that no
#   longer matches the branch, and a handoff notice instead of the raw
#   transcript when folds cannot be applied.
#
# Foreign messages that other context handlers insert need no patch: upstream
# matches the projection as an ordered subsequence (e6ff6803);
# checks/infinite-context pins that (overlay-foreign.test.ts).
#
# The patch files keep the host's names, so the store paths, and with the
# same nixpkgs the derivation, are the host's. A patch that no longer applies
# fails this build; checks/infinite-context runs the tests on it.
{
  applyPatches,
  src,
}:
applyPatches {
  name = "pi-infinite-context-patched";
  inherit src;
  patches = [
    ../../patches/pi-infinite-context/pi-infinite-context-reminders.patch
    ../../patches/pi-infinite-context/pi-infinite-context-cache.patch
  ];
}
```

```nix
# pi-retry with one local patch (spec §2):
#
# - free-cap: a 429 for OpenRouter's daily free-tier cap is not retried; it
#   lasts until 00:00 UTC, so retrying only burns the retry budget. Offer it
#   upstream.
#
# Print and json sessions need no patch: upstream 0.11.0 retries them inline
# (prompt-scoped sessions); checks/retry pins that route.
#
# The whole repository, not a subdirectory: pi finds the entry point
# (retry.ts) through package.json `pi.extensions`. The patch file keeps the
# host's name, so the store path, and with the same nixpkgs the derivation,
# are the host's. A patch that no longer applies fails this build;
# checks/retry runs the upstream vitest suite on it.
{
  applyPatches,
  src,
}:
applyPatches {
  name = "pi-retry-patched";
  inherit src;
  patches = [
    ../../patches/pi-retry/pi-retry-free-cap.patch
  ];
}
```

### S4 — `checks/retry/default.nix` (after `fmt`)

```nix
# Runs the upstream vitest suite of the PATCHED pi-retry (the exact source
# ~/.pi/agent/extensions/pi-retry links to). A patch that no longer applies
# fails this build in applyPatches; a patch that applies but breaks the
# extension fails the suite.
#
# Unlike the other pi extension checks this needs an npm closure: upstream's
# tests use vitest and import pi's own packages (AgentSession, Agent), which
# exist only inside the pi binary. They come from the shared npm lock
# (checks/npm, spec §3), upstream's devDependencies; bump it together with
# the input pi-retry.
{
  pkgs,
  src,
  nodeModules,
}:
pkgs.runCommand "pi-retry-tests" {nativeBuildInputs = [pkgs.nodejs];} ''
  cp -r ${src} work
  chmod -R u+w work
  cd work
  ln -s ${nodeModules}/node_modules node_modules
  export HOME=$TMPDIR/home
  mkdir -p "$HOME"
  node node_modules/vitest/vitest.mjs run

  # The free-cap patch's own test must be part of what ran. Print/json
  # sessions retry inline upstream (prompt-scoped sessions, formerly a local
  # patch); keep that route pinned, `pi -p` had no retry at all without it.
  grep -q 'daily free cap is not retried' __tests__/unit/error-patterns.test.ts
  grep -q 'prompt-scoped ordinary sessions' __tests__/integration/native-child-lifecycle.test.ts
  grep -q 'isPromptScopedMode(ctx.mode)' retry.ts
  grep -q 'openrouter_free_tier_daily' src/error-patterns.ts
  touch $out
''
```

### S5 — The resync edits: D5's line, `packages/actor-subagents/package.nix`, `checks/npm/default.nix`

D5, `patches/pi-actor-subagents/pi-actor-subagents-spawn-policy.patch` line 1358 (a tab after `+`):

```diff
1358c1358
< +	};
---
> +	} as Partial<SessionLike> as SessionLike & { delivered: RoutedAgentMessage[] };
```

```diff
diff --git a/checks/npm/default.nix b/checks/npm/default.nix
--- a/checks/npm/default.nix
+++ b/checks/npm/default.nix
@@ -1,5 +1,5 @@
 # The shared npm lock (spec §3, "npm dependencies"). ./package.json and
-# ./package-lock.json are the host's checks/pi-retry files at f6a3c81, byte for
+# ./package-lock.json are the host's checks/pi-retry files at 4c714f0, byte for
 # byte: pi-retry's devDependencies, which pin typescript, @types/node and pi's
 # own packages for the type check and, from M6, vitest for pi-retry's suite.
 # pname and source set are the host's, so the derivation is the host's.
@@ -14,7 +14,7 @@
       root = ./.;
       fileset = lib.fileset.unions [./package.json ./package-lock.json];
     };
-    npmDepsHash = "sha256-7fOhIoTUaTY4k6zvDN2F2YSy8of9TBCu9gQ4qEPDiqM=";
+    npmDepsHash = "sha256-S8lO6fS9S3hRNlUdv7hztyfECeHBzeNArqaDjDQYqBE=";
     npmDepsFetcherVersion = 2;
     dontNpmBuild = true;
     installPhase = ''
diff --git a/packages/actor-subagents/package.nix b/packages/actor-subagents/package.nix
--- a/packages/actor-subagents/package.nix
+++ b/packages/actor-subagents/package.nix
@@ -1,4 +1,4 @@
-# pi-actor-subagents with three local patches, applied in this order (spec §2):
+# pi-actor-subagents with two local patches, applied in this order (spec §2):
 #
 # - child-prompt: upstream builds every child with `systemPromptOverride`, and
 #   in pi a custom system prompt drops the default `tools` and `rules`
@@ -11,12 +11,6 @@
 #   tools, tool guard), an optional `task` parameter, neutral model wording,
 #   send/list, childSessionId on spawn events, and a grace period before a
 #   child's transient error (429 under pi-retry) wakes its parent.
-# - first-turn: a child's first task arrived through
-#   session.sendCustomMessage({triggerTurn: true}), which on an idle pi 1.0
-#   session starts the run without before_agent_start, the system prompt and
-#   the tool loadout. The first message of a session now goes through
-#   sendUserMessage (prompt()); later ones stay custom messages. Drop it once
-#   pi's sendCustomMessage prepares the loadout itself.
 #
 # The patch files keep the host's names, so the store paths, and with the
 # same nixpkgs the derivation, are the host's. A patch that no longer applies
@@ -31,7 +25,6 @@
   patches = [
     ../../patches/pi-actor-subagents/pi-actor-subagents-child-prompt.patch
     ../../patches/pi-actor-subagents/pi-actor-subagents-spawn-policy.patch
-    ../../patches/pi-actor-subagents/pi-actor-subagents-first-turn.patch
   ];
 }).overrideAttrs (old: {
   # The version of __subagentsApi_v1 this build provides; taskRouter asserts
```

### S6 — `modules/infinite-context.nix` (state after M6.10)

```nix
# pi-infinite-context (spec §2, §4, §5.2): folds ranges of the agent's own
# conversation and unfolds them on demand. The upstream extension with two
# local patches (packages/infinite-context/package.nix), linked through the
# registry for sessions and children, and its settings file, always written.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.infiniteContext;
  r = cfg.reminders;

  reminderRule = lib.types.submodule {
    options = {
      startTokens = lib.mkOption {
        type = lib.types.nullOr lib.types.ints.positive;
        default = null;
        description = "Context size, in tokens, at which the first fold reminder is sent. null inherits (provider, then default, then 75% of the model window). Never later than 75% of the window.";
      };
      everyTokens = lib.mkOption {
        type = lib.types.nullOr lib.types.ints.positive;
        default = null;
        description = "Tokens between further reminders above startTokens. null inherits (provider, then default, then 5% of the model window).";
      };
    };
  };

  # Nulls mean "inherit" and are left out, so the file carries only what was set.
  renderRule = rule: lib.filterAttrs (_: v: v != null) rule;

  # (M6.9) The reminder options as the extension reads them.
  rendered =
    {
      reminders = {
        default = renderRule r.default;
        overrides = lib.mapAttrs (_: renderRule) r.overrides;
      };
    }
    // lib.optionalAttrs (r.prices != {}) {inherit (r) prices;}
    // lib.optionalAttrs (r.cacheTtlMinutes != null) {inherit (r) cacheTtlMinutes;}
    // lib.optionalAttrs (r.foldHint != null) {inherit (r) foldHint;};
in {
  options.programs.piEconomics.infiniteContext = {
    enable = lib.mkEnableOption "pi-infinite-context, folds of the agent's own conversation with cost-aware fold reminders";

    src = lib.mkOption {
      type = lib.types.path;
      internal = true;
      description = ''
        The unpatched upstream source. The flake's homeModules.default sets it
        from its input `pi-infinite-context`; the registry's existence assertion
        probes it.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/infinite-context/package.nix {inherit (cfg) src;};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/infinite-context/package.nix { src = <input pi-infinite-context>; }";
      description = "The patched extension source (`extensions/infinite-context`).";
    };

    # (M6.9) The host's piContextReminders (spec §5.2).
    reminders = {
      prices = lib.mkOption {
        type = lib.types.attrsOf (lib.types.submodule {
          options = {
            w = lib.mkOption {
              type = lib.types.numbers.positive;
              description = "Cache-write price (any unit; only w/r matters).";
            };
            r = lib.mkOption {
              type = lib.types.numbers.positive;
              description = "Cache-read price, same unit; at most w.";
            };
          };
        });
        default = {};
        example = {
          "anthropic/claude-opus-5-5" = {
            w = 5;
            r = 0.2;
          };
        };
        description = ''
          Prompt-cache prices per exact `provider/modelId` or provider. With a
          price the fold reminder says after how many turns a fold pays off
          (((w - r) / r) · K/R, 24·K/R on Opus 5.5); without one it carries no
          cost hint. A cold cache always gets "folding is free now".
        '';
      };
      cacheTtlMinutes = lib.mkOption {
        type = lib.types.nullOr lib.types.ints.positive;
        default = null;
        description = "Prompt-cache lifetime the fold hint uses to tell warm from cold. null keeps the extension's 5 minutes.";
      };
      foldHint = lib.mkOption {
        type = lib.types.nullOr (lib.types.enum ["fixed" "cache-aware"]);
        default = null;
        description = ''
          "fixed": reminders carry no cost hint. "cache-aware": they carry the
          fold hint. null keeps the extension's default (cache-aware). The
          experiments package (factor foldHint) overrides this per session.
        '';
      };
      default = lib.mkOption {
        type = reminderRule;
        default = {};
        description = "Fold-reminder thresholds for every model without an override.";
      };
      overrides = lib.mkOption {
        type = lib.types.attrsOf reminderRule;
        default = {};
        example = {
          anthropic = {
            startTokens = 200000;
            everyTokens = 20000;
          };
        };
        description = ''
          Fold-reminder thresholds keyed by pi provider (`anthropic`) or exact
          `provider/modelId`. Each field resolves on its own: exact model, then
          provider, then `default`, then infinite-context's built-in 75% / 5%
          of the model window. Read once per extension instance, so a change
          applies to sessions and subagents started after the switch.
        '';
      };
    };

    # (M6.10)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {nudgeAtPercent = 60;};
      description = ''
        Merged into `<agentDir>/infinite-context/settings.json` with
        `lib.recursiveUpdate`, on the right of what `reminders` renders: a
        nested key replaces only its own leaf. The extension accepts
        `nudgeAtTokens`, `nudgeAtPercent`, `reminders`, `prices`,
        `cacheTtlMinutes` and `foldHint`; an unknown key or an invalid value
        rejects the whole file with a warning at session start.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    programs.piEconomics.extensions.infinite-context = {
      path = "${cfg.package}/extensions/infinite-context";
      checkPath = "${cfg.src}/extensions/infinite-context/index.ts";
      input = "pi-infinite-context";
      forChildren = true;
      description = "context_map, context_fold, context_unfold, context_peek and context_search: folds ranges of the agent's own conversation by message id and unfolds them on demand, without rewriting live messages. Also steers a maintenance reminder: by default from 75% of the model window, every 5 points; patched to take absolute token thresholds per provider or model from infiniteContext.reminders.";
    };

    # Always written, even with every option at its default: the path stays
    # Home Manager-owned instead of a file the agent could create. Literal
    # text (spec §4).
    home.file."${pe.agentDir}/infinite-context/settings.json".text =
      builtins.toJSON (lib.recursiveUpdate rendered cfg.settings);
  };
}
```

`modules/default.nix` imports `./infinite-context.nix` and `./retry.nix` after M4's entries; `checks/module-eval/default.nix`'s `caseFiles` gains `./cases/infinite-context.nix` and `./cases/retry.nix` before `./cases/together.nix`.

### S7 — `modules/retry.nix` (state after M6.13)

```nix
# pi-retry (spec §2, §4, §5.4): retries transient provider errors with
# backoff. The upstream extension with one local patch
# (packages/retry/package.nix), linked through the registry for sessions and
# children; no file of its own: its settings live in pi's mutable
# settings.json, edited through piSettings ops.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.retry;

  removePackage = value: {
    op = "removeWhere";
    path = ["packages"];
    inherit value;
  };

  # (M6.13) One `set` per leaf of settings, under piRetry, at order 500: before
  # the child rule's ensureContains (1000). A list is a leaf, replaced whole;
  # no whole object is set, so keys written by pi or the user survive.
  leaves = path: v:
    if lib.isAttrs v
    then lib.concatLists (lib.mapAttrsToList (k: leaves (path ++ [k])) v)
    else [
      {
        op = "set";
        inherit path;
        value = v;
        order = 500;
      }
    ];
in {
  options.programs.piEconomics.retry = {
    enable = lib.mkEnableOption "pi-retry, retries of transient provider errors with backoff";

    src = lib.mkOption {
      type = lib.types.path;
      internal = true;
      description = ''
        The unpatched upstream source. The flake's homeModules.default sets it
        from its input `pi-retry`; the registry's existence assertion probes it.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/retry/package.nix {inherit (cfg) src;};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/retry/package.nix { src = <input pi-retry>; }";
      description = "The patched extension, the whole repository (pi finds `retry.ts` through `package.json`).";
    };

    # (M6.13)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {
        maxDelayMs = 60000;
        subagents.enabled = true;
      };
      description = ''
        pi-retry's keys under `piRetry` in pi's mutable settings file
        (`piSettings.file`), one `set` per leaf at order 500 (upstream keys:
        `maxRetriesAtMaxDelay`, `baseDelayMs`, `maxDelayMs`, `multiplier`,
        `messageFreeRetries`, `subagents.*`). Applied by the activation entry
        `piSettingsMigrate`, so only while `piSettings.enable`. With
        actorSubagents enabled, the child rule is added to
        `piRetry.subagents.match.systemPromptRegex` after these.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    programs.piEconomics.extensions.pi-retry = {
      path = "${cfg.package}";
      checkPath = "${cfg.src}/retry.ts";
      input = "pi-retry";
      forChildren = true;
      description = "Retries 400/413, credit and connection errors with backoff, inline for children and one-shot (print/json) hosts; never retries a hard quota such as OpenRouter's daily free-tier cap.";
    };

    # (M6.12, M6.13) Today's ops (checks/pi-settings-migrate/today-ops.nix),
    # the child rule only with actorSubagents (spec §4.1, no warning), then
    # the settings' leaves.
    programs.piEconomics.piSettings.ops.retry =
      [
        (removePackage "https://github.com/monotykamary/pi-retry")
        (removePackage "git:github.com/monotykamary/pi-retry")
      ]
      ++ lib.optional pe.actorSubagents.enable {
        op = "ensureContains";
        path = ["piRetry" "subagents" "match" "systemPromptRegex"];
        value = {
          pattern = ''^You were spawned by "'';
          flags = "m";
        };
      }
      ++ leaves ["piRetry"] cfg.settings;
  };
}
```

### S8 — `checks/module-eval/cases/infinite-context.nix` (state after M6.10)

```nix
# Cases for modules/infinite-context.nix (spec §4, §5.1, §5.2).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; ic: infiniteContext options, null = not enabled.
  eval = dir: ic:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (ic != null) {infiniteContext = {enable = true;} // ic;};
    };
  sorted = lib.sort lib.lessThan;
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  settingsOf = dir: ic: (fileAt "${dir}/infinite-context/settings.json" (eval dir ic)).text;
  bare = hm.evalBare {};
  # The host's values (homes/pallon/default.nix:32-54 at 4c714f0).
  hostReminders = {
    overrides = {
      "anthropic/claude-opus-5-5" = {
        startTokens = 400000;
        everyTokens = 100000;
      };
      "anthropic/claude-sonnet-5-5" = {
        startTokens = 400000;
        everyTokens = 100000;
      };
    };
    prices = {
      "anthropic/claude-opus-5-5" = {
        w = 5;
        r = 0.2;
      };
      "anthropic/claude-sonnet-5-5" = {
        w = 2.5;
        r = 0.2;
      };
    };
  };
in {
  # (M6.8) Off by default: no registry entry, no file.
  infinite-context-off = let
    c = eval ".pi/agent" null;
  in
    holds "no registry entry" (!(pe c).extensions ? infinite-context)
    ++ eq "home.file targets" (targets c) (targets bare);

  # (M6.8) On: the registry entry, loaded into children, its link following
  # agentDir; the existence probe reads the unpatched input, so evaluation
  # builds nothing.
  infinite-context-defaults = lib.concatMap (dir: let
    c = eval dir {};
    e = (pe c).extensions.infinite-context;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).infiniteContext.package}/extensions/infinite-context";
      input = "pi-infinite-context";
      forChildren = true;
    }
    ++ eq "checkPath (${dir})" (toString e.checkPath) "${self.inputs.pi-infinite-context}/extensions/infinite-context/index.ts"
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M6.8) The package is the flake's, under the host's derivation name.
  infinite-context-package = let
    ic = (pe (eval ".pi/agent" {})).infiniteContext;
  in
    eq "drvPath" ic.package.drvPath self.packages.x86_64-linux.infinite-context.drvPath
    ++ eq "name" ic.package.name "pi-infinite-context-patched";

  # (M6.8) Files: the link and the settings file, always written; with every
  # option at its default the file is today's, byte for byte (spec §9.1 W5).
  infinite-context-files = lib.concatMap (dir:
    eq "home.file targets (${dir})" (sorted (targets (eval dir {})))
    (sorted (targets bare ++ ["${dir}/extensions/infinite-context" "${dir}/infinite-context/settings.json"]))
    ++ eq "settings text (${dir})" (settingsOf dir {}) ''{"reminders":{"default":{},"overrides":{}}}'')
  dirs;

  # (M6.9) The reminder options render as the host's piContextReminders did:
  # nulls are left out, prices, TTL and foldHint only when set.
  infinite-context-reminders = let
    host = builtins.fromJSON (settingsOf ".pi/agent" {reminders = hostReminders;});
    all = builtins.fromJSON (settingsOf ".pi/agent" {
      reminders = {
        default.startTokens = 150000;
        overrides.anthropic.everyTokens = 20000;
        cacheTtlMinutes = 60;
        foldHint = "fixed";
      };
    });
  in
    eq "host's values" host {
      reminders = {
        default = {};
        inherit (hostReminders) overrides;
      };
      inherit (hostReminders) prices;
    }
    ++ eq "every option" all {
      reminders = {
        default.startTokens = 150000;
        overrides.anthropic.everyTokens = 20000;
      };
      cacheTtlMinutes = 60;
      foldHint = "fixed";
    };

  # (M6.10) settings merge with lib.recursiveUpdate, the user's on the right:
  # a nested key replaces its own leaf, the rendered siblings survive.
  infinite-context-settings = lib.concatMap (dir: let
    got = builtins.fromJSON (settingsOf dir {
      reminders = hostReminders;
      settings = {
        nudgeAtPercent = 60;
        reminders.default.everyTokens = 5000;
        reminders.overrides."anthropic/claude-opus-5-5".startTokens = 300000;
      };
    });
  in
    eq "merged (${dir})" got {
      nudgeAtPercent = 60;
      reminders = {
        default.everyTokens = 5000;
        overrides =
          hostReminders.overrides
          // {
            "anthropic/claude-opus-5-5" = {
              startTokens = 300000;
              everyTokens = 100000;
            };
          };
      };
      inherit (hostReminders) prices;
    })
  dirs;
}
```

### S9 — `checks/module-eval/cases/retry.nix` (state after M6.15, at M4's end state)

The prototype, without M4, left `cacheLifecycle` and `experiments` out of `m6-host-like` and expected the children `["infinite-context" "pi-retry" "token-meter"]`.

```nix
# Cases for modules/retry.nix (spec §4, §4.1, §5.1, §5.4).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  today = import ../../pi-settings-migrate/today-ops.nix;
  # The op submodule's default, so module values compare with the fixture.
  withOrder = map (op: {order = 1000;} // op);
  # dir: agentDir; rt: retry options, null = not enabled; more: other
  # programs.piEconomics options.
  eval = dir: rt: more:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (rt != null) {retry = {enable = true;} // rt;}
        // more;
    };
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  # (order, key, op, path) of every op, in the order the program runs them.
  sequence = cfg: map (o: "${toString o.order}:${o.key}:${o.op}:${lib.concatStringsSep "." o.path}") (pe cfg).piSettings.sortedOps;
  bare = hm.evalBare {};
  asOn = {actorSubagents.enable = true;};
in {
  # (M6.11) Off by default: no registry entry, no file, no op.
  retry-off = let
    c = eval ".pi/agent" null {};
  in
    holds "no registry entry" (!(pe c).extensions ? pi-retry)
    ++ eq "home.file targets" (targets c) (targets bare)
    ++ eq "piSettings ops" (pe c).piSettings.ops {};

  # (M6.11) On: the registry entry (the whole repository, loaded into
  # children), its link following agentDir, and no file of its own.
  retry-defaults = lib.concatMap (dir: let
    c = eval dir {} asOn;
    e = (pe c).extensions.pi-retry;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).retry.package}";
      input = "pi-retry";
      forChildren = true;
    }
    ++ eq "checkPath (${dir})" (toString e.checkPath) "${self.inputs.pi-retry}/retry.ts"
    ++ eq "new home.file targets (${dir})" (lib.subtractLists (targets (eval dir null asOn)) (targets c)) ["${dir}/extensions/pi-retry"]
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M6.11) The package is the flake's, under the host's derivation name.
  retry-package = let
    rt = (pe (eval ".pi/agent" {} {})).retry;
  in
    eq "drvPath" rt.package.drvPath self.packages.x86_64-linux.retry.drvPath
    ++ eq "name" rt.package.name "pi-retry-patched";

  # (M6.12) With actorSubagents: today's ops; with the host's op the program
  # is the one pi-settings-migrate compares with the legacy script.
  retry-pisettings = let
    c = eval ".pi/agent" {} asOn;
    withHost = eval ".pi/agent" {} (asOn // {piSettings.ops.host = today.withoutWarming.host;});
    todays = hm.eval {programs.piEconomics.piSettings.ops = today.withoutWarming;};
  in
    eq "ops" (pe c).piSettings.ops {retry = withOrder today.withoutWarming.retry;}
    ++ eq "program with the host's op" (pe withHost).piSettings.program (pe todays).piSettings.program
    ++ holds "activation entry piSettingsMigrate" (c.home.activation ? piSettingsMigrate);

  # (M6.12) Without actorSubagents: the two removals, no child rule, no
  # warning (spec §4.1).
  retry-alone = let
    c = eval ".pi/agent" {} {};
  in
    eq "ops" (pe c).piSettings.ops {retry = withOrder (lib.take 2 today.withoutWarming.retry);}
    ++ eq "warnings" c.warnings bare.warnings
    ++ eq "failed assertions" (failed "" c) [];

  # (M6.13) settings: one set per leaf under piRetry at order 500, before
  # every order-1000 op (the host's and the child rule); a list is one leaf.
  retry-settings = let
    c = eval ".pi/agent" {
      settings = {
        maxDelayMs = 60000;
        subagents = {
          enabled = true;
          match.systemPromptRegex = [{pattern = "x";}];
        };
      };
    } (asOn // {piSettings.ops.host = today.withoutWarming.host;});
    sets = lib.filter (o: o.op == "set") (pe c).piSettings.ops.retry;
  in
    eq "sequence" (sequence c) [
      "500:retry:set:piRetry.maxDelayMs"
      "500:retry:set:piRetry.subagents.enabled"
      "500:retry:set:piRetry.subagents.match.systemPromptRegex"
      "1000:host:removeWhere:packages"
      "1000:retry:removeWhere:packages"
      "1000:retry:removeWhere:packages"
      "1000:retry:ensureContains:piRetry.subagents.match.systemPromptRegex"
    ]
    ++ eq "values" (map (o: o.value) sets) [60000 true [{pattern = "x";}]];

  # (M6.15) The host's combination of M2-M6 from W5 on (spec §9.1): the
  # flake's children, no activation entry while the host's script runs.
  m6-host-like = let
    c = hm.eval {
      programs.piEconomics = {
        actorSubagents.enable = true;
        tokenMeter.enable = true;
        cacheLifecycle.enable = true;
        experiments.enable = true;
        infiniteContext.enable = true;
        retry.enable = true;
        piSettings.enable = false;
      };
    };
    childNames = map baseNameOf (builtins.fromJSON (lib.findFirst (f: f.target == ".pi/agent/actor-subagents/settings.json") null (lib.attrValues c.home.file)).text).childExtensions;
  in
    eq "children" childNames ["cache-lifecycle" "infinite-context" "pi-retry" "token-meter"]
    ++ holds "no activation entry" (!(c.home.activation ? piSettingsMigrate))
    ++ eq "failed assertions" (failed "" c) []
    ++ eq "warnings" c.warnings bare.warnings;
}
```

### S10 — bench: `modules/bench.nix`, `checks/module-eval/cases/bench.nix` (diffs)

```diff
diff --git a/checks/module-eval/cases/bench.nix b/checks/module-eval/cases/bench.nix
--- a/checks/module-eval/cases/bench.nix
+++ b/checks/module-eval/cases/bench.nix
@@ -34,6 +34,8 @@ in {
     eq "PI_BENCH_ variables (${dir})" (benchVars c) {
       PI_BENCH_DATA = "${src}/bench";
       PI_BENCH_AGENT_SRC = src;
+      # (M6.14) The default extensions (bench-extensions-default).
+      PI_BENCH_EXT_DIR = "${pkgs.linkFarm "pi-bench-extensions" (pe c).bench.extensions}";
     }
     ++ holds "home.packages holds the bench (${dir})" (lib.elem (toString (pe c).bench.package) (map toString c.home.packages))
     ++ eq "home.file names (${dir})" (lib.attrNames c.home.file) (lib.attrNames (hm.evalBare {}).home.file)
@@ -70,7 +72,22 @@ in {
     };
     v = (on {extensions = exts;}).home.sessionVariables;
   in
-    eq "PI_BENCH_EXT_DIR" v.PI_BENCH_EXT_DIR "${pkgs.linkFarm "pi-bench-extensions" exts}";
+    # (M6.14) Definitions add to the defaults.
+    eq "PI_BENCH_EXT_DIR" v.PI_BENCH_EXT_DIR "${pkgs.linkFarm "pi-bench-extensions" ((pe (on {})).bench.extensions // exts)}";
+
+  # (M6.14) The default: the flake's packages the bench loads by name (spec
+  # §7), each the path its registry entry links; mkForce {} exports nothing.
+  bench-extensions-default = let
+    c = on {};
+    p = pe c;
+  in
+    eq "extensions" p.bench.extensions {
+      actor-subagents = "${p.actorSubagents.package}/extensions/actor-subagents";
+      infinite-context = "${p.infiniteContext.package}/extensions/infinite-context";
+      pi-retry = "${p.retry.package}";
+      token-meter = "${p.tokenMeter.package}";
+    }
+    ++ holds "mkForce {} exports nothing" (!((on {extensions = lib.mkForce {};}).home.sessionVariables ? PI_BENCH_EXT_DIR));
 
   # (M1.8) The router base as a JSON file, read back without building.
   bench-router = let
diff --git a/modules/bench.nix b/modules/bench.nix
--- a/modules/bench.nix
+++ b/modules/bench.nix
@@ -48,8 +48,11 @@ in {
         The extensions a bench arm loads, by the name the arm uses. Data, not
         the registry: the arms load extensions the registry does not hold, and
         leave out some it does. Exported as a directory of links
-        (`PI_BENCH_EXT_DIR`); `{}` exports nothing, and the bench looks the
-        names up in `~/.pi/agent/extensions`.
+        (`PI_BENCH_EXT_DIR`). Defined by default, one `mkDefault` each, for the
+        flake's packages the bench loads by name: `actor-subagents`,
+        `infinite-context`, `pi-retry`, `token-meter`. A definition adds names
+        or replaces one; `lib.mkForce {}` exports nothing, and the bench then
+        looks the names up in `~/.pi/agent/extensions`.
       '';
     };
 
@@ -81,6 +84,15 @@ in {
 
   config = lib.mkIf cfg.enable {
     home.packages = [cfg.package];
+    # (M6.14) The flake's packages that the bench loads by name (spec §7), one
+    # mkDefault definition each: a host adds its own extensions beside them
+    # (claude-auth, web-search) and may replace one by name.
+    programs.piEconomics.bench.extensions = lib.mapAttrs (_: lib.mkDefault) {
+      actor-subagents = "${pe.actorSubagents.package}/extensions/actor-subagents";
+      infinite-context = "${pe.infiniteContext.package}/extensions/infinite-context";
+      pi-retry = "${pe.retry.package}";
+      token-meter = "${pe.tokenMeter.package}";
+    };
     home.sessionVariables =
       {
         PI_BENCH_DATA = cfg.dataDir;
```

### S11 — `checks/home-files/default.nix` (diff against M3's state)

At M4's end `nativeBuildInputs` already holds `pkgs.jq` and the configuration `cacheLifecycle`, `experiments`: add only `pkgs.nodejs`, the two attributes and the shell part. The retry probe compares `.packages` only, so M4's `cacheWarming` does not disturb it.

```diff
@@ -13,6 +13,21 @@
         agentDir = dir;
         tokenMeter.enable = true;
         analysisSkill.enable = true;
+        # (M6.16)
+        infiniteContext = {
+          enable = true;
+          reminders = {
+            overrides."anthropic/claude-opus-5-5" = {
+              startTokens = 400000;
+              everyTokens = 100000;
+            };
+            prices."anthropic/claude-opus-5-5" = {
+              w = 5;
+              r = 0.2;
+            };
+          };
+        };
+        retry.enable = true;
       };
     };
     pe = c.programs.piEconomics;
@@ -38,10 +53,29 @@
         if grep -qF '.pi/agent' ${skill}/SKILL.md; then echo "FAIL ${dir}: SKILL.md still names .pi/agent" >&2; exit 1; fi
       ''
     }
+    # (M6.16) infiniteContext: the extension pi loads, and the rendered file
+    # accepted by the extension's own parser (an invalid file is rejected whole).
+    ic=${pe.extensions.infinite-context.path}
+    for f in index.ts settings.ts; do
+      [ -f $ic/$f ] || { echo "FAIL ${dir}: infinite-context lacks $f" >&2; exit 1; }
+    done
+    node --experimental-strip-types --input-type=module -e "
+      import { readFileSync } from 'node:fs';
+      import { parseSettingsWithError } from '$ic/settings.ts';
+      const r = parseSettingsWithError(readFileSync(process.argv[1], 'utf8'));
+      if (r.error !== undefined) { console.error(r.error); process.exit(1); }
+    " ${c.home.file."${dir}/infinite-context/settings.json".source} || { echo "FAIL ${dir}: infinite-context rejects its settings.json" >&2; exit 1; }
+    # retry: the repository, whose package.json names the entry point; the
+    # stale package entries go.
+    rt=${pe.extensions.pi-retry.path}
+    jq -e '.pi.extensions == ["./retry.ts"]' $rt/package.json >/dev/null && [ -f $rt/retry.ts ] || { echo "FAIL ${dir}: pi-retry entry point" >&2; exit 1; }
+    printf '{"packages":["https://github.com/monotykamary/pi-retry","git:github.com/monotykamary/pi-retry","npm:x"]}\n' >"$TMPDIR/retry.json"
+    ${lib.getExe pe.piSettings.package} "$TMPDIR/retry.json" 2>/dev/null
+    jq -e '.packages == ["npm:x"]' "$TMPDIR/retry.json" >/dev/null || { echo "FAIL ${dir}: settings.json after ops.retry: $(cat "$TMPDIR/retry.json")" >&2; exit 1; }
     echo "ok ${dir}"
   '';
 in
-  pkgs.runCommand "home-files" {nativeBuildInputs = [pkgs.gnugrep pkgs.diffutils];} ''
+  pkgs.runCommand "home-files" {nativeBuildInputs = [pkgs.gnugrep pkgs.diffutils pkgs.jq pkgs.nodejs];} ''
     set -euo pipefail
     ${lib.concatMapStrings case dirs}
     touch $out
```

Order inside S1: the inputs and `packages` lines land in M6.4/M6.6; the two `homeModules.default` lines only with their modules (M6.8, M6.11). Setting `infiniteContext.src` before `modules/infinite-context.nix` exists breaks every check that evaluates Home Manager (seen: `The option 'programs.piEconomics.infiniteContext' does not exist` in `module-eval`, `home-files`, `pi-settings-migrate`).

### S12 — `docs/pi-economics.md` (M6.18)

- `## infiniteContext`: what it links (`extensions/infinite-context`, children too), the always-written `infinite-context/settings.json`, the `reminders` options with the resolution order (exact model, provider, `default`, 75 % / 5 % of the window), `settings` merged with `recursiveUpdate`, the strict parser (an unknown key rejects the file), the soft dependencies (experiments' `foldHint` flag; cacheLifecycle's `context_peek` guard), the two patches.
- `## retry`: the link (whole repository), no file, `piSettings.ops.retry` (the removals, the child rule only with actorSubagents, `settings` as `piRetry` leaves at order 500, applied only while `piSettings.enable`), the free-cap patch.
- `## bench`: the `extensions` default and how a host adds or replaces names (`lib.mkForce {}` for none).
- `## Checks`: `infinite-context`, `retry`, `typecheck-{infinite-context,retry}` and what each copy leaves out (D7, D8); `home-files`' parser and op probes.
- `## Resync (M6.0)`: the npm lock at pi 1.3.0; the patches upstream made unnecessary (actor-subagents first-turn: pi 1.2.0; infinite-context foreign-messages: upstream `e6ff6803`; pi-retry print-mode: upstream 0.11.0) — the spec's §2 and §9 rows still name them (Q4); D5's line.

### S13 — The doc move's scrub (M6.D)

| In the host's text | Becomes |
|---|---|
| `programs.pi.{tokenMeter,taskRouter,cacheLifecycle,experiments}.{…, linkExtension}` (line 54) | `programs.piEconomics.<component>.{enable, package, settings}`; `linkExtension` gone (registry, §5.1) |
| `my.hm.features.ai.piContextReminders.*` | `programs.piEconomics.infiniteContext.reminders.*` |
| `"http://earth:11545"` (line 62) | `"http://<host>:11545"` |
| `modules/home-manager/features/ai/extensions/<c>/` | `packages/<c>/` |
| `ai/pi-{actor-subagents,infinite-context,retry}.nix` and their patches | `packages/<c>/package.nix`, `patches/pi-<input>/` |
| `pkgs/pi-bench` | `packages/bench` |
| `ai/pi-settings-migrate.nix` | `modules/common.nix` (`piSettings`) |
| the host's `docs/specs/2026-10-02-…`, `docs/plans/2026-10-02-…`, `~/.pi/agent/notes/…` | dropped (§2), or this repository's spec where the fact is there |
| a user name | `<user>` |

Every section keeps its content; the M5 router section, if M5 has not landed, is the reason this task waits (D17).

## Open questions (each with the proposed decision)

- **Q1 (D5):** the flake's spawn-policy patch differs from the host's by one type-only test line, so actorSubagents' derivation is no longer the host's until W. *Proposal:* keep D5 and ask the owner to take the same line into the host's patch at its next rebase (bytes converge again); the alternative is to leave `spawn-policy.test.ts` out of the type-check copy and keep the host's bytes.
- **Q2 (D8):** pi-retry's tests stay out of `tsc`. *Proposal:* keep D8 (the code pi loads is checked, vitest runs the tests); the alternative edits the free-cap patch's own test (two `errorMessage` accesses) and still has to leave upstream's `child-retry.test.ts` out.
- **Q3 (D11):** the bench default as per-name `mkDefault` definitions (a host definition adds names) rather than the option's `default` (a host definition replaces all). *Proposal:* per-name; M5 adds `task-router` the same way; W adds `claude-auth`, `web-search`.
- **Q4:** spec §2 (`actorSubagents`: "first-turn"; `retry`: "print-mode") and §9 (M2 "3 patches", M6 "print-mode and free-cap patches") name patches that `4c714f0` dropped. *Proposal:* M6.18 adds a dated "Amendment (M6)" line under §2, as §4 carries "Amendment (M2)", and the Execution Record names the deviation.

**Decisions (main, 2026-10-25):** Q1 keep D5 (the host's copies of the patches are deleted at W anyway; the W plan's derivation comparison must allow this one type-only line, and the owner is told then); Q2 keep D8; Q3 per-name `mkDefault`; Q4 amendment line in M6.18. M6 starts after M4 has landed (shared `flake.nix`, `checks/`).

---

# Execution Record
