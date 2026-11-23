import { z } from 'zod';
import { define } from '../../core/procedure';

const EmptySchema = z.object({}).strict();

const CellStatusSchema = z.object({
  cellId: z.string().min(1),
  name: z.string().min(1),
  pid: z.number().int().positive(),
  state: z.enum(['idle', 'running']),
  writes: z.boolean(),
});

const ProjectSchema = z.object({
  projectId: z.string().min(1),
  repoRoot: z.string().min(1),
  desired: z.number().int().min(0),
  running: z.number().int().min(0),
  crashLoop: z.boolean(),
  cells: z.array(CellStatusSchema),
});

const ProjectsReplySchema = z.object({ projects: z.array(ProjectSchema) });

const ScaleSchema = z
  .object({
    repoRoot: z.string().min(1),
    count: z.number().int().min(0),
    lines: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

const SCALE_ROUTE = '/scale';

export type FactoryProject = z.infer<typeof ProjectSchema>;

export const listFactoryProjects = define({ kind: 'supervisor' })(EmptySchema)<
  FactoryProject[]
>(
  async (_input, ctx) =>
    ProjectsReplySchema.parse(await ctx.factoryDaemon.get(SCALE_ROUTE))
      .projects,
);

export const scaleFactoryCells = define({ kind: 'supervisor' })(ScaleSchema)<{
  projectId: string;
}>(async (input, ctx) =>
  z
    .object({ projectId: z.string().min(1) })
    .parse(await ctx.factoryDaemon.put(SCALE_ROUTE, input)),
);
