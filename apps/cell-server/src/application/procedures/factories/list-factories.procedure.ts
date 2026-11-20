import { asc, desc } from 'drizzle-orm';
import { listFactoriesContract } from '../../../contracts/factories.contract';
import { factories } from '../../../db/schema/factories';
import { publicProcedure } from '../../core/procedure';
import { toFactoryDto } from './factory-dto';

export const listFactoriesProcedure = publicProcedure(listFactoriesContract)(
  (_input, ctx) => ({
    code: 200 as const,
    factories: ctx.db
      .select()
      .from(factories)
      .orderBy(desc(factories.isDefault), asc(factories.name))
      .all()
      .map(toFactoryDto),
  }),
);
