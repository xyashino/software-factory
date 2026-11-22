import { z } from 'zod';
import { RUNTIME_STATUSES } from './enums/cells';

const countOf = z.number().int().nonnegative();

export const getHealthContract = {
  out: {
    200: z.object({
      code: z.literal(200),
      pid: z.number().int(),
      defaultFactory: z
        .object({ factoryId: z.string(), url: z.string() })
        .nullable(),
      cells: z.object({
        total: countOf,
        byRuntimeStatus: z.record(z.enum(RUNTIME_STATUSES), countOf),
      }),
    }),
  },
};
