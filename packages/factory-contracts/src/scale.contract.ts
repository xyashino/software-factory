import { z } from 'zod';

export const ActivitySchema = z
  .object({
    state: z.enum(['idle', 'running']),
    writes: z.boolean().default(false),
    since: z.number(),
  })
  .strict();

export const CellRecordSchema = z.object({
  cellId: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  repoRoot: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.number(),
  state: z.enum(['idle', 'running']),
  writes: z.boolean(),
  since: z.number(),
});

export const ScaleRequestBodySchema = z
  .object({
    repoRoot: z.string().min(1),
    count: z.number().int().min(0),
    lines: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

export const ScaleReplySchema = z.object({ projectId: z.string().min(1) });

export const ProjectScaleSchema = z.object({
  projectId: z.string().min(1),
  repoRoot: z.string().min(1),
  desired: z.number().int().min(0),
  running: z.number().int().min(0),
  crashLoop: z.boolean(),
  cells: z.array(CellRecordSchema),
});

export const ProjectsScaleReplySchema = z.object({
  projects: z.array(ProjectScaleSchema),
});

export const ActivityReplySchema = z.object({ cellId: z.string().min(1) });

export type Activity = z.infer<typeof ActivitySchema>;
export type CellRecord = z.infer<typeof CellRecordSchema>;
export type ScaleRequestBody = z.infer<typeof ScaleRequestBodySchema>;
export type ProjectScale = z.infer<typeof ProjectScaleSchema>;
