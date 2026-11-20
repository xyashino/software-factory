import { z } from 'zod';

export const issueTokenContract = {
  in: {
    body: z.object({
      kind: z.enum(['supervisor', 'cell_join']),
      name: z.string().trim().min(1),
      expiresAt: z.number().int().nullable().default(null),
    }),
  },
  out: {
    201: z.object({
      code: z.literal(201),
      tokenId: z.string(),
      kind: z.enum(['supervisor', 'cell_join', 'cell_session']),
      token: z.string(),
      scopes: z.array(z.string()),
      expiresAt: z.number().int().nullable(),
    }),
  },
};
