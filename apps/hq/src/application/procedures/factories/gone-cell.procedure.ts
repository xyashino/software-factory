import { goneCellContract } from '@repo/hq-contracts/factories.contract';
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
)(async (input, ctx) => {
  const factoryId = factoryIdOf(ctx);
  const cellId = asCellId(input.params.id);
  const now = ctx.clock.now();

  const records = await ctx.storage.write((tx) => {
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
