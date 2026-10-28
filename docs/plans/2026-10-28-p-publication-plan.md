# P — Publication: TDD plan

Date: 2026-10-28 · Spec: `docs/specs/2026-10-12-pi-economics-design.md` (r5 with the 2026-10-25 amendments) §8.3, §9 rows P and W8, §9.1 "W8" · Milestone: P · Base: this repository at `a67a11f` (= the host's current lock; router Group 6 and 7 still open)

> **For agentic workers:** use executing-plans (native) or subagent-driven-development. Steps use `- [ ]`; tick a "red seen" box only after the red was actually on screen. Group A may start now, in a worktree; Groups B–D wait for the router (see "Order").

**Goal:** a tree that can be pushed as `github:GRBurst/pi-economics` — neutral defaults, no owner-identifying text anywhere in the tracked tree (the in-flake leak check scans it all), a licence, a README, a one-commit history — while the host keeps its behaviour when W8 moves its lock to the published commit.

**Terms.** **P₀** the base commit of P's first task (recorded in `~/.cache/pi/p/P0`). **P_end** the last commit on `main` before the squash. **S** the squashed commit (`publish` branch). **Host** `~/projects/nixos/new` (the dotfiles worktree; read-only for P's agents; edits there are main's or the owner's). **D** the host's private term set (`checks/leak-terms.nix`). **F** the dead free model id `openrouter/qwen/qwen3.8-27b:free`. **LAN host URL** an `http(s)://` URL whose host is one bare DNS label of ≥ 2 characters other than `localhost` (e.g. the router's current default `http://earth:11545`).

## Global constraints

- In-flake checks stay generic (§8.3): no literal private term in any tracked file, ever, including checks and this plan's successors. Private terms live only in `~/.cache/pi/p/` (never committed) and in the host's D.
- W8 must not change the host's behaviour: every default P changes is one the host sets itself, or one with no host reader (proved below, "Host invariance").
- `flake.lock` unchanged from P₀ (gate line `AC-lock`).
- Existing tests are preserved; every changed test line is listed in its task with the reason.
- Never more than one red check at a time; the planned reds are listed per task.
- Commits unsigned, path-limited: `git -c commit.gpgsign=false commit -o <paths> -m …`; never stage another agent's file.
- The owner's pause flag (`~/.cache/pi/pluto-exec/owner-deploy.flag`) is honoured by every build (`flag` in env.sh).
- Nothing is pushed by an agent; the GitHub repository, the push and W8 are the owner's (sandbox: no SSH agent).

## Order (dependency on router Groups 6/7)

| Group | Tasks | Earliest start | Why |
|---|---|---|---|
| A | P.0–P.3 (licence, retry nit, LOGS wording) | now, worktree `~/.cache/pi/p-wt`, branch `p-publication` from `main` | file-disjoint from G6 (`packages/task-router/core/settings.ts`, `test/policy.test.ts`, AC5 tests, golden) and G7 (`docs/plans/2026-10-25-router-g3-g7-plan.md`, `docs/pi-economics.md` § taskRouter) |
| B | P.4–P.7 (health default, fixtures, LAN-host leak pattern) | after G6's T6.1 is on `main`; rebase `p-publication` onto it | touches `settings.ts` and `policy.test.ts`, which T6.1 edits |
| C | P.8–P.12 (public docs, README, archive, drop the exclusion, final gate) | after G7's T7.1 is on `main`; `p-publication` fast-forwarded into `main`, work continues on `main` | moves `docs/plans/` (G7 writes its record there) and edits `docs/pi-economics.md` |
| D | P.13 (squash) → O.1 (owner: GitHub, push) → O.2 = W8 (owner, host) → O.3 (owner: local branches) | after P.12 | — |

If G6 stalls (it waits for the host's lock move to R5 and spends bench quota), main may decide to run Group B before T6.1 and let T6.1 rebase onto it (OQ12); the conflict is a few lines in `policy.test.ts`.

## Review Focus

1. **Host invariance at W8.** The host sets `models.qwen-local.{model,health}` and `models.qwen-cloud.model` itself (`homes/pallon/default.nix:198-204`), and host `checks/eval-assertions.nix:9544-9580` pins the rendered `task-router/settings.json` to the base keys plus exactly those. The router merges the file over `defaults()`, so the new default health is never read on the host. The bench's router base (`PI_BENCH_ROUTER`) takes `models` from the same settings (host comment `:185-186`).
2. **The frozen oracle edit (P.7).** `test/oracle/legacy-settings.ts:20` says "never edit"; P changes one literal that no code reads (`localHealthUrl` of the legacy defaults; readers of `test/oracle/` use `models`/tables only — the task re-proves it with grep). A deviation from the oracle rule, recorded (gate VIOLATION 1).
3. **Docs leave the repository (P.10, P.11).** Verbatim to the host's `docs/specs/` and `docs/plans/` (OQ1); 258 `spec §` and ~370 plan/task citations in code comments stay as they are, explained by one provenance paragraph (OQ2).
4. **The squash.** `tree(S) = tree(P_end)`, S has no parent, only `publish` is pushed (never `--tags`, `--all`, `--mirror`): no pre-squash object leaves the machine.
5. **What stays that names the owner's world without identifying anyone** ("considered, kept" table, D10): F in tests and `levels.ts`, the model id `llama/qwen3.8`, the bench's `notes/2026-10-03-AGENTS.md.before` default, "owner" in comments, the golden header's `566fd0d (host dotfiles)`.

## Motivation

Spec §8.3 and §9 (row P): the flake is published as `github:GRBurst/pi-economics`. Before that, defaults that name the owner's hosts become neutral (today the router's local health URL `http://earth:11545`), with the golden file and the default-asserting tests updated as listed differences; the spec and plans, which name the owner's hosts, home and paths, are scrubbed or moved out and the leak check's exclusion of `docs/specs/` and `docs/plans/` is dropped; upstream licences are checked and the flake gets one that allows distributing patches against them; the history is squashed, the pre-squash refs staying until W8 because the host's lock names W0–W7's revisions. W8 (owner) then switches the host's input to GitHub without changing its behaviour.

## Approach

- **Group A (independent).** `LICENSE` (MIT) and `NOTICE` (upstream credits for the three patched inputs) behind a new Nix check `license`; review-m6 Low: an empty nested attribute set in `retry.settings` becomes a `pi-economics:` assertion with its negative case; review-g5 nit: "one tier up" → "one level up" in `LOGS.md` and the analysis report's legend, the attempts test title.
- **Group B (defaults).** First a refactor: the three policy tests that compare health-probe URLs derive them from the settings under test instead of the literal. Then the default (`settings.ts`) becomes `http://localhost:11545` (red: `settings.test.ts:31`), then the today fixture (red: a new property test, "every URL in fixtures and defaults names no machine"). Finally the leak scanner learns a generic **LAN host URL** pattern (red: selftest; its own near miss `git+https://host/repo` becomes `git+https://h/repo`), which turns the tree scan red on exactly the last site, the frozen oracle's literal, rewritten in the same task. Golden: expected zero diff (no decision line carries a URL; measured: `grep -c earth golden.txt` = 0).
- **Group C (docs and publication tree).** Public docs (`AGENTS.md`, `docs/pi-economics.md`, `docs/pi-token-economics.md`, `flake.nix` comment) lose the owner's paths and gain the provenance paragraph; `README.md` for consumers, its Home Manager example pinned by a module-eval case to a fixture that evaluates. Then the archive (verbatim copy + checksums + a git bundle of the pre-squash history) goes to main for the host commit, `checks/default.nix` scans the whole tree (red: the docs' hits), `git rm -r docs/specs docs/plans` (green), final gate and both private scans.
- **Group D.** `git commit-tree P_end^{tree}` → S on branch `publish`, tag `pre-squash` on P_end; owner creates the repo and pushes `publish:main`; W8 in the host; afterwards the local `main` follows S.

