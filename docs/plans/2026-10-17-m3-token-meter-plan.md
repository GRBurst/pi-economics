# M3 — `tokenMeter` and `analysisSkill`: TDD plan

Date: 2026-10-18 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 · Milestone: M3 (§9) · Base: this repository at the end of M2 (plan `docs/plans/2026-10-17-m2-actor-subagents-plan.md`, `c57076e`, with the parent's change: a user-set `actorSubagents.settings.childExtensions` is an assertion error). M2 was executing while this plan was written (HEAD `00dc0f1` = M2.1).

Source commit: host dotfiles `f6a3c81`, `projects/nixos/new/modules/home-manager/features/ai/extensions/token-meter/` (without `nix/hm-module.nix`, which `modules/token-meter.nix` replaces), `…/ai/skills/pi-token-economics-analysis/SKILL.md`; read only: `checks/pi-log-contract/default.nix` (part 2 is ported, D9), `…/ai/pi-extensions.nix` lines 60, 182–192, 337–348, host `flake.nix` line 271 (`pi-token-meter`). Drift checked while planning: `git dot diff --stat f6a3c81 HEAD -- <those paths and every path M0–M2 moved>` is empty at host HEAD `14b84d9` (2026-10-18). Task M3.0 checks again.

## Motivation

§9 row M3: `tokenMeter` (reports, `LOGS.md`) and `analysisSkill`. The host's token-meter package moves to `packages/token-meter/`; its own 154 tests run as before and it passes `tsc --strict` (§8.1). The component `programs.piEconomics.tokenMeter` registers the extension for main sessions and children (§5.1), puts `meter-report` and `pi-analyse` on `PATH`, installs `<agentDir>/LOGS.md`, and writes `<agentDir>/token-meter/settings.json` only when `settings` is non-empty (§4). The skill moves to `skills/pi-token-economics-analysis/` (§3); `programs.piEconomics.analysisSkill` writes no file and exports `path`, a skill directory whose text names `~/<agentDir>` instead of the hard-coded `~/.pi/agent` (§4.1). `analysisSkill` without `tokenMeter` is an assertion error, the spec's one hard dependency besides the router's (§4.1). The move is pure (§1): with the default `agentDir` the installed package equals the host's build file for file, the skill's text is the host's byte for byte, and the actor-subagents settings file with both components is the host's.

## Approach

- `packages/token-meter/` = the host's directory at `f6a3c81`, without `nix/`; `package.nix` at its root is the host's `nix/package.nix` with its two relative paths moved up (`./package.json`, `./.`) and a new header (S2). Flake output `packages.x86_64-linux.token-meter`; checks `token-meter` (the package: its `checkPhase` runs `node --test`, the host's check `pi-token-meter`) and `typecheck-token-meter` (M0's runner).
- `tsc --strict` reports three TS7053 in `core/analyse.ts` (one spread whose index signature TypeScript drops); a type annotation on one line fixes all three (S3).
- `modules/token-meter.nix`: `enable`, `package`, `settings`; the registry entry `token-meter` (`forChildren = true`, `checkPath` = the flake's source `index.ts`, `input = null`); `home.packages`, `<agentDir>/LOGS.md`, the settings file (S4). The host's `linkExtension` option is not carried over: the registry replaces it (§5.1).
- `modules/analysis-skill.nix`: `enable`, internal read-only `text` (`builtins.replaceStrings ["~/.pi/agent"] ["~/<agentDir>"]` over the copied `SKILL.md`), `package` (`writeTextFile`, `SKILL.md` at the root of a directory), read-only `path` (`"${package}"`, `null` while disabled), and the assertion (S6).
- Module-evaluation cases in `checks/module-eval/cases/{token-meter,analysis-skill}.nix` (6 + 5), and both components appended to `cases/together.nix`'s `components`. One case ports part 2 of the host's `pi-log-contract` (the skill names the command and the `LOGS.md` the meter installs); part 1, which runs every log writer, stays M5's (§8.1).
- A new build check `home-files` builds what the cases only evaluate: the extension directory, `LOGS.md`, both commands on an empty agent dir, and the skill directory, for two `agentDir`s (S8).
- §2: the package's code comments that cite the host's 2026-10-02 spec and plan (`spec §5.7`, `T13.11`, `plan S4`, …) lose the citation (18 lines, S10). Test names, `LOGS.md`, the report's `SC3` label and the skill's text stay as copied (D10).

## Decisions

| # | Decision | Rationale | Rejected alternative, and why |
|---|---|---|---|
| D1 | `packages/token-meter/package.nix` (host's `nix/package.nix`, paths `../package.json` → `./package.json`, `./..` → `./.`, header rewritten); `nix/` not copied | §3 `packages/<c>/`, the layout M1 and M2 use (`package.nix` at the package root); `nix/hm-module.nix` is replaced by the component | Copying `nix/` verbatim: a dead second module next to `modules/token-meter.nix`, and a `package.nix` whose header says it is the standalone export |
| D2 | Flake output `packages.x86_64-linux.token-meter`; checks `token-meter` (the package) and `typecheck-token-meter` | §3; kebab-case like `actor-subagents`; the package's build runs its tests, as the host's check `pi-token-meter` did (`flake.nix:271`) | A second `node --test` derivation: the tests would run twice |
| D3 | The `tsc --strict` fix: `const data: (Record<string, string \| number> & { y: number })[] = …` at `core/analyse.ts:191` | Type-only, erased by `--experimental-strip-types`; matches what the code does (`d[f]` a flag string, `d.y` a number) and what `olsInteractions` takes | `Record<string, any>[]` or `as any`: hides the error instead of typing it (M1 D4) |
| D4 | Registry entry: `path = "${package}"`, `checkPath = ../packages/token-meter/index.ts`, `input = null`, `forChildren = true`, the host's description | §5.1: probing the build output is import-from-derivation (the case pins "no derivation behind `checkPath`"); the source is this flake's own, so no input is to blame (message ends `.`); children are what the meter is for (host `pi-extensions.nix:182-192`) | `input = "pi-economics (packages/token-meter)"`: a message that calls the flake an input; leaving `checkPath` at its default: evaluation silently builds the package (seen while planning) |
| D5 | `settings` type `attrsOf (pkgs.formats.json {}).type` | An object is what the file holds; same type as M1's `router` and M2's `settings`; the host sets none, its check sets `{x = 1;}`, which still evaluates | The host's `(pkgs.formats.json {}).type`: accepts a list or a number for a settings object |
| D6 | No `linkExtension` | §5.1 "The registry replaces the `linkExtension` options" | Keeping it: a second way to link the extension |
| D7 | `analysisSkill.text` (internal, read-only) = `builtins.replaceStrings ["~/.pi/agent"] ["~/${agentDir}"] (readFile SKILL.md)`; `package` = `writeTextFile {destination = "/SKILL.md";}` of it | The text is a literal at evaluation, so the cases read it without import-from-derivation (§4's reason for literal settings files); the directory is built, as §4.1 says ("substituted at build time"), and `home-files` checks the built file | `substitute`/`replaceVars` in a `runCommand`: every check of the text would have to build it; `@agentDir@` placeholders: the copied file would no longer be the host's |
| D8 | Every `~/.pi/agent` in the skill is substituted (4 places: the intro, `reports/`, `LOGS.md`, `experiments/state.json`), not only `LOGS.md` | One text naming two agent dirs would send the agent to `~/<agentDir>/LOGS.md` and `~/.pi/agent/reports`; pi-analyse resolves all of them from one agent dir (`bin/pi-analyse.ts`: `--agent-dir`, else `PI_CODING_AGENT_DIR`, else `~/.pi/agent`) | `LOGS.md` only (§4.1's literal words): an inconsistent text for any other `agentDir` (open question Q1) |
| D9 | `analysisSkill.path`: `nullOr path`, read-only, `"${package}"` while enabled, `null` otherwise; `package` per §4 ("every component has `enable` and `package`") | The component's only output; `null` makes a disabled skill impossible to wire by accident; the host's selection takes `attrsOf path` (host `ai/default.nix:735-742`) | `path` defined while disabled: `enable` would gate only the assertion (open question Q2) |
| D10 | §2 re-pointing covers code comments only (18 lines, S10); test names (`"T8.7: …"`, `"… (T13.8)"`), `LOGS.md`'s task ids (`T5.20`–`T5.22`, `T8.10`), the report label `"Qwen share of tasks (SC3: ≥ 30%)"` (`core/analyse.ts:557`) and the skill's `SC3` stay until P | §2 names code comments; tests stay as copied (§8.3, as M2 Q6); `LOGS.md` and the skill are installed text, and the label is report output: unchanged, W2's home-file comparison shows them unchanged | Editing them now: changes the installed files and a report, which a pure move does not (open question Q4) |
| D11 | Part 2 of the host's `pi-log-contract` (the skill names the installed command and `~/<agentDir>/LOGS.md`; planted P32) becomes the module-eval case `analysis-skill-contract` in M3 | Its two sides arrive in M3, and it is the reason for the hard dependency; M5's log contract keeps part 1 (all four writers) | Waiting for M5: the coupling §4.1 asserts would be untested for two milestones |
| D12 | New build check `home-files` (`checks/home-files/default.nix`) for M3's components | module-eval only evaluates; nothing else proves that `"${package}/LOGS.md"` exists, that the commands run, or that the skill directory holds `SKILL.md` at its root, which the host's skills wiring links | Building inside `module-eval`: mixes evaluation and builds in one check |
| D13 | No flake output for the skill | Its text depends on `agentDir`, a module value; the host wires `analysisSkill.path` | `packages.<system>.pi-token-economics-analysis`: the default-`agentDir` build only, unused |
| D14 | The inline `__piExperimentsApi_v1` type in `core/shell.ts:25` stays inline in M3 | §8.1: the comparison against experiments starts in M4; the alias belongs to the task that names it (M1 D14) | Aliasing now: a type edit no check reads |
| D15 | Assertion message `pi-economics: analysisSkill requires tokenMeter (the skill runs pi-analyse and reads LOGS.md, which tokenMeter installs)` | §4.1's form `pi-economics: <c> requires <d> (<reason>)`; a user reads it, so the case pins the literal | Naming the options (`programs.piEconomics.…enable`): longer, same information |

## The gate

No principles document; the gate is §4's rules, §8's testing rules, `AGENTS.md` and the M0–M2 lessons.

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: every task has a RED; the characterisation tasks (M3.6, M3.9, M3.10, M3.11) and the move (M3.1) carry planted violations |
| No `builtins.match` on generated text | PASS: `eq`, `holds`, `lib.hasInfix`, `lib.hasSuffix`, `lib.splitString` |
| Typed options; assertions for invariants | PASS: `enable`, `package`, `settings` (JSON object), `path` (`nullOr path`); the hard dependency is an assertion (M3.8) |
| camelCase options, kebab-case directories (§4) | PASS: `tokenMeter`, `analysisSkill`; `packages/token-meter`, `skills/pi-token-economics-analysis`, `token-meter/settings.json` |
| Settings files are literal text (§4) | PASS: `.text = builtins.toJSON settings`; the skill's text is a literal too (D7) |
| Merges with `lib.recursiveUpdate` (§4) | N/A: no file of M3 has two writers |
| Every assertion message `pi-economics:` with a negative case | PASS: D15, case `analysis-skill-requires-meter` |
| No import-from-derivation | PASS: `checkPath` probes the source (planted in M3.3: without it, evaluation builds the package, and `token-meter-defaults` fails); the skill text is read before it is built |
| Scripts strict and dependency-explicit | PASS: the package's `writeShellApplication` wrappers unchanged; `home-files` runs `set -euo pipefail` with `nativeBuildInputs` |
| Alejandra on every changed `.nix` file | PASS: CLEAN steps; the prototype passed `alejandra --check` over every tracked `.nix` file |
| Markdown under `docs/` (+ `README.md`, `AGENTS.md`) | PASS: `skills/…/SKILL.md` and `packages/token-meter/LOGS.md` are package data, as `packages/bench/README.md` is; `docs/` gets the component sections |
| `flake.lock` changes only as needed | PASS: no new input; the lock is not touched |
| Leak patterns (§8.3) | PASS: `leak` green with the package and the skill (prototype); no host or person name in the copied tests |
| Host read-only | PASS: `git dot show`/`archive`/`diff` only |
| Every check built with both `git+file://` and `path:` refs | PASS: M3.14 (prototype: all 12 of its checks green under both) |
| Pure move (§1) | PASS: tree `diff -r` with the host's, the built package `diff -r` with the host's build, the skill `cmp` with the host's, today's actor-subagents file (`token-meter-children`), the package name the host's check matches |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION.

## Files to read first

Listed, not quoted; the tasks show only what changes.

- The spec: §1, §2 (rows `tokenMeter`, `analysisSkill`; citations), §3, §4 (rows `tokenMeter`, `analysisSkill`), §4.1 (hard dependencies, standalone notes, soft dependencies of `tokenMeter`), §5.1, §5.3, §8.1, §8.3, §9 (row M3, "Drift").
- The M2 plan: "Interfaces M2 publishes", D12, S9 (`cases/together.nix`), and its Execution Record (deviations, the final case count N, the `childExtensions` assertion). The M1 plan's D4, D11, D14.
- This repository at M2's end: `flake.nix`, `checks/default.nix`, `checks/module-eval/{default.nix,expect.nix,cases/actor-subagents.nix,cases/together.nix}`, `checks/lib/hm-eval.nix`, `checks/typecheck/default.nix`, `modules/{common,actor-subagents,default}.nix`, `docs/pi-economics.md`.
- Host at `f6a3c81` (`host <path>`): `$ai/extensions/token-meter/{nix/package.nix,nix/hm-module.nix,package.json,index.ts,core/settings.ts,core/shell.ts (lines 1–30),bin/pi-analyse.ts (lines 1–35),test/portable.test.ts}`, `LOGS.md` lines 1–20; `$ai/skills/pi-token-economics-analysis/SKILL.md`; `checks/pi-log-contract/default.nix`; `$ai/pi-extensions.nix` lines 60, 182–192, 337–348; `checks/pi-extensions.nix` lines 49–60, 140–141, 187, 220–259 (what W2 will read).
- This plan's Snippets.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| `tsc --strict` via `typecheck-token-meter` | from M3.2, every build | the three TS7053 at `core/analyse.ts:194,195,199` until D3; any later implicit `any` |
| Nix module system | `module-eval` | unknown options (each module task's RED), a non-object `settings`, a definition of the read-only `path` or `text` |
| shellcheck | build of the `meter-report`/`pi-analyse` wrappers | unchanged scripts |
| Interface comparison token-meter vs `__piExperimentsApi_v1` | N/A: M4 (§8.1, D14) | — |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package tests (`token-meter`) | the copied suite: 154 tests (shell, line, join, ratelimit, report, arms, guards, tasks, contract, delegation, ledger, analyse, pi-analyse, portable, settings) | nodejs; ~10 s, 0.14 GiB |
| Type check (`typecheck-token-meter`) | `--strict` over `index.ts`, `core/`, `bin/`, `test/` | the shared lock; ~15–20 s, 0.25 GiB |
| Module evaluation (`module-eval`) | both components off, on, their files, packages, settings, the registry entry, children, the skill text, the assertion, the skill↔meter contract, every component together | Home Manager (M0 harness); N + 11 cases, ≤ 1.8 GiB, ~100 s under load |
| Build check (`home-files`) | the rendered sources exist and are what pi and the harnesses read; both commands run on an empty agent dir | the package and the skill directory; ~12 s, 0.43 GiB |
| Leak (`leak`) | the copied package and skill | — |
| Log contract part 1 (every writer → `pi-analyse --check`) | N/A: M5, once task-router, cache-lifecycle and experiments are here (§8.1) | — |
| Interface comparison with `__piExperimentsApi_v1` | N/A: M4 | — |
| Layer B, activation | N/A: W2 (§9.1), owner step | — |

## Scenario coverage

| Spec scenario | Check · case (task) |
|---|---|
| §2 `tokenMeter` = `ai/extensions/token-meter/` + `meter-report`, `pi-analyse`, `LOGS.md` | M3.1 Step 4 (`diff -r` tree; built output `diff -r` with the host's build); `token-meter-files` (M3.4) |
| §2 `analysisSkill` = `ai/skills/pi-token-economics-analysis/` | M3.7 Step 4 (`cmp` with the host's); `analysis-skill-today` (M3.7) |
| §3 `packages/<c>/`, `packages.<c>`, `skills/pi-token-economics-analysis/` | M3.14 gate (`packages` lists `token-meter`); `token-meter-package` (M3.3) |
| §4 `enable`, `package` (both components) | `token-meter-off`, `-defaults`, `-package` (M3.3); `analysis-skill-off`, `-text` (M3.7) |
| §4 `token-meter/settings.json` if non-empty | `token-meter-files` (none with `{}`), `token-meter-settings` (M3.4, M3.5) |
| §4 `LOGS.md`; `home.packages` = report, analyse | `token-meter-files` (M3.4); `home-files` (M3.10) |
| §4 `analysisSkill` writes none; exports `path` | `analysis-skill-text` ("no file of its own", `path`) (M3.7) |
| §4.1 hard: `analysisSkill` requires `tokenMeter.enable`; message form; negative case | `analysis-skill-requires-meter` (M3.8) |
| §4.1 the skill drives `pi-analyse` and reads `LOGS.md` | `analysis-skill-contract` (M3.9); `home-files` (commands run, `LOGS.md` is the package's) (M3.10) |
| §4.1 the skill's text names `<agentDir>/LOGS.md`, substituted at build time | `analysis-skill-text` (M3.7); `home-files` (the built file) (M3.10) |
| §4.1 soft dependencies of `tokenMeter` (none warns) | `token-meter-defaults` (warnings = bare); `components-together` (M3.11) |
| §5.1 registry: link, `forChildren`, `checkPath` without import-from-derivation | `token-meter-defaults` (M3.3) |
| §5.1 children: link paths; host's child set includes token-meter | `token-meter-children` (M3.6) |
| §5.3 token-meter consumes `__piExperimentsApi_v1` | N/A: M4 (D14) |
| §8.1 package tests; `tsc --strict`; a forced edit keeps behaviour | `token-meter` (M3.1); `typecheck-token-meter`, 154 tests after (M3.2) |
| §8.1 each component alone, every component together, host-like | `*-defaults`, `analysis-skill-text`; `components-together` (M3.11); `token-meter-children` (M3.6) |
| §8.1 one negative case per assertion | `analysis-skill-requires-meter` (M3.8) |
| §8.3 leak; neutral fixtures | `leak` (M3.1, M3.7, M3.14) |
| §2 citations re-pointed | M3.12 Step 2 |
| §9 drift | M3.0, M3.14 Step 3 |

## Properties

- `token-meter-defaults`: ∀ dir ∈ {".pi/agent", "custom/agent"}: entry = {path = "${package}"; input = null; forChildren = true} (read from the evaluated `package`) ∧ checkPath ends in `/packages/token-meter/index.ts` ∧ {c ∈ context(checkPath) | c has outputs} = ∅ ∧ dir/extensions/token-meter ∈ targets ∧ failed = ∅ ∧ warnings = bare.
- `token-meter-package`: drvPath = `packages.x86_64-linux.token-meter.drvPath` ∧ name = `pi-token-meter-0.1.0` (literal: the host's `checks/pi-extensions.nix:141` matches it).
- `token-meter-files`: ∀ dir: targets(on) = targets(bare) ∪ {dir/extensions/token-meter, dir/LOGS.md} (exact set: no settings file with `{}`) ∧ source(dir/LOGS.md) = "${package}/LOGS.md" ∧ packages(on) ∖ packages(bare) = [report, analyse] ∧ mainProgram(report, analyse) = ["meter-report", "pi-analyse"] (the names the skill and the host use).
- `token-meter-settings`: ∀ dir: fromJSON(text(dir/token-meter/settings.json)) = settings.
- `token-meter-children`: childExtensions(tokenMeter ∧ actorSubagents) = ["/home/u/.pi/agent/extensions/token-meter"] ∧ text(actor-subagents/settings.json) = `{"childExtensions":["/home/u/.pi/agent/extensions/token-meter"]}` (literal: today's file for that registry).
- `analysis-skill-text`: ∀ dir: "~/dir/LOGS.md" ⊂ text ∧ (dir ≠ ".pi/agent" ⇒ ".pi/agent" ⊄ text) ∧ replace("~/dir" → "~/.pi/agent", text) = source ∧ "name: pi-token-economics-analysis" ∈ lines(text) ∧ path = "${package}" ∧ targets(skill ∧ meter) = targets(meter).
- `analysis-skill-today`: text(".pi/agent") = source (bytes).
- `analysis-skill-requires-meter`: failed("pi-economics:", skill ∧ ¬meter) = [D15's message] ∧ failed("", skill ∧ meter) = ∅.
- `analysis-skill-contract`: ∀ dir: c = mainProgram(tokenMeter.package.analyse): c ∈ names(home.packages) ∧ (c + " ") ⊂ text ∧ dir/LOGS.md ∈ home.file ∧ "~/dir/LOGS.md" ⊂ text.
- `components-together`: as M2 S9, with C = {bench, actorSubagents, tokenMeter, analysisSkill}.
- `home-files`: ∀ dir: {package.json, index.ts} ⊂ extension dir ∧ bytes(LOGS.md source) = bytes(packages/token-meter/LOGS.md) ∧ `pi-analyse --check` on an empty agent dir exits 0 printing `contract ok` ∧ `meter-report` exits 0 ∧ ls(skill dir) = [SKILL.md] ∧ (dir = ".pi/agent" ⇒ bytes(SKILL.md) = bytes(source)) ∧ (dir ≠ ".pi/agent" ⇒ "~/dir/LOGS.md" ⊂ SKILL.md ∧ ".pi/agent" ⊄ SKILL.md).
- M3.1 one-offs: tree(flake) = tree(host) ∖ nix/; output(flake package) = output(host `nix/package.nix`, same nixpkgs), file for file.

## Planted violations

Tick in the task once seen.

| Check | Plant | Must fail with | Task |
|---|---|---|---|
| `token-meter` | `test/settings.test.ts`: `{ ...defaults(), dir: "m2" }` → `"m3"` | `✖ known keys override defaults, unknown keys and wrong types are ignored`, `ℹ fail 1` | M3.1 Step 5 |
| `typecheck-token-meter` | (natural red) the copy as is | `core/analyse.ts:194:37 - error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ y: number; }'.` (and `:195:37`, `:199:67`), `Found 3 errors in the same file` | M3.2 Step 2 |
| `module-eval` | delete the `checkPath = …;` line | evaluation builds `pi-token-meter-0.1.0` (import from derivation, it succeeds), then per dir `FAIL token-meter-defaults: checkPath is the source's index.ts (…): does not hold` and `… derivations behind checkPath (…): expected [ ], got [ { outputs = [ "out" ]; } ]` | M3.3 Step 5 |
| `module-eval` | `forChildren = false;` | `FAIL token-meter-defaults: registry entry (.pi/agent): expected { forChildren = true; … }, got { forChildren = false; … }` (both dirs) | M3.3 Step 5 |
| `module-eval` | `home.file.".pi/agent/LOGS.md".source` (hard-coded dir) | `FAIL token-meter-files: home.file targets (custom/agent): …`, `FAIL token-meter-files: LOGS.md source (custom/agent): expected "/nix/store/…-pi-token-meter-0.1.0/LOGS.md", got null` | M3.4 Step 5 |
| `module-eval` | `lib.mkIf true {text = …;}` for the settings file | `FAIL token-meter-files: home.file targets (.pi/agent): …` and `(custom/agent)` (a `token-meter/settings.json` target with `{}`) | M3.5 Step 4 |
| `module-eval` | `forChildren = false;` | `FAIL token-meter-children: childExtensions: expected [ "/home/u/.pi/agent/extensions/token-meter" ], got [ ]` and `… actor-subagents/settings.json: expected "{\"childExtensions\":[\"/home/u/.pi/agent/extensions/token-meter\"]}", got "{\"childExtensions\":[]}"` | M3.6 Step 3 |
| `module-eval` | `path = "${cfg.package}";` (always) | `FAIL analysis-skill-off: path: expected null, got "/nix/store/…-pi-token-economics-analysis"` | M3.7 Step 5 |
| `module-eval` | `replaceStrings ["~/.pi/agent/LOGS.md"] ["~/${pe.agentDir}/LOGS.md"]` (LOGS.md only) | `FAIL analysis-skill-text: no other agent dir (custom/agent): does not hold` | M3.7 Step 5 |
| `module-eval` | `assertion = true;` | `FAIL analysis-skill-requires-meter: without tokenMeter: expected [ "pi-economics: analysisSkill requires tokenMeter (…)" ], got [ ]` | M3.8 Step 4 |
| `module-eval` | `sed -i 's/pi-analyse/pi-analyze/g' skills/pi-token-economics-analysis/SKILL.md` (host P32) | `FAIL analysis-skill-contract: the skill runs pi-analyse (.pi/agent): does not hold` and `(custom/agent)` | M3.9 Step 3 |
| `module-eval` | `home.file."${pe.agentDir}/LOGS.md"` → `home.file.".pi/agent/LOGS.md"` | adds `FAIL analysis-skill-contract: custom/agent/LOGS.md installed (custom/agent): does not hold` | M3.9 Step 3 |
| `home-files` | `destination = "/x/SKILL.md";` | `FAIL .pi/agent: the skill directory holds: x` | M3.10 Step 3 |
| `home-files` | `home.file."${pe.agentDir}/LOGS.md".source = "${cfg.package}/package.json";` | `FAIL .pi/agent: LOGS.md is not the package's` (after `cmp`'s `differ` line) | M3.10 Step 3 |
| `module-eval` | in `modules/token-meter.nix`'s config: `home.file.planted = lib.mkIf pe.actorSubagents.enable {text = "x";};` | `FAIL components-together: home.file targets: expected [ … ], got [ … "planted" … ]`, `1 failure(s)` | M3.11 Step 3 |

Planner's dry run (2026-10-18, scratch clone under `$TMPDIR` at `00dc0f1` with M2's S6, S7, S8, S9, S10 and S1 c applied as a stand-in for M2.2–M2.11; final state of every snippet): 12 checks green under `git+file://` and under `path:` (`token-meter` 154 tests, 0.14 GiB; `typecheck-token-meter` 0.25 GiB, 15–20 s; `module-eval` 42 cases = 31 + 11, 97–105 s, 1.46 GiB / 1.76 GiB peak; `home-files` 0.43 GiB, 11–14 s; load average ≈ 22); `alejandra --check` clean; built package `diff -r` with the host's build: identical. Seen red: every row above except the `home-files` `LOGS.md` row, plus TS7053 ×3; not seen: the option- or attribute-missing REDs. Several `module-eval` plants were seen together in one build (each named its own `FAIL` lines).

## Coverage gap

- **Real pi.** The suite drives `test/fake-pi.ts`; no check loads the extension into pi or spawns a child. W2's activation (owner step) covers it, as for the host today.
- **The agent dir at runtime.** The extension uses pi's `getAgentDir()`, and `pi-analyse` uses `--agent-dir`, else `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. With a non-default `agentDir` the skill and `LOGS.md`'s location follow the option, the runtime follows the environment; they agree only when the host sets both (§4: `PI_CODING_AGENT_DIR` is not modelled). Not checked.
- **The skill as instructions.** Whether an agent follows the skill is not testable here; the cases pin the text, the contract case the names it uses.
- **The host's readers.** `checks/pi-extensions.nix` (link suffix `-pi-token-meter-0.1.0`, the settings case `{x = 1;}`), `eval-assertions.nix:9354-9360` (child set) and `:1175` (local skills), the kit's skills wiring and its frontmatter check: not run here; `token-meter-package`, `-settings`, `-children` and `analysis-skill-text` mirror them; W2 runs them.
- **Log contract part 1** (every writer through `pi-analyse --check`): M5.
- **`__piExperimentsApi_v1`** (arm ids on meter lines): the package's own `shell.test.ts` covers the consumer side with a fake; the comparison with the provider is M4's.

## Environment (every step)

```sh
source ~/.cache/pi/m0env.sh      # XDG dirs, cd, F (git+file), o, cap, nb, ne, fmt, host (f6a3c81), nbl, addcases
Fp=path:$HOME/projects/nix/pi-economics
nbp() { (ulimit -v $cap && exec timeout -s KILL 1500 nix build --no-link -L "$Fp#checks.x86_64-linux.$1" "${o[@]}"); }
ai=modules/home-manager/features/ai
```

- The machine is loaded (load average ≈ 22 while planning): `module-eval` took 100–220 s, against `nb`'s 900 s cap. If `nb` is killed at 900 s, run the same `nix build` with `timeout -s KILL 1500` once more, unchanged, and note it.
- `git+file:` sees only indexed files: `git add` new files (package, skill, case files, check) before `nb`/`ne`.
- `nb` prints no log for an output already in the store: `nbl <check>` to see a green log. `nbl` cannot delete a live output (`token-meter` is the package itself): a 2-second green `token-meter` is a cached one; `nix log` on its `.drv` shows the 154 tests.
- `git dot archive` takes paths relative to `~/projects/nixos/new` when run there; `--strip-components=5` drops `modules/home-manager/features/ai/extensions`, `--strip-components=4` drops `modules/home-manager/features/ai`.
- Plain `git` here; `git dot` only to read the host. Commits unsigned.
- TypeScript edits keep the package's two-space indentation.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/token-meter/**` | the host's package without `nix/`; `package.nix` (S2) | M3.1 |
| `packages/token-meter/core/analyse.ts` | D3, one line | M3.2 |
| `packages/token-meter/{bin,core,test}/*.ts` | 18 comment lines (S10) | M3.12 |
| `flake.nix` | `packages.x86_64-linux.token-meter` | M3.1 |
| `checks/default.nix` | checks `token-meter`, `typecheck-token-meter`, `home-files` | M3.1, M3.2, M3.10 |
| `modules/token-meter.nix`, `modules/default.nix` | the component | M3.3–M3.5 |
| `checks/module-eval/cases/token-meter.nix` | 6 cases | M3.3–M3.6 |
| `skills/pi-token-economics-analysis/SKILL.md` | the host's skill, verbatim | M3.7 |
| `modules/analysis-skill.nix`, `modules/default.nix` | the component, its assertion | M3.7, M3.8 |
| `checks/module-eval/cases/analysis-skill.nix` | 5 cases | M3.7–M3.9 |
| `checks/module-eval/default.nix` | `caseFiles` | M3.3, M3.7 |
| `checks/home-files/default.nix` | the build check | M3.10 |
| `checks/module-eval/cases/together.nix` | `components` += `tokenMeter`, `analysisSkill` | M3.11 |
| `docs/pi-economics.md` | component sections, checks | M3.13 |

Interfaces M3 publishes: options `programs.piEconomics.tokenMeter.{enable, package, settings}` (`package.passthru.{report, analyse}`); `programs.piEconomics.analysisSkill.{enable, package, path}` and internal `.text`; registry entry `token-meter` (`forChildren = true`); `packages.x86_64-linux.token-meter`; check `home-files` (M4–M6 may add their rendered sources); `cases/together.nix`'s `components` with four entries. M4 reads `packages/token-meter/core/shell.ts`'s inline `__piExperimentsApi_v1` type (D14); M5's log contract reads `packages/token-meter`, `tokenMeter.package.analyse` and the skill.

---

## Tasks

| Task | Delivers | Commit |
|---|---|---|
| M3.0 | read; M2 landed; drift | — |
| M3.1 | the copy, `packages.token-meter`, check `token-meter` | `m3: token-meter package copied from the host` |
| M3.2 | `typecheck-token-meter`, D3 | `m3(token-meter): tsc --strict` |
| M3.3 | component: `enable`, `package`, registry entry | `m3(token-meter): module, package, registry entry` |
| M3.4 | `LOGS.md` and the two commands | `m3(token-meter): LOGS.md and the reports` |
| M3.5 | `settings` | `m3(token-meter): settings option` |
| M3.6 | children load the meter (characterisation) | `m3(token-meter): children load the meter` |
| M3.7 | the skill, `analysisSkill` with `text`, `package`, `path` | `m3(analysis-skill): skill and module` |
| M3.8 | `analysisSkill` requires `tokenMeter` | `m3(analysis-skill): requires tokenMeter` |
| M3.9 | the skill names what the meter installs (characterisation) | `m3(analysis-skill): contract with tokenMeter` |
| M3.10 | `home-files` | `m3: home-files builds the rendered sources` |
| M3.11 | every component together | `m3: tokenMeter and analysisSkill together with the rest` |
| M3.12 | citations (§2) | `m3(token-meter): drop citations of the host's documents` |
| M3.13 | docs | `m3: docs for tokenMeter and analysisSkill` |
| M3.14 | gate, Execution Record | `m3: execution record` |

Every task starts at `[ ]`. Order as numbered. Never more than one red check at a time. N below is `module-eval`'s case count at M2's end (M3.0 Step 2; planned 31, more if M2 added a case for its `childExtensions` assertion).

### Task M3.0 — Read, M2 landed, drift

- [ ] **Step 1:** read "Files to read first".
- [ ] **Step 2 (M2 landed):** `git log --oneline | grep -c ' m2: execution record$'` → `1`; `ne checks.x86_64-linux --apply builtins.attrNames --json` → `["actor-subagents","bench","iface-harness","iface-subagents-bench-probe","leak","leak-selftest","module-eval","npm-deps","pi-settings-migrate","typecheck-actor-subagents","typecheck-bench","typecheck-harness"]`; `nbl module-eval` → `N cases passed` (note N); `grep -c '"bench" "actorSubagents"' checks/module-eval/cases/together.nix` → `1`; `ne homeModules.default --apply 'm: builtins.isAttrs m'` → `true` (M2 D3). Otherwise stop: M3 builds on M2's end state. Read M2's Execution Record; a deviation that touches a file of this plan's File structure is reconciled before M3.1 (adapt S1, S9 to M2's actual text).
- [ ] **Step 3 (drift, §9):**

```sh
(cd ~/projects/nixos/new && git dot diff --stat f6a3c81 -- $ai/extensions/token-meter \
  $ai/skills/pi-token-economics-analysis checks/pi-log-contract $ai/pi-extensions.nix checks/pi-extensions.nix \
  pkgs/pi-bench $ai/pi-settings-migrate.nix checks/pi-settings-migrate checks/pi-retry/package.json \
  checks/pi-retry/package-lock.json $ai/pi-actor-subagents.nix $ai/pi-actor-subagents-child-prompt.patch \
  $ai/pi-actor-subagents-spawn-policy.patch $ai/pi-actor-subagents-first-turn.patch checks/pi-actor-subagents; echo "rc=$?")
(cd ~/projects/nixos/new && git dot log -1 --format=%h HEAD)
```

Expected: no file line, `rc=0`. A listed file is drift: stop and report; it is ported first, with its test. Note the host's HEAD for M3.14.

### Task M3.1 — The copy, `packages.token-meter`, check `token-meter`

**Files:** create `packages/token-meter/**`; modify `flake.nix`, `checks/default.nix` (S1, M3.1 lines).

- [ ] **Step 1:** the `token-meter` line in `flake.nix`'s `packages` and the `token-meter` check in `checks/default.nix` (S1).
- [ ] **Step 2 (RED):** `nb token-meter` → evaluation error: `Path 'packages/token-meter/package.nix' does not exist in Git repository` (or `attribute 'token-meter' missing` if the flake line was staged alone).
  - [ ] red seen
- [ ] **Step 3 (GREEN):**

```sh
(cd ~/projects/nixos/new && git dot archive f6a3c81 -- $ai/extensions/token-meter) | tar -x -C packages --strip-components=5
mv packages/token-meter/nix/package.nix packages/token-meter/package.nix
rm -r packages/token-meter/nix
# S2: the header and the two path lines of packages/token-meter/package.nix
git add packages/token-meter flake.nix checks/default.nix
nbl token-meter
```

Expected: the log ends with `ℹ tests 154`, `ℹ pass 154`, `ℹ fail 0`.
- [ ] **Step 4 (pure move, one-off evidence):**

```sh
h=$(mktemp -d); echo '{}' > "$h/config.nix"
(cd ~/projects/nixos/new && git dot archive f6a3c81 -- $ai/extensions/token-meter) | tar -x -C "$h" --strip-components=5
diff -r -x nix -x package.nix "$h/token-meter" packages/token-meter && echo "tree identical"
diff "$h/token-meter/nix/package.nix" packages/token-meter/package.nix      # S2's lines only
ho=$( (export NIXPKGS_CONFIG=$h/config.nix; ulimit -v $cap && exec timeout -s KILL 1500 nix build --no-link --print-out-paths --impure \
  --expr "(builtins.getFlake \"$F\").inputs.nixpkgs.legacyPackages.x86_64-linux.callPackage $h/token-meter/nix/package.nix {}" "${o[@]}") )
fo=$( (ulimit -v $cap && exec timeout -s KILL 1500 nix build --no-link --print-out-paths "$F#packages.x86_64-linux.token-meter" "${o[@]}") )
diff -r "$ho" "$fo" && echo "outputs identical"
rm -rf "$h"
```

Expected: `tree identical`; the `diff` shows the header and lines `manifest = …` and `src = …` of S2 only; `outputs identical` (the installed `package.json`, `index.ts`, `core/`, `bin/`, `LOGS.md` are the host's).
- [ ] **Step 5 (planted):** `sed -i 's/{ ...defaults(), dir: "m2" }/{ ...defaults(), dir: "m3" }/' packages/token-meter/test/settings.test.ts; git add -u; nb token-meter` → `✖ known keys override defaults, unknown keys and wrong types are ignored`, `ℹ fail 1`. Undo the edit (`sed` back), `git add -u`, `git diff --cached packages/token-meter/test` empty against the copy.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt flake.nix checks/default.nix packages/token-meter/package.nix`; `nb leak` passes; `ne packages.x86_64-linux --apply builtins.attrNames --json` → `["actor-subagents","bench","token-meter"]`; `git status --short` lists only the files above. Commit.

### Task M3.2 — `typecheck-token-meter`

**Files:** `checks/default.nix` (S1, M3.2 lines), `packages/token-meter/core/analyse.ts` (S3).

- [ ] **Step 1:** add `typecheck-token-meter` (S1).
- [ ] **Step 2 (RED, natural):** `nb typecheck-token-meter` → `core/analyse.ts:194:37 - error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ y: number; }'.`, the same at `:195:37` and `:199:67`, `Found 3 errors in the same file, starting at: core/analyse.ts:194`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** S3. `nbl typecheck-token-meter` → passes, no `error TS` line.
- [ ] **Step 4 (behaviour kept, §8.1):** `nbl token-meter` → `ℹ pass 154`, `ℹ fail 0`; `git diff -U0 packages/token-meter` shows exactly S3's one line (a type annotation).
- [ ] **Step 5 (CLEAN):** `fmt checks/default.nix`. Commit.

### Task M3.3 — Component: `enable`, `package`, registry entry

**Files:** create `modules/token-meter.nix` (S4 without the parts tagged M3.4, M3.5), `checks/module-eval/cases/token-meter.nix` (S5: the `let` block, `token-meter-off`, `-defaults`, `-package`); modify `modules/default.nix`, `checks/module-eval/default.nix` (S9).

- [ ] **Step 1:** the case file with the three cases; list it in `caseFiles`; `git add` it.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.tokenMeter' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the module with `enable`, `package` and the registry entry; its import. `git add modules/token-meter.nix`. `nbl module-eval` → `N+3 cases passed` (`inert` stays green: the component is off by default).
- [ ] **Step 4:** `nb leak` passes.
- [ ] **Step 5 (planted):** (a) delete the `checkPath = …;` line → evaluation builds `pi-token-meter-0.1.0` during evaluation, then per dir `FAIL token-meter-defaults: checkPath is the source's index.ts (…): does not hold` and `… derivations behind checkPath (…): expected [ ], got [ { outputs = [ "out" ]; } ]`; revert. (b) `forChildren = false;` → `FAIL token-meter-defaults: registry entry (.pi/agent): …` (both dirs); revert.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 6 (CLEAN):** `fmt modules/token-meter.nix modules/default.nix checks/module-eval/default.nix checks/module-eval/cases/token-meter.nix`. Commit.

### Task M3.4 — `LOGS.md` and the two commands

**Files:** `modules/token-meter.nix` (S4, tagged M3.4), `checks/module-eval/cases/token-meter.nix` (S5 `token-meter-files`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → per dir `FAIL token-meter-files: home.file targets (…): …`, `… LOGS.md source (…): expected "/nix/store/…-pi-token-meter-0.1.0/LOGS.md", got null`, `… home.packages (…): expected [ "/nix/store/…-meter-report" "/nix/store/…-pi-analyse" ], got [ ]`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the two lines tagged M3.4. `nbl module-eval` → `N+4 cases passed`.
- [ ] **Step 4:** `token-meter-off` still green (nothing while disabled).
- [ ] **Step 5 (planted):** `home.file.".pi/agent/LOGS.md".source` → `FAIL token-meter-files: home.file targets (custom/agent): …` and `… LOGS.md source (custom/agent): expected "…/LOGS.md", got null`; revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt` both files. Commit.

### Task M3.5 — `settings`

**Files:** `modules/token-meter.nix` (S4, tagged M3.5), `checks/module-eval/cases/token-meter.nix` (S5 `token-meter-settings`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.tokenMeter.settings' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the option and the file. `nbl module-eval` → `N+5 cases passed` (`token-meter-files` stays green: `{}` writes no file).
- [ ] **Step 4 (planted):** `lib.mkIf true {text = builtins.toJSON cfg.settings;}` → `FAIL token-meter-files: home.file targets (.pi/agent): …` and `(custom/agent)`; revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files; S4 now holds in full. Commit.

### Task M3.6 — Children load the meter (characterisation)

**Files:** `checks/module-eval/cases/token-meter.nix` (S5 `token-meter-children`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2:** `nbl module-eval` → `N+6 cases passed` (green first: it pins today's child set with M2's file).
- [ ] **Step 3 (planted):** `forChildren = false;` in `modules/token-meter.nix` → `FAIL token-meter-children: childExtensions: expected [ "/home/u/.pi/agent/extensions/token-meter" ], got [ ]` and `… actor-subagents/settings.json: expected "{\"childExtensions\":[\"/home/u/.pi/agent/extensions/token-meter\"]}", got "{\"childExtensions\":[]}"` (with M3.3's `token-meter-defaults` lines); revert.
  - [ ] red seen
- [ ] **Step 4 (CLEAN):** `fmt checks/module-eval/cases/token-meter.nix`; S5 now holds in full. Commit.

### Task M3.7 — The skill and `analysisSkill`

**Files:** create `skills/pi-token-economics-analysis/SKILL.md` (host copy), `modules/analysis-skill.nix` (S6 without the part tagged M3.8), `checks/module-eval/cases/analysis-skill.nix` (S7: the `let` block, `analysis-skill-off`, `-text`, `-today`); modify `modules/default.nix`, `checks/module-eval/default.nix` (S9).

- [ ] **Step 1:** the test first: the case file with the three cases, listed in `caseFiles`; the skill copied (the cases read it):

```sh
mkdir -p skills/pi-token-economics-analysis
host $ai/skills/pi-token-economics-analysis/SKILL.md > skills/pi-token-economics-analysis/SKILL.md
git add skills checks/module-eval/cases/analysis-skill.nix checks/module-eval/default.nix
```

- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.analysisSkill' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the module (options `enable`, `text`, `package`, `path`; config: `text`, `path`), its import. `git add modules/analysis-skill.nix`. `nbl module-eval` → `N+9 cases passed`.
- [ ] **Step 4 (pure move):** `host $ai/skills/pi-token-economics-analysis/SKILL.md | cmp - skills/pi-token-economics-analysis/SKILL.md && echo same` → `same`; `grep -c '~/\.pi/agent' skills/pi-token-economics-analysis/SKILL.md` → `4`; `nb leak` passes.
- [ ] **Step 5 (planted):** (a) `path = "${cfg.package}";` (always) → `FAIL analysis-skill-off: path: expected null, got "/nix/store/…-pi-token-economics-analysis"`; revert. (b) `builtins.replaceStrings ["~/.pi/agent/LOGS.md"] ["~/${pe.agentDir}/LOGS.md"] source` → `FAIL analysis-skill-text: no other agent dir (custom/agent): does not hold`; revert.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 6 (CLEAN):** `fmt modules/analysis-skill.nix modules/default.nix checks/module-eval/default.nix checks/module-eval/cases/analysis-skill.nix`. Commit.

### Task M3.8 — `analysisSkill` requires `tokenMeter`

**Files:** `modules/analysis-skill.nix` (S6, tagged M3.8), `checks/module-eval/cases/analysis-skill.nix` (S7 `analysis-skill-requires-meter`).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → `FAIL analysis-skill-requires-meter: without tokenMeter: expected [ "pi-economics: analysisSkill requires tokenMeter (the skill runs pi-analyse and reads LOGS.md, which tokenMeter installs)" ], got [ ]`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the `assertions` block. `nbl module-eval` → `N+10 cases passed` (`components-together` lists `analysisSkill` only from M3.11).
- [ ] **Step 4 (planted):** `assertion = true;` → the RED line of Step 2; revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** `fmt` both files; S6 now holds in full. Commit.

### Task M3.9 — The skill names what the meter installs (characterisation)

**Files:** `checks/module-eval/cases/analysis-skill.nix` (S7 `analysis-skill-contract`).

- [ ] **Step 1:** add the case (the host's `pi-log-contract` part 2, D11).
- [ ] **Step 2:** `nbl module-eval` → `N+11 cases passed` (green first).
- [ ] **Step 3 (planted):** (a) `sed -i 's/pi-analyse/pi-analyze/g' skills/pi-token-economics-analysis/SKILL.md` (the host's P32) → `FAIL analysis-skill-contract: the skill runs pi-analyse (.pi/agent): does not hold` and `(custom/agent)`; `git checkout skills`. (b) in `modules/token-meter.nix`, `home.file.".pi/agent/LOGS.md".source` → adds `FAIL analysis-skill-contract: custom/agent/LOGS.md installed (custom/agent): does not hold` (besides M3.4's lines); revert.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 4 (CLEAN):** `fmt checks/module-eval/cases/analysis-skill.nix`; S7 now holds in full. Commit.

### Task M3.10 — `home-files`

**Files:** create `checks/home-files/default.nix` (S8); modify `checks/default.nix` (S1, M3.10 line).

- [ ] **Step 1:** the check and its line; `git add checks/home-files`.
- [ ] **Step 2:** `nbl home-files` → `== .pi/agent`, `ok .pi/agent`, `== custom/agent`, `ok custom/agent` (green first: it builds what M3.3–M3.9 render).
- [ ] **Step 3 (planted):** (a) in `modules/analysis-skill.nix`, `destination = "/x/SKILL.md";` → `FAIL .pi/agent: the skill directory holds: x`; revert. (b) in `modules/token-meter.nix`, `"${cfg.package}/package.json"` as `LOGS.md`'s source → `FAIL .pi/agent: LOGS.md is not the package's`; revert.
  - [ ] red seen (a)
  - [ ] red seen (b)
- [ ] **Step 4 (CLEAN):** `fmt checks/home-files/default.nix checks/default.nix`. Commit.

### Task M3.11 — Every component together

**Files:** `checks/module-eval/cases/together.nix` (S9).

- [ ] **Step 1:** `components = ["bench" "actorSubagents" "tokenMeter" "analysisSkill"];` (and its header comment unchanged).
- [ ] **Step 2:** `nbl module-eval` → `N+11 cases passed` (green: `analysisSkill` alone fails its assertion, but the case reads only files, packages and variables of the single components, and the assertions and warnings of all of them together).
- [ ] **Step 3 (planted):** in `modules/token-meter.nix`'s config `home.file.planted = lib.mkIf pe.actorSubagents.enable {text = "x";};` → `FAIL components-together: home.file targets: …`, `1 failure(s)`; revert.
  - [ ] red seen
- [ ] **Step 4 (CLEAN):** `fmt checks/module-eval/cases/together.nix`. Commit.

### Task M3.12 — Citations (§2)

**Files:** 16 `.ts` files of `packages/token-meter` (S10). Comment lines only; test files change only in comments (§2 requires it; no test changes).

- [ ] **Step 1 (before):** `grep -rnE '^\s*//.*(§|T[0-9]+\.[0-9]+|plan S[0-9])' packages/token-meter --include=*.ts | wc -l` → `18`.
- [ ] **Step 2:** the edits of S10. The same `grep` → no line, `rc=1`.
- [ ] **Step 3 (behaviour kept):** `git diff -U0 packages/token-meter | grep -E '^[-+][^-+]' | grep -vc '^[-+]//'` → `0` (36 changed lines, all comments); `nbl token-meter` → `ℹ pass 154`; `nb typecheck-token-meter`, `nb leak`, `nb home-files` pass.
- [ ] **Step 4:** commit.

### Task M3.13 — Docs

**Files:** `docs/pi-economics.md` (S11).

- [ ] **Step 1:** S11.
- [ ] **Step 2:** every name is documented:

```sh
for p in tokenMeter analysisSkill enable package settings path meter-report pi-analyse LOGS.md token-meter typecheck-token-meter home-files skills/pi-token-economics-analysis forChildren; do
  grep -qF "\`$p\`" docs/pi-economics.md || echo "MISSING $p"
done
```

Expected: no `MISSING`. `nb leak` passes.
- [ ] **Step 3:** commit.

### Task M3.14 — Gate and Execution Record

- [ ] **Step 1 (the gate, both refs):** M1.11 Step 1's loop, with `timeout -s KILL 1500` for each build (load). Expected listing per ref: `actor-subagents bench home-files iface-harness iface-subagents-bench-probe leak leak-selftest module-eval npm-deps pi-settings-migrate token-meter typecheck-actor-subagents typecheck-bench typecheck-harness typecheck-token-meter`; no `FAILED`; `packages` `["actor-subagents","bench","token-meter"]`; `homeModules` `["default"]`; formatter `.drv`; `fmt --check $(git ls-files '*.nix')` clean.
- [ ] **Step 2:** `git diff <M2's last commit> -- flake.lock` empty.
- [ ] **Step 3:** drift again (M3.0 Step 3), and `git dot diff --stat <M3.0's host HEAD> HEAD -- <M3.0's paths>`: empty, or ported first.
- [ ] **Step 4:** fill `# Execution Record`: date, commit per task, boxes ticked, red messages seen, the gate's peaks and times, deviations, answers to the open questions.
- [ ] **Step 5:** commit.

---

## Snippets

### S1 — `flake.nix`, `checks/default.nix` (against M2's end state)

`flake.nix`, in `packages.${system}` (M3.1):

```diff
       actor-subagents = pkgs.callPackage ./packages/actor-subagents/package.nix {src = pi-actor-subagents;};
+      token-meter = pkgs.callPackage ./packages/token-meter/package.nix {};
     };
```

`checks/default.nix`, at the end of the attrset (M3.1 `token-meter`, M3.2 `typecheck-token-meter`, M3.10 `home-files`):

```nix
  # The token-meter tests run when it builds (spec §8.1, "Package tests").
  token-meter = self.packages.${pkgs.stdenv.hostPlatform.system}.token-meter;
  typecheck-token-meter = typecheck.typecheck {
    name = "token-meter";
    src = ../packages/token-meter;
  };
  home-files = import ./home-files {inherit lib pkgs hm;};
```

### S2 — `packages/token-meter/package.nix`

The host's `nix/package.nix`, moved up one directory:

```diff
-# The token-meter pi package, tested at build time. Self-contained: this file
-# and ./hm-module.nix are what a standalone flake would export unchanged.
+# The token-meter pi package (spec §2), tested at build time: node --test over
+# test/*.test.ts in checkPhase. passthru.report and passthru.analyse are the
+# two commands the tokenMeter component puts on PATH.
@@
-  manifest = lib.importJSON ../package.json;
+  manifest = lib.importJSON ./package.json;
@@
-    src = lib.cleanSource ./..;
+    src = lib.cleanSource ./.;
```

(`package.nix` is now part of `src`; `installPhase` copies only `package.json index.ts core LOGS.md bin`, so the output is the host's, M3.1 Step 4.)

### S3 — `packages/token-meter/core/analyse.ts:191` (D3)

```diff
-    const data = units.filter((u) => arms.includes(u.arm)).map((u) => ({ ...info.get(u.arm)!.flags, y: u.cost / u.hours }));
+    const data: (Record<string, string | number> & { y: number })[] = units.filter((u) => arms.includes(u.arm)).map((u) => ({ ...info.get(u.arm)!.flags, y: u.cost / u.hours }));
```

(The spread of `Record<string, string>` loses its index signature, so `data` was `{ y: number }[]` and `d[f]` an implicit `any`.)

### S4 — `modules/token-meter.nix` (state after M3.5)

```nix
# The token meter (spec §2, §4): one JSONL line per provider request (tokens,
# cost, quota) under <agentDir>/meter, loaded into children too; the reports
# meter-report and pi-analyse on PATH, and LOGS.md, the manual of every log
# pi-analyse reads.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.tokenMeter;
in {
  options.programs.piEconomics.tokenMeter = {
    enable = lib.mkEnableOption "the pi token-meter extension (per-request token, cost and quota log) and its reports";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/token-meter/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/token-meter/package.nix { }";
      description = ''
        The extension (package.json, index.ts, core/, LOGS.md); its tests run
        when it builds. `passthru.report` and `passthru.analyse` are the
        commands put on PATH (`meter-report`, `pi-analyse`).
      '';
    };

    # (M3.5)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {dir = "meter";};
      description = ''
        Written to `<agentDir>/token-meter/settings.json` when non-empty.
        Every key has a default in the package's core/settings.ts (`enabled`,
        `dir`, `rawRatelimit`), so `{}` writes no file.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # (M3.3) Loaded into children too: their requests are what the meter is for.
    programs.piEconomics.extensions.token-meter = {
      path = "${cfg.package}";
      # The source, not the package: probing a build output would be
      # import-from-derivation.
      checkPath = ../packages/token-meter/index.ts;
      forChildren = true;
      description = "Appends one JSONL line per provider request (tokens, cost, quota headers, retries) to <agentDir>/meter/YYYY-MM.jsonl; no prompt or response text.";
    };

    # (M3.4)
    home.packages = [cfg.package.report cfg.package.analyse];
    home.file."${pe.agentDir}/LOGS.md".source = "${cfg.package}/LOGS.md";

    # (M3.5) Literal text (spec §4): checks read it with builtins.fromJSON.
    home.file."${pe.agentDir}/token-meter/settings.json" =
      lib.mkIf (cfg.settings != {}) {text = builtins.toJSON cfg.settings;};
  };
}
```

M3.3's state: without `settings`, `home.packages` and both `home.file` lines.

### S5 — `checks/module-eval/cases/token-meter.nix` (state after M3.6)

```nix
# Cases for modules/token-meter.nix (spec §4, §4.1, §5.1).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; tm: tokenMeter options, null = not enabled.
  eval = dir: tm:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (tm != null) {tokenMeter = {enable = true;} // tm;};
    };
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  packages = cfg: map toString cfg.home.packages;
  bare = hm.evalBare {};
in {
  # (M3.3) Off by default: no registry entry, no file, no package.
  token-meter-off = let
    c = eval ".pi/agent" null;
  in
    holds "no registry entry" (!(pe c).extensions ? token-meter)
    ++ eq "home.file targets" (targets c) (targets bare)
    ++ eq "home.packages" (packages c) (packages bare);

  # (M3.3) On: the registry entry, loaded into children, its link following
  # agentDir; the existence probe reads the source, so evaluation builds nothing.
  token-meter-defaults = lib.concatMap (dir: let
    c = eval dir {};
    t = (pe c).tokenMeter;
    e = (pe c).extensions.token-meter;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${t.package}";
      input = null;
      forChildren = true;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/token-meter/index.ts" (toString e.checkPath))
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ holds "link target (${dir})" (lib.elem "${dir}/extensions/token-meter" (targets c))
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M3.3) The package is the flake's, under the name the host's
  # checks/pi-extensions.nix:141 matches in the link target.
  token-meter-package = let
    t = (pe (eval ".pi/agent" {})).tokenMeter;
  in
    eq "drvPath" t.package.drvPath self.packages.x86_64-linux.token-meter.drvPath
    ++ eq "name" t.package.name "pi-token-meter-0.1.0";

  # (M3.4) Files and commands: the link and LOGS.md under agentDir, the two
  # reports on PATH, no settings file while settings = {}.
  token-meter-files = lib.concatMap (dir: let
    c = eval dir {};
    t = (pe c).tokenMeter;
    logs = fileAt "${dir}/LOGS.md" c;
  in
    eq "home.file targets (${dir})" (lib.sort lib.lessThan (targets c))
    (lib.sort lib.lessThan (targets bare ++ ["${dir}/extensions/token-meter" "${dir}/LOGS.md"]))
    ++ eq "LOGS.md source (${dir})" (
      if logs == null
      then null
      else toString logs.source
    ) "${t.package}/LOGS.md"
    ++ eq "home.packages (${dir})" (lib.subtractLists (packages bare) (packages c)) (map toString [t.package.report t.package.analyse])
    ++ eq "commands (${dir})" (map (p: p.meta.mainProgram) [t.package.report t.package.analyse]) ["meter-report" "pi-analyse"])
  dirs;

  # (M3.5) settings: written as given, under agentDir, only when non-empty.
  token-meter-settings = lib.concatMap (dir: let
    s = {
      dir = "m";
      rawRatelimit = false;
    };
    f = fileAt "${dir}/token-meter/settings.json" (eval dir {settings = s;});
  in
    eq "settings file (${dir})" (
      if f == null
      then null
      else builtins.fromJSON f.text
    )
    s)
  dirs;

  # (M3.6) With actorSubagents, children load the meter: today's
  # actor-subagents/settings.json (host pi-extensions.nix:389-390) names it.
  token-meter-children = let
    c = hm.eval {
      programs.piEconomics = {
        tokenMeter.enable = true;
        actorSubagents.enable = true;
      };
    };
  in
    eq "childExtensions" (pe c).childExtensions ["/home/u/.pi/agent/extensions/token-meter"]
    ++ eq "actor-subagents/settings.json" (fileAt ".pi/agent/actor-subagents/settings.json" c).text
    ''{"childExtensions":["/home/u/.pi/agent/extensions/token-meter"]}'';
}
```

### S6 — `modules/analysis-skill.nix` (state after M3.8)

```nix
# The agent skill pi-token-economics-analysis (spec §2, §4.1): instructions
# that drive pi-analyse and read LOGS.md. The component writes no file; it
# exports `path`, a skill directory the consumer links into its skills
# directories. Its text names the agent dir, substituted from agentDir.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.analysisSkill;
  source = builtins.readFile ../skills/pi-token-economics-analysis/SKILL.md;
in {
  options.programs.piEconomics.analysisSkill = {
    enable = lib.mkEnableOption "the agent skill pi-token-economics-analysis (requires tokenMeter)";

    # (M3.7)
    text = lib.mkOption {
      type = lib.types.str;
      readOnly = true;
      internal = true;
      description = "SKILL.md as rendered: every `~/.pi/agent` replaced by `~/<agentDir>` (read by the checks).";
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.writeTextFile {
        name = "pi-token-economics-analysis";
        destination = "/SKILL.md";
        inherit (cfg) text;
      };
      defaultText = lib.literalExpression ''pkgs.writeTextFile { name = "pi-token-economics-analysis"; destination = "/SKILL.md"; text = <SKILL.md for agentDir>; }'';
      description = "The skill directory (SKILL.md at its root).";
    };

    path = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      readOnly = true;
      description = ''
        The skill directory to link as `<skills dir>/pi-token-economics-analysis`
        (the frontmatter `name`), or `null` while the component is disabled.
      '';
    };
  };

  config = {
    programs.piEconomics.analysisSkill = {
      text = builtins.replaceStrings ["~/.pi/agent"] ["~/${pe.agentDir}"] source;
      path =
        if cfg.enable
        then "${cfg.package}"
        else null;
    };

    # (M3.8) A hard dependency (spec §4.1).
    assertions = lib.mkIf cfg.enable [
      {
        assertion = pe.tokenMeter.enable;
        message = "pi-economics: analysisSkill requires tokenMeter (the skill runs pi-analyse and reads LOGS.md, which tokenMeter installs)";
      }
    ];
  };
}
```

M3.7's state: without the `assertions` block tagged M3.8.

### S7 — `checks/module-eval/cases/analysis-skill.nix` (state after M3.9)

```nix
# Cases for modules/analysis-skill.nix (spec §4, §4.1).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  source = builtins.readFile (self + "/skills/pi-token-economics-analysis/SKILL.md");
  # dir: agentDir; meter: whether tokenMeter is enabled too.
  eval = dir: meter:
    hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        analysisSkill.enable = true;
        tokenMeter.enable = meter;
      };
    };
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  bare = hm.evalBare {};
  message = "pi-economics: analysisSkill requires tokenMeter (the skill runs pi-analyse and reads LOGS.md, which tokenMeter installs)";
in {
  # (M3.7) Off by default: no path, nothing rendered.
  analysis-skill-off = let
    c = hm.eval {};
  in
    eq "path" (pe c).analysisSkill.path null
    ++ eq "home.file targets" (targets c) (targets bare);

  # (M3.7) The text names the agent dir: every ~/.pi/agent becomes
  # ~/<agentDir>, and nothing else changes.
  analysis-skill-text = lib.concatMap (dir: let
    a = (pe (eval dir true)).analysisSkill;
  in
    holds "names ~/${dir}/LOGS.md" (lib.hasInfix "~/${dir}/LOGS.md" a.text)
    ++ holds "no other agent dir (${dir})" (dir == ".pi/agent" || !lib.hasInfix ".pi/agent" a.text)
    ++ eq "the rest unchanged (${dir})" (builtins.replaceStrings ["~/${dir}"] ["~/.pi/agent"] a.text) source
    ++ holds "frontmatter name (${dir})" (lib.elem "name: pi-token-economics-analysis" (lib.splitString "\n" a.text))
    ++ eq "path (${dir})" a.path "${a.package}"
    ++ eq "no file of its own (${dir})" (lib.sort lib.lessThan (targets (eval dir true)))
    (lib.sort lib.lessThan (targets (hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        tokenMeter.enable = true;
      };
    }))))
  dirs;

  # (M3.7) With the default agentDir the text is the source, byte for byte.
  analysis-skill-today = eq "text" (pe (eval ".pi/agent" true)).analysisSkill.text source;

  # (M3.8) The hard dependency (spec §4.1).
  analysis-skill-requires-meter =
    eq "without tokenMeter" (failed "pi-economics:" (eval ".pi/agent" false)) [message]
    ++ eq "with tokenMeter" (failed "" (eval ".pi/agent" true)) [];

  # (M3.9) The skill names what tokenMeter installs: the analysis command and
  # <agentDir>/LOGS.md (host checks/pi-log-contract, part 2).
  analysis-skill-contract = lib.concatMap (dir: let
    c = eval dir true;
    command = (pe c).tokenMeter.package.analyse.meta.mainProgram;
    text = (pe c).analysisSkill.text;
  in
    holds "${command} on PATH (${dir})" (lib.elem command (map lib.getName c.home.packages))
    ++ holds "the skill runs ${command} (${dir})" (lib.hasInfix "${command} " text)
    ++ holds "${dir}/LOGS.md installed (${dir})" (c.home.file ? "${dir}/LOGS.md")
    ++ holds "the skill reads ~/${dir}/LOGS.md (${dir})" (lib.hasInfix "~/${dir}/LOGS.md" text))
  dirs;
}
```

(`self + "/skills/…"` is the flake's copy: the same file the module reads.)

### S8 — `checks/home-files/default.nix`

```nix
# What the components render resolves to what pi and the harnesses read
# (spec §4, §4.1). module-eval only evaluates; this check builds the rendered
# sources, for the default and another agentDir.
{
  lib,
  pkgs,
  hm,
}: let
  dirs = [".pi/agent" "custom/agent"];
  case = dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        tokenMeter.enable = true;
        analysisSkill.enable = true;
      };
    };
    pe = c.programs.piEconomics;
    skill = pe.analysisSkill.path;
    t = pe.tokenMeter.package;
  in ''
    echo "== ${dir}"
    # tokenMeter: the extension pi loads, LOGS.md, the two commands.
    for f in package.json index.ts; do
      [ -f ${pe.extensions.token-meter.path}/$f ] || { echo "FAIL ${dir}: extension lacks $f" >&2; exit 1; }
    done
    cmp ${c.home.file."${dir}/LOGS.md".source} ${../../packages/token-meter/LOGS.md} || { echo "FAIL ${dir}: LOGS.md is not the package's" >&2; exit 1; }
    mkdir -p "$TMPDIR/agent"
    ${lib.getExe t.analyse} --check --agent-dir "$TMPDIR/agent" >"$TMPDIR/check.out" && grep -qF "contract ok" "$TMPDIR/check.out" || { echo "FAIL ${dir}: pi-analyse --check" >&2; cat "$TMPDIR/check.out" >&2; exit 1; }
    ${lib.getExe t.report} --dir "$TMPDIR/agent/meter" >/dev/null || { echo "FAIL ${dir}: meter-report" >&2; exit 1; }
    # analysisSkill: a directory holding SKILL.md only, naming the agent dir.
    [ "$(ls -A ${skill})" = SKILL.md ] || { echo "FAIL ${dir}: the skill directory holds: $(ls -A ${skill})" >&2; exit 1; }
    ${
      if dir == ".pi/agent"
      then ''cmp ${skill}/SKILL.md ${../../skills/pi-token-economics-analysis/SKILL.md} || { echo "FAIL ${dir}: SKILL.md is not the source" >&2; exit 1; }''
      else ''
        grep -qF '~/${dir}/LOGS.md' ${skill}/SKILL.md || { echo "FAIL ${dir}: SKILL.md does not name ~/${dir}/LOGS.md" >&2; exit 1; }
        if grep -qF '.pi/agent' ${skill}/SKILL.md; then echo "FAIL ${dir}: SKILL.md still names .pi/agent" >&2; exit 1; fi
      ''
    }
    echo "ok ${dir}"
  '';
in
  pkgs.runCommand "home-files" {nativeBuildInputs = [pkgs.gnugrep pkgs.diffutils];} ''
    set -euo pipefail
    ${lib.concatMapStrings case dirs}
    touch $out
  ''
```

### S9 — `modules/default.nix`, `checks/module-eval/default.nix`, `cases/together.nix`

```diff
   imports = [
     ./common.nix
     ./bench.nix
     ./actor-subagents.nix
+    ./token-meter.nix
+    ./analysis-skill.nix
   ];
```

(M3.3 the first line, M3.7 the second.)

```diff
   caseFiles = [
     ./cases/common.nix
     ./cases/bench.nix
     ./cases/actor-subagents.nix
+    ./cases/token-meter.nix
+    ./cases/analysis-skill.nix
     ./cases/together.nix
   ];
```

(M3.3, M3.7.)

```diff
-  components = ["bench" "actorSubagents"];
+  components = ["bench" "actorSubagents" "tokenMeter" "analysisSkill"];
```

(M3.11.)

### S10 — Citations (§2), `packages/token-meter/`

Each pair is one line; nothing else in the files changes.

```diff
+++ b/packages/token-meter/bin/pi-analyse.ts
-// On-demand analysis of pi's own logs (spec §5.7; fields in <agentDir>/LOGS.md). Writes <out>/<YYYY-MM-DD>-<HHMM>-analysis.md
+// On-demand analysis of pi's own logs (fields in <agentDir>/LOGS.md). Writes <out>/<YYYY-MM-DD>-<HHMM>-analysis.md
+++ b/packages/token-meter/core/analyse.ts
-// On-demand analysis of pi's own logs (spec §5.7): cost, experiment, delegation & routing, guards, data quality.
+// On-demand analysis of pi's own logs: cost, experiment, delegation & routing, guards, data quality.
+++ b/packages/token-meter/core/arms.ts
-// Per-arm analysis of the meter log for the experiments package (spec §5.6.2, §5.6.3). Pure; bin/meter-report.ts does the I/O.
+// Per-arm analysis of the meter log for the experiments package. Pure; bin/meter-report.ts does the I/O.
+++ b/packages/token-meter/core/contract.ts
-// The data contract of pi's logs (spec §5.7, <agentDir>/LOGS.md): the fields pi-analyse needs, per log, event and
+// The data contract of pi's logs (<agentDir>/LOGS.md): the fields pi-analyse needs, per log, event and
+++ b/packages/token-meter/core/guards.ts
-// Guard and kill switch of the experiments package (spec §5.6.3). Pure; reads the task-router outcome log as plain events.
+// Guard and kill switch of the experiments package. Pure; reads the task-router outcome log as plain events.
+++ b/packages/token-meter/core/ledger.ts
-// Fold ledger of pi-analyse (plan T13.11): what each detected fold earned or cost in cache dollars. Pure.
+// Fold ledger of pi-analyse: what each detected fold earned or cost in cache dollars. Pure.
+++ b/packages/token-meter/core/tasks.ts
-// $ per accepted task (spec §5.6.3, routing metric). Pure; reads the meter log and the task-router outcome log as plain events.
+// $ per accepted task (routing metric). Pure; reads the meter log and the task-router outcome log as plain events.
+++ b/packages/token-meter/test/analyse.test.ts
-// ---- design v3 (T8.10) and the fold ledger (T13.11) ----------------------------------------------
+// ---- design v3 and the fold ledger ----------------------------------------------------------------
+++ b/packages/token-meter/test/arms.test.ts
-// T8.6: per-arm analysis of the meter log: $ per active hour with bootstrap CI, per-event costs
+// Per-arm analysis of the meter log: $ per active hour with bootstrap CI, per-event costs
-// --- quota attribution (T13.8): the quota is account-wide, so one global timeline is split between the roots that were active ---
+// --- quota attribution: the quota is account-wide, so one global timeline is split between the roots that were active ---
+++ b/packages/token-meter/test/contract.test.ts
-// T13.9: optional outcome fields of the randomized-routing / spot-check experiment: never required, typed when present.
+// Optional outcome fields of the randomized-routing / spot-check experiment: never required, typed when present.
+++ b/packages/token-meter/test/delegation.test.ts
-// T13.9: pi-analyse's delegation section per profile (card kind) × tier, the randomized comparison among spawns the router
+// pi-analyse's delegation section per profile (card kind) × tier, the randomized comparison among spawns the router
+++ b/packages/token-meter/test/guards.test.ts
-// T8.6: guard (verdict acceptance per arm, from the router's outcome log) and the kill switch (spec §5.6.3).
+// Guard (verdict acceptance per arm, from the router's outcome log) and the kill switch.
-// --- T8.7: guards from <agentDir>/guards/events.jsonl (peek-after-mask, correction, rating) ---
+// --- guards from <agentDir>/guards/events.jsonl (peek-after-mask, correction, rating) ---
+++ b/packages/token-meter/test/ledger.test.ts
-// T13.11: fold ledger — net = n·R·r − K·(w − r) per fold, from synthetic request sequences.
+// Fold ledger — net = n·R·r − K·(w − r) per fold, from synthetic request sequences.
+++ b/packages/token-meter/test/portable.test.ts
-// Portability contract (spec §6, plan S4): the package can be copied into its
+// Portability contract: the package can be copied into its
+++ b/packages/token-meter/test/shell.test.ts
-// T8.5: every line carries the experiment arm id, read from the process-global experiments API.
+// Every line carries the experiment arm id, read from the process-global experiments API.
+++ b/packages/token-meter/test/tasks.test.ts
-// T8.7: $ per accepted task = the cost of the subtrees of the arm's judged tasks ÷ its accepted tasks
+// $ per accepted task = the cost of the subtrees of the arm's judged tasks ÷ its accepted tasks
```

Unchanged on purpose (D10): the test names `"T8.7: …"` (`test/arms.test.ts:135,148,165`) and `"… (T13.8)"` (`test/analyse.test.ts:107`), `LOGS.md` (`T5.20`–`T5.22`, `T8.10`), the report label at `core/analyse.ts:557`.

### S11 — `docs/pi-economics.md`

Under `## Components`, after the `actorSubagents` section:

```markdown
### `tokenMeter` (`modules/token-meter.nix`)

The token meter (`packages/token-meter`): one JSON line per provider request
(tokens, cost, quota headers, retries; no prompt or response text) in
`<agentDir>/meter/YYYY-MM.jsonl`, in main sessions and children, and the
reports over every log pi writes about itself.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | registry entry `token-meter` (`forChildren = true`); `meter-report` and `pi-analyse` on `PATH`; `<agentDir>/LOGS.md`, the manual of every log `pi-analyse` reads |
| `package` | the flake's `packages/token-meter` | the extension; `passthru.report` and `passthru.analyse` are the two commands |
| `settings` | `{}` | written to `<agentDir>/token-meter/settings.json` when non-empty (`enabled`, `dir`, `rawRatelimit`; each has a default in the package) |

Without `actorSubagents` there are no children to meter and no
`parentSessionId`; without `experiments` the lines carry no arm; without
`taskRouter` and `experiments` the reports lack their tier and arm sections.
None of these warns.

### `analysisSkill` (`modules/analysis-skill.nix`)

The agent skill `pi-token-economics-analysis`
(`skills/pi-token-economics-analysis`): it runs `pi-analyse`, reads
`LOGS.md` and proposes decisions. It writes no file.

| Option | Default | Effect |
|---|---|---|
| `enable` | `false` | requires `tokenMeter` (an assertion) |
| `package` | the skill directory, `SKILL.md` at its root | every `~/.pi/agent` in the text replaced by `~/<agentDir>`; with the default `agentDir` the text is the source |
| `path` (read-only) | `null` while disabled | the directory to link as `<skills dir>/pi-token-economics-analysis` (the frontmatter `name`) |
```

Rows for the checks table:

```markdown
| `token-meter` | the token meter's own tests (`node --test`), run when it builds |
| `typecheck-token-meter` | `tsc --strict` over the token meter |
| `home-files` | the rendered sources exist and are what pi and the harnesses read: the extension, `LOGS.md`, both commands on an empty agent dir, the skill directory |
```

The `module-eval` row gains "the skill text, the skill↔meter contract".

---

## Open questions

Each with the planner's proposed decision; the plan follows the proposal.

- **Q1 (D8).** §4.1 says the skill's text names `<agentDir>/LOGS.md`; the skill names `~/.pi/agent` in four places. Proposal: substitute all four, so that the text names one agent dir; with the default `agentDir` it stays the host's text.
- **Q2 (D9).** `analysisSkill.path` is `null` while the component is disabled, `"${package}"` otherwise; `package` exists because §4 gives every component one. Proposal: accept; W2 wires `lib.optionalAttrs (path != null)`.
- **Q3 (D11).** Part 2 of the host's `pi-log-contract` (skill ↔ installed command and `LOGS.md`) becomes the case `analysis-skill-contract` now; part 1 stays M5's. Proposal: accept.
- **Q4 (D10).** §2's re-pointing touches code comments only. Test names with task ids, `LOGS.md`'s task ids, the report label `SC3` (`core/analyse.ts:557`, report output) and the skill's `SC3` stay until P, so the installed files and the reports stay the host's. Proposal: accept; P scrubs them with the router's defaults.
- **Q5 (D1).** `package.nix` moves to the package root with its two paths adjusted; `nix/hm-module.nix` is not copied. Proposal: accept.
- **Q6 (D4).** The registry entry's `input` is `null` (the source is the flake's own). Proposal: accept.
- **Q7 (D12).** A new build check `home-files`, which later milestones may extend with their rendered sources. Proposal: accept.
- **Q8 (D13).** No flake output for the skill. Proposal: accept.
- **Q9 (D5).** `tokenMeter.settings` is a JSON object (the host's type took any JSON value). Proposal: accept.
- **Q10.** M3 needs M2 landed (M3.0 Step 2): `cases/together.nix`, `childExtensions`, `homeModules.default` as an attrset. Proposal: M3 starts after M2's Execution Record; if M2 deviates in `checks/default.nix`, `flake.nix`, `caseFiles` or `together.nix`, the implementer adapts S1/S9 to M2's actual text, and N is M2's final case count.

# Execution Record

Executed 2026-10-18/25 (agent impl-m3b), on the plan at `d79e261` and M2 as landed (`a620f78`). Q1–Q10 accepted as proposed. Every task done; builds under `ulimit -v 20971520`, `--option eval-cache false`, timeouts 1800 s; the host read only through `git dot`. M3.0: M2's record read (Q1 changed there: `childExtensions` in `settings` is an assertion error, which M3 does not touch); the M2 landing checks pass (check listing, `grep -c` = 1, `homeModules.default` an attrset); M2's final count was 32 cases, so N = 32. Drift at M3.0: none against the host's `f6a3c81`.

| Task | Commit | Red seen | Deviation |
|---|---|---|---|
| M3.0 | — | — | none |
| M3.1 | `c505840` | the check/package missing; planted `dir: "m3"` in `test/settings.test.ts` → `ℹ fail` and `builder failed` | none; copy tree-identical but `nix/` and `package.nix`, built outputs of the host's and the flake's `package.nix` `diff -r` equal; `ℹ pass 154` |
| M3.2 | `136ed1d` | `typecheck-token-meter` red on `core/analyse.ts:191` | D3's one-line annotation (S3), tests still `pass 154` |
| M3.3 | `41c95d7` | option missing; plants `forChildren = false` and no `checkPath` → `FAIL token-meter-defaults`, IFD red | none; 35 cases |
| M3.4 | `c19a534` | three `FAIL token-meter-files` per agentDir; plant (link `.pi/agent/LOGS.md` fixed) → only the `custom/agent` case fails | none; 36 cases |
| M3.5 | `302be8a` | `option … tokenMeter.settings does not exist`; plant `mkIf true` → `FAIL token-meter-files: home.file targets` ×2 | none; 37 cases |
| M3.6 | `2d42070` | green first; plant `forChildren = false` → `FAIL token-meter-children` ×2 and `token-meter-defaults` ×2 | 38 cases |
| M3.7 | `c862631` | `attribute 'analysisSkill' missing`; plants (a) path always set, (b) only `LOGS.md` substituted → `FAIL analysis-skill-off: path`, `FAIL analysis-skill-text: no other agent dir (custom/agent)` | none; 41 cases; SKILL.md byte-equal to the host's |
| M3.8 | `d74037b` | `FAIL analysis-skill-requires-meter: without tokenMeter: expected [ "pi-economics: analysisSkill requires …" ], got [ ]`; plant `assertion = true` → the same | the test commit missed the module edit (the edit tool failed); amended into one commit; 42 → 43 cases |
| M3.9 | `089089f` | plants (skill says `pi-analyze`; fixed `.pi/agent/LOGS.md` link) → 5 `FAIL analysis-skill-contract` lines | green first (characterisation); 43 cases |
| M3.10 | `587db93` | plants (skill dir `x/SKILL.md`; LOGS.md source `package.json`) → `FAIL .pi/agent: the skill directory holds: x`, `FAIL .pi/agent: LOGS.md is not the package's` | `home-files` green first (new check; the plants are its reds) |
| M3.11 | `6205d57` | plant `home.file.planted` → `FAIL components-together: home.file targets`, 1 failure in 43 | none; 43 cases |
| M3.12 | `81d4c02` | the grep counted 18 lines → rc=1 after | 16 files, 18 comment lines (plan said 17 pairs; `test/delegation.test.ts` had a second `T13.9` line); 0 non-comment lines changed; `pass 154` |
| M3.13 | `0b6cab3` | — | none; no `MISSING`, `leak` green |
| M3.14 | this record's commit | — | see below |

## Deviations

1. M3.8: one commit instead of test + module (see the table).
2. M3.12: 18 lines in 16 files, not 17 in 15 (one extra citation in `test/delegation.test.ts:1`).
3. `/tmp` is private to the sandbox's commands: a backup in `/tmp` could not be read back, so planted edits were undone with `git checkout --` on staged files.
4. The host moved while M3 ran: the owner committed his inputs/patches update as `4c714f0` (pi 1.2.0). **A pi 1.2.0 resync is pending** (a separate task). M3's sources stay on `f6a3c81`. Drift against `4c714f0` over the M3.0 paths: only `checks/pi-extensions.nix` (a comment about the patched pi-infinite-context, two lines), nothing in token-meter, the skill, `pi-log-contract`, `pi-bench`, `pi-extensions.nix` or `pi-settings-migrate`.

## Gate (M3.14), 2026-10-25

Each check's output deleted before its build (when not in use), one capped build each (`~/.cache/pi/m2gate.sh`), GNU `time`. Listing, same under both refs: `actor-subagents bench home-files iface-harness iface-subagents-bench-probe leak leak-selftest module-eval npm-deps pi-settings-migrate token-meter typecheck-actor-subagents typecheck-bench typecheck-harness typecheck-token-meter`. No `FAILED`, no `LISTING FAILED`.

| Check | `git+file://` peak · time | `path:` peak · time |
|---|---|---|
| `actor-subagents` | 138268 KiB · 3.83 s | 138572 KiB · 2.07 s |
| `bench` | 154864 KiB · 6.56 s | 155264 KiB · 4.24 s |
| `home-files` | 427156 KiB · 2.85 s | 427620 KiB · 2.97 s |
| `iface-harness` | 245156 KiB · 6.46 s | 245288 KiB · 3.34 s |
| `iface-subagents-bench-probe` | 245716 KiB · 13.20 s | 244884 KiB · 7.86 s |
| `leak` | 240004 KiB · 1.65 s | 240432 KiB · 3.86 s |
| `leak-selftest` | 239672 KiB · 3.61 s | 239536 KiB · 1.73 s |
| `module-eval` (43 cases) | 1421968 KiB · 34.99 s | 1535436 KiB · 33.97 s |
| `npm-deps` | 157344 KiB · 3.39 s | 156964 KiB · 1.02 s |
| `pi-settings-migrate` | 561548 KiB · 11.70 s | 560376 KiB · 7.71 s |
| `token-meter` (154 tests) | 138060 KiB · 0.68 s | 138564 KiB · 0.80 s |
| `typecheck-actor-subagents` | 245324 KiB · 8.55 s | 245020 KiB · 8.28 s |
| `typecheck-bench` | 245584 KiB · 5.08 s | 245320 KiB · 3.19 s |
| `typecheck-harness` | 245212 KiB · 8.39 s | 246168 KiB · 8.35 s |
| `typecheck-token-meter` | 245612 KiB · 4.78 s | 245176 KiB · 4.66 s |

The `token-meter` times are short because `home-files` references its output, so the gate's delete step cannot remove it and the build is a no-op; a separate `nix build --rebuild` of `checks.x86_64-linux.token-meter` ran the suite: `ℹ pass 154`, `ℹ fail 0`. `packages.x86_64-linux` is `["actor-subagents","bench","token-meter"]`; `homeModules` is `["default"]`; `formatter.x86_64-linux.drvPath` evaluates; `alejandra --check` over every tracked `.nix` file is clean. `git diff a620f78 -- flake.lock` is empty. The gate ran while HEAD moved from `0b6cab3` by another agent's docs-only commit (`efcb918`, m6 plan).

Open questions: Q1–Q10 accepted. Follow-ups, not done: the pi 1.2.0 resync (deviation 4); W2 wires `analysisSkill.path` with `lib.optionalAttrs (path != null)`.
