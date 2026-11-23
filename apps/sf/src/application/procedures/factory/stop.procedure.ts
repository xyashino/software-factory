import { z } from 'zod';
import { Refused } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';

const STOP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

const StopSchema = z.object({ dataDir: z.string().min(1) }).strict();

export type StopFactoryResult =
  { outcome: 'stopped' } | { outcome: 'not_running' };

const waitUntilExited = async (ctx: Ports, pid: number): Promise<boolean> => {
  const deadline = ctx.clock.now() + STOP_TIMEOUT_MS;
  while (ctx.process.isAlive(pid)) {
    if (ctx.clock.now() >= deadline) {
      return false;
    }
    await ctx.clock.sleep(POLL_INTERVAL_MS);
  }
  return true;
};

export const stopFactory = define({ kind: 'operator' })(
  StopSchema,
)<StopFactoryResult>(async (input, ctx) => {
  const pid = await ctx.factoryPidFile.read(input.dataDir);
  if (pid === null || !ctx.process.isAlive(pid)) {
    await ctx.factoryPidFile.remove(input.dataDir);
    return { outcome: 'not_running' };
  }
  ctx.process.terminate(pid);
  if (!(await waitUntilExited(ctx, pid))) {
    throw new Refused(`factory ${pid} did not stop within 30 s`);
  }
  await ctx.factoryPidFile.remove(input.dataDir);
  return { outcome: 'stopped' };
});