## Decisions

| # | Decision | Rationale | Rejected alternative, and why |
|---|---|---|---|
| D1 | **Move, not scrub**, the spec and all plans: verbatim (same file names) into the host's `docs/specs/` and `docs/plans/` (OQ1) | ~11.8 k lines; their content is the owner's process (host gates, `git dot`, `~/.cache/pi`, quotas, host commit hashes), not consumer documentation; host names are already everywhere in the host; same names ⇒ every `docs/plans/<name>` citation inside the records and the host's citations of "pi-economics spec §n" resolve in one place; host rules put specs/plans exactly there; no name clashes (checked) | scrub in place: rewriting 1063 + 10 744 lines of history loses provenance and still leaves the owner's workflow public; a third private repo: a fourth place to look, host citations dangle; keeping them only in the pre-squash history: unreadable without git archaeology |
| D2 | Code-comment citations (`spec §n`, `D…`, `T…`, `plan router-g3-g7`) stay; one provenance paragraph in `README.md` and `AGENTS.md` explains them (OQ2) | 258 + ~370 sites in 121+ files; rewriting is churn with regressions in pinned texts; they identify nobody | rewriting every comment: large diff, no consumer value |
| D3 | Neutral health default `http://localhost:11545` (OQ4) | the module's example and `docs/pi-economics.md:261` already use it; a consumer without the server sees `local down` and routes on (the router's existing path) | `127.0.0.1`: equal, less readable; blank `qwen-local.model`: changes routing defaults (golden), beyond §8.3 |
| D4 | Policy tests derive URLs from the settings under test (refactor P.4 before P.5) | the default and fixture change then turn exactly one test red each; the tests stop pinning a host fact | changing the literals alongside: three tests red together with the default |
| D5 | A new generic leak pattern "LAN host URL" (single label ≥ 2 chars, not `localhost`) (OQ6) | catches the exact class P fixes, with no term list (§8.3); mirrors the home-path rule's "longer than one character" so test hosts `h`, `a`, `b` pass | none (status quo): the in-flake check never catches a host name; a term list: is itself the leak |
| D6 | Edit the frozen oracle's one literal (`legacy-settings.ts:20`) with a header note (OQ5) | no reader; otherwise the LAN pattern needs a per-file exclusion, a hole in a public leak check | an exclusion: hole; deleting the oracle: the golden grid needs it |
| D7 | Private term scans run outside the repository: (a) the host's own `pi-economics-leaks` built with `--override-input pi-economics <candidate>` (term set D, read-only use of the host); (b) `~/.cache/pi/p/private-terms.sh` for path fragments D lacks (OQ13) | reuses the host's maintained term set; nothing private is written into the flake | a term list in the flake: forbidden (§8.3); `~/.cache/pi/router-g37/private.sh`: it is the router's replay/stand-in script, not a term scan (kept in P's gate for router tasks) |
| D8 | MIT, `Copyright (c) 2026 GRBurst`, plus `NOTICE` naming the three upstreams, their authors and licences (OQ10) | every package already declares `"license": "MIT"`; the three upstreams are MIT (`pi-actor-subagents`, `pi-infinite-context`: LICENSE © 2026 Felix Dietze; `pi-retry`: `package.json` and README "MIT", author Tom X Nguyen, no LICENSE file at the locked `60a3b08`); MIT allows distributing patches | Apache-2.0/GPL: incompatible with nothing, but differs from the packages' declared licence |
| D9 | retry: an empty nested attribute set is an assertion error naming its path (OQ9) | a silently dropped setting is a bug the user cannot see; AGENTS.md convention (message prefix, negative case) | `set path {}`: would replace an object pi or the user wrote; a warning: easy to miss; docs only: review-m6 asked for a fix |
| D10 | Considered and kept (OQ7, OQ8): F in router tests, the `today` rollback fixture (router D8) and `token-meter/core/levels.ts:15` (classifies old logs); `llama/qwen3.8`; the bench's `agentsOff` default `<agentSrc>/notes/2026-10-03-AGENTS.md.before`; "owner"/"the host" in comments; golden header line 2 | public model ids and a file-layout default identify nobody; changing F or the bench default changes host behaviour or golden lines for no privacy gain | scrubbing them: golden diff (`select today` lines), a host W8 setting (`bench.agentsBaseline`) |
| D11 | Squash with `git commit-tree P_end^{tree}` onto a new branch `publish`; `main` stays pre-squash until O.3 (after W8); tag `pre-squash` = P_end; bundle in the archive, kept indefinitely (OQ11) | the host's lock (`git+file:…?ref=main`, rev a67a11f or later) must keep resolving until W8; the archived records cite pre-squash hashes | orphan checkout + `git add -A`: can pick up untracked files; rewriting `main` before W8: the host's locked rev becomes unreachable from `ref=main` |
| D12 | README's Home Manager example = a fixture file, compared line by line and evaluated by a module-eval case (OQ14) | README rot is the commonest consumer failure; no regex (splitString) | an unchecked README |
| D13 | Future plans after P live in the host's `docs/plans/` (OQ3); the flake's `AGENTS.md` says so | a plan for this flake always names the host's gates, paths and hosts | plans in the flake under the leak check: every plan would need scrubbing by hand |
| D14 | The archive goes to the host before the flake deletes the docs (P.10 before P.11), but P.11 does not wait for the host commit: the pre-squash history and the bundle hold the files | keeps P unblocked by a host commit | waiting for main's host commit: idle time |

## The gate

Rules of `AGENTS.md` (this flake), row by row.

| Rule | Result |
|---|---|
| Tests first; a new check seen red once | PASS — every task has its RED; new checks `license`, cases `retry-settings-empty-attr`, `readme-example`, test `neutral-hosts.test.ts`, the LAN pattern: each in "Planted violations" |
| Checks never use `builtins.match` | PASS — `license` and `readme-example` use `lib.splitString` and list equality |
| Assertion message prefix `pi-economics:` and a negative case | PASS — P.2 |
| No import-from-derivation | PASS — `builtins.readFile` of source paths only |
| Leak check scans every tracked file outside `docs/specs/`, `docs/plans/` | CHANGED by design (P.11): every tracked file; `AGENTS.md` bullet rewritten (P.11) |
| `checks/pi-settings-migrate/legacy.nix` verbatim | PASS — untouched (no private term; scanned) |
| iface copies get `iface.compare` | N/A — no API type copied |
| Patched upstreams under `patches/<input>/` | PASS — unchanged; `NOTICE` names them |
| `flake.lock` changes only when needed | PASS — `AC-lock` gate line |
| Frozen oracles `test/oracle/*` "never edit" (router plan T0.3) | **VIOLATION 1** — P.7 edits one literal of `legacy-settings.ts` |
| Spec §9: "Q … before P, so that nothing published names the dead free model" | **VIOLATION 2** — F stays in tests, the rollback fixture, `levels.ts` (D10) |
| Spec §8.3: P updates the golden file for the default change | DEVIATION (no violation) — expected zero diff, measured: no golden line carries a URL; a non-zero diff stops the task |

### Complexity tracking

| Violation | Need | Simpler alternative rejected |
|---|---|---|
| 1 Oracle literal | no LAN host in the published tree without a per-file exclusion | exclusion in the public leak check (a hole); deleting the oracle (the golden grid compares against it) |
| 2 F kept | `levels.ts` must classify historic log lines; the rollback fixture is the only witness of a configured free slot (router D8); tests of the slot need a realistic id | replacing F by a neutral id: golden `select today` lines move, old logs misclassify; spec §9's sentence is satisfied for defaults and arms (T5.4, Q) — main amends §9 (OQ7) |

## Files to read first

