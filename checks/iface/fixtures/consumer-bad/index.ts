// A consumer's copy the provider does not satisfy: a method the provider lacks.
export type Copy = { list(): { name: string; state: string }[]; kill(name: string): void };
