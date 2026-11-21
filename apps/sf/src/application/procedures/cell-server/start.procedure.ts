import { z } from 'zod';
import { Refused, Unreachable } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';
import { isAnswering } from './probe';

const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;
const LOG_FILE = 'cell-server.log';

const StartSchema = z
  .object({
    bin: z.string().min(1),
    serverArgs: z.array(z.string().min(1)).min(1),
    dataDir: z.string().min(1),
    xdgDataHome: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().positive(),
  })
  .strict();

export interface StartResult {
  pid: number;
}

const waitUntilAnswering = async (ctx: Ports): Promise<boolean> => {
  const deadline = ctx.clock.now() + START_TIMEOUT_MS;
  while (ctx.clock.now() < deadline) {
    if (await isAnswering(ctx)) {
      return true;
    }
    await ctx.clock.sleep(POLL_INTERVAL_MS);
  }
  return false;
};

export const startCellServer = define({ kind: 'supervisor' })(
  StartSchema,
)<StartResult>(async (input, ctx) => {
  const previous = await ctx.cellServerPidFile.read(input.dataDir);
  if (
    (previous !== null && ctx.process.isAlive(previous)) ||
    (await isAnswering(ctx))
  ) {
    throw new Refused('cell server already running');
  }
  const pid = await ctx.process.spawnDetached({
    command: input.bin,
    args: input.serverArgs,
    env: {
      CELL_SERVER_HOST: input.host,
      CELL_SERVER_PORT: String(input.port),
      XDG_DATA_HOME: input.xdgDataHome,
    },
    logPath: `${input.dataDir}/${LOG_FILE}`,
  });
  await ctx.cellServerPidFile.write(input.dataDir, pid);
  if (await waitUntilAnswering(ctx)) {
    return { pid };
  }
  ctx.process.terminate(pid);
  await ctx.cellServerPidFile.remove(input.dataDir);
  throw new Unreachable('cell server did not answer within 10 s');
});
