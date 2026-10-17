export type Task = {
	kind: string; // small | medium | large | scout
	prompt: string;
	gitdir: string; // GIT_DIR of the (private) source repository
	sub?: string; // subdirectory of the tree that is the repository under test
	base: string; // commit the agent starts from
	refs?: string[]; // accepted solution: commit or base..last range (last is used)
	refExclude?: string[]; // pathspecs (relative to sub) left out of the reference patch
	refNote?: string;
	overlay?: Record<string, string>; // file -> commit whose version replaces the baseline's
	extraFiles?: Record<string, string>; // checkout path -> source file (relative to the data dir)
	check?: string | null; // shell command run in the checkout after the agent finished
	repo?: string;
	ref_answer?: string; // scouts: reference answer is tasks/<id>/ref_answer.md in the data dir
};

export type Arm = {
	model: string;
	thinking: string;
	driver: "print" | "rpc";
	extensions: string[]; // names under the extension directory
	/** Orchestrator factor levels (routing, delegation, t0Widened: "off" | "on"); set → the run gets its own agent dir. */
	factors?: Record<string, string>;
};

export type Paths = {
	data: string; // tasks.json, runs/, judge/, reports/
	work: string; // checkouts, nix caches (tmpfs)
	extDir: string; // where pi's extensions live
	probeExt: string; // probe/ of this package
	shimBin: string; // bin/ of this package (devenv, rustup shims)
	agentSrc: string; // the live pi agent dir: credentials and models are linked from here into per-run agent dirs
	agentsOn: string; // AGENTS.md of routing-on arms
	agentsOff: string; // AGENTS.md of routing-off arms (the old manual rules)
	router?: string; // JSON file (PI_BENCH_ROUTER): the base of an orch arm's task-router/settings.json; unset = {}
};

export type RunResult = {
	id: string;
	arm: string;
	rep: number;
	model: string;
	think: string;
	piexit: number;
	checkExit: number | null;
	wallSec: number;
	checkSec: number;
	filesChanged: number;
	baseSha: string;
};
