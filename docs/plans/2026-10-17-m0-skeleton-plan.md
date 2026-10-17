# M0 — Flake skeleton, `common.nix`, shared harnesses: TDD plan

Date: 2026-10-17 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` r5 (commit `a0e25aa`) · Milestone: M0 (§9)

Source commit: host dotfiles `f6a3c81`. The paths M0 ports are unchanged at host `6563f33` (2026-10-17, checked while planning; Task M0.0 checks again).

## Motivation

§9 row M0: the flake skeleton, `modules/common.nix` (`agentDir`, the extension registry, `piSettings` with `enable`, contributor-keyed ops and the ported fixtures), the shared npm lock, the type-check harness, the module-evaluation harness and the leak check. Every later milestone builds on these: M1–M6 add component modules that register extensions (§5.1) and contribute piSettings ops (§5.4), type-check their packages (§8.1) and add module-evaluation cases. The move is pure (§1): for today's op set, the new piSettings script must give byte for byte what the host's `pi-settings-migrate` gives.

## Approach

- `flake.nix` with two inputs, `nixpkgs` and `home-manager` (checks only), locked to the host's revisions; outputs `homeModules.default = ./modules`, `formatter`, `checks.x86_64-linux = import ./checks …`.
- `modules/common.nix` declares `programs.piEconomics.{agentDir, extensions, piSettings}`:
  - the registry renders `home.file."<agentDir>/extensions/<name>".source = path` and one assertion `builtins.pathExists checkPath` per entry;
  - piSettings flattens `ops.<contributor>` into a list sorted by `(order, key, index)`, renders it as one jq program (one `def opN:` per op, each with the host's shape guard generalised to any path), wraps it in the host's script (`pi-settings-migrate <file>`) and adds the activation entry `piSettingsMigrate` when `enable` and at least one op exists. Three read-only internal options (`sortedOps`, `program`, `package`) expose the rendering to the checks without import-from-derivation.
- Checks (each one `nix build`):
  - `module-eval`: Home Manager evaluations of case modules; each case returns a list of failure strings; the derivation fails and lists every failing case.
  - `pi-settings-migrate`: the scripts rendered from case modules, against (1) the host's fixture cases, (2) the legacy script as a byte oracle over a corpus, (3) the op table of §5.4.
  - `npm-deps`: the moved lock's `node_modules`; installed versions equal the declared ones.
  - `typecheck-harness`: the `tsc` runner against fixtures it must accept and reject.
  - `leak-selftest`, `leak`: the generic leak scanner against generated hits and near misses, then against the repository (without `docs/specs/`, `docs/plans/`).

## Decisions

| # | Decision | Rationale | Rejected alternative, and why |
|---|---|---|---|
| D1 | `flake.nix` keeps the host's URLs (`github:nixos/nixpkgs/nixos-unstable`, `github:nix-community/home-manager`); the lock is created with `nix flake lock --override-input` at the host's revisions | Lock nodes `{locked, original}` equal the host's, so the host's `follows` changes nothing and the flake's own checks run on the host's nixpkgs (verified while planning: the override writes the branch as `original`) | A rev in the URL: a later `nix flake update` could not move it |
| D2 | M0 has only `nixpkgs` and `home-manager`; the `flake = false` upstreams (§3) come with M2 and M6 | No lock entry without a user (main: no lock churn beyond what is needed) | All inputs now: three unused lock nodes |
| D3 | `x86_64-linux` only | The host's three machines; a public flake can add systems at P | `forAllSystems`: no consumer yet |
| D4 | Module evaluation through Home Manager's raw `evalModules` (`checks/lib/hm-eval.nix`), mirroring `modules/default.nix` `rawModule` at `8335400` | `homeManagerConfiguration` wraps `config` in `moduleChecks`, which throws on the first failed assertion, so a negative case could not read `config.assertions` or its message (verified while planning) | `homeManagerConfiguration` + `tryEval`: proves only "fails", never which message |
| D5 | Assertion cases read `config.assertions` (`failed prefix cfg`), never `tryEval` | §4.1 fixes the message; the case compares the whole set of `pi-economics:` messages, so an extra failure is caught too | `tryEval`: blind to the message |
| D6 | `piSettings` exposes `sortedOps`, `program`, `package` as read-only internal options | Checks read the rendering at eval time; the fixture check runs exactly the script the activation runs | A separate lib function: two paths to the same script |
| D7 | `false` on the way aborts the program for all three ops, `removeWhere` included | §5.4: "`false` on the way passes the guard and makes jq fail … the one shape that aborts". One prefix guard (`(<p> // {}) \| type == "object"`) for all ops | A strict prefix guard for `removeWhere` (false skips): two guard families, and a second rule for one shape |
| D8 | Op values are inlined as JSON literals in the jq program; the program is a file (`jq -f`) | JSON ⊂ jq; no `--argjson` per op, no shell quoting; the module-eval cases can read the program | `--argjson` per op: N arguments, harder to read |
| D9 | The script keeps the name `pi-settings-migrate`; the entry runs `run <exe> <escapeShellArg file>` | The host's checks look for `/bin/pi-settings-migrate` (host `eval-assertions.nix:9395,9530`); the quoting form changes at W6 with those lines (§9.1) | Today's double quotes: break on a `"` in the path |
| D10 | `agentDir` is `strMatching "[^/](.*[^/])?"` | "relative to home" (§4) made a type: `/abs`, `x/` and `""` are rejected at evaluation | Plain `str`: `/home/u//abs/extensions/…` links |
| D11 | `tsc` gets four flags beyond §8.1's three: `--skipLibCheck --module nodenext --target es2023 --types node` (TypeScript 6.0 defaults `strict` on and `types` to none, so `--strict` stays explicit and `--types node` is needed) | Measured 2026-10-17 on the lock's packages: without `--skipLibCheck`, pi 1.0.0's own `.d.ts` give 44 errors (TS1543, JSON imports without attributes; TS2307, absent `@modelcontextprotocol/sdk`); the packages are `"type": "module"`. With them the `ok` fixture passes and a `--strict` error (TS7006) and a pi type error (TS2322) are still reported. Still no declaration stub (§8.1) | Checking pi's declarations: fails on code that is not ours |
| D12 | The moved lock lives in `checks/npm/`, byte-identical to host `checks/pi-retry/package{,-lock}.json`; `pname = "pi-retry-test-deps"`, same source set | The derivation is the host's (already in the store: no fetch); M6's pi-retry suite reuses it | A new pname: a second fetch of ~600 tarballs for the same content |
| D13 | The legacy script is kept as a test oracle (`checks/pi-settings-migrate/legacy.nix`, host lines 32–97 verbatim) | "today's result" (§1) derived from today's code, not from expected literals; 29 inputs × 2 modes compared byte for byte (prototype: all equal) | Literal expected outputs: they pin what the planner believed |
| D14 | The stale package `git:github.com/fdietze/pi-claude-auth@main` stays literal in `today-ops.nix`, the ported cases and the corpus | It is a public package spelling, the host's own op (`ops.host`, §5.4), and the oracle removes exactly that string; the leak patterns do not match it | A neutral name: the byte oracle could not run. Owner to confirm (open question Q3) |
| D15 | `childExtensions` is not rendered in M0; `forChildren` is declared | §9: "M2: … `childExtensions` rendering"; the file has one writer, rendered only with `actorSubagents` (§5.1) | Rendering it now: a file without its component |
| D16 | Home-path pattern `/home/[A-Za-z_][A-Za-z0-9._-]+/` | "longer than one character" (§8.3), and the class excludes `[`, `<`, `$`, so the scanner's own source and prose like `/home/<name>/` do not match | `/home/[^/]{2,}/`: matches its own source text |
| D17 | Leak hits in the self-test are built at run time from fragments (`printf '%s@%s' someone example.org`) | The repository scan must stay green over the self-test's source | Literal hit fixtures: the repository scan fails on them |
| D18 | Fixture user `u`, home `/home/u`, `stateVersion = "26.05"` | Neutral (§8.3), one character so the leak check passes it | — |
| D19 | `AGENTS.md` and `docs/pi-economics.md` are written in M0.18 | Later milestones' agents need the commands and rules; §3 names `docs/pi-economics.md` | Leaving both to P: every milestone re-derives the commands (open question Q5) |
| D20 | A characterisation check that is green on first run (M0.10, M0.15, M0.16) is shown red by a planted violation before its commit | It guards a property already true by construction; a check never seen red proves nothing | Skipping them: the byte equality and the op table are §5.4 requirements |

## The gate

pi-economics has no principles document. The gate is §4's rules, §8's testing rules and the host rules the spec carries over (host `AGENTS.md`).

| Rule | Result |
|---|---|
| Failing check before implementation | PASS: every task has a red step; D20 for the characterisation tasks |
| No `builtins.match` on generated text | PASS: cases use `lib.hasInfix`, `lib.hasPrefix`, `lib.splitString "\n"`; `types.strMatching` checks a short option value, not generated text |
| Typed options; assertions for invariants | PASS: enum, `nonEmptyListOf`, JSON type, `strMatching`; existence assertion |
| Option names camelCase, directory names kebab-case (§4) | PASS: `agentDir`, `piSettings`, `checkPath`, `forChildren`; link directories are the registry keys |
| Settings files are literal text (§4) | N/A: M0 writes no settings file (the first is `actor-subagents/settings.json`, M2) |
| Merges with `lib.recursiveUpdate` (§4) | N/A: no file has two sources in M0 |
| Assertion message `pi-economics: …`; every assertion has a negative case (§4.1) | PASS: the existence assertion, cases `registry-missing` (with and without `input`) |
| No import-from-derivation (§4, §5.1) | PASS: `checkPath` probes source paths; checks read option values; `report` discards string context |
| Scripts strict and dependency-explicit | PASS: `writeShellApplication` (shellcheck at build) for the three scripts |
| jq for JSON; no jq `include` across files | PASS: one generated program file |
| Alejandra on every changed `.nix` file | PASS: every task's CLEAN step |
| Markdown only under `docs/`, plus `README.md`/`AGENTS.md` | PASS |
| `flake.lock` changes only as needed | PASS: two inputs, at the host's revisions (D1, D2) |
| Leak patterns (§8.3) | PASS: `leak` from M0.3 on, so every later task is scanned |
| The host repository is not touched | PASS: only `git dot show`/`git dot diff` and reads |
| Never `nix flake check` without a memory cap | PASS: one capped `nix build` per check (Environment) |
| Pure move (§1) | PASS: `pi-settings-migrate` part 2 compares bytes with the legacy script |
| Plan ends with `# Execution Record` | PASS |

No VIOLATION, so no complexity-tracking rows. D4 (Home Manager internals) and D11 (extra `tsc` flags) deviate from the spec's wording, not from a rule; both are open questions for the owner (Q1, Q2).

## Files to read first

The implementer reads these before Task M0.1; the tasks quote only what they change.

- The spec: §1 (pure move), §3, §4 with §4.1, §5.1, §5.4 (all of it), §8.1, §8.3, §9 (row M0, "Drift").
- Host files at `f6a3c81` (read with `git dot show f6a3c81:projects/nixos/new/<path>`):
  - `modules/home-manager/features/ai/pi-settings-migrate.nix` (the script; the oracle of D13);
  - `checks/pi-settings-migrate/default.nix` (the fixture cases ported in M0.14);
  - `checks/pi-retry/default.nix`, `package.json`, `package-lock.json` (the lock, D12);
  - `modules/home-manager/features/ai/pi-extensions.nix` lines 60–79 (`checkPath`, `input`), 337–366 (assertions), 405–420 (links);
  - `modules/home-manager/features/ai/default.nix` lines 1095–1114 (how the entry is wired today);
  - `checks/eval-assertions.nix` lines 9385–9410 and 9520–9538 at host HEAD (what the host reads of the entry; W6 changes them).
- Home Manager at `833540099ef4` (after M0.1: `hm=$(nix flake archive --json --dry-run "$F" | jq -r '.inputs["home-manager"].path')`): `$hm/modules/default.nix` (`rawModule`, `moduleChecks`), `$hm/modules/lib/file-type.nix` (`source`), `$hm/modules/files.nix` lines 130–155 (the conflicting-target assertion).
- This plan's Snippets section.

## Type checking strategy

| Checker | When | Rejects |
|---|---|---|
| Nix module system (`check = true` in `hm-eval.nix`) | every `module-eval` and `pi-settings-migrate` build | unknown options; `agentDir` absolute, empty or with a trailing slash; an `op` outside the enum; an empty `path`; a non-JSON `value`; a registry entry without `forChildren` or `description` |
| shellcheck (`writeShellApplication`) | build of each script | the usual shell faults in `pi-settings-migrate`, `pi-economics-tsc`, `pi-economics-leak-scan` |
| `tsc` via `pi-economics-tsc` | `typecheck-harness` (M0); each package's `typecheck-<c>` from M1 | implicit `any` (TS7006, i.e. `--strict` is on), a wrong use of pi's types (TS2322, i.e. pi's declarations are loaded), a directory without `.ts` files (exit 2) |
| jq's parser | every run in `pi-settings-migrate` | a malformed rendered program; part 3 renders all three op kinds, so each template is parsed |

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Module evaluation (`module-eval`) | exports; the module is inert with defaults; `agentDir`; registry links, existence assertion, double links; piSettings options, order, program structure, activation entry | `home-manager` input; ~0.3 GiB and <1 s per evaluation (measured while planning) |
| Script fixtures (`pi-settings-migrate`) | the rendered program's behaviour: today's cases, byte equality with today, the §5.4 table | jq, coreutils, diffutils; the legacy script |
| Lock (`npm-deps`) | the shared lock installs and pins `typescript`, `@types/node`, pi | the npm deps derivation (in the store) |
| Harness self-tests (`typecheck-harness`, `leak-selftest`) | each harness rejects what it must and does not pass vacuously | fixtures |
| Repository scan (`leak`) | §8.3 patterns over tracked files outside `docs/specs/`, `docs/plans/` | — |
| Package tests (`node --test`) | N/A in M0: no package yet (M1 on) | — |
| Interface comparisons (§5.3) | N/A in M0: no provider or consumer yet (M2 on) | — |
| Layer B (host) | N/A until W (§8.2) | — |
| Activation on a real system | N/A: owner step at W6 (§9.1) | — |

## Scenario coverage

| Spec scenario | Check · case (task) |
|---|---|
| §3 only `homeModules.default` is exported | `module-eval` · `exports` (M0.6) |
| §3 inputs `nixpkgs`, `home-manager`; locked to the host's revisions | M0.1 Step 4 (one-off `jq` comparison with the host's lock) |
| §3 one npm lock, fixed `npmDepsHash`, pins `typescript` 6.0.3 and `@types/node` 25.9.1 | `npm-deps` (M0.4); `typecheck-harness` version line (M0.5) |
| §4 `agentDir` defaults to `.pi/agent`, relative to home | `module-eval` · `agentDir-default`, `agentDir-type` (rejects `/abs`, `x/`, `""`; accepts `.pi/agent`, `a`, `custom/agent`) (M0.7) |
| defaults render nothing (with every `settings` at its default, files equal today's; for M0: nothing) | `module-eval` · `inert` (M0.6) |
| §5.1 links `<agentDir>/extensions/<name>` → `path` | `module-eval` · `registry-links` (M0.8) |
| §5.1 existence assertion on `checkPath` (default `path`), message names `input` | `module-eval` · `registry-missing` (M0.9) |
| §5.1 Home Manager's file-conflict check rejects two definitions of one link | `module-eval` · `registry-double-link-key`, `registry-double-link-target` (M0.10) |
| §5.1 children (`childExtensions`) | not in M0 (D15); M2 |
| §5.4 `enable` default `true`; `file` default `<agentDir>/settings.json`; `after` default `[]` | `module-eval` · `pisettings-defaults` (M0.11) |
| §5.4 ops keyed by contributor; `order` default 1000; sort `(order, key, index)`; two contributors with the same order sorted by key (§8.1) | `module-eval` · `pisettings-order`, `pisettings-defaults` (M0.12) |
| §5.4 `path` a list, never empty (no whole-object `set`) | `module-eval` · `pisettings-path-empty` (M0.12) |
| §5.4 one jq program, one function per op | `module-eval` · `pisettings-program` (M0.13) |
| §5.4 ported fixtures (host `checks/pi-settings-migrate`) | `pi-settings-migrate` part 1 (M0.14) |
| §5.4 today's sequence: with `order = 1500` the bytes are today's; §1 pure move | `pi-settings-migrate` part 2 (M0.15) |
| §5.4 table: `set`, `ensureContains`, `removeWhere` × missing parents, wrong shape | `pi-settings-migrate` part 3 (M0.16) |
| §5.4 `null` on the way / at the leaf; `removeWhere` skips on null | part 3 `* null *` rows (M0.16) |
| §5.4 `false` at the leaf of `ensureContains` → `[value]` | part 3 `ensure false leaf` (M0.16) |
| §5.4 `false` on the way aborts the whole program; a shape error skips only its op | part 3 `mix *` rows (M0.16) |
| §5.4 jq fails → file untouched, activation does not fail | part 1 `odd-shapes` (invalid JSON), part 3 aborts (script exit 0 under `set -e`) |
| §5.4 rewrites only on change; absent file is a no-op | part 1 `idempotent*`, `clean`, `missing` (M0.14) |
| §5.4 entry `piSettingsMigrate` only with `enable` and ≥ 1 op; `entryAfter (["writeBoundary"] ++ after)` | `module-eval` · `pisettings-activation`, `pisettings-disabled`, `pisettings-no-ops` (M0.17) |
| §5.4 `enable = false` with ops from two components: no entry (§8.1) | `module-eval` · `pisettings-disabled` (M0.17) |
| §5.4 `file` absolute or relative to home | `module-eval` · `pisettings-file` (M0.17) |
| §5.4 today's ops per contributor (`ops.retry`, `ops.cacheLifecycle`, host) | data in `today-ops.nix` (M0.13); M4/M6 compare their components' ops with it |
| §8.1 type-check harness | `typecheck-harness` (M0.5) |
| §8.3 leak patterns; `/home/u/` passes; loopback allowed; `10.2` not matched | `leak-selftest` (M0.2) |
| §8.3 scan every tracked file except `docs/specs/`, `docs/plans/` | `leak` (M0.3) |
| §1 success criterion 1 (`nix flake check`) | M0.19 gate: every check built under a cap, plus the formatter and `homeModules` evaluated |

## Properties

- `inert`: names(home.file(module ⊕ ∅)) = names(home.file(∅)) ∧ names(home.activation(module ⊕ ∅)) = names(home.activation(∅)) ∧ failed = ∅ ∧ warnings equal.
- `registry-links`: ∀ dir ∈ {".pi/agent", "custom/agent"}: {target(f) ↦ source(f) | f ∈ home.file, target(f) under dir/extensions/} = {dir/extensions/n ↦ path(n) | n ∈ extensions}, independent of the home.file key; the key itself is pinned by `registry-double-link-key`.
- `registry-missing`: failed("pi-economics:") = the set of expected messages, built from the case's own `checkPath` and `input`.
- `pisettings-order`: map key#index sortedOps = the order `(order, key, index)` gives for the fixture; `pisettings-program`: |lines(program)| = |sortedOps| + 1, line i starts with `def op<i>: ` and contains toJSON(value_i) and the path's `["k"]…` accessor, last line = `op1 | … | opN`.
- `pisettings-activation`: data = `run ${getExe package} ${escapeShellArg (home/file)}\n`, after = ["writeBoundary"] ++ after — read from the evaluated config, so a new home or file needs no new expectation.
- part 2: ∀ f ∈ corpus, ∀ mode: bytes(legacy(f, mode)) = bytes(new(f, mode)), and the number of comparisons is 2 · |corpus|.
- `npm-deps`: ∀ d ∈ {typescript, @types/node, @earendil-works/pi-coding-agent}: version(node_modules/d) = package.json.devDependencies[d].
- `typecheck-harness`: `tsc --version` = "Version " + devDependencies.typescript.

Literals are pinned where the literal is the criterion: the assertion messages (§4.1), the leak patterns (§8.3), the op table's expected JSON (§5.4).

## Planted violations

Tick each box in its task once the red was seen.

| Check | Plant | Must fail with | Task |
|---|---|---|---|
| `leak-selftest` | scanner stub `exit 0` | `FAIL hit 'someone@example.org': exit 0, want 1` | M0.2 Step 2 |
| `leak-selftest` | home pattern `'/home/[^/]+/'` | `FAIL near misses rejected` | M0.2 Step 5 |
| `leak` | tracked `planted.txt` with an e-mail address | `pi-economics-leak-scan: e-mail address found` | M0.3 Step 3 |
| `leak` (exclusion) | same file under `docs/plans/` | must pass | M0.3 Step 4 |
| `npm-deps` | lock files absent | `path '…/checks/npm/package.json' does not exist` | M0.4 Step 2 |
| `npm-deps` | `declared` overridden with `typescript = "0.0.0"` | `FAIL typescript: installed 6.0.3, package.json declares 0.0.0` | M0.4 Step 5 |
| `typecheck-harness` | runner stub `exit 0` | `FAIL bad-strict: accepted` | M0.5 Step 2 |
| `typecheck-harness` | runner with `--strict false` | `FAIL bad-strict: accepted` | M0.5 Step 5 |
| `typecheck-harness` | runner without `--skipLibCheck` | `FAIL ok: rejected` | M0.5 Step 5 |
| `module-eval` (harness) | `exports` expects `["default" "planted"]` | `FAIL exports: homeModules: expected [ "default" "planted" ], got [ "default" ]` | M0.6 Step 2 |
| `module-eval` (harness) | `caseFiles = []` | `module-eval: no cases` | M0.6 Step 5 |
| `module-eval` (`inert`) | `home.file.planted.text = "x";` in `modules/default.nix` | `FAIL inert: home.file names: …` | M0.6 Step 5 |
| `module-eval` | `agentDir-default`, `agentDir-type` before the option | evaluation error naming `piEconomics` | M0.7 Step 2 |
| `module-eval` | `registry-links` before `extensions` | `The option `programs.piEconomics.extensions' does not exist` | M0.8 Step 2 |
| `module-eval` | `registry-missing` before the assertion | `FAIL registry-missing: failed assertions: expected [ … ], got [ ]` | M0.9 Step 2 |
| `module-eval` | link key `pi-economics-extension-<name>` with `target` | `FAIL registry-double-link-key: …: expected evaluation to fail, it succeeded` and `FAIL registry-double-link-key: the registry links under the key .pi/agent/extensions/ext-a: does not hold` | M0.10 Step 3 |
| `module-eval` | piSettings cases before the options | evaluation error naming `piSettings` | M0.11 Step 2, M0.12 Step 2 |
| `module-eval` | `pisettings-program` before `program` | evaluation error naming `program` | M0.13 Step 2 |
| `pi-settings-migrate` | the check before `package` | evaluation error naming `package` | M0.14 Step 2 |
| `pi-settings-migrate` part 2 | `today-ops.nix` `order = 1000` for `cacheLifecycle` | `FAIL corpus 01-stale-claude-auth.json (idle): bytes differ from the legacy script's` | M0.15 Step 3 |
| `pi-settings-migrate` part 3 | `removeWhere` with a strict prefix guard (`(<p> \| type) == "object"`) | `FAIL mix remove false aborts: expected the file untouched, …` | M0.16 Step 3 |
| `pi-settings-migrate` part 3 | an unguarded `set` (`if guards == [] \|\| op.op == "set"`) | `FAIL mix wrong shapes skip only their op: …` | M0.16 Step 3 |
| `module-eval` | activation cases before the entry | `FAIL pisettings-activation: entry piSettingsMigrate exists: does not hold` | M0.17 Step 2 |

Planner's dry run (2026-10-17, scratch copy outside the repository, `path:` flake): the final state of S1–S19 plus the copy commands of M0.4, M0.14 and M0.15 built all six checks green (peak ≤ 0.7 GiB, ≤ 5 s each; `module-eval` 16 cases, part 2 58 comparisons, part 3 37 rows), every `.nix` file passed `alejandra --check`, and these plants were seen red with the messages above: `exports`, `inert`, double-link key, `order = 1000`, strict `removeWhere` guard, unguarded `set`, dropped `enable`, missing entry (M0.17 RED), `--strict false`, no `--skipLibCheck`, weak home pattern, `declared` override, planted e-mail (and its exclusion under `docs/plans/`). Not simulated: the REDs of M0.1–M0.9 and M0.11–M0.14, which are "option or file missing" errors.

## Coverage gap

- **Home Manager's activation run.** The checks pin the entry's text, its DAG edges and the script's behaviour, not a real `home-manager switch` (DRY_RUN, `run`, the order among the host's seed and reclaim). The owner covers it at W6 with `nixos-rebuild test` (§9.1).
- **pi's own writers.** pi and nono rewrite `settings.json` at runtime; the corpus models their shapes, not their timing. Same W6 step.
- **The type-check harness on real packages.** M0 has none; M1 runs it on the bench first and may meet `--strict` edits (§8.1).
- **Tracked vs untracked files.** `leak` scans the flake source. Built as `git+file:` (as in this plan) that is the tracked files; built as `path:` it would include untracked files. AGENTS.md (M0.18) states the `git+file:` form.
- **The lock pin.** That `flake.lock` equals the host's nodes is a one-off comparison (M0.1 Step 4), not a check: a check cannot read the host. The host's `follows` makes it moot for the host.
- **Host readers.** The host's assertions on `/bin/pi-settings-migrate "…"` (host `eval-assertions.nix:9395,9530`) are not run here; W6 rewrites them (D9).

## Environment (every step)

```sh
export XDG_CACHE_HOME=$HOME/.cache/pi/nixcache XDG_DATA_HOME=$HOME/.cache/pi/nixdata
cd ~/projects/nix/pi-economics
F=git+file://$HOME/projects/nix/pi-economics
o=(--option eval-cache false)
cap=$((20 * 1024 * 1024))
nb() { (ulimit -v $cap && exec timeout -s KILL 900 nix build --no-link -L "$F#checks.x86_64-linux.$1" "${o[@]}"); }
ne() { (ulimit -v $cap && exec timeout -s KILL 300 nix eval "$F#$1" "${o[@]}" "${@:2}"); }
fmt() { "$( (ulimit -v $cap && exec timeout -s KILL 300 nix build "$F#formatter.x86_64-linux" --no-link --print-out-paths "${o[@]}") )/bin/alejandra" "$@"; }
host() { git dot show "f6a3c81:projects/nixos/new/$1"; }
```

- `git+file:` sees only files in the git index: `git add <new files>` before every `nb`/`ne` (modified tracked files are read from the working tree).
- Nix prints `warning: Git tree … is dirty` while a task is uncommitted; harmless, left out of the expected outputs.
- Commits are unsigned: `git -c commit.gpgsign=false commit -m …`. This repository is its own git repository: plain `git` here, `git dot` only for reading the host.
- Every `.nix` file below is Alejandra-formatted as far as the planner could; CLEAN runs `fmt <changed files>` once more.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `.gitignore` | `result`, `result-*` | M0.1 |
| `flake.nix`, `flake.lock` | inputs, `homeModules.default`, `formatter`, `checks` | M0.1 |
| `modules/default.nix` | imports every module (M0: `common.nix`) | M0.1, M0.7 |
| `modules/common.nix` | `agentDir`, registry, piSettings | M0.7–M0.17 |
| `checks/default.nix` | the set of checks | M0.1–M0.14 |
| `checks/leak/default.nix` | scanner, repository check, self-test | M0.2, M0.3 |
| `checks/npm/{package.json,package-lock.json,default.nix}` | shared lock, `nodeModules`, `npm-deps` | M0.4 |
| `checks/typecheck/default.nix`, `checks/typecheck/fixtures/{ok,bad-strict,bad-pi,no-ts}/` | runner, `typecheck {name, src}`, self-test | M0.5 |
| `checks/lib/hm-eval.nix` | raw Home Manager evaluation (`eval`, `evalBare`) | M0.6 |
| `checks/module-eval/{default.nix,expect.nix}` | harness and assertion vocabulary | M0.6 |
| `checks/module-eval/cases/common.nix` | cases for `common.nix` | M0.6–M0.17 |
| `checks/module-eval/fixtures/{ext-a,ext-b}/index.ts` | registry fixtures | M0.8 |
| `checks/pi-settings-migrate/today-ops.nix` | today's ops per contributor | M0.13 |
| `checks/pi-settings-migrate/{default.nix,ported-cases.sh}` | the fixture check, part 1 | M0.14 |
| `checks/pi-settings-migrate/{legacy.nix,differential.sh,corpus/*.json}` | part 2 | M0.15 |
| `checks/pi-settings-migrate/op-table.sh` | part 3 | M0.16 |
| `docs/pi-economics.md`, `AGENTS.md` | module contract, commands and rules | M0.18 |

Interfaces M0 publishes for M1–M6:

- options `programs.piEconomics.agentDir`, `.extensions.<name> = {path; checkPath ? path; input ? null; forChildren; description;}`, `.piSettings.{enable, file, after, ops.<contributor> = [{op; path; value; order ? 1000;}]}`, read-only `.piSettings.{sortedOps, program, package}`;
- `checks/lib/hm-eval.nix` → `hm.eval module`, `hm.evalBare module` (configs, assertions unchecked);
- `checks/module-eval/expect.nix` → `eq`, `holds`, `throws`, `failed`; a milestone adds `./cases/<component>.nix` to `caseFiles`;
- `checks/typecheck` → `typecheck {name; src;}`; `checks/npm` → `nodeModules`;
- `checks/pi-settings-migrate/today-ops.nix` → `withoutWarming`, `withWarming` (M4 compares `ops.cacheLifecycle`, M6 `ops.retry` with them).

---

## Tasks

| Task | Delivers | Commit |
|---|---|---|
| M0.0 | read; drift check | — |
| M0.1 | flake skeleton, lock at the host's revisions | `m0: flake skeleton, inputs locked to the host's revisions` |
| M0.2 | leak scanner and its self-test | `m0: leak scanner and self-test` |
| M0.3 | leak check over the repository | `m0: leak check over tracked files` |
| M0.4 | shared npm lock, `npm-deps` | `m0: shared npm lock` |
| M0.5 | type-check harness | `m0: type-check harness` |
| M0.6 | module-evaluation harness, `exports`, `inert` | `m0: module-evaluation harness` |
| M0.7 | `agentDir` | `m0(common): agentDir` |
| M0.8 | registry options and links | `m0(common): extension registry links` |
| M0.9 | registry existence assertion | `m0(common): extension existence assertion` |
| M0.10 | double links rejected (characterisation) | `m0(common): double links are rejected` |
| M0.11 | `piSettings.{enable,file,after}` | `m0(common): piSettings enable, file, after` |
| M0.12 | `piSettings.ops`, `sortedOps` | `m0(common): contributor-keyed piSettings ops` |
| M0.13 | jq program, `today-ops.nix` | `m0(common): piSettings jq program` |
| M0.14 | script, ported fixtures (part 1) | `m0(common): piSettings script and ported fixtures` |
| M0.15 | byte oracle (part 2) | `m0: piSettings bytes equal the legacy script's` |
| M0.16 | op table (part 3) | `m0: piSettings op table` |
| M0.17 | activation entry | `m0(common): piSettingsMigrate activation entry` |
| M0.18 | docs, AGENTS.md | `m0: docs and agent rules` |
| M0.19 | gate, Execution Record | `m0: execution record` |

Every task starts at status `[ ]`. Order: as numbered. Never more than one red check at a time.

### Task M0.0 — Read, and check drift

- [ ] **Step 1:** Read the list under "Files to read first".
- [ ] **Step 2 (drift, §9):**

```sh
cd ~/projects/nixos/new && git dot diff --stat f6a3c81 -- \
  modules/home-manager/features/ai/pi-settings-migrate.nix checks/pi-settings-migrate \
  checks/pi-retry/package.json checks/pi-retry/package-lock.json \
  modules/home-manager/features/ai/pi-extensions.nix; echo "rc=$?"; cd -
```

Expected: no file lines, `rc=0` (as on 2026-10-17 at host `6563f33`). A listed file is drift: stop and report; its change is ported first, with its test (§9).

### Task M0.1 — Flake skeleton

**Files:** create `.gitignore`, `flake.nix`, `flake.lock`, `modules/default.nix`, `checks/default.nix`.

- [ ] **Step 1 (RED):** `ne description --raw; echo "rc=$?"` → an error that the source has no `flake.nix`, `rc=1`.
- [ ] **Step 2:** write `.gitignore` (S1), `flake.nix` (S2), `modules/default.nix` with `{imports = [];}` (S3, first form), `checks/default.nix` (S4, first form). `git add .gitignore flake.nix modules checks`.
- [ ] **Step 3 (lock):**

```sh
(ulimit -v $cap && timeout -s KILL 600 nix flake lock "$F" \
  --override-input nixpkgs github:nixos/nixpkgs/c59305bab2065cfecc4944690d9eedbb56f3a9fa \
  --override-input home-manager github:nix-community/home-manager/833540099ef43cbeb28b1e3f3c21901961edb48e)
git add flake.lock
```

The two revisions are the host's root `nixpkgs` (node `nixpkgs_4`) and `home-manager` at `f6a3c81` and at host HEAD on 2026-10-17. If the host's lock has moved since, take its current revisions (Step 4 prints them) and record that in the Execution Record.

- [ ] **Step 4 (GREEN):**

```sh
for i in nixpkgs home-manager; do
  diff <(jq -S --arg i "$i" '.nodes[.nodes.root.inputs[$i]] | {locked, original}' ~/projects/nixos/new/flake.lock) \
       <(jq -S --arg i "$i" '.nodes[.nodes.root.inputs[$i]] | {locked, original}' flake.lock) && echo "$i: as the host"
done
jq -c '.nodes.root.inputs' flake.lock
ne description --raw; echo
ne homeModules --apply builtins.attrNames --json
ne checks.x86_64-linux --apply builtins.attrNames --json
```

Expected: `nixpkgs: as the host`, `home-manager: as the host`, `{"home-manager":"home-manager","nixpkgs":"nixpkgs"}`, the description, `["default"]`, `[]`.

- [ ] **Step 5 (CLEAN):** `fmt flake.nix modules/default.nix checks/default.nix` → no change. Commit.

### Task M0.2 — Leak scanner and self-test

**Files:** create `checks/leak/default.nix`; modify `checks/default.nix`.

- [ ] **Step 1:** write `checks/leak/default.nix` from S5, but with the scanner's `text` replaced by `exit 0` (a stub). Add to `checks/default.nix` (S4): `leakLib = import ./leak {inherit lib pkgs;};` in `let`, and `leak-selftest = leakLib.selftest;`. `git add checks/leak`.
- [ ] **Step 2 (RED):** `nb leak-selftest` → fails with `FAIL hit 'someone@example.org': exit 0, want 1`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the scanner's `text` as in S5. `nb leak-selftest` → passes; the log shows eight `ok hit …` lines, `near misses: pass`, `empty tree: exit 2`.
- [ ] **Step 4:** nothing to run: the files M0 copies from the host (`package.json`, `package-lock.json`, the legacy script, the host's fixture cases) are scanned by `leak` as soon as they are tracked (M0.4, M0.14, M0.15). The planner ran the six patterns over them on 2026-10-17: no hit.
- [ ] **Step 5 (planted):** in the scanner, replace the home pattern by `'/home/[^/]+/'`; `nb leak-selftest` → `FAIL near misses rejected`. Revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt checks/leak/default.nix checks/default.nix`; `nb leak-selftest` green. Commit.

### Task M0.3 — Leak check over the repository

**Files:** modify `checks/default.nix` (S4: `leakSrc` and `leak = leakLib.check leakSrc;`).

- [ ] **Step 1:** add `leakSrc` and the check `leak` as in S4. `nb leak` → passes (the repository has no hit; `docs/specs/` and `docs/plans/` are excluded).
- [ ] **Step 2:** `nb leak 2>&1 | grep -c 'found'` → `0`.
- [ ] **Step 3 (planted):** `printf 'contact %s@%s\n' someone example.org >planted.txt && git add planted.txt && nb leak` → fails; the log shows `…/planted.txt:1:contact someone@example.org` and `pi-economics-leak-scan: e-mail address found (lines above)`. Then `git rm -q --cached planted.txt && rm planted.txt`.
  - [ ] red seen
- [ ] **Step 4 (exclusion):** `printf 'contact %s@%s\n' someone example.org >docs/plans/planted.txt && git add docs/plans/planted.txt && nb leak` → passes. Then `git rm -q --cached docs/plans/planted.txt && rm docs/plans/planted.txt`.
- [ ] **Step 5 (CLEAN):** `fmt checks/default.nix`; `git status --short` shows only `checks/default.nix`. Commit.

### Task M0.4 — Shared npm lock

**Files:** create `checks/npm/default.nix` (S6), `checks/npm/package.json`, `checks/npm/package-lock.json`; modify `checks/default.nix`.

- [ ] **Step 1:** write `checks/npm/default.nix` (S6); in `checks/default.nix` add `npm = import ./npm {inherit lib pkgs;};` and `npm-deps = npm.check;`. `git add checks/npm/default.nix`.
- [ ] **Step 2 (RED):** `nb npm-deps` → an evaluation error naming the missing `checks/npm/package.json`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):**

```sh
host checks/pi-retry/package.json >checks/npm/package.json
host checks/pi-retry/package-lock.json >checks/npm/package-lock.json
cmp checks/npm/package.json <(host checks/pi-retry/package.json) && cmp checks/npm/package-lock.json <(host checks/pi-retry/package-lock.json) && echo identical
git add checks/npm
nb npm-deps
```

Expected: `identical`; the build prints `ok typescript 6.0.3`, `ok @types/node 25.9.1`, `ok @earendil-works/pi-coding-agent 1.0.0`. `pi-retry-test-deps-0` is normally substituted from the local store (D12); a fetch is also fine.

- [ ] **Step 4:** `nb leak` → passes (the lock files are scanned now).
- [ ] **Step 5 (planted):** in S6, `declared = (lib.importJSON ./package.json).devDependencies // {typescript = "0.0.0";};` → `nb npm-deps` fails with `FAIL typescript: installed 6.0.3, package.json declares 0.0.0`. Revert.
  - [ ] red seen
- [ ] **Step 6 (CLEAN):** `fmt checks/npm/default.nix checks/default.nix`. Commit.

### Task M0.5 — Type-check harness

**Files:** create `checks/typecheck/default.nix` (S7), the fixtures (S8); modify `checks/default.nix`.

- [ ] **Step 1:** write the fixtures (S8) and `checks/typecheck/default.nix` (S7) with the runner's `text` replaced by `exit 0`. In `checks/default.nix`: `typecheck = import ./typecheck {inherit lib pkgs; inherit (npm) nodeModules;};` and `typecheck-harness = typecheck.selftest;`. `git add checks/typecheck`.
- [ ] **Step 2 (RED):** `nb typecheck-harness` → `FAIL bad-strict: accepted`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** the runner's `text` as in S7. `nb typecheck-harness` → passes; log: `ok version Version 6.0.3`, `ok ok`, `ok bad-strict rejected with error TS7006`, `ok bad-pi rejected with error TS2322`, `ok no-ts rejected with no .ts files`.
- [ ] **Step 4:** `nb leak` → passes.
- [ ] **Step 5 (planted):** TypeScript 6.0 is strict by default, so removing `--strict` changes nothing (measured); plant `--strict false` on the runner's `tsc` line instead → `FAIL bad-strict: accepted`; restore. Remove `--skipLibCheck` → `FAIL ok: rejected`; restore.
  - [ ] red seen (`--strict`)
  - [ ] red seen (`--skipLibCheck`)
- [ ] **Step 6 (CLEAN):** `fmt checks/typecheck/default.nix checks/default.nix`. Commit.

### Task M0.6 — Module-evaluation harness

**Files:** create `checks/lib/hm-eval.nix` (S9), `checks/module-eval/default.nix` (S10), `checks/module-eval/expect.nix` (S11), `checks/module-eval/cases/common.nix` (S12, only `exports` and `inert`); modify `checks/default.nix` (`hm`, `module-eval`).

- [ ] **Step 1:** write the four files; in `cases/common.nix` write `exports` with the planted expectation `["default" "planted"]`. `git add checks/lib checks/module-eval`.
- [ ] **Step 2 (RED, planted):** `nb module-eval` → `FAIL exports: homeModules: expected [ "default" "planted" ], got [ "default" ]` and `module-eval: 1 failure(s) in 2 cases`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** expectation `["default"]`. `nb module-eval` → `module-eval: 2 cases passed`.
- [ ] **Step 4:** `nb leak` → passes.
- [ ] **Step 5 (planted):** (a) `caseFiles = [];` → evaluation error `module-eval: no cases`; revert. (b) in `modules/default.nix` add `home.file.planted.text = "x";` → `FAIL inert: home.file names: expected …, got …`; revert.
  - [ ] red seen (no cases)
  - [ ] red seen (`inert`)
- [ ] **Step 6 (CLEAN):** `fmt checks/lib/hm-eval.nix checks/module-eval/*.nix checks/module-eval/cases/common.nix checks/default.nix`. Commit.

### Task M0.7 — `agentDir`

**Files:** create `modules/common.nix` (S13: the header, `cfg`, and the option `agentDir` only; `config = {};`); modify `modules/default.nix` (S3), `checks/module-eval/cases/common.nix` (`agentDir-default`, `agentDir-type` of S12).

- [ ] **Step 1:** add `agentDir-default` and `agentDir-type`. `git add -u`.
- [ ] **Step 2 (RED):** `nb module-eval` → an evaluation error naming `piEconomics` (`attribute 'piEconomics' missing` or `The option `programs.piEconomics' does not exist`).
  - [ ] red seen
- [ ] **Step 3 (GREEN):** write `modules/common.nix` with `agentDir`; `modules/default.nix` imports `./common.nix`. `git add modules/common.nix`. `nb module-eval` → `4 cases passed`.
- [ ] **Step 4 (CLEAN):** `fmt modules/*.nix checks/module-eval/cases/common.nix`. Commit.

### Task M0.8 — Registry options and links

**Files:** modify `modules/common.nix` (S13 blocks marked M0.8: `extensionModule`, option `extensions`, `home.file`), `checks/module-eval/cases/common.nix` (`registry-links`); create `checks/module-eval/fixtures/ext-a/index.ts`, `ext-b/index.ts` (each one line: `export default function (): void {}`).

- [ ] **Step 1:** add the fixtures and `registry-links`. `git add checks/module-eval/fixtures`.
- [ ] **Step 2 (RED):** `nb module-eval` → `The option `programs.piEconomics.extensions' does not exist`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** add the M0.8 blocks. `nb module-eval` → `5 cases passed`.
- [ ] **Step 4 (CLEAN):** `fmt modules/common.nix checks/module-eval/cases/common.nix`. Commit.

### Task M0.9 — Registry existence assertion

**Files:** modify `modules/common.nix` (block M0.9: `assertions`), `checks/module-eval/cases/common.nix` (`registry-missing`).

- [ ] **Step 1:** add `registry-missing`.
- [ ] **Step 2 (RED):** `nb module-eval` → `FAIL registry-missing: failed assertions: expected [ "pi-economics: extension 'gone' not found at …; the upstream-x input may have renamed or removed it." "pi-economics: extension 'gone-local' not found at ….'" ], got [ ]`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** add the `assertions` block. `nb module-eval` → `6 cases passed`.
- [ ] **Step 4 (CLEAN):** format. Commit.

### Task M0.10 — Double links are rejected (characterisation)

**Files:** modify `checks/module-eval/cases/common.nix` (`registry-double-link-key`, `registry-double-link-target`).

- [ ] **Step 1:** add both cases. `nb module-eval` → `8 cases passed` (Home Manager does the rejecting, §5.1).
- [ ] **Step 2:** why the key matters: the in-tree modules of the host link under the same key `.pi/agent/extensions/<name>` until W2–W4 (§9.1), so a second link is an option conflict, not a silent second file.
- [ ] **Step 3 (planted):** in `modules/common.nix`, change the link to `lib.nameValuePair "pi-economics-extension-${name}" {source = e.path; target = "${cfg.agentDir}/extensions/${name}";}` → `FAIL registry-double-link-key: a second home.file definition of the link: expected evaluation to fail, it succeeded` and `FAIL registry-double-link-key: the registry links under the key .pi/agent/extensions/ext-a: does not hold`, while `registry-links` stays green (it compares targets, not keys). Revert. (Planner's run: both lines seen.)
  - [ ] red seen
- [ ] **Step 4 (CLEAN):** format. Commit.

### Task M0.11 — `piSettings.{enable, file, after}`

**Files:** modify `modules/common.nix` (option block M0.11), `checks/module-eval/cases/common.nix` (`pisettings-defaults` without its `ops`/`order` lines, which M0.12 adds).

- [ ] **Step 1:** add the case.
- [ ] **Step 2 (RED):** `nb module-eval` → evaluation error naming `piSettings`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** add the three options. `nb module-eval` → `9 cases passed`.
- [ ] **Step 4 (CLEAN):** format. Commit.

### Task M0.12 — Contributor-keyed ops, `sortedOps`

**Files:** modify `modules/common.nix` (blocks M0.12: `opModule`, `sortedOps`, options `ops` and `sortedOps`, `config.programs.piEconomics.piSettings.sortedOps`), `checks/module-eval/cases/common.nix` (`pisettings-order`, `pisettings-path-empty`, the `ops`/`order` lines of `pisettings-defaults`).

- [ ] **Step 1:** add the cases.
- [ ] **Step 2 (RED):** `nb module-eval` → evaluation error naming `piSettings.ops` (or `sortedOps`).
  - [ ] red seen
- [ ] **Step 3 (GREEN):** add the blocks. `nb module-eval` → `11 cases passed`.
- [ ] **Step 4 (CLEAN):** format. Commit.

### Task M0.13 — The jq program, today's ops

**Files:** create `checks/pi-settings-migrate/today-ops.nix` (S14); modify `modules/common.nix` (blocks M0.13: `access` … `program`, option `program`, its `config` line), `checks/module-eval/cases/common.nix` (`pisettings-program`).

- [ ] **Step 1:** write `today-ops.nix`; add the case. `git add checks/pi-settings-migrate`.
- [ ] **Step 2 (RED):** `nb module-eval` → evaluation error naming `program`.
  - [ ] red seen
- [ ] **Step 3 (GREEN):** add the blocks. `nb module-eval` → `12 cases passed`.
- [ ] **Step 4 (optional):** look at the program once:

```sh
(ulimit -v $cap && exec nix eval --raw --impure "${o[@]}" --expr '
  let
    f = builtins.getFlake "'"$F"'";
    hm = import "${f}/checks/lib/hm-eval.nix" {
      inherit (f.inputs.nixpkgs) lib;
      pkgs = f.inputs.nixpkgs.legacyPackages.x86_64-linux;
      home-manager = f.inputs.home-manager;
      homeModule = f.homeModules.default;
    };
    ops = (import "${f}/checks/pi-settings-migrate/today-ops.nix").withWarming;
  in (hm.eval {programs.piEconomics.piSettings.ops = ops;}).programs.piEconomics.piSettings.program')
```

Expected (planner's prototype): five `def opN:` lines (the host's removal, the two pi-retry removals, the child rule, `cacheWarming`), then `op1 | op2 | op3 | op4 | op5`.

- [ ] **Step 5 (CLEAN):** format. Commit.

### Task M0.14 — The script, ported fixtures (part 1)

**Files:** create `checks/pi-settings-migrate/default.nix` (S15, without the part 2 and part 3 lines), `checks/pi-settings-migrate/ported-cases.sh`; modify `modules/common.nix` (blocks M0.14: `script`, option `package`, its `config` line), `checks/default.nix` (`pi-settings-migrate`).

- [ ] **Step 1:** generate the ported cases from the host's check, lines 19–122, with two edits: the comment at host lines 98–101 (the retired `idle` flag) is replaced, and the three `$m <file> idle` calls become `$mi <file>`:

```sh
src=$(host checks/pi-settings-migrate/default.nix)
{
  printf '%s\n' '# Part 1: the host'"'"'s checks/pi-settings-migrate cases (f6a3c81, lines 19-122),' \
    '# sourced by ./default.nix with $m (today'"'"'s ops without cacheLifecycle) and' \
    '# $mi (with it; the host'"'"'s `idle` flag).'
  sed -n '19,97p' <<<"$src"
  printf '%s\n' '  # ops.cacheLifecycle (order 1500) sets cacheWarming = "idle": the warm' \
    '  # policy'"'"'s cache_warming_decision never fires in pi'"'"'s default "streaming" mode.'
  sed -n '102,122p' <<<"$src"
} | sed -E 's/^  \$m ([A-Za-z0-9]+\.json) idle$/  $mi \1/' >checks/pi-settings-migrate/ported-cases.sh
grep -c '^  \$mi ' checks/pi-settings-migrate/ported-cases.sh   # 3
grep -c ' idle$' checks/pi-settings-migrate/ported-cases.sh     # 0
```

The host's lines contain no `''` and no `${` (checked while planning), so sourcing them from bash runs exactly what the host's Nix string ran.

- [ ] **Step 2:** write `default.nix` (S15) with only `m`, `mi` and part 1; add `pi-settings-migrate = import ./pi-settings-migrate {inherit lib pkgs hm;};` to `checks/default.nix`. `git add checks/pi-settings-migrate`.
- [ ] **Step 3 (RED):** `nb pi-settings-migrate` → evaluation error naming `package`.
  - [ ] red seen
- [ ] **Step 4 (GREEN):** add the `script` block and the option. `nb pi-settings-migrate` → passes; the log shows every `case …` line of the host's check. `nb module-eval` and `nb leak` → pass.
- [ ] **Step 5 (CLEAN):** format. Commit.

### Task M0.15 — Bytes equal the legacy script's (part 2)

**Files:** create `checks/pi-settings-migrate/legacy.nix`, `differential.sh` (S16), `corpus/*.json`; modify `checks/pi-settings-migrate/default.nix` (part 2 lines of S15).

- [ ] **Step 1 (oracle):**

```sh
{
  printf '%s\n' '# Test oracle, not used by the module: the host'"'"'s' \
    '# modules/home-manager/features/ai/pi-settings-migrate.nix at f6a3c81, lines' \
    '# 32-97 verbatim (its header comment left out). Do not edit.'
  host modules/home-manager/features/ai/pi-settings-migrate.nix | sed -n '32,97p'
} >checks/pi-settings-migrate/legacy.nix
```

- [ ] **Step 2 (corpus):** 29 files, exact bytes:

```sh
c=checks/pi-settings-migrate/corpus
mkdir -p "$c"
E='git:github.com/fdietze/pi-claude-auth@main'
RX='{"pattern":"^You were spawned by \"","flags":"m"}'
HAS='"piRetry":{"subagents":{"match":{"systemPromptRegex":['"$RX"']}}}'
w() { printf '%s' "$2" >"$c/$1.json"; }
w 01-stale-claude-auth '{"packages":["a","'"$E"'",{"source":"/x"},"b"],"theme":"t"}'
w 02-order '{"packages":["z","'"$E"'","a"],'"$HAS"'}'
w 03-clean-odd-format "$(printf '{ "packages" : ["a"], %s }' "$HAS")"$'\n'
w 04-other-spellings '{"packages":["npm:pi-claude-auth","'"$E"'x"],'"$HAS"'}'
w 05-retry-entries '{"packages":["a","https://github.com/monotykamary/pi-retry",{"source":"/x"},"git:github.com/monotykamary/pi-retry","https://github.com/monotykamary/pi-retry-extra","b"],'"$HAS"'}'
w 06-regex-append '{"packages":["a"],"piRetry":{"baseDelayMs":2000,"subagents":{"enabled":true,"match":{"systemPromptRegex":[{"pattern":"other"}]}}}}'
w 07-theme-only '{"theme":"t"}'
w 08-piretry-string '{"piRetry":"x","packages":["a"]}'
w 09-piretry-string-stale '{"piRetry":"x","packages":["a","'"$E"'"]}'
w 10-invalid '{'
w 11-warming-streaming '{"cacheWarming":"streaming","theme":"t"}'
w 12-warming-idle-odd-format "$(printf '{ %s, "cacheWarming" : "idle" }' "$HAS")"$'\n'
w 13-piretry-null '{"piRetry":null}'
w 14-subagents-null '{"piRetry":{"subagents":null}}'
w 15-regex-null '{"piRetry":{"subagents":{"match":{"systemPromptRegex":null}}}}'
w 16-regex-false '{"piRetry":{"subagents":{"match":{"systemPromptRegex":false}}}}'
w 17-piretry-false-stale '{"piRetry":false,"packages":["'"$E"'"]}'
w 18-subagents-false '{"piRetry":{"subagents":false}}'
w 19-regex-string-stale '{"piRetry":{"subagents":{"match":{"systemPromptRegex":"x"}}},"packages":["'"$E"'"]}'
w 20-packages-null '{"packages":null}'
w 21-packages-string '{"packages":"x"}'
w 22-packages-false '{"packages":false}'
w 23-root-array '[]'
w 24-root-null 'null'
w 25-piretry-array '{"piRetry":[]}'
w 26-piretry-number-stale '{"piRetry":0,"packages":["'"$E"'"]}'
w 27-piretry-true '{"piRetry":true}'
w 28-warming-null '{"cacheWarming":null}'
w 29-two-documents '{} {}'
ls "$c"/*.json | wc -l   # 29
```

- [ ] **Step 3:** write `differential.sh` (S16); add the part 2 lines of S15 (`old`, `corpus`, `corpusCount`, the `part2` subshell). `git add checks/pi-settings-migrate`. `nb pi-settings-migrate` → passes; log `part 2: 58 comparisons, all equal` (the planner's prototype: 29 × 2 equal).
- [ ] **Step 4 (planted):** in `today-ops.nix`, `order = 1000;` for `cacheLifecycle` → `FAIL corpus 01-stale-claude-auth.json (idle): bytes differ from the legacy script's` followed by the diff (`cacheWarming` before `piRetry`). Revert. This is §5.4's reason for 1500.
  - [ ] red seen
- [ ] **Step 5:** `nb leak` → passes (`legacy.nix`, corpus scanned).
- [ ] **Step 6 (CLEAN):** `fmt checks/pi-settings-migrate/default.nix` (not `legacy.nix`: it stays verbatim; Alejandra leaves it unchanged anyway — check with `fmt --check checks/pi-settings-migrate/legacy.nix`). Commit.

### Task M0.16 — The op table (part 3)

**Files:** create `checks/pi-settings-migrate/op-table.sh` (S17); modify `default.nix` (part 3 lines of S15).

- [ ] **Step 1:** write `op-table.sh`; add `set_`, `ens`, `rem`, `mix` and the `part3` subshell. `git add`. `nb pi-settings-migrate` → passes; log ends with `part 3: op table passed` (the planner ran the same table against the prototype: 37 rows ok).
- [ ] **Step 2:** the rows map to §5.4's table and the `null`/`false` bullets (Scenario coverage).
- [ ] **Step 3 (planted):**
  - in `guarded`, a strict prefix guard for `removeWhere`: replace `map objectGuard (prefixes op.path)` by `map (if op.op == "removeWhere" then (p: "(${access p} | type) == \"object\"") else objectGuard) (prefixes op.path)` → `FAIL mix remove false aborts: expected the file untouched, got …`. Revert.
  - in `guarded`, `if guards == [] || op.op == "set"` (an unguarded `set`) → `FAIL mix wrong shapes skip only their op: …`. Revert.
  - [ ] red seen (removeWhere)
  - [ ] red seen (set)
- [ ] **Step 4 (CLEAN):** format. Commit.

### Task M0.17 — The activation entry

**Files:** modify `modules/common.nix` (blocks M0.17: `absFile`, `home.activation`), `checks/module-eval/cases/common.nix` (`pisettings-activation`, `pisettings-disabled`, `pisettings-no-ops`, `pisettings-file`).

- [ ] **Step 1:** add the four cases.
- [ ] **Step 2 (RED):** `nb module-eval` → `FAIL pisettings-activation: entry piSettingsMigrate exists: does not hold` and `FAIL pisettings-file: data for file = .local/state/pi/settings.json: expected "run …", got null` (`pisettings-disabled` and `pisettings-no-ops` pass already: no entry exists yet).
  - [ ] red seen
- [ ] **Step 3 (GREEN):** add the blocks. `nb module-eval` → `16 cases passed`. `nb pi-settings-migrate` → passes.
- [ ] **Step 4 (planted):** drop `cfg.piSettings.enable &&` from the condition → `FAIL pisettings-disabled: …`. Revert.
  - [ ] red seen
- [ ] **Step 5 (CLEAN):** format. Commit.

### Task M0.18 — Docs and agent rules

**Files:** create `docs/pi-economics.md` (S18), `AGENTS.md` (S19).

- [ ] **Step 1:** write both. `git add docs/pi-economics.md AGENTS.md`.
- [ ] **Step 2:** `nb leak` → passes (both files are scanned; neither names a home, address or e-mail).
- [ ] **Step 3:** every option name in `docs/pi-economics.md` exists:

```sh
for p in agentDir extensions piSettings enable file after 'ops.<contributor>'; do
  grep -qF "\`$p\`" docs/pi-economics.md || echo "MISSING $p"
done
```

Expected: no `MISSING` line.
- [ ] **Step 4:** commit.

### Task M0.19 — Gate and Execution Record

- [ ] **Step 1 (the gate, every check under the cap):**

```sh
names=$(ne checks.x86_64-linux --json --apply builtins.attrNames) && names=$(jq -er '.[]' <<<"$names") || echo "LISTING FAILED"
echo "$names" | tr '\n' ' '; echo
for c in $names; do
  /usr/bin/env time -f "$c: %M KiB peak, %e s" bash -c "ulimit -v $cap && exec timeout -s KILL 900 nix build --no-link '$F#checks.x86_64-linux.$c' --option eval-cache false" || echo "FAILED $c"
done
ne formatter.x86_64-linux.drvPath --raw; echo
ne homeModules --apply builtins.attrNames --json
fmt --check $(git ls-files '*.nix')
```

Expected: the listing `leak leak-selftest module-eval npm-deps pi-settings-migrate typecheck-harness`; no `FAILED`; a formatter `.drv`; `["default"]`; Alejandra reports nothing to change. Record each check's peak and time.

- [ ] **Step 2:** drift again (M0.0 Step 2): still empty, or ported.
- [ ] **Step 3:** fill `# Execution Record` below: date, commits per task, the boxes ticked, the gate's peaks and times, every deviation from this plan, answers to the open questions received meanwhile.
- [ ] **Step 4:** commit.

---

## Snippets

### S1 — `.gitignore`

```gitignore
result
result-*
```

### S2 — `flake.nix`

```nix
{
  description = "pi-economics: the pi coding agent's token-economics extensions as Home Manager components";

  inputs = {
    # Locked to the host's revisions (docs/plans/2026-10-17-m0-skeleton-plan.md,
    # M0.1); the host makes both follow its own inputs (spec §3).
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    # Checks only: the module-evaluation cases evaluate Home Manager.
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    home-manager,
  }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    inherit (nixpkgs) lib;
  in {
    # The only module export (spec §3, "Exports"): every component and
    # common.nix, so every option a cross-component assertion reads exists.
    homeModules.default = ./modules;

    formatter.${system} = pkgs.alejandra;

    checks.${system} = import ./checks {inherit self pkgs lib home-manager;};
  };
}
```

### S3 — `modules/default.nix`

M0.1 has `imports = [];`. From M0.7:

```nix
# Every module of the flake. Only this one is exported (homeModules.default).
{
  imports = [
    ./common.nix
  ];
}
```

### S4 — `checks/default.nix` (state after M0.14)

M0.1's first form is the argument set and `{}`. Later tasks add the lines named in their steps.

```nix
# Every check of the flake. Build them one at a time, capped (AGENTS.md,
# "Commands"); never `nix flake check` without a memory cap.
{
  self,
  pkgs,
  lib,
  home-manager,
}: let
  leakLib = import ./leak {inherit lib pkgs;};
  # Until P (spec §8.3): the spec and the plans name the owner's hosts and home.
  leakSrc = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.difference ../. (lib.fileset.unions [../docs/specs ../docs/plans]);
  };
  npm = import ./npm {inherit lib pkgs;};
  typecheck = import ./typecheck {
    inherit lib pkgs;
    inherit (npm) nodeModules;
  };
  hm = import ./lib/hm-eval.nix {
    inherit lib pkgs home-manager;
    homeModule = self.homeModules.default;
  };
in {
  leak = leakLib.check leakSrc;
  leak-selftest = leakLib.selftest;
  npm-deps = npm.check;
  typecheck-harness = typecheck.selftest;
  module-eval = import ./module-eval {inherit lib pkgs hm self;};
  pi-settings-migrate = import ./pi-settings-migrate {inherit lib pkgs hm;};
}
```


### S5 — `checks/leak/default.nix`

```nix
# The in-flake leak check (spec §8.3): generic patterns only, because a
# literal term list in a public repository would itself be the leak.
{
  lib,
  pkgs,
}: rec {
  scanner = pkgs.writeShellApplication {
    name = "pi-economics-leak-scan";
    runtimeInputs = [pkgs.gnugrep pkgs.findutils pkgs.coreutils];
    text = ''
      root=''${1:?usage: pi-economics-leak-scan <dir>}
      if [ -z "$(find "$root" -type f -print -quit)" ]; then
        echo "pi-economics-leak-scan: no files under $root" >&2
        exit 2
      fi
      status=0
      scan() {
        local rc=0
        grep -rnE -- "$2" "$root" || rc=$?
        case $rc in
          0)
            echo "pi-economics-leak-scan: $1 found (lines above)" >&2
            status=1
            ;;
          1) ;;
          *)
            echo "pi-economics-leak-scan: grep failed ($rc) on the $1 pattern" >&2
            exit 2
            ;;
        esac
      }
      scan "e-mail address" '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}'
      # A named user's home: more than one character, so /home/u/ passes.
      scan "home path" '/home/[A-Za-z_][A-Za-z0-9._-]+/'
      scan "git+ssh URL" 'git\+ssh://'
      # RFC 1918, full dotted quads only (a version such as 10.2 passes);
      # loopback is not a private network.
      scan "RFC 1918 address" '\b10(\.[0-9]{1,3}){3}\b'
      scan "RFC 1918 address" '\b172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}\b'
      scan "RFC 1918 address" '\b192\.168(\.[0-9]{1,3}){2}\b'
      exit "$status"
    '';
  };

  check = src:
    pkgs.runCommand "leak" {} ''
      ${lib.getExe scanner} ${src}
      touch $out
    '';

  # The hits are assembled at run time, so this file itself stays clean.
  selftest = pkgs.runCommand "leak-selftest" {nativeBuildInputs = [pkgs.gnugrep];} ''
    set -euo pipefail
    scan=${lib.getExe scanner}
    hit() {
      local d out st=0
      d=$(mktemp -d)
      printf '%s\n' "$2" >"$d/f.txt"
      out=$($scan "$d" 2>&1) || st=$?
      [ "$st" -eq 1 ] || { echo "FAIL hit '$2': exit $st, want 1" >&2; exit 1; }
      grep -qF -- "$1 found" <<<"$out" || { echo "FAIL hit '$2': not reported as $1" >&2; echo "$out" >&2; exit 1; }
      echo "ok hit $1: $2"
    }
    hit "e-mail address" "$(printf '%s@%s' someone example.org)"
    hit "home path" "$(printf '/%s/%s/x' home alice)"
    hit "home path" "$(printf '/%s/%s/x' home ab)"
    hit "git+ssh URL" "$(printf 'git+%s://host/repo' ssh)"
    hit "RFC 1918 address" "$(printf '%s.%s.%s.%s' 10 1 2 3)"
    hit "RFC 1918 address" "$(printf '%s.%s.%s.%s' 172 16 0 1)"
    hit "RFC 1918 address" "$(printf '%s.%s.%s.%s' 172 31 255 255)"
    hit "RFC 1918 address" "$(printf '%s.%s.%s.%s' 192 168 1 1)"

    mkdir near
    printf '%s\n' '/home/u/x' '127.0.0.1' 'version 10.2' 'v10.2.3' '172.15.0.1' '172.32.0.1' \
      '192.169.1.1' 'user@localhost' 'git+https://host/repo' >near/f.txt
    $scan near || { echo "FAIL near misses rejected" >&2; exit 1; }
    echo "near misses: pass"

    mkdir empty
    st=0
    $scan empty 2>/dev/null || st=$?
    [ "$st" -eq 2 ] || { echo "FAIL empty tree: exit $st, want 2" >&2; exit 1; }
    echo "empty tree: exit 2"
    touch $out
  '';
}
```

The planner checked: the six patterns find each hit, none of the near misses, and none of this file's own text; the scanner passes shellcheck.

### S6 — `checks/npm/default.nix`

```nix
# The shared npm lock (spec §3, "npm dependencies"). ./package.json and
# ./package-lock.json are the host's checks/pi-retry files at f6a3c81, byte for
# byte: pi-retry's devDependencies, which pin typescript, @types/node and pi's
# own packages for the type check and, from M6, vitest for pi-retry's suite.
# pname and source set are the host's, so the derivation is the host's.
{
  lib,
  pkgs,
}: rec {
  nodeModules = pkgs.buildNpmPackage {
    pname = "pi-retry-test-deps";
    version = "0";
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [./package.json ./package-lock.json];
    };
    npmDepsHash = "sha256-7fOhIoTUaTY4k6zvDN2F2YSy8of9TBCu9gQ4qEPDiqM=";
    npmDepsFetcherVersion = 2;
    dontNpmBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r node_modules $out/node_modules
      runHook postInstall
    '';
  };

  # The type check's toolchain is what the lock declares.
  check = let
    declared = (lib.importJSON ./package.json).devDependencies;
    pinned = ["typescript" "@types/node" "@earendil-works/pi-coding-agent"];
  in
    pkgs.runCommand "npm-deps" {nativeBuildInputs = [pkgs.jq];} ''
      set -euo pipefail
      ${lib.concatMapStrings (name: ''
          got=$(jq -r .version ${nodeModules}/node_modules/${name}/package.json)
          if [ "$got" != ${lib.escapeShellArg declared.${name}} ]; then
            echo "FAIL ${name}: installed $got, package.json declares ${declared.${name}}" >&2
            exit 1
          fi
          echo "ok ${name} $got"
        '')
        pinned}
      touch $out
    '';
}
```

`lib.fileset.toSource` here gives the same source path as the host's `pkgs.lib.fileset.toSource` (same name `source`, same two files), so `nodeModules` is the host's derivation.

### S7 — `checks/typecheck/default.nix`

```nix
# The type check (spec §8.1): `tsc --noEmit --strict --allowImportingTsExtensions`
# over every .ts file of a package, with typescript, @types/node and pi's types
# from the shared lock (../npm). Four more flags, all for pi 1.0.0's
# declarations (plan M0, D11): --skipLibCheck (pi-ai's .d.ts import JSON
# without import attributes and name an absent @modelcontextprotocol/sdk),
# --module nodenext and --target es2023 (the packages are "type": "module"),
# --types node.
{
  lib,
  pkgs,
  nodeModules,
}: rec {
  runner = pkgs.writeShellApplication {
    name = "pi-economics-tsc";
    runtimeInputs = [pkgs.nodejs pkgs.coreutils pkgs.findutils];
    text = ''
      src=''${1:?usage: pi-economics-tsc <package dir>}
      work=$(mktemp -d)
      trap 'rm -rf "$work"' EXIT
      cp -r "$src"/. "$work"/
      chmod -R u+w "$work"
      cd "$work"
      ln -sfn ${nodeModules}/node_modules node_modules
      mapfile -t files < <(find . -path ./node_modules -prune -o -name '*.ts' -print | LC_ALL=C sort)
      if [ "''${#files[@]}" -eq 0 ]; then
        echo "pi-economics-tsc: no .ts files under $src" >&2
        exit 2
      fi
      node node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions \
        --skipLibCheck --module nodenext --target es2023 --types node "''${files[@]}"
    '';
  };

  # One package, from M1 on: typecheck { name = "bench"; src = ../../packages/bench; }
  typecheck = {
    name,
    src,
  }:
    pkgs.runCommand "typecheck-${name}" {} ''
      ${lib.getExe runner} ${src}
      touch $out
    '';

  selftest = pkgs.runCommand "typecheck-harness" {nativeBuildInputs = [pkgs.gnugrep pkgs.nodejs];} ''
    set -euo pipefail
    tsc=${lib.getExe runner}
    fx=${./fixtures}
    want=${lib.escapeShellArg "Version ${(lib.importJSON ../npm/package.json).devDependencies.typescript}"}
    got=$(node ${nodeModules}/node_modules/typescript/bin/tsc --version)
    [ "$got" = "$want" ] || { echo "FAIL version: $got, want $want" >&2; exit 1; }
    echo "ok version $got"

    $tsc "$fx/ok" || { echo "FAIL ok: rejected" >&2; exit 1; }
    echo "ok ok"
    reject() {
      local out st=0
      out=$($tsc "$fx/$1" 2>&1) || st=$?
      [ "$st" -ne 0 ] || { echo "FAIL $1: accepted" >&2; exit 1; }
      grep -qF -- "$2" <<<"$out" || { echo "FAIL $1: rejected without '$2':" >&2; echo "$out" >&2; exit 1; }
      echo "ok $1 rejected with $2"
    }
    reject bad-strict 'error TS7006'
    reject bad-pi 'error TS2322'
    reject no-ts 'no .ts files'
    touch $out
  '';
}
```

Note for the planted "runner stub": with the stub, `$tsc "$fx/ok"` passes and `reject bad-strict` fails with `FAIL bad-strict: accepted`.

### S8 — type-check fixtures (`checks/typecheck/fixtures/`)

`ok/package.json`, `bad-strict/package.json`, `bad-pi/package.json`, `no-ts/package.json` (same content, `name` per directory):

```json
{ "name": "fixture-ok", "private": true, "type": "module" }
```

`ok/lib.ts`:

```ts
export const double = (n: number): number => n * 2;
```

`ok/index.ts`:

```ts
import { readFileSync } from "node:fs";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { double } from "./lib.ts";

export default function (pi: ExtensionAPI): void {
  void pi;
  void readFileSync;
  void getAgentDir;
  void double(1);
}
```

`ok/test/lib.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { double } from "../lib.ts";

test("double", () => {
  assert.equal(double(2), 4);
});
```

`bad-strict/index.ts`:

```ts
export function f(x) {
  return x;
}
```

`bad-pi/index.ts`:

```ts
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const n: number = getAgentDir();
```

Measured 2026-10-17 with the lock's `node_modules`: `ok` exit 0; `bad-strict` `index.ts(1,19): error TS7006`; `bad-pi` `index.ts(3,14): error TS2322` (line 2 in the planner's one-line-shorter copy).

### S9 — `checks/lib/hm-eval.nix`

```nix
# Home Manager evaluated as its modules/default.nix does (`rawModule`), without
# `moduleChecks`: that wrapper throws on the first failed assertion, and the
# negative cases must read config.assertions and their messages (plan M0, D4).
# A Home Manager update that moves these two files fails here, at evaluation.
{
  lib,
  pkgs,
  home-manager,
  homeModule,
}: let
  hmLib = import "${home-manager}/modules/lib/stdlib-extended.nix" lib;
  hmModules = import "${home-manager}/modules/modules.nix" {
    inherit pkgs;
    lib = hmLib;
    check = true;
  };
  user = {
    home.username = "u";
    home.homeDirectory = "/home/u";
    home.stateVersion = "26.05";
  };
  evalWith = modules:
    hmLib.evalModules {
      modules = modules ++ [user] ++ hmModules;
      class = "homeManager";
      specialArgs.modulesPath = "${home-manager}/modules";
    };
in {
  # The config of a case module, with this flake's module imported.
  eval = module: (evalWith [homeModule module]).config;
  # The same without this flake's module: the baseline of `inert`.
  evalBare = module: (evalWith [module]).config;
  # The option declarations, for checks on an option's type.
  options = module: (evalWith [homeModule module]).options;
}
```

### S10 — `checks/module-eval/default.nix`

```nix
# Module-evaluation cases (spec §8.1). A case file returns
# { <case> = [ failure strings ]; }, empty when the case holds. The check fails
# at build time and lists every failing case. A milestone adds its file to
# caseFiles.
{
  lib,
  pkgs,
  hm,
  self,
}: let
  expect = import ./expect.nix {inherit lib;};
  caseFiles = [
    ./cases/common.nix
  ];
  cases =
    lib.foldl' (
      acc: file: let
        new = import file {inherit lib hm self expect;};
        dup = lib.intersectLists (lib.attrNames acc) (lib.attrNames new);
      in
        if dup != []
        then throw "module-eval: duplicate case names: ${toString dup}"
        else acc // new
    ) {}
    caseFiles;
  failures = lib.concatLists (lib.mapAttrsToList (name: errs: map (e: "FAIL ${name}: ${e}") errs) cases);
in
  assert lib.assertMsg (cases != {}) "module-eval: no cases";
    pkgs.runCommand "module-eval" {
      report = builtins.unsafeDiscardStringContext (lib.concatStringsSep "\n" failures);
      passAsFile = ["report"];
      count = toString (lib.length (lib.attrNames cases));
    } ''
      if [ -s "$reportPath" ]; then
        cat "$reportPath" >&2
        echo >&2
        echo "module-eval: $(grep -c '^FAIL ' "$reportPath") failure(s) in $count cases" >&2
        exit 1
      fi
      echo "module-eval: $count cases passed"
      touch $out
    ''
```

### S11 — `checks/module-eval/expect.nix`

```nix
# The cases' vocabulary: each returns a list of failure strings, empty when
# the expectation holds.
{lib}: let
  show = lib.generators.toPretty {multiline = false;};
in {
  eq = what: got: want:
    lib.optional (got != want) "${what}: expected ${show want}, got ${show got}";
  holds = what: cond: lib.optional (!cond) "${what}: does not hold";
  # A throws case carries an `evaluates` control: the same value without the
  # defect, so the case cannot pass on an unrelated evaluation error.
  throws = what: value:
    lib.optional (builtins.tryEval (builtins.deepSeq value true)).success
    "${what}: expected evaluation to fail, it succeeded";
  evaluates = what: value:
    lib.optional (!(builtins.tryEval (builtins.deepSeq value true)).success)
    "${what}: expected evaluation to succeed, it failed";
  # The messages of the failed assertions that start with prefix, sorted.
  failed = prefix: cfg:
    lib.sort lib.lessThan (map (a: a.message)
      (lib.filter (a: !a.assertion && lib.hasPrefix prefix a.message) cfg.assertions));
}
```

### S12 — `checks/module-eval/cases/common.nix` (state after M0.17)

Each task adds the cases named in its steps; M0.6 starts with `exports` and `inert`.

```nix
# Cases for modules/common.nix: agentDir, the extension registry, piSettings.
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds throws evaluates failed;
  # Bindings are lazy: a binding whose file or option arrives later (fx in
  # M0.8, today in M0.13) may be written in M0.6 already.
  pe = cfg: cfg.programs.piEconomics;
  fx = ../fixtures;
  extA = {
    path = fx + "/ext-a";
    forChildren = true;
    description = "fixture a";
  };
  extB = {
    path = fx + "/ext-b";
    forChildren = false;
    description = "fixture b";
  };
  today = import ../../pi-settings-migrate/today-ops.nix;
  setX = value: order: {
    op = "set";
    path = ["x"];
    inherit value order;
  };
  activation = cfg: cfg.home.activation.piSettingsMigrate or null;
  dataOf = cfg: let
    e = activation cfg;
  in
    if e == null
    then null
    else e.data;
  runLine = cfg: file: "run ${lib.getExe (pe cfg).piSettings.package} ${lib.escapeShellArg file}\n";
in {
  # (M0.6)
  exports = eq "homeModules" (lib.attrNames self.homeModules) ["default"];

  # (M0.6) With every default the module renders nothing.
  inert = let
    c = hm.eval {};
    b = hm.evalBare {};
  in
    eq "home.file names" (lib.attrNames c.home.file) (lib.attrNames b.home.file)
    ++ eq "activation names" (lib.attrNames c.home.activation) (lib.attrNames b.home.activation)
    ++ eq "failed assertions" (failed "" c) []
    ++ eq "warnings" c.warnings b.warnings;

  # (M0.7)
  agentDir-default = eq "agentDir" (pe (hm.eval {})).agentDir ".pi/agent";
  agentDir-type = let
    t = (hm.options {}).programs.piEconomics.agentDir.type;
  in
    lib.concatMap (v: holds "agentDir rejects ${builtins.toJSON v}" (!t.check v)) ["/abs" "x/" ""]
    ++ lib.concatMap (v: holds "agentDir accepts ${v}" (t.check v)) [".pi/agent" "a" "custom/agent"];

  # (M0.8) Links follow agentDir and point at path, whatever their home.file
  # key (the key itself: registry-double-link-key).
  registry-links = lib.concatMap (dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        extensions = {
          ext-a = extA;
          ext-b = extB;
        };
      };
    };
    under = lib.filterAttrs (_: f: lib.hasPrefix "${dir}/extensions/" f.target) c.home.file;
  in
    eq "links under ${dir}"
    (lib.mapAttrs' (_: f: lib.nameValuePair f.target (toString f.source)) under)
    (lib.mapAttrs' (n: e: lib.nameValuePair "${dir}/extensions/${n}" (toString e.path)) (pe c).extensions)
    ++ eq "failed assertions (${dir})" (failed "" c) [])
  [".pi/agent" "custom/agent"];

  # (M0.9)
  registry-missing = let
    missingFile = fx + "/no-such-ext/index.ts";
    missingDir = fx + "/no-such-ext";
    c = hm.eval {
      programs.piEconomics.extensions = {
        ext-a = extA;
        gone =
          extA
          // {
            checkPath = missingFile;
            input = "upstream-x";
          };
        gone-local = {
          path = missingDir;
          forChildren = false;
          description = "d";
        };
      };
    };
  in
    eq "failed assertions" (failed "pi-economics:" c) (lib.sort lib.lessThan [
      "pi-economics: extension 'gone' not found at ${toString missingFile}; the upstream-x input may have renamed or removed it."
      "pi-economics: extension 'gone-local' not found at ${toString missingDir}."
    ]);

  # (M0.10) Home Manager rejects a second link (spec §5.1).
  registry-double-link-key = let
    key = ".pi/agent/extensions/ext-a";
    c = hm.eval {
      programs.piEconomics.extensions.ext-a = extA;
      home.file.${key}.source = extB.path;
    };
    alone = hm.eval {programs.piEconomics.extensions.ext-a = extA;};
  in
    holds "the registry links under the key ${key}" (alone.home.file ? ${key})
    ++ throws "a second home.file definition of the link" c.home.file.${key}.source;
  registry-double-link-target = let
    c = hm.eval {
      programs.piEconomics.extensions.ext-a = extA;
      home.file.other-ext-a = {
        target = ".pi/agent/extensions/ext-a";
        source = extB.path;
      };
    };
  in
    holds "Home Manager's conflicting-target assertion fires"
    (lib.any (lib.hasPrefix "Conflicting managed target files: .pi/agent/extensions/ext-a") (failed "" c));

  # (M0.11; the ops and order lines: M0.12)
  pisettings-defaults = let
    s = (pe (hm.eval {})).piSettings;
    moved = (pe (hm.eval {programs.piEconomics.agentDir = "custom/agent";})).piSettings;
    one =
      (pe (hm.eval {
        programs.piEconomics.piSettings.ops.t = [
          {
            op = "set";
            path = ["y"];
            value = 1;
          }
        ];
      })).piSettings;
  in
    eq "enable" s.enable true
    ++ eq "file" s.file ".pi/agent/settings.json"
    ++ eq "file follows agentDir" moved.file "custom/agent/settings.json"
    ++ eq "after" s.after []
    ++ eq "ops" s.ops {}
    ++ eq "default order" (lib.head one.sortedOps).order 1000;

  # (M0.12) (order, key, index); same order -> by contributor key (§8.1).
  pisettings-order = let
    s =
      (pe (hm.eval {
        programs.piEconomics.piSettings.ops = {
          zeta = [(setX "z0" 1000) (setX "z1" 1000)];
          alpha = [(setX "a0" 1000) (setX "a1" 2000)];
          mid = [(setX "m0" 500)];
        };
      })).piSettings;
  in
    eq "execution order" (map (o: "${o.key}#${toString o.index}") s.sortedOps)
    ["mid#0" "alpha#0" "zeta#0" "zeta#1" "alpha#1"];

  # (M0.12) No whole-object set.
  pisettings-path-empty = let
    pathOf = path:
      (lib.head
        (pe (hm.eval {
          programs.piEconomics.piSettings.ops.t = [
            {
              op = "set";
              inherit path;
              value = 1;
            }
          ];
        })).piSettings.ops.t).path;
  in
    throws "path = []" (pathOf [])
    ++ evaluates "path = [\"y\"]" (pathOf ["y"]);

  # (M0.13) One function per op, in execution order, then the pipe.
  pisettings-program = let
    s = (pe (hm.eval {programs.piEconomics.piSettings.ops = today.withWarming;})).piSettings;
    lines = lib.filter (l: l != "") (lib.splitString "\n" s.program);
    n = lib.length s.sortedOps;
  in
    eq "program without ops" (pe (hm.eval {})).piSettings.program ".\n"
    ++ eq "line count" (lib.length lines) (n + 1)
    ++ eq "pipe" (lib.last lines) (lib.concatMapStringsSep " | " (i: "op${toString i}") (lib.range 1 n))
    ++ lib.concatLists (lib.imap1 (i: op: let
      line = lib.elemAt lines (i - 1);
    in
      holds "line ${toString i} defines op${toString i} with its path and value" (
        lib.hasPrefix "def op${toString i}: " line
        && lib.hasInfix (lib.concatMapStrings (k: "[${builtins.toJSON k}]") op.path) line
        && lib.hasInfix (builtins.toJSON op.value) line
      ))
    s.sortedOps);

  # (M0.17)
  pisettings-activation = let
    c = hm.eval {
      programs.piEconomics.piSettings = {
        ops = today.withWarming;
        after = ["seed" "reclaim"];
      };
    };
    e = activation c;
  in
    holds "entry piSettingsMigrate exists" (e != null)
    ++ lib.optionals (e != null) (
      eq "data" e.data (runLine c "${c.home.homeDirectory}/${(pe c).piSettings.file}")
      ++ eq "after" e.after ["writeBoundary" "seed" "reclaim"]
      ++ eq "before" e.before []
    );
  pisettings-disabled = let
    c = hm.eval {
      programs.piEconomics.piSettings = {
        enable = false;
        ops = today.withWarming;
      };
    };
  in
    holds "no entry while enable = false, with ops from ${toString (lib.attrNames today.withWarming)}" (activation c == null);
  pisettings-no-ops =
    holds "no entry without ops" (activation (hm.eval {}) == null)
    ++ holds "no entry with only empty lists" (activation (hm.eval {programs.piEconomics.piSettings.ops.retry = [];}) == null);
  pisettings-file =
    lib.concatMap ({
      file,
      abs,
    }: let
      c = hm.eval {
        programs.piEconomics.piSettings = {
          inherit file;
          ops = today.withoutWarming;
        };
      };
    in
      eq "data for file = ${file}" (dataOf c) (runLine c (abs c)))
    [
      {
        file = ".local/state/pi/settings.json";
        abs = c: "${c.home.homeDirectory}/.local/state/pi/settings.json";
      }
      {
        file = "/var/lib/pi/settings.json";
        abs = _: "/var/lib/pi/settings.json";
      }
    ];
}
```

Case count by task: M0.6 2, M0.7 4, M0.8 5, M0.9 6, M0.10 8, M0.11 9, M0.12 11, M0.13 12, M0.17 16.

### S13 — `modules/common.nix` (state after M0.17)

Blocks are marked with the task that adds them. M0.7 writes the header, the argument set, `cfg`, the option `agentDir` and `config = {};`.

```nix
# Shared by every component (spec §4, §5.1, §5.4):
#  - agentDir: pi's agent directory, relative to home;
#  - extensions: the extension registry, rendered as links and existence
#    assertions (childExtensions follows in M2, with actorSubagents);
#  - piSettings: leaf edits of pi's mutable settings.json, contributed per
#    component under ops.<contributor> and run by one activation entry.
{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.programs.piEconomics;

  # (M0.8) One registry entry.
  extensionModule = {config, ...}: {
    options = {
      path = lib.mkOption {
        type = lib.types.path;
        description = "What `<agentDir>/extensions/<name>` links to: the extension's directory.";
      };
      checkPath = lib.mkOption {
        type = lib.types.path;
        default = config.path;
        defaultText = lib.literalExpression "path";
        description = ''
          What the existence assertion probes. For a patched source, the
          unpatched input's entry file: probing a derivation's output would be
          import-from-derivation, and a patch that no longer applies fails the
          package's build instead.
        '';
      };
      input = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Where the extension comes from; the existence assertion names it.";
      };
      forChildren = lib.mkOption {
        type = lib.types.bool;
        description = "Whether actor-subagents children load the extension (`childExtensions`, rendered from M2 on).";
      };
      description = lib.mkOption {
        type = lib.types.str;
        description = "What the extension does.";
      };
    };
  };

  # (M0.12) One edit of pi's settings.json.
  opModule = {
    options = {
      op = lib.mkOption {
        type = lib.types.enum ["set" "ensureContains" "removeWhere"];
        description = ''
          `set`: the leaf becomes `value`. `ensureContains`: `value` is appended
          to the list at `path` unless an equal element is there. `removeWhere`:
          the list's elements equal to `value` are removed.
        '';
      };
      path = lib.mkOption {
        type = lib.types.nonEmptyListOf lib.types.str;
        example = ["piRetry" "subagents" "match" "systemPromptRegex"];
        description = "Object keys from the root to the leaf: a list, never a dotted string, and never empty (no whole-object set).";
      };
      value = lib.mkOption {
        type = (pkgs.formats.json {}).type;
        description = "The leaf (`set`) or the list element (`ensureContains`, `removeWhere`).";
      };
      order = lib.mkOption {
        type = lib.types.int;
        default = 1000;
        description = "Ops run sorted by (order, contributor key, position in the contributor's list).";
      };
    };
  };

  # (M0.12) Every contributor's ops by (order, key, index): keying by
  # contributor makes the order independent of the modules' import order.
  sortedOps = let
    flat = lib.concatLists (lib.mapAttrsToList
      (key: ops: lib.imap0 (index: op: op // {inherit key index;}) ops)
      cfg.piSettings.ops);
    before = a: b:
      if a.order != b.order
      then a.order < b.order
      else if a.key != b.key
      then a.key < b.key
      else a.index < b.index;
  in
    lib.sort before flat;

  # (M0.13) The jq program: one function per op, each with its own shape
  # guard, piped in sorted order (spec §5.4). The guards are the host's
  # pi-settings-migrate.nix ones, generalised to any path:
  #  - an object on the way: `(<p> // {}) | type == "object"`. A missing key
  #    or null passes and is created; false passes and makes jq fail on the
  #    next key, so the whole file stays untouched; anything else skips the op.
  #  - the leaf: ensureContains `(<p> // []) | type == "array"` (missing, null
  #    and false become [value]); removeWhere an array, else the op is skipped.
  # jq's `and` short-circuits: no path after a failed guard is evaluated.
  access = path: "." + lib.concatMapStrings (k: "[${builtins.toJSON k}]") path;
  prefixes = path: map (n: lib.take n path) (lib.range 1 (lib.length path - 1));
  objectGuard = p: "((${access p} // {}) | type) == \"object\"";
  leafGuards = {
    set = _: [];
    ensureContains = p: ["((${access p} // []) | type) == \"array\""];
    removeWhere = p: ["(${access p} | type) == \"array\""];
  };
  edit = op: let
    a = access op.path;
    v = builtins.toJSON op.value;
    edits = {
      set = "if ${a} == ${v} then . else ${a} = ${v} end";
      ensureContains = "${a} |= ((. // []) | if any(.[]; . == ${v}) then . else . + [${v}] end)";
      removeWhere = "${a} |= map(select(. == ${v} | not))";
    };
  in
    edits.${op.op};
  guarded = op: let
    guards = map objectGuard (prefixes op.path) ++ leafGuards.${op.op} op.path;
  in
    if guards == []
    then edit op
    else "if ${lib.concatStringsSep " and " guards} then ${edit op} else . end";
  program = let
    n = lib.length sortedOps;
  in
    lib.concatImapStrings (i: op: "def op${toString i}: ${guarded op};\n") sortedOps
    + (
      if n == 0
      then ".\n"
      else lib.concatMapStringsSep " | " (i: "op${toString i}") (lib.range 1 n) + "\n"
    );

  # (M0.14) The host's script, with the program in a file and without the
  # positional `idle` flag (now ops.cacheLifecycle). Missing file: no-op.
  # jq failure (invalid JSON, false on the way): untouched, exit 0. Equal as
  # JSON: untouched, so the owners' bytes and formatting survive.
  script = pkgs.writeShellApplication {
    name = "pi-settings-migrate";
    runtimeInputs = [pkgs.jq pkgs.coreutils];
    text = ''
      f=''${1:?usage: pi-settings-migrate <settings.json>}
      [ -e "$f" ] || exit 0

      tmp=$(mktemp "$f.XXXXXX")
      trap 'rm -f "$tmp"' EXIT

      if ! jq -f ${pkgs.writeText "pi-settings-migrate.jq" program} "$f" >"$tmp" 2>/dev/null; then
        exit 0
      fi

      # Equal as JSON: keep the owners' bytes.
      if jq -e -n --slurpfile a "$f" --slurpfile b "$tmp" '$a == $b' >/dev/null; then
        exit 0
      fi

      chmod --reference="$f" "$tmp"
      mv -f "$tmp" "$f"
      trap - EXIT
      echo "pi-settings-migrate: migrated $f" >&2
    '';
  };

  # (M0.17)
  absFile =
    if lib.hasPrefix "/" cfg.piSettings.file
    then cfg.piSettings.file
    else "${config.home.homeDirectory}/${cfg.piSettings.file}";
in {
  options.programs.piEconomics = {
    # (M0.7)
    agentDir = lib.mkOption {
      type = lib.types.strMatching "[^/](.*[^/])?";
      default = ".pi/agent";
      description = ''
        pi's agent directory, relative to home, without a leading or trailing
        slash. pi's PI_CODING_AGENT_DIR is not modelled: a host that moves the
        agent directory sets this option.
      '';
    };

    # (M0.8)
    extensions = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule extensionModule);
      default = {};
      description = ''
        The extension registry, keyed by install name. Each entry is linked as
        `<agentDir>/extensions/<name>` (Home Manager rejects a second link of
        the same name) and its `checkPath` must exist. Components add
        themselves; a host adds its own extensions.
      '';
    };

    piSettings = {
      # (M0.11)
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the activation entry `piSettingsMigrate` is rendered. While false, none is, whatever ops exist.";
      };
      file = lib.mkOption {
        type = lib.types.str;
        default = "${cfg.agentDir}/settings.json";
        defaultText = lib.literalExpression ''"''${config.programs.piEconomics.agentDir}/settings.json"'';
        description = "pi's settings.json: an absolute path, or one relative to home.";
      };
      after = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Activation entries `piSettingsMigrate` runs after, besides `writeBoundary`.";
      };

      # (M0.12)
      ops = lib.mkOption {
        type = lib.types.attrsOf (lib.types.listOf (lib.types.submodule opModule));
        default = {};
        description = ''
          Leaf edits of pi's mutable settings.json, keyed by contributor (a
          component's name, or a key of the host's own such as `host`). All
          contributors' ops run in one jq program, sorted by (order,
          contributor key, position in the list), each skipped on its own
          when the file has another shape on the path; `false` on the way
          leaves the whole file untouched. See docs/pi-economics.md.
        '';
      };
      sortedOps = lib.mkOption {
        type = lib.types.listOf lib.types.attrs;
        readOnly = true;
        internal = true;
        description = "The ops in execution order, each with its contributor `key` and `index` (read by the checks).";
      };

      # (M0.13)
      program = lib.mkOption {
        type = lib.types.str;
        readOnly = true;
        internal = true;
        description = "The rendered jq program (read by the checks).";
      };

      # (M0.14)
      package = lib.mkOption {
        type = lib.types.package;
        readOnly = true;
        internal = true;
        description = "`pi-settings-migrate <file>`, the script the activation entry runs.";
      };
    };
  };

  config = {
    # (M0.12: sortedOps; M0.13: program; M0.14: package)
    programs.piEconomics.piSettings = {
      inherit sortedOps program;
      package = script;
    };

    # (M0.8)
    home.file = lib.mapAttrs' (name: e:
      lib.nameValuePair "${cfg.agentDir}/extensions/${name}" {source = e.path;})
    cfg.extensions;

    # (M0.9) An upstream rename breaks evaluation instead of leaving a link
    # that pi silently skips.
    assertions =
      lib.mapAttrsToList (name: e: {
        assertion = builtins.pathExists e.checkPath;
        message =
          "pi-economics: extension '${name}' not found at ${toString e.checkPath}"
          + (
            if e.input == null
            then "."
            else "; the ${e.input} input may have renamed or removed it."
          );
      })
      cfg.extensions;

    # (M0.17) The name the host's checks read (spec §5.4, "Activation").
    home.activation = lib.mkIf (cfg.piSettings.enable && sortedOps != []) {
      piSettingsMigrate = lib.hm.dag.entryAfter (["writeBoundary"] ++ cfg.piSettings.after) ''
        run ${lib.getExe script} ${lib.escapeShellArg absFile}
      '';
    };
  };
}
```

The planner's prototype of `sortedOps` … `program` (same code) rendered today's ops as five functions, and its output equalled the legacy script's on all 58 corpus comparisons and passed all 37 rows of the op table.

### S14 — `checks/pi-settings-migrate/today-ops.nix`

```nix
# Today's piSettings edits as ops per contributor (spec §5.4): what the host's
# pi-settings-migrate.nix does at f6a3c81. withWarming is with cacheLifecycle
# enabled (the host's `idle` flag). M4 compares ops.cacheLifecycle and M6
# ops.retry with these.
let
  removePackage = value: {
    op = "removeWhere";
    path = ["packages"];
    inherit value;
  };
