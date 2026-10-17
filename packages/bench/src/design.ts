/** A two-level factor: `values[0]` is the "-" level, `values[1]` the "+" level. */
export type Factor = { name: string; values: [string, string] };
export type DesignArm = { id: string; flags: Record<string, string> };

/**
 * The 2^(k-1) half fraction: the first k-1 factors run through all sign combinations (first factor
 * fastest), the last is generated as x_k = (−1)^k · ∏ x_j. For k = 3 that is x3 = −x1·x2, which keeps
 * the all-low arm (every factor at values[0]) in the design as the baseline. Same construction as the
 * `experiments` extension's design(), kept here so pi-bench has no import into another package.
 * `id` is one sign per factor ("+" = high value).
 */
export function halfFraction(factors: Factor[]): DesignArm[] {
	const k = factors.length;
	if (k < 2) throw new Error("a half fraction needs at least two factors");
	const arms: DesignArm[] = [];
	for (let mask = 0; mask < 2 ** (k - 1); mask++) {
		const signs: number[] = [];
		for (let j = 0; j < k - 1; j++) signs.push(mask & (1 << j) ? 1 : -1);
		signs.push((k % 2 ? -1 : 1) * signs.reduce((p, s) => p * s, 1));
		arms.push({
			id: signs.map((s) => (s > 0 ? "+" : "-")).join(""),
			flags: Object.fromEntries(factors.map((f, j) => [f.name, f.values[signs[j] > 0 ? 1 : 0]])),
		});
	}
	return arms;
}
