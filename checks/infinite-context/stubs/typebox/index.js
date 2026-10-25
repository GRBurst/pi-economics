// Stand-in for typebox: index.ts builds tool schemas with it, and the tests register no tools.
export const Type = new Proxy({}, { get: () => () => ({}) });
