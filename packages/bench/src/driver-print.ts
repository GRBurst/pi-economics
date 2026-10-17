import type { Arm } from "./types.ts";

/** `pi -p` with an explicit extension list (-ne disables discovery) and the prompt as last argument. */
export function printArgs(arm: Arm, extDir: string, sessionDir: string, prompt: string): string[] {
	return [
		"-p", "--model", arm.model, "--thinking", arm.thinking, "-ne", "--approve",
		...arm.extensions.flatMap((e) => ["-e", `${extDir}/${e}`]),
		"--session-dir", sessionDir, prompt,
	];
}
