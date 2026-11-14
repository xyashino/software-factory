/**
 * The `supervisor_tokens` table (STORAGE §4): one row per supervisor token, keyed by the SHA-256 of
 * the token. The plain token is shown once, by `admin token create`, and never stored.
 */
export interface SupervisorTokenStore {
  create(record: {
    tokenHash: string;
    name: string;
    createdAt: number;
  }): Promise<void>;
  /**
   * The row of the supervisor token with this hash: its stored hash and owner name, or undefined when
   * it is unknown. The caller compares the stored hash in constant time (remote.ts `sameHash`).
   */
  find(
    tokenHash: string,
  ): Promise<{ tokenHash: string; name: string } | undefined>;
}
