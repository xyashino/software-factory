import { z } from 'zod';
import type { ZodContract } from './types';

export type ReplyOutcome =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'undeclared-status'; status: number }
  | {
      ok: false;
      reason: 'invalid-body';
      status: number;
      issues: z.core.$ZodIssue[];
    };

export const errorResponse = <C extends number, T extends string>(
  code: C,
  type: T,
) =>
  z.object({
    code: z.literal(code),
    type: z.literal(type),
    message: z.string(),
  });

export const parseReply = (
  contract: ZodContract,
  status: number,
  json: unknown,
): ReplyOutcome => {
  const schema = contract.out[status];
  if (schema === undefined)
    return { ok: false, reason: 'undeclared-status', status };
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    reason: 'invalid-body',
    status,
    issues: result.error.issues,
  };
};
