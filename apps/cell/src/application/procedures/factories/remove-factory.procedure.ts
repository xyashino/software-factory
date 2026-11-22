import { count, eq } from 'drizzle-orm';
import { removeFactoryContract } from '@repo/cell-contracts/factories.contract';
import { immediateTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { factories } from '../../../db/schema/factories';
import { asFactoryId } from '../../../domain/common/brand';
import { asBadRequest, Conflict, NotFound } from '../../core/error-handling';
import { publicProcedure } from '../../core/procedure';

export const removeFactoryProcedure = publicProcedure(removeFactoryContract)((
  input,
  ctx,
) => {
  const id = asBadRequest(() => asFactoryId(input.params.id));
  return immediateTx(ctx.db, (tx) => {
    const target = tx
      .select({ factoryId: factories.factoryId })
      .from(factories)
      .where(eq(factories.factoryId, id))
      .get();
    if (target === undefined) throw new NotFound(`factory not found: ${id}`);

    const referenced = tx
      .select({ n: count() })
      .from(cells)
      .where(eq(cells.factoryId, id))
      .get();
    if (referenced !== undefined && referenced.n > 0)
      throw new Conflict(
        `factory is referenced by ${referenced.n} cell slot(s)`,
      );

    tx.delete(factories).where(eq(factories.factoryId, id)).run();
    return { code: 200 as const, factoryId: id };
  });
});
