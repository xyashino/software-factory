import { eq } from 'drizzle-orm';
import { setDefaultFactoryContract } from '../../../contracts/factories.contract';
import { immediateTx } from '../../../db/client';
import { factories } from '../../../db/schema/factories';
import { asFactoryId } from '../../../domain/common/brand';
import { asBadRequest, NotFound } from '../../core/error-handling';
import { publicProcedure } from '../../core/procedure';
import { toFactoryDto } from './factory-dto';

export const setDefaultFactoryProcedure = publicProcedure(
  setDefaultFactoryContract,
)((input, ctx) => {
  const id = asBadRequest(() => asFactoryId(input.params.id));
  const row = immediateTx(ctx.db, (tx) => {
    const target = tx
      .select({ factoryId: factories.factoryId })
      .from(factories)
      .where(eq(factories.factoryId, id))
      .get();
    if (target === undefined) throw new NotFound(`factory not found: ${id}`);

    tx.update(factories)
      .set({ isDefault: false })
      .where(eq(factories.isDefault, true))
      .run();
    return tx
      .update(factories)
      .set({ isDefault: true, updatedAt: ctx.clock.now() })
      .where(eq(factories.factoryId, id))
      .returning()
      .get();
  });
  return { code: 200 as const, factory: toFactoryDto(row) };
});
