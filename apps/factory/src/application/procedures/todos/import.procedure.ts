import { z } from 'zod';
import { parseTodo } from '../../../domain/todo/parse-todo';
import { Refused } from '../../core/errors';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';
import type { ServerPort } from '../../ports/server.port';

const IMPORT_ROUTE = '/api/v1/queue/import';

const ImportSchema = z
  .object({
    configPath: z.string().min(1),
    dir: z.string().min(1),
    dryRun: z.boolean(),
  })
  .strict();

const ImportErrorSchema = z.object({
  filename: z.string(),
  message: z.string(),
});

const ImportReplySchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(ImportErrorSchema),
});

const RejectedSchema = z.object({ errors: z.array(ImportErrorSchema) });

export interface SkippedTodo {
  filename: string;
  reason: string;
}

export type ImportError = z.infer<typeof ImportErrorSchema>;

export interface ImportResult {
  mode: 'dry_run' | 'apply';
  projectId: string;
  sent: string[];
  skipped: SkippedTodo[];
  created: number;
  updated: number;
  unchanged: number;
  errors: ImportError[];
}

interface Batch {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
}

interface SentFile {
  filename: string;
  markdown: string;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const hasLine = (frontmatter: Record<string, unknown>): boolean =>
  typeof frontmatter.line === 'string' && frontmatter.line.trim() !== '';

const sendBatch = async (
  server: ServerPort,
  body: unknown,
  secret: string,
): Promise<Batch> => {
  try {
    return ImportReplySchema.parse(
      await server.call(IMPORT_ROUTE, body, secret),
    );
  } catch (error) {
    if (error instanceof Refused) {
      const rejected = RejectedSchema.safeParse(error.details);
      if (rejected.success) {
        return {
          created: 0,
          updated: 0,
          skipped: 0,
          errors: rejected.data.errors,
        };
      }
    }
    throw error;
  }
};

export const importTodos = define({ kind: 'supervisor' })(
  ImportSchema,
)<ImportResult>(async (input, ctx) => {
  const projectId = await readProjectId(ctx, input.configPath);
  const sent: SentFile[] = [];
  const skipped: SkippedTodo[] = [];
  for (const file of await ctx.todoFiles.list(input.dir)) {
    try {
      const todo = parseTodo(file.text);
      if (!hasLine(todo.frontmatter)) {
        skipped.push({ filename: file.filename, reason: 'no line' });
        continue;
      }
      sent.push({ filename: file.filename, markdown: file.text });
    } catch (error) {
      skipped.push({ filename: file.filename, reason: errorText(error) });
    }
  }
  const preview = {
    projectId,
    sent: sent.map((file) => file.filename),
    skipped,
  };
  if (input.dryRun) {
    return {
      ...preview,
      mode: 'dry_run',
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    };
  }
  const secret = await readSecret(ctx);
  const batch = await sendBatch(
    ctx.server,
    {
      commandId: crypto.randomUUID(),
      projectId,
      mode: 'apply',
      files: sent,
    },
    secret,
  );
  return {
    ...preview,
    mode: 'apply',
    created: batch.created,
    updated: batch.updated,
    unchanged: batch.skipped,
    errors: batch.errors,
  };
});
