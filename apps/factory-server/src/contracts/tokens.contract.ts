import { z } from 'zod';
import { idParams, titleSchema } from './common';

const issuedTokenFields = {
  tokenId: z.string(),
  kind: z.enum(['supervisor', 'cell_join', 'cell_session']),
  token: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.number().int().nullable(),
};

export const issueTokenContract = {
  in: {
    body: z.object({
      kind: z.enum(['supervisor', 'cell_join']),
      name: titleSchema,
      expiresAt: z.number().int().nullable().default(null),
    }),
  },
  out: {
    201: z.object({ code: z.literal(201), ...issuedTokenFields }),
  },
};

export const rotateTokenContract = {
  out: {
    200: z.object({ code: z.literal(200), ...issuedTokenFields }),
  },
};

export const revokeTokenContract = {
  in: { params: idParams },
  out: {
    200: z.object({ code: z.literal(200) }),
  },
};
