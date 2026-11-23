import { goneCellContract } from '@repo/hq-contracts/factories.contract';
import { immediateTx } from '../../../db/client';
import { asCellId } from '../../../domain/common/brand';
import { factoryIdOf, touchFactory } from '../../core/identity';
import { scopedProcedure } from '../../core/procedure';
import { loseCellJob } from '../../orders/cell-release';
import {
  flushTransitions,
  publishCommitted,
  type TransitionLog,
} from '../../orders/order-writes';

export const goneCellProcedure = scopedProcedure(['factory:worker'])(
  goneCellContract,
)((input, ctx) => {
  const factoryId = factoryIdOf(ctx);
  const cellId = asCellId(input.params.id);
  const now = ctx.clock.now();

  const records = immediateTx(ctx.db, (tx) => {
    touchFactory(tx, factoryId, now);
    const log: TransitionLog = [];
    loseCellJob(
      tx,
      cellId,
      factoryId,
      now,
      { kind: 'system', id: factoryId },
      log,
    );
    return flushTransitions(tx, log);
  });
  publishCommitted(ctx, records);

  return { code: 200 as const, cellId };
});
