// Stand-in for pi's package, which the sandbox does not have (it comes from `npm ci`).
// Only what the tested modules call: the agent dir (as pi resolves it, by env), and the
// simplest faithful versions of the session helpers for plain message entries. overlay.ts
// never estimates tokens, so that stub fails loudly.
export const getAgentDir = () => process.env.PI_CODING_AGENT_DIR;
export const estimateTokens = () => {
  throw new Error("stub: estimateTokens is not available");
};
export const sessionEntryToContextMessages = (entry) =>
  entry.type === "message" ? [entry.message] : [];
