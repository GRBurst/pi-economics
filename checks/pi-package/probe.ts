// A probe extension for the pi-package checks: at session_shutdown, after
// every session_start handler has run (a tool registered there included), it
// writes the names of the tools pi holds to $PROBE_OUT as {"tools": [...]}.
// In `pi -p` without a model key pi fires session_start, input and
// session_shutdown only; a runtime is stale after its shutdown, so the probe
// reads the tools in the handler, not later.
import { writeFileSync } from "node:fs";

export default function probe(pi: any): void {
  pi.on("session_shutdown", () => {
    writeFileSync(process.env.PROBE_OUT!, JSON.stringify({ tools: pi.getAllTools().map((t: any) => t.name) }));
  });
}
