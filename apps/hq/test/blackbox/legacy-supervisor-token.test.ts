import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client';
import { safeTokens } from '../../src/db/schema/tokens';
import { stateTransitions } from '../../src/db/schema/transitions';
import { hashToken } from '../../src/application/tokens/token-hash';
import { asProjectId, asTokenId } from '../../src/domain/common/brand';
import { createTestApp, getJson } from '../support/test-app';
import { createTestDb, seedBaseline } from '../support/test-db';

const LEGACY_TOKEN = 'sf_sup_legacy-token';

const MIGRATION_SQL = readFileSync(
  new URL(
    '../../src/db/migrations/0007_operator_token_rename.sql',
    import.meta.url,
  ),
  'utf8',
);

const runMigration = (db: Db): void => {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')) {
    db.run(sql.raw(statement));
  }
};

describe('legacy supervisor token', () => {
  it('keeps an old token working and its history readable as operator', async () => {
    // Arrange
    const db = createTestDb();
    const { app, clock } = createTestApp({ db, safeTokenAuth: true });
    seedBaseline(db);
    db.insert(safeTokens)
      .values({
        tokenId: asTokenId('legacy-1'),
        tokenHash: hashToken(LEGACY_TOKEN),
        prefix: 'sf_sup_',
        kind: 'operator',
        name: 'legacy',
        scopesJson: ['operator:read', 'operator:write'],
        createdAt: clock.now(),
      })
      .run();
    db.insert(stateTransitions)
      .values({
        projectId: asProjectId('proj-1'),
        entityType: 'work_order',
        entityId: 'order-1',
        toState: 'queued',
        actorKind: 'operator',
        actorId: 'legacy-1',
        at: clock.now(),
      })
      .run();
    db.run(
      sql`UPDATE safe_tokens SET kind = 'supervisor', scopes_json = '["supervisor:read","supervisor:write"]'`,
    );
    db.run(sql`UPDATE state_transitions SET actor_kind = 'supervisor'`);

    // Act
    runMigration(db);
    const response = await getJson(app, '/api/v1/projects', {
      authorization: `Bearer ${LEGACY_TOKEN}`,
    });

    // Assert
    expect(response.status).toBe(200);
    expect(
      db
        .select({ kind: safeTokens.kind, scopes: safeTokens.scopesJson })
        .from(safeTokens)
        .where(eq(safeTokens.tokenId, asTokenId('legacy-1')))
        .all(),
    ).toEqual([
      { kind: 'operator', scopes: ['operator:read', 'operator:write'] },
    ]);
    expect(
      db
        .select({ actorKind: stateTransitions.actorKind })
        .from(stateTransitions)
        .where(eq(stateTransitions.actorId, 'legacy-1'))
        .all(),
    ).toEqual([{ actorKind: 'operator' }]);
  });
});
