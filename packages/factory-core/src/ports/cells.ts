import type { CellId } from '../ids';

/** What a Cell told the Factory about itself at `hello` (PROTOCOL §1). */
export interface CellInfo {
  version: string;
  projects: string[];
  runners: string[];
  capabilities: string[];
  slots: number;
}

export interface CellRecord {
  cellId: CellId;
  name: string;
  info: CellInfo | null;
  joinedAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

/**
 * The Cell registry (`cells` in STORAGE §4). Local trust is the operating-system account, so a
 * Cell is identified by the id it sends; revocation is the only thing the Factory can withdraw.
 */
export interface CellStore {
  /** Registers a Cell, or refreshes its info when it is already known. Never un-revokes. */
  hello(record: {
    cellId: CellId;
    name: string;
    info: CellInfo;
    at: number;
  }): Promise<void>;
  get(cellId: CellId): Promise<CellRecord | undefined>;
  list(): Promise<CellRecord[]>;
  touch(cellId: CellId, at: number): Promise<void>;
  /** Marks the Cell revoked at `at`. A second revoke keeps the first time. */
  revoke(cellId: CellId, at: number): Promise<void>;
  /**
   * Enrolls a Cell over the network (PROTOCOL §1): stores the hash of its credential and the join
   * token that admitted it. The plain credential is never stored.
   */
  join(record: {
    cellId: CellId;
    name: string;
    credentialHash: string;
    joinedWith: string;
    at: number;
  }): Promise<void>;
  /**
   * The Cell that owns a credential hash, with the stored hash, or undefined. Revoked Cells are returned
   * too. The caller compares the stored hash in constant time.
   */
  findByCredentialHash(
    credentialHash: string,
  ): Promise<{ credentialHash: string; record: CellRecord } | undefined>;
}
