import { z } from 'zod';
import {
  ProjectsScaleReplySchema,
  ScaleReplySchema,
  ScaleRequestBodySchema,
  type ProjectScale,
} from '@repo/factory-contracts/scale.contract';
import { define } from '../../core/procedure';

const EmptySchema = z.object({}).strict();

const SCALE_ROUTE = '/scale';

export type FactoryProject = ProjectScale;

export const listFactoryProjects = define({ kind: 'supervisor' })(EmptySchema)<
  FactoryProject[]
>(
  async (_input, ctx) =>
    ProjectsScaleReplySchema.parse(await ctx.factory.get(SCALE_ROUTE)).projects,
);

export const scaleFactoryCells = define({ kind: 'supervisor' })(
  ScaleRequestBodySchema,
)<{
  projectId: string;
}>(async (input, ctx) =>
  ScaleReplySchema.parse(await ctx.factory.put(SCALE_ROUTE, input)),
);
