import { z } from 'zod';
import { Refused, Unreachable } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';

const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

const StartSchema = z
  .object({
    bin: z.string().min(1),
    webEntry: z.string().min(1),
    webArgs: z.array(z.string().min(1)).min(1),
    dataDir: z.string().min(1),
    factoryUrl: z.url(),
    projectId: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().positive(),
  })
  .strict();

export interface StartWebResult {
  pid: number;
  url: string;
}

const waitUntilAnswering = async (
  ctx: Ports,
  url: string,
): Promise<boolean> => {
  const deadline = ctx.clock.now() + START_TIMEOUT_MS;
  while (ctx.clock.now() < deadline) {
    if (await ctx.process.probeUrl(url)) {
      return true;
    }
    await ctx.clock.sleep(POLL_INTERVAL_MS);
  }
  return false;
};

export const startWeb = define({ kind: 'supervisor' })(
  StartSchema,
)<StartWebResult>(async (input, ctx) => {
  const previous = await ctx.webPidFile.read(input.dataDir);
  if (previous !== null && ctx.process.isAlive(previous)) {
    throw new Refused('web already running');
  }
  if (!(await ctx.hq.probe())) {
    throw new Unreachable(
      `factory server not answering at ${input.factoryUrl}; run sf hq start`,
    );
  }
  if (!(await ctx.fs.exists(input.webEntry))) {
    throw new Refused(
      `web entry not found at ${input.webEntry}; build apps/web-demo or set SF_WEB_DIR`,
    );
  }
  const url = `http://${input.host}:${input.port}`;
  const pid = await ctx.process.spawnDetached({
    command: input.bin,
    args: input.webArgs,
    env: {
      HQ_URL: input.factoryUrl,
      HQ_DATA_DIR: input.dataDir,
      HQ_PROJECT_ID: input.projectId,
      HOST: input.host,
      PORT: String(input.port),
    },
    logPath: `${input.dataDir}/web.log`,
  });
  await ctx.webPidFile.write(input.dataDir, pid);
  if (await waitUntilAnswering(ctx, url)) {
    return { pid, url };
  }
  ctx.process.terminate(pid);
  await ctx.webPidFile.remove(input.dataDir);
  throw new Unreachable(`web UI did not answer at ${url} within 10 s`);
});
