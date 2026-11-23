import { z } from 'zod';
import { LOCAL_TARGET } from '../../../domain/connection/connection-config';
import { Refused, Unreachable } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';
import { mintOperatorToken, saveLocalTarget } from './local-token';

const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;
const LOG_TAIL_LINES = 20;

const StartSchema = z
  .object({
    bin: z.string().min(1),
    serverArgs: z.array(z.string().min(1)).min(1),
    cwd: z.string().min(1),
    dataDir: z.string().min(1),
    dbPath: z.string().min(1),
    port: z.number().int().positive(),
    host: z.string().min(1).optional(),
  })
  .strict();

export interface StartResult {
  pid: number;
}

const logTailOf = async (ctx: Ports, logPath: string): Promise<string> => {
  try {
    const lines = (await ctx.fs.readText(logPath)).trimEnd().split('\n');
    return lines.slice(-LOG_TAIL_LINES).join('\n');
  } catch {
    return '(no server.log)';
  }
};

const waitUntilAnswering = async (
  ctx: Ports,
  pid: number,
): Promise<boolean> => {
  const deadline = ctx.clock.now() + START_TIMEOUT_MS;
  while (ctx.clock.now() < deadline) {
    if (await ctx.hq.probe()) {
      return true;
    }
    if (!ctx.process.isAlive(pid)) {
      return false;
    }
    await ctx.clock.sleep(POLL_INTERVAL_MS);
  }
  return false;
};

export const startHq = define({ kind: 'operator' })(StartSchema)<StartResult>(
  async (input, ctx) => {
    const previous = await ctx.pidFile.read(input.dataDir);
    if (previous !== null && ctx.process.isAlive(previous)) {
      throw new Refused('server already running');
    }
    if (await ctx.hq.probe()) {
      await ctx.pidFile.remove(input.dataDir);
      throw new Refused(
        `something already answers on ${ctx.connection.url}, not started by sf`,
      );
    }
    const pid = await ctx.process.spawnDetached({
      command: input.bin,
      args: input.serverArgs,
      env: {
        HQ_DATA_DIR: input.dataDir,
        HQ_DB_PATH: input.dbPath,
        HQ_PORT: String(input.port),
        ...(input.host === undefined ? {} : { HQ_HOST: input.host }),
      },
      logPath: `${input.dataDir}/server.log`,
    });
    await ctx.pidFile.write(input.dataDir, pid);
    const answering = await waitUntilAnswering(ctx, pid);
    if (!ctx.process.isAlive(pid) || !answering) {
      const reason = ctx.process.isAlive(pid)
        ? 'factory server did not answer within 10 s'
        : `factory server pid ${pid} exited on start`;
      const tail = await logTailOf(ctx, `${input.dataDir}/server.log`);
      ctx.process.terminate(pid);
      await ctx.pidFile.remove(input.dataDir);
      throw new Unreachable(`${reason}\n${tail}`);
    }
    if (ctx.connections.read().targets[LOCAL_TARGET] === undefined) {
      const token = await mintOperatorToken(ctx, input);
      saveLocalTarget(ctx, `http://127.0.0.1:${input.port}`, token);
    }
    return { pid };
  },
);
