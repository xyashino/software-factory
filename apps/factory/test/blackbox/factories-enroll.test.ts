import { describe, expect, it } from 'vitest';
import { FACTORY_SESSION_TTL_MS } from '../../src/config';
import { safeTokens } from '../../src/db/schema/tokens';
import {
  hashToken,
  TOKEN_PREFIXES,
} from '../../src/application/tokens/token-hash';
import { asTokenId } from '../../src/domain/common/brand';
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import type { Db } from '../../src/db/client';

const JOIN_TOKEN = 'sf_join_factory-join-token';

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  db.insert(safeTokens)
    .values({
      tokenId: asTokenId('factory-join-1'),
      tokenHash: hashToken(JOIN_TOKEN),
      prefix: TOKEN_PREFIXES.join,
      kind: 'factory_join',
      name: 'join',
      scopesJson: ['factory:enroll'],
      createdAt: clock.now(),
    })
    .run();
  return { app, clock, db };
};

const enroll = (app: TestApp, token: string = JOIN_TOKEN): Promise<Response> =>
  postJson(
    app,
    '/api/v1/factories/enroll',
    { name: 'laptop-1' },
    { authorization: `Bearer ${token}` },
  );

const joinRevokedAt = (db: Db): number | null | undefined =>
  db
    .select()
    .from(safeTokens)
    .all()
    .find((row) => row.tokenId === 'factory-join-1')?.revokedAt;

describe('factory enrollment', () => {
  it('join token works once', async () => {
    const { app, clock, db } = setup();

    const first = await enroll(app);
    const second = await enroll(app);

    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      code: 201,
      factoryId: expect.any(String),
      sessionToken: expect.stringMatching(/^sf_factory_/),
      expiresAt: clock.now() + FACTORY_SESSION_TTL_MS,
    });
    expect(second.status).toBe(401);
    expect(joinRevokedAt(db)).toBe(clock.now());
  });

  it('enrolled factory session can send heartbeats', async () => {
    const { app } = setup();
    const body = (await (await enroll(app)).json()) as {
      factoryId: string;
      sessionToken: string;
    };

    const response = await postJson(
      app,
      '/api/v1/factories/heartbeat',
      { projects: [] },
      { authorization: `Bearer ${body.sessionToken}` },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      factoryId: body.factoryId,
    });
  });
});
