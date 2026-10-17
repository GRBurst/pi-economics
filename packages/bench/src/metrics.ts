import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Metrics = {
	req: number; errors: number; input: number; cacheRead: number; cacheWrite: number; output: number;
	costUsd: number; peakCtx: number; toolCalls: number; folds: number; edits: number;
	retryEvents: number; childSessions: number; stopReasons: Record<string, number>;
};

const jsonlFiles = (dir: string): string[] =>
	readdirSync(dir).sort().flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? jsonlFiles(p) : n.endsWith(".jsonl") ? [p] : [];
	});

/**
 * Metrics from a run's session directory, children (`subagents/…`) included. Requests that ended
 * in stopReason "error" are retried failures (e.g. 429s), counted in `errors`.
 */
export function sessionMetrics(sessionDir: string): Metrics {
	const m: Metrics = { req: 0, errors: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0, peakCtx: 0, toolCalls: 0, folds: 0, edits: 0, retryEvents: 0, childSessions: 0, stopReasons: {} };
	if (!existsSync(sessionDir)) return m;
	for (const f of jsonlFiles(sessionDir)) {
		if (/[\\/]subagents[\\/]/.test(f.slice(sessionDir.length))) m.childSessions++;
		for (const line of readFileSync(f, "utf8").split("\n")) {
			if (!line) continue;
			let o: any;
			try { o = JSON.parse(line); } catch { continue; }
			if ((o.type === "custom" || o.customType) && /retry/i.test(o.customType ?? "")) m.retryEvents++;
			const msg = o.message;
			if (!msg || msg.role !== "assistant") continue;
			m.req++;
			const u = msg.usage ?? {};
			m.input += u.input ?? 0; m.cacheRead += u.cacheRead ?? 0; m.cacheWrite += u.cacheWrite ?? 0; m.output += u.output ?? 0;
			m.costUsd += u.cost?.total ?? 0;
			m.peakCtx = Math.max(m.peakCtx, (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0));
			m.stopReasons[msg.stopReason] = (m.stopReasons[msg.stopReason] ?? 0) + 1;
			if (msg.stopReason === "error") m.errors++;
			for (const c of msg.content ?? []) {
				if (c.type !== "toolCall") continue;
				m.toolCalls++;
				if (c.name === "context_fold") m.folds++;
				if (c.name === "edit" || c.name === "write") m.edits++;
			}
		}
	}
	m.costUsd = +m.costUsd.toFixed(3);
	return m;
}
