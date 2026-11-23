export type ClaimWaitersPort = {
  waitForWake(ms: number, signal: AbortSignal): Promise<void>;
  wakeAll(): void;
};
