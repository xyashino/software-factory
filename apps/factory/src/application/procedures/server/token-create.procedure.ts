import { z } from 'zod';
import { Refused } from '../../core/errors';
import { define } from '../../core/procedure';

const TokenCreateSchema = z
  .object({
    bin: z.string().min(1),
    serverEntry: z.string().min(1),
    cwd: z.string().min(1),
    dbPath: z.string().min(1),
    save: z.boolean(),
  })
  .strict();

export interface TokenCreateResult {
  token: string | null;
}

export const createServerToken = define({ kind: 'supervisor' })(
  TokenCreateSchema,
)<TokenCreateResult>(async (input, ctx) => {
  const result = await ctx.process.run(
    input.bin,
    [input.serverEntry, 'admin', 'token', 'create'],
    input.cwd,
    { FACTORY_DB_PATH: input.dbPath },
  );
  const token = result.stdout.trim();
  if (result.exitCode !== 0 || token.length === 0) {
    throw new Refused(`token create failed with exit ${result.exitCode}`);
  }
  if (input.save) {
    await ctx.tokens.write(token);
    return { token: null };
  }
  return { token };
});
