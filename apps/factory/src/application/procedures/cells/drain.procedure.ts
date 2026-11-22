import { eq } from 'drizzle-orm';
import { immediateTx, type DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { drainCellContract } from '../../../contracts/cells.contract';
import {
  asCellId,
  asCommandId,
  type CellId,
} from '../../../domain/common/brand';
import { Conflict, NotFound } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import {
  flushTransitions,
  orderTransition,
  publishCommitted,
  type Actor,
  type TransitionLog,
} from '../../orders/order-writes';
import { isCommandReplay } from './command-replay';

const findCell = (tx: DbTx, cellId: CellId) =>
  tx.select().from(cells).where(eq(cells.cellId, cellId)).get();

export const drainCellProcedure = scopedProcedure(['supervisor:write'])(
  drainCellContract,
)((input, ctx) => {
  const cellId = asCellId(input.params.id);
  const now = ctx.clock.now();
  const actor: Actor = { kind: 'supervisor', id: ctx.principal.tokenId };
  const requestedForce = input.body?.force ?? false;
  const commandId = input.body?.commandId;

  const outcome = immediateTx(ctx.db, (tx) => {
    const cell = findCell(tx, cellId);
    if (cell === undefined) throw new NotFound(`Cell ${cellId} not found`);
    if (isCommandReplay(tx, cellId, commandId))
      return { force: cell.drainForce, offline: false, records: [] };
    if (cell.status === 'draining') {
      if (requestedForce && !cell.drainForce)
        tx.update(cells)
          .set({ drainForce: true })
          .where(eq(cells.cellId, cellId))
          .run();
      return {
        force: cell.drainForce || requestedForce,
        offline: false,
        records: [],
      };
    }
    if (cell.status === 'revoked' || cell.status === 'left')
      throw new Conflict(`Cell ${cellId} is ${cell.status}`);

    const log: TransitionLog = [
      orderTransition({
        projectId: cell.projectId,
        entityType: 'cell',
        entityId: cellId,
        fromState: cell.status,
        toState: 'draining',
        actor,
        at: now,
      }),
    ];
    tx.update(cells)
      .set({ status: 'draining', drainForce: requestedForce })
      .where(eq(cells.cellId, cellId))
      .run();
    const command =
      commandId === undefined
        ? undefined
        : {
            commandId: asCommandId(commandId),
            meta: { force: requestedForce },
          };
    return {
      force: requestedForce,
      offline: cell.status === 'offline',
      records: flushTransitions(tx, log, command),
    };
  });
  publishCommitted(ctx, outcome.records);

  return {
    code: 200 as const,
    status: 'draining' as const,
    force: outcome.force,
    offline: outcome.offline,
  };
});
