import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { isLoopbackUrl } from './loopback';

const DEFAULT_HQ_URL = 'http://127.0.0.1:7070';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4321;

const configSchema = z
  .object({
    HQ_URL: z.url().default(DEFAULT_HQ_URL),
    HQ_PROJECT_ID: z.string().min(1),
    HQ_DATA_DIR: z.string().min(1).optional(),
    HQ_TOKEN: z.string().min(1).optional(),
    HOST: z.string().min(1).default(DEFAULT_HOST),
    PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  })
  .superRefine((config, ctx) => {
    if (config.HQ_TOKEN !== undefined) return;
    if (!isLoopbackUrl(config.HQ_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['HQ_TOKEN'],
        message: 'required for a non-loopback HQ_URL',
      });
    }
  });

type Env = Record<string, string | undefined>;

export type Config = z.infer<typeof configSchema>;

const withHqNames = (env: Env): Env => ({
  ...env,
  HQ_URL: env.HQ_URL ?? env.FACTORY_URL,
  HQ_PROJECT_ID: env.HQ_PROJECT_ID ?? env.FACTORY_PROJECT_ID,
  HQ_DATA_DIR: env.HQ_DATA_DIR ?? env.FACTORY_DATA_DIR,
  HQ_TOKEN: env.HQ_TOKEN ?? env.FACTORY_TOKEN,
});

const defaultDataDir = (env: Env): string =>
  join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'sf');

const withDefaultDataDir = (env: Env): Env =>
  env.HQ_DATA_DIR === undefined && isLoopbackUrl(env.HQ_URL ?? DEFAULT_HQ_URL)
    ? { ...env, HQ_DATA_DIR: defaultDataDir(env) }
    : env;

const describeFailure = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

export const loadConfig = (env: Env): Config => {
  const result = configSchema.safeParse(withDefaultDataDir(withHqNames(env)));
  if (!result.success) {
    throw new Error(`Invalid configuration: ${describeFailure(result.error)}`);
  }
  return result.data;
};
