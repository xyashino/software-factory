import { z } from 'zod';

export const HQ_PROTOCOL_VERSION = 1;

export const versionContract = {
  out: {
    200: z.object({
      code: z.literal(200),
      version: z.string(),
      protocolVersion: z.number().int(),
    }),
  },
};
