/** Silence and reminder timing when the Cycle's own policy names none. */
export const DEFAULT_WATCH_TIMING = {
  idleReminders: 2,
  idleCooldownMs: 45_000,
  silentMs: 300_000,
  silentNudges: 1,
} as const;

/** How long a question holds the Cycle open before the Cell asks for a Handover. */
export const QUESTION_HOLD_MS = 30 * 60_000;

/** Grace the Operator gets to write its Handover after the hold request, before the Cycle blocks. */
export const HANDOVER_GRACE_MS = 5 * 60_000;

/** Stall-alert threshold: reminders sent before the Cell may ship a pane tail. */
export const STALL_ALERT_REMINDERS = 1;

/** The Cycle watch policy: the Operator's declared timeout plus the default reminder timing. */
export const watchPolicyFor = (
  timeoutMs: number,
): {
  timeoutMs: number;
  idleReminders: number;
  idleCooldownMs: number;
  silentMs: number;
  silentNudges: number;
} => {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(
      `watch timeout must be a positive integer, got ${timeoutMs}`,
    );
  }
  return { timeoutMs, ...DEFAULT_WATCH_TIMING };
};
