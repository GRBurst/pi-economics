// The load-order check's probe (./default.nix), loaded from several places
// at once: a registry entry, the auto-discovered directory, a settings.json
// entry of the owner's and an installed package. At session_start it asks
// each guarded component whether it has claimed its single copy: a copy
// claims at its own session_start (runtime-guard.ts), and its listener fills
// `owner` of a later claim from another path without side effects. A
// component that has claimed started before the probe. It appends
// {"name": <this file's path>, "claimed": [...], "sid": <session id>,
// "levers": <the answer to a query for the session on pi-economics' internal
// channel, or null>} to $PROBE_OUT.
// With SPAWN_CHILD=1, the first copy that sees the main session's input
// spawns one child through the actor's __subagentsApi_v1 (the child loads
// its registry list, childExtensions, the probe's registry entry among them)
// and appends {"spawn": <result>}; a spawn is refused until the actor has
// listed the models, so it retries a while on "unknown model".
// With SWITCH_MODEL=<provider>/<id>, the first copy's session_start switches the session's model
// (pi.setModel) and appends {"switched": <result>, "records": [the data of every
// infinite-context:settings entry on the branch, in order]}: the record of what the handlers of
// model_select did, in which order (experiments' handler is registered inside its session_start,
// the extension's at load).
import { appendFileSync } from "node:fs";

const NAME = new URL(import.meta.url).pathname;
const GUARDED = ["experiments", "token-meter", "cache-lifecycle"];
const out = (record: unknown) => appendFileSync(process.env.PROBE_OUT!, `${JSON.stringify(record)}\n`);

export default function probe(pi: any): void {
	pi.on("session_start", async (_event: unknown, ctx: any) => {
		const claimed = GUARDED.filter((component) => {
			const claim: { component: string; path: string; owner?: string } = { component, path: NAME };
			pi.events.emit("pi-economics:claim:v1", claim);
			return claim.owner !== undefined;
		});
		const sid = ctx.sessionManager.getSessionId();
		let levers: unknown = null;
		pi.events.emit("pi-economics:levers-query:v1", { sessionId: sid, reply: (a: unknown) => void (levers ??= a) });
		out({ name: NAME, claimed, sid, levers });
		const g = globalThis as any;
		if (process.env.SWITCH_MODEL && !g.__loadOrderSwitched) {
			g.__loadOrderSwitched = true;
			const [provider, id] = process.env.SWITCH_MODEL.split("/");
			const model = ctx.modelRegistry.getAll().find((m: any) => m.provider === provider && m.id === id);
			const switched = model ? await pi.setModel(model) : "no such model";
			const records = ctx.sessionManager
				.getBranch()
				.filter((e: any) => e.type === "custom" && e.customType === "infinite-context:settings")
				.map((e: any) => e.data);
			out({ switched, records });
		}
	});
	pi.on("input", async () => {
		const g = globalThis as any;
		if (process.env.SPAWN_CHILD !== "1" || g.__loadOrderSpawned) return;
		g.__loadOrderSpawned = true;
		for (let i = 0; i < 50; i++) {
			const spawn = await g.__subagentsApi_v1.spawn(
				{ name: "kid", systemPrompt: "x", message: "x", model: "fake/m" },
				{ quiet: true },
			);
			out({ spawn });
			if (spawn.ok || !String(spawn.reason).includes("unknown model")) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	});
}
