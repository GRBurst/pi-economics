// The load-order check's probe (./default.nix), loaded from several places
// at once: a registry entry, the auto-discovered directory, a settings.json
// entry of the owner's and an installed package. At session_start it asks
// each guarded component whether it has claimed its single copy: a copy
// claims at its own session_start (runtime-guard.ts), and its listener fills
// `owner` of a later claim from another path without side effects. A
// component that has claimed started before the probe. It appends
// {"name": <this file's path>, "claimed": [...]} to $PROBE_OUT.
import { appendFileSync } from "node:fs";

const NAME = new URL(import.meta.url).pathname;
const GUARDED = ["experiments", "token-meter", "cache-lifecycle"];

export default function probe(pi: any): void {
	pi.on("session_start", () => {
		const claimed = GUARDED.filter((component) => {
			const claim: { component: string; path: string; owner?: string } = { component, path: NAME };
			pi.events.emit("pi-economics:claim:v1", claim);
			return claim.owner !== undefined;
		});
		appendFileSync(process.env.PROBE_OUT!, `${JSON.stringify({ name: NAME, claimed })}\n`);
	});
}