in rec {
  withoutWarming = {
    # The host's own op: the former seed entry (spec §5.4).
    host = [(removePackage "git:github.com/fdietze/pi-claude-auth@main")];
    retry = [
      (removePackage "https://github.com/monotykamary/pi-retry")
      (removePackage "git:github.com/monotykamary/pi-retry")
      {
        op = "ensureContains";
        path = ["piRetry" "subagents" "match" "systemPromptRegex"];
        value = {
          pattern = ''^You were spawned by "'';
          flags = "m";
        };
      }
    ];
  };
  withWarming =
    withoutWarming
    // {
      cacheLifecycle = [
        {
          op = "set";
          path = ["cacheWarming"];
          value = "idle";
          order = 1500;
        }
      ];
    };
}
```

### S15 — `checks/pi-settings-migrate/default.nix` (state after M0.16)

M0.14 writes it without the lines marked M0.15 and M0.16.

```nix
# piSettings' script against fixtures (spec §5.4), ported from the host's
# checks/pi-settings-migrate at f6a3c81. Three parts, each a sourced file:
#  1. ./ported-cases.sh: the host's cases, against today's ops (./today-ops.nix);
#  2. ./differential.sh: for every file in ./corpus, the bytes of the legacy
#     script (./legacy.nix), with and without ops.cacheLifecycle;
#  3. ./op-table.sh: set, ensureContains and removeWhere on a nested path, for
#     missing parents, wrong shapes, null and false.
{
  lib,
  pkgs,
  hm,
}: let
  today = import ./today-ops.nix;
  exe = ops: lib.getExe (hm.eval {programs.piEconomics.piSettings.ops = ops;}).programs.piEconomics.piSettings.package;
  # (M0.16)
  nested = op: {
    t = [
      {
        inherit op;
        path = ["a" "b" "c"];
        value = 1;
      }
    ];
  };
  mix = {
    t = [
      {
        op = "removeWhere";
        path = ["packages"];
        value = "s";
        order = 900;
      }
      {
        op = "set";
        path = ["s1" "x"];
        value = 1;
      }
      {
        op = "ensureContains";
        path = ["e1" "x"];
        value = 1;
      }
      {
        op = "removeWhere";
        path = ["r1" "x"];
        value = 1;
      }
    ];
  };
  # (M0.15)
  corpusCount = lib.length (lib.filter (lib.hasSuffix ".json") (lib.attrNames (builtins.readDir ./corpus)));
