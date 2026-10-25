// experiments: one fractional-factorial arm per main session (spec §5.6):
// design + explore/exploit assignment (core/design.ts, core/assign.ts), spawn
// inheritance for children, factor flags for the other extensions
// (`globalThis.__piExperimentsApi_v1`). Thin shell; all logic lives in ./core/shell.ts.
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSettings } from "./core/settings.ts";
import { install, type PiLike } from "./core/shell.ts";

export default function experiments(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  install(pi as unknown as PiLike, { agentDir, settings: loadSettings(join(agentDir, "experiments", "settings.json")) });
}
