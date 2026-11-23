import { z } from 'zod';
import { idParams, titleSchema } from '@repo/zod-contract-kit/fields';

const issuedTokenFields = {
  tokenId: z.string(),
  kind: z.enum([
    'supervisor',
    'cell_join',
    'cell_session',
    'factory_join',
    'factory_session',
  ]),
  token: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.number().int().nullable(),
};

export const issueTokenContract = {
  in: {
    body: z.object({
      kind: z.enum(['supervisor', 'cell_join', 'factory_join']),
      name: titleSchema,
      expiresAt: z.number().int().nullable().default(null),
    }),
  },
  out: {
    201: z.object({ code: z.literal(201), ...issuedTokenFields }),
  },
};

export const joinTokenContract = {
  in: {
    body: z.object({ joinSecret: z.string().min(1) }),
  },
  out: {
    201: z.object({
      code: z.literal(201),
      token: z.string(),
      expiresAt: z.number().int(),
    }),
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
