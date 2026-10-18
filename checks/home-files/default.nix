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
