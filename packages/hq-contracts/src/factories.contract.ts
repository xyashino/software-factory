import { z } from 'zod';
import { idParams, titleSchema } from '@repo/zod-contract-kit/fields';

const factoryProjectDto = z.object({
  projectId: z.string(),
  desired: z.number().int().min(0),
  running: z.number().int().min(0),
});

const factoryDto = z.object({
  factoryId: z.string(),
  name: z.string(),
  lastSeenAt: z.number().int(),
  online: z.boolean(),
  projects: z.array(factoryProjectDto),
});

export const enrollFactoryContract = {
  in: {
    body: z.object({ name: titleSchema }),
  },
  out: {
    201: z.object({
      code: z.literal(201),
      factoryId: z.string(),
      sessionToken: z.string(),
      expiresAt: z.number().int(),
    }),
  },
};

export const heartbeatFactoryContract = {
  in: {
    body: z.object({ projects: z.array(factoryProjectDto) }),
  },
  out: {
    200: z.object({ code: z.literal(200), factoryId: z.string() }),
  },
};

export const goneCellContract = {
  in: { params: idParams },
  out: {
    200: z.object({ code: z.literal(200), cellId: z.string() }),
  },
};

export const listFactoriesContract = {
  out: {
    200: z.object({ code: z.literal(200), factories: z.array(factoryDto) }),
  },
};
