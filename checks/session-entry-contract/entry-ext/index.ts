// A stand-in for a consumer's extension that adopts a value recorded on the session branch the way infinite-context
// does: at session_start it keeps the latest entry of its own customType when the field holds a number inside its
// range, else it draws a value of its own and records that (appends an entry). What it uses is announced on the bus
// (`entry-ext:used`), so a test sees what the target actually ran with. Named neutrally on purpose: the repository
// names only the extensions it ships (AGENTS.md).
export const CUSTOM_TYPE = "entry-ext:settings";
export const FIELD = "nudge";
export const RANGE = [100, 200] as const;
export const USED = "entry-ext:used";
/** What pi lists of it: a command of this name (infinite-context lists tools and commands; a consumer's target names one). */
export const TARGET = "entry-ext";

export default function entryExt(pi: any): void {
  pi.registerCommand(TARGET, { description: "entry-ext stand-in", handler: () => {} });
  pi.on("session_start", (_e: unknown, ctx: any) => {
    const branch: any[] = ctx.sessionManager.getBranch();
    const latest = [...branch].reverse().find((e) => e?.type === "custom" && e.customType === CUSTOM_TYPE);
    const recorded = latest?.data?.[FIELD];
    let used: number;
    if (typeof recorded === "number" && recorded >= RANGE[0] && recorded <= RANGE[1]) {
      used = recorded; // adopted: keeps the recorded value, records nothing
    } else {
      used = Math.round((RANGE[0] + RANGE[1]) / 2); // its own draw, recorded like any other
      pi.appendEntry(CUSTOM_TYPE, { [FIELD]: used });
    }
    pi.events.emit(USED, { sessionId: ctx.sessionManager.getSessionId(), value: used });
  });
}
