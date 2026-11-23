import { z } from 'zod';

export const FactoryCredentialSchema = z
  .object({
    url: z.url(),
    factoryId: z.string().min(1),
    sessionToken: z.string().min(1),
  })
  .strict();

export type FactoryCredential = z.infer<typeof FactoryCredentialSchema>;
