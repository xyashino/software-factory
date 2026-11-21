import { z } from 'zod';

const TargetSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
});

const SharedConfigSchema = z.object({
  current: z.string().min(1).nullable(),
  targets: z.record(z.string().min(1), TargetSchema),
});

export type SharedConfig = z.infer<typeof SharedConfigSchema>;

export type SharedTarget = { name: string; url: string; token: string };

export const parseSharedConfig = (raw: unknown): SharedConfig =>
  SharedConfigSchema.parse(raw);

export const resolveSharedTarget = (
  config: SharedConfig,
  requested?: string,
): SharedTarget | null => {
  const name = requested ?? config.current;
  if (name === null) return null;
  const target: z.infer<typeof TargetSchema> | undefined = config.targets[name];
  if (target === undefined)
    throw new Error(`shared config has no target named ${name}`);
  return { name, url: target.url, token: target.token };
};
