import { z } from 'zod';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readProjectId, readSecret } from '../../core/repo-access';

const EXPORT_ROUTE = '/api/v1/queue/export';
const FILENAME = /^[\w-]+\.md$/;

const ExportSchema = z
  .object({
    configPath: z.string().min(1),
    dir: z.string().min(1),
    force: z.boolean(),
  })
  .strict();

const ExportReplySchema = z.object({
  projectId: z.string(),
  files: z.array(z.object({ filename: z.string(), markdown: z.string() })),
});

export interface ExportResult {
  projectId: string;
  written: string[];
  refused: string[];
}

export const exportTodos = define({ kind: 'operator' })(
  ExportSchema,
)<ExportResult>(async (input, ctx) => {
  const projectId = await readProjectId(ctx, input.configPath);
  const secret = await readSecret(ctx);
  const reply = ExportReplySchema.parse(
    await ctx.hq.get(EXPORT_ROUTE, { projectId }, secret),
  );
  if (reply.projectId !== projectId) {
    throw new ArgumentError(
      `server exported project ${reply.projectId}, config says ${projectId}`,
    );
  }
  const result: ExportResult = { projectId, written: [], refused: [] };
  for (const file of reply.files) {
    if (!FILENAME.test(file.filename)) {
      throw new ArgumentError(`unsafe filename from server: ${file.filename}`);
    }
    const outcome = await ctx.todoFiles.write(
      input.dir,
      file.filename,
      file.markdown,
      input.force,
    );
    if (outcome === 'written') {
      result.written.push(file.filename);
    } else {
      result.refused.push(file.filename);
    }
  }
  return result;
});
