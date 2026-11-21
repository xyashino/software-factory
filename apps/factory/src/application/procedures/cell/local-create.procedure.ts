import { z } from 'zod';
import {
  CELL_LINES_ENV,
  JOIN_TOKEN_ENV,
  REPO_CONFIG_PATH,
} from '../../../config';
import { cellNameOf } from '../../../domain/cell/cell-name';
import {
  allocateLocalNames,
  type LocalSlot,
} from '../../../domain/cell/local-slot';
import type { Access } from '../../../domain/access';
import { joinPath } from '../../../domain/common/path';
import { ArgumentError, Refused } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { createToken } from '../tokens/token-create.procedure';
import { livePidOf } from './local-pid';

const SUPERVISOR: Access = { kind: 'supervisor' };

const CreateSchema = z
  .object({
    repoRoot: z.string().min(1),
    count: z.number().int().min(1),
    name: z.string().min(1).optional(),
    baseName: z.string().min(1),
    lines: z.array(z.string().min(1)).min(1).optional(),
    launcher: z.array(z.string()),
  })
  .strict();

const takenNamesOf = (ports: Ports, slots: readonly LocalSlot[]): string[] =>
  slots
    .filter((slot) => livePidOf(ports, slot) !== null)
    .map((slot) => slot.name);

const workerEnvOf = (
  ports: Ports,
  joinToken: string,
  lines: readonly string[] | undefined,
): Record<string, string> => ({
  FACTORY_URL: ports.connection.url,
  ...(ports.connection.token === null
    ? {}
    : { FACTORY_TOKEN: ports.connection.token }),
  [JOIN_TOKEN_ENV]: joinToken,
  ...(lines === undefined ? {} : { [CELL_LINES_ENV]: lines.join(',') }),
});

export const createLocalCells = define({ kind: 'supervisor' })(CreateSchema)<
  LocalSlot[]
>(async (input, ctx) => {
  if (input.name !== undefined && input.count > 1) {
    throw new ArgumentError('name is only allowed with count 1');
  }
  await readProjectId(ctx, joinPath(input.repoRoot, REPO_CONFIG_PATH));
  const slots = await ctx.localSlots.read();
  const taken = takenNamesOf(ctx, slots);
  let names: string[];
  if (input.name === undefined) {
    names = allocateLocalNames(cellNameOf(input.baseName), input.count, taken);
  } else {
    const name = cellNameOf(input.name);
    if (taken.includes(name)) {
      throw new Refused(`cell ${name} already running`);
    }
    names = [name];
  }

  const created: LocalSlot[] = [];
  for (const name of names) {
    const minted = await createToken.execute(
      { kind: 'cell_join', name },
      { ...ctx, token: SUPERVISOR, principal: SUPERVISOR },
    );
    const slotId = crypto.randomUUID();
    const pid = await ctx.process.spawnDetached({
      command: process.execPath,
      args: [...input.launcher, 'cell', 'start', '--name', name],
      cwd: input.repoRoot,
      env: workerEnvOf(ctx, minted.token, input.lines),
      logPath: ctx.localSlots.logPathOf(slotId),
    });
    created.push({
      slotId,
      name,
      factory: ctx.connection.url,
      repoRoot: input.repoRoot,
      pid,
      state: 'running',
      createdAt: ctx.clock.now(),
    });
  }
  await ctx.localSlots.write([...slots, ...created]);
  return created;
});
