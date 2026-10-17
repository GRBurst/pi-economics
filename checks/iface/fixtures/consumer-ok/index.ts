// A consumer's copy the provider satisfies: a subset, with wider field types.
export type Copy = { list(): { name: string; state: string }[] };
