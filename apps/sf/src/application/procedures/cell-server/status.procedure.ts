import { z } from 'zod';
import { define } from '../../core/procedure';
import { isAnswering } from './probe';
import { type Settings, SettingsReplySchema } from './shapes';

const StatusSchema = z.object({ dataDir: z.string().min(1) }).strict();

export interface StatusResult {
  pid: number | null;
  alive: boolean;
  healthy: boolean;
  settings: Settings | null;
}

export const statusCellServer = define({ kind: 'supervisor' })(
  StatusSchema,
)<StatusResult>(async (input, ctx) => {
  const pid = await ctx.cellServerPidFile.read(input.dataDir);
  const alive = pid !== null && ctx.process.isAlive(pid);
  const healthy = await isAnswering(ctx);
  const settings = healthy
    ? SettingsReplySchema.parse(await ctx.cellServer.get('/api/v1/settings'))
        .settings
    : null;
  return { pid, alive, healthy, settings };
});
