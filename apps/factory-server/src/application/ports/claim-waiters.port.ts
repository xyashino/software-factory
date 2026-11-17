export type ClaimWaitersPort = {
  park(): Promise<void>;
  wakeAll(): void;
};
