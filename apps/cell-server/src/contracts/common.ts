import { z } from 'zod';

export const errorResponse = <C extends number, T extends string>(
  code: C,
  type: T,
) =>
  z.object({
    code: z.literal(code),
    type: z.literal(type),
    message: z.string(),
  });
