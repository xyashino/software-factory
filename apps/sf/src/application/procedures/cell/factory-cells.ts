import { z } from 'zod';
import { define, type Ports } from '../../core/procedure';
import { type CellRow, listCells } from './list.procedure';

const EmptySchema = z.object({}).strict();

const FactoryCellSchema = z.object({
  cellId: z.string().min(1),
  name: z.string().min(1),
  repoRoot: z.string().min(1),
  pid: z.number().int().positive(),
});

const CellsReplySchema = z.object({ cells: z.array(FactoryCellSchema) });

const CreateSchema = z
  .object({
    repoRoot: z.string().min(1),
    name: z.string().min(1).optional(),
    lines: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

const RemoveSchema = z.object({ id: z.string().trim().min(1) }).strict();

const CELLS_ROUTE = '/cells';

export interface FactoryCell {
  cellId: string;
  name: string;
  repoRoot: string;
  pid: number;
}

export interface CellWithPidRow extends CellRow {
  pid: number | null;
}

const runningCellsOf = async (ctx: Ports): Promise<FactoryCell[]> =>
  CellsReplySchema.parse(await ctx.factoryDaemon.get(CELLS_ROUTE)).cells;

export const listFactoryCells = define({ kind: 'supervisor' })(EmptySchema)<
  FactoryCell[]
>((_input, ctx) => runningCellsOf(ctx));

export const createFactoryCell = define({ kind: 'supervisor' })(
  CreateSchema,
)<FactoryCell>(async (input, ctx) =>
  FactoryCellSchema.parse(await ctx.factoryDaemon.post(CELLS_ROUTE, input)),
);

export const removeFactoryCell = define({ kind: 'supervisor' })(
  RemoveSchema,
)<string>(async (input, ctx) => {
  const reply = z
    .object({ cellId: z.string().min(1) })
    .parse(
      await ctx.factoryDaemon.delete(
        `${CELLS_ROUTE}/${encodeURIComponent(input.id)}`,
      ),
    );
  return reply.cellId;
});

export const listCellsWithFactory = define({ kind: 'supervisor' })(EmptySchema)<
  CellWithPidRow[]
>(async (_input, ctx) => {
  const running = await runningCellsOf(ctx);
  const { rows } = await listCells.execute({}, ctx);
  return rows.map((row) => ({
    ...row,
    pid: running.find((cell) => cell.name === row.name)?.pid ?? null,
  }));
});
