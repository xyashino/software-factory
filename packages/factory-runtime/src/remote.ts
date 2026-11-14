import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  JoinRequest,
  JoinResponse,
} from '@repo/factory-core/contracts/cell';
import type { CellId, JobId, OrderId } from '@repo/factory-core/ids';
import { notFound, unauthorized } from './errors';
import type { RuntimePorts } from './ports';

/** The SHA-256 hex of a token. Join tokens, supervisor tokens and Cell credentials are stored this way. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** A new random token: 256 bits, base64url. The plain form is returned once and never stored. */
const newToken = (): string => randomBytes(32).toString('base64url');

/**
 * True when the stored hash is the presented one. The comparison takes the same time whatever the
 * bytes are, so a credential check reveals nothing about a stored hash through its timing.
 */
export const sameHash = (stored: string, presented: string): boolean => {
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * What the remote transport needs from the runtime, and nothing more (PROTOCOL §1, §2). Every
 * credential check is here, so the server holds no token table of its own and the hashes never leave
 * the runtime. The socket does not use it: local trust is the operating-system account.
 */
export interface RemoteAccess {
  /** Enrolls a Cell with a join token (PROTOCOL §3.2). The credential is returned once. */
  joinCell(request: JoinRequest): Promise<JoinResponse>;
  /** The name of the supervisor token's owner, or undefined for an unknown token. */
  supervisorName(token: string): Promise<string | undefined>;
  /** The Cell that owns a credential, or undefined when it is unknown or its Cell is revoked. */
  cellOf(credential: string): Promise<CellId | undefined>;
  /** The Work order of a job the Cell holds; `not_found` when the Cell holds no such job. */
  orderOfJob(cellId: CellId, jobId: JobId): Promise<OrderId>;
  /**
   * Creates a supervisor token (`factory-server admin token create`). The plain token is returned
   * once. Needs the writer lock; no network route calls it (PROTOCOL §1).
   */
  createSupervisorToken(name: string): Promise<{ name: string; token: string }>;
}

export const createRemoteAccess = (ports: RuntimePorts): RemoteAccess => ({
  joinCell: async ({ joinToken, name }) => {
    ports.writer.assertHeld();
    const now = ports.clock.now();
    const presented = hashToken(joinToken);
    const found = await ports.joinTokens.findActive(presented, now);
    if (found === undefined || !sameHash(found.tokenHash, presented)) {
      throw unauthorized();
    }
    const cellId = ports.ids.next() as CellId;
    const credential = newToken();
    await ports.cells.join({
      cellId,
      name,
      credentialHash: hashToken(credential),
      joinedWith: found.joinTokenId,
      at: now,
    });
    return { cellId, credential };
  },
  supervisorName: async (token) => {
    const presented = hashToken(token);
    const found = await ports.supervisorTokens.find(presented);
    if (found === undefined || !sameHash(found.tokenHash, presented)) {
      return undefined;
    }
    return found.name;
  },
  cellOf: async (credential) => {
    const presented = hashToken(credential);
    const found = await ports.cells.findByCredentialHash(presented);
    if (found === undefined || !sameHash(found.credentialHash, presented)) {
      return undefined;
    }
    if (found.record.revokedAt !== null) return undefined;
    return found.record.cellId;
  },
  orderOfJob: async (cellId, jobId) => {
    const lease = (await ports.leases.forCell(cellId)).find(
      (candidate) => candidate.jobId === jobId,
    );
    if (!lease) throw notFound();
    return lease.orderId;
  },
  createSupervisorToken: async (name) => {
    ports.writer.assertHeld();
    const token = newToken();
    await ports.supervisorTokens.create({
      tokenHash: hashToken(token),
      name,
      createdAt: ports.clock.now(),
    });
    return { name, token };
  },
});
