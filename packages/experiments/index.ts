// experiments: one fractional-factorial arm per main session:
// design + explore/exploit assignment (core/design.ts, core/assign.ts), the
// add-ons that set and read back its levers (addons/), the assignment on
// pi-economics' internal channel (core/channel.ts); a child runs its root's
// arm. Opt-in: inert without <agentDir>/experiments/settings.json.
// Thin shell; all logic lives in ./core/shell.ts.
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardSingleCopy } from "./core/runtime-guard.ts";
import { install, type PiLike } from "./core/shell.ts";

export default function experiments(pi: ExtensionAPI): void {
  guardSingleCopy(pi, "experiments", fileURLToPath(import.meta.url), (p) => install(p as unknown as PiLike, { agentDir: getAgentDir() }));
}
