import { z } from 'zod';

export const HealthReplySchema = z.object({
  pid: z.number().int().positive(),
});

export const HqStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_connected') }).strict(),
  z.object({ kind: z.literal('ok') }).strict(),
  z.object({ kind: z.literal('unreachable'), since: z.number() }).strict(),
  z.object({ kind: z.literal('rejected') }).strict(),
]);

export const DaemonStatusSchema = z
  .object({
    pid: z.number().int().positive(),
    hq: HqStateSchema,
    url: z.string().nullable(),
    factoryId: z.string().nullable(),
    cells: z.number().int().nonnegative(),
  })
  .strict();

export const FactoryCredentialSchema = z
  .object({
    url: z.url(),
    factoryId: z.string().min(1),
    sessionToken: z.string().min(1),
  })
  .strict();

export type HealthReply = z.infer<typeof HealthReplySchema>;
export type HqState = z.infer<typeof HqStateSchema>;
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;
export type FactoryCredential = z.infer<typeof FactoryCredentialSchema>;
