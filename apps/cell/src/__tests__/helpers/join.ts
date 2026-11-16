import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { CellId } from '@repo/factory-core/ids';
import { joinRemote, remoteFactoryClient } from '../../remote-client';

/**
 * Enrolls a Cell with a join token (PROTOCOL §3.2) and returns its id with a client that holds its
 * credential. The Factory names the Cell, so the test takes the id it is given rather than choosing one.
 */
export const joinCell = async (
  baseUrl: string,
  joinToken: string,
  name = 'test-cell',
): Promise<{ cellId: CellId; client: FactoryClient }> => {
  const { cellId, credential } = await joinRemote({
    baseUrl,
    joinToken,
    name,
  });
  return {
    cellId,
    client: remoteFactoryClient({ baseUrl, credential, attempts: 1 }),
  };
};
