import { factories } from '../../src/db/schema/factories';
import { safeTokens } from '../../src/db/schema/tokens';
import type { Db } from '../../src/db/client';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import { asFactoryId, asTokenId } from '../../src/domain/common/brand';

export const FACTORY_ID = 'factory-1';
export const FACTORY_TOKEN = 'sf_factory_test-factory-token';

export const factoryHeaders = (
  cellId: string,
  token: string = FACTORY_TOKEN,
): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  'x-cell-id': cellId,
});

export const claimBody = (
  body: Record<string, unknown> = {},
  projectId = 'proj-1',
  allowedLines: string[] = ['feature'],
): Record<string, unknown> => ({
  projectId,
  allowedLines,
  runners: ['claude'],
  ...body,
});

export const seedFactory = (
  db: Db,
  factoryId: string,
  token: string,
  now: number,
): void => {
  db.insert(factories)
    .values({
      factoryId: asFactoryId(factoryId),
      name: factoryId,
      lastSeenAt: now,
      createdAt: now,
    })
    .run();
  db.insert(safeTokens)
    .values({
      tokenId: asTokenId(`token-${factoryId}`),
      tokenHash: hashToken(token),
      prefix: TOKEN_PREFIXES.factory,
      kind: 'factory_session',
      name: factoryId,
      scopesJson: ['factory:worker'],
      factoryId: asFactoryId(factoryId),
      createdAt: now,
    })
    .run();
};
