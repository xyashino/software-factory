import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from '../../src/config';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import { asTokenId } from '../../src/domain/common/brand';
import {
  createTestApp,
  getJson,
  postJson,
  type TestApp,
} from '../support/test-app';

const JOIN_TOKEN = 'sf_join_factory-heartbeat-join';
const SUPERVISOR_TOKEN = 'sf_sup_factory-heartbeat-supervisor';

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  db.insert(safeTokens)
    .values([
      {
        tokenId: asTokenId('factory-join-2'),
        tokenHash: hashToken(JOIN_TOKEN),
        prefix: TOKEN_PREFIXES.join,
        kind: 'factory_join',
        name: 'join',
        scopesJson: ['factory:enroll'],
        createdAt: clock.now(),
      },
      {
        tokenId: asTokenId('supervisor-1'),
        tokenHash: hashToken(SUPERVISOR_TOKEN),
        prefix: TOKEN_PREFIXES.supervisor,
        kind: 'supervisor',
        name: 'supervisor',
        scopesJson: ['supervisor:read'],
        createdAt: clock.now(),
      },
    ])
    .run();
  return { app, clock };
};

const enrollSession = async (app: TestApp): Promise<string> => {
  const response = await postJson(
    app,
    '/api/v1/factories/enroll',
    { name: 'laptop-2' },
    { authorization: `Bearer ${JOIN_TOKEN}` },
  );
  const body = (await response.json()) as { sessionToken: string };
  return body.sessionToken;
};

const heartbeat = (app: TestApp, sessionToken: string): Promise<Response> =>
  postJson(app, '/api/v1/factories/heartbeat', undefined, {
    authorization: `Bearer ${sessionToken}`,
  });

const listFactories = (app: TestApp) =>
  getJson(app, '/api/v1/factories', {
    authorization: `Bearer ${SUPERVISOR_TOKEN}`,
  }).then(
    (response) =>
      response.json() as Promise<{
        factories: { name: string; online: boolean }[];
      }>,
  );

describe('factory heartbeat', () => {
  it('heartbeat keeps the factory listed as online', async () => {
    const { app, clock } = setup();
    const sessionToken = await enrollSession(app);
    clock.advance(LEASE_TTL_MS - 1_000);
    await heartbeat(app, sessionToken);
    clock.advance(LEASE_TTL_MS - 1_000);

    const body = await listFactories(app);

    expect(body.factories).toEqual([
      expect.objectContaining({ name: 'laptop-2', online: true }),
    ]);
  });

  it('silent factory shows as offline after the lease expires', async () => {
    const { app, clock } = setup();
    await enrollSession(app);
    clock.advance(LEASE_TTL_MS + 1);

    const body = await listFactories(app);

    expect(body.factories).toEqual([
      expect.objectContaining({ name: 'laptop-2', online: false }),
    ]);
  });

  it('rejects heartbeat from a token that is not a factory session', async () => {
    const { app } = setup();

    const response = await heartbeat(app, JOIN_TOKEN);

    expect(response.status).toBe(403);
  });
});