in
  assert lib.assertMsg (corpusCount > 0) "pi-settings-migrate: empty corpus";
    pkgs.runCommand "pi-settings-migrate" {nativeBuildInputs = [pkgs.jq pkgs.coreutils pkgs.diffutils];} ''
      set -euo pipefail
      m=${exe today.withoutWarming}
      mi=${exe today.withWarming}
      # (M0.15)
      old=${lib.getExe (import ./legacy.nix {inherit pkgs lib;})}
      corpus=${./corpus}
      corpusCount=${toString corpusCount}
      # (M0.16)
      set_=${exe (nested "set")}
      ens=${exe (nested "ensureContains")}
      rem=${exe (nested "removeWhere")}
      mix=${exe mix}

      mkdir part1 part2 part3
      (cd part1 && source ${./ported-cases.sh})
      (cd part2 && source ${./differential.sh})
      (cd part3 && source ${./op-table.sh})
      touch $out
    ''
```

In M0.14 the `assert` line and `corpusCount` are absent and only `part1` is created; M0.15 adds them.

### S16 — `checks/pi-settings-migrate/differential.sh`

```bash
# Part 2: today's ops give the legacy script's bytes (spec §1, §5.4 "Today's
# sequence"). Sourced by ./default.nix with $old, $m, $mi, $corpus, $corpusCount.
n=0
for f in "$corpus"/*.json; do
  name=$(basename "$f")
  for mode in plain idle; do
    cp "$f" old.json
    cp "$f" new.json
    chmod u+w old.json new.json
    if [ "$mode" = idle ]; then
      "$old" old.json idle 2>/dev/null
      "$mi" new.json 2>/dev/null
    else
      "$old" old.json 2>/dev/null
      "$m" new.json 2>/dev/null
    fi
    if ! cmp -s old.json new.json; then
      echo "FAIL corpus $name ($mode): bytes differ from the legacy script's" >&2
      diff old.json new.json >&2 || true
      exit 1
    fi
    n=$((n + 1))
  done
done
[ "$n" -eq $((2 * corpusCount)) ] || {
  echo "FAIL corpus: $n comparisons, expected $((2 * corpusCount))" >&2
  exit 1
}
"$old" none-old.json
"$mi" none-new.json
[ ! -e none-old.json ] && [ ! -e none-new.json ]
echo "part 2: $n comparisons, all equal"
```

### S17 — `checks/pi-settings-migrate/op-table.sh`

```bash
# Part 3: spec §5.4's op table on the path ["a","b","c"] with value 1, and one
# skipped op against an aborted program. Sourced by ./default.nix with $set_,
# $ens, $rem and $mix (removeWhere packages "s" at order 900, then set s1.x,
# ensureContains e1.x, removeWhere r1.x, each with value 1).
t() { # label, script, input, expected JSON or UNTOUCHED
  printf '%s' "$3" >t.json
  cp t.json t0.json
  "$2" t.json 2>/dev/null
  if [ "$4" = UNTOUCHED ]; then
    cmp -s t.json t0.json || { echo "FAIL $1: expected the file untouched, got $(cat t.json)" >&2; exit 1; }
  else
    jq -e --argjson want "$4" '. == $want' t.json >/dev/null || { echo "FAIL $1: expected $4, got $(cat t.json)" >&2; exit 1; }
  fi
  echo "ok $1"
}
C='{"a":{"b":{"c":1}}}'
L='{"a":{"b":{"c":[1]}}}'
t "set missing parents" "$set_" '{}' "$C"
t "set null on the way" "$set_" '{"a":null}' "$C"
t "set null deeper" "$set_" '{"a":{"b":null}}' "$C"
t "set null leaf" "$set_" '{"a":{"b":{"c":null}}}' "$C"
t "set false leaf" "$set_" '{"a":{"b":{"c":false}}}' "$C"
t "set other leaf" "$set_" '{"a":{"b":{"c":"s"}}}' "$C"
t "set equal leaf keeps bytes" "$set_" '{ "a" : { "b" : { "c" : 1 } } }' UNTOUCHED
t "set string on the way" "$set_" '{"a":"s"}' UNTOUCHED
t "set number on the way" "$set_" '{"a":0}' UNTOUCHED
t "set list on the way" "$set_" '{"a":[]}' UNTOUCHED
t "set true on the way" "$set_" '{"a":true}' UNTOUCHED
t "set false on the way" "$set_" '{"a":false}' UNTOUCHED
t "set false deeper" "$set_" '{"a":{"b":false}}' UNTOUCHED
t "ensure missing parents" "$ens" '{}' "$L"
t "ensure null on the way" "$ens" '{"a":null}' "$L"
t "ensure null leaf" "$ens" '{"a":{"b":{"c":null}}}' "$L"
t "ensure false leaf" "$ens" '{"a":{"b":{"c":false}}}' "$L"
t "ensure appends" "$ens" '{"a":{"b":{"c":[2]}}}' '{"a":{"b":{"c":[2,1]}}}'
t "ensure present keeps bytes" "$ens" '{ "a" : { "b" : { "c" : [ 2, 1 ] } } }' UNTOUCHED
t "ensure string leaf" "$ens" '{"a":{"b":{"c":"s"}}}' UNTOUCHED
t "ensure number leaf" "$ens" '{"a":{"b":{"c":1}}}' UNTOUCHED
t "ensure string on the way" "$ens" '{"a":"s"}' UNTOUCHED
t "ensure false on the way" "$ens" '{"a":false}' UNTOUCHED
t "remove all equal, order kept" "$rem" '{"a":{"b":{"c":[2,1,{"k":1},1]}}}' '{"a":{"b":{"c":[2,{"k":1}]}}}'
t "remove absent keeps bytes" "$rem" '{ "a" : { "b" : { "c" : [ 2 ] } } }' UNTOUCHED
t "remove missing parents" "$rem" '{}' UNTOUCHED
t "remove null on the way" "$rem" '{"a":null}' UNTOUCHED
t "remove null leaf" "$rem" '{"a":{"b":{"c":null}}}' UNTOUCHED
t "remove false leaf" "$rem" '{"a":{"b":{"c":false}}}' UNTOUCHED
t "remove string leaf" "$rem" '{"a":{"b":{"c":"s"}}}' UNTOUCHED
t "remove string on the way" "$rem" '{"a":"s"}' UNTOUCHED
t "remove false on the way" "$rem" '{"a":false}' UNTOUCHED
t "mix applies all" "$mix" '{"packages":["s","k"]}' '{"packages":["k"],"s1":{"x":1},"e1":{"x":[1]}}'
t "mix wrong shapes skip only their op" "$mix" '{"packages":["s"],"s1":"x","e1":"x","r1":"x"}' '{"packages":[],"s1":"x","e1":"x","r1":"x"}'
t "mix set false aborts" "$mix" '{"packages":["s"],"s1":false}' UNTOUCHED
t "mix ensure false aborts" "$mix" '{"packages":["s"],"e1":false}' UNTOUCHED
t "mix remove false aborts" "$mix" '{"packages":["s"],"r1":false}' UNTOUCHED
echo "part 3: op table passed"
```

### S18 — `docs/pi-economics.md`

```markdown
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

## Checks

| Check | Covers |
|---|---|
| `module-eval` | Home Manager evaluations: exports, options, registry, piSettings rendering, assertions with their negative cases |
| `pi-settings-migrate` | the piSettings script: the ported cases, bytes equal to the former script, the op table |
| `npm-deps` | the shared npm lock (`checks/npm`) installs the declared toolchain |
| `typecheck-harness` | the `tsc` runner accepts and rejects what it must |
| `leak`, `leak-selftest` | no e-mail addresses, named home paths, `git+ssh` URLs or private addresses in tracked files |

How to run them: `AGENTS.md`, "Commands".
```

### S19 — `AGENTS.md`

```markdown
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
- `flake.lock` changes only when a task needs it.
```

---

## Open questions

- **Q1 (D4).** Module evaluation uses Home Manager's internal `modules/modules.nix` and `modules/lib/stdlib-extended.nix` instead of `homeManagerConfiguration` (§8.1 says "`homeManagerConfiguration` cases"), because the latter throws before a negative case can read its assertion message. Accept?
- **Q2 (D11).** Four `tsc` flags beyond §8.1's (`--skipLibCheck`, `--module nodenext`, `--target es2023`, `--types node`): pi 1.0.0's own declarations fail without `--skipLibCheck`. Accept, or amend §8.1?
- **Q3 (D14).** `git:github.com/fdietze/pi-claude-auth@main` stays literal in the fixtures and the oracle (a public package spelling and the host's op). §8.3 rewrites fixtures that name a person. Keep until P, or neutralise now (and lose the byte oracle for that entry)?
- **Q4 (D7).** `false` on the way aborts for `removeWhere` too (one guard family). §5.4 states the abort generally; confirm it applies to `removeWhere`.
- **Q5 (D19).** M0 adds `AGENTS.md` and starts `docs/pi-economics.md` with the shared options. §2 moves the host's `docs/pi-token-economics.md` here but §9 assigns it to no milestone: which milestone moves it?
- **Q6 (D9).** The entry's command line becomes `run <exe> <file>` without double quotes; the host's two assertions on it change at W6. Fine?

# Execution Record
