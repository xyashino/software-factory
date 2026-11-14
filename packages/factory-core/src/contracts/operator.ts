import { z } from 'zod';
import { stationIdSchema } from '../ids';

/**
 * The Operator socket wire (PROTOCOL §3.3): one JSON object per line from `factory-operator` to the
 * Cell, one reply per line. The verb is `op`; every other field is that verb's payload. The Cell
 * checks the token first, then this schema, so an unknown verb or field is refused before any work.
 */
const token = z.string().min(16).max(256);
const text = z.string().min(1).max(8192);

const withToken = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ token, ...shape }).strict();

export const operatorRequestSchema = z.discriminatedUnion('op', [
  withToken({ op: z.literal('done') }),
  withToken({
    op: z.literal('verdict'),
    pass: z.boolean(),
    feedback: z.string().max(65536).optional(),
  }),
  withToken({ op: z.literal('ask'), text }),
  withToken({
    op: z.literal('tell'),
    to: z.union([stationIdSchema, z.literal('supervisor')]),
    text,
  }),
  withToken({
    op: z.literal('block'),
    reason: text,
    handover: z.string().max(65536),
  }),
  withToken({ op: z.literal('context') }),
]);

export const operatorReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown().optional() }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum([
        'unauthorized',
        'invalid',
        'rejected',
        'stale_epoch',
        'not_live',
        'precondition',
        'internal',
      ]),
      message: z.string().max(4096),
    })
    .strict(),
]);

export type OperatorRequest = z.infer<typeof operatorRequestSchema>;

/** One verb without its token: distributes over the union, so each verb keeps its own fields. */
export type OperatorVerb = OperatorRequest extends infer R
  ? R extends { token: string }
    ? Omit<R, 'token'>
    : never
  : never;
export type OperatorReply = z.infer<typeof operatorReplySchema>;
