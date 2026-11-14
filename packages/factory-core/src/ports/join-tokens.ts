/** One join token as the Supervisor lists it (PROTOCOL §1). The token itself is never stored. */
export interface JoinTokenRecord {
  joinTokenId: string;
  name: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

/**
 * The `join_tokens` table (STORAGE §4). Only the SHA-256 hash of a token is stored; the plain token
 * is returned once, by the create call, and never again.
 */
export interface JoinTokenStore {
  /** Stores a token. `commandId` is unique: one create command makes at most one token. */
  create(record: {
    joinTokenId: string;
    tokenHash: string;
    name: string;
    createdAt: number;
    expiresAt: number | null;
    commandId: string;
  }): Promise<void>;
  /** True when a token was already created by this command id (a replayed create). */
  createdForCommand(commandId: string): Promise<boolean>;
  list(): Promise<JoinTokenRecord[]>;
  /** Marks the token revoked at `at`; a second revoke keeps the first time. False when unknown. */
  revoke(joinTokenId: string, at: number): Promise<boolean>;
}
