import type { WorkerId } from '../ids';

/** What a Worker told the Factory about itself at `hello` (PROTOCOL §1). */
export interface WorkerInfo {
  version: string;
  projects: string[];
  runners: string[];
  capabilities: string[];
  slots: number;
}

export interface WorkerRecord {
  workerId: WorkerId;
  name: string;
  info: WorkerInfo | null;
  joinedAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

/**
 * The Worker registry (`cells` in STORAGE §4). Local trust is the operating-system account, so a
 * Worker is identified by the id it sends; revocation is the only thing the Factory can withdraw.
 */
export interface WorkerStore {
  /** Registers a Worker, or refreshes its info when it is already known. Never un-revokes. */
  hello(record: {
    workerId: WorkerId;
    name: string;
    info: WorkerInfo;
    at: number;
  }): Promise<void>;
  get(workerId: WorkerId): Promise<WorkerRecord | undefined>;
  list(): Promise<WorkerRecord[]>;
  touch(workerId: WorkerId, at: number): Promise<void>;
  /** Marks the Worker revoked at `at`. A second revoke keeps the first time. */
  revoke(workerId: WorkerId, at: number): Promise<void>;
}
