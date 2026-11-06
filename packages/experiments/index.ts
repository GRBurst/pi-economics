// experiments: one fractional-factorial arm per main session:
// design + explore/exploit assignment (core/design.ts, core/assign.ts), spawn
// inheritance for children, factor flags for the other extensions
// (`globalThis.__piExperimentsApi_v1`). Opt-in: inert without <agentDir>/experiments/settings.json.
// Thin shell; all logic lives in ./core/shell.ts.
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { install, type PiLike } from "./core/shell.ts";

export default function experiments(pi: ExtensionAPI): void {
  install(pi as unknown as PiLike, { agentDir: getAgentDir() });
}
