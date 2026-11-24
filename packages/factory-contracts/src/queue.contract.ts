import { z } from 'zod';

const SkippedTodoSchema = z.object({
  filename: z.string(),
  reason: z.string(),
});

const ImportErrorSchema = z.object({
  filename: z.string(),
  message: z.string(),
});

export const FactoryImportRequestSchema = z
  .object({
    repoRoot: z.string().min(1),
    dir: z.string().min(1).optional(),
    dryRun: z.boolean().default(false),
    paused: z.boolean().default(false),
    local: z.boolean().default(false),
  })
  .strict();

export const FactoryImportReplySchema = z.object({
  mode: z.enum(['dry_run', 'apply']),
  projectId: z.string().min(1),
  sent: z.array(z.string()),
  skipped: z.array(SkippedTodoSchema),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  paused: z.number().int(),
  errors: z.array(ImportErrorSchema),
});

export type FactoryImportRequest = z.infer<typeof FactoryImportRequestSchema>;
export type FactoryImportReply = z.infer<typeof FactoryImportReplySchema>;
