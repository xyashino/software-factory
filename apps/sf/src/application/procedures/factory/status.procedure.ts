import { z } from 'zod';
import { define } from '../../core/procedure';
import { healthPidOf } from './daemon-health';

const StatusSchema = z.object({ dataDir: z.string().min(1) }).strict();

export interface StatusFactoryResult {
  running: boolean;
  healthy: boolean;
  pid: number | null;
}

export const statusFactory = define({ kind: 'supervisor' })(
  StatusSchema,
)<StatusFactoryResult>(async (input, ctx) => {
  const filePid = await ctx.factoryPidFile.read(input.dataDir);
  const healthPid = await healthPidOf(ctx);
  const running =
    filePid !== null && healthPid === filePid && ctx.process.isAlive(filePid);
  return {
    running,
    healthy: healthPid !== null,
    pid: running ? filePid : null,
  };
});
