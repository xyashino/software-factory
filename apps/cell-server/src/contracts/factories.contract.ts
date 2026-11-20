import { z } from 'zod';
import { errorResponse } from './common';

const factoryDto = z.object({
  factoryId: z.string(),
  name: z.string(),
  url: z.string(),
  isDefault: z.boolean(),
  hasJoinToken: z.boolean(),
  hasSupervisorToken: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const factoryIdParams = z.object({ id: z.string().min(1) });

const upsertBody = z.object({
  name: z.string(),
  url: z.string(),
  joinToken: z.string().nullable().optional(),
  supervisorToken: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const listFactoriesContract = {
  out: {
    200: z.object({ code: z.literal(200), factories: z.array(factoryDto) }),
  },
};

export const upsertFactoryContract = {
  in: { body: upsertBody },
  out: {
    200: z.object({ code: z.literal(200), factory: factoryDto }),
    400: errorResponse(400, 'bad-request'),
  },
};

export const setDefaultFactoryContract = {
  in: { params: factoryIdParams },
  out: {
    200: z.object({ code: z.literal(200), factory: factoryDto }),
    404: errorResponse(404, 'not-found'),
  },
};

export const removeFactoryContract = {
  in: { params: factoryIdParams },
  out: {
    200: z.object({ code: z.literal(200), factoryId: z.string() }),
    404: errorResponse(404, 'not-found'),
    409: errorResponse(409, 'conflict'),
  },
};
