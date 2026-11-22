import { z } from 'zod';
import { errorResponse } from '@repo/zod-contract-kit/reply';

const slotIdParams = z.object({ id: z.string().min(1) });

const stopBody = z.object({ force: z.boolean().optional() }).optional();

const cellDto = z.object({
  slotId: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  cellId: z.string().nullable(),
  factoryName: z.string(),
  repoRoot: z.string(),
  desiredState: z.enum(['running', 'stopped']),
  runtimeStatus: z.enum([
    'starting',
    'running',
    'stopping',
    'stopped',
    'failed',
  ]),
  pid: z.number().int().nullable(),
  logPath: z.string().nullable(),
  lastError: z.string().nullable(),
});

export const createCellsContract = {
  in: {
    body: z
      .object({
        repoRoot: z.string().min(1).optional(),
        projectId: z.string().min(1).optional(),
        factory: z.string().min(1).optional(),
        count: z.number().int().min(1).optional(),
        name: z.string().trim().min(1).optional(),
        allowedLines: z.array(z.string().min(1)).min(1).optional(),
        joinToken: z.string().min(1).optional(),
      })
      .refine(
        (body) => body.repoRoot !== undefined || body.projectId !== undefined,
        {
          message: 'repoRoot or projectId is required',
        },
      ),
  },
  out: {
    201: z.object({ code: z.literal(201), cells: z.array(cellDto) }),
    400: errorResponse(400, 'bad-request'),
    404: errorResponse(404, 'not-found'),
    409: errorResponse(409, 'conflict'),
    502: errorResponse(502, 'bad-gateway'),
  },
};

export const listCellsContract = {
  out: {
    200: z.object({ code: z.literal(200), cells: z.array(cellDto) }),
  },
};

export const startCellContract = {
  in: { params: slotIdParams },
  out: {
    200: z.object({ code: z.literal(200), cell: cellDto }),
    404: errorResponse(404, 'not-found'),
    409: errorResponse(409, 'conflict'),
  },
};

export const stopCellContract = {
  in: { params: slotIdParams, body: stopBody },
  out: {
    200: z.object({ code: z.literal(200), cell: cellDto }),
    404: errorResponse(404, 'not-found'),
  },
};

export const stopAllCellsContract = {
  in: { body: stopBody },
  out: {
    200: z.object({ code: z.literal(200), cells: z.array(cellDto) }),
  },
};

export const removeCellContract = {
  in: { params: slotIdParams },
  out: {
    200: z.object({ code: z.literal(200), slotId: z.string() }),
    404: errorResponse(404, 'not-found'),
    409: errorResponse(409, 'conflict'),
  },
};
