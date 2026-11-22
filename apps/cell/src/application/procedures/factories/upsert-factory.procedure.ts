import { eq } from 'drizzle-orm';
import { upsertFactoryContract } from '@repo/cell-contracts/factories.contract';
import { immediateTx } from '../../../db/client';
import { factories } from '../../../db/schema/factories';
import { asFactoryId } from '../../../domain/common/brand';
import {
  validateFactoryName,
  validateFactoryUrl,
} from '../../../domain/factories/factory-target';
import { asBadRequest } from '../../core/error-handling';
import { publicProcedure } from '../../core/procedure';
import { toFactoryDto } from './factory-dto';

const keepUnlessGiven = (
  incoming: string | null | undefined,
  current: string | null,
): string | null => (incoming === undefined ? current : incoming);

export const upsertFactoryProcedure = publicProcedure(upsertFactoryContract)((
  input,
  ctx,
) => {
  const name = asBadRequest(() => validateFactoryName(input.body.name));
  const url = asBadRequest(() => validateFactoryUrl(input.body.url));
  const now = ctx.clock.now();

  const row = immediateTx(ctx.db, (tx) => {
    const existing = tx
      .select()
      .from(factories)
      .where(eq(factories.name, name))
      .get();
    const anyFactory = tx
      .select({ factoryId: factories.factoryId })
      .from(factories)
      .limit(1)
      .get();
    const makeDefault =
      input.body.isDefault === true || anyFactory === undefined;

    if (makeDefault)
      tx.update(factories)
        .set({ isDefault: false })
        .where(eq(factories.isDefault, true))
        .run();

    if (existing === undefined)
      return tx
        .insert(factories)
        .values({
          factoryId: asFactoryId(crypto.randomUUID()),
          name,
          url,
          joinToken: input.body.joinToken ?? null,
          supervisorToken: input.body.supervisorToken ?? null,
          isDefault: makeDefault,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

    return tx
      .update(factories)
      .set({
        url,
        joinToken: keepUnlessGiven(input.body.joinToken, existing.joinToken),
        supervisorToken: keepUnlessGiven(
          input.body.supervisorToken,
          existing.supervisorToken,
        ),
        isDefault: existing.isDefault || makeDefault,
        updatedAt: now,
      })
      .where(eq(factories.factoryId, existing.factoryId))
      .returning()
      .get();
  });

  return { code: 200 as const, factory: toFactoryDto(row) };
});
