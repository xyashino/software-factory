import { z } from 'zod';
import { REPO_CONFIG_PATH } from '../../../config';
import { joinPath } from '../../../domain/common/path';
import { define } from '../../core/procedure';
import { mintSupervisorToken, saveLocalTarget } from './local-token';

const TokenCreateSchema = z
  .object({
    bin: z.string().min(1),
    serverArgs: z.array(z.string().min(1)).min(1),
    cwd: z.string().min(1),
    dbPath: z.string().min(1),
    url: z.string().url(),
    save: z.boolean(),
    global: z.boolean(),
  })
  .strict();

export interface TokenCreateResult {
  token: string | null;
}

export const createHqToken = define({ kind: 'supervisor' })(
  TokenCreateSchema,
)<TokenCreateResult>(async (input, ctx) => {
  const token = await mintSupervisorToken(ctx, input);
  if (!input.save) {
    return { token };
  }
  const inRepo = await ctx.fs.exists(joinPath(input.cwd, REPO_CONFIG_PATH));
  if (input.global || !inRepo) {
    saveLocalTarget(ctx, input.url, token);
  } else {
    await ctx.tokens.write(token);
  }
  return { token: null };
});
