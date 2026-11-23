import { z } from 'zod';
import {
  DaemonStatusSchema,
  type DaemonStatus,
} from '../../../domain/factory/hq-state';
import { define, type Ports } from '../../core/procedure';
import { healthPidOf } from './health';

const StatusSchema = z.object({ dataDir: z.string().min(1) }).strict();

export interface StatusFactoryResult {
  running: boolean;
  healthy: boolean;
  pid: number | null;
  daemon: DaemonStatus | null;
}

const daemonStatusOf = async (
  ctx: Pick<Ports, 'factory'>,
): Promise<DaemonStatus | null> => {
  try {
    return DaemonStatusSchema.parse(await ctx.factory.get('/status'));
  } catch {
    return null;
  }
};

export const statusFactory = define({ kind: 'operator' })(
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
    daemon: running ? await daemonStatusOf(ctx) : null,
  };
});
