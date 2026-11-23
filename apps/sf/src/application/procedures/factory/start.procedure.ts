import { z } from 'zod';
import { FACTORY_PORT_ENV } from '../../../config';
import { Refused, Unreachable } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';
import { healthPidOf } from './daemon-health';

const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

const StartSchema = z
  .object({
    bin: z.string().min(1),
    args: z.array(z.string().min(1)).min(1),
    dataDir: z.string().min(1),
    logPath: z.string().min(1),
    factoryUrl: z.url(),
    token: z.string().min(1).nullable(),
    port: z.number().int().positive(),
  })
  .strict();

export interface StartFactoryResult {
  pid: number;
  url: string;
}

const waitUntilOwnedBy = async (ctx: Ports, pid: number): Promise<boolean> => {
  const deadline = ctx.clock.now() + START_TIMEOUT_MS;
  while (ctx.clock.now() < deadline) {
    if ((await healthPidOf(ctx)) === pid) {
      return true;
    }
    await ctx.clock.sleep(POLL_INTERVAL_MS);
  }
  return false;
};

export const startFactory = define({ kind: 'supervisor' })(
  StartSchema,
)<StartFactoryResult>(async (input, ctx) => {
  const previous = await ctx.factoryPidFile.read(input.dataDir);
  if (previous !== null && ctx.process.isAlive(previous)) {
    throw new Refused(`factory already running, pid ${previous}`);
  }
  const url = `http://127.0.0.1:${input.port}`;
  if (await ctx.process.probeUrl(`${url}/health`)) {
    throw new Refused(
      `port ${input.port} is in use by another process, set ${FACTORY_PORT_ENV}`,
    );
  }
  const pid = await ctx.process.spawnDetached({
    command: input.bin,
    args: input.args,
    cwd: input.dataDir,
    env: {
      [FACTORY_PORT_ENV]: String(input.port),
      FACTORY_URL: input.factoryUrl,
      ...(input.token === null ? {} : { FACTORY_TOKEN: input.token }),
    },
    logPath: input.logPath,
  });
  await ctx.factoryPidFile.write(input.dataDir, pid);
  if (await waitUntilOwnedBy(ctx, pid)) {
    return { pid, url };
  }
  ctx.process.terminate(pid);
  await ctx.factoryPidFile.remove(input.dataDir);
  throw new Unreachable(
    `factory did not answer at ${url} within 10 s, see ${input.logPath}`,
  );
});
