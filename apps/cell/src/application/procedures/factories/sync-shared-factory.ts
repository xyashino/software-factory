import { eq } from 'drizzle-orm';
import { type Db, immediateTx } from '../../../db/client';
import { factories } from '../../../db/schema/factories';
import { asFactoryId } from '../../../domain/common/brand';
import type { SharedTarget } from '../../../domain/factories/shared-target';

export const syncSharedFactory = (
  db: Db,
  now: number,
  target: SharedTarget,
): void =>
  immediateTx(db, (tx) => {
    tx.update(factories)
      .set({ isDefault: false })
      .where(eq(factories.isDefault, true))
      .run();
    const existing = tx
      .select()
      .from(factories)
      .where(eq(factories.name, target.name))
      .get();
    if (existing === undefined) {
      tx.insert(factories)
        .values({
          factoryId: asFactoryId(crypto.randomUUID()),
          name: target.name,
          url: target.url,
          joinToken: null,
          supervisorToken: target.token,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return;
    }
    tx.update(factories)
      .set({
        url: target.url,
        supervisorToken: target.token,
        isDefault: true,
        updatedAt: now,
      })
      .where(eq(factories.factoryId, existing.factoryId))
      .run();
  });
