import { z } from 'zod';
import { isLoopbackUrl } from './loopback';

const DEFAULT_FACTORY_URL = 'http://127.0.0.1:7070';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4321;

const configSchema = z
  .object({
    FACTORY_URL: z.url().default(DEFAULT_FACTORY_URL),
    FACTORY_PROJECT_ID: z.string().min(1),
    FACTORY_DATA_DIR: z.string().min(1).optional(),
    FACTORY_TOKEN: z.string().min(1).optional(),
    HOST: z.string().min(1).default(DEFAULT_HOST),
    PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  })
  .superRefine((config, ctx) => {
    if (config.FACTORY_TOKEN !== undefined) return;
    if (!isLoopbackUrl(config.FACTORY_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['FACTORY_TOKEN'],
        message: 'required for a non-loopback FACTORY_URL',
      });
    } else if (config.FACTORY_DATA_DIR === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['FACTORY_DATA_DIR'],
        message: 'required to read the join secret on loopback',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

const describeFailure = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

export const loadConfig = (env: Record<string, string | undefined>): Config => {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${describeFailure(result.error)}`);
  }
  return result.data;
};
