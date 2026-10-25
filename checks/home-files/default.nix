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
        cacheLifecycle.enable = true;
        experiments.enable = true;
        # (M6.16)
        infiniteContext = {
          enable = true;
          reminders = {
            overrides."example/model-a" = {
              startTokens = 200000;
              everyTokens = 50000;
            };
            prices."example/model-a" = {
              w = 5;
              r = 0.2;
            };
          };
        };
        retry.enable = true;
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
    # cacheLifecycle and experiments: the extensions pi loads.
    for e in ${pe.extensions.cache-lifecycle.path} ${pe.extensions.experiments.path}; do
      for f in package.json index.ts core/shell.ts; do
        [ -f "$e/$f" ] || { echo "FAIL ${dir}: $e lacks $f" >&2; exit 1; }
      done
    done
    # cacheLifecycle's op, through the script the activation entry runs.
    printf '{"theme":"dark"}\n' >"$TMPDIR/settings.json"
    ${lib.getExe pe.piSettings.package} "$TMPDIR/settings.json" 2>/dev/null
    jq -e '. == {theme: "dark", cacheWarming: "idle"}' "$TMPDIR/settings.json" >/dev/null || { echo "FAIL ${dir}: settings.json after the op: $(cat "$TMPDIR/settings.json")" >&2; exit 1; }
    # (M6.16) infiniteContext: the extension pi loads, and the rendered file
    # accepted by the extension's own parser (an invalid file is rejected whole).
    ic=${pe.extensions.infinite-context.path}
    for f in index.ts settings.ts; do
      [ -f $ic/$f ] || { echo "FAIL ${dir}: infinite-context lacks $f" >&2; exit 1; }
    done
    node --experimental-strip-types --input-type=module -e "
      import { readFileSync } from 'node:fs';
      import { parseSettingsWithError } from '$ic/settings.ts';
      const r = parseSettingsWithError(readFileSync(process.argv[1], 'utf8'));
      if (r.error !== undefined) { console.error(r.error); process.exit(1); }
    " ${c.home.file."${dir}/infinite-context/settings.json".source} || { echo "FAIL ${dir}: infinite-context rejects its settings.json" >&2; exit 1; }
    # retry: the repository, whose package.json names the entry point; the
    # stale package entries go.
    rt=${pe.extensions.pi-retry.path}
    jq -e '.pi.extensions == ["./retry.ts"]' $rt/package.json >/dev/null && [ -f $rt/retry.ts ] || { echo "FAIL ${dir}: pi-retry entry point" >&2; exit 1; }
    printf '{"packages":["https://github.com/monotykamary/pi-retry","git:github.com/monotykamary/pi-retry","npm:x"]}\n' >"$TMPDIR/retry.json"
    ${lib.getExe pe.piSettings.package} "$TMPDIR/retry.json" 2>/dev/null
    jq -e '.packages == ["npm:x"]' "$TMPDIR/retry.json" >/dev/null || { echo "FAIL ${dir}: settings.json after ops.retry: $(cat "$TMPDIR/retry.json")" >&2; exit 1; }
    echo "ok ${dir}"
  '';
in
  pkgs.runCommand "home-files" {nativeBuildInputs = [pkgs.gnugrep pkgs.diffutils pkgs.jq pkgs.nodejs];} ''
    set -euo pipefail
    ${lib.concatMapStrings case dirs}
    touch $out
  ''
