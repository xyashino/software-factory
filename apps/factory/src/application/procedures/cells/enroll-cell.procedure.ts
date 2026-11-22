import { eq } from 'drizzle-orm';
import { immediateTx, type DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { safeTokens } from '../../../db/schema/tokens';
import { CELL_SESSION_TTL_MS } from '../../../config';
import { enrollCellContract } from '@repo/factory-contracts/cells.contract';
import { asCellId, asTokenId, type CellId } from '../../../domain/common/brand';
import { scopedId } from '../../../domain/common/scoped-id';
import { addMs } from '../../../domain/common/time';
import { Forbidden } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import { requireProject } from '../../orders/order-writes';
import { hashToken, mintToken, TOKEN_PREFIXES } from '../../tokens/token-hash';

const findCell = (tx: DbTx, cellId: CellId) =>
  tx.select().from(cells).where(eq(cells.cellId, cellId)).get();

export const enrollCellProcedure = scopedProcedure(['cell:enroll'])(
  enrollCellContract,
)((input, ctx) => {
  const body = input.body;
  const now = ctx.clock.now();
  const cellId = asCellId(scopedId(body.projectId, body.name));
  const sessionToken = mintToken(TOKEN_PREFIXES.cell);
  const expiresAt = addMs(now, CELL_SESSION_TTL_MS);

  immediateTx(ctx.db, (tx) => {
    const project = requireProject(tx, body.projectId);
    const existing = findCell(tx, cellId);
    if (existing?.status === 'revoked')
      throw new Forbidden(`Cell ${body.name} is revoked`);

    if (existing === undefined) {
      tx.insert(cells)
        .values({
          cellId,
          name: body.name,
          projectId: project.projectId,
          allowedLinesJson: body.allowedLines,
          status: 'online',
          runnersJson: body.runners,
          localWorktreesJson: [],
          createdAt: now,
        })
        .run();
    } else {
      tx.update(cells)
        .set({
          allowedLinesJson: body.allowedLines,
          runnersJson: body.runners,
          status: 'online',
        })
        .where(eq(cells.cellId, cellId))
        .run();
    }

    tx.insert(safeTokens)
      .values({
        tokenId: asTokenId(crypto.randomUUID()),
        tokenHash: hashToken(sessionToken),
        prefix: TOKEN_PREFIXES.cell,
        kind: 'cell_session',
        name: `${body.name} session`,
        scopesJson: ['cell:worker'],
        cellId,
        expiresAt,
        createdAt: now,
      })
      .run();
  });

  return { code: 201 as const, cellId, sessionToken, expiresAt };
});
