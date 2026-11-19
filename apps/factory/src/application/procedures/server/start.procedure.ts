import { z } from 'zod';
import { Refused, Unreachable } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';

const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

const StartSchema = z
  .object({
    bin: z.string().min(1),
    serverEntry: z.string().min(1),
    dataDir: z.string().min(1),
    dbPath: z.string().min(1),
    port: z.number().int().positive(),
  })
  .strict();

export interface StartResult {
  pid: number;
}

const waitUntilAnswering = async (ctx: Ports): Promise<boolean> => {
  const deadline = ctx.clock.now() + START_TIMEOUT_MS;
  while (ctx.clock.now() < deadline) {
    if (await ctx.server.probe()) {
      return true;
    }
    await ctx.clock.sleep(POLL_INTERVAL_MS);
  }
  return false;
};

export const startServer = define({ kind: 'supervisor' })(
  StartSchema,
)<StartResult>(async (input, ctx) => {
  const previous = await ctx.pidFile.read(input.dataDir);
  if (previous !== null && ctx.process.isAlive(previous)) {
    throw new Refused('server already running');
  }
  const pid = await ctx.process.spawnDetached({
    command: input.bin,
    args: [input.serverEntry],
    env: {
      FACTORY_DB_PATH: input.dbPath,
      FACTORY_PORT: String(input.port),
    },
    logPath: `${input.dataDir}/server.log`,
  });
  await ctx.pidFile.write(input.dataDir, pid);
  if (await waitUntilAnswering(ctx)) {
    return { pid };
  }
  ctx.process.terminate(pid);
  await ctx.pidFile.remove(input.dataDir);
  throw new Unreachable('factory server did not answer within 10 s');
});
