import { z } from 'zod';
import { MESSAGE_MAX_CHARS } from './constants';

const message = z.string().max(MESSAGE_MAX_CHARS);

export const okReplySchema = z.object({ ok: z.literal(true) }).strict();

export const invalidReplySchema = z
  .object({ ok: z.literal(false), code: z.literal('invalid'), message })
  .strict();

export const unauthorizedReplySchema = z
  .object({ ok: z.literal(false), code: z.literal('unauthorized'), message })
  .strict();

export const conflictReplySchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(['rejected', 'stale_epoch', 'not_live', 'precondition']),
    message,
  })
  .strict();

export const internalReplySchema = z
  .object({ ok: z.literal(false), code: z.literal('internal'), message })
  .strict();

export const replySchemas = {
  200: okReplySchema,
  400: invalidReplySchema,
  401: unauthorizedReplySchema,
  409: conflictReplySchema,
  500: internalReplySchema,
} as const;

export const operatorReplySchema = z.union([
  okReplySchema,
  invalidReplySchema,
  unauthorizedReplySchema,
  conflictReplySchema,
  internalReplySchema,
]);

export type OperatorReply = z.infer<typeof operatorReplySchema>;
