import { z } from 'zod';
import { define } from '../../core/procedure';

const StatusSchema = z
  .object({
    dataDir: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().positive(),
  })
  .strict();

export type StatusWebResult =
  { running: true; pid: number; url: string } | { running: false };

export const statusWeb = define({ kind: 'supervisor' })(
  StatusSchema,
)<StatusWebResult>(async (input, ctx) => {
  const pid = await ctx.webPidFile.read(input.dataDir);
  if (pid === null || !ctx.process.isAlive(pid)) {
    return { running: false };
  }
  return { running: true, pid, url: `http://${input.host}:${input.port}` };
});
