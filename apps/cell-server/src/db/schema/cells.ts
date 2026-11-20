import { sql } from 'drizzle-orm';
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { FactoryId, SlotId } from '../../domain/common/brand';
import { DESIRED_STATES, RUNTIME_STATUSES } from '../../domain/cells/cell-slot';
import { idText, timestamps } from '../columns';
import { factories } from './factories';

export const cells = sqliteTable(
  'cells',
  {
    slotId: idText<SlotId>('slot_id').primaryKey(),
    cellId: text('cell_id'),
    factoryId: idText<FactoryId>('factory_id')
      .notNull()
      .references(() => factories.factoryId),
    repoRoot: text('repo_root').notNull(),
    name: text('name').notNull(),
    desiredState: text('desired_state', { enum: DESIRED_STATES }).notNull(),
    runtimeStatus: text('runtime_status', { enum: RUNTIME_STATUSES }).notNull(),
    pid: integer('pid'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('idx_cells_repo_root_name').on(table.repoRoot, table.name),
    uniqueIndex('idx_cells_factory_cell_id')
      .on(table.factoryId, table.cellId)
      .where(sql`${table.cellId} IS NOT NULL`),
  ],
);
