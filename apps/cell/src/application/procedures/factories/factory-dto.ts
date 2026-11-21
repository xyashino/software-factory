import type { factories } from '../../../db/schema/factories';

type FactoryRow = typeof factories.$inferSelect;

export const toFactoryDto = (row: FactoryRow) => ({
  factoryId: row.factoryId,
  name: row.name,
  url: row.url,
  isDefault: row.isDefault,
  hasJoinToken: row.joinToken !== null,
  hasSupervisorToken: row.supervisorToken !== null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
