// The harness's provider fixture: an API with more than any consumer reads.
export interface Api {
	version: 1;
	list(): { name: string; state: "running" | "idle" }[];
	send(to: string, text: string): Promise<void>;
}
