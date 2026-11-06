// cache-lifecycle: prompt-cache aware elision and TTL.
// Thin shell; all logic lives in ./core/shell.ts.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardSingleCopy } from "./core/runtime-guard.ts";
import { loadSettings } from "./core/settings.ts";
import { install, type PiLike } from "./core/shell.ts";

export default function cacheLifecycle(pi: ExtensionAPI): void {
  guardSingleCopy(pi, "cache-lifecycle", fileURLToPath(import.meta.url), () => {
    const agentDir = getAgentDir();
    install(pi as unknown as PiLike, { agentDir, settings: loadSettings(join(agentDir, "cache-lifecycle", "settings.json")) });
  });
}
