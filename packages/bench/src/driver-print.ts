import { armExtensions, extArgs } from "./extensions.ts";
import type { Arm, Paths } from "./types.ts";

/** `pi -p` with an explicit extension list (-ne disables discovery: armExtensions) and the prompt as last argument. */
export function printArgs(arm: Arm, paths: Pick<Paths, "extDir" | "baseExtensions" | "orchExtensions">, sessionDir: string, prompt: string): string[] {
	return [
		"-p", "--model", arm.model, "--thinking", arm.thinking, "-ne", "--approve",
		...extArgs(armExtensions(arm, paths), paths.extDir),
		"--session-dir", sessionDir, prompt,
	];
}
