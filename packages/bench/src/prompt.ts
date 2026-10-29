const WORK =
	"You are working non-interactively in a benchmark run. No human will answer questions, so never ask or wait for approval: make reasonable decisions yourself and state them in the final report. Approval gates of skills or repo processes (design approval, spec/plan review, etc.) count as already approved. The current directory is a git checkout of the repository; work only inside it. Do not run system-changing commands (no nixos-rebuild, no home-manager switch). When done, verify your work with the repository's checks and commit your changes with git. End with a short report: what you changed, how you verified it, open issues.";

const SCOUT =
	"You are working non-interactively in a benchmark run. No human will answer questions, so never ask or wait for approval; make reasonable assumptions and state them. The current directory is a git checkout of the repository. Do not modify any files. End with your complete answer as the final message.";

export const buildPrompt = (kind: string, task: string): string =>
	`${kind === "scout" ? SCOUT : WORK}\n\n## Task\n${task}`;
