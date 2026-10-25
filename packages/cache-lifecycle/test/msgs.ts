// pi message shapes (docs/message-types.md), as far as the extension reads them.
export const user = (text: string) => ({ role: "user", content: text, timestamp: 1 });
export const asst = (responseId: string | undefined, content: unknown[]) => ({ role: "assistant", content, responseId, stopReason: "stop", timestamp: 1 });
export const tool = (toolCallId: string, toolName: string, text: string) => ({
  role: "toolResult", toolCallId, toolName, isError: false, content: [{ type: "text", text }], timestamp: 1,
});
