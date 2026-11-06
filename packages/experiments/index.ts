// experiments: one fractional-factorial arm per main session:
// design + explore/exploit assignment (core/design.ts, core/assign.ts), spawn
// inheritance for children, factor flags for the other extensions
// (`globalThis.__piExperimentsApi_v1`). Opt-in: inert without <agentDir>/experiments/settings.json.
// Thin shell; all logic lives in ./core/shell.ts.
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardSingleCopy } from "./core/runtime-guard.ts";
import { install, type PiLike } from "./core/shell.ts";

export default function experiments(pi: ExtensionAPI): void {
  guardSingleCopy(pi, "experiments", fileURLToPath(import.meta.url), () => install(pi as unknown as PiLike, { agentDir: getAgentDir() }));
}
