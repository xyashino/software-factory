import { createHash, randomBytes } from 'node:crypto';
import { RuntimeError, notFound } from './errors';
import type { RuntimePorts } from './ports';

/** The SHA-256 hex of a join token: the only form the runtime stores (PROTOCOL §1). */
export const hashJoinToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Creates a join token (PROTOCOL §1): 256 random bits, stored as a hash with its expiry. The plain
 * token is returned here and nowhere else. Tokens enroll Cells; they cannot claim work.
 *
 * One `commandId` makes at most one token. A replay (the CLI retries with the same id) is refused
 * as a precondition, so a lost answer cannot leave two live tokens behind.
 */
export const createJoinToken = async (
  ports: RuntimePorts,
  request: { commandId: string; name: string; ttlSeconds?: number },
): Promise<{
  joinTokenId: string;
  name: string;
  token: string;
  expiresAt: number | null;
}> => {
  ports.writer.assertHeld();
  if (await ports.joinTokens.createdForCommand(request.commandId)) {
    throw new RuntimeError({
      code: 'precondition',
      detail:
        'this command already created a join token; its token was shown once, so create another',
    });
  }
  const token = randomBytes(32).toString('base64url');
  const now = ports.clock.now();
  const expiresAt =
    request.ttlSeconds === undefined ? null : now + request.ttlSeconds * 1000;
  const joinTokenId = ports.ids.next();
  await ports.joinTokens.create({
    joinTokenId,
    tokenHash: hashJoinToken(token),
    name: request.name,
    createdAt: now,
    expiresAt,
    commandId: request.commandId,
  });
  return { joinTokenId, name: request.name, token, expiresAt };
};

/** Revokes a join token. Unknown ids are `not_found` (PROTOCOL §3.5). */
export const revokeJoinToken = async (
  ports: RuntimePorts,
  joinTokenId: string,
): Promise<void> => {
  ports.writer.assertHeld();
  const revoked = await ports.joinTokens.revoke(joinTokenId, ports.clock.now());
  if (!revoked) throw notFound();
};
