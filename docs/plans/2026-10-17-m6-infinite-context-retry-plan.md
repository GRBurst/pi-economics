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
- **Cases:** `checks/module-eval/cases/infinite-context.nix` (8) and `cases/retry.nix` (7) (S8, S9), a host-like case, `bench-extensions-default` in `cases/bench.nix`, both components in `cases/together.nix`. `home-files` builds both extension directories, parses the rendered `infinite-context/settings.json` with the package's own `parseSettingsWithError`, and runs `ops.retry` through the activation's script (S10).
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
| Every check built with both `git+file://` and `path:` refs | PASS: M6.20 (prototype: all 19 checks green under both, on M3's state) |
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
| Module evaluation (`module-eval`) | both components off, on, package, files, today's default file, the reminder render, the merge, the registry entries, today's ops and program, the child rule's soft dependency, the settings leaves, the host-like combination, the bench's extension default, every component together | Home Manager; M4's final count + 15 cases (prototype on M3's state: 57) |
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
- P2 `drv(packages.infinite-context) = drv(host piInfiniteContext)`, `drv(packages.retry) = drv(host piRetry)`, `drv(checks.{infinite-context,retry}) = drv(host checks.pi-{infinite-context,retry})` (M6.20, `h`-archived host tree; prefixes in D6, D9).
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
