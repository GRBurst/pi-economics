// The identityShim probe (redesign D14, M10 T10.7): does pi's cache warmer
// still lose its run after a custom message, the pi 1.0.0 behaviour the shim
// (packages/cache-lifecycle/core/identity.ts) works around? One real
// AgentSession of the pi under test, offline: pi-ai's faux provider answers,
// the model carries a prompt-cache lifetime and prices so the warmer starts
// and its economics hold, `cacheWarming` is "idle" so the run outlives the
// settled agent. A prompt; a custom message that triggers a turn (a child's
// mail), so the warmed request holds it; then, idle, a custom message that
// only records (an extension's note), which makes pi rebuild its context from
// the session projection. The warmer's status after each step. The shim is
// cache-lifecycle's own registration, loaded as an inline extension, on in one
// session and off in the other. Prints one JSON object.
//
// Usage: node --experimental-strip-types probe.ts <pi-monorepo dir> <identity.ts>
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [piDir, identityTs] = process.argv.slice(2);
const load = (p: string) => import(pathToFileURL(p).href);
const pi = await load(join(piDir, "dist/index.js"));
const ai = await load(join(piDir, "node_modules/@earendil-works/pi-ai/dist/index.js"));
const { registerIdentityShim } = await load(identityTs);

type Status = { state: string; reason?: string } | undefined;
const brief = (s: Status) => (s ? { state: s.state, reason: s.reason ?? null } : null);

async function session(shim: boolean) {
	const dir = mkdtempSync(join(tmpdir(), "identity-shim-probe-"));
	const faux = ai.fauxProvider({
		provider: "probe",
		models: [{ id: "m", cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 200000, maxTokens: 1000 }],
	});
	faux.setResponses([ai.fauxAssistantMessage("one"), ai.fauxAssistantMessage("two")]);
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("probe", "k");
	const settingsManager = pi.SettingsManager.inMemory({ cacheWarming: "idle" });
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager,
		extensionFactories: [(api: { on(name: string, handler: (event: any, ctx: any) => unknown): void }) => registerIdentityShim(api, shim)],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({
		cwd: dir,
		agentDir: dir,
		modelRuntime,
		model: { ...faux.getModel(), promptCache: { short: 300 } },
		noTools: "all",
		resourceLoader,
		sessionManager: pi.SessionManager.inMemory(dir),
		settingsManager,
	});
	await session.bindExtensions({});
	await session.prompt("x");
	await session.waitForIdle();
	const afterPrompt = brief(session.cacheWarmingStatus);
	await session.sendCustomMessage({ customType: "probe-mail", content: "mail", display: true }, { triggerTurn: true });
	await session.waitForIdle();
	const afterMail = brief(session.cacheWarmingStatus);
	await session.sendCustomMessage({ customType: "probe-note", content: "note", display: false }, { triggerTurn: false });
	await session.waitForIdle();
	const afterNote = brief(session.cacheWarmingStatus);
	const calls = faux.state.callCount;
	session.dispose();
	return { afterPrompt, afterMail, afterNote, calls };
}

const version = JSON.parse((await import("node:fs")).readFileSync(join(piDir, "package.json"), "utf8")).version;
console.log(JSON.stringify({ version, without: await session(false), with: await session(true) }));
