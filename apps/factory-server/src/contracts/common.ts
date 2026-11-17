import { z } from 'zod';

export const paginationIn = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const errorResponse = <C extends number, T extends string>(
  code: C,
  type: T,
) =>
  z.object({
    code: z.literal(code),
    type: z.literal(type),
    message: z.string(),
  });

export const idSchema = <T extends string>(brand: (value: string) => T) =>
  z
    .string()
    .min(1)
    .transform((value) => brand(value));

export const pageOut = <T extends z.ZodType>(item: T) =>
  z.object({
    code: z.literal(200),
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
