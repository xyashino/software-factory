import { z } from 'zod';
import { Refused } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';

const STOP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

const StopSchema = z.object({ dataDir: z.string().min(1) }).strict();

export type StopResult =
  { outcome: 'stopped' } | { outcome: 'not-running'; warning?: string };

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

export const stopHq = define({ kind: 'supervisor' })(StopSchema)<StopResult>(
  async (input, ctx) => {
    const pid = await ctx.pidFile.read(input.dataDir);
    if (pid === null || !ctx.process.isAlive(pid)) {
      await ctx.pidFile.remove(input.dataDir);
      if (await ctx.hq.probe()) {
        return {
          outcome: 'not-running',
          warning: `something answers on ${ctx.connection.url}, not started by sf`,
        };
      }
      return { outcome: 'not-running' };
    }
    ctx.process.terminate(pid);
    if (!(await waitUntilExited(ctx, pid))) {
      throw new Refused(`factory server ${pid} did not stop within 10 s`);
    }
    await ctx.pidFile.remove(input.dataDir);
    return { outcome: 'stopped' };
  },
);