- `AGENTS.md`; spec §8.3, §9 (rows Q, P, W8), §9.1 "W8"; `docs/plans/2026-10-25-q-retire-qwen-arm-plan.md` § "Inventory for P" (and its Execution Record's inventory note); `docs/plans/2026-10-25-router-g3-g7-plan.md` Execution Record (RF5 "Not done"), Group 6/7.
- `checks/default.nix`, `checks/leak/default.nix`, `checks/module-eval/{default.nix,expect.nix,cases/retry.nix}`, `checks/lib/hm-eval.nix`.
- `modules/retry.nix`; `packages/token-meter/LOGS.md:100-112`, `packages/token-meter/core/analyse.ts:560-570`, `packages/task-router/test/attempts.test.ts:37`.
- `packages/task-router/core/settings.ts:20-40`, `test/settings.test.ts:20-40,125-145`, `test/policy.test.ts:85-100,225-250,390-415`, `test/harness.ts:10-50`, `test/fixtures/{today-config,models-example}.json`, `test/oracle/legacy-settings.ts`, `test/golden/oracle.ts`, `test/chain-table.test.ts:1-20`.
- `checks/router-golden/{default.nix,generate.ts}` (header only), `docs/pi-economics.md`, `docs/pi-token-economics.md:1-70`, `flake.nix:1-30`.
- Notes: `~/.pi/agent/notes/2026-10-25-review-m6.md` (Findings), `~/.pi/agent/notes/2026-10-26-review-router-g5.md` (Nits).
- Host, read-only: `homes/pallon/default.nix:160-210`, `checks/eval-assertions.nix:9540-9590`, `checks/pi-economics-leaks.nix`, `checks/leak-terms.nix`, `flake.nix:155-165`.
- Gate: `~/.cache/pi/router-g37/{env.sh,gate.sh,private.sh}`, `~/.cache/pi/m5env.sh`.

## Type checking strategy

- `tsc --strict` via `typecheck-task-router` and `typecheck-token-meter` on every task that touches TypeScript; new test files are strict-clean (explicit `any` allowed as in the suite). Expected rejections: none planned; `neutral-hosts.test.ts`'s `urls()` walker typed `unknown → string[]`.
- Nix: evaluation of every check (`nix eval …#checks.x86_64-linux --apply attrNames` in the gate) rejects a missing file in `license` (`pathExists` guards) and an unknown option in the README fixture (module system).

## Testing strategy

| Layer | Covers | Needs |
|---|---|---|
| Package tests (`node --test`, built as checks `task-router`, `token-meter`) | P.3 report legend; P.4 derivation refactor; P.5 default; P.6 fixture hosts | node; the `inner` helper |
| Nix checks | `license` (P.1); `module-eval` (P.2, P.9); `leak-selftest`, `leak` (P.7, P.11); `router-golden` zero diff (P.5–P.7); every check in each group gate | capped `nix build` (gate) |
| Router stand-in / replay (`~/.cache/pi/router-g37/private.sh`) | P.5–P.7 change no decision: replay pass counts, stand-in plan/explicit counts, matrix throws unchanged vs P₀ | host archive of `566fd0d` (read-only `git dot archive`) |
| Private scans (outside the repo) | (a) host term set D over the candidate tree; (b) path fragments (`private-terms.sh`) | host evaluation, ≤ 20 GiB cap, pause flag |
| Git-level assertions | P.13 squash: tree equality, one commit, clone carries one commit | git |
| Host Layer B (spec §8.2) | W8: host gate, pluto comparison, home-file comparison, term scan with `expected = {}` | owner (O.2) |
| Live pi | N/A in automation — the only runtime change is a default the host overrides; a consumer smoke run is manual (Coverage gap) | — |
| VM tests | N/A — Home Manager only, no system change | — |

## Scenario coverage

| Scenario (spec §8.3 / §9 / brief) | Check |
|---|---|
| Router default names no host | `settings.test.ts` "defaults pin …" line 31 (P.5) + `neutral-hosts.test.ts` (P.6) |
| Tests that assert the default change with it, as listed differences | P.4 (refactor), P.5 (line 31) — listed below |
| Golden file updated for the change | `router-golden` (expected zero diff; P.5, P.6) |
| Fixtures name no real host | `neutral-hosts.test.ts` (P.6); `leak` LAN pattern (P.7) |
| Host unchanged at W8 | host `eval-assertions` `:9544` K-assertion + home-file comparison (O.2) |
| Spec/plans out; exclusion dropped | `leak` over `../.` (P.11) |
| Term scan beyond generic patterns | host `pi-economics-leaks` override + `private-terms.sh` (P.12) |
| Licences checked; flake licence allows patches | `license` (P.1) + NOTICE content review (Coverage gap: legal reading) |
| Squashed history; pre-squash refs kept until W8 | P.13 git assertions; `git rev-parse pre-squash` + bundle `git bundle verify` |
| README for consumers | `readme-example` (P.9) |
| LOGS.md wording | `token-meter` test on the legend (P.3) + `git grep -n 'tier up' -- packages` empty |
| retry empty nested attr | `module-eval` case `retry-settings-empty-attr` (P.2) |

## Properties

- **Pr1 (P.5)** `hostname(defaults().models["qwen-local"].health) = "localhost"`.
- **Pr2 (P.6)** `∀ u ∈ URLs(fixtures/*.json) ∪ URLs(defaults()): hostname(u) = "localhost" ∨ hostname(u) ends ".invalid" ∨ |hostname(u)| = 1`; `|fixtures| ≥ 2` (a moved directory cannot pass vacuously).
- **Pr3 (P.4)** expected probe URLs = `health(settings under test) + path`, for `base: "today"` (`TODAY_RAW`) and for defaults (`defaults()`).
- **Pr4 (P.7)** scanner: `∀` single-label host `h`, `|h| ≥ 2`, `h ≠ localhost`: `http(s)://h[:port]` followed by a non-host character or end of line ⇒ exit 1 "LAN host URL found"; near misses (`localhost`, one-letter hosts, dotted names, IPv4 loopback) ⇒ exit 0.
- **Pr5 (P.1)** `LICENSE` line 1 = `MIT License`; `∀ p ∈ packages/*/package.json: p.license = "MIT"`; `∀ d ∈ readDir patches: "## " + d ∈ lines(NOTICE)`.
- **Pr6 (P.2)** `∀` path `π ≠ []` with `settings at π = {}`: exactly one failed assertion `pi-economics: retry.settings.π …`; no empty set ⇒ none.
- **Pr7 (P.9)** `lines(README block after the marker) = lines(fixture)` and `failed "pi-economics:" (eval fixture) = []`.
- **Pr8 (P.11)** the leak check's source is the whole flake source (`checks/default.nix` has no `fileset.difference`).
- **Pr9 (P.13)** `tree(S) = tree(P_end) ∧ parents(S) = ∅ ∧ rev-list --count publish = 1 ∧ rev-list --all --count (clone --single-branch --no-tags publish) = 1`.
- **Host invariance (O.2)** rendered `~/.pi/agent/task-router/settings.json` at W8 = at the host's base tree (host K-assertion already pins its keys).

## Planted violations

| # | New check | Plant | Must FAIL | Red seen |
|---|---|---|---|---|
| PV1 | `license` | (natural) no `LICENSE` | `license`: "LICENSE missing" | [ ] |
| PV2 | `license` | `"license": "ISC"` in one `packages/*/package.json` (scratch) | names that file | [ ] |
| PV3 | `license` | delete the `## pi-retry` heading from NOTICE (scratch) | "NOTICE: no section for patches/pi-retry" | [ ] |
| PV4 | `retry-settings-empty-attr` | (natural) no assertion | `module-eval` FAIL `retry-settings-empty-attr` | [ ] |
| PV5 | same | assertion only for top-level keys (no recursion) with fixture `subagents.match = {}` | FAIL (the case has a two-level path too) | [ ] |
| PV6 | P.3 legend test | (natural) old legend | `token-meter` red | [ ] |
| PV7 | P.4 refactor | scratch copy: today fixture health → `http://x.invalid:1` | before P.4: `policy.test.ts` 2 red; after: 0 red | [ ] |
| PV8 | `neutral-hosts.test.ts` | (natural) today fixture | red, names `today-config.json` | [ ] |
| PV9 | same | `mv test/fixtures test/fixtures.x` (scratch) | red on `files.length ≥ 2`, not a vacuous pass | [ ] |
| PV10 | LAN pattern | (natural) selftest hits before the scan line exists | `leak-selftest` red | [ ] |
| PV11 | LAN pattern | scratch: drop the `localhost` filter | selftest red on the near-miss file | [ ] |
| PV12 | `leak` whole tree | (natural) docs still present | `leak` red listing `docs/specs/…`, `docs/plans/…` | [ ] |
| PV13 | `leak` whole tree | after P.11, scratch file `docs/plans/x.md` with a planted home path (printf-built) | `leak` red naming it | [ ] |
| PV14 | `readme-example` | (natural) no README | red | [ ] |
| PV15 | `readme-example` | change one option line in README only | red "README's nix block = fixture" | [ ] |
| PV16 | `readme-example` | fixture enables `taskRouter` without `actorSubagents` (scratch) | red "no failed assertion" | [ ] |
| PV17 | host term scan | before P.5 (base tree) | host check passes with 5 expected hits (control); after P.7 it fails with **only** "expected entries without a hit" (the 5 `earth` entries) | [ ] |
| PV18 | `private-terms.sh` | (natural) `AGENTS.md` before P.8 | lists `AGENTS.md` hits | [ ] |
| PV19 | P.13 clone test | scratch: clone without `--single-branch --no-tags` after tagging | count > 1 (proves the assertion can fail) | [ ] |

## Coverage gap (run by hand)

- **Legal reading** of `LICENSE`/`NOTICE` (owner): the check proves presence and consistency, not adequacy.
- **README prose** beyond the checked block; the flake-inputs block is exercised once by the consumer smoke test in P.13 (manual, scratch flake), not by CI.
- **Live router on a consumer machine** with no settings file: probes `http://localhost:11545`, finds nothing, routes on (covered by unit tests of `local down`, not by a live run).
- **Private-term completeness**: D plus `terms.txt` is the best list available; prose that identifies the owner without a term (e.g. a description of the owner's hardware) is caught only by reading. P.12 includes a skim of every changed public doc.
- **GitHub side** (O.1): repository settings, visibility, default branch — owner.
- **W8 Layer B** (O.2): the host's gate, home-file comparison and `nixos-rebuild test` — owner.

## Environment (every step)

```sh
# ~/.cache/pi/p/env.sh  (created in P.0; never committed)
source ~/.cache/pi/router-g37/env.sh          # XDG, cd main repo, o, cap, flag, nb, suite, gen, cm, TR, TM
C=$HOME/.cache/pi/p; P0=$(cat $C/P0 2>/dev/null)
WT=$HOME/.cache/pi/p-wt
if [ -d "$WT" ] && [ "${P_MAIN:-0}" != 1 ]; then      # Groups A/B in the worktree
  cd "$WT"; F="git+file://$WT?ref=p-publication"; Fp="path:$WT"
fi
nb() { flag; (ulimit -v $cap && exec timeout -s KILL 1800 nix build --no-link -L "$F#checks.x86_64-linux.$1" "${o[@]}"); }
```

```sh
# ~/.cache/pi/p/gate.sh <name>   (router gate with AC-lock instead of AC7, plus the private scans)
source ~/.cache/pi/p/env.sh
O=$C/$1; rm -rf $O; mkdir -p $O; exec > $O/result.txt 2>&1
git status --short --untracked-files=no | sed 's/^/WORKTREE /'
for ref in "$F" "$Fp"; do
  flag
  names=$( (ulimit -v $cap && exec timeout -s KILL 900 nix eval --json "$ref#checks.x86_64-linux" --apply builtins.attrNames "${o[@]}") ) &&
    names=$(jq -er '.[]' <<<"$names") || { echo "LISTING FAILED $ref"; continue; }
  [ -n "$names" ] || { echo "LISTING EMPTY $ref"; continue; }
  for c in $names; do
    flag
    if (ulimit -v $cap && exec timeout -s KILL 1800 nix build --no-link -L "$ref#checks.x86_64-linux.$c" "${o[@]}") > $O/$c.log 2>&1
    then echo "ok $c ($ref)"; else echo "FAILED $c ($ref)"; tail -n 15 $O/$c.log; fi
  done
done
flag
fmt --check $(git ls-files '*.nix') && echo "fmt ok" || echo "FAILED fmt"
git diff --quiet "$P0" HEAD -- flake.lock && echo "AC-lock ok" || echo "FAILED AC-lock"
bash ~/.cache/pi/router-g37/private.sh            # PL: replay / stand-in / matrix (compare with p0)
bash $C/private-terms.sh  > $O/private-terms.txt; echo "private-terms: $(grep -c . $O/private-terms.txt) hits (expected: $C/terms-expected.txt)"
bash $C/host-scan.sh "$F" > $O/host-scan.log 2>&1; grep -q 'denylist hits not in expected' $O/host-scan.log && echo "FAILED host-scan (new hits)" || echo "host-scan: no new hits"
echo "failures: $(grep -cE '^(FAILED|LISTING)' $O/result.txt)"; echo GATE-DONE
```

```sh
# ~/.cache/pi/p/host-scan.sh <flake ref>  — the host's term set D over a candidate tree (read-only use of the host)
source ~/.cache/pi/p/env.sh >/dev/null; flag
(ulimit -v $cap && exec timeout -s KILL 1800 nix build --no-link -L \
  "path:$HOME/projects/nixos/new#checks.x86_64-linux.pi-economics-leaks" \
  --override-input pi-economics "$1" --no-write-lock-file "${o[@]}")
```

```sh
# ~/.cache/pi/p/private-terms.sh — path fragments and identity bits that D does not hold.
# $C/terms.txt (private, one fixed string per line), e.g.: projects/nix, nixos/new, .cache/pi, git dot,
# router-g37, pluto-exec, the owner's user names, host names and e-mail (copy them from D by hand, P.0).
source ~/.cache/pi/p/env.sh >/dev/null
skip=(':!docs/specs' ':!docs/plans'); [ "${P_ALL:-0}" = 1 ] && skip=()
git grep -n -i -F -f $C/terms.txt -- . "${skip[@]}" | awk -F: '{print $1}' | sort | uniq -c
```

`P_ALL=1` from P.11 on (no exclusion). `terms-expected.txt` is empty at P.12.

## File structure

| Path | Change |
|---|---|
| `LICENSE`, `NOTICE` | new (P.1) |
| `checks/license/default.nix` | new (P.1); `checks/default.nix` +1 line |
| `modules/retry.nix`, `checks/module-eval/cases/retry.nix` | P.2 |
| `packages/token-meter/LOGS.md`, `core/analyse.ts`, `test/delegation.test.ts`; `packages/task-router/test/attempts.test.ts` (title) | P.3 |
| `packages/task-router/test/policy.test.ts` | P.4 |
| `packages/task-router/core/settings.ts`, `test/settings.test.ts`, `docs/pi-token-economics.md` (default line) | P.5 |
| `packages/task-router/test/neutral-hosts.test.ts` (new), `test/fixtures/today-config.json` | P.6 |
| `checks/leak/default.nix`, `packages/task-router/test/oracle/legacy-settings.ts` | P.7 |
| `AGENTS.md`, `docs/pi-economics.md`, `docs/pi-token-economics.md`, `flake.nix` (comment) | P.8 |
| `README.md`, `checks/module-eval/fixtures/readme-example.nix`, `checks/module-eval/cases/readme.nix`, `checks/module-eval/default.nix` | P.9 |
| spec §8.3/§9 amendments (in `docs/specs/…`, then archived) | P.10 |
| `checks/default.nix`; `git rm -r docs/specs docs/plans`; `AGENTS.md` leak bullet | P.11 |

## Tasks

Status of every task: `TODO`.

### Group A — independent (worktree `p-publication`)

#### P.0 — Read, preconditions, baseline · `TODO`

- [ ] Read "Files to read first".
- [ ] `git worktree add ~/.cache/pi/p-wt -b p-publication main`; `git rev-parse HEAD > ~/.cache/pi/p/P0`; write `env.sh`, `gate.sh`, `host-scan.sh`, `private-terms.sh`, `terms.txt` (from host D by hand: host names, user names, git name/e-mail/key; plus the fragments listed) — never inside a repository.
- [ ] Re-run the inventories and write the counts into the record: `git grep -n -F 'qwen3.8-27b:free'`; `git grep -n -i -w -e qwen -e qwen-cloud | wc -l`; `git grep -nE 'https?://[A-Za-z][A-Za-z0-9-]+(:[0-9]+)?([^A-Za-z0-9.:-]|$)' -- ':!docs/specs' ':!docs/plans' | grep -v '://localhost'` (expected at a67a11f: settings.ts:31, today-config.json:13, legacy-settings.ts:20, policy.test.ts:95,243,409, settings.test.ts:31, checks/leak/default.nix:75).
- [ ] Host check (read-only): `homes/pallon/default.nix` still sets `models.qwen-local.{model,health}` and `models.qwen-cloud.model`; `eval-assertions.nix` K-assertion present. Otherwise STOP → main.
- [ ] Baseline: `bash ~/.cache/pi/p/gate.sh p0` → failures 0 (host-scan passes with its 5 expected hits — PV17 control); keep `p0/result.txt` for PL comparison.

#### P.1 — Licence: `LICENSE`, `NOTICE`, check `license` · `TODO`

- [ ] **RED:** add `checks/license/default.nix` (S1) and `license = import ./license {inherit lib pkgs;};` in `checks/default.nix`; `git add`; `nb license` → "LICENSE missing" (PV1). [ ] red seen
- [ ] **GREEN:** `LICENSE` (S2), `NOTICE` (S3); `git add`; `nb license` green. Plants PV2, PV3 in scratch copies, each red, reverted. [ ] PV2 [ ] PV3
- [ ] **CLEAN:** alejandra on the new `.nix`; commit `license: MIT LICENSE, NOTICE for the patched upstreams, check license (P.1)`.

#### P.2 — retry: an empty nested settings set is an error (review-m6 Low) · `TODO`

- [ ] **RED:** case `retry-settings-empty-attr` (S4) in `checks/module-eval/cases/retry.nix`; `nb module-eval` → FAIL that case (PV4). [ ] red seen
- [ ] **GREEN:** `emptyPaths` + assertions in `modules/retry.nix` (S4); `nb module-eval` green (case count +1). PV5 in scratch. [ ] PV5
- [ ] **CLEAN:** option description gains "an empty attribute set is an error"; `docs/pi-economics.md` § retry one sentence; commit.

#### P.3 — "one tier up" → "one level up" (review-g5 nit) · `TODO`

- [ ] **RED:** in `packages/token-meter/test/delegation.test.ts` next to `:201`, assert the legend: `assert.match(sec, /escalations = re-spawns one level up \(D7\)/)` → red (PV6). [ ] red seen
- [ ] **GREEN:** `core/analyse.ts:567` legend: `escalations = re-spawns one level up (D7) from this cell's failed tasks`; `LOGS.md:109` meaning column: `re-spawn one level above the failed attempt (the higher of its planned and ran member's levels on ability)`; `task-router/test/attempts.test.ts:37` title `… is raised one level` (title only; behaviour unchanged — reason: wording after D7). Suites green; `nb token-meter`, `nb typecheck-token-meter`, `nb log-contract`, `nb home-files`.
- [ ] **CLEAN:** `git grep -n 'tier up' -- packages` empty; commit. Group A gate: `bash ~/.cache/pi/p/gate.sh pA` → failures 0.

### Group B — defaults (after G6's T6.1; rebase `p-publication` onto `main`)

#### P.4 — Probe-URL tests derive from the settings under test (refactor) · `TODO`

- [ ] **Before evidence (PV7):** scratch copy of `TR`; set the today fixture's health to `http://x.invalid:1`; `suite` → `policy.test.ts` tests at `:95`, `:243` red. Record.
- [ ] **Refactor** (S5): `:95`, `:243` use `TODAY_HEALTH` (from `TODAY_RAW`); `:409` uses `DEFAULT_HEALTH` (from `defaults()`). Suite green, same count.
- [ ] **After evidence:** the same scratch plant → policy 0 red. [ ] PV7 seen both ways
- [ ] Commit `test(P.4): probe URLs from the settings under test`. (Existing tests preserved: same assertions, the expectation derived instead of a literal.)

#### P.5 — Neutral default health URL · `TODO`

- [ ] **RED:** `settings.test.ts:31` → `assert.equal(d.models["qwen-local"].health, "http://localhost:11545");` (listed difference, §8.3) → red. [ ] red seen
- [ ] **GREEN:** `settings.ts:31` `health: "http://localhost:11545"`. `inner` (suite, `task-router`, `typecheck-task-router`, `router-golden`). Golden: `gen $TR | diff - <(grep -v '^#' checks/router-golden/golden.txt)` empty (zero diff expected; any diff: STOP → main). PL (`private.sh`) equal to `p0`.
- [ ] **CLEAN:** `docs/pi-token-economics.md:65` "health `http://<host>:11545`" → "health `http://localhost:11545` by default"; commit `router(P.5): neutral default health URL (spec §8.3)`.

#### P.6 — Fixtures name no machine · `TODO`

- [ ] **RED:** `test/neutral-hosts.test.ts` (S6) → red naming `today-config.json` (PV8); PV9 in scratch. [ ] PV8 [ ] PV9
- [ ] **GREEN:** `today-config.json:13` → `"http://localhost:11545"`. Suite green (P.4 made the policy tests follow); golden zero diff; PL equal.
- [ ] Commit.

#### P.7 — Leak scanner: LAN host URLs; the last two sites · `TODO`

- [ ] **RED:** selftest hits (S7) → `nb leak-selftest` red (PV10). [ ] red seen
- [ ] **GREEN 1:** the LAN scan (S7), the new near-miss lines, and the existing near miss `git+https://host/repo` → `git+https://h/repo` (the new pattern would flag `host`; the near miss still tests "git+https is not git+ssh"); `nb leak-selftest` green; PV11 in scratch. [ ] PV11
- [ ] **Natural red 2:** `nb leak` → red on exactly `test/oracle/legacy-settings.ts:20`. Any other site: STOP. [ ] seen
- [ ] **GREEN 2:** oracle `:20` → `"http://localhost:11545"` and its header line 1 gains `; P.7: localHealthUrl neutralized (no reader)`. Prove "no reader": `git grep -n 'localHealthUrl' -- packages/task-router | grep -v -e core/settings.ts -e test/settings.test.ts -e test/oracle/legacy-` empty (measured empty at a67a11f; `core/settings.ts` and `settings.test.ts` handle the legacy *file* key, not the oracle's field). `nb leak` green; suite and golden unchanged.
- [ ] Commit (one commit, both greens). Group B gate `pB` → failures 0; host-scan: fails with only the 5 "expected entries without a hit" (PV17). [ ] PV17

### Group C — docs and the publication tree (after G7's T7.1; fast-forward `main` to `p-publication`, then `P_MAIN=1` on `main`; remove the worktree)

#### P.8 — Public docs without the owner's paths · `TODO`

- [ ] **RED:** `bash ~/.cache/pi/p/private-terms.sh` lists `AGENTS.md` (`projects/nix`, `.cache/pi`) (PV18). [ ] red seen
- [ ] **GREEN** (S8): `AGENTS.md` commands use `F=git+file://$PWD` and a generic sandbox note; design/plans paragraph → provenance (D2, D13); `docs/pi-economics.md:6-7`, `docs/pi-token-economics.md:5` → provenance sentence; `flake.nix:5-6` comment drops the plan path. `private-terms.sh` (with the docs dirs still skipped) → 0 hits outside `terms-expected.txt`.
- [ ] Skim every public doc (`AGENTS.md`, `docs/*.md`, `packages/*/README.md`, `packages/token-meter/LOGS.md`, `skills/*/SKILL.md`) for identifying prose; list findings in the record. Commit.

#### P.9 — README for consumers · `TODO`

- [ ] **RED:** case file `checks/module-eval/cases/readme.nix` (S9) added to `caseFiles`, fixture `checks/module-eval/fixtures/readme-example.nix`; `nb module-eval` red (no README) (PV14). [ ] red seen
- [ ] **GREEN:** `README.md` (S10) with the marker and the block equal to the fixture; green. PV15, PV16 in scratch. [ ] PV15 [ ] PV16
- [ ] Commit.

#### P.10 — Spec amendments; archive for the host · `TODO`

- [ ] Append to the spec (amendment, dated): §8.3 — the LAN-host pattern (D5), the zero golden diff, the oracle edit (D6), docs moved to the host (D1), plans after P live in the host (D13); §9 — F kept where functional (D10, per OQ7's answer). Commit.
- [ ] Fill this plan's Execution Record up to P.10; commit.
- [ ] Archive: `A=~/.cache/pi/p/archive; mkdir -p $A/docs && git archive HEAD docs/specs docs/plans | tar -x -C $A`; `(cd $A && find docs -type f | sort | xargs sha256sum) > $A/SHA256SUMS`; `git bundle create $A/pi-economics-pre-squash.bundle main --tags` (re-created in P.13 after the tag); `git bundle verify`.
- [ ] Host citation inventory → `$A/host-citations.txt` (S11 list re-run with grep, read-only). Send main: archive path, SHA256SUMS, the inventory, the host task H1 (S11).

#### P.11 — The leak check scans the whole tree; the docs leave · `TODO`

- [ ] **RED:** `checks/default.nix`: delete `leakSrc`, `leak = leakLib.check ../.;` → `nb leak` red listing only `docs/specs/…` and `docs/plans/…` files (PV12). [ ] red seen
- [ ] **GREEN:** `git rm -r docs/specs docs/plans`; `AGENTS.md` leak bullet: "scans every tracked file"; `nb leak` green. PV13 in scratch (printf-built path, never committed). [ ] PV13
- [ ] Commit `P.11: the leak check scans every file; spec and plans moved to the author's system configuration`.

#### P.12 — Final gate and private scans · `TODO`

- [ ] `P_ALL=1 bash ~/.cache/pi/p/gate.sh p-final` → failures 0; `private-terms` 0 hits; host-scan: only the 5 "expected entries without a hit" (no "denylist hits not in expected").
- [ ] `git log -1 --format=%H > ~/.cache/pi/p/P_END`. Record (S12) into `~/.cache/pi/p/archive/docs/plans/2026-10-28-p-publication-plan.md` (the archived copy; the flake no longer holds it); update SHA256SUMS; tell main.

### Group D — squash and publication

#### P.13 — Squash onto `publish` (agent) · `TODO`

- [ ] S13: tag `pre-squash`, `commit-tree`, branch `publish`; assertions Pr9; PV19 in scratch. [ ] PV19
- [ ] `git log -1 --format='%an <%ae>|%cn <%ce>|%s' publish` → as OQ11 decided; `private-terms.sh` over `git ls-tree -r --name-only publish` content (`git grep … publish`) → 0.
- [ ] Gate on the squashed ref: `F="git+file://$PWD?ref=publish"` — every check `ok` (same tree ⇒ same store paths; fast).
- [ ] Manual consumer smoke (coverage gap): a scratch flake in `$TMPDIR` with README's inputs block pointing at `git+file://…?ref=publish`, one `homeConfigurations.u` with the README module; `nix eval .#homeConfigurations.u.activationPackage.drvPath` succeeds (cap 20 GiB).
- [ ] Re-create the bundle (`main --tags`, now with `pre-squash`); report S to main. Do not push.

#### O.1 — GitHub (owner) · `TODO`

- [ ] Create `GRBurst/pi-economics` (public, empty: no README/LICENSE/.gitignore from GitHub).
- [ ] `git remote add origin git@github.com:GRBurst/pi-economics.git && git push origin publish:main` — never `--tags`, `--all` or `--mirror` (they would publish `pre-squash` and the history).
- [ ] `nix flake metadata github:GRBurst/pi-economics --json | jq -r .locked.rev` = S.

#### O.2 — W8 in the host (owner; an agent may prepare the diff) · `TODO`

See S14. Lock moves to S; host gate (runner-gate), pluto comparison (note: `flake.lock` is in pluto's snapshot, so pluto's toplevel moves as with every lock move — host AGENTS.md), home-file comparison (`task-router/settings.json` unchanged), `scripts/pluto-next-release.sh` once (host rule after a lock update), `nixos-rebuild test`, commit.

#### O.3 — Local branches after W8 (owner) · `TODO`

- [ ] `git branch -m main pre-squash-main && git branch main publish && git checkout main && git branch -u origin/main` (the tag `pre-squash` and the bundle stay; OQ11).
- [ ] From now on agents commit on `main` (= S + …); each host lock move needs the owner's push first.

## Snippets

### S1 — `checks/license/default.nix`

```nix
# The licence (spec §8.3): LICENSE is MIT, every package declares MIT, and
# NOTICE has a section per patched upstream (patches/<input>).
{
  lib,
  pkgs,
}: let
  root = ../..;
  lines = f: lib.splitString "\n" (builtins.readFile f);
  has = p: builtins.pathExists (root + p);
  pkgDirs = lib.attrNames (lib.filterAttrs (_: t: t == "directory") (builtins.readDir (root + "/packages")));
  jsons = lib.filter (d: has "/packages/${d}/package.json") pkgDirs;
  licenseOf = d: (builtins.fromJSON (builtins.readFile (root + "/packages/${d}/package.json"))).license or null;
  patched = lib.attrNames (builtins.readDir (root + "/patches"));
  notice = lib.optionals (has "/NOTICE") (lines (root + "/NOTICE"));
  failures =
    lib.optional (!has "/LICENSE") "LICENSE missing"
    ++ lib.optional (has "/LICENSE" && lib.head (lines (root + "/LICENSE")) != "MIT License") "LICENSE: line 1 is not 'MIT License'"
    ++ lib.optional (jsons == []) "no packages/*/package.json found"
    ++ map (d: "packages/${d}/package.json: license ${builtins.toJSON (licenseOf d)}, want \"MIT\"") (lib.filter (d: licenseOf d != "MIT") jsons)
    ++ lib.optional (!has "/NOTICE") "NOTICE missing"
    ++ map (d: "NOTICE: no section for patches/${d} (a line '## ${d}')") (lib.filter (d: !lib.elem "## ${d}" notice) patched);
in
  pkgs.runCommand "license" {
    report = lib.concatStringsSep "\n" failures;
    passAsFile = ["report"];
  } ''
    if [ -s "$reportPath" ]; then cat "$reportPath" >&2; echo >&2; exit 1; fi
    echo "license: MIT, ${toString (lib.length jsons)} packages, ${toString (lib.length patched)} upstreams in NOTICE"
    touch $out
  ''
```

### S2 — `LICENSE`

The standard MIT text, line 1 `MIT License`, line 3 `Copyright (c) 2026 GRBurst` (OQ10).

### S3 — `NOTICE`

```
pi-economics is MIT-licensed (LICENSE). It builds three upstream extensions
from their sources and applies the patches under patches/<input>/ to them.
The patches are derived from those projects and are distributed under their
licences:

## pi-actor-subagents
https://github.com/fdietze/pi-actor-subagents — MIT, Copyright (c) 2026 Felix Dietze

## pi-infinite-context
https://github.com/fdietze/pi-infinite-context — MIT, Copyright (c) 2026 Felix Dietze

## pi-retry
https://github.com/monotykamary/pi-retry — MIT (package.json, README), author Tom X Nguyen
```

### S4 — retry assertion and case

```nix
# modules/retry.nix, let:
  # Paths of empty attribute sets below settings: they would emit no `set`.
  emptyPaths = path: v:
    if lib.isAttrs v
    then
      if v == {}
      then [path]
      else lib.concatLists (lib.mapAttrsToList (k: emptyPaths (path ++ [k])) v)
    else [];
# config (inside mkIf cfg.enable):
    assertions = map (p: {
      assertion = false;
      message = "pi-economics: retry.settings.${lib.concatStringsSep "." p} is an empty attribute set; it sets nothing (give it a leaf or remove it)";
    }) (lib.concatLists (lib.mapAttrsToList (k: emptyPaths [k]) cfg.settings));
```

```nix
# checks/module-eval/cases/retry.nix
  # (P.2, review-m6 Low) An empty set below settings is an error naming its path; leaves beside it are fine.
  retry-settings-empty-attr = let
    c = eval ".pi/agent" {settings = {maxDelayMs = 1; subagents = {}; a.b = {};};} {};
    ok = eval ".pi/agent" {settings = {subagents.enabled = true;};} {};
  in
    eq "failed" (failed "pi-economics: retry.settings" c) [
      "pi-economics: retry.settings.a.b is an empty attribute set; it sets nothing (give it a leaf or remove it)"
      "pi-economics: retry.settings.subagents is an empty attribute set; it sets nothing (give it a leaf or remove it)"
    ]
    ++ eq "no failure without an empty set" (failed "pi-economics: retry.settings" ok) [];
```

### S5 — P.4 (`policy.test.ts`)

```ts
import { TODAY_RAW } from "./harness.ts";           // if not yet imported
const TODAY_HEALTH = TODAY_RAW.models["qwen-local"].health as string;
const DEFAULT_HEALTH = defaults().models["qwen-local"].health as string;
// :95
assert.deepEqual(h.urls, [`${TODAY_HEALTH}/health`]); // one probe for both spawns
// :243
assert.ok(h.urls.every((u) => u.startsWith(`${TODAY_HEALTH}/`)), h.urls.join());
// :409
assert.ok(x.urls.every((u) => u.startsWith(`${DEFAULT_HEALTH}/`)), x.urls.join());
```

### S6 — `test/neutral-hosts.test.ts`

```ts
// P.6 (spec §8.3): fixtures and defaults name no machine. A neutral host is localhost, a reserved *.invalid name or one letter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { defaults } from "../core/settings.ts";

const urls = (v: unknown): string[] =>
  typeof v === "string" ? (/^https?:\/\//.test(v) ? [v] : [])
  : Array.isArray(v) ? v.flatMap(urls)
  : v !== null && typeof v === "object" ? Object.values(v).flatMap(urls) : [];
const neutral = (u: string): boolean => { const h = new URL(u).hostname; return h === "localhost" || h.endsWith(".invalid") || h.length === 1; };

test("fixtures and defaults: every URL's host is localhost, *.invalid or one letter", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 2, `fixtures: ${files.join()}`);
  const bad = files.flatMap((f) => urls(JSON.parse(readFileSync(new URL(f, dir), "utf8"))).filter((u) => !neutral(u)).map((u) => `${f}: ${u}`));
  bad.push(...urls(defaults()).filter((u) => !neutral(u)).map((u) => `defaults(): ${u}`));
  assert.deepEqual(bad, []);
});
```

### S7 — LAN host URL in `checks/leak/default.nix`

```bash
      # A URL whose host is one bare label of two or more characters other
      # than localhost names a machine on a private network (one-letter test
      # hosts such as http://h:1 pass, as /home/u/ does).
      lan='https?://[A-Za-z][A-Za-z0-9-]+(:[0-9]+)?([^A-Za-z0-9.:-]|$)'
      rc=0
      hits=$(grep -rnoE --exclude-dir=.git -- "$lan" "$root") || rc=$?
      case $rc in
        0 | 1) ;;
        *)
          echo "pi-economics-leak-scan: grep failed ($rc) on the LAN host URL pattern" >&2
          exit 2
          ;;
      esac
      hits=$(printf '%s\n' "$hits" | grep -vE '://localhost([^A-Za-z0-9.-]|$)' | grep -v '^$' || true)
      if [ -n "$hits" ]; then
        printf '%s\n' "$hits"
        echo "pi-economics-leak-scan: LAN host URL found (lines above)" >&2
        status=1
      fi
```

Selftest additions (built with printf so the file stays clean):

```bash
    hit "LAN host URL" "$(printf 'http://%s:%s/health' myhost 8080)"
    hit "LAN host URL" "$(printf '"https://%s"' nas)"
    hit "LAN host URL" "$(printf 'see http://%s' boxname)"
    # near misses (append to the near/f.txt printf): 'http://localhost:11545/health' 'http://h:1' 'http://local.invalid:11545'
    #   'https://github.com/x/y' 'http://127.0.0.1:8080'; and 'git+https://host/repo' becomes 'git+https://h/repo'
```

### S8 — provenance paragraph (README and AGENTS.md)

> Comments cite the design record and the milestone plans (`spec §n`, decisions `D…`, tasks `T…`, `M…`, plans by name). They were written while the components moved out of the author's system configuration and are kept there, not in this repository; the citations are provenance, not required reading. The module contract is `docs/pi-economics.md`.

`AGENTS.md` commands: `F=git+file://$PWD`, and "if the sandbox denies `~/.cache/nix`, point `XDG_CACHE_HOME`/`XDG_DATA_HOME` at a writable cache dir". Plans: "This repository holds no plans; the author keeps them with his system configuration" (D13).

### S9 — `checks/module-eval/cases/readme.nix`

```nix
# (P.9) README's Home Manager example is the fixture, line by line, and the fixture evaluates without a failed assertion.
{
  lib,
  hm,
  expect,
}: let
  readme = lib.splitString "\n" (builtins.readFile ../../../README.md);
  fixture = lib.splitString "\n" (builtins.readFile ../fixtures/readme-example.nix);
  marker = "<!-- checked: checks/module-eval/fixtures/readme-example.nix -->";
  at = lib.lists.findFirstIndex (l: l == marker) null readme;
  rest = lib.drop (at + 2) readme; # the marker, then the "```nix" fence
  end = lib.lists.findFirstIndex (l: l == "```") (lib.length rest) rest;
  block = lib.take end rest;
in {
  readme-example =
    expect.holds "README has the marker" (at != null)
    ++ lib.optionals (at != null) (expect.eq "README's nix block = fixture" block (lib.init fixture)) # the fixture ends with a newline
    ++ expect.eq "no failed assertion" (expect.failed "pi-economics:" (hm.eval (import ../fixtures/readme-example.nix))) [];
}
```

(Implementer: check `lib.lists.findFirstIndex` exists in the locked nixpkgs; else a `foldl'` index scan. Add `./cases/readme.nix` to `caseFiles`.)

### S10 — `README.md` outline

1. One paragraph: what pi-economics is (the pi coding agent's token-economics extensions as Home Manager components).
2. Components table (from `docs/pi-economics.md`): actorSubagents, tokenMeter, analysisSkill, cacheLifecycle, experiments, taskRouter, infiniteContext, retry, bench, piSettings — one line each.
3. Use: flake input (`github:GRBurst/pi-economics`, `inputs.nixpkgs.follows`, `home-manager.follows`, optional `follows` for the three upstreams), `imports = [inputs.pi-economics.homeModules.default];`.
4. The checked block (marker + ```` ```nix ```` + fixture), e.g. enable `actorSubagents`, `tokenMeter`, `taskRouter` with `settings.models."qwen-local" = { model = "local/qwen"; health = "http://localhost:11545"; };` — the local member is optional; without a server the router routes on.
5. Requirements: pi (version), Home Manager; Linux x86_64 checks.
6. Development: checks loop (from `AGENTS.md`), Alejandra.
7. Provenance paragraph (S8). 8. Licence (MIT; NOTICE for the patched upstreams).

### S11 — host task H1 (main) and the citation inventory

H1: copy `archive/docs/specs/*` → host `docs/specs/`, `archive/docs/plans/*` → host `docs/plans/` (verbatim names, no clash: checked 2026-10-28); `docs/README.md` rows for each; host `docs/pi-token-economics.md:21,38,41` point to the host paths. Host specs/plans are append-only: the citations inside existing host plans are not rewritten; the README rows and `docs/pi-token-economics.md` resolve them.

Citations measured 2026-10-28 (grep, read-only): `docs/README.md:45,67`; `docs/pi-token-economics.md:15,21,38,41`; `docs/specs/2026-10-17-task-router-abilities-design.md:31` (`~/projects/nix/pi-economics/docs/specs/…`); `docs/plans/2026-10-17-task-router-abilities-plan.md:2392`; `docs/plans/2026-10-25-pi-economics-wiring-plan.md:7,1767,1772` and its `spec §` references; `docs/system-reference.md:278-279`; `docs/pi-extensions-sandbox-followup.md:114,144,511` (host plan, unaffected); `checks/pi-task-router-replay/default.nix:7,11`, `host-replay-defaults.test.ts:4`; `checks/pi-economics-leaks.nix:1-12` (comment and `skip`); `homes/pallon/default.nix:163,176,209,254` (host plan, unaffected). P.10 re-runs: `grep -rnE 'pi-economics.{0,40}(spec|plan)|router-g3-g7|2026-10-12-pi-economics-design|pi-economics/docs/' --exclude-dir=ref ~/projects/nixos/new`.

### S12 — Execution Record skeleton (in the archived copy)

Table per task (commit, red seen, deviation); gates `p0`, `pA`, `pB`, `p-final` (counts, failures); PL equal to `p0`; golden diff (expected none); host-scan result lines; private-terms 0; P_END; S; skim findings; OQ answers.

### S13 — squash

```sh
cd ~/projects/nix/pi-economics
P_END=$(cat ~/.cache/pi/p/P_END); [ "$(git rev-parse main)" = "$P_END" ] || { echo "main moved"; exit 1; }
git tag pre-squash "$P_END"
S=$(git -c commit.gpgsign=false commit-tree "$P_END^{tree}" -m "pi-economics: first public release")
git branch publish "$S"
git diff --quiet "$P_END" publish && [ "$(git rev-list --count publish)" = 1 ] && [ -z "$(git log -1 --format=%P publish)" ] && echo "Pr9 local ok"
rm -rf "$TMPDIR/pub" && git clone -q --single-branch --no-tags --branch publish "file://$PWD" "$TMPDIR/pub" &&
  [ "$(git -C "$TMPDIR/pub" rev-list --all --count)" = 1 ] && echo "Pr9 clone ok"
```

### S14 — W8 host diff (owner; for main to prepare)

- `flake.nix:160-162`: `url = "github:GRBurst/pi-economics";` active; `# url = "git+file:///…?ref=main";` as the comment (spec §9.1).
- `flake.lock`: `nix flake lock --update-input pi-economics` → rev S (only that node moves; check with `jq`).
- `checks/pi-economics-leaks.nix`: `skip = [];` and `expected = {};` with the comment "P (pi-economics S): no hit expected"; the header's "until P" sentences become past tense.
- `AGENTS.md` (host): the `pi-economics` input bullet and the routing bullet ("a `git+file` path on andromeda only until W8" → the GitHub input; the spec/plans now in `docs/specs`, `docs/plans`).
- `docs/pi-token-economics.md:15`: the input line.
- Layer B: gate; pluto comparison (pluto's toplevel moves through the snapshot's `flake.lock`, as at every lock move; no pluto home change); home-file comparison: only store paths of components whose code changed since the old lock, `task-router/settings.json` text identical; term scan green with `expected = {}`; `scripts/pluto-next-release.sh` once; `nixos-rebuild test --flake path:…#andromeda`; commit.

## Open questions (each with a recommended answer; the plan follows the recommendation)

- **OQ1 Scrub or move the spec and plans?** *Recommend:* move verbatim into the host's `docs/specs/` and `docs/plans/` (D1; main commits H1). Alternatives: a separate private archive repo; a scrubbed public copy of the spec only.
- **OQ2 Code-comment citations (`spec §n`, `D…`, `T…`).** *Recommend:* keep; one provenance paragraph (D2, S8).
- **OQ3 Where do plans go after P?** *Recommend:* the host's `docs/plans/` (D13). Alternative: in the flake, hand-scrubbed, caught by the host term scan at each lock move.
- **OQ4 Neutral health default.** *Recommend:* `http://localhost:11545` (D3).
- **OQ5 Edit the frozen oracle's `localHealthUrl` literal?** *Recommend:* yes, with a header note (D6, gate VIOLATION 1).
- **OQ6 Add the generic "LAN host URL" pattern to the in-flake leak check (a §8.3 amendment)?** *Recommend:* yes (D5).
- **OQ7 F after P** (router tests, `today` rollback fixture, golden `select today` lines, `token-meter/core/levels.ts:15`, `LOGS.md:154`). *Recommend:* keep; amend §9's "nothing published names the dead free model" to "no default or arm names it" (gate VIOLATION 2).
- **OQ8 The bench's `agentsOff` default `<agentSrc>/notes/2026-10-03-AGENTS.md.before`.** *Recommend:* keep (identifies nobody; changing it needs a host `bench.agentsBaseline` at W8). Alternative: neutral default + W8 sets it.
- **OQ9 retry empty nested set:** *Recommend:* assertion (D9). Alternatives: warning; docs only.
- **OQ10 Licence and holder.** *Recommend:* MIT, `Copyright (c) 2026 GRBurst`, NOTICE (D8). Owner may prefer a real name.
- **OQ11 Squash identity and pre-squash retention.** *Recommend:* author/committer = the repo's configured identity (`GRBurst <GRBurst@protonmail.com>`, already on all 214 commits) — or GitHub's noreply address if the owner prefers; keep tag `pre-squash`, branch `pre-squash-main` and the bundle indefinitely (archived records cite pre-squash hashes), not only until W8.
- **OQ12 Start Group A now in a worktree, Group B after T6.1, Group C after T7.1?** *Recommend:* yes. If G6 is far off, main may let Group B land first and T6.1 rebase.
- **OQ13 Private scan through the host check with `--override-input` (evaluates the host's configurations for D; read-only on the host; ≤ 20 GiB cap; pause flag).** *Recommend:* yes, at `p0`, `pB` and `p-final` only.
- **OQ14 README example pinned by a module-eval case.** *Recommend:* yes (D12).
- **OQ15 Fold the analysis report legend and the attempts test title into the LOGS nit (P.3)?** *Recommend:* yes.
- **OQ16 Keep `AGENTS.md` in the public repository (rewritten generic)?** *Recommend:* yes; it is useful to contributors' agents.

# Execution Record

(empty — filled by the implementer; from P.12 on in the archived copy, see S12)
